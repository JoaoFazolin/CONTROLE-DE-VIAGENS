// Sessão local + rotação de refresh_token em segundo plano.
// Guardamos os tokens no localStorage (aceitável aqui: o backend nunca expõe
// nada além de tokens de sessão do próprio usuário, e o app precisa
// sobreviver a reaberturas offline em campo). Em iPhone/Safari o navegador
// pode limpar esses dados de forma imprevisível — isso é limitação do
// próprio iOS, não do app; Android é mais confiável pra uso offline longo.

const CHAVE_SESSAO = 'lrcv_sessao';
const INTERVALO_RENOVACAO_MS = 10 * 60 * 1000; // renova a cada 10 min, bem antes do token expirar

let temporizadorRenovacao = null;

export function obterSessao() {
  const bruto = localStorage.getItem(CHAVE_SESSAO);
  if (!bruto) return null;
  try {
    return JSON.parse(bruto);
  } catch {
    return null;
  }
}

function salvarSessao(sessao) {
  localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
}

export function estaLogado() {
  return !!obterSessao()?.access_token;
}

export async function entrar(email, senha) {
  const resposta = await fetch('/api/auth-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });

  const corpo = await resposta.json().catch(() => null);

  // Nunca assumir sucesso só por não ter dado erro de rede — sempre checar res.ok.
  if (!resposta.ok || !corpo?.access_token) {
    throw new Error(corpo?.erro || 'Não foi possível entrar. Confira e-mail e senha.');
  }

  salvarSessao({
    access_token: corpo.access_token,
    refresh_token: corpo.refresh_token,
    expires_at: corpo.expires_at,
    usuario: corpo.usuario,
  });

  iniciarRenovacaoAutomatica();
  return corpo.usuario;
}

export function sair() {
  pararRenovacaoAutomatica();
  localStorage.removeItem(CHAVE_SESSAO);
  window.location.href = 'index.html';
}

// Exportada (não só interna) porque o api.js também chama isso: se uma
// chamada qualquer voltar 401 (token vencido), a gente tenta renovar e
// repetir a chamada antes de desistir e deslogar — assim o usuário não é
// jogado pra tela de login só porque ficou um tempo sem abrir o app.
//
// Devolve três estados diferentes (importante pra quem chamou não confundir
// "sem rede agora" com "sessão realmente inválida"):
//   true  -> renovou com sucesso
//   false -> o servidor respondeu e recusou de verdade (refresh_token
//            inválido/revogado) — aí sim não tem mais jeito, precisa logar de novo
//   null  -> não deu pra saber (sem conexão nesse momento) — não é motivo
//            pra deslogar, só tenta de novo depois
//
// O Supabase gira o refresh_token a cada uso (o antigo para de funcionar
// assim que um novo é emitido) — então duas renovações rodando ao mesmo
// tempo (ex: a automática do boot cruzando com uma disparada por um 401)
// fariam a segunda usar um refresh_token já "gasto" e falhar por engano,
// deslogando o usuário sem necessidade. `promessaEmAndamento` garante que
// chamadas simultâneas esperem a mesma renovação em vez de disparar duas.
let promessaEmAndamento = null;

export function renovarSessao() {
  if (promessaEmAndamento) return promessaEmAndamento;

  promessaEmAndamento = renovarSessaoInterna().finally(() => {
    promessaEmAndamento = null;
  });
  return promessaEmAndamento;
}

async function renovarSessaoInterna() {
  const sessao = obterSessao();
  if (!sessao?.refresh_token) return false;

  try {
    const resposta = await fetch('/api/auth-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sessao.refresh_token }),
    });
    const corpo = await resposta.json().catch(() => null);

    if (!resposta.ok || !corpo?.access_token) {
      // O servidor respondeu (não foi problema de rede) e recusou — aí sim
      // o refresh_token expirou/foi revogado de verdade.
      console.warn('Falha ao renovar sessão:', corpo?.erro || resposta.status);
      return false;
    }

    salvarSessao({ ...sessao, access_token: corpo.access_token, refresh_token: corpo.refresh_token, expires_at: corpo.expires_at });
    return true;
  } catch (erro) {
    // Sem rede no momento da renovação — não é falha definitiva da sessão,
    // só não deu pra confirmar agora; tenta de novo no próximo ciclo.
    console.warn('Sem rede para renovar sessão agora:', erro.message);
    return null;
  }
}

export function iniciarRenovacaoAutomatica() {
  if (temporizadorRenovacao) return;
  // Renova assim que inicia (cobre o caso de o app ter ficado fechado/
  // suspenso por horas e o access_token já ter vencido nesse meio tempo),
  // e depois segue renovando periodicamente.
  renovarSessao();
  temporizadorRenovacao = setInterval(renovarSessao, INTERVALO_RENOVACAO_MS);
  // também tenta renovar assim que o app volta a ficar visível/online,
  // cobrindo o caso de o tablet ter ficado horas em espera
  window.addEventListener('online', renovarSessao);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renovarSessao();
  });
}

function pararRenovacaoAutomatica() {
  if (temporizadorRenovacao) clearInterval(temporizadorRenovacao);
  temporizadorRenovacao = null;
}

export function exigirLogin() {
  if (!estaLogado()) {
    window.location.href = 'index.html';
    return false;
  }
  iniciarRenovacaoAutomatica();
  return true;
}
