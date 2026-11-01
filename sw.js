/* zika sw v20261101AO */
const CACHE_VERSION = '20261101AO';
const CORE = ['./', './index.html', './css/style.css', './js/app.js'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(CORE))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* 打开页面：先用缓存的首页立刻显示，同时后台拿最新 HTML；
   网络 1.2 秒内没响应就直接用缓存，彻底避免"每次打开都白屏等一下" */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req) || await cache.match('./index.html');
      const network = fetch(req, { cache: 'no-store' })
        .then(res => {
          if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);
      if (cached) {
        const quick = await Promise.race([
          network,
          new Promise(resolve => setTimeout(() => resolve(null), 1200)),
        ]);
        if (quick) return quick;
        network.catch(() => {});
        return cached;
      }
      const res = await network;
      return res || new Response('', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    })());
    return;
  }

  if (/\.(css|js|json|webmanifest|svg|png|jpg|webp)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async cache => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then(res => {
            if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
            return res;
          });
        if (cached) {
          network.catch(() => {});
          return cached;
        }
        return network;
      })
    );
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('./', self.registration.scope).href;
  const chatTarget = new URL('./?chat=1', self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if ('focus' in client) {
        await client.focus();
        try { client.postMessage({ type: 'zika-open-chat' }); } catch {}
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(chatTarget || target);
  })());
});
