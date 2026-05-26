// ============================================================
// MON GBONHI — Service Worker (sw.js)
// ============================================================

const CACHE_NAME = 'mon-gbonhi-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

// Réception d'une notification push
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'Mon Gbonhi';
  const options = {
    body: data.body || 'Tu as une nouvelle notification',
    icon: data.icon || '/MON--GBONHI/icon.png',
    badge: '/MON--GBONHI/icon.png',
    data: { url: data.url || '/MON--GBONHI/' },
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open', title: 'Voir' },
      { action: 'close', title: 'Fermer' }
    ]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Clic sur la notification
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'close') return;
  const url = e.notification.data?.url || '/MON--GBONHI/';
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
