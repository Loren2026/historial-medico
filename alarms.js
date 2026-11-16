(function () {
  'use strict';
  const KEY = 'historial_alarmas_v1', TOKEN = 'historial_alarmas_dispositivo_v1';
  const config = window.ALARMS_CONFIG || {};
  let appointments = [], appointmentsReady = false, queue = Promise.resolve(), revision = 0, status = 'Sin conectar', storageOK = true;
  let remoteLoaded = false, remoteRevision = null, remoteSchedule = [], remoteLoading = null, appointmentSignature = '', reviewedSchedule = null;
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw Error();
    for (const item of Object.values(saved)) { if (!item || typeof item.id !== 'string') throw Error(); item.offsets=AlarmCore.offsets(item.offsets).filter(n=>n!==30&&n!==60); }
  }
  catch { saved = {}; storageOK = false; status = 'No se pueden leer los avisos guardados. No se enviarán cambios.'; }
  const dialog = document.createElement('dialog');
  dialog.className = 'alarm-dialog'; dialog.setAttribute('aria-label', 'Avisos de citas'); document.body.append(dialog);
  const configured = () => /^https:\/\//.test(config.apiUrl || '') && !!config.publicKey;
  let activeToken = '', bindingReady = null, initialBindingRecorded=false;
  const token = () => activeToken;
  async function ensureBinding(force=false) {
    if (bindingReady && !force) return bindingReady;
    bindingReady=(async()=>{
      let local='';try{local=localStorage.getItem(TOKEN)||'';}catch(_){}
      const backup=await BindingStore.read('credential');
      if(!initialBindingRecorded){
        await BindingStore.write('lastLoad',{at:new Date().toISOString(),credencialLocal:!!local,copia:!!backup?.token,origen:location.origin});
        initialBindingRecorded=true;
      }
      activeToken=(force&&backup?.token)||local||backup?.token||'';
      if(activeToken){
        if(backup?.token!==activeToken) await BindingStore.credential(activeToken);
        try{localStorage.setItem(TOKEN,activeToken);}catch(_){}
      }
      return activeToken;
    })();
    try{return await bindingReady;}catch(error){bindingReady=null;throw error;}
  }
  async function saveBinding(value){
    await BindingStore.credential(value);activeToken=value;bindingReady=Promise.resolve(value);
    try{localStorage.setItem(TOKEN,value);}catch(_){}
  }
  async function recoverBinding(){
    try{
      const originalToken=activeToken;
      const registration=await worker(),subscription=await registration.pushManager.getSubscription();
      if(!subscription)throw Error('Este navegador no conserva una suscripción de avisos. Hay que comprobar qué copia de la app se vinculó.');
      await new Promise((resolve,reject)=>{
        const channel=new MessageChannel(),timer=setTimeout(()=>finish(false),4000);
        function finish(ok){clearTimeout(timer);channel.port1.close();ok?resolve():reject(Error('Pulsa Actualizar en el menú y vuelve a intentar la recuperación.'));}
        channel.port1.onmessage=event=>finish(event.data?.bindingRecovery===true);
        registration.active?.postMessage({type:'BINDING_CAPABILITIES'},[channel.port2]);
      });
      const id=crypto.randomUUID();
      await BindingStore.write('recovery',{id,expiresAt:Date.now()+180000});
      status='Comprobando este móvil mediante una notificación…';paintStatus();
      await request('/recover',{requestId:id,subscription:subscription.toJSON()},true);
      await ensureBinding(true);
      if(activeToken&&activeToken!==originalToken){remoteLoaded=false;await sync();showSettings();return;}
      status='Recuperación solicitada. Espera la notificación y mantén la app abierta.';paintStatus();
    }catch(error){status=error.message;paintStatus();}
  }
  async function connectionDetails(){
    shell('Estado de la conexión');
    try{
      const backup=await BindingStore.read('credential'),previous=await BindingStore.read('beforeUpdate'),lastLoad=await BindingStore.read('lastLoad');
      const registration=await navigator.serviceWorker.getRegistration(),sub=await registration?.pushManager.getSubscription();
      let http='Sin credencial';const value=localStorage.getItem(TOKEN)||backup?.token;
      if(value&&configured()){try{http=(await fetch(config.apiUrl+'/status',{cache:'no-store',headers:{Authorization:'Bearer '+value},signal:AbortSignal.timeout(10000)})).status;}catch(_){http='Sin respuesta';}}
      const info={version:'16-11-2026 · 27',origen:location.origin,modo:matchMedia('(display-mode: standalone)').matches?'App instalada':'Navegador',configurada:configured(),credencialLocal:!!localStorage.getItem(TOKEN),copiaDeConexion:!!backup?.token,suscripcion:!!sub,permiso:typeof Notification==='undefined'?'No disponible':Notification.permission,respuestaServicio:http,preferenciasLocales:!!localStorage.getItem(KEY),antesDeActualizar:previous||'Sin registro anterior',alAbrirLaApp:lastLoad||'Sin registro'};
      const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:inherit';pre.textContent=JSON.stringify(info,null,2);dialog.append(pre);
    }catch(error){paragraph(error.message);}
    button('Volver',()=>showSettings());open();
  }
  const worker = () => Promise.race([navigator.serviceWorker.ready, new Promise((_,reject) => setTimeout(() => reject(Error('No se ha podido iniciar el servicio del navegador. Recarga con conexión.')),10000))]);
  const persist = () => { localStorage.setItem(KEY, JSON.stringify(saved)); };
  // Cosmetic acknowledgements for this owner's browser. No credentials or clinical data.
  const DISMISSED_MESSAGES = 'historial_owner_mensajes_leidos_v1';
  const dismissibleMessages = new Map([
    ['Resúmenes por día y centro confirmados. Los cambios posteriores se consultan al abrir la app; no generan otro aviso ese día.', 'daily-summary-confirmed:1']
  ]);
  function readDismissedMessages() {
    try {
      const values = JSON.parse(localStorage.getItem(DISMISSED_MESSAGES) || '[]');
      return new Set(Array.isArray(values) ? values.filter(v => typeof v === 'string') : []);
    } catch (_) { return new Set(); }
  }
  function paintStatus() {
    document.querySelectorAll('[data-alarm-status]').forEach(el => {
      if (!el.classList.contains('alarm-summary')) { el.textContent = status; return; }
      const id = dismissibleMessages.get(status), dismissed = readDismissedMessages();
      el.replaceChildren();
      const text = document.createElement('span'); text.textContent = status; el.append(text);
      el.hidden = (id && dismissed.has(id)) || status.startsWith('Horarios confirmados por el servicio.');
      if (!id) return;
      const close = document.createElement('button');
      close.type = 'button'; close.className = 'alarm-dismiss'; close.textContent = '×';
      close.setAttribute('aria-label', 'Cerrar este mensaje informativo');
      close.title = 'No volver a mostrar este mensaje';
      close.addEventListener('click', () => {
        try {
          const current = readDismissedMessages(); current.add(id);
          localStorage.setItem(DISMISSED_MESSAGES, JSON.stringify([...current]));
          if (!readDismissedMessages().has(id)) throw Error();
        } catch (_) {
          mostrarToast('No se pudo guardar el cierre. El mensaje permanece visible.'); return;
        }
        const hadFocus = document.activeElement === close;
        paintStatus();
        if (hadFocus) document.querySelector('#citasPanel .cita-specialty')?.focus({preventScroll:true});
      });
      el.append(close);
    });
  }
  window.addEventListener('storage', event => {
    if (event.key === DISMISSED_MESSAGES || event.key === null) paintStatus();
  });
  function shell(title) {
    dialog.replaceChildren();
    const close = document.createElement('button'); close.textContent = '✕'; close.className = 'alarm-close'; close.setAttribute('aria-label', 'Cerrar avisos'); close.onclick = () => dialog.close(); dialog.append(close);
    const h = document.createElement('h2'); h.textContent = title; dialog.append(h);
  }
  function paragraph(text, cls = '') { const p = document.createElement('p'); p.textContent = text; p.className = cls; dialog.append(p); return p; }
  function button(text, action, parent = dialog, cls = '') { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = cls; b.onclick = action; parent.append(b); return b; }
  function open() { if (!dialog.open) dialog.showModal(); }
  async function request(path, body, unauthenticated = false, retried = false) {
    const response = await fetch(config.apiUrl.replace(/\/$/, '') + path, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', ...(unauthenticated ? {} : { Authorization: 'Bearer ' + token() }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      if(response.status===401&&!unauthenticated&&!retried){
        const previous=activeToken;await ensureBinding(true);
        if(activeToken&&activeToken!==previous)return request(path,body,false,true);
      }
      if(response.status===404&&path==='/recover')throw Error('Esta suscripción no coincide con la vinculada. Abre Estado de la conexión para comprobarlo; no generes otro código todavía.');
      if(response.status===429)throw Error('Espera un minuto antes de reintentar la recuperación.');
      if (response.status === 409) { remoteLoaded=false; throw Error('La programación cambió o la app necesita actualizarse. Cierra y vuelve a abrir la app para recuperar los horarios antes de guardar.'); }
      throw Error(response.status === 401 ? 'No se ha podido validar la conexión de este móvil. Tus horarios se conservan en el servidor.' : 'No se ha podido confirmar el cambio. Reinténtalo con conexión.');
    }
    return response.json();
  }
  function soundHelp(back = showSettings) {
    shell('Cambiar sonido y tipo de aviso');
    paragraph('1. Envía un aviso de prueba desde «Avisos en este móvil».');
    paragraph('2. Desliza desde la parte superior de la pantalla para abrir la cortina de notificaciones.');
    paragraph('3. Mantén el dedo sobre la notificación recibida durante uno o dos segundos. Un toque breve abre la app; mantenerla pulsada muestra sus ajustes.');
    paragraph('4. Pulsa el engranaje, Ajustes o Más ajustes. Busca Sonido, Vibración o Silencioso en la categoría de esta notificación. Los nombres dependen de tu móvil.');
    paragraph('Si aparece Chrome, busca la categoría de loren2026.github.io. Cambiar ajustes generales de Chrome puede afectar a otras páginas.', 'alarm-hint');
    paragraph('El tono y el volumen los controla Android. Esta app no puede escoger una melodía ni forzar el sonido con No molestar.', 'alarm-hint');
    button('Volver', back); open();
  }
  async function loadRemote() {
    if (remoteLoaded) return;
    if (remoteLoading) return remoteLoading;
    remoteLoading = restoreRemote().finally(() => { remoteLoading=null; });
    return remoteLoading;
  }
  const cleanText=value=>String(value||'').replace(/\s+/g,' ').trim();
  const calendarDay=c=>{const ms=AlarmCore.madridDate(c.fechaCorta);return ms?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms):'';};
  function groupFor(cita){
    const center=cleanText(cita.centro).normalize('NFC').toLocaleLowerCase('es'),day=calendarDay(cita);
    if(!center||/^(?:[-–—]|no (?:consta|informado|indicado))$/.test(center))return [cita];
    return appointments.filter(c=>AlarmCore.madridDate(c.fechaCorta)>Date.now()&&calendarDay(c)===day&&cleanText(c.centro).normalize('NFC').toLocaleLowerCase('es')===center);
  }
  const groupOffsets=c=>[...new Set(groupFor(c).flatMap(x=>saved[AlarmCore.key(x)]?.offsets||[]))].filter(n=>n!==30&&n!==60).sort((a,b)=>b-a);
  async function restoreRemote() {
    if (!appointmentsReady) throw Error('Carga el historial vigente antes de sincronizar los avisos.');
    const data = await request('/status');
    if (data.apiVersion !== 2 || !Number.isSafeInteger(data.revision) || !Array.isArray(data.reminders)) throw Error('La actualización del servicio sigue en curso. Los horarios anteriores se conservan.');
    const signature=appointmentSignature;
    const reconciliation=AlarmCore.reconcile(appointments,data.reminders);
    if(reconciliation.changes.length){
      if(!window.Clinical?.approve)throw Error('No se puede mostrar la revisión del cambio. Los avisos compartidos se conservan.');
      const fmt=ms=>new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(ms);
      const changes=reconciliation.changes.map(({item,cita})=>({id:item.id,before:item.startsAt,after:AlarmCore.madridDate(cita.fechaCorta),specialty:cita.especialidad,center:cita.centro,doctorBefore:item.doctor||'',doctorAfter:cita.medico||'',offsets:item.offsets}));
      const text=changes.map(c=>'CITA: '+c.specialty+' · '+c.center+'\nANTES: '+fmt(c.before)+'\nDESPUÉS: '+fmt(c.after)+(c.doctorBefore!==c.doctorAfter?'\nMédico ANTES: '+(c.doctorBefore||'No informado')+'\nMédico DESPUÉS: '+(c.doctorAfter||'No informado'):'')+'\nPlazos conservados: '+c.offsets.filter(n=>n!==30&&n!==60).map(AlarmCore.label).join(', ')).join('\n\n');
      const accepted=await Clinical.approve('Actualizar horarios de avisos compartidos',text+'\n\nSe actualizarán los horarios del servicio para este móvil y las personas vinculadas. Cancelar conserva los horarios del servidor. Hora de Madrid.');
      if(!accepted)throw Error('Cambio de horario compartido sin aprobar. El Excel de este móvil se conserva; el servicio mantiene el horario anterior.');
      if(signature!==appointmentSignature)throw Error('El historial cambió durante la revisión. Revisa otra vez antes de guardar.');
      reviewedSchedule={id:crypto.randomUUID(),at:new Date().toISOString(),revision:data.revision,signature,changes,status:'aprobado_pendiente'};
      const history=JSON.parse(localStorage.getItem(KEY+'_aprobaciones')||'[]');
      if(!Array.isArray(history))throw Error('No se puede leer el historial de aprobaciones de avisos.');
      localStorage.setItem(KEY+'_aprobaciones',JSON.stringify(history.concat(reviewedSchedule)));
    }
    if(signature!==appointmentSignature)throw Error('El historial cambió durante la sincronización. Reintenta con la versión actual.');
    const next = {}, matches = new Set();
    for(const {item,cita} of reconciliation.matches){
      const k=AlarmCore.key(cita);matches.add(k);
      next[k]={id:item.id,offsets:AlarmCore.offsets(item.offsets).filter(n=>n!==30&&n!==60)};
    }
    for (const c of appointments) {
      const k=AlarmCore.key(c),startsAt=AlarmCore.madridDate(c.fechaCorta);
      if (startsAt>Date.now() && !matches.has(k)) next[k]={id:saved[k]?.id||crypto.randomUUID(),offsets:[10080,4320,1440]};
    }
    // Restore from the server before any write. Never let an old local copy clear its schedule.
    localStorage.setItem(KEY+'_antes_recuperacion',JSON.stringify(saved));
    localStorage.setItem(KEY,JSON.stringify(next)); saved=next;
    remoteRevision=data.revision;remoteSchedule=data.reminders;remoteLoaded=true;refreshButtons();
  }
  async function showSettings(options={}) {
    try{await ensureBinding();}catch(error){status=error.message;}
    closeMenu(); shell('Avisos en este móvil');
    paragraph('Los avisos reúnen las citas del mismo día y centro. La primera cita del grupo marca la hora de envío; se conservan los plazos elegidos salvo 30 minutos y 1 hora.');
    const p = paragraph(status, 'alarm-status'); p.dataset.alarmStatus = '';
    paragraph('El sonido lo controla el móvil. Revisa el volumen, No molestar y el permiso de notificaciones. Los avisos necesitan conexión y pueden retrasarse.', 'alarm-hint');
    paragraph('Los avisos incluyen el nombre de Loren, las horas, los especialistas y el centro, también para las personas vinculadas. Pueden aparecer en la pantalla bloqueada. No incluyen informes, diagnósticos ni comentarios.', 'alarm-hint');
    button('Cómo cambiar sonido y tipo de aviso', () => soundHelp());
    button('Estado de la conexión',connectionDetails);
    if (!configured()) { paragraph('Servicio de avisos pendiente de activación. Puedes guardar tus preferencias, pero todavía no recibirás notificaciones.'); open(); return; }
    if (!token()) {
      const registration=await navigator.serviceWorker.getRegistration();
      const existingSubscription=await registration?.pushManager.getSubscription();
      if(existingSubscription&&!options.pair){
        paragraph('Este móvil conserva su suscripción. Puedes recuperar la conexión sin generar otro código.');
        button('Recuperar conexión sin código',recoverBinding);
        button('Activar por primera vez con código',()=>showSettings({pair:true}));
        open();return;
      }
      const input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'off'; input.className = 'alarm-pairing'; input.placeholder = 'Código de vinculación'; input.setAttribute('aria-label', 'Código de vinculación de este móvil'); dialog.append(input);
      button('Activar notificaciones', async event => {
        const b = event.currentTarget; b.disabled = true;
        try {
          if (!input.value.trim()) throw Error('Introduce el código de vinculación.');
          localStorage.setItem(KEY,JSON.stringify(saved));
          await BindingStore.write('writeCheck',{at:Date.now()});
          if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) throw Error('Este navegador no admite estos avisos.');
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') throw Error('Permiso no concedido. Activa las notificaciones en los ajustes del móvil.');
          const registration = await worker();
          const raw = atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/'));
          const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
          const result = await request('/pair', { code: input.value.trim(), subscription: subscription.toJSON() }, true);
          await saveBinding(result.token); input.value = ''; remoteLoaded=false; await sync(); showSettings();
        } catch (error) { status = error.message; paintStatus(); } finally { b.disabled = false; }
      });
    } else {
      button('Enviar aviso de prueba', async event => {
        const b = event.currentTarget; b.disabled = true;
        try { await request('/test', {}); status = 'Prueba enviada. Comprueba que aparece y suena en el móvil.'; }
        catch (error) { status = error.message; } finally { b.disabled = false; paintStatus(); }
      });
      button('Reintentar sincronización', () => sync());
      button('Recuperar conexión sin código',recoverBinding);
    }
    open();
  }
  function edit(cita) {
    shell('Avisos del día y centro');
    paragraph(cita.especialidad + ' · ' + cita.fechaCorta + ' (hora de Madrid)');
    const members=groupFor(cita),startsAt=Math.min(...members.map(c=>AlarmCore.madridDate(c.fechaCorta)));
    if (!startsAt || startsAt <= Date.now()) { paragraph('Esta cita no tiene una fecha y hora futura inequívoca. Corrígela en el Excel antes de activar avisos.'); open(); return; }
    const k = AlarmCore.key(cita), existing = {offsets:groupOffsets(cita)};
    paragraph(members.length+' cita(s) en este grupo · '+(cleanText(cita.centro)||'Centro no informado')+'. Referencia: '+new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit'}).format(startsAt)+'.');
    const choices = [...new Set([10080, 4320, 1440, 120, ...(existing?.offsets || [])])].sort((a,b) => b-a);
    const grid = document.createElement('div'); grid.className = 'alarm-options'; dialog.append(grid);
    const addOption = (n, checked) => {
      const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = n; input.checked = checked;
      const passed = startsAt - n * 60000 <= Date.now(); input.disabled = passed;
      label.append(input, document.createTextNode(AlarmCore.label(n) + (passed ? ' (ya pasó)' : ''))); grid.append(label);
    };
    choices.forEach(n => addOption(n, (existing?.offsets || []).includes(n)));
    const custom = document.createElement('div'); custom.className = 'alarm-custom'; dialog.append(custom);
    const amount = document.createElement('input'); amount.type = 'number'; amount.min = '1'; amount.max = '43200'; amount.step = '1'; amount.value = '3'; amount.setAttribute('aria-label', 'Cantidad de antelación'); custom.append(amount);
    const unit = document.createElement('select'); unit.setAttribute('aria-label', 'Unidad de antelación'); [[60,'horas'],[1440,'días'],[1,'minutos']].forEach(([v,t]) => unit.add(new Option(t,v))); custom.append(unit);
    const message = paragraph('', 'alarm-status'); message.setAttribute('role', 'status');
    button('Añadir', () => { try {
      const n = +amount.value * +unit.value; AlarmCore.offsets([n]); if(n===30||n===60)throw Error('Los avisos de 30 minutos y 1 hora están retirados.');
      if (startsAt - n * 60000 <= Date.now()) throw Error('Ese horario ya pasó. Elige menos antelación.');
      const input = [...grid.querySelectorAll('input')].find(x => +x.value === n); if (input) input.checked = true; else addOption(n, true); message.textContent = '';
    } catch(e) { message.textContent = e.message; } }, custom);
    paragraph('Este cambio se aplica al grupo del mismo día y centro. Sus plazos se reúnen en un solo resumen por día de envío. Los plazos pasados no se vuelven a enviar; los días nuevos se preparan con 7, 3 y 1 día.', 'alarm-hint');
    const actions = document.createElement('div'); actions.className = 'alarm-actions'; dialog.append(actions);
    async function save(values) {
      if (!storageOK) { message.textContent = status; return; }
      try {
        if (configured() && token() && !remoteLoaded) { await loadRemote(); edit(cita); return; }
        const selected = AlarmCore.offsets(values);
        if (selected.some(n => startsAt - n*60000 <= Date.now() && !existing.offsets.includes(n))) throw Error('Uno de los avisos ya pasó. Revisa la selección.');
        const previous=structuredClone(saved);
        for(const c of members){const mk=AlarmCore.key(c);saved[mk]={id:saved[mk]?.id||crypto.randomUUID(),offsets:selected};}
        try { persist(); } catch(e) { saved=previous; throw Error('No se pudo guardar. No se ha enviado ningún cambio.'); }
        refreshButtons(); await sync(); message.textContent = status;
      } catch(e) { message.textContent = e.message; }
    }
    button('Guardar avisos', () => save([...grid.querySelectorAll('input:checked')].map(x => +x.value)), actions, 'primary');
    button('Quitar avisos', () => { grid.querySelectorAll('input').forEach(x => x.checked = false); return save([]); }, actions);
    button('Conectar / probar móvil', showSettings, actions);
    button('Cómo cambiar sonido y tipo de aviso', () => soundHelp(() => edit(cita)), actions);
    open();
  }
  function refreshButtons() {
    document.querySelectorAll('[data-alarm-index]').forEach(b => { const c = appointments[+b.dataset.alarmIndex], item = c && {offsets:groupOffsets(c)}; b.textContent = item?.offsets.length ? '🔔 Avisos (' + item.offsets.length + ')' : '🔔 Elegir avisos'; });
  }
  async function sync() {
    const current = ++revision;
    try{await ensureBinding();}catch(error){status=error.message;paintStatus();return;}
    if(current!==revision)return;
    if (!storageOK) { paintStatus(); return Promise.resolve(); }
    status = configured() && token() ? 'Cambios pendientes de confirmar…' : 'Preferencias guardadas en este móvil. Notificaciones todavía sin activar.'; paintStatus();
    queue = queue.catch(() => {}).then(async () => {
      if (current !== revision || !storageOK || !configured() || !token()) return;
      try {
        if (Notification.permission !== 'granted') throw Error('Notificaciones bloqueadas: revisa el permiso del móvil.');
        await loadRemote();
        if(current!==revision)return;
        const registration = await worker(), subscription = await registration.pushManager.getSubscription();
        if(current!==revision)return;
        if (!subscription) throw Error('No se encuentra la suscripción del móvil. Los horarios se conservan; revisa el permiso de notificaciones.');
        if (remoteSchedule.some(item => item.startsAt>Date.now() && !appointments.some(c => saved[AlarmCore.key(c)]?.id===item.id))) throw Error('El historial cargado no contiene todas las citas programadas. Se conservan los avisos; revisa el Excel antes de cambiarlos.');
        const items = [];
        for (const c of appointments) {
          const pref = saved[AlarmCore.key(c)], startsAt = AlarmCore.madridDate(c.fechaCorta);
          if (pref && startsAt > Date.now() && !items.some(x => x.id === pref.id)) items.push({ id: pref.id, startsAt, offsets: AlarmCore.offsets(pref.offsets).filter(n=>n!==30&&n!==60), appointmentKey:AlarmCore.key(c), specialty:cleanText(c.especialidad), doctor:cleanText(c.medico), center:cleanText(c.centro) });
        }
        const confirmed = await request('/reminders', { clientVersion:3, revision:remoteRevision, subscription: subscription.toJSON(), reminders: items });
        remoteRevision=confirmed.revision; remoteSchedule=items;
        let auditWarning='';
        if(reviewedSchedule&&reviewedSchedule.signature===appointmentSignature){
          try{
            const history=JSON.parse(localStorage.getItem(KEY+'_aprobaciones')||'[]');
            localStorage.setItem(KEY+'_aprobaciones',JSON.stringify(history.map(r=>r.id===reviewedSchedule.id?{...r,status:'aplicado',confirmedRevision:confirmed.revision,confirmedAt:new Date().toISOString()}:r)));
            reviewedSchedule=null;
          }catch(_){auditWarning=' El servicio confirmó el cambio, pero no se pudo completar la copia local de la aprobación.';}
        }
        if (confirmed.pushExpired) throw Error('La suscripción del móvil ha caducado. Hace falta volver a vincularlo.');
        if (current === revision) status = 'Resúmenes por día y centro confirmados. Los cambios posteriores se consultan al abrir la app; no generan otro aviso ese día.'+auditWarning;
      } catch (error) { if (current === revision) status = error.message + ' Los horarios anteriores pueden seguir activos hasta confirmar el cambio.'; }
      paintStatus();
    });
    return queue;
  }
  window.Alarms = {
    attach(citas) {
      const signature=JSON.stringify(citas.map(AlarmCore.key));
      if(signature!==appointmentSignature)remoteLoaded=false;
      appointmentSignature=signature;appointments = citas;
      for(const c of citas){const legacy=JSON.stringify([c.especialidad,c.fechaCorta]),current=AlarmCore.key(c);if(!saved[current]&&saved[legacy]&&citas.filter(x=>JSON.stringify([x.especialidad,x.fechaCorta])===legacy).length===1){saved[current]=saved[legacy];delete saved[legacy];}}
      appointmentsReady = true;
      const panel = document.getElementById('citasPanel');
      const summary = document.createElement('div'); summary.className = 'alarm-summary'; summary.dataset.alarmStatus = ''; summary.setAttribute('role', 'status'); panel.prepend(summary);
      panel.querySelectorAll('.cita-card').forEach((card,i) => { const b = button('🔔 Elegir avisos', e => { e.stopPropagation(); edit(citas[i]); },card,'alarm-button'); b.dataset.alarmIndex = i; });
      refreshButtons(); sync();
    }, showSettings,
    async familyRequest(path,body){
      if(!/^\/family(?:\/|$)/.test(path))throw Error('Ruta no permitida');
      await ensureBinding();
      if(!configured()||!token())throw Error('Conecta primero tu móvil desde «Avisos de citas».');
      return request(path,body);
    },
    async prepareUpdate(){
      await ensureBinding();
      if(activeToken)await BindingStore.credential(activeToken);
      await BindingStore.write('beforeUpdate',{at:new Date().toISOString(),credencial:!!activeToken,copia:!!(await BindingStore.read('credential'))?.token,origen:location.origin});
    },
    exportPreferences() { return saved; }
  };
  window.addEventListener('online', () => { if (appointmentsReady) sync(); });
  async function resumeBinding(show=false){
    try{await ensureBinding(true);remoteLoaded=false;if(appointmentsReady)await sync();if(show)showSettings();}
    catch(error){status=error.message;paintStatus();}
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
    if(event.data?.type==='BINDING_RESTORED')resumeBinding(true);
    if(event.data?.type==='OPEN_APPOINTMENTS'){resumeBinding();goInicio();}
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && appointmentsReady) resumeBinding(); });
  window.addEventListener('storage',event=>{if(event.key===TOKEN||event.key===null){bindingReady=null;resumeBinding();}});
})();
