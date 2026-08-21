import { exigirLogin, obterSessao } from './auth.js';
import { montarCabecalho } from '../layout/cabecalho.js';
import { chamarApi, ErroApi } from './api.js';
import { atualizarCadastros, obterCacheLocal } from './cadastrosCache.js';
import { criarCombobox } from './combobox.js';
import { salvarViagem, novoClientUuid, obterPendentes, aoMudarFila, iniciarSincronizacaoAutomatica, tentarSincronizarFila } from './fila.js';

if (!exigirLogin()) throw new Error('redirecionando para login');

montarCabecalho('viagens');
iniciarSincronizacaoAutomatica();

const sessao = obterSessao();
const ehAdmin = sessao.usuario.role === 'admin';

const campoData = document.getElementById('campo-data');
campoData.value = dataDeHojeLocal();

let comboCaminhao, comboEscavadeira, comboLocal, comboDestino, comboMotorista;

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

  if (!ehAdmin) {
    comboMotorista.definirValor(sessao.usuario.id);
    const inputMotorista = document.querySelector('#campo-motorista .cb-input');
    if (inputMotorista) {
      inputMotorista.disabled = true;
      inputMotorista.style.background = '#f0f1f3';
    }
  }
}

async function carregarCadastros() {
  const cacheLocalAntes = obterCacheLocal();
  if (Object.keys(cacheLocalAntes).length) montarCombos(cacheLocalAntes);

  const { cache, atualizadoTotalmente } = await atualizarCadastros();
  montarCombos(cache);

  document.getElementById('aviso-cadastro-offline').style.display = atualizadoTotalmente ? 'none' : 'block';
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

  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando…';

  try {
    const resultado = await salvarViagem(payload);

    if (resultado.pendente) {
      avisoSucesso.textContent = 'Sem internet agora — viagem guardada no aparelho e será enviada automaticamente quando a conexão voltar.';
    } else {
      avisoSucesso.textContent = `Viagem #${resultado.item.ordem} salva com sucesso.`;
      await carregarResumoEViagens();
    }
    avisoSucesso.style.display = 'block';

    form.reset();
    campoData.value = dataDeHojeLocal();
    comboCaminhao.limpar();
    comboEscavadeira.limpar();
    comboLocal.limpar();
    comboDestino.limpar();
    if (ehAdmin) comboMotorista.limpar();
    document.getElementById('campo-total-viagens').value = 1;
  } catch (erro) {
    avisoErro.textContent = erro instanceof ErroApi ? erro.message : 'Erro inesperado ao salvar. Tente de novo.';
    avisoErro.style.display = 'block';
  } finally {
    btnSalvar.disabled = false;
    btnSalvar.textContent = 'Salvar viagem';
  }
});

// --- Resumo do dia + lista -----------------------------------------------
async function carregarResumoEViagens() {
  const dia = campoData.value;
  try {
    const [resumo, viagens] = await Promise.all([
      chamarApi(`/api/resumo-dia?data=${dia}`),
      chamarApi(`/api/viagens?data=${dia}`),
    ]);
    document.getElementById('resumo-total-viagens').textContent = resumo.total_viagens;
    document.getElementById('resumo-motoristas').textContent = resumo.motoristas_distintos;
    document.getElementById('resumo-diesel').textContent = resumo.total_diesel_litros;

    const corpo = document.getElementById('tabela-viagens-corpo');
    corpo.innerHTML = viagens.itens
      .map(
        (v) => `
        <tr>
          <td>${v.ordem}</td>
          <td>${v.caminhao?.codigo || '—'}</td>
          <td>${v.destino?.codigo || '—'}</td>
          <td>${v.total_viagens}</td>
          <td>${v.motorista?.nome || '—'}</td>
          <td>${ehAdmin ? `<button type="button" class="btn btn-pequeno btn-perigo" data-id="${v.id}">Excluir</button>` : ''}</td>
        </tr>`
      )
      .join('');

    corpo.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Excluir esta viagem?')) return;
        try {
          await chamarApi(`/api/viagens?id=${btn.dataset.id}`, { metodo: 'DELETE' });
          await carregarResumoEViagens();
        } catch (erro) {
          alert(erro.message || 'Erro ao excluir.');
        }
      });
    });
  } catch (erro) {
    // Sem rede: mantém o que já estava na tela; não é um erro pro motorista.
    console.warn('Não foi possível atualizar resumo/lista agora:', erro.message);
  }
}

campoData.addEventListener('change', carregarResumoEViagens);

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
carregarCadastros();
carregarResumoEViagens();
tentarSincronizarFila().then(carregarResumoEViagens);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
