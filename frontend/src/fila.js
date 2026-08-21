// Fila de pendentes: se salvar sem internet, guarda a viagem no aparelho
// (localStorage) e tenta enviar sozinho quando a conexão voltar.
// Cada item tem um client_uuid gerado no aparelho — o backend usa isso pra
// nunca duplicar a viagem, mesmo se o mesmo item for reenviado várias vezes
// (rede instável, app fechado no meio do envio, etc).
import { chamarApi, ErroApi } from './api.js';

const CHAVE_FILA = 'lrcv_fila_pendentes';
const INTERVALO_FLUSH_MS = 30 * 1000;

const ouvintes = new Set();

function lerFila() {
  const bruto = localStorage.getItem(CHAVE_FILA);
  if (!bruto) return [];
  try {
    return JSON.parse(bruto);
  } catch {
    return [];
  }
}

function salvarFila(fila) {
  localStorage.setItem(CHAVE_FILA, JSON.stringify(fila));
  notificar();
}

function notificar() {
  const fila = lerFila();
  for (const cb of ouvintes) cb(fila);
}

export function aoMudarFila(callback) {
  ouvintes.add(callback);
  callback(lerFila());
  return () => ouvintes.delete(callback);
}

export function obterPendentes() {
  return lerFila();
}

export function novoClientUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  // fallback simples pra navegadores muito antigos
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Tenta salvar a viagem agora; se não der por falta de rede, guarda na fila
 * e devolve { pendente: true }. Se o servidor responder com erro de
 * validação de verdade (não é problema de rede), o erro sobe pra quem
 * chamou tratar — não faz sentido guardar na fila algo que o servidor já
 * rejeitou.
 */
export async function salvarViagem(payload) {
  try {
    const resultado = await chamarApi('/api/viagens', { metodo: 'POST', corpo: payload });
    return { pendente: false, item: resultado.item };
  } catch (erro) {
    if (erro instanceof ErroApi && erro.statusCode === 0) {
      enfileirar(payload);
      return { pendente: true };
    }
    throw erro;
  }
}

function enfileirar(payload) {
  const fila = lerFila();
  fila.push({ payload, tentativas: 0, criado_em: new Date().toISOString() });
  salvarFila(fila);
}

let sincronizando = false;

export async function tentarSincronizarFila() {
  if (sincronizando) return;
  const fila = lerFila();
  if (fila.length === 0) return;

  sincronizando = true;
  try {
    const restantes = [];
    for (const item of fila) {
      try {
        await chamarApi('/api/viagens', { metodo: 'POST', corpo: item.payload });
        // sucesso: não entra em "restantes", some da fila
      } catch (erro) {
        if (erro instanceof ErroApi && erro.statusCode === 0) {
          // ainda sem rede — mantém na fila e para de tentar os próximos agora
          restantes.push(item);
          restantes.push(...fila.slice(fila.indexOf(item) + 1));
          break;
        }
        // erro de validação real do servidor (ex: cadastro foi desativado
        // nesse meio tempo) — mantém na fila mas marca tentativa, pra não
        // sumir o registro do motorista silenciosamente
        restantes.push({ ...item, tentativas: item.tentativas + 1, ultimo_erro: erro.message });
      }
    }
    salvarFila(restantes);
  } finally {
    sincronizando = false;
  }
}

export function iniciarSincronizacaoAutomatica() {
  window.addEventListener('online', tentarSincronizarFila);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tentarSincronizarFila();
  });
  setInterval(tentarSincronizarFila, INTERVALO_FLUSH_MS);
  tentarSincronizarFila();
}
