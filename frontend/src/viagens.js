import { exigirLogin, obterSessao } from './auth.js';
import { montarCabecalho } from '../layout/cabecalho.js';
import { chamarApi, ErroApi } from './api.js';
import { atualizarCadastros, obterCacheLocal } from './cadastrosCache.js';
import { criarCombobox } from './combobox.js';
import { criarBotoesDestino } from './botoesDestino.js';
import { salvarViagem, novoClientUuid, aoMudarFila, iniciarSincronizacaoAutomatica, tentarSincronizarFila } from './fila.js';

if (!exigirLogin()) throw new Error('redirecionando para login');

montarCabecalho('viagens');
iniciarSincronizacaoAutomatica();

const sessao = obterSessao();
// "Gerente" = só admin (acesso a Cadastros/Relatórios/Dashboard, filtros do
// histórico, editar/excluir viagem já lançada).
const ehGerente = sessao.usuario.role === 'admin';
const ehAdminEstrito = sessao.usuario.role === 'admin';
// Na prática quem loga e lança é o Operador Avançado (o operador da
// escavadeira — EH 347, EH 349 etc) — o motorista do caminhão não abre o
// app. Por isso o Operador Avançado escolhe livremente qual motorista
// dirigiu cada carga (não trava no próprio nome como um motorista de
// verdade travaria, se algum dia logasse). Cada operador só vê/edita o que
// ELE MESMO lançou (isolamento por "quem lançou", não por "quem dirigiu" —
// ver filtro no backend).
const podeEscolherLivre = sessao.usuario.role !== 'motorista';

const campoData = document.getElementById('campo-data');
campoData.value = dataDeHojeLocal();

let comboCaminhao, comboEscavadeira, comboLocal, comboDestino, comboMotorista;
let filtroCaminhao, filtroMotorista, filtroDestino;
let caminhaoVinculadoId = null; // motorista comum: id do caminhão travado pra ele (null = sem vínculo)
let idEmEdicao = null; // client_uuid não muda; guardamos o id da viagem quando estamos editando
let offsetHistorico = 0;

function dataDeHojeLocal() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function opcoesDe(lista, formatarTexto) {
  return (lista || []).map((item) => ({ id: item.id, texto: formatarTexto(item) }));
}

