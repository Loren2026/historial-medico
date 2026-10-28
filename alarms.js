(function () {
  'use strict';
  const KEY = 'historial_alarmas_v1', TOKEN = 'historial_alarmas_dispositivo_v1';
  const config = window.ALARMS_CONFIG || {};
  let appointments = [], appointmentsReady = false, queue = Promise.resolve(), revision = 0, status = 'Sin conectar', storageOK = true;
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw Error();
    for (const item of Object.values(saved)) { if (!item || typeof item.id !== 'string') throw Error(); AlarmCore.offsets(item.offsets); }
  }
  catch { saved = {}; storageOK = false; status = 'No se pueden leer los avisos guardados. No se enviarán cambios.'; }
  const dialog = document.createElement('dialog');
  dialog.className = 'alarm-dialog'; dialog.setAttribute('aria-label', 'Avisos de citas'); document.body.append(dialog);
  const configured = () => /^https:\/\//.test(config.apiUrl || '') && !!config.publicKey;
  const token = () => localStorage.getItem(TOKEN) || '';
  const worker = () => Promise.race([navigator.serviceWorker.ready, new Promise((_,reject) => setTimeout(() => reject(Error('No se ha podido iniciar el servicio del navegador. Recarga con conexión.')),10000))]);
  const persist = () => { localStorage.setItem(KEY, JSON.stringify(saved)); };
  function paintStatus() {
    document.querySelectorAll('[data-alarm-status]').forEach(el => { el.textContent = status; });
  }
  function shell(title) {
    dialog.replaceChildren();
    const close = document.createElement('button'); close.textContent = '✕'; close.className = 'alarm-close'; close.setAttribute('aria-label', 'Cerrar avisos'); close.onclick = () => dialog.close(); dialog.append(close);
    const h = document.createElement('h2'); h.textContent = title; dialog.append(h);
  }
  function paragraph(text, cls = '') { const p = document.createElement('p'); p.textContent = text; p.className = cls; dialog.append(p); return p; }
  function button(text, action, parent = dialog, cls = '') { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = cls; b.onclick = action; parent.append(b); return b; }
  function open() { if (!dialog.open) dialog.showModal(); }
  async function request(path, body, unauthenticated = false) {
    const response = await fetch(config.apiUrl.replace(/\/$/, '') + path, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', ...(unauthenticated ? {} : { Authorization: 'Bearer ' + token() }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error(response.status === 401 ? 'Vuelve a conectar este móvil.' : 'No se ha podido confirmar el cambio. Reinténtalo con conexión.');
    return response.json();
  }
  function showSettings() {
    closeMenu(); shell('Avisos en este móvil');
    paragraph('Elige los avisos desde el botón de cada cita. Llegarán como notificaciones de Historial Médico.');
    const p = paragraph(status, 'alarm-status'); p.dataset.alarmStatus = '';
    paragraph('El sonido lo controla el móvil. Revisa el volumen, No molestar y el permiso de notificaciones. Los avisos necesitan conexión y pueden retrasarse.', 'alarm-hint');
    paragraph('La pantalla bloqueada mostrará solo «Cita médica» y su fecha y hora. No se enviarán informes, diagnósticos ni comentarios.', 'alarm-hint');
    if (!configured()) { paragraph('Servicio de avisos pendiente de activación. Puedes guardar tus preferencias, pero todavía no recibirás notificaciones.'); open(); return; }
    if (!token()) {
      const input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'off'; input.className = 'alarm-pairing'; input.placeholder = 'Código de vinculación'; input.setAttribute('aria-label', 'Código de vinculación de este móvil'); dialog.append(input);
      button('Activar notificaciones', async event => {
        const b = event.currentTarget; b.disabled = true;
        try {
          if (!input.value.trim()) throw Error('Introduce el código de vinculación.');
          if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) throw Error('Este navegador no admite estos avisos.');
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') throw Error('Permiso no concedido. Activa las notificaciones en los ajustes del móvil.');
          const registration = await worker();
          const raw = atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/'));
          const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
          const result = await request('/pair', { code: input.value.trim(), subscription: subscription.toJSON() }, true);
          localStorage.setItem(TOKEN, result.token); input.value = ''; await sync(); showSettings();
        } catch (error) { status = error.message; paintStatus(); } finally { b.disabled = false; }
      });
    } else {
      button('Enviar aviso de prueba', async event => {
        const b = event.currentTarget; b.disabled = true;
        try { await request('/test', {}); status = 'Prueba enviada. Comprueba que aparece y suena en el móvil.'; }
        catch (error) { status = error.message; } finally { b.disabled = false; paintStatus(); }
      });
      button('Reintentar sincronización', () => sync());
      button('Volver a vincular este móvil', () => {
        if (!confirm('Necesitarás un nuevo código de vinculación. Los avisos anteriores seguirán activos hasta completar la nueva conexión. ¿Continuar?')) return;
        localStorage.removeItem(TOKEN); status = 'Introduce un nuevo código de vinculación.'; showSettings();
      });
    }
    open();
  }
  function edit(cita) {
    shell('Avisos de esta cita');
    paragraph(cita.especialidad + ' · ' + cita.fechaCorta + ' (hora de Madrid)');
    const startsAt = AlarmCore.madridDate(cita.fechaCorta);
    if (!startsAt || startsAt <= Date.now()) { paragraph('Esta cita no tiene una fecha y hora futura inequívoca. Corrígela en el Excel antes de activar avisos.'); open(); return; }
    const k = AlarmCore.key(cita), existing = saved[k];
    const choices = [...new Set([10080, 4320, 1440, 120, 60, 30, ...(existing?.offsets || [])])].sort((a,b) => b-a);
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
      const n = +amount.value * +unit.value; AlarmCore.offsets([n]);
      if (startsAt - n * 60000 <= Date.now()) throw Error('Ese horario ya pasó. Elige menos antelación.');
      const input = [...grid.querySelectorAll('input')].find(x => +x.value === n); if (input) input.checked = true; else addOption(n, true); message.textContent = '';
    } catch(e) { message.textContent = e.message; } }, custom);
    paragraph('Puedes seleccionar varios avisos. Si cambias la fecha de la cita, tendrás que elegirlos de nuevo.', 'alarm-hint');
    const actions = document.createElement('div'); actions.className = 'alarm-actions'; dialog.append(actions);
    async function save(values) {
      if (!storageOK) { message.textContent = status; return; }
      try {
        const selected = AlarmCore.offsets(values);
        if (selected.some(n => startsAt - n*60000 <= Date.now())) throw Error('Uno de los avisos ya pasó. Revisa la selección.');
        const previous = saved[k];
        if (selected.length) saved[k] = { id: previous?.id || crypto.randomUUID(), offsets: selected }; else delete saved[k];
        try { persist(); } catch(e) { if(previous) saved[k]=previous; else delete saved[k]; throw Error('No se pudo guardar. No se ha enviado ningún cambio.'); }
        refreshButtons(); await sync(); message.textContent = status;
      } catch(e) { message.textContent = e.message; }
    }
    button('Guardar avisos', () => save([...grid.querySelectorAll('input:checked:not(:disabled)')].map(x => +x.value)), actions, 'primary');
    button('Quitar avisos', () => { grid.querySelectorAll('input').forEach(x => x.checked = false); return save([]); }, actions);
    button('Conectar / probar móvil', showSettings, actions);
    open();
  }
  function refreshButtons() {
    document.querySelectorAll('[data-alarm-index]').forEach(b => { const c = appointments[+b.dataset.alarmIndex], item = c && saved[AlarmCore.key(c)]; b.textContent = item?.offsets.length ? '🔔 Avisos (' + item.offsets.length + ')' : '🔔 Elegir avisos'; });
  }
  function sync() {
    const current = ++revision;
    if (!storageOK) { paintStatus(); return Promise.resolve(); }
    status = configured() && token() ? 'Cambios pendientes de confirmar…' : 'Preferencias guardadas en este móvil. Notificaciones todavía sin activar.'; paintStatus();
    queue = queue.catch(() => {}).then(async () => {
      if (current !== revision || !storageOK || !configured() || !token()) return;
      try {
        if (Notification.permission !== 'granted') throw Error('Notificaciones bloqueadas: revisa el permiso del móvil.');
        const registration = await worker(), subscription = await registration.pushManager.getSubscription();
        if (!subscription) throw Error('La suscripción ya no existe. Es necesario volver a vincular el móvil.');
        const items = [];
        for (const c of appointments) {
          const pref = saved[AlarmCore.key(c)], startsAt = AlarmCore.madridDate(c.fechaCorta);
          if (pref && startsAt > Date.now() && !items.some(x => x.id === pref.id)) items.push({ id: pref.id, startsAt, offsets: AlarmCore.offsets(pref.offsets) });
        }
        const confirmed = await request('/reminders', { subscription: subscription.toJSON(), reminders: items });
        if (confirmed.pushExpired) throw Error('La suscripción del móvil ha caducado. Hace falta volver a vincularlo.');
        if (current === revision) status = 'Horarios confirmados por el servicio. Usa el aviso de prueba para comprobar este móvil.';
      } catch (error) { if (current === revision) status = error.message + ' Los horarios anteriores pueden seguir activos hasta confirmar el cambio.'; }
      paintStatus();
    });
    return queue;
  }
  window.Alarms = {
    attach(citas) {
      appointments = citas;
      appointmentsReady = true;
      const panel = document.getElementById('citasPanel');
      const summary = document.createElement('div'); summary.className = 'alarm-summary'; summary.dataset.alarmStatus = ''; summary.setAttribute('role', 'status'); panel.prepend(summary);
      panel.querySelectorAll('.cita-card').forEach((card,i) => { const b = button('🔔 Elegir avisos', e => { e.stopPropagation(); edit(citas[i]); },card,'alarm-button'); b.dataset.alarmIndex = i; });
      refreshButtons(); sync();
    }, showSettings,
    exportPreferences() { return saved; }
  };
  window.addEventListener('online', () => { if (appointmentsReady) sync(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'OPEN_APPOINTMENTS') goInicio(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && appointmentsReady) sync(); });
})();
