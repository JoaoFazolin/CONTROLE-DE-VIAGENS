const CACHE_NAME = 'abastecimento-v18';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/logo-lr-campos.png'
];

// GETs cujo ultimo resultado vale a pena guardar para uso offline
// (listas usadas nos seletores dos formularios de lancamento)
const CACHEABLE_API_GET = ['/api/equipamentos', '/api/obras', '/api/tipos-combustivel', '/api/tipos-oleo'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // nunca intercepta chamadas que nao sao GET (POST/PUT/DELETE sempre vao direto pra rede,
  // o proprio app.js cuida da fila offline para essas)
  if (req.method !== 'GET') return;

  const isCacheableApi = CACHEABLE_API_GET.some((p) => url.pathname.startsWith(p));

  if (isCacheableApi) {
    // network-first, cai pro cache se estiver offline.
    // IMPORTANTE: só guarda respostas de sucesso (res.ok). Antes, respostas de
    // erro (401/404/500) também eram cacheadas e ficavam "presas" no aparelho.
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    // outras chamadas de API: sempre rede, sem cache
    return;
  }

  // app shell: cache-first, atualiza em segundo plano
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
