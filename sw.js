/* zika sw v20261101AI */
const CACHE_VERSION = '20261101AI';
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

/* 打开页面：网络优先，拿不到就回退缓存，避免转圈/白屏 */
/* 其它静态文件：先用缓存立刻显示，后台再更新，第二次打开就很快 */
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
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
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
