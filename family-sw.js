// Dedicated recipient scope: no owner credential store or clinical assets.
const CACHE='avisos-familia-v22';
const FILES=['./family.html','./family-manifest.json','./family.js?v=20261115-22','./family.css?v=20261115-22','./alarms-config.js','./binding-store.js?v=20261028-14','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 await Promise.all(FILES.map(async name=>{const url=new URL(name,self.location.href);const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Descarga incompleta');await cache.put(url,r);}));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith('avisos-familia-')&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const r=event.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==self.location.origin)return;
 if(r.mode==='navigate'){event.respondWith(fetch(r).catch(()=>caches.match(new URL('./family.html',self.location.href))));return;}
 if(!FILES.some(f=>new URL(f,self.location.href).href===u.href))return;
 event.respondWith(caches.match(r).then(found=>found||fetch(r)));
});
self.addEventListener('push',event=>{
 let p={};try{p=event.data.json();}catch(_){}
 event.waitUntil(self.registration.showNotification(p.test?'Prueba de avisos familiares':'Cita médica de tu familiar',{
  body:typeof p.body==='string'?p.body.slice(0,220):'Abre Avisos familia para comprobar la conexión.',
  icon:new URL('./icon-192.png',self.location.href).href,badge:new URL('./icon-192.png',self.location.href).href,
  tag:typeof p.tag==='string'?p.tag.slice(0,100):'aviso-familiar',silent:false,renotify:false,
  data:{url:new URL('./family.html',self.location.href).href}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{
  const target=new URL('./family.html',self.location.href).href;
  const existing=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).find(c=>c.url.split(/[?#]/)[0]===target);
  if(existing)await existing.focus();else await self.clients.openWindow(target);
 })());
});
