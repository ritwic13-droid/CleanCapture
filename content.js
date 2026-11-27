(() => {
  if (window.__cleanCapture) return;
  window.__cleanCapture = true;

  const S = { style: null, orig: null, el: null, elOrig: null, elBehavior: null };
  const settle = (ms = 140) => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ms))));
  const root = () => document.scrollingElement || document.documentElement;
  const Z = '2147483647';

  function addStyle() {
    if (S.style) return;
    S.style = document.createElement('style');
    S.style.textContent =
      'html{scroll-behavior:auto!important;scrollbar-width:none!important}' +
      'html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important}' +
      '[data-cc-fixed]{visibility:hidden!important}' +
      '[data-cc-sticky]{position:relative!important;inset:auto!important}';
    document.documentElement.appendChild(S.style);
  }
  // After the first frame, floating headers/banners would repeat in every slice: hide them.
  function markFloating() {
    for (const el of document.body.querySelectorAll('*')) {
      const p = getComputedStyle(el).position;
      if (p === 'fixed') el.setAttribute('data-cc-fixed', '');
      else if (p === 'sticky') el.setAttribute('data-cc-sticky', '');
    }
  }
  function restore() {
    document.querySelectorAll('[data-cc-fixed]').forEach(e => e.removeAttribute('data-cc-fixed'));
    document.querySelectorAll('[data-cc-sticky]').forEach(e => e.removeAttribute('data-cc-sticky'));
    S.style?.remove(); S.style = null;
    if (S.el && S.elOrig) {
      S.el.scrollTop = S.elOrig.top; S.el.scrollLeft = S.elOrig.left;
      S.el.style.scrollBehavior = S.elBehavior || '';
    }
    if (S.orig) window.scrollTo(S.orig.x, S.orig.y);
    S.orig = S.elOrig = S.el = null;
  }

  const scrollable = el => {
    if (!el || el === document.documentElement || el === document.body || el === root()) return false;
    if (el.scrollHeight - el.clientHeight < 8 || el.clientHeight < 40) return false;
    return /auto|scroll|overlay/.test(getComputedStyle(el).overflowY);
  };
  const scrollParent = el => { while (el && !scrollable(el)) el = el.parentElement; return el; };

  function elInfo() {
    const el = S.el, b = el.getBoundingClientRect();
    const left = b.left + el.clientLeft, top = b.top + el.clientTop;
    const x0 = Math.max(0, left), y0 = Math.max(0, top);
    const x1 = Math.min(innerWidth, left + el.clientWidth), y1 = Math.min(innerHeight, top + el.clientHeight);
    return {
      sx: x0, sy: y0, sw: Math.max(1, x1 - x0), sh: Math.max(1, y1 - y0), offX: x0 - left, offY: y0 - top,
      scrollTop: el.scrollTop, scrollLeft: 0, totalH: el.scrollHeight, totalW: el.clientWidth,
      ch: el.clientHeight, vw: innerWidth, vh: innerHeight
    };
  }

  function hint(text) {
    const h = document.createElement('div');
    h.setAttribute('role', 'status');
    h.textContent = text;
    h.style.cssText = `all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:${Z};background:#111827;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none`;
    document.documentElement.appendChild(h);
    return h;
  }

  function pickArea(purpose = 'shot') {
    const ov = document.createElement('div');
    ov.style.cssText = `all:initial;position:fixed;inset:0;z-index:${Z};cursor:crosshair;background:rgba(0,0,0,.25)`;
    const box = document.createElement('div');
    box.style.cssText = 'all:initial;position:fixed;display:none;border:1px solid #fff;outline:1px dashed #2563eb;box-shadow:0 0 0 99999px rgba(0,0,0,.45);pointer-events:none';
    ov.appendChild(box);
    const tip = hint(purpose === 'record' ? 'Drag to select the area to record · Esc to cancel' : 'Drag to select an area · Esc to cancel');
    document.documentElement.appendChild(ov);
    let x0, y0, rect = null;
    const done = () => { ov.remove(); tip.remove(); removeEventListener('keydown', key, true); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
    addEventListener('keydown', key, true);
    ov.addEventListener('pointerdown', e => {
      e.preventDefault(); ov.setPointerCapture(e.pointerId);
      x0 = e.clientX; y0 = e.clientY; ov.style.background = 'transparent'; box.style.display = 'block';
    });
    ov.addEventListener('pointermove', e => {
      if (x0 == null) return;
      const cx = Math.min(Math.max(e.clientX, 0), innerWidth), cy = Math.min(Math.max(e.clientY, 0), innerHeight);
      rect = { x: Math.min(x0, cx), y: Math.min(y0, cy), w: Math.abs(cx - x0), h: Math.abs(cy - y0) };
      Object.assign(box.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
    });
    ov.addEventListener('pointerup', async () => {
      done();
      if (!rect || rect.w < 5 || rect.h < 5) return;
      await settle(60);
      if (purpose === 'record') { REC.el = null; recPrepare(rect); }
      chrome.runtime.sendMessage({ t: 'picked', mode: 'area', purpose, dpr: devicePixelRatio, rect: { ...rect, vw: innerWidth, vh: innerHeight } });
    });
  }

  // Inspector-style picker: highlights whatever is under the pointer; click captures that element.
  function pickElement(purpose = 'shot') {
    const box = document.createElement('div');
    box.style.cssText = `all:initial;position:fixed;display:none;z-index:${Z};border:2px solid #2563eb;background:rgba(37,99,235,.18);pointer-events:none;box-sizing:border-box`;
    const tag = document.createElement('div');
    tag.style.cssText = `all:initial;position:fixed;display:none;z-index:${Z};background:#1e3a8a;color:#fff;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:2px 6px;border-radius:4px;pointer-events:none;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis`;
    const tip = hint(`Click the element to ${purpose === 'record' ? 'record' : 'capture'} · ↑ parent · ↓ child · Enter confirm · Esc cancel`);
    document.documentElement.append(box, tag);
    let cur = null, hovered = null;
    const trail = [];                                  // elements we climbed up from, for ↓
    const describe = el => {
      let d = el.tagName.toLowerCase();
      if (el.id) d += '#' + el.id;
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      if (cls.length) d += '.' + cls.join('.');
      const r = el.getBoundingClientRect();
      const h = scrollable(el) ? el.scrollHeight : r.height;
      return `${d}  ${Math.round(r.width)} × ${Math.round(h)}${scrollable(el) ? '  · scrolls' : ''}`;
    };
    const show = () => {
      if (!cur) { box.style.display = tag.style.display = 'none'; return; }
      const b = cur.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' });
      tag.textContent = describe(cur);
      const ty = b.top >= 24 ? b.top - 22 : Math.min(innerHeight - 22, Math.max(0, b.top) + 4);
      Object.assign(tag.style, { display: 'block', left: Math.max(0, Math.min(b.left, innerWidth - 200)) + 'px', top: ty + 'px' });
    };
    const move = e => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === hovered) return;               // keep a parent chosen with ↑ until the pointer reaches another element
      hovered = cur = el; trail.length = 0; show();
    };
    const stop = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    const EVENTS = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
    const done = () => {
      box.remove(); tag.remove(); tip.remove();
      removeEventListener('mousemove', move, true); removeEventListener('keydown', key, true); removeEventListener('scroll', show, true);
      for (const t of EVENTS) removeEventListener(t, click, true);
    };
    const capture = async () => {
      done();
      if (!cur) return;
      if (purpose === 'record') {                      // record the part of the element that is on screen
        const b = cur.getBoundingClientRect();
        const x = Math.max(0, b.left), y = Math.max(0, b.top), w = Math.min(innerWidth, b.right) - x, h = Math.min(innerHeight, b.bottom) - y;
        if (w < 8 || h < 8) return;
        REC.el = cur; recPrepare({ x, y, w, h });       // the frame follows this element if the page scrolls
        await settle(60);
        chrome.runtime.sendMessage({ t: 'picked', mode: 'area', purpose, dpr: devicePixelRatio, rect: { x, y, w, h, vw: innerWidth, vh: innerHeight } });
        return;
      }
      S.el = cur;
      await settle(60);
      chrome.runtime.sendMessage({ t: 'picked', mode: 'element' });
    };
    const key = e => {
      if (e.key === 'Escape') { stop(e); done(); }
      else if (e.key === 'Enter') { stop(e); capture(); }
      else if (e.key === 'ArrowUp' && cur?.parentElement) { stop(e); trail.push(cur); cur = cur.parentElement; show(); }
      else if (e.key === 'ArrowDown' && cur) { stop(e); cur = trail.pop() || cur.firstElementChild || cur; show(); }
    };
    const click = e => { stop(e); if (e.type === 'click') capture(); };
    addEventListener('mousemove', move, true); addEventListener('keydown', key, true); addEventListener('scroll', show, true);
    for (const t of EVENTS) addEventListener(t, click, true);
    cur = document.elementFromPoint(innerWidth / 2, innerHeight / 2);   // starting point for keyboard users
    show();
  }

  // --- capturing a plain (non-scrolling) element by scrolling the page past it ---
  const fixedAncestor = el => { for (; el && el !== document.documentElement; el = el.parentElement) if (getComputedStyle(el).position === 'fixed') return true; return false; };
  function boxInfo() {
    const r = S.el.getBoundingClientRect();
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(innerWidth, r.right), y1 = Math.min(innerHeight, r.bottom);
    return { sx: x0, sy: y0, sw: Math.max(1, x1 - x0), sh: Math.max(1, y1 - y0), offX: x0 - r.left, offY: y0 - r.top,
      totalW: Math.max(1, r.width), totalH: Math.max(1, r.height), vw: innerWidth, vh: innerHeight, fixed: fixedAncestor(S.el) };
  }


  /* ---------- in-page recording overlay (see docs/RECORDING_PLAN.md §5) ----------
     The red frame is drawn just outside the recorded region and the control bar sits
     outside it too, so neither ends up in the video. Commands go straight to the
     offscreen recorder. */
  const REC = { el: null, base: null, elBase: null, rect: null, host: null, ui: null, raf: 0, timer: 0,
    activeMs: 0, resumedAt: 0, paused: false, editing: false, wasPaused: false, live: false, cancel: null };
  const toRecorder = (t, extra = {}) => chrome.runtime.sendMessage({ target: 'offscreen', t, ...extra }).catch(() => {});
  const recElapsed = () => REC.activeMs + (REC.resumedAt ? performance.now() - REC.resumedAt : 0);
  const fmt = ms => { const s = Math.floor(ms / 1000), z = n => String(n).padStart(2, '0'); return (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + z(Math.floor(s / 60) % 60) + ':' + z(s % 60); };
  const sendRegion = () => toRecorder('region', { rect: { ...REC.rect, vw: innerWidth, vh: innerHeight, sx: scrollX, sy: scrollY }, vw: innerWidth });

  function recPrepare(rect) {
    REC.rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    REC.base = { ...REC.rect };
    REC.elBase = REC.el ? REC.el.getBoundingClientRect() : null;
  }

  function recBuild() {
    const host = document.createElement('div');
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:${Z};pointer-events:none`;
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      *{box-sizing:border-box}
      .frame{position:fixed;border:3px solid #ef4444;border-radius:4px;box-shadow:0 0 0 1px rgba(0,0,0,.3);pointer-events:none}
      .frame.ready{border-style:dashed;border-color:rgba(239,68,68,.8)}
      .frame.edit{pointer-events:auto;cursor:move;border-style:dashed}
      .frame i{display:none;position:absolute;width:14px;height:14px;background:#fff;border:2px solid #ef4444;border-radius:3px;pointer-events:auto}
      .frame.edit i{display:block}
      .count{position:fixed;display:flex;flex-direction:column;align-items:center;gap:10px;transform:translate(-50%,-50%);pointer-events:none}
      .count b{display:block;width:104px;height:104px;border-radius:50%;background:rgba(17,24,39,.88);color:#fff;font:700 52px/104px system-ui,sans-serif;text-align:center}
      .count span{color:#fff;background:rgba(17,24,39,.88);font:500 13px/1 system-ui,sans-serif;padding:7px 12px;border-radius:999px}
      .bar{position:fixed;display:flex;align-items:center;gap:6px;padding:5px 5px 5px 12px;background:#111827;color:#f9fafb;border-radius:999px;font:600 13px/1 system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:auto;white-space:nowrap}
      .bar[hidden],.count[hidden]{display:none}
      .dot{width:10px;height:10px;border-radius:50%;background:#ef4444;animation:blink 1.2s infinite}
      .dot.paused{animation:none;background:#9ca3af;border-radius:2px}
      @keyframes blink{50%{opacity:.2}}
      @media (prefers-reduced-motion: reduce){.dot{animation:none}}
      .time{font-variant-numeric:tabular-nums;min-width:44px;margin-right:2px}
      button{all:unset;font:600 12px/1 system-ui,sans-serif;color:#f9fafb;background:#374151;padding:8px 12px;border-radius:999px;cursor:pointer}
      button:hover{background:#4b5563}
      button:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}
      button[disabled]{opacity:.5;cursor:default}
      button.stop{background:#dc2626}
      button.stop:hover{background:#b91c1c}
      .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}`;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    const frame = el('div', 'frame');
    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) { const i = el('i'); i.dataset.h = h; frame.appendChild(i); }
    const count = el('div', 'count'); const num = el('b', '', '3'); count.append(num, el('span', '', 'Recording starts… Esc to go back'));
    const bar = el('div', 'bar'); bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Recording controls'); bar.hidden = true;
    const dot = el('span', 'dot'); dot.setAttribute('aria-hidden', 'true');
    const time = el('span', 'time', '00:00'); time.setAttribute('aria-label', 'Recorded time');
    const pause = el('button', '', 'Pause'), edit = el('button', '', 'Edit frame'), stop = el('button', 'stop', 'Stop');
    bar.append(dot, time, pause, edit, stop);
    const sr = el('div', 'sr'); sr.setAttribute('role', 'status');
    root.append(style, frame, count, bar, sr);
    document.documentElement.appendChild(host);
    REC.host = host;
    REC.ui = { frame, count, num, bar, dot, time, pause, edit, stop, sr };
    pause.addEventListener('click', () => (REC.phase === 'ready' ? startCountdown() : togglePause()));
    edit.addEventListener('click', toggleEdit);
    stop.addEventListener('click', () => {
      if (REC.phase === 'ready') { recEnd(); return; }          // Cancel: nothing was recorded
      stop.disabled = pause.disabled = edit.disabled = true; stop.textContent = 'Saving…';
      if (REC.editing) toggleEdit();
      REC.activeMs = recElapsed(); REC.resumedAt = 0;
      toRecorder('stop');
    });
    frame.addEventListener('pointerdown', editDrag);
    addEventListener('scroll', follow, true);
    addEventListener('resize', follow);
  }

  // Keep the frame and bar positioned; for a picked element, follow it when the page scrolls.
  function place() {
    const { frame, count, bar } = REC.ui, r = REC.rect;
    Object.assign(frame.style, { left: r.x - 6 + 'px', top: r.y - 6 + 'px', width: r.w + 12 + 'px', height: r.h + 12 + 'px' });
    const hp = { nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5] };
    for (const i of frame.children) { const [fx, fy] = hp[i.dataset.h]; Object.assign(i.style, { left: `calc(${fx * 100}% - 8.5px)`, top: `calc(${fy * 100}% - 8.5px)`, cursor: (i.dataset.h.length === 2 ? (i.dataset.h === 'nw' || i.dataset.h === 'se' ? 'nwse' : 'nesw') : 'ns'.includes(i.dataset.h) ? 'ns' : 'ew') + '-resize' }); }
    Object.assign(count.style, { left: Math.min(innerWidth - 60, Math.max(60, r.x + r.w / 2)) + 'px', top: Math.min(innerHeight - 80, Math.max(80, r.y + r.h / 2)) + 'px' });
    if (bar.hidden) return;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    // Keep the bar (and its shadow) at least 16px clear of the recorded region so it never shows in the video.
    let top = r.y - 16 - bh;                                      // above the frame's top-right corner
    if (top < 4) top = r.y + r.h + 16;                            // no room: below the frame
    if (top + bh > innerHeight - 4) top = Math.max(4, r.y + 6);   // no room at all: inside (will be visible in the video)
    const left = Math.min(innerWidth - bw - 4, Math.max(4, r.x + r.w + 6 - bw));
    Object.assign(bar.style, { left: left + 'px', top: top + 'px' });
  }
  function follow() {
    if (REC.raf || !REC.ui) return;
    REC.raf = requestAnimationFrame(() => {
      REC.raf = 0;
      if (REC.el && REC.elBase && !REC.editing && document.contains(REC.el)) {
        const b = REC.el.getBoundingClientRect();
        REC.rect = { ...REC.base, x: REC.base.x + b.left - REC.elBase.left, y: REC.base.y + b.top - REC.elBase.top };
      }
      place();
      if (REC.live) sendRegion();
    });
  }

  function announce(t) { REC.ui.sr.textContent = t; }
  function setPaused(p) {
    REC.paused = p;
    if (p) { REC.activeMs = recElapsed(); REC.resumedAt = 0; toRecorder('pause'); }
    else { REC.resumedAt = performance.now(); toRecorder('resume'); }
    REC.ui.dot.classList.toggle('paused', p);
    REC.ui.pause.textContent = p ? 'Resume' : 'Pause';
  }
  function togglePause() {
    if (REC.editing) return;
    setPaused(!REC.paused);
    announce(REC.paused ? 'Recording paused' : 'Recording resumed');
  }
  function toggleEdit() {
    const { frame, edit, pause } = REC.ui;
    const live = REC.phase === 'live';
    if (!REC.editing) {
      REC.wasPaused = REC.paused;
      if (live && !REC.paused) setPaused(true);
      REC.editing = true; frame.classList.add('edit'); edit.textContent = 'Done'; pause.disabled = true;
      announce((live ? 'Recording paused. ' : '') + 'Drag the frame or its handles, then press Done.');
    } else {
      REC.editing = false; frame.classList.remove('edit'); edit.textContent = 'Edit frame'; pause.disabled = false;
      REC.base = { ...REC.rect };
      if (REC.el) REC.elBase = REC.el.getBoundingClientRect();
      if (live) {
        sendRegion();
        if (!REC.wasPaused) setPaused(false);
        announce(REC.wasPaused ? 'Frame updated' : 'Frame updated, recording resumed');
      } else announce('Frame updated');
    }
    place();
  }
  function editDrag(e) {
    if (!REC.editing) return;
    e.preventDefault(); e.stopPropagation();
    const mode = e.target.dataset?.h || 'move', start = { x: e.clientX, y: e.clientY }, box = { ...REC.rect };
    const tgt = e.currentTarget; tgt.setPointerCapture(e.pointerId);
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const mv = ev => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y, W = innerWidth, H = innerHeight;
      if (mode === 'move') REC.rect = { ...box, x: clamp(box.x + dx, 0, W - box.w), y: clamp(box.y + dy, 0, H - box.h) };
      else {
        let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
        if (mode.includes('w')) x0 = clamp(x0 + dx, 0, x1 - 40);
        if (mode.includes('e')) x1 = clamp(x1 + dx, x0 + 40, W);
        if (mode.includes('n')) y0 = clamp(y0 + dy, 0, y1 - 40);
        if (mode.includes('s')) y1 = clamp(y1 + dy, y0 + 40, H);
        REC.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      place();
    };
    const up = () => { tgt.removeEventListener('pointermove', mv); tgt.removeEventListener('pointerup', up); tgt.removeEventListener('pointercancel', up); };
    tgt.addEventListener('pointermove', mv); tgt.addEventListener('pointerup', up); tgt.addEventListener('pointercancel', up);
  }

  function recEnd() {
    clearInterval(REC.timer); clearInterval(REC.ping);
    removeEventListener('scroll', follow, true); removeEventListener('resize', follow);
    removeEventListener('keydown', REC.cancel, true);
    REC.host?.remove();
    Object.assign(REC, { host: null, ui: null, live: false, phase: null, editing: false, paused: false, el: null, activeMs: 0, resumedAt: 0 });
  }

  // Ready: frame and panel are shown, nothing is recorded, and the page works normally
  // (the frame ignores the mouse). Start recording → countdown → recording.
  function showReady() {
    const { frame, count, bar, dot, time, pause, edit, stop } = REC.ui;
    REC.phase = 'ready';
    frame.classList.add('ready'); count.hidden = true; bar.hidden = false;
    dot.classList.add('paused'); time.textContent = 'Ready'; time.removeAttribute('aria-label');
    pause.textContent = 'Start recording'; pause.className = 'stop'; pause.disabled = false;
    edit.disabled = false; stop.textContent = 'Cancel'; stop.className = ''; stop.disabled = false;
    place();
  }
  function recReady() {
    if (!REC.rect) return false;
    if (REC.ui) recEnd();
    recBuild();
    REC.cancel = e => {
      if (e.key !== 'Escape' || !REC.ui) return;
      if (REC.phase === 'ready' && !REC.editing) { e.preventDefault(); e.stopPropagation(); recEnd(); }
      else if (REC.phase === 'countdown') { e.preventDefault(); e.stopPropagation(); clearInterval(REC.countIv); showReady(); announce('Countdown stopped'); }
    };
    addEventListener('keydown', REC.cancel, true);
    showReady();
    REC.ui.pause.focus({ preventScroll: true });
    announce('Ready to record. Adjust the page or the frame, then press Start recording.');
    return true;
  }
  function startCountdown() {
    if (REC.editing) toggleEdit();
    const { count, num, bar } = REC.ui;
    REC.phase = 'countdown'; bar.hidden = true; count.hidden = false;
    let n = 3; num.textContent = n; place();
    announce('Recording starts in 3 seconds');
    REC.countIv = setInterval(async () => {
      if (--n > 0) { num.textContent = n; return; }
      clearInterval(REC.countIv);
      count.hidden = true;
      await settle(120);                                  // make sure the number is gone from the screen first
      if (!REC.ui || REC.phase !== 'countdown') return;
      const r = await chrome.runtime.sendMessage({ t: 'recGo', dpr: devicePixelRatio,
        rect: { ...REC.rect, vw: innerWidth, vh: innerHeight, sx: scrollX, sy: scrollY } }).catch(e => ({ ok: false, error: e.message }));
      if (!REC.ui) return;
      if (r?.ok) recLive();
      else { recEnd(); const h = hint('Could not start recording: ' + (r?.error || 'unknown error')); setTimeout(() => h.remove(), 5000); }
    }, 1000);
  }
  function recLive() {
    if (!REC.ui) return;
    const { frame, dot, time, pause, stop } = REC.ui;
    REC.live = true; REC.phase = 'live'; REC.resumedAt = performance.now();
    frame.classList.remove('ready'); dot.classList.remove('paused');
    time.textContent = '00:00'; time.setAttribute('aria-label', 'Recorded time');
    pause.textContent = 'Pause'; pause.className = ''; stop.textContent = 'Stop'; stop.className = 'stop';
    REC.ui.bar.hidden = false; place();
    REC.ui.stop.focus({ preventScroll: true });
    announce('Recording started');
    REC.timer = setInterval(() => { if (REC.ui) REC.ui.time.textContent = fmt(recElapsed()); }, 250);
    REC.ping = setInterval(() => toRecorder('ping'), 10000);   // keeps Firefox's background page awake
  }

  const handlers = {
    viewport: () => ({ vw: innerWidth, vh: innerHeight }),
    async prepare() {
      S.orig = { x: scrollX, y: scrollY };
      addStyle();
      await settle(80);
      return { vw: innerWidth, vh: innerHeight, totalH: Math.max(root().scrollHeight, innerHeight) };
    },
    async scroll({ y, i }) {
      if (i > 0) markFloating();
      window.scrollTo(0, y);
      await settle(i === 1 ? 260 : 140);
      return { y: window.scrollY };
    },
    autoElement() {
      let best = null, area = innerWidth * innerHeight * 0.3;
      for (const el of document.body.querySelectorAll('*')) {
        if (!scrollable(el)) continue;
        const b = el.getBoundingClientRect();
        const a = Math.max(0, Math.min(b.right, innerWidth) - Math.max(b.left, 0)) * Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0));
        if (a > area) { area = a; best = el; }
      }
      S.el = best;
      return !!best;
    },
    async elPrepare() {
      if (!S.el) throw new Error('No area selected');
      if (!S.orig) S.orig = { x: scrollX, y: scrollY };
      addStyle();
      S.elOrig = { top: S.el.scrollTop, left: S.el.scrollLeft };
      S.elBehavior = S.el.style.scrollBehavior;
      S.el.style.scrollBehavior = 'auto';
      S.el.scrollIntoView({ block: S.el.getBoundingClientRect().height > innerHeight ? 'start' : 'nearest', inline: 'nearest' });
      S.el.scrollLeft = 0;
      await settle(80);
      return elInfo();
    },
    elKind() { return S.el && scrollable(S.el) ? 'scroll' : 'box'; },
    async boxPrepare() {
      if (!S.el) throw new Error('Nothing selected');
      S.orig = { x: scrollX, y: scrollY };
      addStyle();
      const fixed = fixedAncestor(S.el);
      // Floating headers/banners would cover the element while the page scrolls past: hide the unrelated ones.
      for (const el of document.body.querySelectorAll('*')) {
        if (el.contains(S.el) || S.el.contains(el)) continue;
        const p = getComputedStyle(el).position;
        if (p === 'fixed' && !fixed) el.setAttribute('data-cc-fixed', '');
        else if (p === 'sticky') el.setAttribute('data-cc-sticky', '');
      }
      if (!fixed) window.scrollBy(0, S.el.getBoundingClientRect().top);
      await settle(200);
      return boxInfo();
    },
    async boxScroll({ dy }) { window.scrollBy(0, dy); await settle(); return boxInfo(); },
    async elScroll({ y }) { S.el.scrollTop = y; await settle(); return elInfo(); },
    async elTail() { S.el.scrollIntoView({ block: 'end' }); await settle(); return elInfo(); },
    restore() { restore(); return true; },
    recReady() { return recReady(); },
    recLive() { recLive(); return true; },
    recEnd() { recEnd(); return true; },
    pickArea({ purpose }) { pickArea(purpose); return true; },
    pickElement({ purpose }) { pickElement(purpose); return true; }
  };

  chrome.runtime.onMessage.addListener((msg, _s, respond) => {
    const h = handlers[msg.t];
    if (!h) return;
    Promise.resolve().then(() => h(msg)).then(respond, e => { console.warn(e); respond(null); });
    return true;
  });
})();
