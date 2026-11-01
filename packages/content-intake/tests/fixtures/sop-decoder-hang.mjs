import { writeFileSync } from 'node:fs';
export function checkSopMedia() {
  const marker = new URL(import.meta.url).searchParams.get('marker');
  if (!marker) throw new Error('SYNTHETIC_MARKER_REQUIRED');
  writeFileSync(marker, 'started', { mode: 0o600 });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15_000);
  return null;
}
