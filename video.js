// Video editor for recordings (see docs/RECORDING_PLAN.md §6).
// Everything happens in this tab: trimming and cutting only change which parts are kept,
// and "Save video" renders the kept parts (cropped, with or without sound) to a new WebM.
import { getCapture } from './db.js';
import { addWebmDuration } from './webm.js';

const $ = s => document.querySelector(s);
const v = $('#v'), track = $('#track'), segsEl = $('#segs'), head = $('#head'), stage = $('#stage');
let cap = null, url = null, D = 0, title = 'Recording';
let st = { segs: [], crop: null, muted: false };
let history = [], hIndex = -1, sel = -1, cropBox = null, playing = false, busy = false;

const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const keptLength = () => st.segs.reduce((a, [s, e]) => a + (e - s), 0);
const even = n => Math.max(2, Math.round(n / 2) * 2);
function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false; $('#sr').textContent = msg;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms);
}

/* ---------- state & history ---------- */
function commit() {
  history = history.slice(0, hIndex + 1);
  history.push(JSON.stringify(st)); hIndex++;
  refresh();
}
function travel(d) {
  if (hIndex + d < 0 || hIndex + d >= history.length) return;
  hIndex += d; st = JSON.parse(history[hIndex]); sel = Math.min(sel, st.segs.length - 1);
  refresh();
}
function refresh() {
  $('#undo').disabled = hIndex <= 0;
  $('#redo').disabled = hIndex >= history.length - 1;
  $('#mute').setAttribute('aria-pressed', st.muted); $('#mute').textContent = st.muted ? 'Sound off' : 'Mute sound';
  v.muted = st.muted;
  $('#del').disabled = sel < 0 || st.segs.length < 2;
  $('#info').textContent = `Output length ${fmt(keptLength())}` + (st.crop ? ` · cropped to ${st.crop.w} × ${st.crop.h}` : '') + (st.muted ? ' · no sound' : '') +
    '. Drag the ends of a part to trim it. Split at the playhead, then select a part and delete it to cut it out.';
  drawSegs(); showCrop(); tick();
}

/* ---------- timeline ---------- */
const pct = t => (t / D) * 100 + '%';
function drawSegs() {
  segsEl.replaceChildren();
  let at = 0;                                              // removed stretches are hatched
  for (const [a, b] of [...st.segs, [D, D]]) {
    if (a - at > 0.01) {
      const g = document.createElement('div'); g.className = 'gap'; g.setAttribute('aria-hidden', 'true');
      Object.assign(g.style, { left: pct(at), width: pct(a - at) }); segsEl.appendChild(g);
    }
    at = b;
  }
  st.segs.forEach(([a, b], i) => {
    const d = document.createElement('div');
    d.className = 'seg' + (i === sel ? ' sel' : ''); d.dataset.i = i;
    d.tabIndex = 0; d.setAttribute('role', 'button');
    d.setAttribute('aria-label', `Part ${i + 1}, ${fmt(a)} to ${fmt(b)}${i === sel ? ', selected' : ''}`);
    Object.assign(d.style, { left: pct(a), width: `calc(${pct(b - a)})` });
    for (const side of ['l', 'r']) { const h = document.createElement('i'); h.className = 'h ' + side; h.dataset.side = side; d.appendChild(h); }
    segsEl.appendChild(d);
  });
}
function tick() {
  head.style.left = pct(v.currentTime || 0);
  $('#time').textContent = `${fmt(v.currentTime || 0)} / ${fmt(D)}`;
}
const timeAt = x => { const r = track.getBoundingClientRect(); return Math.min(D, Math.max(0, ((x - r.left) / r.width) * D)); };
const segAt = t => st.segs.findIndex(([a, b]) => t >= a && t <= b);
function seek(t) { v.currentTime = Math.min(D, Math.max(0, t)); tick(); }

