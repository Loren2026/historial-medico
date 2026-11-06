/* Device-local attachments. No network uploads, OCR or inferred clinical values. */
window.ClinicalPhotos = (() => {
  'use strict';
  const DB='HistorialMedicoFotos', STORE='images', MAX=3*1024*1024;
  function ref(p){
    if(p===null)return null;
    if(!p||!/^sha256-[a-f0-9]{64}$/.test(p.id)||typeof p.name!=='string'||p.name.length>250)throw Error('Referencia de foto no válida.');
    return {id:p.id,name:p.name};
  }
  function open(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>q.result.createObjectStore(STORE);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(Error('No se puede abrir el archivo de fotos del dispositivo.'));q.onblocked=()=>reject(Error('Cierra las otras ventanas del historial y vuelve a intentarlo.'));});}
  async function get(id){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),q=tx.objectStore(STORE).get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(Error('No se pudo leer la foto guardada.'));});}finally{db.close();}}
  async function put(assets){
    if(!assets.length)return;
    const db=await open();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');for(const a of assets)tx.objectStore(STORE).put(a.data,a.id);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(Error('No se pudo guardar la foto. Comprueba el espacio disponible; la toma no se ha modificado.'));});}finally{db.close();}
  }
  async function digest(data){const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));return 'sha256-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
  function bitmap(blob){return createImageBitmap(blob);}
  async function prepare(file){
    if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Elige una foto JPG, PNG o WebP.');
    if(file.size>20*1024*1024)throw Error('La foto supera los 20 MB. Elige una copia de menor tamaño.');
    let img;try{img=await bitmap(file);}catch(_){throw Error('No se puede abrir esa foto. Prueba con una imagen JPG o PNG.');}
    try{
      if(img.width*img.height>50000000)throw Error('La foto tiene demasiada resolución. Elige una copia más pequeña.');
      const scale=Math.min(1,2000/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));
      const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
      const data=c.toDataURL('image/jpeg',0.88);if(data.length>MAX)throw Error('No se pudo reducir la foto lo suficiente. Selecciona otra copia.');
      const id=await digest(data);return {photo:{id,name:(file.name||'Foto de la toma').slice(0,250)},asset:{id,data}};
    }finally{img.close();}
  }
  function refs(state){const found=new Set();function add(r){if(r?.photo){ref(r.photo);found.add(r.photo.id);}}for(const r of state?.records||[])add(r);for(const e of state?.history||[])for(const c of e.changes||[]){add(c.before);add(c.after);}return [...found];}
  async function pack(state){const result={};for(const id of refs(state)){const data=await get(id);if(!data)throw Error('Falta una foto guardada. No se puede generar una copia completa.');result[id]=data;}return result;}
  async function unpack(state,photos){
    if(photos!==undefined&&(!photos||typeof photos!=='object'||Array.isArray(photos)))throw Error('Archivo de fotos no válido.');
    const assets=[];for(const id of refs(state)){
      const data=photos?.[id];if(typeof data!=='string'||data.length>MAX||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))throw Error('La copia no contiene una foto válida para cada referencia.');
      if(await digest(data)!==id)throw Error('Una foto de la copia está dañada o ha sido modificada.');
      let img;try{img=await bitmap(new Blob([Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/jpeg'}));if(img.width>2000||img.height>2000)throw Error();}catch(_){throw Error('La foto de la copia no se puede leer.');}finally{img?.close();}
      assets.push({id,data});
    }return assets;
  }
  function image(data,name){const img=document.createElement('img');img.className='clinical-photo';img.src=data;img.alt=name||'Foto de la medición';return img;}
  async function preview(container,photo,assets=[]){
    container.replaceChildren();if(!photo)return;
    const data=assets.find(a=>a.id===photo.id)?.data||await get(photo.id);if(!data)throw Error('No se encuentra la foto guardada.');
    const label=document.createElement('p');label.textContent=photo.name;container.append(label,image(data,photo.name));
  }
  async function view(photo){try{const d=document.createElement('dialog');d.className='clinical-dialog clinical-photo-view';d.setAttribute('aria-label','Foto de la toma');const title=document.createElement('h2');title.textContent='Foto de la toma';const content=document.createElement('div');await preview(content,photo);const close=document.createElement('button');close.textContent='Cerrar';close.onclick=()=>d.close();d.onclose=()=>d.remove();d.append(title,close,content);document.body.append(d);d.showModal();}catch(e){mostrarToast(e.message);}}
  return {ref,get,put,prepare,refs,pack,unpack,preview,view};
})();
