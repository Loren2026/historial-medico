/* Clinical records stay on this device. No server calls or credentials here. */
window.Clinical = (() => {
  'use strict';
  const KEY='historial_tension_v1', AUDIT='historial_med_aprobaciones_v1';
  let imported=[], editorOpen=false;
  const esc=s=>escapeHTML(String(s??'')).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const day=s=>s ? s.split('-').reverse().join('/') : '';
  const uid=()=>crypto.randomUUID();
  const stamp=()=>new Date().toISOString();
  function dateString(v){
    if(v instanceof Date)return v.getFullYear()+'-'+String(v.getMonth()+1).padStart(2,'0')+'-'+String(v.getDate()).padStart(2,'0');
    const s=String(v??'').trim(),m=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    return m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):s;
  }
  function timeString(v){
    if(v===''||v==null)return '';
    if(v instanceof Date)return String(v.getHours()).padStart(2,'0')+':'+String(v.getMinutes()).padStart(2,'0');
    if(typeof v==='number'&&v>=0&&v<1){const mins=Math.round(v*1440);return String(Math.floor(mins/60)%24).padStart(2,'0')+':'+String(mins%60).padStart(2,'0');}
    return String(v).trim();
  }
  function validRecord(r){
    if(!r||typeof r!=='object')throw Error('Toma no válida.');
    if(typeof r.id!=='string'||!r.id||r.id.length>300)throw Error('Identificador de toma no válido.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date)throw Error('Fecha de toma no válida.');
    if(typeof r.time!=='string'||(r.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)))throw Error('Hora de toma no válida.');
    for(const k of ['sys','dia','pulse'])if(!Number.isInteger(r[k])||r[k]<=0||r[k]>999)throw Error('Introduce valores numéricos enteros de 1 a 999. No se interpreta su significado clínico.');
    for(const k of ['note','source'])if(typeof r[k]!=='string'||r[k].length>10000)throw Error('Texto de toma no válido.');
    const result={id:r.id,date:r.date,time:r.time,sys:r.sys,dia:r.dia,pulse:r.pulse,note:r.note,source:r.source};
    if(Object.hasOwn(r,'photo'))result.photo=ClinicalPhotos.ref(r.photo);
    return result;
  }
  function validList(list){if(!Array.isArray(list))throw Error('Registro de tensión no válido.');const seen=new Set();return list.map(r=>{const x=validRecord(r);if(seen.has(x.id))throw Error('Hay identificadores de tensión repetidos.');seen.add(x.id);return x;});}
  function read(){const raw=localStorage.getItem(KEY);if(raw===null)return {version:1,records:[],history:[]};const s=JSON.parse(raw);if(s.version!==1||!Array.isArray(s.history))throw Error('No se puede leer el registro de tensión. Exporta la copia antes de continuar.');return {...s,records:validList(s.records)};}
  const signature=r=>JSON.stringify([r.date,r.time,r.sys,r.dia,r.pulse]);
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function merge(base,incoming){const result=base.slice();for(const r of incoming){let i=result.findIndex(x=>x.id===r.id);if(i<0)i=result.findIndex(x=>signature(x)===signature(r));if(i<0)result.push(r);else result[i]={...result[i],...r,id:result[i].id};}return result;}
  function records(){return merge(imported,read().records).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)||a.id.localeCompare(b.id));}
  function fromWorkbook(wb){
    const ws=wb.Sheets['Tensión arterial'];if(!ws)return [];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});if(rows.length<2)return [];
    const h=rows[1];for(const key of ['Fecha','Hora','Sistólica (mmHg)','Diastólica (mmHg)','Pulso (lpm)'])if(!h.includes(key))throw Error('Falta la columna '+key+' en Tensión arterial.');
    const list=[];for(const row of rows.slice(2)){if(row.every(v=>v===''||v==null))continue;const o={};h.forEach((k,i)=>o[k]=row[i]??'');
      const r={date:dateString(o.Fecha),time:timeString(o.Hora),sys:Number(o['Sistólica (mmHg)']),dia:Number(o['Diastólica (mmHg)']),pulse:Number(o['Pulso (lpm)']),note:String(o.Observaciones||''),source:String(o.Fuente||'Excel importado')};
      r.id=String(o.ID||'excel:'+signature(r));list.push(validRecord(r));}
    return validList(list);
  }
  function describe(r){return day(r.date)+' · '+(r.time||'hora sin confirmar')+'\n'+r.sys+'/'+r.dia+' mmHg · Pulso '+r.pulse+' lpm\n'+(r.note||'Sin observaciones')+'\nFoto: '+(r.photo?r.photo.name:'sin foto');}
  function plan(incoming){const before=records(),after=merge(before,validList(incoming));const changes=[];for(const r of after){const old=before.find(x=>x.id===r.id);if(!old||!equal(old,r))changes.push({before:old||null,after:r});}return {raw:localStorage.getItem(KEY),after,changes};}
  function details(p){return p.changes.map(c=>(c.before?'ANTES\n'+describe(c.before):'NUEVA TOMA')+'\nDESPUÉS\n'+describe(c.after)).join('\n\n');}
  function commit(p,source){
    if(localStorage.getItem(KEY)!==p.raw)throw Error('Las tomas han cambiado durante la revisión. Revisa de nuevo.');
    const prev=read();const next={version:1,records:p.after,history:prev.history.concat(p.changes.length?[{at:stamp(),source,changes:p.changes}]:[])};
    localStorage.setItem(KEY,JSON.stringify(next));return ()=>{if(p.raw===null)localStorage.removeItem(KEY);else localStorage.setItem(KEY,p.raw);};
  }
  function approve(title,text,images=[]){return new Promise(resolve=>{
    const d=document.createElement('dialog');d.className='clinical-dialog';d.setAttribute('aria-label',title);
    d.innerHTML='<h2>'+esc(title)+'</h2><div class="clinical-review"></div><div class="clinical-actions"><button data-cancel>Cancelar</button><button class="primary" data-approve>Aprobar y guardar</button></div>';
    const review=d.querySelector('.clinical-review');review.textContent=text;let done=false;
    for(const item of images){const label=document.createElement('p'),img=document.createElement('img');label.textContent=item.label;img.src=item.data;img.alt=item.label;img.className='clinical-photo';review.append(label,img);}
    function finish(ok){if(done)return;done=true;d.close();d.remove();resolve(ok);}
    d.querySelector('[data-cancel]').onclick=()=>finish(false);d.querySelector('[data-approve]').onclick=()=>finish(true);d.oncancel=e=>{e.preventDefault();finish(false)};
    document.body.append(d);d.showModal();d.querySelector('[data-cancel]').focus();
  });}
  function load(wb){imported=fromWorkbook(wb);}
  function panel(){return '<div class="clinical" id="pressure-content"></div>';}
  function render(){
    const el=document.getElementById('pressure-content');if(!el)return;
    try{const list=records().slice().reverse();el.innerHTML='<h2>♥ Tensión arterial</h2><p>Registro para Cardiología</p><p class="clinical-muted">Guardado en este dispositivo. Las actualizaciones conservan las tomas. Para tener una copia fuera del móvil, usa «Exportar datos» y guárdala en Drive. La app no la sube automáticamente.</p><div class="clinical-actions"><button class="primary" id="bp-add">＋ Añadir toma</button><button id="bp-print">Imprimir registro</button><button onclick="exportarDatos()">Exportar copia</button><button id="bp-history">Ver aprobaciones</button></div><div id="bp-list">'+(list.map(r=>'<article class="clinical-card"><h3>'+esc(day(r.date))+'</h3><p class="clinical-muted">'+esc(r.time||'Hora no confirmada')+'</p><div class="clinical-metrics"><div><strong>'+r.sys+'</strong><small>Máxima · mmHg</small></div><div><strong>'+r.dia+'</strong><small>Mínima · mmHg</small></div><div><strong>'+r.pulse+'</strong><small>Pulso · lpm</small></div></div><p>'+esc(r.note)+'</p><details><summary>Fuente</summary><p class="clinical-source">'+esc(r.source)+'</p></details><div class="clinical-actions"><button data-edit="'+esc(r.id)+'">Revisar / corregir toma</button></div></article>').join('')||'<p class="clinical-empty">Todavía no hay tomas. Puedes añadir la primera o cargar el Excel que contiene tu registro.</p>')+'</div>';
    el.querySelector('#bp-add').onclick=()=>edit();el.querySelector('#bp-print').onclick=print;el.querySelector('#bp-history').onclick=history;el.querySelectorAll('[data-edit]').forEach(b=>{b.onclick=()=>edit(b.dataset.edit);const r=list.find(x=>x.id===b.dataset.edit),photo=document.createElement('button');photo.textContent=r.photo?'📷 Ver foto':'📷 Añadir foto';photo.dataset.photo=r.id;photo.onclick=()=>r.photo?ClinicalPhotos.view(r.photo):edit(r.id);b.parentElement.prepend(photo);});
    }catch(e){el.innerHTML='<h2>Tensión arterial</h2><p role="alert">'+esc(e.message)+'</p><p>No se han borrado ni sustituido tus datos.</p>';}
  }
  function edit(id){
    if(editorOpen||MED_IMPORT_BUSY)return;let r;try{r=id?records().find(x=>x.id===id):null;}catch(e){mostrarToast(e.message);return;}editorOpen=true;
    const d=document.createElement('dialog');d.className='clinical-dialog';d.setAttribute('aria-label',r?'Corregir toma':'Nueva toma');
    d.innerHTML='<h2>'+(r?'Corregir toma':'Nueva toma')+'</h2><p>Usa la fecha real. La hora puede quedar sin confirmar.</p><form><div class="clinical-grid"><label>Fecha<input name="date" type="date" required></label><label>Hora (opcional)<input name="time" type="time"></label></div><div class="clinical-grid"><label>Máxima (mmHg)<input name="sys" type="number" inputmode="numeric" min="1" max="999" step="1" required></label><label>Mínima (mmHg)<input name="dia" type="number" inputmode="numeric" min="1" max="999" step="1" required></label></div><label>Pulso (lpm)<input name="pulse" type="number" inputmode="numeric" min="1" max="999" step="1" required></label><label>Observaciones<textarea name="note" rows="3" maxlength="10000"></textarea></label><p role="alert" id="bp-error"></p><div class="clinical-actions"><button type="button" data-cancel>Cancelar</button><button type="submit" class="primary">Revisar antes de guardar</button></div></form>';
    if(r)for(const k of ['date','time','sys','dia','pulse','note'])d.querySelector('[name='+k+']').value=r[k];
    let photo=r?.photo||null,asset=null,photoBusy=false,ocrJob=null,ocrUsed=false;
    const photoBox=document.createElement('section');photoBox.className='clinical-photo-editor';
    photoBox.innerHTML='<h3>Leer una foto del tensiómetro</h3><p class="clinical-muted">Sube la foto o usa la cámara para rellenar máxima, mínima y pulso. Fotografía la pantalla de frente, en vertical y sin reflejos. La lectura se hace en este dispositivo; la foto no se envía a ningún servicio. Comprueba las cifras antes de aprobar.</p><div class="clinical-actions"><button type="button" data-gallery>📷 Subir foto y leer</button><button type="button" data-camera>Hacer foto</button><button type="button" data-remove-photo>Quitar foto</button></div><input type="file" accept="image/jpeg,image/png,image/webp" data-photo-file hidden><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-photo-camera hidden><p data-ocr-status role="status" aria-live="polite"></p><div data-photo-preview></div><p class="clinical-muted">Las fotos van en «Exportar copia» (JSON). El Excel y la impresión contienen los valores, sin imágenes.</p>';
    d.querySelector('form').prepend(photoBox);
    const preview=photoBox.querySelector('[data-photo-preview]'),submit=d.querySelector('[type=submit]');
    function photoControls(busy){photoBusy=busy;submit.disabled=busy;photoBox.querySelectorAll('button').forEach(b=>b.disabled=busy);photoBox.querySelector('[data-remove-photo]').hidden=!photo;}
    async function refreshPhoto(){photoControls(true);try{await ClinicalPhotos.preview(preview,photo,asset?[asset]:[]);}catch(e){d.querySelector('#bp-error').textContent=e.message;}finally{if(!ocrJob)photoControls(false);}}
    photoBox.querySelector('[data-gallery]').onclick=()=>photoBox.querySelector('[data-photo-file]').click();
    photoBox.querySelector('[data-camera]').onclick=()=>photoBox.querySelector('[data-photo-camera]').click();
    const status=photoBox.querySelector('[data-ocr-status]');
    const dateField=d.querySelector('[name=date]'),timeField=d.querySelector('[name=time]');
    const localDate=n=>n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0');
    const quickDate=document.createElement('div');quickDate.className='clinical-actions';quickDate.innerHTML='<button type="button" data-today>Hoy</button><button type="button" data-yesterday>Ayer</button>';
    dateField.parentElement.append(quickDate);quickDate.querySelector('[data-today]').onclick=()=>{dateField.value=localDate(new Date())};quickDate.querySelector('[data-yesterday]').onclick=()=>{const n=new Date();n.setDate(n.getDate()-1);dateField.value=localDate(n)};
    if(!r){dateField.value=localDate(new Date());d.querySelector('h2+p').textContent='Fecha propuesta: hoy. Si la foto es de otro día, elige la fecha real. La hora puede quedar sin confirmar; no se copia el reloj del aparato.';}
    for(const input of photoBox.querySelectorAll('input'))input.onchange=async()=>{
      if(!input.files[0])return;photoControls(true);ocrJob=new AbortController();const job=ocrJob;
      d.querySelector('#bp-error').textContent='';status.textContent='Preparando foto…';
      try{const next=await ClinicalPhotos.prepare(input.files[0]);if(!d.isConnected)return;photo=next.photo;asset=next.asset;await ClinicalPhotos.preview(preview,photo,[asset]);
        // A replacement photo must never retain a previous automatic draft as its reading.
        if(ocrUsed){for(const k of ['sys','dia','pulse'])d.querySelector('[name='+k+']').value=r?r[k]:'';}ocrUsed=false;
        const values=await ClinicalOCR.read(input.files[0],{signal:job.signal,onProgress:text=>{if(d.isConnected)status.textContent=text;}});
        if(!d.isConnected||job.signal.aborted)return;
        for(const k of ['sys','dia','pulse'])d.querySelector('[name='+k+']').value=values[k];ocrUsed=true;
        if(!r&&input.hasAttribute('data-photo-camera')){const now=new Date();dateField.value=localDate(now);timeField.value=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');}
        status.textContent='Lectura propuesta: '+values.sys+'/'+values.dia+' mmHg · Pulso '+values.pulse+' lpm. Comprueba la foto, la fecha y la hora. Todavía no se ha guardado.';
      }catch(e){if(d.isConnected&&!job.signal.aborted){status.textContent=e.message+(r?' Se mantienen los valores anteriores de esta toma.':'');}}finally{input.value='';if(ocrJob===job)ocrJob=null;if(d.isConnected)photoControls(false);}
    };
    photoBox.querySelector('[data-remove-photo]').onclick=()=>{photo=null;asset=null;if(ocrUsed){for(const k of ['sys','dia','pulse'])d.querySelector('[name='+k+']').value=r?r[k]:'';}ocrUsed=false;status.textContent='';d.querySelector('#bp-error').textContent='';refreshPhoto();};
    const close=()=>{ocrJob?.abort();editorOpen=false;d.close();d.remove()};d.querySelector('[data-cancel]').onclick=close;d.oncancel=e=>{e.preventDefault();close()};
    d.querySelector('form').onsubmit=async e=>{e.preventDefault();if(MED_IMPORT_BUSY||photoBusy)return;const btn=d.querySelector('[type=submit]');btn.disabled=true;MED_IMPORT_BUSY=true;
      try{const o=Object.fromEntries(new FormData(e.target));const after=validRecord({...o,...(photo||r?.photo?{photo}:{}),id:r?.id||uid(),sys:Number(o.sys),dia:Number(o.dia),pulse:Number(o.pulse),source:r?.source||'Introducida y aprobada por Loren en la app'});const p=plan([after]);
      if(!p.changes.length){mostrarToast('No hay cambios que guardar.');return;}
      if(!r&&records().some(x=>signature(x)===signature(after)))throw Error('Ya existe una toma con esa fecha, hora y valores. Revisa la registrada para evitar duplicados.');
      if(r&&!equal(records().find(x=>x.id===r.id),r))throw Error('La toma ha cambiado. Cierra y vuelve a revisarla.');
      const images=[];if(photo){const data=asset?.data||await ClinicalPhotos.get(photo.id);if(!data)throw Error('No se puede guardar la referencia: falta la foto.');images.push({label:'Foto que quedará asociada a esta toma',data});}
      const photoChange=r?.photo&&r.photo.id!==photo?.id?(photo?'\n\nSe sustituirá la foto de esta toma.':'\n\nSe quitará la foto de esta toma.'):'';
      if(!await approve('Aprobar '+(r?'corrección':'nueva toma'),details(p)+photoChange+'\n\nSe guardará en este dispositivo. Se conservará el valor anterior en el historial de aprobaciones.',images))return;
      if(asset)await ClinicalPhotos.put([asset]);
      commit(p,(r?'Corrección aprobada en la app':'Nueva toma aprobada en la app')+(ocrUsed?' · Lectura de foto revisada':''));close();render();mostrarToast('✓ Toma guardada en este dispositivo. Exporta la copia para conservarla fuera del móvil.');
      }catch(error){d.querySelector('#bp-error').textContent=error.message;}finally{MED_IMPORT_BUSY=false;btn.disabled=false;}
    };document.body.append(d);d.showModal();refreshPhoto();
  }
  function info(title,text){const d=document.createElement('dialog');d.className='clinical-dialog';d.innerHTML='<h2>'+esc(title)+'</h2><div class="clinical-review"></div><div class="clinical-actions"><button>Cerrar</button></div>';d.querySelector('.clinical-review').textContent=text;d.querySelector('button').onclick=()=>{d.close();d.remove()};d.onclose=()=>d.remove();document.body.append(d);d.showModal();}
  function history(){try{info('Aprobaciones de tensión',read().history.map(e=>new Date(e.at).toLocaleString('es-ES')+' · '+e.source+'\n'+details(e)).join('\n\n')||'Todavía no hay cambios aprobados desde la app. Las tomas del Excel conservan su fuente.');}catch(e){mostrarToast(e.message)}}
  function medHistory(){try{const log=JSON.parse(localStorage.getItem(AUDIT)||'[]');if(!Array.isArray(log))throw Error('Registro de aprobaciones no válido.');info('Aprobaciones de medicación',log.map(e=>new Date(e.at).toLocaleString('es-ES')+' · '+e.source+'\n'+e.changes.map(c=>medDescribirCambio({m:{'Fármaco':c.farmaco,'Dosis':c.dosis},before:c.before,after:c.after})).join('\n')).join('\n\n')||'Todavía no hay cambios aprobados registrados en este dispositivo.');}catch(e){mostrarToast(e.message)}}
  function print(){try{const list=records();if(!list.length){mostrarToast('No hay tomas para imprimir.');return;}document.querySelector('.clinical-print')?.remove();const p=document.createElement('section');p.className='clinical-print';p.innerHTML='<h1>Registro de tensión arterial</h1><p>Registro domiciliario · '+list.length+' toma(s)</p><table><thead><tr><th>Fecha</th><th>Hora</th><th>Máxima<br>mmHg</th><th>Mínima<br>mmHg</th><th>Pulso<br>lpm</th><th>Observaciones</th></tr></thead><tbody>'+list.map(r=>'<tr>'+[day(r.date),r.time||'Sin confirmar',r.sys,r.dia,r.pulse,r.note].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table><p>Fecha de impresión: '+new Date().toLocaleDateString('es-ES')+'.</p>';document.body.append(p);window.print();}catch(e){mostrarToast(e.message)}}
  function medicationDiff(wb){const ws=wb.Sheets['Medicación Actual'];const rows=ws?XLSX.utils.sheet_to_json(ws,{header:1,defval:''}):[];const h=rows[1]||[];const next=rows.slice(2).filter(r=>r[0]).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));const changes=[];
    for(const m of next){const old=DATA.medicacion.find(x=>medKey(x)===medKey(m));if(!old){changes.push('AÑADIR '+fmt(m['Fármaco'])+' '+fmt(m.Dosis)+' · Pauta '+fmt(m.Posología)+' · Tomando: '+fmt(m['¿Tomando?']));continue;}const fields=Object.keys(m).filter(k=>!['ID','¿Tomando?','Fecha Fin'].includes(k)&&fmt(old[k])!==fmt(m[k]));for(const k of fields)changes.push(fmt(m['Fármaco'])+' · '+k+': '+fmt(old[k])+' → '+fmt(m[k]));}
    for(const old of DATA.medicacion)if(!next.some(m=>medKey(m)===medKey(old)))changes.push('RETIRAR DE ESTA LISTA: '+fmt(old['Fármaco'])+' '+fmt(old.Dosis)+' (se conserva en la versión anterior del Excel).');return changes.join('\n');
  }
  function snapshot(){return {version:1,records:records(),history:read().history};}
  function download(payload,name,type='application/json'){const blob=new Blob([type==='application/json'?JSON.stringify(payload,null,2):payload],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  const dated=()=>{const d=new Date();return d.getDate()+'-'+(d.getMonth()+1)+'-'+String(d.getFullYear()).slice(2)};
  async function excelBytes(){const db=await abrirDB();return new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readonly'),q=tx.objectStore(DB_STORE).get(DB_KEY);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(Error('No se puede leer el Excel guardado.'));tx.oncomplete=()=>db.close();});}
  async function exportBackup(){closeMenu();if(MED_IMPORT_BUSY){mostrarToast('Espera a que termine el guardado.');return;}MED_IMPORT_BUSY=true;try{const buffer=await excelBytes();let binary='';if(buffer){const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));}
    const comments={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('nota__'))comments[k]=localStorage.getItem(k);}
    const log=JSON.parse(localStorage.getItem(AUDIT)||'[]');if(!Array.isArray(log))throw Error('Registro de aprobaciones no válido.');
    const bp=snapshot(),photos=await ClinicalPhotos.pack(bp);
    const payload={proyecto:'Gestor médico',version:3,exportado:stamp(),excel_base64:binary?btoa(binary):null,medicacion:DATA.medicacion.map(m=>({farmaco:fmt(m['Fármaco']),dosis:fmt(m.Dosis),...medEstado(m)})),citas_comentarios:comments,tension_arterial:bp,fotos_tension:photos,aprobaciones_medicacion:log};
    download(payload,'Gestor médico '+dated()+'.json');mostrarToast('Copia preparada para descargar. Incluye Excel, tomas, fotos, medicación y comentarios. Guárdala en Drive; no se sube sola.');
    }catch(e){mostrarToast('No se exportó la copia: '+e.message);}finally{MED_IMPORT_BUSY=false;}}
  async function restore(payload){
    if(MED_IMPORT_BUSY||editorOpen)throw Error('Termina la edición o carga actual antes de restaurar.');
    if(!payload||typeof payload!=='object'||(payload.proyecto&&payload.proyecto!=='Gestor médico'))throw Error('Copia no compatible.');
    MED_IMPORT_BUSY=true;let undoMed=null,undoPressure=null,commentsMutated=false;const oldComments=[];
    try{
      let buffer=null,wb=null;
      if(payload.excel_base64){if(typeof payload.excel_base64!=='string'||payload.excel_base64.length>40000000)throw Error('Excel de la copia no válido o demasiado grande.');const binary=atob(payload.excel_base64);buffer=Uint8Array.from(binary,c=>c.charCodeAt(0)).buffer;wb=XLSX.read(buffer,{type:'array',cellDates:true});fromWorkbook(wb);}
      const comments=payload.citas_comentarios;
      if(!comments||typeof comments!=='object'||Array.isArray(comments))throw Error('Comentarios no válidos.');
      const validComments=Object.entries(comments);if(validComments.some(([k,v])=>!/^nota__.+__\d{1,2}-\d{1,2}-\d{2,4}(?:_\d{1,2}:\d{2})?$/.test(k)||typeof v!=='string'))throw Error('La copia contiene comentarios incompatibles.');
      if(!Array.isArray(payload.medicacion))throw Error('Medicación no válida.');
      const changes=[],seen=new Set();
      for(const item of payload.medicacion){
        if(!item||typeof item.farmaco!=='string'||!item.farmaco.trim()||typeof item.dosis!=='string'||typeof item.tomando!=='boolean'||typeof item.fin!=='string')throw Error('Estado de medicación no válido. No se convertirá automáticamente.');
        const m={'Fármaco':item.farmaco,'Dosis':item.dosis},key=medKey(m);if(seen.has(key))throw Error('Medicación duplicada.');seen.add(key);
        const raw=localStorage.getItem(key),existing=DATA.medicacion.find(x=>medKey(x)===key);const before=raw?JSON.parse(raw):existing?medEstado(existing):{tomando:false,fin:''};
        if(typeof before.tomando!=='boolean')throw Error('Estado local de medicación no válido.');const after={tomando:item.tomando,fin:item.fin};
        if(!existing||!equal(before,after))changes.push({key,raw,m,before,after});
      }
      const bp=payload.tension_arterial;
      if(bp&&(bp.version!==1||!Array.isArray(bp.history)))throw Error('Formato de tensión no compatible.');
      const incoming=merge(wb?fromWorkbook(wb):[],bp?validList(bp.records):[]),p=plan(incoming);
      const logIncoming=payload.aprobaciones_medicacion||[];if(!Array.isArray(logIncoming))throw Error('Histórico de medicación no válido.');
      for(const e of logIncoming){if(!e||typeof e.at!=='string'||typeof e.source!=='string'||!Array.isArray(e.changes))throw Error('Histórico de medicación incompleto.');for(const c of e.changes)if(typeof c.farmaco!=='string'||typeof c.dosis!=='string'||typeof c.before?.tomando!=='boolean'||typeof c.after?.tomando!=='boolean')throw Error('Aprobación de medicación incompleta.');}
      if(bp)for(const e of bp.history){if(!e||typeof e.at!=='string'||typeof e.source!=='string'||!Array.isArray(e.changes))throw Error('Histórico de tensión incompleto.');for(const c of e.changes){if(c.before)validRecord(c.before);validRecord(c.after);}}
      const photoAssets=await ClinicalPhotos.unpack(bp,payload.fotos_tension);
      validComments.forEach(([k])=>oldComments.push([k,localStorage.getItem(k)]));
      const medFields=wb?medicationDiff(wb):'';
      if(!await approve('Revisar restauración', (wb?'Se restaurará también el Excel incluido en la copia.\n\n':'Se conserva el Excel cargado.\n\n')+changes.map(medDescribirCambio).join('\n\n')+(medFields?'\n\nMEDICACIÓN DEL EXCEL\n'+medFields:'')+(p.changes.length?'\n\nTENSIÓN\n'+details(p):'')+'\n\nCOMENTARIOS\n'+validComments.map(([k,v])=>k+'\nAntes: '+(localStorage.getItem(k)||'(vacío)')+'\nDespués: '+v).join('\n\n')+'\n\nSe incorporarán '+photoAssets.length+' foto(s), incluidas las conservadas en el historial de aprobaciones. Las tomas ausentes en la copia se conservan. Los avisos y la vinculación no se modifican.',photoAssets.map((a,i)=>({label:'Foto '+(i+1)+' de la copia',data:a.data}))))return;
      for(const [k,v] of oldComments)if(localStorage.getItem(k)!==v)throw Error('Los comentarios cambiaron durante la revisión.');
      const auditRaw=localStorage.getItem(AUDIT),medLog=JSON.parse(auditRaw||'[]');if(!Array.isArray(medLog))throw Error('Histórico local no válido.');
      await ClinicalPhotos.put(photoAssets);
      const resetMed=medGuardarCambios(changes,'Restauración JSON aprobada');undoMed=()=>{resetMed();if(auditRaw===null)localStorage.removeItem(AUDIT);else localStorage.setItem(AUDIT,auditRaw);};
      const combined=JSON.parse(localStorage.getItem(AUDIT)||'[]');for(const e of logIncoming)if(!combined.some(x=>equal(x,e)))combined.push(e);localStorage.setItem(AUDIT,JSON.stringify(combined));
      undoPressure=commit(p,'Restauración JSON aprobada');const state=read();for(const e of bp?.history||[])if(!state.history.some(x=>equal(x,e)))state.history.push(e);localStorage.setItem(KEY,JSON.stringify(state));
      commentsMutated=true;for(const [k,v] of validComments)localStorage.setItem(k,v);
      if(buffer)await guardarExcel(buffer);
      undoMed=null;undoPressure=null;oldComments.length=0;
      if(wb){parseWorkbook(wb);renderDashboard();}else{render();renderMedBody();if(DATA.specialties.length)renderCitasPendientes();}
      mostrarToast('✓ Copia restaurada con tu aprobación.');
    }catch(e){try{undoMed?.();undoPressure?.();if(commentsMutated)for(const [k,v] of oldComments){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}}catch(_){throw Error('No se pudo recuperar el estado anterior. Revisa tus datos antes de usar la app.');}throw e;}
    finally{MED_IMPORT_BUSY=false;}
  }
  return {KEY,AUDIT,records,fromWorkbook,plan,details,commit,approve,load,panel,render,edit,history,medHistory,medicationDiff,snapshot,exportBackup,excelBytes,download,dated,validList,read,info,merge,restore,editorOpen:()=>editorOpen};
})();
window.addEventListener('storage',e=>{if(e.key===Clinical.KEY)Clinical.render();if(e.key?.startsWith('med__'))renderMedBody();});
