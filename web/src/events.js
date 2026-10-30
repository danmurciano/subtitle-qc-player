  // ================================================================ Events tab
  // A full table of the loaded subtitle's events next to a smaller copy of the player. It is the same
  // player as the QC tab (same video, subtitle, playhead, selection, filters and search): the page
  // just rearranges itself, so switching tabs never loses state.
  const evPane = document.getElementById('evPane');
  const evTable = document.getElementById('evTable');
  const evBody = evTable ? evTable.tBodies[0] : null;
  const evWrap = document.getElementById('evWrap');
  const evTools = document.getElementById('evTools');
  const evDetail = document.getElementById('evDetail');
  const evCount = document.getElementById('evCount');
  const sidebarEl = document.getElementById('sidebar');
  const stickyEl = document.querySelector('#sidebar .sidebar-sticky');
  let eventsMode = false, evDirty = true, evRows = [], evDetailIdx = -2;
  const evSort = { key: 'begin', dir: 1 };

  const EV_SORT = {
    begin: c => c.begin, end: c => c.end, duration: c => c.duration ?? -1, lines: c => c.lineCount,
    cpl: c => c.maxLineLength, cps: c => c.cps ?? -1, h: c => (c.placement ? c.placement.h : ''),
    v: c => (c.placement ? (c.placement.v === 'raised' ? 'raised' + String(999 - (c.placement.lift || 0)).padStart(3, '0') : c.placement.v) : ''),
    gap: c => (c.gap == null ? Infinity : c.gap), issues: c => -(c.issues ? c.issues.length : 0),
  };

  function gapText(g) {
    if (g == null) return '';
    const f = Math.round(g * fps());
    if (Math.abs(f) < 100) return `${f}f`;
    if (Math.abs(g) < 60) return `${g.toFixed(1)}s`;
    const m = Math.floor(Math.abs(g) / 60), sec = Math.round(Math.abs(g) % 60);
    return `${g < 0 ? '-' : ''}${m}m ${String(sec).padStart(2, '0')}s`;
  }
  const td = (cls, text, title) => { const el = document.createElement('td'); if (cls) el.className = cls; if (text != null) el.textContent = text; if (title) el.title = title; return el; };

  function renderEventsTable() {
    if (!evBody) return;
    evDirty = false;
    evBody.textContent = '';
    evRows = [];
    const frag = document.createDocumentFragment();
    cueList.forEach((c, i) => {
      const tr = document.createElement('tr');
      tr.dataset.index = String(i);
      const kind = cueKind(c);
      if (kind) tr.className = 'has-' + kind;
      const p = c.placement;
      tr.appendChild(td('ev-n', String(i + 1)));
      tr.appendChild(td('ev-tc', formatVideoTC(c.begin)));
      tr.appendChild(td('ev-tc', isFinite(c.end) ? formatVideoTC(c.end) : '…'));
      tr.appendChild(td('ev-num' + (c.tooShort || c.tooLong ? ' bad' : ''), c.duration != null ? c.duration.toFixed(2) : ''));
      const t = td('ev-text');
      renderCueText(t, c.text, searchQuery, searchCaseSensitive);
      tr.appendChild(t);
      tr.appendChild(td('ev-num' + (c.lineCount >= LINE_COUNT_THRESHOLD ? ' bad' : ''), String(c.lineCount)));
      tr.appendChild(td('ev-num' + (c.charLimitExceeded ? ' bad' : ''), String(c.maxLineLength)));
      tr.appendChild(td('ev-num' + (c.cpsOver ? ' bad' : ''), c.cps != null ? c.cps.toFixed(1) : ''));
      tr.appendChild(td('ev-pl' + (p && p.h === 'mixed' ? ' bad' : p && (p.h === 'left' || p.h === 'right') ? ' place' : ''), p ? hText(p.h) : '—'));
      tr.appendChild(td('ev-pl' + (p && p.v === 'raised' ? ' place' : p && p.v === 'top' ? ' neutral' : ''), vText(p)));
      tr.appendChild(td('ev-num' + (c.gap != null && c.gap < -0.001 ? ' bad' : ''), gapText(c.gap)));
      const iss = td('ev-iss');
      for (const x of c.issues || []) { const s = document.createElement('span'); s.className = 'qtag q-issue'; s.textContent = x.text; s.title = x.title; iss.appendChild(s); }
      tr.appendChild(iss);
      evRows[i] = tr;
      frag.appendChild(tr);
    });
    evBody.appendChild(frag);
    sortEvents();
    evApplyFilter();
    evSyncSel();
    evSyncActive();
    updateSortHeads();
  }

  function sortEvents() {
    if (!evRows.length) return;
    const key = EV_SORT[evSort.key] || EV_SORT.begin, dir = evSort.dir;
    const order = cueList.map((c, i) => i).sort((a, b) => {
      const x = key(cueList[a]), y = key(cueList[b]);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (a - b);
    });
    const frag = document.createDocumentFragment();
    order.forEach(i => frag.appendChild(evRows[i]));
    evBody.appendChild(frag);
  }
  function updateSortHeads() {
    if (!evTable) return;
    evTable.querySelectorAll('th[data-sort]').forEach(th => {
      th.classList.toggle('sorted', th.dataset.sort === evSort.key);
      th.dataset.dir = th.dataset.sort === evSort.key ? (evSort.dir > 0 ? '▲' : '▼') : '';
    });
  }
  if (evTable) evTable.tHead.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    // First click: time-like columns ascending, measures worst first ("issues" is already negated).
    if (evSort.key === th.dataset.sort) evSort.dir = -evSort.dir;
    else { evSort.key = th.dataset.sort; evSort.dir = ['cps', 'cpl', 'lines', 'duration'].includes(th.dataset.sort) ? -1 : 1; }
    sortEvents(); updateSortHeads();
    const sel = evRows[tlSelected];
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  });

  // Same filter + search as the event list.
  function evApplyFilter() {
    if (!evRows.length) { if (evCount) evCount.textContent = ''; return; }
    const f = FILTERS.find(x => x.key === currentFilter) || FILTERS[0];
    let n = 0;
    cueList.forEach((c, i) => { const show = f.test(c) && cueMatchesSearch(c); evRows[i].hidden = !show; if (show) n++; });
    if (evCount) evCount.textContent = n === cueList.length ? `${n} events` : `${n} of ${cueList.length} events`;
  }
  function evSyncSel() {
    if (!evRows.length) { updateEvDetail(); return; }
    for (const r of evBody.querySelectorAll('tr.sel')) r.classList.remove('sel');
    const r = evRows[tlSelected];
    if (r) r.classList.add('sel');
    updateEvDetail();
  }
  function evSyncActive() {
    if (!evRows.length) return;
    for (const r of evBody.querySelectorAll('tr.active')) r.classList.remove('active');
    let first = null;
    activeCueIndices.forEach(i => { const r = evRows[i]; if (r) { r.classList.add('active'); if (!first) first = r; } });
    if (first && eventsMode && isMoving()) {
      const wr = evWrap.getBoundingClientRect(), rr = first.getBoundingClientRect();
      if (rr.top < wr.top + 28 || rr.bottom > wr.bottom) first.scrollIntoView({ block: 'nearest' });
    }
    updateEvDetail();
  }
  function evMarkDirty() { evDirty = true; evDetailIdx = -2; if (eventsMode) renderEventsTable(); else updateEvDetail(); }

  if (evBody) evBody.addEventListener('click', e => {
    const tr = e.target.closest('tr');
    if (!tr || e.target.closest('.suspicious-char')) return;
    selectCue(Number(tr.dataset.index), { seek: true, scrollList: false });
  });

  // The selected event (or the one playing) in detail, under the player.
  function updateEvDetail() {
    if (!evDetail) return;
    let i = tlSelected;
    if ((isMoving() || i < 0) && activeCueIndices.size) i = [...activeCueIndices][0];
    if (i === evDetailIdx && !evDirty) return;
    evDetailIdx = i;
    const c = cueList[i];
    evDetail.textContent = '';
    if (!c) { evDetail.innerHTML = `<div class="evd-empty">${cueList.length ? 'Click an event to see it here.' : 'Open a subtitle file to see its events.'}</div>`; return; }
    const head = document.createElement('div');
    head.className = 'evd-head';
    head.textContent = `#${i + 1}  ·  ${formatVideoTC(c.begin)} – ${isFinite(c.end) ? formatVideoTC(c.end) : '…'}  ·  ${c.duration != null ? c.duration.toFixed(3) + 's' : ''}`;
    evDetail.appendChild(head);
    const lines = document.createElement('div');
    lines.className = 'evd-lines';
    for (const l of c.text.split('\n')) {
      const row = document.createElement('div');
      const n = Array.from(l.replace(/^\(.*\)$/, '')).length;
      const tx = document.createElement('span'); tx.className = 'evd-t'; renderCueText(tx, l, '', false);
      const ct = document.createElement('span'); ct.className = 'evd-n' + (n > CHAR_LIMIT ? ' bad' : ''); ct.textContent = n;
      ct.title = 'Characters on this line';
      row.appendChild(tx); row.appendChild(ct);
      lines.appendChild(row);
    }
    evDetail.appendChild(lines);
    const p = c.placement;
    const meta = document.createElement('div');
    meta.className = 'evd-meta';
    const item = (k, v, cls) => { const s = document.createElement('span'); s.innerHTML = `<i>${k}</i> `; const b = document.createElement('b'); b.textContent = v; if (cls) b.className = cls; s.appendChild(b); meta.appendChild(s); };
    item('CPS', c.cps != null ? c.cps.toFixed(1) : '—', c.cpsOver ? 'bad' : '');
    item('Chars', String(c.chars));
    item('Lines', String(c.lineCount), c.lineCount >= LINE_COUNT_THRESHOLD ? 'bad' : '');
    item('Position', p ? `${hText(p.h)} · ${vText(p)}` : '—', p && p.h === 'mixed' ? 'bad' : p && (p.v === 'raised' || p.h === 'left' || p.h === 'right') ? 'place' : '');
    item('Gap after', c.gap != null ? gapText(c.gap) : '—', c.gap != null && c.gap < -0.001 ? 'bad' : '');
    evDetail.appendChild(meta);
    if ((c.issues || []).length || (c.placeTags || []).length) {
      const tags = document.createElement('div');
      tags.className = 'evd-tags';
      appendCueTags(tags, c);
      evDetail.appendChild(tags);
    }
  }

  // Limits (shared with the event list and the Conform page).
  const limCps = document.getElementById('limCps'), limCpl = document.getElementById('limCpl');
  function showLimits() { if (limCps) limCps.value = CPS_LIMIT; if (limCpl) limCpl.value = CHAR_LIMIT; }
  showLimits();
  for (const el of [limCps, limCpl]) if (el) el.addEventListener('change', () => {
    const cps = Number(limCps.value), cpl = Math.round(Number(limCpl.value));
    if (!(cps > 0 && cps < 100) || !(cpl > 0 && cpl < 200)) { showLimits(); return; }
    setLimits({ cps, cpl });
    showLimits();
  });
  document.addEventListener('qc-limits', () => { showLimits(); renderFilterBar(); applyFilterVisibility(); });

  function setEventsMode(on) {
    if (on === eventsMode) { if (on && evDirty) renderEventsTable(); return; }
    eventsMode = on;
    // The search box and filters live in whichever view is showing.
    if (stickyEl) { if (on) evTools.appendChild(stickyEl); else sidebarEl.insertBefore(stickyEl, sidebarEl.firstChild); }
    if (on && evDirty) renderEventsTable();
    else if (on) { evSyncSel(); evSyncActive(); }
    layoutQC();
    if (on) { const r = evRows[tlSelected] || evRows[[...activeCueIndices][0]]; if (r) r.scrollIntoView({ block: 'center' }); }
    else { const r = cueListContainer.children[tlSelected]; if (r) r.scrollIntoView({ block: 'center' }); }
  }
  window.Player.setEventsMode = setEventsMode;
  window.Player.pause = () => { setSpeed(0); if (video && !video.paused) video.pause(); };
  window.Player.setLimits = setLimits;
