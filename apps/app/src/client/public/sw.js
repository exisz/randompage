// RandomPage Service Worker
const CACHE_NAME = 'randompage-v2';
const APP_SHELL_PATHS = ['/', '/discover', '/bookmarks', '/history', '/settings', '/manifest.json', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
const STATIC_CACHE_PREFIXES = ['/assets/', '/icon-', '/manifest'];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_SHELL_PATHS.map(async (path) => {
    try {
      const request = new Request(path, { cache: 'reload' });
      const response = await fetch(request);
      if (response.ok) await cache.put(path, response);
    } catch {
      // Best effort: navigation cache is refreshed again on future fetches.
    }
  }));
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(cacheAppShell());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        if (response.ok) await cache.put('/', response.clone());
        return response;
      } catch {
        return (await cache.match(request)) || (await cache.match('/')) || new Response('RandomPage is offline and the app shell is not cached yet.', { status: 503 });
      }
    })());
    return;
  }

  if (STATIC_CACHE_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || network;
    })());
  }
});

self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'RandomPage', body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(data.title || 'RandomPage', {
      body: data.body || 'A new passage awaits.',
      icon: '/icon-192.png',
      data: { passageId: data.passageId },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const passageId = e.notification?.data?.passageId;
  const targetUrl = passageId
    ? `/discover?passageId=${encodeURIComponent(passageId)}&source=push`
    : '/discover';
  e.waitUntil(clients.openWindow(targetUrl));
});
