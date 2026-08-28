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
  // client_uuid identifica esse item de forma estável mesmo que a fila seja
  // lida/gravada várias vezes durante uma sincronização (ver comentário em
  // tentarSincronizarFila logo abaixo) — sem um id estável não dava pra
  // saber com segurança "qual item exatamente" já foi enviado ao mesclar.
  fila.push({ id: payload.client_uuid || novoClientUuid(), payload, tentativas: 0, criado_em: new Date().toISOString() });
  salvarFila(fila);
}

// Quantas tentativas AUTOMÁTICAS (a cada 30s, ou ao reconectar) um item pode
// levar antes de parar de tentar sozinho. Depois disso, o item continua
// guardado (nunca é descartado) e só volta a ser tentado com um toque manual
// no botão "Sincronizar" do cabeçalho (que sempre força, ignorando esse
// limite) — evita bater no servidor pra sempre a cada 30s com um item que
// provavelmente precisa de uma correção manual (ex: cadastro que foi
// desativado depois que a viagem foi lançada).
const LIMITE_TENTATIVAS_AUTOMATICAS = 8;

let sincronizando = false;

/**
 * @param {{ forcar?: boolean }} opcoes forcar:true ignora o limite de
 *   tentativas automáticas — usado só quando a pessoa toca manualmente em
 *   "Sincronizar agora".
 */
export async function tentarSincronizarFila(opcoes = {}) {
  const { forcar = false } = opcoes;
  if (sincronizando) return;
  const filaInicial = lerFila();
  if (filaInicial.length === 0) return;

  sincronizando = true;
  try {
    const idsSincronizados = new Set();
    const atualizacoesFalha = new Map();
    let semRedeNoMeioDoCaminho = false;

    for (const item of filaInicial) {
      if (semRedeNoMeioDoCaminho) break;
      if (!forcar && item.tentativas >= LIMITE_TENTATIVAS_AUTOMATICAS) continue;
      try {
        await chamarApi('/api/viagens', { metodo: 'POST', corpo: item.payload });
        idsSincronizados.add(item.id);
      } catch (erro) {
        if (erro instanceof ErroApi && erro.statusCode === 0) {
          // ainda sem rede — para de tentar os próximos itens agora (eles
          // continuam na fila do jeito que estavam)
          semRedeNoMeioDoCaminho = true;
        } else {
          // erro de validação real do servidor (ex: cadastro foi desativado
          // nesse meio tempo) — mantém na fila mas marca tentativa, pra não
          // sumir o registro do motorista silenciosamente
          atualizacoesFalha.set(item.id, { tentativas: item.tentativas + 1, ultimo_erro: erro.message });
        }
      }
    }

    // Mescla com o estado ATUAL da fila (lido de novo agora, não a "foto"
    // tirada no início) — se uma viagem nova foi enfileirada enquanto esse
    // laço estava esperando a rede, ela já está salva aqui e não pode ser
    // apagada. Antes disso, sobrescrever com a foto antiga podia sumir com
    // um item recém-adicionado sem nunca ter sido enviado.
    const filaAtual = lerFila();
    const restantes = filaAtual
      .filter((item) => !idsSincronizados.has(item.id))
      .map((item) => (atualizacoesFalha.has(item.id) ? { ...item, ...atualizacoesFalha.get(item.id) } : item));
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
