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
      chrome.runtime.sendMessage({ t: 'picked', mode: 'area', purpose, rect: { ...rect, vw: innerWidth, vh: innerHeight } });
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
        await settle(60);
        chrome.runtime.sendMessage({ t: 'picked', mode: 'area', purpose, rect: { x, y, w, h, vw: innerWidth, vh: innerHeight } });
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
