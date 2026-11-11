// Local-only storage (IndexedDB inside the extension). Nothing ever leaves the device.
const NAME = 'clean-capture', STORE = 'captures', KEEP = 5;

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(db, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
export async function putCapture(cap) {
  const db = await open();
  await tx(db, 'readwrite', s => s.put(cap));
  const keys = (await tx(db, 'readonly', s => s.getAllKeys())).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) await tx(db, 'readwrite', s => s.delete(k));
  db.close();
}
export async function getCapture(id) {
  const db = await open();
  const cap = await tx(db, 'readonly', s => s.get(id));
  db.close();
  return cap;
}
export async function clearCaptures() {
  const db = await open();
  await tx(db, 'readwrite', s => s.clear());
  db.close();
}
