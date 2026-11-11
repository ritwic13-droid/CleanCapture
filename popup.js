import { clearCaptures } from './db.js';
const $ = s => document.querySelector(s), err = $('#err');

// Screenshot / Record switch (remembers the last choice on this device)
function setKind(kind) {
  $('#p-shot').hidden = kind !== 'shot';
  $('#p-rec').hidden = kind !== 'rec';
  try { localStorage.setItem('kind', kind); } catch {}
}
for (const r of document.querySelectorAll('input[name=kind]')) r.addEventListener('change', () => setKind(r.value));
let saved = 'shot';
try { saved = localStorage.getItem('kind') || 'shot'; } catch {}
document.querySelector(`input[name=kind][value=${saved === 'rec' ? 'rec' : 'shot'}]`).checked = true;
setKind(saved === 'rec' ? 'rec' : 'shot');

// Recording just part of a page needs frame-level cropping, which only Chromium browsers offer.
if (!('MediaStreamTrackProcessor' in window && 'MediaStreamTrackGenerator' in window)) {
  for (const b of document.querySelectorAll('.needs-crop')) b.hidden = true;
  $('#nocrop').hidden = false;
}

async function start(mode, purpose) {
  err.textContent = '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const r = await chrome.runtime.sendMessage({ t: 'start', mode, purpose, tabId: tab.id });
  if (r?.ok) window.close();
  else err.textContent = r?.error || 'Capture failed.';
}
for (const b of document.querySelectorAll('button[data-mode]')) b.addEventListener('click', () => start(b.dataset.mode, 'shot'));
for (const b of document.querySelectorAll('button[data-rec]')) b.addEventListener('click', () => start(b.dataset.rec, 'record'));
for (const b of document.querySelectorAll('button[data-open]')) b.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL(b.dataset.open) });
  window.close();
});
$('#clear').addEventListener('click', async () => {
  await clearCaptures();
  $('#cleared').textContent = 'Cleared.';
});
