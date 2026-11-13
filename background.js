import { putCapture } from './db.js';

const MIN_GAP = 550;      // Chrome allows max 2 captureVisibleTab calls per second
const MAX_FRAMES = 80;
let lastShot = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg);
const badge = (tabId, text, color = '#2563eb') => {
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
};

function toBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: head.match(/:(.*?);/)[1] });
}
async function shot(tab) {
  const wait = lastShot + MIN_GAP - Date.now();
  if (wait > 0) await sleep(wait);
  const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  lastShot = Date.now();
  return toBlob(url);
}
async function finish(tab, frames, w, h) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await putCapture({ id, created: Date.now(), title: tab.title || 'capture', frames, w, h });
  badge(tab.id, '');
  await chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?id=' + id), index: tab.index + 1 });
}

async function runVisible(tab) {
  const blob = await shot(tab);
  const v = await send(tab.id, { t: 'viewport' });
  await finish(tab, [{ blob, vw: v.vw, sx: 0, sy: 0, sw: v.vw, sh: v.vh, dx: 0, dy: 0 }], v.vw, v.vh);
}

async function runArea(tab, r) {
  const blob = await shot(tab);
  await finish(tab, [{ blob, vw: r.vw, sx: r.x, sy: r.y, sw: r.w, sh: r.h, dx: 0, dy: 0 }], r.w, r.h);
}

async function runFull(tab) {
  const info = await send(tab.id, { t: 'prepare' });
  try {
    if (info.totalH <= info.vh + 4) {
      // Page itself does not scroll (typical for web apps): fall back to its main scrollable area.
      const found = await send(tab.id, { t: 'autoElement' });
      if (found) return await runElement(tab, true);
    }
    const maxY = Math.max(0, info.totalH - info.vh);
    const ys = [];
    for (let y = 0; y < maxY; y += info.vh) ys.push(y);
    ys.push(maxY);
    const frames = [];
    let last = -1, bottom = info.vh;
    for (let i = 0; i < ys.length && i < MAX_FRAMES; i++) {
      const r = await send(tab.id, { t: 'scroll', y: ys[i], i });
      if (r.y === last) break;
      last = r.y;
      badge(tab.id, Math.round(((i + 1) / ys.length) * 100) + '%');
      frames.push({ blob: await shot(tab), vw: info.vw, sx: 0, sy: 0, sw: info.vw, sh: info.vh, dx: 0, dy: r.y });
      bottom = r.y + info.vh;
    }
    await send(tab.id, { t: 'restore' });
    await finish(tab, frames, info.vw, Math.min(info.totalH, bottom));
  } catch (e) {
    await send(tab.id, { t: 'restore' }).catch(() => {});
    throw e;
  }
}

// A picked element that does not scroll itself: scroll the page past it and stitch the slices.
async function runBox(tab) {
  try {
    let e = await send(tab.id, { t: 'boxPrepare' });
    const frames = [];
    let right = 0, bottom = 0;
    const add = async e => {
      frames.push({ blob: await shot(tab), vw: e.vw, sx: e.sx, sy: e.sy, sw: e.sw, sh: e.sh, dx: e.offX, dy: e.offY });
      right = Math.max(right, e.offX + e.sw); bottom = Math.max(bottom, e.offY + e.sh);
    };
    await add(e);
    while (!e.fixed && e.offY + e.sh < e.totalH - 1 && frames.length < MAX_FRAMES) {
      const prev = e.offY;
      e = await send(tab.id, { t: 'boxScroll', dy: e.sh });
      if (e.offY <= prev + 0.5) break;                 // page cannot scroll any further
      badge(tab.id, Math.min(99, Math.round(((e.offY + e.sh) / e.totalH) * 100)) + '%');
      await add(e);
    }
    await send(tab.id, { t: 'restore' });
    await finish(tab, frames, Math.min(e.totalW, right), Math.min(e.totalH, bottom));
  } catch (err) {
    await send(tab.id, { t: 'restore' }).catch(() => {});
    throw err;
  }
}

async function runElement(tab, prepared = false) {
  if (!prepared && await send(tab.id, { t: 'elKind' }) === 'box') return runBox(tab);
  try {
    let e = await send(tab.id, { t: 'elPrepare', prepared });
    const frames = [];
    const add = async e => frames.push({
      blob: await shot(tab), vw: e.vw, sx: e.sx, sy: e.sy, sw: e.sw, sh: e.sh,
      dx: e.offX + e.scrollLeft, dy: e.offY + e.scrollTop
    });
    const step = Math.max(40, Math.floor(e.sh));
    const maxY = Math.max(0, e.totalH - e.ch);
    let last = -1;
    for (let y = 0, i = 0; i < MAX_FRAMES; y += step, i++) {
      e = await send(tab.id, { t: 'elScroll', y: Math.min(y, maxY) });
      if (e.scrollTop === last) break;
      last = e.scrollTop;
      badge(tab.id, Math.min(99, Math.round(((y + step) / (maxY + step)) * 100)) + '%');
      await add(e);
      if (y >= maxY) break;
    }
    if (e.sh < e.ch - 1) {           // element taller than the viewport: grab its bottom edge too
      e = await send(tab.id, { t: 'elTail' });
      await add(e);
    }
    await send(tab.id, { t: 'restore' });
    await finish(tab, frames, e.totalW, e.totalH);
  } catch (err) {
    await send(tab.id, { t: 'restore' }).catch(() => {});
    throw err;
  }
}

function fail(tab, e) {
  console.warn('CleanCapture:', e);
  badge(tab.id, 'ERR', '#dc2626');
  setTimeout(() => badge(tab.id, ''), 4000);
}

async function start(mode, tab, purpose = 'shot') {
  if (!tab || tab.id == null) throw new Error('No active tab');
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    if (mode === 'visible') {      // browser pages can't be scripted but may still be photographed
      const blob = await shot(tab);
      const bmp = await createImageBitmap(blob);
      return finish(tab, [{ blob, vw: bmp.width, sx: 0, sy: 0, sw: bmp.width, sh: bmp.height, dx: 0, dy: 0 }], bmp.width, bmp.height);
    }
    throw new Error('This page cannot be captured (browser pages and the Web Store block extensions). Try "Visible area".');
  }
  if (mode === 'area') return void await send(tab.id, { t: 'pickArea', purpose });
  if (mode === 'element') return void await send(tab.id, { t: 'pickElement', purpose });
  const run = mode === 'full' ? runFull : runVisible;
  run(tab).catch(e => fail(tab, e));
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.t === 'start') {
    chrome.tabs.get(msg.tabId)
      .then(tab => start(msg.mode, tab, msg.purpose))
      .then(() => respond({ ok: true }), e => respond({ ok: false, error: e.message }));
    return true;
  }
  if (msg.t === 'picked' && msg.purpose === 'record' && sender.tab) {
    // Record just this region: hand the rectangle to the recorder page.
    const r = msg.rect, q = new URLSearchParams({ crop: [r.x, r.y, r.w, r.h, r.vw, r.vh].map(n => Math.round(n)).join(','), title: sender.tab.title || 'this tab' });
    chrome.tabs.create({ url: chrome.runtime.getURL('recorder.html?' + q), index: sender.tab.index + 1 });
    return;
  }
  if (msg.t === 'picked' && sender.tab) {
    const run = msg.mode === 'area' ? runArea(sender.tab, msg.rect) : runElement(sender.tab);
    run.catch(e => fail(sender.tab, e));
  }
});

chrome.commands.onCommand.addListener((cmd, tab) => {
  const mode = cmd.replace('capture-', '');
  start(mode, tab).catch(e => fail(tab, e));
});
