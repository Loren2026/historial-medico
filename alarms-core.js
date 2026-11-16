(function (root) {
  'use strict';
  function madridDate(text) {
    const m = String(text).match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const [day, month, year, hour, minute] = [Number(m[1]), Number(m[2]), Number(m[3]) + (m[3].length === 2 ? 2000 : 0), Number(m[4]), Number(m[5])];
    const civil = Date.UTC(year, month - 1, day, hour, minute);
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    const candidates = [60, 120].map(offset => civil - offset * 60000).filter(time => {
      const p = Object.fromEntries(formatter.formatToParts(time).map(x => [x.type, x.value]));
      return +p.year === year && +p.month === month && +p.day === day && +p.hour === hour && +p.minute === minute;
    });
    return candidates.length === 1 ? candidates[0] : null;
  }
  function offsets(values) {
    if (!Array.isArray(values) || values.length > 10 || values.some(n => !Number.isInteger(n) || n < 1 || n > 43200)) throw Error('Elige entre 1 minuto y 30 días, hasta 10 avisos.');
    return [...new Set(values)].sort((a, b) => b - a);
  }
  function key(cita) { return JSON.stringify([cita.especialidad, cita.fechaCorta, cita.centro || '', cita.medico || '']); }
  function label(minutes) {
    if (minutes % 1440 === 0) return minutes / 1440 + ' día' + (minutes === 1440 ? '' : 's') + ' antes';
    if (minutes % 60 === 0) return minutes / 60 + ' hora' + (minutes === 60 ? '' : 's') + ' antes';
    return minutes + ' minutos antes';
  }

  const canonical=value=>String(value||'').normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('es');
  const knownCenter=value=>!!canonical(value)&&!/^(?:[-–—]|no (?:consta|informado|indicado))$/.test(canonical(value));
  const dayOf=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
  function reconcile(citas, reminders, now=Date.now()) {
    const available=citas.filter(c=>madridDate(c.fechaCorta)>now);
    const pending=reminders.filter(i=>i.startsAt>now);
    const matches=[],used=new Set(),done=new Set();
    const fail=()=>{throw Error('Hay citas programadas que no coinciden de forma única con el historial cargado. Revisa el Excel; se conservan los avisos del servidor.');};
    if(new Set(available.map(key)).size!==available.length||new Set(pending.map(i=>i.id)).size!==pending.length)fail();
    function pass(predicate,rescheduled=false){
      for(const item of pending){
        if(done.has(item.id))continue;
        const candidates=available.filter(c=>!used.has(key(c))&&predicate(item,c));
        if(candidates.length!==1)continue;
        const cita=candidates[0];
        if(pending.filter(i=>!done.has(i.id)&&predicate(i,cita)).length!==1)continue;
        done.add(item.id);used.add(key(cita));matches.push({item,cita,rescheduled});
      }
    }
    pass((i,c)=>!!i.appointmentKey&&i.appointmentKey===key(c));
    pass((i,c)=>i.startsAt===madridDate(c.fechaCorta)&&(!i.specialty||canonical(i.specialty)===canonical(c.especialidad)));
    // Only a unique change of time within the same Madrid day and documented identity.
    // The caller must show and obtain approval for every rescheduled match.
    pass((i,c)=>!!canonical(i.specialty)&&knownCenter(i.center)&&knownCenter(c.centro)&&
      dayOf(i.startsAt)===dayOf(madridDate(c.fechaCorta))&&
      canonical(i.specialty)===canonical(c.especialidad)&&canonical(i.center)===canonical(c.centro)&&
      canonical(i.doctor)===canonical(c.medico),true);
    // A previously blank doctor may now be supplied by an approved source.
    // Check uniqueness without filtering by the new doctor, and still require review.
    const sameGroup=(i,c)=>knownCenter(i.center)&&knownCenter(c.centro)&&
      !!canonical(i.specialty)&&dayOf(i.startsAt)===dayOf(madridDate(c.fechaCorta))&&
      canonical(i.specialty)===canonical(c.especialidad)&&canonical(i.center)===canonical(c.centro);
    for(const item of pending){
      if(done.has(item.id)||canonical(item.doctor))continue;
      const candidates=available.filter(c=>!used.has(key(c))&&sameGroup(item,c));
      if(candidates.length!==1||!canonical(candidates[0].medico))continue;
      const cita=candidates[0];
      if(pending.filter(i=>!done.has(i.id)&&sameGroup(i,cita)).length!==1)continue;
      done.add(item.id);used.add(key(cita));matches.push({item,cita,rescheduled:true});
    }
    if(done.size!==pending.length)fail();
    return {matches,changes:matches.filter(x=>x.rescheduled&&x.item.startsAt!==madridDate(x.cita.fechaCorta))};
  }

  root.AlarmCore = { madridDate, offsets, key, label, reconcile };
})(globalThis);
