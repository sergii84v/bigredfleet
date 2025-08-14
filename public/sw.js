// v2 – PWA Service Worker для BuggyOps
const CACHE_NAME = 'buggyops-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/style.css',
  '/styles.css',
  '/supabase.js',
  '/api.js',
  '/icons/icon-16.png',
  '/icons/icon-32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/mechanic.html',
  '/guide.html',
  '/mechanic-login.html',
  '/guide-login.html',
  '/app.js',
  '/guide.js',
  '/mechanic-login.js',
  '/guide-login.js',
  '/pwa-install.js',
  '/auth-check.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Добавляем по одному, чтобы 404/ошибка не завалили установку
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (e) {
            // тихо пропускаем отсутствующие файлы
          }
        })
      );
    })()
  );
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
    })()
  );
});

// Для HTML делаем network-first (чтобы видеть свежие изменения), остальное – cache-first
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const isHTML = req.destination === 'document' || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(
      (async () => {
        try {
          const net = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, net.clone());
          return net;
        } catch (e) {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(req, { ignoreSearch: true });
          return cached || cache.match('/index.html');
        }
      })()
    );
    return;
  }

  // cache-first для всего прочего
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req);
        // кэшируем только успешные GET
        if (req.method === 'GET' && net.ok) {
          cache.put(req, net.clone());
        }
        return net;
      } catch (e) {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })()
  );
});
