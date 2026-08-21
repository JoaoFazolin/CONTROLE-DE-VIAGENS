// Cache local dos cadastros (caminhões, escavadeiras, locais, destinos,
// motoristas) — assim o formulário de viagem continua funcionando mesmo se
// o motorista abrir o app sem internet (só não vê cadastros feitos DEPOIS
// da última sincronização, o que é esperado em uso offline).
import { chamarApi } from './api.js';

const CHAVE_CACHE = 'lrcv_cadastros_cache';

const RECURSOS = {
  caminhoes: '/api/caminhoes',
  escavadeiras: '/api/escavadeiras',
  locais_carga: '/api/locais-carga',
  destinos: '/api/destinos',
  motoristas: '/api/motoristas',
};

export function obterCacheLocal() {
  const bruto = localStorage.getItem(CHAVE_CACHE);
  if (!bruto) return {};
  try {
    return JSON.parse(bruto);
  } catch {
    return {};
  }
}

function salvarCacheLocal(cache) {
  localStorage.setItem(CHAVE_CACHE, JSON.stringify(cache));
}

/**
 * Busca os cadastros no servidor e atualiza o cache local. Se estiver
 * offline, silenciosamente mantém o que já tem em cache (não é erro).
 * Devolve o cache resultante (do servidor se deu certo, local se não).
 */
export async function atualizarCadastros() {
  const cacheAtual = obterCacheLocal();
  const novoCache = { ...cacheAtual };
  let algumErro = false;

  await Promise.all(
    Object.entries(RECURSOS).map(async ([chave, caminho]) => {
      try {
        const resultado = await chamarApi(caminho);
        novoCache[chave] = resultado.itens;
      } catch {
        algumErro = true; // fica com o valor antigo desse recurso, se houver
      }
    })
  );

  salvarCacheLocal(novoCache);
  return { cache: novoCache, atualizadoTotalmente: !algumErro };
}