function montarCombos(cache) {
  comboCaminhao = criarCombobox({
    container: document.getElementById('campo-caminhao'),
    rotulo: 'Caminhão',
    obrigatorio: true,
    opcoes: opcoesDe(cache.caminhoes, (c) => c.codigo),
    inputmode: 'numeric', // motorista geralmente busca pelo número do caminhão
    // Quem escolhe o motorista livremente (admin ou operador) ganha esse
    // atalho: escolher um caminhão que já tem vínculo pré-preenche o
    // Motorista (continua editável — útil pra trocar quando o motorista
    // fixo daquele caminhão faltou e outro assumiu naquele dia).
    aoSelecionar: podeEscolherLivre
      ? (caminhaoId) => {
          const caminhao = (cache.caminhoes || []).find((c) => c.id === caminhaoId);
          if (caminhao?.motorista_id) comboMotorista.definirValor(caminhao.motorista_id);
        }
      : null,
  });
  comboEscavadeira = criarCombobox({
    container: document.getElementById('campo-escavadeira'),
    rotulo: 'Escavadeira (opcional)',
    opcoes: opcoesDe(cache.escavadeiras, (e) => e.codigo),
  });
  comboLocal = criarCombobox({
    container: document.getElementById('campo-local'),
    rotulo: 'Local de carga/corte (opcional)',
    opcoes: opcoesDe(cache.locais_carga, (l) => l.nome),
  });
  comboDestino = criarBotoesDestino({
    container: document.getElementById('campo-destino'),
    rotulo: 'Destino',
    obrigatorio: true,
    destinos: cache.destinos || [],
  });
  comboMotorista = criarCombobox({
    container: document.getElementById('campo-motorista'),
    rotulo: 'Motorista',
    obrigatorio: true,
    opcoes: opcoesDe(cache.motoristas, (m) => m.nome),
  });

  if (!podeEscolherLivre) {
    // Só cai aqui um login com cargo "motorista" de verdade (raro na
    // prática) — trava no próprio nome e no caminhão vinculado, como antes.
    comboMotorista.definirValor(sessao.usuario.id);
    const inputMotorista = document.querySelector('#campo-motorista .cb-input');
    if (inputMotorista) {
      inputMotorista.disabled = true;
      inputMotorista.style.background = '#f0f1f3';
    }

    // Caminhão vinculado ao motorista (cadastrado em Cadastros → Caminhões):
    // vem pré-preenchido e travado, pra não precisar escolher toda vez. Se
    // ainda não tiver nenhum caminhão vinculado a ele, deixa livre pra
    // escolher normalmente (não trava o lançamento por falta de cadastro).
    const caminhaoVinculado = (cache.caminhoes || []).find((c) => c.motorista_id === sessao.usuario.id);
    caminhaoVinculadoId = caminhaoVinculado?.id || null;
    const avisoSemVinculo = document.getElementById('aviso-sem-caminhao-vinculado');
    if (caminhaoVinculado) {
      comboCaminhao.definirValor(caminhaoVinculado.id);
      const inputCaminhao = document.querySelector('#campo-caminhao .cb-input');
      if (inputCaminhao) {
        inputCaminhao.disabled = true;
        inputCaminhao.style.background = '#f0f1f3';
      }
      if (avisoSemVinculo) avisoSemVinculo.style.display = 'none';
    } else if (avisoSemVinculo) {
      avisoSemVinculo.style.display = 'block';
    }
  }

  // Total de viagens sempre 1 pra quem lança na obra (motorista ou operador
  // avançado) — o apontador não corrige esse número na hora; se precisar
  // corrigir depois, só o admin edita.
  if (!ehGerente) {
    const campoTotalViagens = document.getElementById('campo-total-viagens');
    if (campoTotalViagens) {
      campoTotalViagens.value = 1;
      campoTotalViagens.readOnly = true;
      campoTotalViagens.style.background = '#f0f1f3';
    }
  }

  // Filtros do histórico só existem pra quem gerencia (motorista comum já
  // só vê as próprias viagens, filtro de motorista não faria sentido).
  if (ehGerente) {
    filtroCaminhao = criarCombobox({
      container: document.getElementById('filtro-caminhao'),
      rotulo: 'Filtrar por caminhão',
      opcoes: [{ id: '', texto: 'Todos' }, ...opcoesDe(cache.caminhoes, (c) => c.codigo)],
    });
    filtroMotorista = criarCombobox({
      container: document.getElementById('filtro-motorista'),
      rotulo: 'Filtrar por motorista',
      opcoes: [{ id: '', texto: 'Todos' }, ...opcoesDe(cache.motoristas, (m) => m.nome)],
    });
    filtroDestino = criarCombobox({
      container: document.getElementById('filtro-destino'),
      rotulo: 'Filtrar por destino',
      opcoes: [{ id: '', texto: 'Todos' }, ...opcoesDe(cache.destinos, (d) => d.codigo)],
    });
    [filtroCaminhao, filtroMotorista, filtroDestino].forEach((f) => f.definirValor(''));
  } else {
    document.querySelector('.barra-filtros').style.display = 'none';
  }
}

async function carregarCadastros() {
  const cacheLocalAntes = obterCacheLocal();
  if (Object.keys(cacheLocalAntes).length) montarCombos(cacheLocalAntes);

  const { cache, atualizadoTotalmente } = await atualizarCadastros();
  montarCombos(cache);

  document.getElementById('aviso-cadastro-offline').style.display = atualizadoTotalmente ? 'none' : 'block';
}

