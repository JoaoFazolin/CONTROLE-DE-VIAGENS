// Wrapper único de fetch para toda chamada autenticada ao backend.
// Regra de ouro (bug real corrigido no outro sistema): NUNCA considerar que
// deu certo só porque não houve erro de rede — sempre checar res.ok, porque
// um erro de validação do servidor também chega como resposta "normal".
import { obterSessao, sair } from './auth.js';

export class ErroApi extends Error {
  constructor(mensagem, statusCode) {
    super(mensagem);
    this.statusCode = statusCode;
  }
}

export async function chamarApi(caminho, { metodo = 'GET', corpo, semAuth = false } = {}) {
  const sessao = obterSessao();
  const headers = { 'Content-Type': 'application/json' };
  if (!semAuth && sessao?.access_token) {
    headers.Authorization = `Bearer ${sessao.access_token}`;
  }

  let resposta;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      headers,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch (erroRede) {
    // Sem conexão — quem chamou decide se isso vai pra fila offline ou não.
    throw new ErroApi('Sem conexão com o servidor.', 0);
  }

  if (resposta.status === 401) {
    sair();
    throw new ErroApi('Sessão expirada. Faça login novamente.', 401);
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

  const tipo = resposta.headers.get('content-type') || '';
  if (tipo.includes('application/json')) {
    return resposta.json();
  }
  return resposta;
}
