import { getCapture } from './db.js';

const $ = s => document.querySelector(s);
const view = $('#view'), ctx = view.getContext('2d');
const stage = $('#stage'), scroller = $('#scroller');
const base = document.createElement('canvas');   // stitched, untouched screenshot

let ratio = 1;                 // image pixels per CSS pixel of the captured page
let state = { shapes: [], crop: null };
let history = [], hIndex = -1;
let tool = 'arrow', zoom = 1, draft = null, selected = -1, drag = null, title = 'capture', pending = false;

const ICONS = {
  select: '<path d="M5 3l14 8-6 2-2 6z"/>',
  crop: '<path d="M6 2v16h16M2 6h16v16"/>',
  arrow: '<path d="M5 19L19 5M9 5h10v10"/>',
  line: '<path d="M5 19L19 5"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  pen: '<path d="M4 20l1-5L16 4l4 4L9 19z"/>',
  hl: '<path d="M4 20h7M9 15l-3 3M9 15l8-11 4 3-8 11z"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  step: '<circle cx="12" cy="12" r="9"/><path d="M11 9l2-1v8"/>',
  blur: '<path d="M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z" fill="currentColor" stroke="none"/>'
};
const TITLES = { select: 'Select / move (Delete removes)', crop: 'Crop', arrow: 'Arrow', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse',
  pen: 'Pen', hl: 'Highlighter', text: 'Text', step: 'Numbered step', blur: 'Blur / pixelate' };

