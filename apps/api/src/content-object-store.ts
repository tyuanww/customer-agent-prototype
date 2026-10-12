import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  linkSync,
  rmdirSync,
  unlinkSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { open, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export const CONTENT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const CONTENT_UPLOAD_TIMEOUT_MS = 30_000;
export const CONTENT_OBJECT_ID_PATTERN = /^obj_[0-9a-f]{64}$/;
export const CONTENT_IMPORT_BATCH_ID_PATTERN = /^imp_[A-Za-z0-9_-]{16,128}$/;
export const ACTOR_IN_FLIGHT_IMPORT_ID = 'imp_actor_in_flight_01';

export type ContentSourceType = 'csv' | 'excel';

export type PersistedContentObject = Readonly<{
  objectId: string;
  sha256: string;
  sizeBytes: number;
  sourceType: ContentSourceType;
}>;

export type ContentBatchReceipt = Readonly<{
  importBatchId: string;
  objectId: string;
  sourceType: ContentSourceType;
  sha256: string;
  sizeBytes: number;
  sourceBindingHash: string;
  sourceBindings: readonly Readonly<{ domain: string; source_version_id: string }>[];
}>;

export type AttachmentMime = 'image/png' | 'image/jpeg' | 'image/gif';
/** Internal descriptor from a durable reservation, never a client filename. */
export type ReservedAttachment = Readonly<{ objectId: string; sha256: string; sizeBytes: number; mime: AttachmentMime }>;
export type LockedContentObject = Readonly<{
  persistAttachment: (expected: ReservedAttachment, bytes: Buffer) => Promise<ReservedAttachment>;
  readAttachment: (expected: ReservedAttachment) => Promise<Buffer>;
  reclaim: () => Promise<'reclaimed' | 'retained'>;
}>;

export type ContentObjectStore = Readonly<{
  persist: (
    bytes: AsyncIterable<Buffer>,
    declaredType: ContentSourceType,
    options?: Readonly<{ maxBytes?: number; timeoutMs?: number; beforeWrite?: (objectId: string) => Promise<void> }>,
  ) => Promise<PersistedContentObject>;
  readPayload: (objectId: string) => Promise<Buffer>;
  verify: (objectId: string, sha256: string, sizeBytes: number) => Promise<boolean>;
  writeReceipt: (receipt: ContentBatchReceipt) => Promise<void>;
  readReceipt: (importBatchId: string) => Promise<ContentBatchReceipt | null>;
  reclaim: (objectId: string) => Promise<'reclaimed' | 'retained'>;
  readiness: () => Promise<'ok' | 'not_ready'>;
  rootDirectory: string;
}>;

export type ContentAttachmentStore = ContentObjectStore & Readonly<{
  persistAttachment: (expected: ReservedAttachment, bytes: Buffer) => Promise<ReservedAttachment>;
  readAttachment: (expected: ReservedAttachment) => Promise<Buffer>;
  withObjectLock: <T>(objectId: string, work: (object: LockedContentObject) => Promise<T>) => Promise<T>;
}>;

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function objectId(): string {
  return `obj_${randomBytes(32).toString('hex')}`;
}

function assertObjectId(id: string): void {
  if (!CONTENT_OBJECT_ID_PATTERN.test(id)) throw new Error('CONTENT_OBJECT_INVALID');
}

function resolveInside(root: string, ...segments: string[]): string {
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('CONTENT_OBJECT_INVALID');
  }
  return resolved;
}

