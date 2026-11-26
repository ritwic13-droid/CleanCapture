// Shared by the recorder page and the offscreen recorder.
// MediaRecorder writes WebM without a duration, so players show no length and cannot seek.
// Insert a Duration element into the Segment Info header.
export async function addWebmDuration(blob, ms) {
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