// --- Modo edição ---------------------------------------------------------
const tituloForm = document.getElementById('titulo-form');
const btnCancelarEdicao = document.getElementById('btn-cancelar-edicao');
const campoOrdemWrap = document.getElementById('campo-ordem-wrap');
const campoOrdem = document.getElementById('campo-ordem');

function entrarModoEdicao(viagem) {
  idEmEdicao = viagem.id;
  tituloForm.textContent = `Editando viagem #${viagem.ordem} (${viagem.data})`;
  btnCancelarEdicao.style.display = '';
  campoOrdemWrap.style.display = '';
  campoOrdem.value = viagem.ordem;
  campoData.value = viagem.data;
  comboCaminhao.definirValor(viagem.caminhao?.id);
  if (viagem.escavadeira?.id) comboEscavadeira.definirValor(viagem.escavadeira.id);
  else comboEscavadeira.limpar();
  if (viagem.local_carga?.id) comboLocal.definirValor(viagem.local_carga.id);
  else comboLocal.limpar();
  comboDestino.definirValor(viagem.destino?.id);
  comboMotorista.definirValor(viagem.motorista?.id);
  document.getElementById('campo-total-viagens').value = viagem.total_viagens;
  document.getElementById('btn-salvar-viagem').textContent = 'Salvar edição';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function sairModoEdicao() {
  idEmEdicao = null;
  tituloForm.textContent = 'Nova viagem';
  btnCancelarEdicao.style.display = 'none';
  campoOrdemWrap.style.display = 'none';
  document.getElementById('btn-salvar-viagem').textContent = 'Salvar viagem';
  form.reset();
  campoData.value = dataDeHojeLocal();
  if (caminhaoVinculadoId) comboCaminhao.definirValor(caminhaoVinculadoId);
  else comboCaminhao.limpar();
  comboEscavadeira.limpar();
  comboLocal.limpar();
  comboDestino.limpar();
  if (podeEscolherLivre) comboMotorista.limpar();
  document.getElementById('campo-total-viagens').value = 1;
}

btnCancelarEdicao.addEventListener('click', sairModoEdicao);

// --- Modal de confirmação -------------------------------------------------
const modalConfirmacao = document.getElementById('modal-confirmacao');
const listaConfirmacao = document.getElementById('lista-confirmacao');
const btnConfirmacaoOk = document.getElementById('btn-confirmacao-ok');
const btnConfirmacaoCancelar = document.getElementById('btn-confirmacao-cancelar');

function pedirConfirmacao(linhas) {
  return new Promise((resolve) => {
    listaConfirmacao.innerHTML = linhas
      .map(({ rotulo, valor }) => `<li><span>${rotulo}</span><span>${valor}</span></li>`)
      .join('');
    modalConfirmacao.classList.add('aberto');

    function limpar() {
      modalConfirmacao.classList.remove('aberto');
      btnConfirmacaoOk.removeEventListener('click', aoConfirmar);
      btnConfirmacaoCancelar.removeEventListener('click', aoCancelar);
    }
    function aoConfirmar() {
      limpar();
      resolve(true);
    }
    function aoCancelar() {
      limpar();
      resolve(false);
    }
    btnConfirmacaoOk.addEventListener('click', aoConfirmar);
    btnConfirmacaoCancelar.addEventListener('click', aoCancelar);
  });
}

// --- Envio do formulário -----------------------------------------------
const form = document.getElementById('form-viagem');
const avisoErro = document.getElementById('aviso-form-erro');
const avisoSucesso = document.getElementById('aviso-form-sucesso');
const btnSalvar = document.getElementById('btn-salvar-viagem');

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  avisoErro.style.display = 'none';
  avisoSucesso.style.display = 'none';

  const caminhao_id = comboCaminhao.obterValor();
  const destino_id = comboDestino.obterValor();
  const motorista_id = comboMotorista.obterValor();
  const totalViagens = Number(document.getElementById('campo-total-viagens').value || 1);

  if (!caminhao_id || !destino_id || !motorista_id) {
    avisoErro.textContent = 'Preencha caminhão, destino e motorista.';
    avisoErro.style.display = 'block';
    return;
  }

  const textoCaminhao = document.querySelector('#campo-caminhao .cb-input').value;
  const textoDestino = comboDestino.obterTexto();
  const textoMotorista = document.querySelector('#campo-motorista .cb-input').value;

  // Capturado aqui, no instante do clique em "Salvar" — é esse valor (não
  // um "agora" recalculado na hora de sincronizar) que vai tanto na tela de
  // confirmação quanto no registro salvo, mesmo que fique horas na fila
  // offline esperando internet.
  const agoraIso = new Date().toISOString();

  const linhasConfirmacao = [
    { rotulo: 'Data', valor: campoData.value },
    { rotulo: 'Caminhão', valor: textoCaminhao },
    { rotulo: 'Destino', valor: textoDestino },
    { rotulo: 'Total de viagens', valor: totalViagens },
    { rotulo: 'Motorista', valor: textoMotorista },
  ];
  if (idEmEdicao) {
    linhasConfirmacao.splice(1, 0, { rotulo: 'Ordem', valor: campoOrdem.value });
  } else {
    linhasConfirmacao.push({ rotulo: 'Horário do registro', valor: formatarHorario(agoraIso) });
  }

  const confirmou = await pedirConfirmacao(linhasConfirmacao);
  if (!confirmou) return;

  btnSalvar.disabled = true;
  btnSalvar.textContent = idEmEdicao ? 'Salvando edição…' : 'Salvando…';

  try {
    if (idEmEdicao) {
      await chamarApi('/api/viagens', {
        metodo: 'PUT',
        corpo: {
          id: idEmEdicao,
          ordem: Number(campoOrdem.value),
          caminhao_id,
          escavadeira_id: comboEscavadeira.obterValor(),
          local_carga_id: comboLocal.obterValor(),
          destino_id,
          total_viagens: totalViagens,
          motorista_id,
        },
      });
      avisoSucesso.textContent = 'Viagem atualizada com sucesso.';
      avisoSucesso.style.display = 'block';
      sairModoEdicao();
      await carregarResumoEViagens();
      await carregarHistorico(true);
    } else {
      const payload = {
        client_uuid: novoClientUuid(),
        data: campoData.value,
        caminhao_id,
        escavadeira_id: comboEscavadeira.obterValor(),
        local_carga_id: comboLocal.obterValor(),
        destino_id,
        total_viagens: totalViagens,
        diesel_litros: null, // campo de diesel removido do lançamento a pedido do cliente
        motorista_id,
        registrado_em: agoraIso, // hora capturada NO APARELHO, no clique em "Salvar"
      };

      const resultado = await salvarViagem(payload);

      if (resultado.pendente) {
        avisoSucesso.textContent = 'Sem internet agora — viagem guardada no aparelho e será enviada automaticamente quando a conexão voltar.';
      } else {
        avisoSucesso.textContent = `Viagem #${resultado.item.ordem} salva com sucesso.`;
        await carregarResumoEViagens();
        await carregarHistorico(true);
      }
      avisoSucesso.style.display = 'block';
      sairModoEdicao();
    }
  } catch (erro) {
    avisoErro.textContent = erro instanceof ErroApi ? erro.message : 'Erro inesperado ao salvar. Tente de novo.';
    avisoErro.style.display = 'block';
  } finally {
    btnSalvar.disabled = false;
    btnSalvar.textContent = idEmEdicao ? 'Salvar edição' : 'Salvar viagem';
  }
});

