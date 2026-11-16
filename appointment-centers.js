(function (root) {
  'use strict';
  // Presentation only. Never use these keys to identify or reschedule reminders.
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const known = [
    {key: 'centro-medico-asturias', name: 'Centro Médico de Asturias',
      aliases: ['Centro Médico de Asturias', 'Centro Médico Asturias', 'Centro Médico de Asturias (Oviedo)', 'Centro Médico Asturias (Oviedo)', 'Hospital Centro Médico de Asturias', 'Centro Médico'],
      destination: 'Centro Médico de Asturias, Avenida Richard Grandío s/n, Latores, Oviedo, Asturias',
      background: '#111B2F', hover: '#17243D', border: '#3A5077', accent: '#35C8F2'},
    {key: 'dental-valdes', name: 'Clínica Dental Valdés',
      aliases: ['Centro Dental Valdés, S.L.', 'Centro Dental Valdés SL', 'Centro Dental Valdés', 'Clínica Dental Valdés', 'Dental Valdés', 'Clínica Dental Centro Estomatológico Dr. Armando Valdés'],
      destination: 'Clínica Dental Centro Estomatológico Dr. Armando Valdés, Calle Joaquín Costa 10, 33011 Oviedo, Asturias',
      background: '#16372F', hover: '#1B4238', border: '#4E917D', accent: '#82E2C1'}
  ];
  const aliases = new Map();
  known.forEach(center => center.aliases.forEach(alias => aliases.set(normalize(alias), center)));
  function identify(value) {
    const name = String(value || '').trim(), key = normalize(name);
    if (!key || ['sin centro', 'no especificado', 'null', 'undefined'].includes(key)) return {key: 'unconfirmed', name: 'Centro pendiente de confirmar', destination: ''};
    return aliases.get(key) || {key: 'other:' + key, name, destination: ''};
  }
  function hash(key) { let value = 2166136261; for (const char of key) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; }
  function palette(values) {
    const result = new Map(known.map(center => [center.key, center]));
    // Sorted canonical keys make allocation independent of appointment order.
    const hues = [158, 222];
    [...new Set(values.map(value => identify(value).key))].sort().forEach(key => {
      if (result.has(key) || key === 'unconfirmed') return;
      let hue = hash(key) % 360;
      for (let i = 0; i < 360 && hues.some(h => Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue)) < 20); i++) hue = (hue + 37) % 360;
      while (hues.includes(hue)) hue += .01;
      hues.push(hue);
      result.set(key, {background: 'hsl(' + hue + ', 38%, 15%)', hover: 'hsl(' + hue + ', 38%, 19%)', border: 'hsl(' + hue + ', 34%, 48%)', accent: 'hsl(' + hue + ', 65%, 76%)'});
    });
    return result;
  }
  function describe(value, colors) {
    const center = identify(value), color = colors?.get(center.key) || known[0];
    const url = center.destination ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(center.destination) : '';
    return {...color, ...center, url};
  }
  root.AppointmentCenters = Object.freeze({identify, palette, describe});
})(typeof window !== 'undefined' ? window : globalThis);
