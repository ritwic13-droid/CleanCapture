import { clearCaptures } from './db.js';
const err = document.getElementById('err');
for (const b of document.querySelectorAll('button[data-mode]')) {
  b.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const r = await chrome.runtime.sendMessage({ t: 'start', mode: b.dataset.mode, tabId: tab.id });
    if (r?.ok) window.close();
    else { err.hidden = false; err.textContent = r?.error || 'Capture failed.'; }
  });
}
document.getElementById('clear').addEventListener('click', async e => {
  e.preventDefault();
  await clearCaptures();
  e.target.textContent = 'Cleared';
});
