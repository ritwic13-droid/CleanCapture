import { clearCaptures } from './db.js';
const err = document.getElementById('err');
for (const b of document.querySelectorAll('button[data-mode]')) {
  b.addEventListener('click', async () => {
    err.textContent = '';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const r = await chrome.runtime.sendMessage({ t: 'start', mode: b.dataset.mode, tabId: tab.id });
    if (r?.ok) window.close();
    else err.textContent = r?.error || 'Capture failed.';
  });
}
document.getElementById('record').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('recorder.html') });
  window.close();
});
document.getElementById('clear').addEventListener('click', async () => {
  await clearCaptures();
  document.getElementById('cleared').textContent = 'Cleared.';
});
