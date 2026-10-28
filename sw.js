// Restore JSON support - 2026-09-26
const CACHE = 'historial-v10-recuperacion-avisos';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './alarms-config.js',
  './alarms-core.js',
  './alarms.js',
  './alarms.css'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('historial-') && key !== CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match('./index.html')) || (await caches.match('./')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});

// Only generic appointment information is included in push messages.
self.addEventListener('push', event => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch (_) {}
  const body = typeof message.body === 'string' ? message.body.slice(0, 200) : 'Abre la app para consultar tus citas.';
  event.waitUntil(self.registration.showNotification(message.test ? 'Prueba de avisos' : 'Cita médica', {
    body, icon: './icon-192.png', badge: './icon-192.png',
    tag: typeof message.tag === 'string' ? message.tag.slice(0, 100) : 'cita-medica',
    renotify: false, silent: false, vibrate: [250, 120, 250],
    data: { url: self.registration.scope }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.focus(); existing.postMessage({ type: 'OPEN_APPOINTMENTS' }); }
    else await self.clients.openWindow(self.registration.scope);
  })());
});