track.addEventListener('pointerdown', e => {
  if (busy) return;
  e.preventDefault();
  track.setPointerCapture(e.pointerId);
  const side = e.target.dataset?.side, segEl = e.target.closest('.seg');
  if (side && segEl) {                                     // trim one end of a part
    const i = +segEl.dataset.i, prev = st.segs[i - 1], next = st.segs[i + 1];
    sel = i;
    const mv = ev => {
      const t = timeAt(ev.clientX), s = st.segs[i];
      if (side === 'l') s[0] = Math.min(s[1] - 0.2, Math.max(prev ? prev[1] : 0, t));
      else s[1] = Math.max(s[0] + 0.2, Math.min(next ? next[0] : D, t));
      seek(side === 'l' ? s[0] : s[1]); drawSegs();
    };
    const up = () => { track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up); commit(); };
    track.addEventListener('pointermove', mv); track.addEventListener('pointerup', up);
    return;
  }
  const t = timeAt(e.clientX);                             // seek / scrub, and select the part under the pointer
  sel = segAt(t); seek(t); refresh();
  const mv = ev => seek(timeAt(ev.clientX));
  const up = () => { track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up); };
  track.addEventListener('pointermove', mv); track.addEventListener('pointerup', up);
});
segsEl.addEventListener('keydown', e => {
  const d = e.target.closest('.seg');
  if (d && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sel = +d.dataset.i; seek(st.segs[sel][0]); refresh(); segsEl.querySelectorAll('.seg')[sel]?.focus(); }
});

function split() {
  const t = v.currentTime, i = st.segs.findIndex(([a, b]) => t > a + 0.1 && t < b - 0.1);
  if (i < 0) return toast('Move the playhead inside a part (not right at its edge) to split it.');
  const [a, b] = st.segs[i];
  st.segs.splice(i, 1, [a, t], [t, b]); sel = i + 1;
  commit(); toast('Split. Select a part and press Delete to cut it out.');
}
function del() {
  if (sel < 0) return toast('Select a part on the timeline first.');
  if (st.segs.length < 2) return toast('This is the only part left. Drag its ends to trim it instead.');
  st.segs.splice(sel, 1); sel = Math.min(sel, st.segs.length - 1);
  commit(); toast('Part removed — Ctrl+Z to undo');
}

/* ---------- playback that skips removed parts ---------- */
function loop() {
  if (!playing) return;
  const t = v.currentTime, i = segAt(t);
  if (i < 0 || t >= st.segs[i][1] - 0.03) {
    const next = st.segs.find(([a]) => a > t - 0.001 && (i < 0 || a >= st.segs[i][1] - 0.001));
    if (next) v.currentTime = next[0];
    else { pause(); v.currentTime = st.segs[st.segs.length - 1][1]; }
  }
  tick();
  requestAnimationFrame(loop);
}
function play() {
  if (busy) return;
  const t = v.currentTime, last = st.segs[st.segs.length - 1];
  if (t >= last[1] - 0.05 || segAt(t) < 0) v.currentTime = (st.segs.find(([a]) => a > t) || st.segs[0])[0];
  v.play().then(() => { playing = true; $('#play').textContent = '❚❚'; $('#play').setAttribute('aria-label', 'Pause'); requestAnimationFrame(loop); }).catch(() => {});
}
function pause() { v.pause(); playing = false; $('#play').textContent = '▶'; $('#play').setAttribute('aria-label', 'Play'); tick(); }

