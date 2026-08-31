// Fila de pendentes: se salvar sem internet, guarda a viagem no aparelho
// (localStorage) e tenta enviar sozinho quando a conexão voltar.
// Cada item tem um client_uuid gerado no aparelho — o backend usa isso pra
// nunca duplicar a viagem, mesmo se o mesmo item for reenviado várias vezes
// (rede instável, app fechado no meio do envio, etc).
import { chamarApi, ErroApi } from './api.js';

const CHAVE_FILA = 'lrcv_fila_pendentes';
// 15s (era 30s) — em obra a conexão costuma ser instável e intermitente;
// um intervalo mais curto faz o item sumir da tela sozinho mais rápido,
// sem precisar de nenhum toque manual.
const INTERVALO_FLUSH_MS = 15 * 1000;

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
  // Sem o try/catch, um localStorage.setItem que falhar (quota de
  // armazenamento excedida — plausível num tablet usado offline por muito
  // tempo acumulando fila + cadastros + rascunho — ou modo privado do
  // Safari/iOS) derrubava a promise de tentarSincronizarFila com erro. O
  // toque manual em "Sincronizar" no cabeçalho (cabecalho.js) não tinha
  // try/catch em volta do await, e ficava com o botão preso em
  // "Sincronizando…" pra sempre, mesmo com os itens já enviados de verdade
  // ao servidor (só a atualização local da fila é que falhou).
  try {
    localStorage.setItem(CHAVE_FILA, JSON.stringify(fila));
  } catch (erro) {
    console.warn('Não foi possível salvar a fila de pendentes no aparelho:', erro.message);
  }
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
let promessaAtual = null;

/**
 * @param {{ forcar?: boolean }} opcoes forcar:true ignora o limite de
 *   tentativas automáticas — usado só quando a pessoa toca manualmente em
 *   "Sincronizar agora".
 */
export async function tentarSincronizarFila(opcoes = {}) {
  const { forcar = false } = opcoes;
  if (sincronizando) {
    // Com o intervalo automático mais curto (15s) e a rajada de
    // retentativas ao reconectar, ficou bem mais provável de um toque
    // manual em "Sincronizar agora" (forcar:true) cair bem no meio de uma
    // tentativa automática já em andamento. Antes isso era simplesmente
    // ignorado — o botão parecia ter rodado, mas nada acontecia. Agora,
    // quando é um toque forçado, espera a tentativa atual terminar e tenta
    // de novo (respeitando forcar:true, então ignora o limite de
    // tentativas mesmo que a rodada automática que acabou de passar não).
    if (forcar) return promessaAtual ? promessaAtual.then(() => tentarSincronizarFila(opcoes)) : undefined;
    return;
  }
  const filaInicial = lerFila();
  if (filaInicial.length === 0) return;

  sincronizando = true;
  promessaAtual = (async () => {
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
  })().finally(() => {
    sincronizando = false;
    promessaAtual = null;
  });
  return promessaAtual;
}

// Assim que o evento "online" dispara, a conexão às vezes ainda não está
// realmente utilizável por um instante (handoff wifi/dados, captive
// portal etc) — uma única tentativa nesse momento pode falhar de novo por
// falta de rede mesmo já "online". Em vez de esperar o próximo intervalo de
// 15s, tenta de novo algumas vezes rapidinho logo em seguida, sem precisar
// de nenhum toque manual.
function tentarComRajadaDeRetentativas() {
  tentarSincronizarFila();
  [2000, 5000, 10000].forEach((atraso) => setTimeout(tentarSincronizarFila, atraso));
}

export function iniciarSincronizacaoAutomatica() {
  window.addEventListener('online', tentarComRajadaDeRetentativas);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tentarSincronizarFila();
  });
  // 'focus'/'pageshow' cobrem o caso comum no celular de minimizar o app
  // (ou trocar de aba) com a tela ainda "visível" tecnicamente, mas o
  // navegador pausa os timers em segundo plano — sem isso, a fila só
  // sincronizava de novo quando a pessoa reabria o app manualmente E esse
  // reabrir disparava visibilitychange, o que nem sempre acontece (ex:
  // Safari/iOS em alguns cenários dispara só 'pageshow').
  window.addEventListener('focus', () => tentarSincronizarFila());
  window.addEventListener('pageshow', () => tentarSincronizarFila());
  setInterval(tentarSincronizarFila, INTERVALO_FLUSH_MS);
  tentarSincronizarFila();
}
