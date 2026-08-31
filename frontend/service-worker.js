// Service Worker do PWA — cacheia o "shell" do app (HTML/CSS/JS/ícones) para
// abrir mesmo sem internet. As chamadas de API (/api/*) NUNCA são
// respondidas pelo cache — precisam ir sempre pro servidor (ou falhar, e aí
// quem trata isso é a fila de pendentes no frontend, não o service worker).
const VERSAO_CACHE = 'lrcv-shell-v17';

const ARQUIVOS_SHELL = [
  '/',
  '/index.html',
  '/app.html',
  '/cadastros.html',
  '/relatorios.html',
  '/dashboard.html',
  '/manifest.json',
  '/styles/theme.css',
  '/src/api.js',
  '/src/auth.js',
  '/src/util.js',
  '/src/cadastrosCache.js',
  '/src/combobox.js',
  '/src/fila.js',
  '/src/statusSincronizacao.js',
  '/src/atualizarApp.js',
  '/src/rascunhoViagem.js',
  '/src/login.js',
  '/src/viagens.js',
  '/src/cadastrosAdmin.js',
  '/src/relatorios.js',
  '/src/dashboard.js',
  '/layout/cabecalho.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon.png',
  '/icons/logo.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO_CACHE).then((cache) => cache.addAll(ARQUIVOS_SHELL)).catch(() => {
      // se algum arquivo falhar no addAll, não trava a instalação toda
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((chave) => chave !== VERSAO_CACHE).map((chave) => caches.delete(chave)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);

  // Nunca cachear /api/* — sempre rede (a fila offline do app cuida do resto).
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (evento.request.method !== 'GET') return;

  evento.respondWith(
    caches.match(evento.request).then((respostaCache) => {
      const buscaRede = fetch(evento.request)
        .then((respostaRede) => {
          if (respostaRede && respostaRede.ok) {
            const clone = respostaRede.clone();
            caches.open(VERSAO_CACHE).then((cache) => cache.put(evento.request, clone));
          }
          return respostaRede;
        })
        .catch(() => respostaCache);

      // Cache-first pro shell (abre instantâneo e offline), mas atualiza em
      // segundo plano quando há rede.
      return respostaCache || buscaRede;
    })
  );
});
