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
    h.textContent = text;
    h.style.cssText = `all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:${Z};background:#111827;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none`;
    document.documentElement.appendChild(h);
    return h;
  }

  function pickArea() {
    const ov = document.createElement('div');
    ov.style.cssText = `all:initial;position:fixed;inset:0;z-index:${Z};cursor:crosshair;background:rgba(0,0,0,.25)`;
    const box = document.createElement('div');
    box.style.cssText = 'all:initial;position:fixed;display:none;border:1px solid #fff;outline:1px dashed #2563eb;box-shadow:0 0 0 99999px rgba(0,0,0,.45);pointer-events:none';
    ov.appendChild(box);
    const tip = hint('Drag to select an area · Esc to cancel');
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
      chrome.runtime.sendMessage({ t: 'picked', mode: 'area', rect: { ...rect, vw: innerWidth, vh: innerHeight } });
    });
  }

  function pickElement() {
    const box = document.createElement('div');
    box.style.cssText = `all:initial;position:fixed;display:none;z-index:${Z};border:2px solid #2563eb;background:rgba(37,99,235,.15);pointer-events:none;box-sizing:border-box`;
    const tip = hint('Click a scrollable area · Esc to cancel');
    document.documentElement.appendChild(box);
    let cur = null;
    const move = e => {
      cur = scrollParent(document.elementFromPoint(e.clientX, e.clientY));
      if (!cur) { box.style.display = 'none'; tip.textContent = 'No scrollable area here — use Full page instead · Esc to cancel'; return; }
      tip.textContent = 'Click to capture this scrollable area · Esc to cancel';
      const b = cur.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' });
    };
    const stop = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    const done = () => {
      box.remove(); tip.remove();
      removeEventListener('mousemove', move, true); removeEventListener('keydown', key, true);
      for (const t of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) removeEventListener(t, click, true);
    };
    const key = e => { if (e.key === 'Escape') { stop(e); done(); } };
    const click = async e => {
      stop(e);
      if (e.type !== 'click') return;
      done();
      if (!cur) return;
      S.el = cur;
      await settle(60);
      chrome.runtime.sendMessage({ t: 'picked', mode: 'element' });
    };
    addEventListener('mousemove', move, true); addEventListener('keydown', key, true);
    for (const t of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) addEventListener(t, click, true);
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
    async elScroll({ y }) { S.el.scrollTop = y; await settle(); return elInfo(); },
    async elTail() { S.el.scrollIntoView({ block: 'end' }); await settle(); return elInfo(); },
    restore() { restore(); return true; },
    pickArea() { pickArea(); return true; },
    pickElement() { pickElement(); return true; }
  };

  chrome.runtime.onMessage.addListener((msg, _s, respond) => {
    const h = handlers[msg.t];
    if (!h) return;
    Promise.resolve().then(() => h(msg)).then(respond, e => { console.warn(e); respond(null); });
    return true;
  });
})();
