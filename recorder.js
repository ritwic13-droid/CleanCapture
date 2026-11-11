// Screen recorder. Uses the browser's own screen-share picker (no extra permissions) and
// keeps everything in memory on this device until the user saves the file.
const $ = s => document.querySelector(s);
import { putCapture } from './db.js';

// How this page was opened: ?surface=browser|monitor preselects the picker tab, ?crop=x,y,w,h,vw,vh records
// only that part of a tab, ?shot=1 takes a single screenshot of a window or screen instead of a video.
const Q = new URLSearchParams(location.search);
const SHOT = Q.has('shot'), SURFACE = Q.get('surface');
const CROP = Q.has('crop') ? (([x, y, w, h, vw, vh]) => ({ x, y, w, h, vw, vh }))(Q.get('crop').split(',').map(Number)) : null;
const canCrop = 'MediaStreamTrackProcessor' in window && 'MediaStreamTrackGenerator' in window;
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (SHOT) {
  $('#heading').textContent = 'Screenshot a window or screen'; document.title = 'Clean Capture – Screenshot';
  $('#lead').textContent = 'Choose a window, an app or your whole screen. After a 3-second countdown it is captured and opened in the editor.';
  $('#recopts').hidden = true; $('#start').textContent = 'Choose what to capture';
  $('#startnote').textContent = 'The countdown gives you time to bring the right window to the front.';
} else if (CROP) {
  $('#heading').textContent = 'Record part of a page';
  $('#lead').textContent = `Area selected: ${CROP.w} × ${CROP.h}. Click Start, then choose the tab “${(Q.get('title') || 'this tab').slice(0, 60)}” in the browser's picker. Only the selected area is recorded.`;
} else if (SURFACE === 'browser') {
  $('#heading').textContent = 'Record a browser tab';
  $('#lead').textContent = 'Click Start, then choose the tab to record. The recording is made and saved on this device only.';
} else if (SURFACE === 'monitor') {
  $('#heading').textContent = 'Record a window or screen';
  $('#lead').textContent = 'Click Start, then choose a window, an app or your whole screen. The recording is made and saved on this device only.';
}

// Crop every video frame to the chosen rectangle (viewport CSS pixels of the captured tab).
function cropTrack(track, c) {
  const proc = new MediaStreamTrackProcessor({ track }), gen = new MediaStreamTrackGenerator({ kind: 'video' });
  const even = n => Math.max(2, Math.floor(n / 2) * 2);
  let cv = null, g = null;
  proc.readable.pipeThrough(new TransformStream({
    transform(frame, ctl) {
      try {
        const k = frame.displayWidth / c.vw;
        const x = Math.min(Math.round(c.x * k), frame.displayWidth - 2), y = Math.min(Math.round(c.y * k), frame.displayHeight - 2);
        const w = even(Math.min(c.w * k, frame.displayWidth - x)), h = even(Math.min(c.h * k, frame.displayHeight - y));
        if (!cv || cv.width !== w || cv.height !== h) { cv = new OffscreenCanvas(w, h); g = cv.getContext('2d', { alpha: false }); }
        g.drawImage(frame, x, y, w, h, 0, 0, w, h);          // copy just the chosen rectangle
        ctl.enqueue(new VideoFrame(cv, { timestamp: frame.timestamp, duration: frame.duration ?? undefined }));
      } finally { frame.close(); }
    }
  })).pipeTo(gen.writable).catch(() => {});
  return gen;
}

// Single screenshot of a window or screen: wait 3 s, grab one frame, open it in the editor.
async function grab(display) {
  const video = document.createElement('video');
  video.muted = true; video.srcObject = display;
  await video.play().catch(() => {});
  $('#livebuttons').hidden = true; $('#dot').classList.add('paused');
  $('#livenote').textContent = 'Bring the window you want to the front…';
  show('live');
  for (let i = 3; i > 0; i--) { $('#time').textContent = i; document.title = `Capturing in ${i}…`; await sleep(1000); }
  const w = video.videoWidth, h = video.videoHeight;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(video, 0, 0);
  display.getTracks().forEach(t => t.stop());
  if (!w || !h) { show('setup'); return say('Nothing could be captured. Please try again.'); }
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await putCapture({ id, created: Date.now(), title: 'Screen capture', frames: [{ blob, vw: w, sx: 0, sy: 0, sw: w, sh: h, dx: 0, dy: 0 }], w, h });
  location.replace('editor.html?id=' + id);
}

