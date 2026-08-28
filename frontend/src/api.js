// Wrapper único de fetch para toda chamada autenticada ao backend.
// Regra de ouro (bug real corrigido no outro sistema): NUNCA considerar que
// deu certo só porque não houve erro de rede — sempre checar res.ok, porque
// um erro de validação do servidor também chega como resposta "normal".
import { obterSessao, sair, renovarSessao } from './auth.js';
import { registrarSincronizacaoOk } from './statusSincronizacao.js';

export class ErroApi extends Error {
  constructor(mensagem, statusCode) {
    super(mensagem);
    this.statusCode = statusCode;
  }
}

async function fazerFetch(caminho, metodo, corpo, semAuth) {
  const sessao = obterSessao();
  const headers = { 'Content-Type': 'application/json' };
  if (!semAuth && sessao?.access_token) {
    headers.Authorization = `Bearer ${sessao.access_token}`;
  }
  return fetch(caminho, {
    method: metodo,
    headers,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
}

export async function chamarApi(caminho, { metodo = 'GET', corpo, semAuth = false } = {}) {
  let resposta;
  try {
    resposta = await fazerFetch(caminho, metodo, corpo, semAuth);
  } catch (erroRede) {
    // Sem conexão — quem chamou decide se isso vai pra fila offline ou não.
    throw new ErroApi('Sem conexão com o servidor.', 0);
  }

  if (resposta.status === 401 && !semAuth) {
    // Token de acesso vencido (comum se o app ficou fechado/offline por
    // horas) não é motivo pra jogar o usuário pra tela de login — só
    // tentamos renovar com o refresh_token e repetir a chamada uma vez.
    // Só desloga de verdade se o servidor recusar a renovação de fato (ver
    // renovarSessao) — se o problema foi só falta de rede na hora de
    // renovar, não desloga, só devolve "sem conexão" pra essa chamada.
    const renovou = await renovarSessao();

    if (renovou === null) {
      throw new ErroApi('Sem conexão com o servidor.', 0);
    }
    if (renovou === false) {
      sair();
      throw new ErroApi('Sessão expirada. Faça login novamente.', 401);
    }

    try {
      resposta = await fazerFetch(caminho, metodo, corpo, semAuth);
    } catch (erroRede) {
      throw new ErroApi('Sem conexão com o servidor.', 0);
    }
    if (resposta.status === 401) {
      // Renovou mas o token novo ainda voltou 401 — situação anômala, trata
      // como sessão realmente inválida pra não ficar em loop.
      sair();
      throw new ErroApi('Sessão expirada. Faça login novamente.', 401);
    }
  }

  // Checagem explícita de res.ok ANTES de tratar como sucesso.
  if (!resposta.ok) {
    let mensagem = `Erro ${resposta.status} ao falar com o servidor.`;
    try {
      const dados = await resposta.json();
      if (dados?.erro) mensagem = dados.erro;
    } catch {
      /* resposta sem corpo JSON — mantém mensagem genérica */
    }
    throw new ErroApi(mensagem, resposta.status);
  }

  // Chegou aqui: o servidor respondeu (independente do conteúdo) — é uma
  // sincronização real, então marca o instante pro indicador do cabeçalho.
  registrarSincronizacaoOk();

  const tipo = resposta.headers.get('content-type') || '';
  if (tipo.includes('application/json')) {
    return resposta.json();
  }
  return resposta;
}
