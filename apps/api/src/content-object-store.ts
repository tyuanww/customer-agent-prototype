import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
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
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export const CONTENT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const CONTENT_UPLOAD_TIMEOUT_MS = 30_000;
export const CONTENT_OBJECT_ID_PATTERN = /^obj_[0-9a-f]{64}$/;
export const CONTENT_IMPORT_BATCH_ID_PATTERN = /^imp_[A-Za-z0-9_-]{16,128}$/;

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

export type ContentObjectStore = Readonly<{
  persist: (
    bytes: AsyncIterable<Buffer>,
    declaredType: ContentSourceType,
    options?: Readonly<{ maxBytes?: number; timeoutMs?: number }>,
  ) => Promise<PersistedContentObject>;
  readPayload: (objectId: string) => Promise<Buffer>;
  verify: (objectId: string, sha256: string, sizeBytes: number) => Promise<boolean>;
  writeReceipt: (receipt: ContentBatchReceipt) => Promise<void>;
  readReceipt: (importBatchId: string) => Promise<ContentBatchReceipt | null>;
  reclaim: (objectId: string) => Promise<'reclaimed' | 'retained'>;
  rootDirectory: string;
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
export function createContentObjectStore(rootDirectory: string): ContentObjectStore {
  if (!path.isAbsolute(rootDirectory) || rootDirectory.includes('\0')) {
    throw new Error('CONTENT_STORE_INVALID');
  }
  mkdirSync(rootDirectory, { recursive: true, mode: 0o700 });
  const root = realpathSync(rootDirectory);
  const tmpRoot = resolveInside(root, 'tmp');
  const objectRoot = resolveInside(root, 'objects');
  const receiptRoot = resolveInside(root, 'batches');
  mkdirSync(tmpRoot, { recursive: true, mode: 0o700 });
  mkdirSync(objectRoot, { recursive: true, mode: 0o700 });
  mkdirSync(receiptRoot, { recursive: true, mode: 0o700 });
  if (!statSync(root).isDirectory() || !statSync(tmpRoot).isDirectory()) {
    throw new Error('CONTENT_STORE_INVALID');
  }

  async function referencedObjectIds(): Promise<Set<string>> {
    const names = await readdir(receiptRoot).catch(() => [] as string[]);
    const referenced = new Set<string>();
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const raw = await readFile(path.join(receiptRoot, name), 'utf8').catch(() => '');
      try {
        const parsed = JSON.parse(raw) as { objectId?: unknown };
        if (typeof parsed.objectId === 'string' && CONTENT_OBJECT_ID_PATTERN.test(parsed.objectId)) {
          referenced.add(parsed.objectId);
        }
      } catch {
        // Unreadable receipts keep their objects; never delete on parse failure.
      }
    }
    return referenced;
  }

  return Object.freeze({
    rootDirectory: root,
    async persist(bytes, declaredType, options = {}) {
      const maxBytes = options.maxBytes ?? CONTENT_UPLOAD_MAX_BYTES;
      const timeoutMs = options.timeoutMs ?? CONTENT_UPLOAD_TIMEOUT_MS;
      const id = objectId();
      const tempPath = resolveInside(tmpRoot, `${id}.part`);
      const finalPath = resolveInside(objectRoot, id);
      const hash = createHash('sha256');
      let size = 0;
      let head = Buffer.alloc(0);
      let fd: number | undefined;
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
        const sourceType = detectSourceType(head, declaredType);
        if (sourceType === null) throw new Error('CONTENT_UPLOAD_TYPE');
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        fsyncDirectory(tmpRoot);
        renameSync(tempPath, finalPath);
        fsyncDirectory(objectRoot);
        const sha256 = hash.digest('hex');
        const verified = readFileSync(finalPath);
        if (verified.length !== size
          || createHash('sha256').update(verified).digest('hex') !== sha256) {
          throw new Error('CONTENT_UPLOAD_VERIFY');
        }
        return Object.freeze({ objectId: id, sha256, sizeBytes: size, sourceType });
      } catch (error) {
        if (fd !== undefined) {
          try { closeSync(fd); } catch { /* exclusive temp cleanup continues */ }
        }
        try { rmSync(tempPath, { force: true }); } catch { /* already gone */ }
        try { rmSync(finalPath, { force: true }); } catch { /* persist never completed */ }
        throw timedOut ? new Error('CONTENT_UPLOAD_TIMEOUT') : error;
      } finally {
        clearTimeout(timer);
      }
    },

    async readPayload(id) {
      assertObjectId(id);
      return readFile(resolveInside(objectRoot, id));
    },

    async verify(id, sha256, sizeBytes) {
      assertObjectId(id);
      const payload = await readFile(resolveInside(objectRoot, id)).catch(() => null);
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

    async reclaim(id) {
      assertObjectId(id);
      if ((await referencedObjectIds()).has(id)) return 'retained';
      await rm(resolveInside(objectRoot, id), { force: true });
      await rm(resolveInside(tmpRoot, `${id}.part`), { force: true });
      return 'reclaimed';
    },
  });
}