const FORMATS = [
  ['WebM (VP9)', 'video/webm;codecs=vp9,opus', 'webm'],
  ['WebM (VP8)', 'video/webm;codecs=vp8,opus', 'webm'],
  ['WebM', 'video/webm', 'webm'],
  ['MP4 (H.264)', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
  ['MP4', 'video/mp4', 'mp4'],
].filter(f => window.MediaRecorder && MediaRecorder.isTypeSupported(f[1]));
// keep one WebM and one MP4 choice at most
const seen = new Set();
for (const f of FORMATS) {
  if (seen.has(f[2])) continue;
  seen.add(f[2]);
  $('#format').add(new Option(f[0], f[1]));
}

let rec = null, chunks = [], streams = [], audioCtx = null, blob = null, ext = 'webm', url = null;
let activeMs = 0, resumedAt = 0, tick = null;

const show = id => { for (const s of ['setup', 'live', 'done']) $('#' + s).hidden = s !== id; };
const say = (t, error = true) => { $('#msg').textContent = t || ''; $('#msg').classList.toggle('error', !!t && error); };
const elapsed = () => activeMs + (resumedAt ? performance.now() - resumedAt : 0);
const fmt = ms => { const s = Math.floor(ms / 1000), z = n => String(n).padStart(2, '0'); return (s >= 3600 ? z(Math.floor(s / 3600)) + ':' : '') + z(Math.floor(s / 60) % 60) + ':' + z(s % 60); };
const paint = () => { $('#time').textContent = fmt(elapsed()); document.title = (rec?.state === 'paused' ? '⏸ ' : '● ') + fmt(elapsed()) + ' – Clean Capture'; };

function cleanup() {
  clearInterval(tick); tick = null;
  streams.forEach(s => s.getTracks().forEach(t => t.stop())); streams = [];
  audioCtx?.close(); audioCtx = null;
}

async function start() {
  say('');
  if (!FORMATS.length || !navigator.mediaDevices?.getDisplayMedia) return say('This browser does not support screen recording.');
  let display;
  try {
    const surface = SHOT ? 'monitor' : CROP ? 'browser' : SURFACE;
    display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, ...(surface ? { displaySurface: surface } : {}) }, audio: !SHOT && $('#sysAudio').checked });
  } catch (e) {
    return say(e.name === 'NotAllowedError' ? 'Nothing was shared, so nothing was recorded.' : 'Could not start: ' + e.message);
  }
  if (SHOT) return grab(display);
  streams = [display];
  const audio = [];
  if (display.getAudioTracks().length) audio.push(display);
  if ($('#mic').checked) {
    try { const m = await navigator.mediaDevices.getUserMedia({ audio: true }); streams.push(m); audio.push(m); }
    catch { say('Microphone not available — recording without it.'); }
  }
  const source = display.getVideoTracks()[0];
  let video = source;
  if (CROP) {
    const kind = source.getSettings().displaySurface;
    if (!canCrop) say('This browser cannot record just an area, so the whole tab is being recorded.');
    else if (kind && kind !== 'browser') say('Area recording only works on a browser tab, so everything you shared is being recorded.');
    else video = cropTrack(source, CROP);
  }
  const tracks = [video];
  if (audio.length === 1) tracks.push(audio[0].getAudioTracks()[0]);
  else if (audio.length > 1) {                      // mix system audio + microphone into one track
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    audio.forEach(s => audioCtx.createMediaStreamSource(s).connect(dest));
    tracks.push(dest.stream.getAudioTracks()[0]);
  }

  const mimeType = $('#format').value;
  ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  chunks = [];
  try {
    rec = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: +$('#quality').value });
  } catch (e) { cleanup(); return say('Could not start: ' + e.message); }
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = finish;
  rec.onerror = e => say('Recording error: ' + (e.error?.message || 'unknown'));
  source.addEventListener('ended', stop);           // browser's "Stop sharing" button
  rec.start(1000);
  activeMs = 0; resumedAt = performance.now();
  $('#pause').textContent = 'Pause'; $('#dot').classList.remove('paused');
  tick = setInterval(paint, 500); paint();
  show('live');
  if (!$('#msg').textContent) say('Recording started.', false);
  $('#stop').focus();
}

