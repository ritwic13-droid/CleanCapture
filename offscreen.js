// Hidden extension page that records the current tab (Chrome only).
// A service worker cannot use media APIs, so the background opens this page for the
// duration of a recording. Nothing is shown here and nothing is sent anywhere: the
// finished video goes into the extension's local storage and the editor opens it.
import { putCapture } from './db.js';
import { addWebmDuration } from './webm.js';

const R = {
  rec: null, stream: null, audioCtx: null, chunks: [], tabId: null, title: '',
  region: null, vw: 0, vh: 0, W: 0, H: 0, hasAudio: false,
  activeMs: 0, resumedAt: 0, ping: null, stopping: false
};
const even = n => Math.max(2, Math.round(n / 2) * 2);
const elapsed = () => R.activeMs + (R.resumedAt ? performance.now() - R.resumedAt : 0);

function pickMime() {
  for (const t of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'])
    if (MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

async function tabStream(streamId, w, h) {
  const video = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxWidth: w, maxHeight: h, maxFrameRate: 30 } };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } });
  } catch {
    return navigator.mediaDevices.getUserMedia({ video });   // tab without sound
  }
}

// Copy the chosen region of each tab frame into a fixed-size output frame.
// The region is in CSS pixels of the tab's viewport and may extend past it (dark there).
// A region of a different shape (after "Edit frame") is fitted inside with dark bars.
function cropper(track) {
  const proc = new MediaStreamTrackProcessor({ track });
  const gen = new MediaStreamTrackGenerator({ kind: 'video' });
  let cv = null, g = null;
  proc.readable.pipeThrough(new TransformStream({
    transform(frame, ctl) {
      try {
        const fw = frame.displayWidth, fh = frame.displayHeight, k = fw / R.vw, r = R.region;
        if (!cv) {                                       // output size is fixed by the first frame
          R.W = even(Math.min(r.w * k, 3840)); R.H = even(Math.min(r.h * k, 2160));
          cv = new OffscreenCanvas(R.W, R.H); g = cv.getContext('2d', { alpha: false });
        }
        const sx = r.x * k, sy = r.y * k, sw = r.w * k, sh = r.h * k;
        const s = Math.min(R.W / sw, R.H / sh), ox = (R.W - sw * s) / 2, oy = (R.H - sh * s) / 2;
        g.fillStyle = '#111827'; g.fillRect(0, 0, R.W, R.H);
        const ix = Math.max(0, sx), iy = Math.max(0, sy), iw = Math.min(fw, sx + sw) - ix, ih = Math.min(fh, sy + sh) - iy;
        if (iw > 0 && ih > 0) g.drawImage(frame, ix, iy, iw, ih, ox + (ix - sx) * s, oy + (iy - sy) * s, iw * s, ih * s);
        ctl.enqueue(new VideoFrame(cv, { timestamp: frame.timestamp }));
      } finally { frame.close(); }
    }
  })).pipeTo(gen.writable).catch(() => {});
  return gen;
}

async function start({ streamId, rect, vw, vh, dpr, tabId, title }) {
  if (R.rec) throw new Error('A recording is already running.');
  Object.assign(R, { region: rect, vw, vh, tabId, title, chunks: [], activeMs: 0, stopping: false, W: 0, H: 0 });
  R.stream = await tabStream(streamId, Math.round(vw * dpr), Math.round(vh * dpr));
  const [video] = R.stream.getVideoTracks(), [audio] = R.stream.getAudioTracks();
  R.hasAudio = !!audio;
  if (audio) {                                           // capturing mutes the tab; keep it audible
    R.audioCtx = new AudioContext();
    R.audioCtx.createMediaStreamSource(new MediaStream([audio])).connect(R.audioCtx.destination);
  }
  const out = new MediaStream([cropper(video), ...(audio ? [audio] : [])]);
  R.rec = new MediaRecorder(out, { mimeType: pickMime(), videoBitsPerSecond: 6_000_000 });
  R.rec.ondataavailable = e => { if (e.data.size) R.chunks.push(e.data); };
  R.rec.onstop = finish;
  video.addEventListener('ended', stop);                 // tab closed
  R.rec.start(1000);
  R.resumedAt = performance.now();
  R.ping = setInterval(() => chrome.runtime.sendMessage({ t: 'recPing' }).catch(() => {}), 20000);   // keep the background awake
}

function pause() {
  if (R.rec?.state !== 'recording') return;
  R.rec.pause(); R.activeMs = elapsed(); R.resumedAt = 0;
}
function resume() {
  if (R.rec?.state !== 'paused') return;
  R.rec.resume(); R.resumedAt = performance.now();
}
function stop() {
  if (!R.rec || R.stopping || R.rec.state === 'inactive') return;
  R.stopping = true; R.activeMs = elapsed(); R.resumedAt = 0;
  R.rec.stop();
}

async function finish() {
  clearInterval(R.ping);
  R.stream?.getTracks().forEach(t => t.stop());
  R.audioCtx?.close();
  let blob = new Blob(R.chunks, { type: 'video/webm' });
  R.chunks = []; R.rec = null; R.stream = null; R.audioCtx = null;
  let id = null;
  if (blob.size) {
    blob = await addWebmDuration(blob, R.activeMs).catch(() => blob);
    id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await putCapture({ id, type: 'video', created: Date.now(), title: R.title || 'Recording', blob, duration: R.activeMs / 1000, hasAudio: R.hasAudio });
  }
  chrome.runtime.sendMessage({ t: 'recSaved', id, tabId: R.tabId });
}

chrome.runtime.onMessage.addListener((msg, _s, respond) => {
  if (msg.target !== 'offscreen') return;
  if (msg.t === 'start') {
    start(msg).then(() => respond({ ok: true }), e => { R.rec = null; R.stream?.getTracks().forEach(t => t.stop()); respond({ ok: false, error: e.message }); });
    return true;
  }
  if (msg.t === 'pause') pause();
  else if (msg.t === 'resume') resume();
  else if (msg.t === 'region') { R.region = msg.rect; if (msg.vw) R.vw = msg.vw; }
  else if (msg.t === 'stop') stop();
  else if (msg.t === 'status') respond({ recording: !!R.rec, tabId: R.tabId });
});
