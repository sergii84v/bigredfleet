// sw.js
const APP_SHELL = 'app-shell-v6';
const RUNTIME   = 'runtime-v6';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => ![APP_SHELL, RUNTIME].includes(k))
        .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Никогда не кэшируем запросы к Supabase / любым API/вебхукам
  const isSupabase = url.hostname.includes('supabase.co');
  const isAPI = url.pathname.startsWith('/rest/v1') ||
                url.pathname.startsWith('/auth') ||
                url.pathname.startsWith('/api');
  if (isSupabase || isAPI) return; // пропускаем — идёт напрямую в сеть

  // 2) Для навигаций (HTML) — network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 3) Для статических файлов своего origin — stale-while-revalidate
  if (req.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        try {
          const resp = await fetch(req);
          cache.put(req, resp.clone());
          return resp;
        } catch {
          const cached = await cache.match(req);
          if (cached) return cached;
          throw new Error('offline and not cached');
        }
      })
    );
  }
});
