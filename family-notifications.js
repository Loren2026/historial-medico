// Only family-app notifications. No credentials or clinical record store.
self.FamilyNotifications=(()=>{
 const TAG='historial-familia-ultimo',STATE='family-notification-state-v1';
 let queue=Promise.resolve();
 const target=()=>new URL('./family.html',self.location.href||self.registration.scope).href;
 const isFamily=n=>n.data?.family===true||n.data?.url===target();
 async function show(payload,title,options,allRegistration=false){
  const received=Number.isSafeInteger(payload.sentAt)&&payload.sentAt>0?payload.sentAt:0;
  let previous=[],cache=null,last=0;
  try{previous=await self.registration.getNotifications();}catch(_){}
  try{
   cache=await caches.open(STATE);
   const stored=await cache.match(target());if(stored)last=(await stored.json()).sentAt||0;
  }catch(_){}
  for(const n of previous)if(allRegistration||isFamily(n))last=Math.max(last,n.data?.familySentAt||0);
  if(last&&(!received||received<last))return {ignored:true};
  await self.registration.showNotification(title,{...options,tag:TAG,renotify:false,data:{...options.data,family:true,familySentAt:received}});
  // Show first: if display fails, retain the prior notices and receipt.
  for(const n of previous)if((allRegistration||isFamily(n))&&n.tag!==TAG){try{n.close();}catch(_){}}
  if(received&&cache)try{await cache.put(target(),new Response(JSON.stringify({sentAt:Math.max(last,received)}),{headers:{'Content-Type':'application/json'}}));}catch(_){}
  return {shown:true};
 }
 return {show(...args){const job=queue.catch(()=>{}).then(()=>show(...args));queue=job;return job;}};
})();
