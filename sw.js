// Restore JSON support - 2026-09-26
importScripts('./binding-store.js?v=20261028-14', './family-notifications.js?v=20261116-24');
const CACHE = 'historial-v25-ficha-citas';
const XLSX_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const APP_SHELL = [
  XLSX_SCRIPT,
  './',
  './index.html',
  './clinical.js?v=20261107-21',
  './clinical-photos.js?v=20261107-21',
  './clinical-ocr.js?v=20261107-21',
  './bp-ocr-worker.js?v=20261107-21',
  './ocr-vendor/tesseract.min.js',
  './ocr-vendor/worker.min.js',
  './ocr-vendor/tesseract-core-lstm.wasm.js',
  './ocr-vendor/ssd_int.traineddata',
  './clinical.css?v=20261107-21',
  './jszip.min.js',
  './clinical-excel.js?v=20261107-21',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './alarms-config.js',
  './alarms-core.js?v=20261116-25',
  './binding-store.js?v=20261028-14',
  './alarms.js?v=20261116-25',
  './family.html',
  './family-notifications.js?v=20261116-24',
  './family-sw.js',
  './family-manifest.json',
  './family.js?v=20261116-24',
  './family.css?v=20261116-24',
  './alarms.css?v=20261030-17'
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
  if (url.origin !== self.location.origin && url.href !== XLSX_SCRIPT) return;

  if (request.mode === 'navigate') {
    const navigationFile = url.pathname === new URL('./family.html', self.registration.scope).pathname ? './family.html' : './index.html';
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(navigationFile, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(navigationFile)) || (await caches.match('./')))
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

// Push contains the appointment details approved for owner/family sharing.
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
  const body = typeof message.body === 'string' ? message.body.slice(0, message.daily ? 3000 : 200) : 'Abre la app para consultar tus citas.';
  const title=message.test ? 'Prueba de avisos' : message.daily && typeof message.title==='string' ? message.title.slice(0,120) : 'Cita médica';
  const options={
    body, icon: './icon-192.png', badge: './icon-192.png',
    tag: typeof message.tag === 'string' ? message.tag.slice(0,100) : 'cita-medica',
    renotify:false,silent:false,vibrate:[250,120,250],
    data:{url:message.family===true?new URL('./family.html',self.registration.scope).href:self.registration.scope}
  };
  event.waitUntil(message.family===true ? self.FamilyNotifications.show(message,title,options) : self.registration.showNotification(title,options));

});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const familyUrl = new URL('./family.html',self.registration.scope).href;
    const target = event.notification.data?.url === familyUrl ? familyUrl : self.registration.scope;
    const existing = windows.find(client => target===familyUrl ? client.url.split('#')[0]===familyUrl : client.url.startsWith(self.registration.scope)&&!client.url.includes('/family.html'));
    if (existing) { await existing.focus(); if(target!==familyUrl)existing.postMessage({ type: 'OPEN_APPOINTMENTS' }); }
    else await self.clients.openWindow(target);
  })());
});
