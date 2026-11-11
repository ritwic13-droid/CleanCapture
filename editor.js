import { getCapture } from './db.js';

const $ = s => document.querySelector(s);
const view = $('#view'), ctx = view.getContext('2d');
const stage = $('#stage'), scroller = $('#scroller'), textLayer = $('#textlayer');
const base = document.createElement('canvas');   // stitched, untouched screenshot
const measure = document.createElement('canvas').getContext('2d');

let ratio = 1;                 // image pixels per CSS pixel of the captured page
let state = { shapes: [], crop: null };
let history = [], hIndex = -1;
let tool = 'arrow', blurForm = 'rect', zoom = 1, title = 'capture', pending = false;
let draft = null, selected = -1, drag = null, erased = false, erasing = false;
let cropBox = null, cropDrag = null;
const ocr = { lines: null, busy: false };

/* ---------- toolbar ---------- */
const ICONS = {
  select: '<path d="M5 3l14 8-6 2-2 6z"/>',
  crop: '<path d="M6 2v16h16M2 6h16v16"/>',
  pen: '<path d="M4 20l1-5L16 4l4 4L9 19z"/>',
  hl: '<path d="M4 20h7M9 15l-3 3M9 15l8-11 4 3-8 11z"/>',
  eraser: '<path d="M9 20h11M4.6 14.4l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L10 19H7l-2.4-2.4a1.6 1.6 0 0 1 0-2.2zM10 9l5 5"/>',
  shapes: '<rect x="3" y="3" width="11" height="11" rx="1"/><circle cx="15.5" cy="15.5" r="5.5"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5M9 5h10v10"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  step: '<circle cx="12" cy="12" r="9"/><path d="M11 9l2-1v8"/>',
  mag: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  blur: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11z"/>',
  ocr: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8M8 12h8M8 15h5"/>'
};
const TITLES = {
  select: 'Select, move and resize (Delete removes)', crop: 'Crop', pen: 'Pen', hl: 'Highlighter', eraser: 'Eraser (click or drag over annotations)',
  shapes: 'Shapes', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', text: 'Text', step: 'Numbered step',
  mag: 'Magnifier', blur: 'Blur', ocr: 'Select text in the image'
};
const MENUS = {
  shapes: [['rect', 'Rectangle', 'rect'], ['ellipse', 'Ellipse', 'ellipse'], ['line', 'Line', 'line'], ['arrow', 'Arrow', 'arrow']],
  blur: [['rect', 'Rectangle', 'rect'], ['ellipse', 'Ellipse', 'ellipse'], ['brush', 'Brush (freehand)', 'pen']]
};
const TOOLBAR = ['select', 'crop', 'pen', 'hl', 'eraser', 'shapes', 'text', 'step', 'mag', 'blur', 'ocr'];
const svg = k => new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`, 'image/svg+xml').documentElement;

function closeMenus(except) {
  for (const m of document.querySelectorAll('.menu')) {
    if (m === except) continue;
    m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false');
  }
}
for (const k of TOOLBAR) {
  const b = document.createElement('button');
  b.title = TITLES[k]; b.setAttribute('aria-label', TITLES[k]); b.appendChild(svg(k));
  if (!MENUS[k]) {
    b.dataset.tool = k;
    b.addEventListener('click', () => setTool(k));
    $('#tools').appendChild(b);
    continue;
  }
  // dropdown button
  const wrap = document.createElement('div'); wrap.className = 'menuwrap';
  const caret = document.createElement('span'); caret.className = 'caret'; caret.textContent = '▾'; caret.setAttribute('aria-hidden', 'true');
  b.appendChild(caret); b.dataset.menu = k; b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div'); menu.className = 'menu'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', TITLES[k]);
  for (const [key, label, icon] of MENUS[k]) {
    const item = document.createElement('button');
    item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-checked', 'false'); item.dataset.key = key;
    item.appendChild(svg(icon)); item.append(label);
    item.addEventListener('click', () => {
      closeMenus();
      if (k === 'blur') { blurForm = key; setTool('blur'); } else setTool(key);
      b.focus();
    });
    menu.appendChild(item);
  }
  b.addEventListener('click', () => {
    const open = menu.hidden;
    closeMenus(menu);
    menu.hidden = !open; b.setAttribute('aria-expanded', String(open));
    if (open) (menu.querySelector('[aria-checked=true]') || menu.firstElementChild).focus();
  });
  menu.addEventListener('keydown', e => {
    const items = [...menu.children], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); closeMenus(); b.focus(); }
  });
  wrap.append(b, menu);
  $('#tools').appendChild(wrap);
}
addEventListener('pointerdown', e => { if (!e.target.closest('.menuwrap')) closeMenus(); });

const SHAPES = ['rect', 'ellipse', 'line', 'arrow'];
function setTool(k) {
  const prev = tool;
  tool = k; selected = -1; draft = null; cropDrag = null;
  for (const b of document.querySelectorAll('#tools > button')) {
    b.classList.toggle('active', b.dataset.tool === k); b.setAttribute('aria-pressed', b.dataset.tool === k);
  }
  for (const b of document.querySelectorAll('#tools [data-menu]')) {
    const on = b.dataset.menu === 'blur' ? k === 'blur' : SHAPES.includes(k);
    b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    const cur = b.dataset.menu === 'blur' ? (on ? blurForm : '') : k;
    for (const it of b.nextElementSibling.children) it.setAttribute('aria-checked', String(it.dataset.key === cur));
  }
  view.style.cursor = k === 'select' || k === 'eraser' ? 'default' : k === 'text' ? 'text' : 'crosshair';
  $('#cropbar').hidden = k !== 'crop';
  $('#textbar').hidden = k !== 'ocr';
  textLayer.hidden = k !== 'ocr';
  cropBox = k === 'crop' ? { ...(state.crop || FULL()) } : null;
  if (k === 'crop' || prev === 'crop') fit(true); else applyZoom();
  if (k === 'ocr') runOcr();
  schedule();
}

function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  $('#sr').textContent = msg;                    // announce to screen readers
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms);
}

/* ---------- load & stitch ---------- */
async function load() {
  const cap = await getCapture(new URLSearchParams(location.search).get('id'));
  if (!cap) { stage.remove(); toast('This capture is no longer stored. Take a new one.', 60000); return; }
  title = cap.title;
  document.title = cap.title + ' – Clean Capture';
  const bmps = await Promise.all(cap.frames.map(f => createImageBitmap(f.blob)));
  const s = bmps[0].width / cap.frames[0].vw;
  const W0 = cap.w * s, H0 = cap.h * s;
  const k = Math.min(1, 32000 / W0, 32000 / H0, Math.sqrt(2.4e8 / (W0 * H0)));   // stay inside canvas limits
  ratio = s * k;
  base.width = Math.max(1, Math.round(W0 * k));
  base.height = Math.max(1, Math.round(H0 * k));
  const b = base.getContext('2d');
  cap.frames.forEach((f, i) => {
    const fs = bmps[i].width / f.vw;
    b.drawImage(bmps[i], f.sx * fs, f.sy * fs, f.sw * fs, f.sh * fs,
      Math.round(f.dx * ratio), Math.round(f.dy * ratio), Math.ceil(f.sw * ratio), Math.ceil(f.sh * ratio));
    bmps[i].close();
  });
  commit();
  fit(true);
  setTool('arrow');
  render();
  // Put the fresh screenshot on the clipboard straight away (needs the tab to be focused).
  const big = k < 1 ? ` Very large page: scaled to ${Math.round(k * 100)}%.` : '';
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': output('image/png') })]);
    toast('Screenshot copied to clipboard.' + big, 3500);
  } catch { if (big) toast(big.trim(), 5000); }
}

/* ---------- state ---------- */
const FULL = () => ({ x: 0, y: 0, w: base.width, h: base.height });
const C = () => (tool === 'crop' ? FULL() : state.crop || FULL());   // visible region; whole image while cropping
function commit() {
  history = history.slice(0, hIndex + 1);
  history.push(JSON.stringify(state));
  hIndex++;
  refresh();
}
function travel(d) {
  if (hIndex + d < 0 || hIndex + d >= history.length) return;
  hIndex += d; state = JSON.parse(history[hIndex]); selected = -1;
  if (tool === 'crop') cropBox = { ...(state.crop || FULL()) };
  refresh();
}
function refresh() {
  $('#undo').disabled = hIndex <= 0;
  $('#redo').disabled = hIndex >= history.length - 1;
  applyZoom(); schedule();
}
function applyZoom() {
  const c = C();
  view.style.width = c.w * zoom + 'px'; view.style.height = c.h * zoom + 'px';
  $('#zlabel').textContent = Math.round(zoom * ratio * 100) + '%';
  layoutText();
}
function fit(initial) {
  const avail = scroller.clientWidth - 48, c = C();
  const natural = 1 / ratio;                                // 100% = same size as on the page
  zoom = initial ? Math.min(natural, avail / c.w) : avail / c.w;
  applyZoom();
}
function setZoom(f) { zoom = Math.min(8 / ratio, Math.max(0.05 / ratio, zoom * f)); applyZoom(); }

/* ---------- drawing ---------- */
const nr = s => ({ x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) });
const fontPx = s => (10 + s.size * 3) * ratio;
const stepR = s => (9 + s.size * 1.5) * ratio;
const brushW = s => Math.max(8, s.size * 6) * ratio;
const setFont = s => { ctx.font = `600 ${fontPx(s)}px system-ui, sans-serif`; ctx.textBaseline = 'top'; };

function bbox(s) {
  let pad = (s.size || 1) * ratio + 4;
  let x, y, w, h;
  if (s.pts) {
    if (s.type === 'blur') pad = brushW(s) / 2;
    const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]);
    x = Math.min(...xs); y = Math.min(...ys); w = Math.max(...xs) - x; h = Math.max(...ys) - y;
  } else if (s.type === 'text') {
    setFont(s);
    const lines = s.text.split('\n');
    x = s.x; y = s.y; w = Math.max(...lines.map(l => ctx.measureText(l).width)); h = lines.length * fontPx(s) * 1.25; pad = 4;
  } else if (s.type === 'step') {
    const r = stepR(s); x = s.x - r; y = s.y - r; w = h = 2 * r;
  } else if (s.type === 'mag') {
    const r = Math.hypot(s.x2 - s.x1, s.y2 - s.y1); x = s.x1 - r; y = s.y1 - r; w = h = 2 * r;
  } else ({ x, y, w, h } = nr(s));
  return { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad };
}
function moveShape(s, dx, dy) {
  if (s.pts) s.pts = s.pts.map(([x, y]) => [x + dx, y + dy]);
  else if ('x1' in s) { s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy; }
  else { s.x += dx; s.y += dy; }
}
const hitShape = p => {
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const b = bbox(state.shapes[i]);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
  }
  return -1;
};

function drawBlur(s) {
  const form = s.form || 'rect';
  const b = form === 'brush' ? bbox(s) : nr(s);
  const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
  const w = Math.min(base.width, Math.ceil(b.x + b.w)) - x, h = Math.min(base.height, Math.ceil(b.y + b.h)) - y;
  if (w < 2 || h < 2) return;
  const block = Math.max(6, s.size * 3) * ratio;
  const t = document.createElement('canvas');                // tiny copy = pixelation
  t.width = Math.max(1, Math.round(w / block)); t.height = Math.max(1, Math.round(h / block));
  t.getContext('2d').drawImage(base, x, y, w, h, 0, 0, t.width, t.height);
  const m = document.createElement('canvas'); m.width = w; m.height = h;
  const g = m.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(t, 0, 0, t.width, t.height, 0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';            // keep only the chosen shape
  g.translate(-x, -y);
  if (form === 'brush') {
    g.lineWidth = brushW(s); g.lineCap = g.lineJoin = 'round';
    g.beginPath(); s.pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    if (s.pts.length === 1) g.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
    g.stroke();
  } else if (form === 'ellipse') {
    g.beginPath(); g.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); g.fill();
  } else g.fillRect(b.x, b.y, b.w, b.h);
  ctx.drawImage(m, x, y);
}

function drawShape(s) {
  const lw = s.size * ratio, alpha = s.opacity ?? 1;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = lw; ctx.lineCap = ctx.lineJoin = 'round';
  switch (s.type) {
    case 'line': ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); break;
    case 'arrow': {
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      const head = Math.min(len, Math.max(12 * ratio, lw * 4));
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2 - Math.cos(a) * head * 0.8, s.y2 - Math.sin(a) * head * 0.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - head * Math.cos(a - 0.45), s.y2 - head * Math.sin(a - 0.45));
      ctx.lineTo(s.x2 - head * Math.cos(a + 0.45), s.y2 - head * Math.sin(a + 0.45));
      ctx.closePath(); ctx.fill(); break;
    }
    case 'rect': { const r = nr(s); ctx.lineJoin = 'miter'; ctx.strokeRect(r.x, r.y, r.w, r.h); break; }
    case 'ellipse': { const r = nr(s); ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); ctx.stroke(); break; }
    case 'hl': ctx.globalAlpha = 0.4 * alpha; ctx.lineWidth = lw * 5; ctx.lineCap = 'butt'; // falls through
    case 'pen':
      ctx.beginPath(); s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
      ctx.stroke(); break;
    case 'text':
      setFont(s);
      s.text.split('\n').forEach((l, i) => ctx.fillText(l, s.x, s.y + i * fontPx(s) * 1.25));
      break;
    case 'step': {
      const r = stepR(s);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 ${r * 1.1}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.n, s.x, s.y + r * 0.05); break;
    }
    case 'mag': {                                            // loupe: 2x view of what is underneath
      const r = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      if (r < 2) break;
      ctx.globalAlpha = 1;
      ctx.save(); ctx.beginPath(); ctx.arc(s.x1, s.y1, r, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#fff'; ctx.fillRect(s.x1 - r, s.y1 - r, 2 * r, 2 * r);
      ctx.drawImage(base, s.x1 - r / 2, s.y1 - r / 2, r, r, s.x1 - r, s.y1 - r, 2 * r, 2 * r);
      ctx.restore();
      ctx.lineWidth = Math.max(lw, 2 * ratio);
      ctx.beginPath(); ctx.arc(s.x1, s.y1, r, 0, Math.PI * 2); ctx.stroke(); break;
    }
    case 'blur': ctx.globalAlpha = 1; drawBlur(s); break;
  }
  ctx.restore();
}

/* ---------- crop frame with handles ---------- */
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', new: 'crosshair' };
const handlePts = b => ({ nw: [b.x, b.y], n: [b.x + b.w / 2, b.y], ne: [b.x + b.w, b.y], e: [b.x + b.w, b.y + b.h / 2], se: [b.x + b.w, b.y + b.h], s: [b.x + b.w / 2, b.y + b.h], sw: [b.x, b.y + b.h], w: [b.x, b.y + b.h / 2] });
function cropHit(p) {
  const t = 14 / zoom, pts = handlePts(cropBox);
  for (const k of HANDLES) if (Math.abs(p.x - pts[k][0]) <= t && Math.abs(p.y - pts[k][1]) <= t) return k;
  const b = cropBox, inX = p.x > b.x - t && p.x < b.x + b.w + t, inY = p.y > b.y - t && p.y < b.y + b.h + t;
  if (inY && Math.abs(p.x - b.x) <= t) return 'w';           // anywhere along an edge resizes it
  if (inY && Math.abs(p.x - (b.x + b.w)) <= t) return 'e';
  if (inX && Math.abs(p.y - b.y) <= t) return 'n';
  if (inX && Math.abs(p.y - (b.y + b.h)) <= t) return 's';
  return p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h ? 'move' : 'new';
}
function cropMove(p) {
  const { mode, start, box } = cropDrag, dx = p.x - start.x, dy = p.y - start.y, W = base.width, H = base.height;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  if (mode === 'move') { cropBox = { ...box, x: clamp(box.x + dx, 0, W - box.w), y: clamp(box.y + dy, 0, H - box.h) }; return; }
  let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
  if (mode === 'new') { x0 = start.x; y0 = start.y; x1 = p.x; y1 = p.y; }
  else {
    if (mode.includes('w')) x0 += dx;
    if (mode.includes('e')) x1 += dx;
    if (mode.includes('n')) y0 += dy;
    if (mode.includes('s')) y1 += dy;
  }
  x0 = clamp(x0, 0, W); x1 = clamp(x1, 0, W); y0 = clamp(y0, 0, H); y1 = clamp(y1, 0, H);
  cropBox = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(8, Math.abs(x1 - x0)), h: Math.max(8, Math.abs(y1 - y0)) };
}
function drawCrop() {
  const b = cropBox, px = 1 / zoom;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath();
  ctx.rect(0, 0, base.width, base.height); ctx.rect(b.x, b.y, b.w, b.h); ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = px; ctx.beginPath();   // rule of thirds
  for (const f of [1 / 3, 2 / 3]) { ctx.moveTo(b.x + b.w * f, b.y); ctx.lineTo(b.x + b.w * f, b.y + b.h); ctx.moveTo(b.x, b.y + b.h * f); ctx.lineTo(b.x + b.w, b.y + b.h * f); }
  ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * px; ctx.strokeRect(b.x, b.y, b.w, b.h);
  const hs = 12 * px, pts = handlePts(b);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2 * px;
  for (const k of HANDLES) {                                 // keep handles fully visible at the image edge
    const hx = Math.min(base.width - hs - px, Math.max(px, pts[k][0] - hs / 2)), hy = Math.min(base.height - hs - px, Math.max(px, pts[k][1] - hs / 2));
    ctx.fillRect(hx, hy, hs, hs); ctx.strokeRect(hx, hy, hs, hs);
  }
  ctx.restore();
}
function applyCrop() {
  const f = FULL(), b = cropBox;
  const r = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
  r.w = Math.min(r.w, f.w - r.x); r.h = Math.min(r.h, f.h - r.y);
  const whole = r.x === 0 && r.y === 0 && r.w === f.w && r.h === f.h;
  const next = whole ? null : r;
  if (JSON.stringify(next) !== JSON.stringify(state.crop)) { state.crop = next; commit(); toast(whole ? 'Crop removed' : 'Cropped — Ctrl+Z to undo'); }
  setTool('select');
}

/* ---------- render ---------- */
function render(exporting = false) {
  const c = exporting ? state.crop || FULL() : C();
  if (view.width !== c.w || view.height !== c.h) { view.width = c.w; view.height = c.h; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(base, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  ctx.translate(-c.x, -c.y);
  state.shapes.forEach(drawShape);
  if (exporting) return;
  if (draft) drawShape(draft);
  if (tool === 'crop' && cropBox) drawCrop();
  if (selected >= 0 && state.shapes[selected]) {
    const s = state.shapes[selected], b = bbox(s);
    ctx.save(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = Math.max(1, 1.5 / zoom);
    ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.strokeRect(b.x, b.y, b.w, b.h);
    if (s.type === 'text') {                                 // resize handle
      const hs = 12 / zoom; ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.lineWidth = 2 / zoom;
      ctx.fillRect(b.x + b.w - hs / 2, b.y + b.h - hs / 2, hs, hs); ctx.strokeRect(b.x + b.w - hs / 2, b.y + b.h - hs / 2, hs, hs);
    }
    ctx.restore();
  }
}
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}

/* ---------- pointer input ---------- */
function pos(e) {
  const r = view.getBoundingClientRect(), c = C();
  return { x: c.x + ((e.clientX - r.left) / r.width) * c.w, y: c.y + ((e.clientY - r.top) / r.height) * c.h };
}
const style = () => ({ color: $('#color').value, size: +$('#size').value, opacity: +$('#opacity').value / 100 });
const onTextHandle = p => {
  const s = state.shapes[selected];
  if (!s || s.type !== 'text') return false;
  const b = bbox(s), t = 12 / zoom;
  return Math.abs(p.x - (b.x + b.w)) <= t && Math.abs(p.y - (b.y + b.h)) <= t;
};
function eraseAt(p) {
  const i = hitShape(p);
  if (i >= 0) { state.shapes.splice(i, 1); erased = true; schedule(); }
}

view.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  const p = pos(e);
  if (tool === 'crop') {
    cropDrag = { mode: cropHit(p), start: p, box: { ...cropBox } };
    view.setPointerCapture(e.pointerId); return;
  }
  if (tool === 'select') {
    if (onTextHandle(p)) {
      const s = state.shapes[selected], b = bbox(s);
      drag = { resize: true, top: b.y, h0: b.h, size0: s.size, moved: false };
      view.setPointerCapture(e.pointerId); return;
    }
    selected = hitShape(p);
    if (selected >= 0) {
      const s = state.shapes[selected];
      $('#color').value = s.color; $('#size').value = Math.min(12, Math.max(1, Math.round(s.size))); $('#opacity').value = Math.round((s.opacity ?? 1) * 100);
      drag = { x: p.x, y: p.y, moved: false }; view.setPointerCapture(e.pointerId);
    }
    return schedule();
  }
  if (tool === 'eraser') { erasing = true; erased = false; view.setPointerCapture(e.pointerId); return eraseAt(p); }
  if (tool === 'text') return void setTimeout(() => openText(p), 0);
  if (tool === 'step') {
    const n = state.shapes.filter(s => s.type === 'step').length + 1;
    state.shapes.push({ type: 'step', x: p.x, y: p.y, n, ...style() });
    return commit();
  }
  view.setPointerCapture(e.pointerId);
  if (tool === 'pen' || tool === 'hl') draft = { type: tool, pts: [[p.x, p.y]], ...style() };
  else if (tool === 'blur' && blurForm === 'brush') draft = { type: 'blur', form: 'brush', pts: [[p.x, p.y]], ...style() };
  else draft = { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...style(), ...(tool === 'blur' ? { form: blurForm } : {}) };
  schedule();
});
view.addEventListener('pointermove', e => {
  const p = pos(e);
  if (tool === 'crop') {
    if (cropDrag) { cropMove(p); schedule(); } else view.style.cursor = CURSORS[cropHit(p)];
    return;
  }
  if (tool === 'select' && !drag) view.style.cursor = onTextHandle(p) ? 'nwse-resize' : 'default';
  if (drag && selected >= 0) {
    const s = state.shapes[selected];
    if (drag.resize) {                                       // scale the text by dragging its corner
      const k = Math.max(0.15, (p.y - drag.top) / drag.h0);
      s.size = Math.max(-2, ((10 + drag.size0 * 3) * k - 10) / 3);
    } else { moveShape(s, p.x - drag.x, p.y - drag.y); drag.x = p.x; drag.y = p.y; }
    drag.moved = true;
    return schedule();
  }
  if (erasing) return eraseAt(p);
  if (!draft) return;
  if (draft.pts) draft.pts.push([p.x, p.y]);
  else {
    draft.x2 = p.x; draft.y2 = p.y;
    if (e.shiftKey && (draft.type === 'rect' || draft.type === 'ellipse' || draft.type === 'blur')) {
      const d = Math.max(Math.abs(p.x - draft.x1), Math.abs(p.y - draft.y1));
      draft.x2 = draft.x1 + Math.sign(p.x - draft.x1) * d; draft.y2 = draft.y1 + Math.sign(p.y - draft.y1) * d;
    }
  }
  schedule();
});
function endPointer() {
  if (cropDrag) { cropDrag = null; return schedule(); }
  if (drag) { const moved = drag.moved; drag = null; if (moved) commit(); return; }
  if (erasing) { erasing = false; if (erased) commit(); return; }
  if (!draft) return;
  const d = draft; draft = null;
  const tiny = !d.pts && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < (d.type === 'mag' ? 8 : 3);
  if (tiny) return schedule();
  state.shapes.push(d); commit();
}
view.addEventListener('pointerup', endPointer);
view.addEventListener('pointercancel', endPointer);

function openText(p) {
  const c = C(), st = style();
  const ta = document.createElement('textarea');
  const fs = fontPx(st) * zoom;
  Object.assign(ta.style, { left: (p.x - c.x) * zoom + 'px', top: (p.y - c.y) * zoom + 'px', fontSize: fs + 'px', color: st.color });
  ta.rows = 1; ta.cols = 12;
  ta.setAttribute('aria-label', 'Annotation text. Enter to place, Escape to cancel.');
  const grow = () => { ta.rows = ta.value.split('\n').length; ta.cols = Math.max(12, ...ta.value.split('\n').map(l => l.length + 2)); };
  let cancelled = false;
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { cancelled = true; ta.blur(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
  });
  ta.addEventListener('blur', () => {
    const text = ta.value.trimEnd(); ta.remove();
    if (cancelled || !text) return;
    state.shapes.push({ type: 'text', x: p.x + 1 / zoom, y: p.y + 1 / zoom, text, ...st });
    commit();
    setTool('select'); selected = state.shapes.length - 1; schedule();   // ready to move or resize
  });
  stage.appendChild(ta); ta.focus();
}

// Colour / size / opacity also restyle the selected annotation.
for (const id of ['color', 'size', 'opacity']) {
  $('#' + id).addEventListener('input', () => {
    const s = state.shapes[selected];
    if (!s) return;
    Object.assign(s, style()); schedule();
  });
  $('#' + id).addEventListener('change', () => { if (state.shapes[selected]) commit(); });
}

/* ---------- text in the image (offline recognition) ---------- */
const setOcrStatus = t => { $('#ocrStatus').textContent = t; };
async function runOcr() {
  if (ocr.lines || ocr.busy) return layoutText();
  ocr.busy = true; setOcrStatus('Reading text… (first time takes a few seconds)');
  const rel = p => new URL(p, location.href).href;
  let worker;
  try {
    const up = ratio < 1.5 ? 2 : 1;                           // small text reads better enlarged
    const TILE = Math.floor(3000 / up), tiles = Math.ceil(base.height / TILE);
    let ti = 0;
    worker = await Tesseract.createWorker('eng', 1, {
      workerPath: rel('vendor/tesseract/worker.min.js'), corePath: rel('vendor/tesseract/tesseract-core-simd-lstm.wasm.js'),
      langPath: rel('vendor/tesseract'), workerBlobURL: false, gzip: true, cacheMethod: 'none',
      logger: m => { if (m.status === 'recognizing text') setOcrStatus(`Reading text… ${Math.round(((ti + m.progress) / tiles) * 100)}%`); }
    });
    const lines = [];
    for (; ti < tiles; ti++) {
      const y = ti * TILE, h = Math.min(TILE, base.height - y);
      const t = document.createElement('canvas'); t.width = base.width * up; t.height = h * up;
      t.getContext('2d').drawImage(base, 0, y, base.width, h, 0, 0, t.width, t.height);
      const { data } = await worker.recognize(t, {}, { blocks: true });
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
        const text = (l.text || '').trim();
        if (!text || l.confidence < 30) continue;
        lines.push({ text, x: l.bbox.x0 / up, y: l.bbox.y0 / up + y, w: (l.bbox.x1 - l.bbox.x0) / up, h: (l.bbox.y1 - l.bbox.y0) / up });
      }
    }
    ocr.lines = lines;
    setOcrStatus(lines.length ? 'Drag across the text to select it.' : 'No text found in this image.');
  } catch (e) {
    console.error(e); setOcrStatus('Could not read text: ' + (e.message || e));
  } finally { ocr.busy = false; worker?.terminate(); }
  $('#txtAll').disabled = !ocr.lines?.length;
  layoutText();
}
const visibleLines = () => { const c = C(); return (ocr.lines || []).filter(l => l.x + l.w > c.x && l.x < c.x + c.w && l.y + l.h > c.y && l.y < c.y + c.h); };
function layoutText() {
  textLayer.replaceChildren();
  if (tool !== 'ocr' || !ocr.lines) return;
  const c = C();
  for (const l of visibleLines()) {
    const d = document.createElement('div'), fs = Math.max(4, l.h * zoom * 0.8);
    d.textContent = l.text;
    measure.font = `${fs}px system-ui, sans-serif`;
    const nat = measure.measureText(l.text).width || 1;
    Object.assign(d.style, { left: (l.x - c.x) * zoom + 'px', top: (l.y - c.y) * zoom + 'px', height: l.h * zoom + 'px', lineHeight: l.h * zoom + 'px',
      fontSize: fs + 'px', transform: `scaleX(${(l.w * zoom) / nat})` });
    textLayer.appendChild(d);
  }
}
const selectedText = () => {
  const sel = getSelection();
  return sel.rangeCount && textLayer.contains(sel.anchorNode) ? sel.toString().trim() : '';
};
document.addEventListener('selectionchange', () => {
  const has = !!selectedText();
  $('#txtCopy').disabled = $('#txtSearch').disabled = !has;
});
$('#txtCopy').onclick = async () => { await navigator.clipboard.writeText(selectedText()); toast('Text copied'); };
$('#txtAll').onclick = async () => { await navigator.clipboard.writeText(visibleLines().map(l => l.text).join('\n')); toast('All text copied'); };
// Opens a normal Google search tab with the selected text. Nothing else is sent anywhere.
$('#txtSearch').onclick = () => { const q = selectedText(); if (q) window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noopener'); };

/* ---------- export ---------- */
function fileName(ext) {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  const name = (title || 'capture').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 60) || 'capture';
  return `${name} ${stamp}.${ext}`;
}
const canvasBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));
async function output(type, q) { render(true); const b = canvasBlob(view, type, q); render(); return b; }
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();   // Firefox needs the link in the document
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

function makePdf(pages) {
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const push = d => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; };
  const obj = (n, body, stream) => {
    offs[n] = len; push(`${n} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  const f = n => n.toFixed(2);
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  pages.forEach((p, i) => {
    const a = 3 + i * 3, content = `q ${f(p.w)} 0 0 ${f(p.h)} ${f(p.x)} ${f(p.y)} cm /Im0 Do Q`;
    obj(a, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(p.pw)} ${f(p.ph)}] /Resources << /XObject << /Im0 ${a + 2} 0 R >> >> /Contents ${a + 1} 0 R >>`);
    obj(a + 1, `<< /Length ${content.length} >>`, content);
    obj(a + 2, `<< /Type /XObject /Subtype /Image /Width ${p.iw} /Height ${p.ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>`, p.jpg);
  });
  const count = 3 + pages.length * 3, xref = len;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(String(offs[n]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
async function savePdf(a4) {
  toast('Building PDF…', 60000);
  render(true);
  const W = view.width, H = view.height, slices = [];
  const PW = 595.28, PH = 841.89, M = 20;
  let pages;
  if (a4) {
    const sc = (PW - 2 * M) / W, per = Math.max(1, Math.floor((PH - 2 * M) / sc));
    for (let y = 0; y < H; y += per) slices.push({ y, h: Math.min(per, H - y) });
    pages = slices.map(s => ({ pw: PW, ph: PH, x: M, w: W * sc, h: s.h * sc, y: PH - M - s.h * sc, iw: W, ih: s.h }));
  } else {
    const sc = Math.min(0.75 / ratio, 14400 / W, 14400 / H);
    slices.push({ y: 0, h: H });
    pages = [{ pw: W * sc, ph: H * sc, x: 0, y: 0, w: W * sc, h: H * sc, iw: W, ih: H }];
  }
  const cvs = slices.map(s => {                       // copy slices synchronously, before the canvas is redrawn
    const t = document.createElement('canvas'); t.width = W; t.height = s.h;
    const c = t.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, W, s.h);
    c.drawImage(view, 0, s.y, W, s.h, 0, 0, W, s.h); return t;
  });
  render();
  for (let i = 0; i < cvs.length; i++) pages[i].jpg = new Uint8Array(await (await canvasBlob(cvs[i], 'image/jpeg', 0.92)).arrayBuffer());
  download(makePdf(pages), fileName('pdf'));
  toast(`PDF saved (${pages.length} page${pages.length > 1 ? 's' : ''})`);
}
async function copy() {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': output('image/png') })]);
    toast('Copied to clipboard');
  } catch (e) { toast('Copy failed: ' + e.message); }
}
async function print() {
  const img = $('#printimg'), url = URL.createObjectURL(await output('image/png'));
  img.onload = () => { window.print(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
  img.src = url;
}
const savePng = async () => { download(await output('image/png'), fileName('png')); toast('PNG saved'); };

$('#png').onclick = savePng;
$('#jpg').onclick = async () => { download(await output('image/jpeg', 0.92), fileName('jpg')); toast('JPEG saved'); };
$('#pdfA4').onclick = () => savePdf(true);
$('#pdfLong').onclick = () => savePdf(false);
$('#copy').onclick = copy;
$('#print').onclick = print;
$('#undo').onclick = () => travel(-1);
$('#redo').onclick = () => travel(1);
$('#zin').onclick = () => setZoom(1.25);
$('#zout').onclick = () => setZoom(0.8);
$('#zfit').onclick = () => fit(false);
$('#cropApply').onclick = applyCrop;
$('#cropCancel').onclick = () => setTool('select');
$('#cropReset').onclick = () => { cropBox = FULL(); schedule(); };

addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); travel(e.shiftKey ? 1 : -1); }
  else if (mod && k === 'y') { e.preventDefault(); travel(1); }
  else if (mod && k === 's') { e.preventDefault(); savePng(); }
  else if (mod && k === 'c') { if (selectedText()) return; e.preventDefault(); copy(); }   // let text selections copy normally
  else if ((k === 'delete' || k === 'backspace') && selected >= 0) { state.shapes.splice(selected, 1); selected = -1; commit(); }
  else if (k === 'enter' && tool === 'crop' && e.target.tagName !== 'BUTTON') { e.preventDefault(); applyCrop(); }
  else if (k === 'escape') { if (tool === 'crop') setTool('select'); draft = null; selected = -1; schedule(); }
});
scroller.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault(); setZoom(e.deltaY < 0 ? 1.1 : 0.9);
}, { passive: false });

load().catch(e => { console.error(e); toast('Could not open capture: ' + e.message, 60000); });
