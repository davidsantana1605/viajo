// Service worker de Viajo: recibe Web Push y muestra la notificación. No cachea la app (siempre versión fresca).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Viajo', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Viajo', {
      body: d.body || '',
      tag: d.tag || 'viajo',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || './' },
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) { c.navigate?.(url); return c.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
