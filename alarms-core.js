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
  function key(cita) { return JSON.stringify([cita.especialidad, cita.fechaCorta]); }
  function label(minutes) {
    if (minutes % 1440 === 0) return minutes / 1440 + ' día' + (minutes === 1440 ? '' : 's') + ' antes';
    if (minutes % 60 === 0) return minutes / 60 + ' hora' + (minutes === 60 ? '' : 's') + ' antes';
    return minutes + ' minutos antes';
  }
  root.AlarmCore = { madridDate, offsets, key, label };
})(globalThis);
