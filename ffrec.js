// In-page recording for Firefox (see docs/RECORDING_PLAN.md §3).
// Firefox has no tabCapture, but tabs.captureTab can grab any rectangle of the page the
// user invoked the extension on, without a share dialog. This grabs the recorded region
// repeatedly, draws each grab onto a canvas and records the canvas. No sound.
// Runs in the background page (Firefox background pages have a DOM).
import { putCapture } from './db.js';
import { addWebmDuration } from './webm.js';

const FPS = 15;
let R = null;
const even = n => Math.max(2, Math.round(n / 2) * 2);
const elapsed = () => R.activeMs + (R.resumedAt ? performance.now() - R.resumedAt : 0);

export const ffRecording = () => !!R;

export async function ffStart({ tab, rect, dpr, onSaved }) {
  if (R) throw new Error('A recording is already running.');
  const scale = Math.min(dpr || 1, 2);
  const cv = document.createElement('canvas');
  cv.width = even(Math.min(rect.w * scale, 3840)); cv.height = even(Math.min(rect.h * scale, 2160));
  const g = cv.getContext('2d', { alpha: false });
  g.fillStyle = '#111827'; g.fillRect(0, 0, cv.width, cv.height);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(cv.captureStream(FPS), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  R = { tab, region: rect, scale, cv, g, rec, chunks: [], activeMs: 0, resumedAt: performance.now(), paused: false, running: true, onSaved };
  rec.ondataavailable = e => { if (e.data.size) R.chunks.push(e.data); };
  rec.onstop = finish;
  rec.start(1000);
  grabLoop(R);
}

async function grabLoop(me) {
  while (me.running) {
    const t0 = performance.now();
    if (!me.paused) {
      try {
        const r = me.region, x = r.x + (r.sx || 0), y = r.y + (r.sy || 0);
        const url = await browser.tabs.captureTab(me.tab.id, { format: 'jpeg', quality: 90, scale: me.scale, rect: { x, y, width: r.w, height: r.h } });
        if (!me.running) break;
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const { cv, g } = me, s = Math.min(cv.width / bmp.width, cv.height / bmp.height);   // fit a re-shaped frame inside
        const w = bmp.width * s, h = bmp.height * s;
        g.fillStyle = '#111827'; g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(bmp, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
        bmp.close();
      } catch (e) { if (!me.running) break; console.warn('CleanCapture frame:', e); }
    }
    await new Promise(res => setTimeout(res, Math.max(0, 1000 / FPS - (performance.now() - t0))));
  }
}

export function ffCommand(t, msg = {}) {
  if (!R) return;
  if (t === 'pause' && !R.paused) { R.paused = true; R.rec.pause(); R.activeMs = elapsed(); R.resumedAt = 0; }
  else if (t === 'resume' && R.paused) { R.paused = false; R.rec.resume(); R.resumedAt = performance.now(); }
  else if (t === 'region' && msg.rect) R.region = msg.rect;
  else if (t === 'discard' && R.running) { R.discard = true; R.running = false; R.rec.stop(); }
  else if (t === 'stop' && R.running) { R.running = false; R.activeMs = elapsed(); R.resumedAt = 0; R.rec.stop(); }
}

async function finish() {
  const me = R; R = null;
  let blob = new Blob(me.chunks, { type: 'video/webm' }), id = null;
  if (blob.size && !me.discard) {
    blob = await addWebmDuration(blob, me.activeMs).catch(() => blob);
    id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await putCapture({ id, type: 'video', created: Date.now(), title: me.tab.title || 'Recording', blob, duration: me.activeMs / 1000, hasAudio: false });
  }
  me.onSaved({ id, tabId: me.tab.id, discarded: !!me.discard });
}