/* ---------- crop ---------- */
function videoBox() {                                       // displayed video rect inside the stage
  const r = v.getBoundingClientRect(), s = stage.getBoundingClientRect();
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height, k: r.width / v.videoWidth };
}
function showCrop() {
  const vb = videoBox(), cv = $('#cropview'), cb = $('#cropbox');
  if (st.crop && !cropBox) Object.assign(cv.style, { left: vb.x + st.crop.x * vb.k + 'px', top: vb.y + st.crop.y * vb.k + 'px', width: st.crop.w * vb.k + 'px', height: st.crop.h * vb.k + 'px' });
  cv.hidden = !st.crop || !!cropBox;
  cb.hidden = !cropBox;
  if (cropBox) Object.assign(cb.style, { left: vb.x + cropBox.x * vb.k + 'px', top: vb.y + cropBox.y * vb.k + 'px', width: cropBox.w * vb.k + 'px', height: cropBox.h * vb.k + 'px' });
}
function setCropMode(on) {
  cropBox = on ? { ...(st.crop || { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight }) } : null;
  $('#cropbar').hidden = !on; $('#crop').setAttribute('aria-pressed', on);
  showCrop();
}
(function buildHandles() {
  const cb = $('#cropbox');
  const pos = { nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5] };
  for (const [h, [fx, fy]] of Object.entries(pos)) {
    const i = document.createElement('i'); i.dataset.h = h;
    Object.assign(i.style, { left: `calc(${fx * 100}% - 7px)`, top: `calc(${fy * 100}% - 7px)`, cursor: (h === 'nw' || h === 'se' ? 'nwse' : h === 'ne' || h === 'sw' ? 'nesw' : 'ns'.includes(h) ? 'ns' : 'ew') + '-resize' });
    cb.appendChild(i);
  }
  cb.addEventListener('pointerdown', e => {
    e.preventDefault(); cb.setPointerCapture(e.pointerId);
    const mode = e.target.dataset.h || 'move', k = videoBox().k, start = { x: e.clientX, y: e.clientY }, box = { ...cropBox };
    const W = v.videoWidth, H = v.videoHeight, clamp = (x, a, b) => Math.min(b, Math.max(a, x)), min = 32;
    const mv = ev => {
      const dx = (ev.clientX - start.x) / k, dy = (ev.clientY - start.y) / k;
      if (mode === 'move') cropBox = { ...box, x: clamp(box.x + dx, 0, W - box.w), y: clamp(box.y + dy, 0, H - box.h) };
      else {
        let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
        if (mode.includes('w')) x0 = clamp(x0 + dx, 0, x1 - min);
        if (mode.includes('e')) x1 = clamp(x1 + dx, x0 + min, W);
        if (mode.includes('n')) y0 = clamp(y0 + dy, 0, y1 - min);
        if (mode.includes('s')) y1 = clamp(y1 + dy, y0 + min, H);
        cropBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      showCrop();
    };
    const up = () => { cb.removeEventListener('pointermove', mv); cb.removeEventListener('pointerup', up); };
    cb.addEventListener('pointermove', mv); cb.addEventListener('pointerup', up);
  });
})();
function applyCrop() {
  const r = { x: Math.round(cropBox.x), y: Math.round(cropBox.y), w: Math.round(cropBox.w), h: Math.round(cropBox.h) };
  const full = r.x <= 0 && r.y <= 0 && r.w >= v.videoWidth && r.h >= v.videoHeight;
  st.crop = full ? null : r;
  setCropMode(false); commit();
  toast(full ? 'Crop removed' : 'Cropped — Ctrl+Z to undo');
}

/* ---------- thumbnails ---------- */
async function thumbs() {
  const c = $('#thumbs'), r = track.getBoundingClientRect();
  c.width = Math.round(r.width * devicePixelRatio); c.height = Math.round(r.height * devicePixelRatio);
  const g = c.getContext('2d'), tv = document.createElement('video');
  tv.muted = true; tv.preload = 'auto'; tv.src = url;
  await new Promise(res => { tv.onloadeddata = res; tv.onerror = res; });
  if (!tv.videoWidth) return;
  const th = c.height, tw = Math.max(8, Math.round(th * tv.videoWidth / tv.videoHeight)), n = Math.ceil(c.width / tw);
  for (let i = 0; i < n; i++) {
    tv.currentTime = Math.min(D - 0.05, ((i + 0.5) / n) * D);
    await new Promise(res => { tv.onseeked = res; setTimeout(res, 1500); });
    g.drawImage(tv, i * tw, 0, tw, th);
  }
  tv.removeAttribute('src'); tv.load();
}

