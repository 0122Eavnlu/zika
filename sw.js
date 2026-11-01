/* zika sw v20261031Z */
const CACHE_VERSION = '20261031Z';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 始终获取最新文件，避免浏览器缓存旧版本
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
    url.searchParams.set('_v', String(Date.now()));
    event.respondWith(
      fetch(url.href, { cache: 'no-store' }).catch(() => fetch(req))
    );
    return;
  }

  if (/\.(css|js|json|webmanifest|svg|png|jpg|webp)$/.test(url.pathname)) {
    event.respondWith(
      fetch(req, { cache: 'reload' }).catch(() => fetch(req))
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
