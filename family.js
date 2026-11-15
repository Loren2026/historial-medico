(function(){
  'use strict';
  const recipientMode=document.body.dataset.family==='recipient',config=window.ALARMS_CONFIG||{};
  const CREDENTIAL='historial_family_credential_v1',INVITE='historial_family_invite_v1';
  let credential=null,root,notice;
  function el(tag,text,parent=root,cls=''){const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;}
  function button(text,fn,parent=root,cls=''){const b=el('button',text,parent,cls);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){notice.textContent=e.message;}finally{b.disabled=false;}};return b;}
  const format=ms=>new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(ms);
  function message(){notice=el('p','',root,'family-status');notice.setAttribute('role','status');}
  async function api(path,body,anonymous=false){
    if(!recipientMode)return window.Alarms.familyRequest(path,body);
    const r=await fetch(config.apiUrl+path,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'omit',headers:{'Content-Type':'application/json',...(!anonymous&&credential?{Authorization:'Bearer '+credential.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
    const data=await r.json();if(!r.ok)throw Error(data.error||'No se pudo confirmar la conexión. Reintenta con conexión.');return data;
  }
  function sharedInfo(){el('p','Recibirán los mismos resúmenes por día y centro que tengas programados, con horas de Madrid. Verán tu nombre, los especialistas y el centro, sin informes, diagnósticos ni comentarios, y no podrán cambiar las citas.');el('p','Necesitan conexión y permiso de notificaciones. Enviado no significa recibido o leído.',root,'family-hint');}
  async function show(){
    window.closeMenu?.();
    root=document.querySelector('.family-dialog')||el('dialog','',document.body,'family-dialog');
    root.setAttribute('aria-label','Compartir avisos');root.replaceChildren();button('Cerrar',()=>root.close());el('h2','Compartir avisos');sharedInfo();message();root.showModal();
    try{
      const data=await api('/family');
      const add=el('form','',root,'family-add');
      const nameLabel=el('label','Nombre de la persona',add);const nameInput=el('input','',nameLabel);nameInput.type='text';nameInput.maxLength=80;nameInput.required=true;nameInput.autocomplete='off';nameInput.placeholder='Escribe su nombre';
      const addButton=el('button','＋ Añadir persona',add,'primary');addButton.type='submit';
      add.onsubmit=async event=>{event.preventDefault();if(!nameInput.value.trim())return;addButton.disabled=true;try{const added=await api('/family/add',{name:nameInput.value.trim()});root.close();await show();notice.textContent=added.name+' añadida. Pulsa Crear invitación en su ficha y comparte su enlace.';}catch(e){notice.textContent=e.message;}finally{addButton.disabled=false;}};
      for(const r of data.recipients){
        const card=el('section','',root,'family-card');el('h3',r.name,card);
        const labels={active:'Móvil vinculado',expired:'La suscripción necesita renovación',invited:'Invitación pendiente',revoked:'Avisos retirados',unlinked:'Sin vincular'};
        const stateLabel=el('p',labels[r.status]||'Estado desconocido',card);
        if(r.invitationExpiresAt)el('p','Invitación válida hasta '+format(r.invitationExpiresAt)+' (Madrid).',card,'family-hint');
        button(r.status==='active'||r.status==='expired'?'Vincular otro móvil':'Crear invitación',async()=>{
          if(!confirm(`Compartir con ${r.name} los resúmenes de las citas de Loren: horas, especialistas y centro, visibles también en pantalla bloqueada, sin informes ni otros datos clínicos. Si ya tiene un móvil vinculado, se sustituirá cuando acepte. ¿Crear invitación válida durante 48 horas?`))return;
          const result=await api('/family/invite',{id:r.id});const url=new URL('family.html',location.href);url.hash='invite='+result.code;
          card.querySelector('.family-invitation')?.remove();const box=el('div','',card,'family-invitation');el('p','Invitación personal para '+r.name+'. Compártela solo con ella.',box);
          const field=el('textarea','',box);field.value=url.href;field.readOnly=true;field.rows=4;field.setAttribute('aria-label','Enlace de invitación para '+r.name);
          button('Copiar invitación',async()=>{await navigator.clipboard.writeText(url.href);notice.textContent='Invitación copiada. Puedes enviársela personalmente.';},box);
          if(navigator.share)button('Compartir enlace',async()=>{try{await navigator.share({title:'Avisos familiares',url:url.href});}catch(e){if(e.name!=='AbortError')throw e;}},box);
          stateLabel.textContent=['active','expired'].includes(r.status)?labels[r.status]+' · Nueva invitación pendiente':'Invitación pendiente';addRevoke();notice.textContent='Invitación creada. Caduca el '+format(result.expiresAt)+' (Madrid).';
        },card,'primary');
        if(['active','expired'].includes(r.status))button('Probar aviso',async()=>{await api('/family/test',{id:r.id});notice.textContent='Prueba enviada a '+r.name+'. Pídele que confirme la recepción en su móvil.';},card);
        function addRevoke(){if(card.querySelector('.family-revoke'))return;button('Retirar acceso',async()=>{
          if(!confirm(`¿Dejar de compartir con ${r.name}? Se anulará su invitación y se detendrán sus futuros envíos. Los avisos ya entregados o en tránsito pueden seguir en el móvil.`))return;
          await api('/family/revoke',{id:r.id});root.close();await show();notice.textContent='Avisos retirados para '+r.name+'.';
        },card,'family-revoke');}if(r.status!=='unlinked'&&r.status!=='revoked')addRevoke();
      }
    }catch(e){notice.textContent=e.message;}
  }
  async function loadCredential(){
    let local=null;try{local=JSON.parse(localStorage.getItem(CREDENTIAL)||'null');}catch(_){}
    credential=local||await BindingStore.read('familyCredential');
    if(credential?.token){await BindingStore.write('familyCredential',credential);localStorage.setItem(CREDENTIAL,JSON.stringify(credential));}
  }
  async function saveCredential(value){await BindingStore.write('familyCredential',value);localStorage.setItem(CREDENTIAL,JSON.stringify(value));credential=value;}
  const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const installed=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  async function pushSubscription(renew=false){
    // Request directly from the click gesture, before registration/network awaits (iOS).
    if(!('Notification'in window)||!('PushManager'in window)||!('serviceWorker'in navigator))throw Error('Este navegador no admite avisos. En iPhone necesitas iOS 16.4 o posterior y abrir desde el icono de la pantalla de inicio.');
    const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Permiso no concedido. Revisa Notificaciones en los ajustes del móvil.');
    const reg=await navigator.serviceWorker.register('./family-sw.js',{scope:'./family.html'});
    if(!reg.active)await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('No se pudo iniciar la app. Reintenta con conexión.')),20000),sw=reg.installing||reg.waiting;
      if(!sw){clearTimeout(timer);reject(Error('Servicio de avisos no disponible.'));return;}
      const check=()=>{if(sw.state==='activated'){clearTimeout(timer);resolve();}else if(sw.state==='redundant'){clearTimeout(timer);reject(Error('No se pudo descargar la app.'));}};
      sw.addEventListener('statechange',check);check();
    });
    const raw=atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));
    let existing=await reg.pushManager.getSubscription();if(renew&&existing){await existing.unsubscribe();existing=null;}return existing||reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
  }
  async function recipientPage(){
    root=document.getElementById('familyMain');root.replaceChildren();el('h1','Avisos familiares');message();
    if(credential?.token){
      let subscriptionExpired=false;
      el('p','Vinculación de '+credential.name);el('p','Recibirás los resúmenes de las citas de Loren, con horas, especialistas y centro. No tienes que cargar ningún historial.');
      try{const s=await api('/family/self');subscriptionExpired=!!s.pushExpired;notice.textContent=s.pushExpired?'Necesitas renovar las notificaciones.':'Vinculación activa. Comprueba la recepción con un aviso de prueba.';}catch(e){notice.textContent=e.message;}
      const agendaBox=el('section','',root,'family-agenda');
      async function refreshAgenda(){
        agendaBox.replaceChildren();el('h2','Citas compartidas de Loren',agendaBox);
        try{const data=await api('/family/agenda');if(!data.enabled){el('p','Loren tiene que actualizar su app para sincronizar los resúmenes.',agendaBox);return;}
          if(!data.groups.length)el('p','No hay citas futuras compartidas.',agendaBox);
          for(const group of data.groups){const card=el('section','',agendaBox,'family-card');el('h3',group.date.split('-').reverse().join('/')+' · '+group.center,card);
            for(const a of group.appointments)el('p',new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit'}).format(a.startsAt)+' · '+(a.specialty||'Especialista no informado')+(a.doctor?' · '+a.doctor:''),card);}
          el('p','Hora de Madrid. Se muestra la última información sincronizada por Loren. Los cambios posteriores a un aviso se consultan aquí.',agendaBox,'family-hint');
        }catch(e){el('p',e.message,agendaBox);}
      }
      await refreshAgenda();button('Actualizar citas',refreshAgenda);
      button('Probar aviso',async()=>{await api('/family/test',{});notice.textContent='Prueba enviada. Comprueba la notificación y el sonido.';},root,'primary');
      button('Renovar notificaciones',async()=>{const sub=await pushSubscription(subscriptionExpired);const r=await api('/family/self',{subscription:sub.toJSON()});notice.textContent=r.pushExpired?'La suscripción sigue caducada. Solicita una nueva invitación y revisa el permiso de notificaciones.':'Suscripción comprobada. Pulsa Probar aviso.';});
      button('Dejar de recibir avisos',async()=>{if(!confirm('¿Dejar de recibir los avisos de tu familiar en este móvil?'))return;await api('/family/leave',{});await saveCredential(null);await recipientPage();notice.textContent='Vinculación retirada.';});
      button('Usar una nueva invitación',async()=>{if(!confirm('¿Mostrar el formulario de otra invitación? La vinculación anterior seguirá activa hasta que se retire o se sustituya.'))return;credential=null;await recipientPage();});
    }else{
      el('p','Acepta la invitación para recibir los resúmenes de las citas de Loren con horas, especialistas y centro. Estos detalles pueden aparecer en la pantalla bloqueada. No verás informes ni podrás modificar las citas.');
      if(ios()&&!installed())el('p','En iPhone (iOS 16.4 o posterior): abre esta página en Safari, pulsa Compartir → Añadir a pantalla de inicio y ábrela desde el nuevo icono «Avisos familia». Si no aparece la invitación, vuelve a copiar el enlace recibido y pégalo abajo.',root,'family-hint');
      const label=el('label','Invitación recibida');const input=el('input','',label);input.type='text';input.autocomplete='off';input.spellcheck=false;input.placeholder='Pega el enlace de invitación';input.value=localStorage.getItem(INVITE)||'';
      const consent=el('label','');const check=el('input','',consent);check.type='checkbox';consent.append('Acepto recibir estos avisos en este móvil.');
      button('Aceptar y activar avisos',async()=>{
        if(!check.checked)throw Error('Marca la aceptación para activar los avisos.');
        if(ios()&&!installed())throw Error('Añade la app a la pantalla de inicio y ábrela desde su icono antes de aceptar.');
        let code=input.value.trim();try{const u=new URL(code);code=new URLSearchParams(u.hash.slice(1)).get('invite')||'';}catch(_){}
        if(!/^[\w-]{43}$/.test(code))throw Error('Pega una invitación válida.');
        localStorage.setItem(INVITE,code);
        const sub=await pushSubscription();await BindingStore.write('familyWriteCheck',Date.now());const result=await api('/family/accept',{code,subscription:sub.toJSON(),consent:true},true);
        await saveCredential({token:result.token,name:result.name});localStorage.removeItem(INVITE);await recipientPage();
      },root,'primary');
    }
    el('p','El móvil controla el sonido y No molestar. Los avisos requieren conexión y pueden retrasarse. Puedes retirar tu aceptación en cualquier momento.',root,'family-hint');
  }
  window.FamilySharing={show};
  if(recipientMode){
    navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='REFRESH_FAMILY_AGENDA'&&credential?.token)recipientPage();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&credential?.token)recipientPage();});
  }
  if(recipientMode)(async()=>{
    try{
      const code=new URLSearchParams(location.hash.slice(1)).get('invite');
      if(code&&/^[\w-]{43}$/.test(code)){localStorage.setItem(INVITE,code);history.replaceState(null,'',location.pathname);}
      await loadCredential();await recipientPage();
      if('serviceWorker'in navigator)navigator.serviceWorker.register('./family-sw.js',{scope:'./family.html'}).catch(()=>{});
    }catch(e){document.getElementById('familyMain').textContent='No se pudo guardar la vinculación en este navegador. '+e.message;}
  })();
})();
