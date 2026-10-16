// Service Worker — Lumen Pastoral
// Estratégia:
//   - Cache-first: assets estáticos (JS/CSS chunks, ícones, manifest)
//   - Network-only: TUDO que é Supabase, API, autenticado ou POST
//   - Fallback offline: /offline.html para navegação quando sem rede
//   - Atualização: só aplica novo SW após confirmação explícita do usuário

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `lumen-static-${CACHE_VERSION}`;

const PRECACHE = [
  '/offline.html',
  '/favicon.svg',
  '/apple-touch-icon.svg',
  '/icon-192.svg',
  '/icon-512.svg',
  '/manifest.json',
];

function isPrivateUrl(url) {
  return (
    url.includes('supabase.co') ||
    url.includes('/rest/v1/') ||
    url.includes('/auth/v1/') ||
    url.includes('/storage/v1/') ||
    url.includes('/functions/v1/')
  );
}

function isStaticAsset(url) {
  return (
    url.includes('/assets/') ||
    /\.(svg|png|ico|webp|woff2?|ttf|otf)(\?|$)/.test(url) ||
    url.endsWith('/manifest.json') ||
    url.endsWith('/offline.html')
  );
}

// --- Install: pré-cacheia recursos offline essenciais ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {}) // ignora falha em dev (arquivos podem não existir)
  );
  // NÃO chama skipWaiting() — aguarda SKIP_WAITING do cliente
});

// --- Activate: limpa caches antigos e reivindica clientes ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('lumen-static-') && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// --- Fetch ---
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Só intercepta GET da mesma origem
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isPrivateUrl(request.url)) return;

  if (isStaticAsset(request.url)) {
    // Cache-first: retorna do cache ou faz fetch e armazena
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => undefined);
      })
    );
    return;
  }

  // Navegação HTML: network-first, fallback para /offline.html
  const isNavigation =
    request.mode === 'navigate' ||
    (request.destination === 'document') ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/offline.html').then((r) => r || new Response('Offline', { status: 503 }))
      )
    );
    return;
  }

  // Tudo mais: network-only (sem cache)
});

// --- Mensagem SKIP_WAITING: aplica atualização só após confirmação ---
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- Web Push: exibe notificação e abre a URL ao clicar ---
self.addEventListener('push', (event) => {
  let data = { title: 'Lumen Pastoral', body: '', url: '/' };
  try {
    if (event.data) data = { ...data, ...JSON.parse(event.data.text()) };
  } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || '',
      icon: '/icon-192.svg',
      badge: '/favicon.svg',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus().then((c) => c.navigate(url));
      return self.clients.openWindow(url);
    })
  );
});