// --- Resumo do dia ---------------------------------------------------------
async function carregarResumoEViagens() {
  const dia = campoData.value;
  try {
    const resumo = await chamarApi(`/api/resumo-dia?data=${dia}`);
    document.getElementById('resumo-total-viagens').textContent = resumo.total_viagens;
    document.getElementById('resumo-motoristas').textContent = resumo.motoristas_distintos;

    const elUltima = document.getElementById('resumo-ultima-viagem');
    const u = resumo.ultima_viagem;
    if (u && (u.caminhao || u.escavadeira)) {
      const horario = u.registrado_em
        ? new Date(u.registrado_em).toLocaleTimeString('pt-BR', { timeZone: FUSO_HORARIO, hour: '2-digit', minute: '2-digit', hour12: false })
        : '—';
      const partes = [];
      if (u.escavadeira) partes.push(`${u.escavadeira} carregou`);
      if (u.caminhao) partes.push(u.caminhao);
      elUltima.textContent = `Última viagem: ${partes.join(' ')} às ${horario}`;
      elUltima.style.display = '';
    } else {
      elUltima.style.display = 'none';
    }
  } catch (erro) {
    console.warn('Não foi possível atualizar o resumo agora:', erro.message);
  }
}

campoData.addEventListener('change', carregarResumoEViagens);

