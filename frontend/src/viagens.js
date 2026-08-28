import { exigirLogin, obterSessao } from './auth.js';
import { montarCabecalho } from '../layout/cabecalho.js';
import { chamarApi, ErroApi } from './api.js';
import { atualizarCadastros, obterCacheLocal } from './cadastrosCache.js';
import { criarCombobox } from './combobox.js';
import { salvarViagem, novoClientUuid, aoMudarFila, iniciarSincronizacaoAutomatica, tentarSincronizarFila } from './fila.js';
import { salvarRascunho, obterRascunho, limparRascunho, rascunhoTemConteudo } from './rascunhoViagem.js';
import { escaparHtml } from './util.js';

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

// Guarda a versão mais recente dos cadastros, atualizada tanto no primeiro
// montarCombos() quanto em toda atualizarOpcoesDosCombos() seguinte — sem
// isso, funções que fecham sobre "cache" (como o auto-preenchimento do
// motorista abaixo) ficavam presas pra sempre nos dados do primeiro
// carregamento, já que a partir da segunda atualização só as OPÇÕES visíveis
// eram trocadas (definirOpcoes), não essas closures.
let cacheAtual = {};

function montarCombos(cache) {
  cacheAtual = cache;
  comboCaminhao = criarCombobox({
    container: document.getElementById('campo-caminhao'),
    rotulo: 'Caminhão',
    obrigatorio: true,
    opcoes: opcoesDe(cache.caminhoes, (c) => c.codigo),
    inputmode: 'numeric', // motorista geralmente busca pelo número do caminhão
    // Quem escolhe o motorista livremente (admin ou operador) ganha esse
    // atalho: escolher um caminhão que já tem vínculo pré-preenche o
    // Motorista (continua editável — útil pra trocar quando o motorista
    // fixo daquele caminhão faltou e outro assumiu naquele dia). Lê de
    // cacheAtual (não do "cache" fechado aqui) pra sempre usar o vínculo
    // mais recente, mesmo depois de várias atualizações em segundo plano.
    aoSelecionar: (caminhaoId) => {
      if (podeEscolherLivre) {
        const caminhao = (cacheAtual.caminhoes || []).find((c) => c.id === caminhaoId);
        if (caminhao?.motorista_id) comboMotorista.definirValor(caminhao.motorista_id);
      }
      agendarSalvarRascunho();
    },
  });
  comboEscavadeira = criarCombobox({
    container: document.getElementById('campo-escavadeira'),
    rotulo: 'Escavadeira (opcional)',
    opcoes: opcoesDe(cache.escavadeiras, (e) => e.codigo),
    aoSelecionar: agendarSalvarRascunho,
  });
  comboLocal = criarCombobox({
    container: document.getElementById('campo-local'),
    rotulo: 'Local de carga/corte (opcional)',
    opcoes: opcoesDe(cache.locais_carga, (l) => l.nome),
    aoSelecionar: agendarSalvarRascunho,
  });
  comboDestino = criarCombobox({
    container: document.getElementById('campo-destino'),
    rotulo: 'Destino',
    obrigatorio: true,
    opcoes: opcoesDe(cache.destinos, (d) => (d.descricao ? `${d.codigo} — ${d.descricao}` : d.codigo)),
    aoSelecionar: agendarSalvarRascunho,
  });
  comboMotorista = criarCombobox({
    container: document.getElementById('campo-motorista'),
    rotulo: 'Motorista',
    obrigatorio: true,
    opcoes: opcoesDe(cache.motoristas, (m) => m.nome),
    aoSelecionar: agendarSalvarRascunho,
  });

  if (!podeEscolherLivre) {
    // Só cai aqui um login com cargo "motorista" de verdade (raro na
    // prática) — trava no próprio nome, como antes. O vínculo com o
    // caminhão é tratado à parte, em atualizarVinculoMotoristaTravado()
    // (chamada logo abaixo e de novo a cada atualização de cadastros, pra
    // não ficar preso ao vínculo que existia só no primeiro carregamento).
    comboMotorista.definirValor(sessao.usuario.id);
    const inputMotorista = document.querySelector('#campo-motorista .cb-input');
    if (inputMotorista) {
      inputMotorista.disabled = true;
      inputMotorista.style.background = '#f0f1f3';
    }
    atualizarVinculoMotoristaTravado(cache);
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

// --- Rascunho da "Nova viagem" ---------------------------------------------
// Guarda o que já foi preenchido no aparelho pra não perder nada se o app
// for minimizado ou fechado no meio do lançamento. Não se aplica enquanto
// está editando uma viagem já existente (isso tem fluxo próprio).
function capturarEstadoFormulario() {
  return {
    data: campoData.value,
    caminhao_id: comboCaminhao?.obterValor() || null,
    escavadeira_id: comboEscavadeira?.obterValor() || null,
    local_carga_id: comboLocal?.obterValor() || null,
    destino_id: comboDestino?.obterValor() || null,
    motorista_id: comboMotorista?.obterValor() || null,
    total_viagens: document.getElementById('campo-total-viagens')?.value,
  };
}

function salvarRascunhoAgora() {
  if (idEmEdicao) return;
  const estado = capturarEstadoFormulario();
  if (rascunhoTemConteudo(estado)) salvarRascunho(estado);
  else limparRascunho();
}

let timerRascunho = null;
function agendarSalvarRascunho() {
  if (idEmEdicao) return;
  clearTimeout(timerRascunho);
  timerRascunho = setTimeout(salvarRascunhoAgora, 500);
}

// Reaplica um estado capturado por capturarEstadoFormulario() nos campos
// atuais — usado tanto pra restaurar o rascunho salvo (localStorage) quanto
// pra recolocar o que já estava sendo preenchido antes de um remonte dos
// comboboxes (ver carregarCadastros logo abaixo).
function aplicarEstadoAoFormulario(estado) {
  if (!estado) return;
  if (estado.data) campoData.value = estado.data;
  // Campos travados (login de motorista de verdade, raro) não são
  // sobrescritos — o vínculo automático continua valendo.
  if (podeEscolherLivre) {
    if (estado.caminhao_id) comboCaminhao.definirValor(estado.caminhao_id);
    if (estado.motorista_id) comboMotorista.definirValor(estado.motorista_id);
  }
  if (estado.escavadeira_id) comboEscavadeira.definirValor(estado.escavadeira_id);
  if (estado.local_carga_id) comboLocal.definirValor(estado.local_carga_id);
  if (estado.destino_id) comboDestino.definirValor(estado.destino_id);
  if (estado.total_viagens && ehGerente) {
    document.getElementById('campo-total-viagens').value = estado.total_viagens;
  }
}

function restaurarRascunhoSeExistir() {
  const rascunho = obterRascunho();
  if (!rascunhoTemConteudo(rascunho)) return;

  aplicarEstadoAoFormulario(rascunho);

  const avisoRascunho = document.getElementById('aviso-rascunho');
  if (avisoRascunho) avisoRascunho.style.display = 'block';
}

// montarCombos() recria os comboboxes do zero (innerHTML + closures novas):
// isso apagava tudo que o usuário já tinha escolhido/digitado (inclusive os
// filtros do histórico, e até texto ainda sendo digitado sem ter sido
// confirmado) toda vez que os cadastros eram atualizados em segundo plano
// (ex: ao reconectar). Por isso só montamos do zero na PRIMEIRA vez — nas
// atualizações seguintes, só trocamos a lista de opções de cada combobox já
// existente (definirOpcoes), sem tocar no que o usuário já tinha
// selecionado, digitado ou no foco atual.
let combosProntos = false;

function atualizarOpcoesDosCombos(cache) {
  cacheAtual = cache;
  comboCaminhao.definirOpcoes(opcoesDe(cache.caminhoes, (c) => c.codigo));
  comboEscavadeira.definirOpcoes(opcoesDe(cache.escavadeiras, (e) => e.codigo));
  comboLocal.definirOpcoes(opcoesDe(cache.locais_carga, (l) => l.nome));
  comboDestino.definirOpcoes(opcoesDe(cache.destinos, (d) => (d.descricao ? `${d.codigo} — ${d.descricao}` : d.codigo)));
  comboMotorista.definirOpcoes(opcoesDe(cache.motoristas, (m) => m.nome));

  if (ehGerente) {
    filtroCaminhao?.definirOpcoes([{ id: '', texto: 'Todos' }, ...opcoesDe(cache.caminhoes, (c) => c.codigo)]);
    filtroMotorista?.definirOpcoes([{ id: '', texto: 'Todos' }, ...opcoesDe(cache.motoristas, (m) => m.nome)]);
    filtroDestino?.definirOpcoes([{ id: '', texto: 'Todos' }, ...opcoesDe(cache.destinos, (d) => d.codigo)]);
  }

  if (!podeEscolherLivre) atualizarVinculoMotoristaTravado(cache);
}

// Motorista comum (login raro, na prática): reflete na tela o caminhão
// vinculado a ele em Cadastros → Caminhões — pré-preenche e trava o campo, ou
// mostra o aviso de "sem vínculo". Chamada tanto no primeiro carregamento
// quanto em toda atualização de cadastros em segundo plano, pra um vínculo
// criado/alterado DEPOIS que o app já estava aberto não ficar escondido até
// a pessoa recarregar a página manualmente.
function atualizarVinculoMotoristaTravado(cache) {
  const caminhaoVinculado = (cache.caminhoes || []).find((c) => c.motorista_id === sessao.usuario.id);
  caminhaoVinculadoId = caminhaoVinculado?.id || null;
  const avisoSemVinculo = document.getElementById('aviso-sem-caminhao-vinculado');
  const inputCaminhao = document.querySelector('#campo-caminhao .cb-input');

  // Não mexe no campo enquanto a pessoa está com o foco nele (digitando/
  // escolhendo uma opção na hora) — só reposiciona/destrava/limpa quando o
  // campo não é o alvo da interação atual, senão uma atualização em segundo
  // plano (reconectar, por exemplo) podia apagar o que estava sendo digitado
  // debaixo do dedo da pessoa.
  const campoEmUso = inputCaminhao && document.activeElement === inputCaminhao;

  if (caminhaoVinculado) {
    // Só reposiciona o valor se ainda não estiver certo — evita atrapalhar
    // se por acaso a pessoa já estava com o formulário em outro estado no
    // meio de uma edição.
    if (!campoEmUso && comboCaminhao.obterValor() !== caminhaoVinculado.id && !idEmEdicao) {
      comboCaminhao.definirValor(caminhaoVinculado.id);
    }
    if (inputCaminhao) {
      inputCaminhao.disabled = true;
      inputCaminhao.style.background = '#f0f1f3';
    }
    if (avisoSemVinculo) avisoSemVinculo.style.display = 'none';
  } else {
    // O vínculo sumiu (admin desvinculou) — o valor antigo não é mais
    // válido; sem limpar, o campo ficava destravado mas ainda mostrando (e
    // pronto pra enviar) o caminhão que não é mais dele, contradizendo o
    // próprio aviso de "sem vínculo" que aparece ao lado.
    if (!campoEmUso && !idEmEdicao) comboCaminhao.limpar();
    if (inputCaminhao) {
      inputCaminhao.disabled = false;
      inputCaminhao.style.background = '';
    }
    if (avisoSemVinculo) avisoSemVinculo.style.display = 'block';
  }
}

async function carregarCadastros() {
  const cacheLocalAntes = obterCacheLocal();
  if (!combosProntos && Object.keys(cacheLocalAntes).length) {
    montarCombos(cacheLocalAntes);
    combosProntos = true;
  }

  const { cache, atualizadoTotalmente } = await atualizarCadastros();
  if (combosProntos) {
    atualizarOpcoesDosCombos(cache);
  } else {
    montarCombos(cache);
    combosProntos = true;
  }

  document.getElementById('aviso-cadastro-offline').style.display = atualizadoTotalmente ? 'none' : 'block';
}

// --- Modo edição ---------------------------------------------------------
const tituloForm = document.getElementById('titulo-form');
const btnCancelarEdicao = document.getElementById('btn-cancelar-edicao');
const campoOrdemWrap = document.getElementById('campo-ordem-wrap');
const campoOrdem = document.getElementById('campo-ordem');

function entrarModoEdicao(viagem) {
  idEmEdicao = viagem.id;
  // Editar troca o conteúdo do formulário pra outra coisa — some com o
  // aviso de rascunho recuperado, se estava aparecendo (o rascunho em si
  // continua guardado, só volta a aparecer quando sair da edição sem salvar).
  const avisoRascunho = document.getElementById('aviso-rascunho');
  if (avisoRascunho) avisoRascunho.style.display = 'none';
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

// Campos de texto/data digitados diretamente (as seleções em combobox já
// chamam agendarSalvarRascunho no próprio aoSelecionar, lá em montarCombos).
form.addEventListener('input', agendarSalvarRascunho);

// Minimizar o app (ou trocar de aba) não dispara "beforeunload" no
// celular — "visibilitychange" pra oculto é o sinal certo de que o app
// pode estar prestes a ser fechado de verdade, sem esperar o debounce.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') salvarRascunhoAgora();
});
window.addEventListener('pagehide', salvarRascunhoAgora);

const btnDescartarRascunho = document.getElementById('btn-descartar-rascunho');
if (btnDescartarRascunho) {
  btnDescartarRascunho.addEventListener('click', () => {
    limparRascunho();
    sairModoEdicao();
    document.getElementById('aviso-rascunho').style.display = 'none';
  });
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  // Guarda contra toque duplo/Enter repetido: sem isso, dois "submit" quase
  // simultâneos abriam duas caixas de confirmação empilhadas uma sobre a
  // outra (cada uma com seu próprio ouvinte no mesmo botão "OK"), e um
  // único toque em "OK" confirmava as duas — gravando a viagem 2x.
  if (btnSalvar.disabled) return;
  avisoErro.style.display = 'none';
  avisoSucesso.style.display = 'none';

  const caminhao_id = comboCaminhao.obterValor();
  const destino_id = comboDestino.obterValor();
  const motorista_id = comboMotorista.obterValor();
  // Número(''), diferente de Número('0'), é NaN — então "|| 1" só cobria o
  // campo vazio; digitar exatamente "0" passava direto e gravava uma
  // viagem com total zero, sem aviso nenhum.
  const totalViagensBruto = document.getElementById('campo-total-viagens').value;
  const totalViagens = totalViagensBruto === '' ? 1 : Number(totalViagensBruto);

  if (!caminhao_id || !destino_id || !motorista_id) {
    avisoErro.textContent = 'Preencha caminhão, destino e motorista.';
    avisoErro.style.display = 'block';
    return;
  }
  if (!Number.isFinite(totalViagens) || !Number.isInteger(totalViagens) || totalViagens < 1) {
    avisoErro.textContent = 'Total de viagens precisa ser um número inteiro maior que zero.';
    avisoErro.style.display = 'block';
    return;
  }

  const textoCaminhao = document.querySelector('#campo-caminhao .cb-input').value;
  const textoDestino = document.querySelector('#campo-destino .cb-input').value;
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

  // Desabilita ANTES de abrir a confirmação (não só depois que ela resolve)
  // — é isso que impede um segundo toque/Enter de abrir uma segunda caixa
  // de confirmação enquanto a primeira ainda está na tela. O try/finally
  // engloba a confirmação também (não só o envio): se pedirConfirmacao()
  // algum dia lançar uma exceção inesperada, o botão ainda assim volta a
  // ficar habilitado no finally, em vez de travado pra sempre até recarregar
  // a página.
  btnSalvar.disabled = true;

  try {
    const confirmou = await pedirConfirmacao(linhasConfirmacao);
    if (!confirmou) return;

    btnSalvar.textContent = idEmEdicao ? 'Salvando edição…' : 'Salvando…';

    if (idEmEdicao) {
      await chamarApi('/api/viagens', {
        metodo: 'PUT',
        corpo: {
          id: idEmEdicao,
          data: campoData.value,
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
      limparRascunho();
      document.getElementById('aviso-rascunho').style.display = 'none';
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
      limparRascunho();
      document.getElementById('aviso-rascunho').style.display = 'none';
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
  // Precisa ser data LOCAL, igual dataDeHojeLocal() usada no campo de nova
  // viagem — toISOString() converte pra UTC, que já virou o dia seguinte
  // depois das ~21h em horário de Brasília (UTC-3). Sem isso, abrir a tela
  // à noite mostrava o filtro "até" um dia à frente da data de hoje que
  // aparece no formulário de lançamento, na mesma tela.
  const hoje = new Date();
  const trintaDiasAtras = new Date(hoje);
  trintaDiasAtras.setDate(hoje.getDate() - 30);
  const paraISOLocal = (d) => {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  };
  return { inicio: paraISOLocal(trintaDiasAtras), fim: paraISOLocal(hoje) };
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
  // codigo/nome vêm de cadastros — texto livre digitado por um admin, sem
  // restrição de caractere — por isso passam por escaparHtml antes de ir
  // pro innerHTML da tabela (evita um cadastro com HTML dentro do nome
  // executar na tela de quem estiver vendo o histórico).
  return `
    <tr>
      <td>${v.data}</td>
      <td>${formatarHorario(v.registrado_em)}</td>
      <td>${v.ordem}</td>
      <td>${escaparHtml(v.caminhao?.codigo) || '—'}</td>
      <td>${escaparHtml(v.destino?.codigo) || '—'}</td>
      <td>${v.total_viagens}</td>
      <td>${escaparHtml(v.motorista?.nome) || '—'}</td>
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

// --- Botão "Atualizar" do cabeçalho ---------------------------------------
// Recarrega cadastros (caminhão/motorista/destino podem ter mudado),
// resumo do dia, histórico e tenta sincronizar qualquer pendente — tudo
// que essa tela mostra.
// --- Boot -------------------------------------------------------------
carregarCadastros().then(() => {
  carregarHistorico(true);
  restaurarRascunhoSeExistir();
});
carregarResumoEViagens();
tentarSincronizarFila().then(() => {
  carregarResumoEViagens();
  carregarHistorico(true);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
