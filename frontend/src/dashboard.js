import { exigirLogin, obterSessao } from './auth.js';
import { montarCabecalho } from '../layout/cabecalho.js';
import { chamarApi, ErroApi } from './api.js';

if (!exigirLogin()) throw new Error('redirecionando para login');

const sessao = obterSessao();
const ehGerente = sessao.usuario.role === 'admin' || sessao.usuario.role === 'operador_avancado';
if (!ehGerente) {
  window.location.href = 'app.html';
}

montarCabecalho('dashboard');

const avisoErro = document.getElementById('aviso-erro');
function mostrarErro(erro) {
  avisoErro.textContent = erro instanceof ErroApi ? erro.message : 'Erro ao carregar o dashboard.';
  avisoErro.style.display = 'block';
}

const campoInicio = document.getElementById('campo-inicio');
const campoFim = document.getElementById('campo-fim');

const hoje = new Date();
const trintaDiasAtras = new Date(hoje);
trintaDiasAtras.setDate(hoje.getDate() - 30);
campoInicio.value = trintaDiasAtras.toISOString().slice(0, 10);
campoFim.value = hoje.toISOString().slice(0, 10);

function renderizarGrafico(containerId, itens, formatarRotulo) {
  const container = document.getElementById(containerId);
  if (!itens || itens.length === 0) {
    container.innerHTML = '<div class="grafico-vazio">Sem dados nesse período.</div>';
    return;
  }
  const maximo = Math.max(...itens.map((i) => i.valor), 1);
  container.innerHTML = itens
    .slice(0, 15)
    .map(
      (i) => `
      <div class="grafico-linha">
        <div class="grafico-rotulo" title="${formatarRotulo(i.chave)}">${formatarRotulo(i.chave)}</div>
        <div class="grafico-trilha"><div class="grafico-barra" style="width:${Math.max((i.valor / maximo) * 100, 4)}%"></div></div>
        <div class="grafico-valor">${i.valor}</div>
      </div>`
    )
    .join('');
}

function formatarDataCurta(iso) {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

async function carregarDashboard() {
  avisoErro.style.display = 'none';
  try {
    const dados = await chamarApi(`/api/dashboard?inicio=${campoInicio.value}&fim=${campoFim.value}`);

    document.getElementById('dash-total-viagens').textContent = dados.total_viagens;
    document.getElementById('dash-motoristas').textContent = dados.motoristas_distintos;
    document.getElementById('dash-diesel').textContent = dados.total_diesel_litros;

    renderizarGrafico('grafico-por-dia', dados.por_dia, formatarDataCurta);
    renderizarGrafico('grafico-por-caminhao', dados.por_caminhao, (c) => c);
    renderizarGrafico('grafico-por-destino', dados.por_destino, (c) => c);
  } catch (erro) {
    mostrarErro(erro);
  }
}

campoInicio.addEventListener('change', carregarDashboard);
campoFim.addEventListener('change', carregarDashboard);

carregarDashboard();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