// --- Histórico com filtros + paginação -------------------------------------
const corpoTabela = document.getElementById('tabela-viagens-corpo');
const linhaCarregarMais = document.getElementById('linha-carregar-mais');
const btnCarregarMais = document.getElementById('btn-carregar-mais');
const filtroInicio = document.getElementById('filtro-inicio');
const filtroFim = document.getElementById('filtro-fim');

function periodoPadraoHistorico() {
  const hoje = new Date();
  const trintaDiasAtras = new Date(hoje);
  trintaDiasAtras.setDate(hoje.getDate() - 30);
  const paraISO = (d) => d.toISOString().slice(0, 10);
  return { inicio: paraISO(trintaDiasAtras), fim: paraISO(hoje) };
}
const padrao = periodoPadraoHistorico();
filtroInicio.value = padrao.inicio;
filtroFim.value = padrao.fim;

// Fuso fixo (mesmo critério do relatório em Excel): o horário mostrado
// aqui é o `registrado_em` — a hora capturada NO APARELHO do motorista no
// momento do lançamento, não a hora em que sincronizou. Fixamos o fuso
// pra não depender do relógio/fuso configurado no navegador de quem está
// olhando o histórico.
const FUSO_HORARIO = 'America/Sao_Paulo';
function formatarHorario(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString('pt-BR', {
    timeZone: FUSO_HORARIO,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function linhaHtml(v) {
  const botoes = [];
  if (ehAdminEstrito) {
    botoes.push(`<button type="button" class="btn btn-pequeno btn-secundario" data-editar="${v.id}">Editar</button>`);
    botoes.push(`<button type="button" class="btn btn-pequeno btn-perigo" data-excluir="${v.id}">Excluir</button>`);
  }
  return `
    <tr>
      <td>${v.data}</td>
      <td>${formatarHorario(v.registrado_em)}</td>
      <td>${v.ordem}</td>
      <td>${v.caminhao?.codigo || '—'}</td>
      <td>${v.destino?.codigo || '—'}</td>
      <td>${v.total_viagens}</td>
      <td>${v.motorista?.nome || '—'}</td>
      <td style="white-space:nowrap;">${botoes.join(' ')}</td>
    </tr>`;
}

let viagensCarregadas = [];

// No boot da tela, mais de uma coisa chama carregarHistorico(true) em
// paralelo (depois de carregar os cadastros, e depois de tentar
// sincronizar a fila offline) — sem essa trava, as duas respostas podem
// voltar entrelaçadas e duplicar as linhas na tabela (uma reinicia depois
// que a outra já tinha inserido). O "token" garante que só a chamada mais
// recente tem permissão de escrever na tabela; uma resposta atrasada de
// uma chamada antiga é simplesmente descartada.
let tokenHistorico = 0;

async function carregarHistorico(reiniciar) {
  if (reiniciar) {
    offsetHistorico = 0;
    viagensCarregadas = [];
    corpoTabela.innerHTML = '';
  }
  const tokenDestaChamada = ++tokenHistorico;

  const params = new URLSearchParams({
    inicio: filtroInicio.value,
    fim: filtroFim.value,
    offset: String(offsetHistorico),
  });
  if (ehGerente) {
    const cId = filtroCaminhao?.obterValor();
    const mId = filtroMotorista?.obterValor();
    const dId = filtroDestino?.obterValor();
    if (cId) params.set('caminhao_id', cId);
    if (mId) params.set('motorista_id', mId);
    if (dId) params.set('destino_id', dId);
  }

  try {
    const resultado = await chamarApi(`/api/viagens?${params.toString()}`);
    if (tokenDestaChamada !== tokenHistorico) return; // uma chamada mais nova já assumiu — descarta essa resposta atrasada

    viagensCarregadas = viagensCarregadas.concat(resultado.itens);
    corpoTabela.insertAdjacentHTML('beforeend', resultado.itens.map(linhaHtml).join(''));
    offsetHistorico += resultado.itens.length;
    linhaCarregarMais.style.display = resultado.tem_mais ? '' : 'none';

    if (ehAdminEstrito) ligarBotoesLinha();
  } catch (erro) {
    console.warn('Não foi possível carregar o histórico agora:', erro.message);
  }
}

function ligarBotoesLinha() {
  corpoTabela.querySelectorAll('button[data-editar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const viagem = viagensCarregadas.find((v) => v.id === btn.dataset.editar);
      if (viagem) entrarModoEdicao(viagem);
    });
  });
  corpoTabela.querySelectorAll('button[data-excluir]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta viagem?')) return;
      try {
        await chamarApi(`/api/viagens?id=${btn.dataset.excluir}`, { metodo: 'DELETE' });
        await carregarResumoEViagens();
        await carregarHistorico(true);
      } catch (erro) {
        alert(erro.message || 'Erro ao excluir.');
      }
    });
  });
}

