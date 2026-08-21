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
  const resposta = await fetch('/api/auth/login', {
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

async function renovarSessao() {
  const sessao = obterSessao();
  if (!sessao?.refresh_token) return;

  try {
    const resposta = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sessao.refresh_token }),
    });
    const corpo = await resposta.json().catch(() => null);

    if (!resposta.ok || !corpo?.access_token) {
      // refresh_token pode ter expirado por inatividade prolongada (meses).
      // Não desloga agressivamente por falha de rede momentânea — só loga o
      // problema; a próxima tentativa de chamada autenticada vai detectar
      // 401 de verdade e aí sim pedir novo login.
      console.warn('Falha ao renovar sessão:', corpo?.erro || resposta.status);
      return;
    }

    salvarSessao({ ...sessao, access_token: corpo.access_token, refresh_token: corpo.refresh_token, expires_at: corpo.expires_at });
  } catch (erro) {
    // Offline no momento da renovação — tudo bem, tenta de novo no próximo ciclo.
    console.warn('Sem rede para renovar sessão agora:', erro.message);
  }
}

export function iniciarRenovacaoAutomatica() {
  if (temporizadorRenovacao) return;
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
