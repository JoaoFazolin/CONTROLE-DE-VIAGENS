import { exigirLogin, obterSessao } from './auth.js';
import { montarCabecalho } from '../layout/cabecalho.js';
import { chamarApi, ErroApi } from './api.js';
import { atualizarCadastros, obterCacheLocal } from './cadastrosCache.js';
import { criarCombobox } from './combobox.js';

if (!exigirLogin()) throw new Error('redirecionando para login');

const sessao = obterSessao();
// Só admin (Operador Avançado perdeu acesso a Relatórios).
const ehGerente = sessao.usuario.role === 'admin';
if (!ehGerente) {
  window.location.href = 'app.html';
}

montarCabecalho('relatorios');

const campoInicio = document.getElementById('campo-inicio');
const campoFim = document.getElementById('campo-fim');
const avisoErro = document.getElementById('aviso-erro');
const avisoVolume = document.getElementById('aviso-volume');
const btnExportar = document.getElementById('btn-exportar');
const btnExportarPdf = document.getElementById('btn-exportar-pdf');

const hoje = new Date();
const primeiroDiaDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
campoInicio.value = primeiroDiaDoMes.toISOString().slice(0, 10);
campoFim.value = hoje.toISOString().slice(0, 10);

// Filtros opcionais (mesmo padrão do Histórico de viagens): deixando em
// "Todos", o relatório sai geral, com todos os caminhões e motoristas.
function opcoesDe(lista, formatarTexto) {
  return [{ id: '', texto: 'Todos' }, ...(lista || []).map((item) => ({ id: item.id, texto: formatarTexto(item) }))];
}

let filtroCaminhao, filtroMotorista, filtroDestino;
let caminhoesCache = [];

// Avisa (sem bloquear) se algum caminhão ativo não tem "Volume no Aterro"
// cadastrado — sem isso, a linha dele sai em branco no relatório sem
// explicação nenhuma. Considera só o caminhão selecionado no filtro, ou
// todos os ativos se estiver em "Todos".
function verificarVolumeFaltando() {
  const caminhaoIdFiltro = filtroCaminhao?.obterValor();
  const relevantes = caminhoesCache.filter((c) => c.ativo && (!caminhaoIdFiltro || c.id === caminhaoIdFiltro));
  const semVolume = relevantes.filter((c) => c.volume_aterro === null || c.volume_aterro === undefined);

  if (semVolume.length === 0) {
    avisoVolume.style.display = 'none';
    return;
  }
  const nomes = semVolume.map((c) => c.codigo).join(', ');
  avisoVolume.textContent = `Atenção: ${semVolume.length === 1 ? 'o caminhão' : 'os caminhões'} ${nomes} não ${semVolume.length === 1 ? 'tem' : 'têm'} "Volume no Aterro" cadastrado — a coluna vai sair em branco no relatório. Cadastre em Cadastros > Caminhões, se quiser.`;
  avisoVolume.style.display = 'block';
}

async function montarFiltros() {
  const cacheLocalAntes = obterCacheLocal();
  const { cache } = Object.keys(cacheLocalAntes).length ? { cache: cacheLocalAntes } : await atualizarCadastros();

  caminhoesCache = cache.caminhoes || [];

  filtroCaminhao = criarCombobox({
    container: document.getElementById('filtro-caminhao'),
    rotulo: 'Caminhão',
    opcoes: opcoesDe(cache.caminhoes, (c) => c.codigo),
    aoSelecionar: verificarVolumeFaltando,
  });
  filtroMotorista = criarCombobox({
    container: document.getElementById('filtro-motorista'),
    rotulo: 'Motorista',
    opcoes: opcoesDe(cache.motoristas, (m) => m.nome),
  });
  filtroDestino = criarCombobox({
    container: document.getElementById('filtro-destino'),
    rotulo: 'Destino',
    opcoes: opcoesDe(cache.destinos, (d) => d.codigo),
  });
  [filtroCaminhao, filtroMotorista, filtroDestino].forEach((f) => f.definirValor(''));

  verificarVolumeFaltando();

  // Atualiza em segundo plano com o servidor, caso o cache local estivesse
  // desatualizado (mesma lógica de sempre: se estiver offline, mantém o
  // que já tem).
  const { cache: cacheAtualizado } = await atualizarCadastros();
  caminhoesCache = cacheAtualizado.caminhoes || [];
  filtroCaminhao.definirOpcoes(opcoesDe(cacheAtualizado.caminhoes, (c) => c.codigo));
  filtroMotorista.definirOpcoes(opcoesDe(cacheAtualizado.motoristas, (m) => m.nome));
  filtroDestino.definirOpcoes(opcoesDe(cacheAtualizado.destinos, (d) => d.codigo));
  verificarVolumeFaltando();
}
montarFiltros();

// --- Botão "Atualizar" do cabeçalho ---------------------------------------
async function exportarRelatorio({ endpoint, extensao, botao, textoOriginal, textoGerando }) {
  avisoErro.style.display = 'none';

  if (!campoInicio.value || !campoFim.value) {
    avisoErro.textContent = 'Selecione o período.';
    avisoErro.style.display = 'block';
    return;
  }

  botao.disabled = true;
  botao.textContent = textoGerando;

  try {
    const params = new URLSearchParams({ inicio: campoInicio.value, fim: campoFim.value });
    const caminhaoId = filtroCaminhao?.obterValor();
    const motoristaId = filtroMotorista?.obterValor();
    const destinoId = filtroDestino?.obterValor();
    if (caminhaoId) params.set('caminhao_id', caminhaoId);
    if (motoristaId) params.set('motorista_id', motoristaId);
    if (destinoId) params.set('destino_id', destinoId);

    const resposta = await chamarApi(`${endpoint}?${params.toString()}`);
    const blob = await resposta.blob();

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `viagens_${campoInicio.value}_a_${campoFim.value}.${extensao}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (erro) {
    avisoErro.textContent = erro instanceof ErroApi ? erro.message : 'Erro ao gerar o relatório. Confira sua conexão.';
    avisoErro.style.display = 'block';
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

btnExportar.addEventListener('click', () =>
  exportarRelatorio({
    endpoint: '/api/relatorio-excel',
    extensao: 'xlsx',
    botao: btnExportar,
    textoOriginal: 'Baixar planilha (.xlsx)',
    textoGerando: 'Gerando…',
  })
);

btnExportarPdf.addEventListener('click', () =>
  exportarRelatorio({
    endpoint: '/api/relatorio-pdf',
    extensao: 'pdf',
    botao: btnExportarPdf,
    textoOriginal: 'Baixar PDF',
    textoGerando: 'Gerando…',
  })
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
