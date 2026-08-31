// Monta o cabeçalho/navegação padrão de todas as telas logadas.
// Cada página chama montarCabecalho('id-da-pagina-ativa') dentro de um
// <div id="cabecalho-app"></div> no topo do <body>.
import { obterSessao, sair } from '../src/auth.js';
import { obterPendentes, aoMudarFila, tentarSincronizarFila } from '../src/fila.js';
import { obterUltimaSincronizacao, formatarTempoDecorrido, aoSincronizar } from '../src/statusSincronizacao.js';
import { atualizarAppCompleto } from '../src/atualizarApp.js';

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
  // Botão de atualizar dados: só quem realmente usa o sistema pra trabalhar
  // (Admin e Operador Avançado) — motorista raramente loga, e quando loga
  // só vê a própria viagem, sem necessidade desse atalho.
  const podeAtualizarDados = papel === 'admin' || papel === 'operador_avancado';

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
              `<a href="${l.href}" class="${l.id === paginaAtiva ? 'ativo' : ''}">${l.label}</a>${
                l.id === 'viagens' && podeAtualizarDados
                  ? `<button type="button" id="btn-atualizar-dados" class="btn-atualizar-app" title="Buscar a versão mais recente do app (use se algo parecer desatualizado)">⟳ Atualizar app</button>`
                  : ''
              }`
          )
          .join('')}
        <button type="button" id="btn-sincronizar-agora" style="display:none;" title="Opcional — o app já tenta sincronizar sozinho assim que há internet. Use isso só pra forçar agora."><span id="lbl-sincronizar">Sincronizar</span> (<span id="qtd-pendentes">0</span>)</button>
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
    try {
      // forcar:true — toque manual ignora o limite de tentativas
      // automáticas (ver fila.js), então um item "travado" há muito tempo
      // tenta de novo.
      await tentarSincronizarFila({ forcar: true });
    } catch (erro) {
      // Sem o try/catch aqui, qualquer erro inesperado dentro da
      // sincronização (ex: falha ao salvar a fila atualizada no aparelho)
      // deixava o botão preso em "Sincronizando…" pra sempre, mesmo que os
      // itens já tivessem sido enviados com sucesso ao servidor.
      console.warn('Erro ao sincronizar manualmente:', erro?.message);
    } finally {
      btnSincronizar.disabled = false;
      lblSincronizar.textContent = 'Sincronizar';
    }
  });
  // estado inicial (a página específica também chama iniciarSincronizacaoAutomatica())
  qtdPendentesEl.textContent = obterPendentes().length;
  btnSincronizar.style.display = obterPendentes().length > 0 ? '' : 'none';

  // --- Botão "Atualizar app" (Admin/Operador) — força buscar a versão nova -
  // Desregistra o service worker + apaga o cache do "shell" e recarrega a
  // página, garantindo que o app pegue qualquer alteração publicada (em vez
  // de continuar mostrando uma versão antiga guardada em cache). Só funciona
  // com internet — se estiver offline, cancela pra não deixar o app "sem
  // shell" até a conexão voltar.
  const btnAtualizar = document.getElementById('btn-atualizar-dados');
  if (btnAtualizar) {
    btnAtualizar.addEventListener('click', async () => {
      if (!navigator.onLine) {
        alert('Sem conexão com a internet no momento. Conecte-se e tente de novo — atualizar o app offline deixaria ele sem funcionar até a internet voltar.');
        return;
      }
      const confirmou = confirm(
        'Isso vai recarregar o app pra buscar a versão mais recente publicada.\n\n' +
        'Se você estiver preenchendo um cadastro (caminhão, escavadeira, local, destino ou usuário), esse formulário será perdido — salve antes de continuar.\n' +
        '(Rascunhos de "Nova viagem" ficam salvos automaticamente e não são perdidos.)\n\n' +
        'Continuar?'
      );
      if (!confirmou) return;
      // Reconfirma a conexão AQUI: o confirm() acima é uma caixa bloqueante
      // e a pessoa pode demorar pra responder — se a conexão caiu enquanto
      // a caixa estava aberta, a checagem lá em cima já não vale mais.
      if (!navigator.onLine) {
        alert('A conexão com a internet caiu enquanto a confirmação estava aberta. Tente de novo quando estiver online.');
        return;
      }
      btnAtualizar.disabled = true;
      btnAtualizar.textContent = '⟳ Atualizando app…';
      await atualizarAppCompleto();
    });
  }
}
