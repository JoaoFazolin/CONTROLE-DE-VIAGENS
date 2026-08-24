import { exigirLogin, obterSessao } from './auth.js';
import { montarCabecalho } from '../layout/cabecalho.js';
import { chamarApi, ErroApi } from './api.js';
import { atualizarCadastros, obterCacheLocal } from './cadastrosCache.js';
import { criarCombobox } from './combobox.js';
import { salvarViagem, novoClientUuid, aoMudarFila, iniciarSincronizacaoAutomatica, tentarSincronizarFila } from './fila.js';

if (!exigirLogin()) throw new Error('redirecionando para login');

montarCabecalho('viagens');
iniciarSincronizacaoAutomatica();

const sessao = obterSessao();
// "Gerente" = admin ou operador_avancado: pode lançar viagem por qualquer
// motorista e ver o histórico completo. Editar/excluir uma viagem já
// lançada continua exclusivo do admin (ehAdminEstrito), igual ao sistema
// de combustível.
const ehGerente = sessao.usuario.role === 'admin' || sessao.usuario.role === 'operador_avancado';
const ehAdminEstrito = sessao.usuario.role === 'admin';

const campoData = document.getElementById('campo-data');
campoData.value = dataDeHojeLocal();

let comboCaminhao, comboEscavadeira, comboLocal, comboDestino, comboMotorista;
let filtroCaminhao, filtroMotorista, filtroDestino;
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
  });
  comboEscavadeira = criarCombobox({
    container: document.getElementById('campo-escavadeira'),
    rotulo: 'Escavadeira (opcional)',
    opcoes: opcoesDe(cache.escavadeiras, (e) => e.codigo),
  });
  comboLocal = criarCombobox({
    container: document.getElementById('campo-local'),
    rotulo: 'Local da carga (opcional)',
    opcoes: opcoesDe(cache.locais_carga, (l) => l.nome),
  });
  comboDestino = criarCombobox({
    container: document.getElementById('campo-destino'),
    rotulo: 'Destino',
    obrigatorio: true,
    opcoes: opcoesDe(cache.destinos, (d) => (d.descricao ? `${d.codigo} — ${d.descricao}` : d.codigo)),
  });
  comboMotorista = criarCombobox({
    container: document.getElementById('campo-motorista'),
    rotulo: 'Motorista',
    obrigatorio: true,
    opcoes: opcoesDe(cache.motoristas, (m) => m.nome),
  });

  if (!ehGerente) {
    comboMotorista.definirValor(sessao.usuario.id);
    const inputMotorista = document.querySelector('#campo-motorista .cb-input');
    if (inputMotorista) {
      inputMotorista.disabled = true;
      inputMotorista.style.background = '#f0f1f3';
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
  document.getElementById('campo-diesel').value = viagem.diesel_litros || '';
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
  comboCaminhao.limpar();
  comboEscavadeira.limpar();
  comboLocal.limpar();
  comboDestino.limpar();
  if (ehGerente) comboMotorista.limpar();
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
  const dieselValor = document.getElementById('campo-diesel').value;

  if (!caminhao_id || !destino_id || !motorista_id) {
    avisoErro.textContent = 'Preencha caminhão, destino e motorista.';
    avisoErro.style.display = 'block';
    return;
  }

  const textoCaminhao = document.querySelector('#campo-caminhao .cb-input').value;
  const textoDestino = document.querySelector('#campo-destino .cb-input').value;
  const textoMotorista = document.querySelector('#campo-motorista .cb-input').value;

  const linhasConfirmacao = [
    { rotulo: 'Data', valor: campoData.value },
    { rotulo: 'Caminhão', valor: textoCaminhao },
    { rotulo: 'Destino', valor: textoDestino },
    { rotulo: 'Total de viagens', valor: totalViagens },
    { rotulo: 'Diesel (L)', valor: dieselValor || '—' },
    { rotulo: 'Motorista', valor: textoMotorista },
  ];
  if (idEmEdicao) linhasConfirmacao.splice(1, 0, { rotulo: 'Ordem', valor: campoOrdem.value });

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
          diesel_litros: dieselValor ? Number(dieselValor) : null,
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
        diesel_litros: dieselValor ? Number(dieselValor) : null,
        motorista_id,
        registrado_em: new Date().toISOString(), // hora capturada NO APARELHO, agora
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
    document.getElementById('resumo-diesel').textContent = resumo.total_diesel_litros;
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

function linhaHtml(v) {
  const botoes = [];
  if (ehAdminEstrito) {
    botoes.push(`<button type="button" class="btn btn-pequeno btn-secundario" data-editar="${v.id}">Editar</button>`);
    botoes.push(`<button type="button" class="btn btn-pequeno btn-perigo" data-excluir="${v.id}">Excluir</button>`);
  }
  return `
    <tr>
      <td>${v.data}</td>
      <td>${v.ordem}</td>
      <td>${v.caminhao?.codigo || '—'}</td>
      <td>${v.destino?.codigo || '—'}</td>
      <td>${v.total_viagens}</td>
      <td>${v.motorista?.nome || '—'}</td>
      <td style="white-space:nowrap;">${botoes.join(' ')}</td>
    </tr>`;
}

let viagensCarregadas = [];

async function carregarHistorico(reiniciar) {
  if (reiniciar) {
    offsetHistorico = 0;
    viagensCarregadas = [];
    corpoTabela.innerHTML = '';
  }

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