function fsyncDirectory(directory: string): void {
  const fd = openSync(directory, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function detectSourceType(head: Buffer, declared: ContentSourceType): ContentSourceType | null {
  const zip = head.length >= 4 && head.subarray(0, 4).equals(XLSX_MAGIC);
  if (declared === 'excel') return zip ? 'excel' : null;
  if (zip) return null;
  return 'csv';
}

/**
 * Owns the single-host immutable object namespace. Internal keys are generated
 * here; upload filenames never become paths. Reclaim only deletes objects that
 * have no local batch receipt, which is the store's reference check. Callers
 * must not invoke reclaim when a database commit result is unknown.
 */
export function createContentObjectStore(rootDirectory: string): ContentAttachmentStore {
  if (!path.isAbsolute(rootDirectory) || rootDirectory.includes('\0')) {
    throw new Error('CONTENT_STORE_INVALID');
  }
  mkdirSync(rootDirectory, { recursive: true, mode: 0o700 });
  if (!lstatSync(rootDirectory).isDirectory() || lstatSync(rootDirectory).isSymbolicLink()) throw new Error('CONTENT_STORE_INVALID');
  const root = realpathSync(rootDirectory);
  const tmpRoot = resolveInside(root, 'tmp');
  const objectRoot = resolveInside(root, 'objects');
  const receiptRoot = resolveInside(root, 'batches');
  const lockRoot = resolveInside(root, 'locks');
  mkdirSync(tmpRoot, { recursive: true, mode: 0o700 });
  mkdirSync(objectRoot, { recursive: true, mode: 0o700 });
  mkdirSync(receiptRoot, { recursive: true, mode: 0o700 });
  mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  for (const directory of [root, tmpRoot, objectRoot, receiptRoot, lockRoot]) {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('CONTENT_STORE_INVALID');
  }
  if (!statSync(root).isDirectory() || !statSync(tmpRoot).isDirectory()) {
    throw new Error('CONTENT_STORE_INVALID');
  }

  async function referencedObjectIds(): Promise<Set<string>> {
    const names = await readdir(receiptRoot);
    const referenced = new Set<string>();
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const raw = await readFile(path.join(receiptRoot, name), 'utf8');
      try {
        const parsed = JSON.parse(raw) as { objectId?: unknown };
        if (typeof parsed.objectId === 'string' && CONTENT_OBJECT_ID_PATTERN.test(parsed.objectId)) {
          referenced.add(parsed.objectId);
        } else throw new Error('CONTENT_RECEIPT_INVALID');
      } catch {
        // A damaged receipt may name any object. Fail closed for the whole scan.
        throw new Error('CONTENT_RECEIPT_INVALID');
      }
    }
    return referenced;
  }

  async function writeObject<T extends string>(id: string, bytes: AsyncIterable<Buffer>, maxBytes: number,
    timeoutMs: number, detect: (head: Buffer) => T | null) {
    const tempPath = resolveInside(tmpRoot, `${id}.part`);
      const finalPath = resolveInside(objectRoot, id);
      const hash = createHash('sha256');
      let size = 0;
      let head = Buffer.alloc(0);
      let fd: number | undefined;
      let published = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (bytes instanceof Readable) bytes.destroy(new Error('CONTENT_UPLOAD_TIMEOUT'));
      }, timeoutMs);
      try {
        fd = openSync(tempPath, 'wx', 0o600);
        for await (const chunk of bytes) {
          if (timedOut) throw new Error('CONTENT_UPLOAD_TIMEOUT');
          if (chunk.length === 0) continue;
          size += chunk.length;
          if (size > maxBytes) throw new Error('CONTENT_UPLOAD_TOO_LARGE');
          hash.update(chunk);
          if (head.length < 4) head = Buffer.concat([head, chunk], Math.min(4, head.length + chunk.length));
          writeSync(fd, chunk);
        }
        if (timedOut) throw new Error('CONTENT_UPLOAD_TIMEOUT');
        if (size < 1) throw new Error('CONTENT_UPLOAD_EMPTY');
        const sourceType = detect(head);
        if (sourceType === null) throw new Error('CONTENT_UPLOAD_TYPE');
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        fsyncDirectory(tmpRoot);
        linkSync(tempPath, finalPath);
        published = true;
        unlinkSync(tempPath);
        fsyncDirectory(objectRoot);
        const sha256 = hash.digest('hex');
        const verified = readFileSync(finalPath);
        if (verified.length !== size
          || createHash('sha256').update(verified).digest('hex') !== sha256) {
          throw new Error('CONTENT_UPLOAD_VERIFY');
        }
        return Object.freeze({ objectId: id, sha256, sizeBytes: size, detected: sourceType });
      } catch (error) {
        if (fd !== undefined) {
          try { closeSync(fd); } catch { /* exclusive temp cleanup continues */ }
        }
        try { rmSync(tempPath, { force: true }); } catch { /* already gone */ }
        if (published) { try { rmSync(finalPath, { force: true }); } catch { /* persist never completed */ } }
        throw timedOut ? new Error('CONTENT_UPLOAD_TIMEOUT') : error;
      } finally {
        clearTimeout(timer);
      }

  }

  function privateDirectory(directory: string): void {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('CONTENT_STORE_INVALID');
  }
  function attachment(expected: ReservedAttachment): void {
    assertObjectId(expected.objectId);
    if (!/^[a-f0-9]{64}$/.test(expected.sha256) || !Number.isSafeInteger(expected.sizeBytes)
      || expected.sizeBytes < 1 || expected.sizeBytes > 5 * 1024 * 1024
      || !['image/png', 'image/jpeg', 'image/gif'].includes(expected.mime)) throw new Error('CONTENT_ATTACHMENT_INVALID');
  }
  function imageMatches(bytes: Buffer, mime: AttachmentMime): boolean {
    if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    return bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a';
  }
  async function readObject(id: string, exactBytes?: number): Promise<Buffer> {
    assertObjectId(id); privateDirectory(objectRoot);
    const file = await open(resolveInside(objectRoot, id), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || (exactBytes !== undefined && info.size !== exactBytes)) throw new Error('CONTENT_OBJECT_INVALID');
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), CONTENT_UPLOAD_TIMEOUT_MS);
      try { return await file.readFile({ signal: abort.signal }); }
      finally { clearTimeout(timer); }
    } finally { await file.close(); }
  }
  async function readAttachment(expected: ReservedAttachment): Promise<Buffer> {
    attachment(expected);
    const bytes = await readObject(expected.objectId, expected.sizeBytes);
    if (bytes.length !== expected.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256
      || !imageMatches(bytes, expected.mime)) throw new Error('CONTENT_ATTACHMENT_INVALID');
    return bytes;
  }
  async function reclaimObject(id: string): Promise<'reclaimed' | 'retained'> {
    if ((await referencedObjectIds()).has(id)) return 'retained';
    privateDirectory(objectRoot); privateDirectory(tmpRoot);
    for (const target of [resolveInside(objectRoot, id), resolveInside(tmpRoot, `${id}.part`)]) {
      try { if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) throw new Error('CONTENT_OBJECT_INVALID'); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      await rm(target, { force: true });
    }
    fsyncDirectory(objectRoot); fsyncDirectory(tmpRoot);
    return 'reclaimed';
  }
  async function withObjectLock<T>(id: string, work: (locked: LockedContentObject) => Promise<T>): Promise<T> {
    assertObjectId(id); privateDirectory(lockRoot); privateDirectory(tmpRoot); privateDirectory(objectRoot);
    const lock = resolveInside(lockRoot, `${id}.lock`);
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new Error('CONTENT_OBJECT_BUSY'); throw error; }
    const token = randomBytes(32).toString('hex'), tokenPath = path.join(lock, 'owner');
    // A failure establishing ownership intentionally leaves a conservative busy lock.
    writeFileSync(tokenPath, token, { flag: 'wx', mode: 0o600 }); fsyncDirectory(lockRoot);
    let active = true;
    const assertActive = () => { if (!active) throw new Error('CONTENT_OBJECT_LOCK_EXPIRED'); };
    const inFlight = new Set<Promise<unknown>>();
    let serial = Promise.resolve();
    const track = <V>(work: () => Promise<V>): Promise<V> => {
      assertActive(); const operation = serial.then(work); inFlight.add(operation);
      serial = operation.then(() => undefined, () => undefined);
      void operation.finally(() => inFlight.delete(operation)).catch(() => undefined);
      return operation;
    };
    let failed = false; let originalError: unknown; let value: T | undefined;
    try {
      value = await work(Object.freeze({
        persistAttachment(expected: ReservedAttachment, bytes: Buffer) { return track(async () => {
          attachment(expected);
          if (expected.objectId !== id || bytes.length !== expected.sizeBytes
            || createHash('sha256').update(bytes).digest('hex') !== expected.sha256 || !imageMatches(bytes, expected.mime)) throw new Error('CONTENT_ATTACHMENT_INVALID');
          try { await readAttachment(expected); return expected; }
          catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
          // The lifecycle owner rechecked reserved state inside this scope. Only
          // a leftover private temp may be removed; an existing final is immutable.
          const temporary = resolveInside(tmpRoot, `${id}.part`);
          try { if (!lstatSync(temporary).isFile() || lstatSync(temporary).isSymbolicLink()) throw new Error('CONTENT_OBJECT_INVALID'); unlinkSync(temporary); }
          catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
          await writeObject(id, (async function* () { yield bytes; })(), expected.sizeBytes, CONTENT_UPLOAD_TIMEOUT_MS, () => expected.mime);
          await readAttachment(expected); return expected;
        }); },
        readAttachment(expected: ReservedAttachment) { return track(async () => { if (expected.objectId !== id) throw new Error('CONTENT_ATTACHMENT_INVALID'); return readAttachment(expected); }); },
        reclaim() { return track(() => reclaimObject(id)); },
      }));
    } catch (error) { failed = true; originalError = error; }
    {
      active = false;
      await Promise.allSettled([...inFlight]);
      try {
        privateDirectory(lock);
        const fd = openSync(tokenPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        let owner: string;
        try { if (!fstatSync(fd).isFile()) throw new Error('CONTENT_OBJECT_LOCK_OWNER'); owner = readFileSync(fd, 'utf8'); }
        finally { closeSync(fd); }
        if (owner !== token) throw new Error('CONTENT_OBJECT_LOCK_OWNER');
        unlinkSync(tokenPath); rmdirSync(lock); fsyncDirectory(lockRoot);
      } catch (error) { throw new AggregateError(failed ? [originalError, error] : [error], 'CONTENT_OBJECT_LOCK_RELEASE'); }
    }
    if (failed) throw originalError;
    return value as T;
  }

  const store: ContentAttachmentStore = Object.freeze({
    rootDirectory: root,
    async persist(bytes, declaredType, options = {}) {
      const maxBytes = options.maxBytes ?? CONTENT_UPLOAD_MAX_BYTES;
      const timeoutMs = options.timeoutMs ?? CONTENT_UPLOAD_TIMEOUT_MS;
      const id = objectId();
      // Durable admission completes before any byte is written. Unknown admission
      // leaves no file; its owner retains the reservation for reconciliation.
      await options.beforeWrite?.(id);
      const written = await writeObject(id, bytes, maxBytes, timeoutMs, head => detectSourceType(head, declaredType));
      return Object.freeze({ objectId: written.objectId, sha256: written.sha256, sizeBytes: written.sizeBytes, sourceType: written.detected });
    },


    withObjectLock,
    readAttachment,
    async persistAttachment(expected, bytes) { return withObjectLock(expected.objectId, locked => locked.persistAttachment(expected, bytes)); },
    async readPayload(id) { return readObject(id); },

    async verify(id, sha256, sizeBytes) {
      assertObjectId(id);
      const payload = await readObject(id).catch(() => null);
      if (payload === null) return false;
      return payload.length === sizeBytes
        && createHash('sha256').update(payload).digest('hex') === sha256;
    },

    async writeReceipt(receipt) {
      assertObjectId(receipt.objectId);
      if (!CONTENT_IMPORT_BATCH_ID_PATTERN.test(receipt.importBatchId)) {
        throw new Error('CONTENT_OBJECT_INVALID');
      }
      const target = resolveInside(receiptRoot, `${receipt.importBatchId}.json`);
      const temp = resolveInside(tmpRoot, `${receipt.importBatchId}.json.part`);
      const body = JSON.stringify({
        importBatchId: receipt.importBatchId,
        objectId: receipt.objectId,
        sourceType: receipt.sourceType,
        sha256: receipt.sha256,
        sizeBytes: receipt.sizeBytes,
        sourceBindingHash: receipt.sourceBindingHash,
        sourceBindings: receipt.sourceBindings,
      });
      writeFileSync(temp, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      const fd = openSync(temp, 'r+');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, target);
      fsyncDirectory(receiptRoot);
    },

    async readReceipt(importBatchId) {
      if (!CONTENT_IMPORT_BATCH_ID_PATTERN.test(importBatchId)) return null;
      const raw = await readFile(
        resolveInside(receiptRoot, `${importBatchId}.json`),
        'utf8',
      ).catch(() => null);
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as ContentBatchReceipt;
        if (parsed.importBatchId !== importBatchId
          || !CONTENT_OBJECT_ID_PATTERN.test(parsed.objectId)
          || !/^[0-9a-f]{64}$/.test(parsed.sourceBindingHash)) {
          return null;
        }
        return Object.freeze(parsed);
      } catch {
        return null;
      }
    },

    async reclaim(id) { return withObjectLock(id, locked => locked.reclaim()); },

    async readiness() {
      const probe = Buffer.from('readiness,probe\n1,ok\n');
      let objectId: string | undefined;
      try {
        const persisted = await store.persist((async function* persistProbe() {
          yield probe;
        })(), 'csv', { maxBytes: 256, timeoutMs: 1_000 });
        objectId = persisted.objectId;
        const verified = await store.verify(persisted.objectId, persisted.sha256, persisted.sizeBytes);
        const roundTrip = await store.readPayload(persisted.objectId);
        const digest = createHash('sha256').update(roundTrip).digest('hex');
        if (!verified
          || roundTrip.length !== persisted.sizeBytes
          || digest !== persisted.sha256) {
          return 'not_ready';
        }
        return 'ok';
      } catch {
        return 'not_ready';
      } finally {
        if (objectId !== undefined) {
          await store.reclaim(objectId).catch(() => undefined);
        }
      }
    },
  });
  return store;
}