btnCarregarMais.addEventListener('click', () => carregarHistorico(false));
filtroInicio.addEventListener('change', () => carregarHistorico(true));
filtroFim.addEventListener('change', () => carregarHistorico(true));
document.getElementById('btn-limpar-filtros').addEventListener('click', () => {
  const padrao = periodoPadraoHistorico();
  filtroInicio.value = padrao.inicio;
  filtroFim.value = padrao.fim;
  [filtroCaminhao, filtroMotorista, filtroDestino].forEach((f) => f?.definirValor(''));
  carregarHistorico(true);
});

// --- Aviso de pendentes ----------------------------------------------------
function atualizarAvisoPendentes(fila) {
  const aviso = document.getElementById('aviso-pendentes');
  if (fila.length === 0) {
    aviso.style.display = 'none';
    return;
  }
  aviso.style.display = 'block';
  aviso.textContent = `${fila.length} viagem(ns) aguardando internet para sincronizar.`;
}
aoMudarFila(atualizarAvisoPendentes);

// --- Reagir quando a internet volta ----------------------------------------
// O aviso "Sem internet agora — usando os cadastros salvos..." só some
// quando os cadastros são buscados de novo com sucesso — sem isso, ficava
// preso na tela mesmo depois da conexão voltar, porque nada disparava uma
// nova tentativa sozinho.
function aoReconectar() {
  carregarCadastros();
  carregarResumoEViagens();
  tentarSincronizarFila().then(() => {
    carregarResumoEViagens();
    carregarHistorico(true);
  });
}
window.addEventListener('online', aoReconectar);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine) aoReconectar();
});

// --- Boot -------------------------------------------------------------
carregarCadastros().then(() => carregarHistorico(true));
carregarResumoEViagens();
tentarSincronizarFila().then(() => {
  carregarResumoEViagens();
  carregarHistorico(true);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
