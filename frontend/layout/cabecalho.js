// Monta o cabeçalho/navegação padrão de todas as telas logadas.
// Cada página chama montarCabecalho('id-da-pagina-ativa') dentro de um
// <div id="cabecalho-app"></div> no topo do <body>.
import { obterSessao, sair } from '../src/auth.js';
import { obterPendentes, aoMudarFila, tentarSincronizarFila } from '../src/fila.js';
import { obterUltimaSincronizacao, formatarTempoDecorrido, aoSincronizar } from '../src/statusSincronizacao.js';

const RÓTULO_PAPEL = { admin: 'Administrador', operador_avancado: 'Operador Avançado', motorista: 'Motorista' };

export function montarCabecalho(paginaAtiva) {
  const alvo = document.getElementById('cabecalho-app');
  if (!alvo) return;

  const sessao = obterSessao();
  const papel = sessao?.usuario?.role || 'motorista';
  // Só admin (Operador Avançado passou a só lançar a própria viagem, sem
  // acesso a Cadastros/Relatórios/Dashboard — só a tela de Viagens fica
  // ativa pra ele, igual um motorista comum).
  const ehGerente = papel === 'admin';

  const links = [{ id: 'viagens', href: 'app.html', label: 'Viagens' }];
  if (ehGerente) {
    links.push({ id: 'cadastros', href: 'cadastros.html', label: 'Cadastros' });
    links.push({ id: 'relatorios', href: 'relatorios.html', label: 'Relatórios' });
    links.push({ id: 'dashboard', href: 'dashboard.html', label: 'Dashboard' });
  }

  alvo.innerHTML = `
    <header class="app-header">
      <div>
        <img src="icons/logo.png" alt="LR Campos" class="logo-lr" />
        <div class="subtitulo">${sessao?.usuario?.nome || ''} · ${RÓTULO_PAPEL[papel] || 'Motorista'}</div>
        <div class="status-conexao" id="status-conexao">
          <span class="ponto"></span>
          <span id="status-conexao-texto">Online</span>
        </div>
        <div class="status-sincronizacao" id="status-sincronizacao">Última sincronização: <span id="status-sincronizacao-texto">nunca</span></div>
      </div>
      <nav>
        ${links
          .map(
            (l) =>
              `<a href="${l.href}" class="${l.id === paginaAtiva ? 'ativo' : ''}">${l.label}</a>`
          )
          .join('')}
        <button type="button" id="btn-sincronizar-agora" style="display:none;"><span id="lbl-sincronizar">Sincronizar</span> (<span id="qtd-pendentes">0</span>)</button>
        <button type="button" id="btn-sair">Sair</button>
      </nav>
    </header>
  `;

  document.getElementById('btn-sair').addEventListener('click', () => {
    if (confirm('Sair do sistema? Você precisará entrar com e-mail e senha de novo.')) {
      sair();
    }
  });

  // --- Status online/offline, visível em qualquer tela --------------------
  const statusEl = document.getElementById('status-conexao');
  const statusTexto = document.getElementById('status-conexao-texto');
  function atualizarStatusConexao() {
    const online = navigator.onLine;
    statusEl.classList.toggle('offline', !online);
    statusTexto.textContent = online ? 'Online' : 'Offline';
  }
  window.addEventListener('online', atualizarStatusConexao);
  window.addEventListener('offline', atualizarStatusConexao);
  atualizarStatusConexao();

  // --- Indicador de "há quanto tempo sincronizou pela última vez" ---------
  const statusSincTexto = document.getElementById('status-sincronizacao-texto');
  function atualizarStatusSincronizacao() {
    statusSincTexto.textContent = formatarTempoDecorrido(obterUltimaSincronizacao());
  }
  atualizarStatusSincronizacao();
  setInterval(atualizarStatusSincronizacao, 30000);
  aoSincronizar(atualizarStatusSincronizacao);

  // --- Contador de pendentes + botão de sincronizar agora ------------------
  const btnSincronizar = document.getElementById('btn-sincronizar-agora');
  const qtdPendentesEl = document.getElementById('qtd-pendentes');
  aoMudarFila((fila) => {
    qtdPendentesEl.textContent = fila.length;
    btnSincronizar.style.display = fila.length > 0 ? '' : 'none';
  });
  const lblSincronizar = document.getElementById('lbl-sincronizar');
  btnSincronizar.addEventListener('click', async () => {
    btnSincronizar.disabled = true;
    lblSincronizar.textContent = 'Sincronizando…';
    await tentarSincronizarFila();
    btnSincronizar.disabled = false;
    lblSincronizar.textContent = 'Sincronizar';
  });
  // estado inicial (a página específica também chama iniciarSincronizacaoAutomatica())
  qtdPendentesEl.textContent = obterPendentes().length;
  btnSincronizar.style.display = obterPendentes().length > 0 ? '' : 'none';
}