function togglePause() {
  if (!rec) return;
  if (rec.state === 'recording') {
    rec.pause(); activeMs = elapsed(); resumedAt = 0;
    $('#pause').textContent = 'Resume'; $('#dot').classList.add('paused');
  } else if (rec.state === 'paused') {
    rec.resume(); resumedAt = performance.now();
    $('#pause').textContent = 'Pause'; $('#dot').classList.remove('paused');
  }
  paint();
}

function stop() {
  if (!rec || rec.state === 'inactive') return;
  activeMs = elapsed(); resumedAt = 0;
  rec.stop();
}

async function finish() {
  const type = rec.mimeType || $('#format').value;
  cleanup(); rec = null;
  document.title = 'Clean Capture – Screen recorder';
  blob = new Blob(chunks, { type: type.split(';')[0] });
  chunks = [];
  if (!blob.size) { show('setup'); return say('The recording was empty.'); }
  if (ext === 'webm') blob = await addWebmDuration(blob, activeMs).catch(() => blob);
  url = URL.createObjectURL(blob);
  $('#preview').src = url;
  $('#info').textContent = `${fmt(activeMs)} · ${(blob.size / 1048576).toFixed(1)} MB · ${ext.toUpperCase()} · not saved yet`;
  show('done');
  say('Recording stopped. Preview it, then save.', false);
  $('#save').focus();
}

// MediaRecorder writes WebM without a duration, so players show no length and cannot seek.
// Insert a Duration element into the Segment Info header.
async function addWebmDuration(blob, ms) {
  const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  let i = -1;
  for (let k = 0; k < head.length - 12; k++) if (head[k] === 0x15 && head[k + 1] === 0x49 && head[k + 2] === 0xA9 && head[k + 3] === 0x66) { i = k; break; }
  if (i < 0) return blob;
  const p = i + 4, len = Math.clz32(head[p]) - 23;           // length of the size field in bytes
  if (len < 1 || len > 8) return blob;
  let size = head[p] & (0xFF >> len);
  for (let k = 1; k < len; k++) size = size * 256 + head[p + k];
  const body = p + len, end = body + size;
  if (end > head.length || size > 2000) return blob;
  for (let k = body; k < end - 1; k++) if (head[k] === 0x44 && head[k + 1] === 0x89) return blob;   // already has one
  let scale = 1000000;                                        // TimecodeScale, default 1 ms
  for (let k = body; k < end - 4; k++) if (head[k] === 0x2A && head[k + 1] === 0xD7 && head[k + 2] === 0xB1) {
    const n = head[k + 3] & 0x7F; scale = 0;
    for (let j = 0; j < n; j++) scale = scale * 256 + head[k + 4 + j];
    break;
  }
  const dur = new Uint8Array(11);
  dur.set([0x44, 0x89, 0x88]);
  new DataView(dur.buffer).setFloat64(3, (ms * 1e6) / scale);
  const newSize = size + 11;
  if (newSize >= 2 ** (7 * len) - 1) return blob;
  const sz = new Uint8Array(len);
  let v = newSize;
  for (let k = len - 1; k >= 0; k--) { sz[k] = v & 0xFF; v = Math.floor(v / 256); }
  sz[0] |= 0x80 >> (len - 1);
  return new Blob([head.slice(0, p), sz, head.slice(body, end), dur, blob.slice(end)], { type: blob.type });
}

function save() {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = url;
  a.download = `Screen recording ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
  $('#info').textContent = $('#info').textContent.replace('not saved yet', 'saved to your downloads');
}

function reset() {
  $('#preview').removeAttribute('src'); $('#preview').load();
  if (url) URL.revokeObjectURL(url);
  url = blob = null; say(''); show('setup'); $('#start').focus();
}

$('#start').onclick = start;
$('#pause').onclick = togglePause;
$('#stop').onclick = stop;
$('#save').onclick = save;
$('#again').onclick = reset;
addEventListener('beforeunload', e => { if (rec || (blob && $('#info').textContent.includes('not saved'))) e.preventDefault(); });
