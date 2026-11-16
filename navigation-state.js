(function () {
  'use strict';
  const KEY = 'historial_vista_pestana_v1';
  const segments = ['todas', 'tomando', 'sup'];
  let book = '', ready = false, applying = false, restoring = false, generation = 0, timer;
  let initial = null;
  try { initial = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) {}
  try { history.scrollRestoration = 'manual'; } catch (_) {}
  const panelExists = id => typeof id === 'string' && document.getElementById('panel_' + id)?.classList.contains('panel');
  const valid = s => s && (s.view === 'inicio' || (s.view === 'secciones' && panelExists(s.panel)));
  const route = s => s.view === 'inicio' ? {view:'inicio'} : {view:'secciones', panel:s.panel};
  const coordinate = value => Number.isFinite(value) ? Math.max(0, Math.min(value, 10000000)) : 0;
  function snapshot() {
    if (!document.getElementById('mainContent')?.classList.contains('active')) return null;
    const view = document.getElementById('view_secciones')?.classList.contains('active') ? 'secciones' : 'inicio';
    const panel = document.querySelector('#panelsContainer .panel.active')?.id.slice(6);
    if (view === 'secciones' && !panelExists(panel)) return null;
    const root = document.getElementById('view_' + view);
    const readingLine = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
    const visibleCard = view === 'inicio' ? [...root.querySelectorAll('.cita-card[id]')].find(el => el.getBoundingClientRect().bottom > readingLine && el.getBoundingClientRect().top < innerHeight) : null;
    const anchor = visibleCard ? {id:visibleCard.id, offset:visibleCard.getBoundingClientRect().top} : null;
    return {version:1, book, view, ...(view === 'secciones' ? {panel} : {}),
      stack:NAV_HIST.filter(valid).slice(-50).map(route),
      scroll:[window.scrollX, window.scrollY], anchor,
      tables:[...root.querySelectorAll('.table-scroll')].map(el => [el.scrollLeft, el.scrollTop]),
      medSegment:segments.includes(MED_SEG) ? MED_SEG : 'todas'};
  }
  function capture() {
    if (!ready || applying || restoring || actualizacionEnCurso) return;
    const state = snapshot(); if (!state || !book) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }
  function navigated() {
    if (applying) return;
    generation++; restoring = false;
    if (!ready) {
      // An explicit Citas/notification navigation before workbook loading wins.
      initial = null;
      return;
    }
    capture();
  }
  async function setWorkbook(buffer) {
    try {
      const bytes = buffer instanceof ArrayBuffer ? buffer : ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : null;
      if (!bytes) throw Error();
      book = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2,'0')).join('');
    } catch (_) { book = ''; }
  }
  function restore(saved) {
    const state = saved?.version === 1 && saved.book === book && book && valid(saved) ? saved : {view:'inicio'};
    const ticket = ++generation; applying = true; restoring = true;
    try {
      const stack = Array.isArray(state.stack) ? state.stack.filter(valid).slice(-50).map(route) : [];
      if (stack[0]?.view !== 'inicio') stack.unshift({view:'inicio'});
      const current = route(state), last = stack[stack.length - 1];
      if (last.view !== current.view || last.panel !== current.panel) stack.push(current);
      NAV_HIST.splice(0, NAV_HIST.length, ...stack);
      if (segments.includes(state.medSegment)) MED_SEG = state.medSegment;
      if (state.view === 'secciones') {
        activateTab(state.panel, true);
        document.querySelectorAll('#medSeg button').forEach((b,i) => b.classList.toggle('on', segments[i] === MED_SEG));
      } else goInicio();
    } finally { applying = false; ready = true; }
    const applyScroll = () => {
      if (generation !== ticket) return;
      const root = document.getElementById('view_' + state.view);
      [...root.querySelectorAll('.table-scroll')].forEach((el,i) => {
        const position = state.tables?.[i] || [];
        el.scrollLeft = coordinate(position[0]); el.scrollTop = coordinate(position[1]);
      });
      window.scrollTo(coordinate(state.scroll?.[0]), coordinate(state.scroll?.[1]));
      const anchor = typeof state.anchor?.id === 'string' && /^cita_\d+$/.test(state.anchor.id) ? document.getElementById(state.anchor.id) : null;
      if (anchor && root.contains(anchor) && Number.isFinite(state.anchor.offset)) {
        window.scrollTo(coordinate(state.scroll?.[0]), coordinate(scrollY + anchor.getBoundingClientRect().top - state.anchor.offset));
      }
      restoring = false; capture();
    };
    requestAnimationFrame(() => requestAnimationFrame(applyScroll));
    // Font loading can change row heights; a new user action cancels this follow-up.
    document.fonts?.ready.then(() => { if (generation === ticket) applyScroll(); });
  }
  document.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(capture, 100); }, {capture:true, passive:true});
  window.addEventListener('pagehide', capture);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') capture(); });
  for (const name of ['wheel','touchstart','keydown']) window.addEventListener(name, () => {
    if (restoring && !applying) { generation++; restoring = false; capture(); }
  }, {passive:true});
  window.NavigationState = {setWorkbook, capture, navigated,
    beforeRender:() => ready ? snapshot() : initial, restore};
})();