for (const k of Object.keys(ICONS)) {
  const b = document.createElement('button');
  b.dataset.tool = k; b.title = TITLES[k]; b.setAttribute('aria-label', TITLES[k]);
  b.appendChild(new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${ICONS[k]}</svg>`, 'image/svg+xml').documentElement);
  b.addEventListener('click', () => setTool(k));
  $('#tools').appendChild(b);
}
function setTool(k) {
  tool = k; selected = -1;
  for (const b of document.querySelectorAll('#tools button')) {
    b.classList.toggle('active', b.dataset.tool === k);
    b.setAttribute('aria-pressed', b.dataset.tool === k);
  }
  view.style.cursor = k === 'select' ? 'default' : k === 'text' ? 'text' : 'crosshair';
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
  if (k < 1) toast(`Very large page: image scaled to ${Math.round(k * 100)}% to fit browser limits.`, 5000);
  commit();
  fit(true);
  setTool('arrow');
}

/* ---------- state ---------- */
const C = () => state.crop || { x: 0, y: 0, w: base.width, h: base.height };
function commit() {
  history = history.slice(0, hIndex + 1);
  history.push(JSON.stringify(state));
  hIndex++;
  refresh();
}
function travel(d) {
  if (hIndex + d < 0 || hIndex + d >= history.length) return;
  hIndex += d; state = JSON.parse(history[hIndex]); selected = -1; refresh();
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
const setFont = s => { ctx.font = `600 ${fontPx(s)}px system-ui, sans-serif`; ctx.textBaseline = 'top'; };

function bbox(s) {
  const pad = (s.size || 1) * ratio + 4;
  let x, y, w, h;
  if (s.pts) {
    const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]);
    x = Math.min(...xs); y = Math.min(...ys); w = Math.max(...xs) - x; h = Math.max(...ys) - y;
  } else if (s.type === 'text') {
    setFont(s);
    const lines = s.text.split('\n');
    x = s.x; y = s.y; w = Math.max(...lines.map(l => ctx.measureText(l).width)); h = lines.length * fontPx(s) * 1.25;
  } else if (s.type === 'step') {
    const r = stepR(s); x = s.x - r; y = s.y - r; w = h = 2 * r;
  } else ({ x, y, w, h } = nr(s));
  return { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad };
}
function moveShape(s, dx, dy) {
  if (s.pts) s.pts = s.pts.map(([x, y]) => [x + dx, y + dy]);
  else if ('x1' in s) { s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy; }
  else { s.x += dx; s.y += dy; }
}

function drawShape(s) {
  const lw = s.size * ratio;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = s.color;
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
    case 'hl': ctx.globalAlpha = 0.35; ctx.lineWidth = lw * 5; ctx.lineCap = 'butt'; // falls through
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
    case 'blur': {
      const r = nr(s);
      const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
      const w = Math.min(base.width, Math.ceil(r.x + r.w)) - x, h = Math.min(base.height, Math.ceil(r.y + r.h)) - y;
      if (w < 2 || h < 2) break;
      const block = Math.max(6, s.size * 3) * ratio;
      const t = document.createElement('canvas');
      t.width = Math.max(1, Math.round(w / block)); t.height = Math.max(1, Math.round(h / block));
      t.getContext('2d').drawImage(base, x, y, w, h, 0, 0, t.width, t.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(t, 0, 0, t.width, t.height, x, y, w, h); break;
    }
  }
  ctx.restore();
}

function render(exporting = false) {
  const c = C();
  if (view.width !== c.w || view.height !== c.h) { view.width = c.w; view.height = c.h; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(base, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  ctx.translate(-c.x, -c.y);
  state.shapes.forEach(drawShape);
  if (exporting) return;
  if (draft && draft.type === 'crop') {
    const r = nr(draft);
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath();
    ctx.rect(c.x, c.y, c.w, c.h); ctx.rect(r.x, r.y, r.w, r.h); ctx.fill('evenodd');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, 1 / zoom); ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.restore();
  } else if (draft) drawShape(draft);
  if (selected >= 0 && state.shapes[selected]) {
    const b = bbox(state.shapes[selected]);
    ctx.save(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = Math.max(1, 1.5 / zoom);
    ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore();
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
const style = () => ({ color: $('#color').value, size: +$('#size').value });

view.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  const p = pos(e);
  if (tool === 'select') {
    selected = -1;
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const b = bbox(state.shapes[i]);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { selected = i; break; }
    }
    if (selected >= 0) { drag = { x: p.x, y: p.y, moved: false }; view.setPointerCapture(e.pointerId); }
    return schedule();
  }
  if (tool === 'text') return void setTimeout(() => openText(p), 0);
  if (tool === 'step') {
    const n = state.shapes.filter(s => s.type === 'step').length + 1;
    state.shapes.push({ type: 'step', x: p.x, y: p.y, n, ...style() });
    return commit();
  }
  view.setPointerCapture(e.pointerId);
  draft = tool === 'pen' || tool === 'hl'
    ? { type: tool, pts: [[p.x, p.y]], ...style() }
    : { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...style() };
  schedule();
});
view.addEventListener('pointermove', e => {
  const p = pos(e);
  if (drag && selected >= 0) {
    moveShape(state.shapes[selected], p.x - drag.x, p.y - drag.y);
    drag.x = p.x; drag.y = p.y; drag.moved = true;
    return schedule();
  }
  if (!draft) return;
  if (draft.pts) draft.pts.push([p.x, p.y]);
  else {
    draft.x2 = p.x; draft.y2 = p.y;
    if (e.shiftKey && (draft.type === 'rect' || draft.type === 'ellipse')) {
      const d = Math.max(Math.abs(p.x - draft.x1), Math.abs(p.y - draft.y1));
      draft.x2 = draft.x1 + Math.sign(p.x - draft.x1) * d; draft.y2 = draft.y1 + Math.sign(p.y - draft.y1) * d;
    }
  }
  schedule();
});
function endPointer() {
  if (drag) { const moved = drag.moved; drag = null; if (moved) commit(); return; }
  if (!draft) return;
  const d = draft; draft = null;
  if (d.type === 'crop') {
    const c = C(), r = nr(d);
    const x = Math.max(c.x, Math.round(r.x)), y = Math.max(c.y, Math.round(r.y));
    const w = Math.min(c.x + c.w, Math.round(r.x + r.w)) - x, h = Math.min(c.y + c.h, Math.round(r.y + r.h)) - y;
    if (w > 8 && h > 8) { state.crop = { x, y, w, h }; commit(); fit(true); toast('Cropped — Ctrl+Z to undo'); }
    else schedule();
    return;
  }
  const tiny = !d.pts && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 3;
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
    if (!cancelled && text) { state.shapes.push({ type: 'text', x: p.x + 1 / zoom, y: p.y + 1 / zoom, text, ...st }); commit(); }
  });
  stage.appendChild(ta); ta.focus();
}

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

addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); travel(e.shiftKey ? 1 : -1); }
  else if (mod && k === 'y') { e.preventDefault(); travel(1); }
  else if (mod && k === 's') { e.preventDefault(); savePng(); }
  else if (mod && k === 'c') { e.preventDefault(); copy(); }
  else if ((k === 'delete' || k === 'backspace') && selected >= 0) { state.shapes.splice(selected, 1); selected = -1; commit(); }
  else if (k === 'escape') { draft = null; selected = -1; schedule(); }
});
scroller.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault(); setZoom(e.deltaY < 0 ? 1.1 : 0.9);
}, { passive: false });

load().catch(e => { console.error(e); toast('Could not open capture: ' + e.message, 60000); });
