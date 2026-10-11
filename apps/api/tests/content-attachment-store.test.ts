import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createContentObjectStore, type LockedContentObject, type ReservedAttachment } from '../src/content-object-store.js';
const roots: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=', 'base64');
const descriptor = (suffix = 'a'): ReservedAttachment => ({ objectId: `obj_${suffix.repeat(64)}`, sha256: createHash('sha256').update(png).digest('hex'), sizeBytes: png.length, mime: 'image/png' });
const store = () => { const root = mkdtempSync(path.join(tmpdir(), 'ca-attachment-')); roots.push(root); return createContentObjectStore(root); };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('persists an already reserved image and reads identical bytes in a fresh instance without write locks', async () => {
  const first = store(), expected = descriptor();
  await first.persistAttachment(expected, png);
  const fresh = createContentObjectStore(first.rootDirectory);
  await first.withObjectLock(expected.objectId, async () => { expect(await fresh.readAttachment(expected)).toEqual(png); });
  expect(await fresh.persistAttachment(expected, png)).toEqual(expected);
  expect(readFileSync(path.join(first.rootDirectory, 'objects', expected.objectId))).toEqual(png);
});
it('never overwrites a malformed or mismatched final attachment', async () => {
  const s = store(), expected = descriptor();
  await s.persistAttachment(expected, png);
  const location = path.join(s.rootDirectory, 'objects', expected.objectId);
  const bad = Buffer.alloc(png.length, 0); writeFileSync(location, bad);
  await expect(s.persistAttachment(expected, png)).rejects.toThrow('CONTENT_ATTACHMENT_INVALID');
  expect(readFileSync(location)).toEqual(bad);
  await expect(s.readAttachment(expected)).rejects.toThrow('CONTENT_ATTACHMENT_INVALID');
});
it('checks descriptor, byte digest, MIME signature and size before writing', async () => {
  const s = store(), expected = descriptor();
  await expect(s.persistAttachment({ ...expected, objectId: '../escape' }, png)).rejects.toThrow('CONTENT_OBJECT_INVALID');
  await expect(s.persistAttachment({ ...expected, mime: 'image/gif' }, png)).rejects.toThrow('CONTENT_ATTACHMENT_INVALID');
  await expect(s.persistAttachment({ ...expected, sha256: 'f'.repeat(64) }, png)).rejects.toThrow('CONTENT_ATTACHMENT_INVALID');
  await expect(s.persistAttachment({ ...expected, sizeBytes: 5 * 1024 * 1024 + 1 }, png)).rejects.toThrow('CONTENT_ATTACHMENT_INVALID');
});
it('rejects symlink payloads and a symlink private subdirectory', async () => {
  const s = store(), expected = descriptor();
  const outside = path.join(s.rootDirectory, 'external'); writeFileSync(outside, png);
  symlinkSync(outside, path.join(s.rootDirectory, 'objects', expected.objectId));
  await expect(s.readPayload(expected.objectId)).rejects.toThrow();
  await expect(s.readAttachment(expected)).rejects.toThrow();
  await expect(s.reclaim(expected.objectId)).rejects.toThrow('CONTENT_OBJECT_INVALID');
  rmSync(path.join(s.rootDirectory, 'locks'), { recursive: true }); symlinkSync(s.rootDirectory, path.join(s.rootDirectory, 'locks'));
  await expect(s.persistAttachment(expected, png)).rejects.toThrow('CONTENT_STORE_INVALID');
});
it('keeps the same object locked across store instances and both generic and attachment reclaim', async () => {
  const first = store(), second = createContentObjectStore(first.rootDirectory), expected = descriptor();
  await first.withObjectLock(expected.objectId, async locked => {
    await expect(second.persistAttachment(expected, png)).rejects.toThrow('CONTENT_OBJECT_BUSY');
    await expect(second.reclaim(expected.objectId)).rejects.toThrow('CONTENT_OBJECT_BUSY');
    await locked.persistAttachment(expected, png);
    expect(await locked.reclaim()).toBe('reclaimed');
  });
  await second.persistAttachment(expected, png);
});
it('rejects an escaped locked capability after its owner scope has ended', async () => {
  const s = store(); let escaped: LockedContentObject | undefined;
  await s.withObjectLock(descriptor().objectId, async locked => { escaped = locked; });
  expect(() => escaped!.reclaim()).toThrow('CONTENT_OBJECT_LOCK_EXPIRED');
});
it('retains and reports an unowned lock instead of silently removing it', async () => {
  const s = store(), expected = descriptor();
  await expect(s.withObjectLock(expected.objectId, async () => {
    writeFileSync(path.join(s.rootDirectory, 'locks', `${expected.objectId}.lock`, 'owner'), 'different-owner');
  })).rejects.toThrow('CONTENT_OBJECT_LOCK_RELEASE');
  await expect(s.reclaim(expected.objectId)).rejects.toThrow('CONTENT_OBJECT_BUSY');
});
it('excludes a second process and leaves a killed writer lock busy while committed bytes remain readable', async () => {
  const s = store(), expected = descriptor(); await s.persistAttachment(expected, png);
  // Keep the child event loop alive until SIGKILL; an unresolved top-level
  // promise alone lets Node exit 13 before the parent exercises reclamation.
  const script = `import {createContentObjectStore} from ${JSON.stringify(new URL('../src/content-object-store.ts', import.meta.url).href)};
    const s=createContentObjectStore(process.argv[1]);
    await s.withObjectLock(process.argv[2],async()=>{process.stdout.write('LOCKED\\n');await new Promise(()=>{setInterval(()=>{},1000);});});`;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script, s.rootDirectory, expected.objectId], { stdio: ['ignore', 'pipe', 'pipe'] });
  const output: Buffer[] = []; child.stderr.on('data', chunk => output.push(chunk));
  try {
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error(Buffer.concat(output).toString()); })]);
    await expect(s.reclaim(expected.objectId)).rejects.toThrow('CONTENT_OBJECT_BUSY');
    expect(await s.readAttachment(expected)).toEqual(png);
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    await expect(s.reclaim(expected.objectId)).rejects.toThrow('CONTENT_OBJECT_BUSY');
    expect(await s.readAttachment(expected)).toEqual(png);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}, 10_000);

it('waits for already-started scoped I/O even when its callback returns first', async () => {
  const s = store(), expected = descriptor(); let pending: Promise<ReservedAttachment> | undefined;
  await s.withObjectLock(expected.objectId, async locked => { pending = locked.persistAttachment(expected, png); });
  expect(await pending).toEqual(expected);
  expect(await s.readAttachment(expected)).toEqual(png);
  expect(await s.reclaim(expected.objectId)).toBe('reclaimed');
});
