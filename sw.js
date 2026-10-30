// Restore JSON support - 2026-09-26
importScripts('./binding-store.js?v=20261028-14');
const CACHE = 'historial-v15-ancho-comentarios';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './alarms-config.js',
  './alarms-core.js',
  './binding-store.js?v=20261028-14',
  './alarms.js?v=20261030-15',
  './alarms.css?v=20261030-15'
];

async function refreshAppFiles() {
  const files = await Promise.all(APP_SHELL.map(async path => {
    const response = await fetch(new URL(path, self.registration.scope), {cache:'no-store', signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('No se pudo descargar la aplicación');
    const bytes = await response.arrayBuffer();
    return [path, new Response(bytes, {status:response.status, statusText:response.statusText, headers:response.headers})];
  }));
  const cache = await caches.open(CACHE);
  await Promise.all(files.map(([path, response]) => cache.put(path, response)));
}
self.addEventListener('install', event => {
  event.waitUntil(refreshAppFiles().then(() => self.skipWaiting()));
});
self.addEventListener('message', event => {
  if(event.data?.type==='BINDING_CAPABILITIES'){event.ports?.[0]?.postMessage({bindingRecovery:true});return;}
  if (event.data?.type !== 'REFRESH_APP' || !event.ports?.[0]) return;
  const port = event.ports[0];
  event.waitUntil(refreshAppFiles().then(() => port.postMessage({ok:true})).catch(() => port.postMessage({ok:false})));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('historial-') && key !== CACHE).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
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
  if (message.type === 'BINDING_RECOVERY') {
    event.waitUntil((async () => {
      let restored=false;
      try {
        const pending=await BindingStore.read('recovery');
        if (pending?.id===message.requestId && pending.expiresAt>Date.now()) {
          await BindingStore.credential(message.token);
          await BindingStore.write('recovery',null); restored=true;
          for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})) client.postMessage({type:'BINDING_RESTORED'});
        }
      } catch (_) {}
      await self.registration.showNotification('Conexión de avisos',{body:restored?'Conexión recuperada. Abre Historial Médico para comprobar tus avisos.':'Abre Historial Médico para revisar la conexión de avisos.',icon:'./icon-192.png',tag:'historial-conexion',data:{url:self.registration.scope}});
    })()); return;
  }
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
