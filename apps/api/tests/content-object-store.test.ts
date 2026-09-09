import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTENT_UPLOAD_MAX_BYTES,
  createContentObjectStore,
} from '../src/content-object-store.js';

const roots: string[] = [];

afterEach(() => {
  roots.length = 0;
});

function store() {
  const root = mkdtempSync(path.join(tmpdir(), 'ca-content-'));
  roots.push(root);
  return createContentObjectStore(root);
}

async function* bytesOf(buffer: Buffer) {
  yield buffer;
}

describe('content object store', () => {
  it('persists an immutable object, verifies the digest, and reclaims unreferenced files', async () => {
    const objects = store();
    const payload = Buffer.from('script_id,title\n1,hello\n');
    const persisted = await objects.persist(bytesOf(payload), 'csv');
    expect(persisted.sizeBytes).toBe(payload.length);
    expect(persisted.sha256).toBe(createHash('sha256').update(payload).digest('hex'));
    expect(persisted.sourceType).toBe('csv');
    await expect(objects.verify(persisted.objectId, persisted.sha256, persisted.sizeBytes)).resolves.toBe(true);
    expect(await objects.reclaim(persisted.objectId)).toBe('reclaimed');
    await expect(objects.verify(persisted.objectId, persisted.sha256, persisted.sizeBytes)).resolves.toBe(false);
  });

  it('does not reclaim an object referenced by a committed batch receipt', async () => {
    const objects = store();
    const payload = Buffer.from('PK\x03\x04xlsx-bytes');
    const persisted = await objects.persist(bytesOf(payload), 'excel');
    await objects.writeReceipt({
      importBatchId: 'imp_referencedobject01',
      objectId: persisted.objectId,
      sourceType: 'excel',
      sha256: persisted.sha256,
      sizeBytes: persisted.sizeBytes,
      sourceBindingHash: 'a'.repeat(64),
      sourceBindings: [{ domain: 'presale', source_version_id: 'srcv_t2_presale_v1' }],
    });
    expect(await objects.reclaim(persisted.objectId)).toBe('retained');
    await expect(objects.verify(persisted.objectId, persisted.sha256, persisted.sizeBytes)).resolves.toBe(true);
  });

  it('stops one byte past the frozen 10 MiB upload ceiling', async () => {
    const objects = store();
    const oversized = Buffer.alloc(CONTENT_UPLOAD_MAX_BYTES + 1, 0x61);
    await expect(objects.persist(bytesOf(oversized), 'csv')).rejects.toThrow('CONTENT_UPLOAD_TOO_LARGE');
  });

  it('proves readiness by persist, verify, reread and reclaim', async () => {
    const objects = store();
    await expect(objects.readiness()).resolves.toBe('ok');
  });

  it('rejects a relative or NUL store root', () => {
    expect(() => createContentObjectStore('relative-store')).toThrow('CONTENT_STORE_INVALID');
    expect(() => createContentObjectStore(`/${'x'}\0y`)).toThrow('CONTENT_STORE_INVALID');
  });

  it('rejects a store root that is a regular file', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'ca-content-file-')), 'not-a-dir');
    writeFileSync(file, 'nope');
    expect(() => createContentObjectStore(file)).toThrow();
  });

  it('times out a stalled upload stream', async () => {
    const objects = store();
    const stalled = new Readable({
      read() {
        /* never pushes, so persist waits until timeout */
      },
    });
    const pending = objects.persist(stalled, 'csv', { timeoutMs: 20 });
    await expect(pending).rejects.toThrow('CONTENT_UPLOAD_TIMEOUT');
    stalled.destroy();
  });
});