/* ---------- save ---------- */
function fileName(ext = 'webm') {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  const name = title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 60) || 'Recording';
  return `${name} recording ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.${ext}`;
}
function download(blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName(/mp4/.test(blob.type) ? 'mp4' : 'webm');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const edited = () => st.crop || st.muted || st.segs.length !== 1 || st.segs[0][0] > 0.05 || st.segs[0][1] < D - 0.05;

async function render() {
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const src = document.createElement('video');
  src.preload = 'auto'; src.src = url; src.playsInline = true;
  await new Promise((res, rej) => { src.onloadeddata = res; src.onerror = () => rej(new Error('Could not read the recording.')); });
  const c = st.crop || { x: 0, y: 0, w: src.videoWidth, h: src.videoHeight };
  const cv = document.createElement('canvas'); cv.width = even(c.w); cv.height = even(c.h);
  const g = cv.getContext('2d', { alpha: false });
  const tracks = [...cv.captureStream(30).getVideoTracks()];
  let actx = null;
  if (cap.hasAudio && !st.muted) {                       // route sound into the file, not the speakers
    actx = new AudioContext();
    const dest = actx.createMediaStreamDestination();
    actx.createMediaElementSource(src).connect(dest);
    tracks.push(...dest.stream.getAudioTracks());
  } else src.muted = true;
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(res => (rec.onstop = res));
  let drawing = true;
  const draw = () => { g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height); if (drawing) next(); };
  const next = () => (src.requestVideoFrameCallback ? src.requestVideoFrameCallback(draw) : requestAnimationFrame(draw));
  const total = keptLength(); let done = 0;
  const bar = $('#progress'), fill = bar.firstElementChild; bar.hidden = false; fill.style.width = '0%';
  rec.start(500); rec.pause();
  for (const [a, b] of st.segs) {
    src.currentTime = a;
    await new Promise(res => { src.onseeked = res; });
    g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height);
    next();
    rec.resume();
    await src.play();
    await new Promise(res => {
      const watch = () => {
        fill.style.width = Math.min(100, ((done + src.currentTime - a) / total) * 100) + '%';
        if (src.currentTime >= b - 0.01 || src.ended) res(); else requestAnimationFrame(watch);
      };
      watch();
    });
    src.pause(); rec.pause(); done += b - a;
  }
  drawing = false; rec.stop(); await stopped;
  actx?.close(); src.removeAttribute('src'); src.load();
  fill.style.width = '100%'; setTimeout(() => (bar.hidden = true), 800);
  return addWebmDuration(new Blob(chunks, { type: 'video/webm' }), total * 1000).catch(b => b);
}
async function save() {
  if (busy) return;
  if (!edited()) { download(cap.blob); return toast('Video saved'); }
  busy = true; pause();
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  toast(`Saving your edit… this takes about ${Math.ceil(keptLength())} seconds. Keep this tab open.`, 600000);
  try { download(await render()); toast('Video saved'); }
  catch (e) { console.error(e); toast('Could not save: ' + e.message, 6000); }
  finally {
    busy = false;
    for (const b of document.querySelectorAll('button')) b.disabled = false;
    refresh();
  }
}

/* ---------- wiring ---------- */
$('#play').onclick = () => (playing ? pause() : play());
$('#split').onclick = split;
$('#del').onclick = del;
$('#undo').onclick = () => travel(-1);
$('#redo').onclick = () => travel(1);
$('#mute').onclick = () => { st.muted = !st.muted; commit(); };
$('#crop').onclick = () => setCropMode(!cropBox);
$('#cropApply').onclick = applyCrop;
$('#cropReset').onclick = () => { cropBox = { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight }; showCrop(); };
$('#cropCancel').onclick = () => setCropMode(false);
$('#save').onclick = save;
$('#orig').onclick = () => { download(cap.blob); toast('Original saved'); };
v.addEventListener('click', () => (playing ? pause() : play()));
v.addEventListener('timeupdate', () => { if (!playing) tick(); });
addEventListener('resize', showCrop);
addEventListener('keydown', e => {
  if (busy) return;
  const tag = e.target.tagName, mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); travel(e.shiftKey ? 1 : -1); }
  else if (mod && k === 'y') { e.preventDefault(); travel(1); }
  else if (mod) return;
  else if (k === ' ' && tag !== 'BUTTON' && !e.target.closest?.('.seg')) { e.preventDefault(); playing ? pause() : play(); }
  else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); seek(v.currentTime + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 5 : 1)); }
  else if (k === 's') split();
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); del(); }
  else if (k === 'escape' && cropBox) setCropMode(false);
  else if (k === 'enter' && cropBox && tag !== 'BUTTON') applyCrop();
});

async function load() {
  cap = await getCapture(new URLSearchParams(location.search).get('id'));
  if (!cap || cap.type !== 'video') { $('#stage').textContent = 'This recording is no longer stored. Record a new one.'; return; }
  title = cap.title || 'Recording';
  document.title = title + ' – CleanCapture recording';
  url = URL.createObjectURL(cap.blob);
  v.src = url;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('This recording could not be opened.')); });
  D = isFinite(v.duration) && v.duration > 0 ? v.duration : cap.duration || 0;
  if (!isFinite(v.duration)) {                             // files without a stored length: ask the browser to scan
    v.currentTime = 1e7; await new Promise(res => { v.ondurationchange = res; setTimeout(res, 3000); });
    if (isFinite(v.duration) && v.duration > 0) D = v.duration;
    v.currentTime = 0;
  }
  $('#mute').hidden = !cap.hasAudio;
  st = { segs: [[0, D]], crop: null, muted: false };
  commit();
  v.addEventListener('loadeddata', showCrop, { once: true });
  thumbs().catch(() => {});
}
load().catch(e => { console.error(e); toast('Could not open the recording: ' + e.message, 60000); });
