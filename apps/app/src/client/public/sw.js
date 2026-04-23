// RandomPage Service Worker
const CACHE_NAME = 'randompage-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

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
  e.waitUntil(clients.openWindow('/discover'));
});
