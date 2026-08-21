// Monta o cabeçalho/navegação padrão de todas as telas logadas.
// Cada página chama montarCabecalho('id-da-pagina-ativa') dentro de um
// <div id="cabecalho-app"></div> no topo do <body>.
import { obterSessao, sair } from '../src/auth.js';

export function montarCabecalho(paginaAtiva) {
  const alvo = document.getElementById('cabecalho-app');
  if (!alvo) return;

  const sessao = obterSessao();
  const isAdmin = sessao?.usuario?.role === 'admin';

  const links = [{ id: 'viagens', href: 'app.html', label: 'Viagens' }];
  if (isAdmin) {
    links.push({ id: 'cadastros', href: 'cadastros.html', label: 'Cadastros' });
    links.push({ id: 'relatorios', href: 'relatorios.html', label: 'Relatórios' });
  }

  alvo.innerHTML = `
    <header class="app-header">
      <div>
        <h1>LR Controle de Viagens</h1>
        <div class="subtitulo">${sessao?.usuario?.nome || ''} · ${isAdmin ? 'Administrador' : 'Motorista'}</div>
      </div>
      <nav>
        ${links
          .map(
            (l) =>
              `<a href="${l.href}" class="${l.id === paginaAtiva ? 'ativo' : ''}">${l.label}</a>`
          )
          .join('')}
        <button type="button" id="btn-sair">Sair</button>
      </nav>
    </header>
  `;

  document.getElementById('btn-sair').addEventListener('click', () => {
    if (confirm('Sair do sistema? Você precisará entrar com e-mail e senha de novo.')) {
      sair();
    }
  });
}
