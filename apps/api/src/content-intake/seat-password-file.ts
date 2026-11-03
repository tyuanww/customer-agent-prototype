import { randomBytes, scrypt } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Writes the password entry a seat logs in with.
 *
 * The file and its format belong to the identity server: `scripts/synthetic-stack/identity-admission.ts`
 * reads it on every `POST /password`, so a write here takes effect on the next login with no reload
 * signal. That reader accepts a 32-hex salt and a 128-hex scrypt hash and rejects anything else, so
 * these parameters cannot drift from it. `seat-password-file.test.ts` round-trips a written entry
 * through the real reader, which is what makes that coupling a check instead of a comment.
 *
 * A half-written file would make `reloadPasswordAccounts` return null and turn every seat's next
 * login into a 503. The write therefore lands as a complete file by rename. A sibling lock directory
 * serializes the read-modify-write across API processes, which is necessary because two writers can
 * otherwise both read the same snapshot and the later rename erases the earlier account.
 */
const USERNAME = /^[A-Za-z0-9_-]{1,64}$/;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

export type SeatPasswordFile = Readonly<{
  /** Replaces any existing entry for the username, so a retried reset cannot fail on a leftover. */
  upsert: (username: string, bindingId: string, password: string) => Promise<void>;
  remove: (username: string) => Promise<boolean>;
}>;

type Row = Readonly<{ username: string; bindingId: string; salt: string; hash: string }>;
type LockOwner = Readonly<{ token: string; pid: number }>;

async function readRows(file: string): Promise<Row[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error('password account file is not an array');
  const rows: Row[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('password account file has a row this writer cannot preserve');
    }
    const row = entry as Record<string, unknown>;
    // A row this module cannot read is not silently dropped: rewriting the file without it would
    // delete an account somebody else created.
    if (typeof row.username !== 'string' || typeof row.bindingId !== 'string'
      || typeof row.salt !== 'string' || typeof row.hash !== 'string') {
      throw new Error('password account file has a row this writer cannot preserve');
    }
    rows.push({ username: row.username, bindingId: row.bindingId, salt: row.salt, hash: row.hash });
  }
  return rows;
}

async function writeRows(file: string, rows: readonly Row[]): Promise<void> {
  const directory = path.dirname(file);
  const prefix = `${path.basename(file)}.tmp-`;
  for (const entry of await readdir(directory)) {
    if (entry.startsWith(prefix)) await rm(path.join(directory, entry), { force: true });
  }
  const temporary = `${file}.tmp-${randomBytes(6).toString('hex')}`;
  try {
    const descriptor = await open(temporary, 'wx', 0o600);
    try {
      await descriptor.writeFile(`${JSON.stringify(rows, null, 2)}\n`);
      await descriptor.sync();
    } finally {
      await descriptor.close();
    }
    await rename(temporary, file);
    if (process.platform !== 'win32') {
      const directoryDescriptor = await open(directory, 'r');
      try {
        await directoryDescriptor.sync();
      } finally {
        await directoryDescriptor.close();
      }
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readLockOwner(lock: string): Promise<LockOwner | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const owner = raw as Record<string, unknown>;
    if (typeof owner.token !== 'string' || !Number.isSafeInteger(owner.pid) || (owner.pid as number) <= 0) {
      return null;
    }
    return { token: owner.token, pid: owner.pid as number };
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !!error && typeof error === 'object' && 'code' in error && error.code === 'EPERM';
  }
}

async function releaseOwnedLock(lock: string, token: string): Promise<void> {
  if ((await readLockOwner(lock))?.token === token) await rm(lock, { recursive: true, force: true });
}

async function withFileLock<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  const token = randomBytes(16).toString('hex');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      try {
        await open(path.join(lock, 'owner.json'), 'wx', 0o600).then(async (descriptor) => {
          try {
            await descriptor.writeFile(JSON.stringify({
              token,
              pid: process.pid,
            }));
            await descriptor.sync();
          } finally {
            await descriptor.close();
          }
        });
      } catch (error) {
        await rm(lock, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
      const owner = await readLockOwner(lock);
      if (owner && !processIsAlive(owner.pid)) {
        if ((await readLockOwner(lock))?.token === owner.token) {
          await rm(lock, { recursive: true, force: true });
        }
        continue;
      }
      try {
        const age = Date.now() - (await stat(lock)).mtimeMs;
        if (!owner && age > LOCK_STALE_MS) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
      } catch (statusError) {
        if (!statusError || typeof statusError !== 'object' || !('code' in statusError) || statusError.code !== 'ENOENT') {
          throw statusError;
        }
        continue;
      }
      if (Date.now() >= deadline) throw new Error('password account file lock timed out');
      await delay(LOCK_RETRY_MS);
    }
  }
  try {
    return await operation();
  } finally {
    await releaseOwnedLock(lock, token);
  }
}

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString('hex'));
    });
  });
}

/** The identity server resolves this exact path, so it is not configurable. */
export function seatPasswordFilePath(stackRoot: string): string {
  if (!path.isAbsolute(stackRoot)) throw new Error('stack root must be absolute');
  return path.join(stackRoot, 'password-accounts.json');
}

export function createSeatPasswordFile(file: string): SeatPasswordFile {
  return Object.freeze({
    async upsert(username, bindingId, password) {
      if (!USERNAME.test(username)) throw new Error('seat username is not valid');
      if (typeof password !== 'string' || password.length < 8 || password.length > 256) {
        throw new Error('seat password is not valid');
      }
      const salt = randomBytes(SALT_BYTES).toString('hex');
      const hash = await hashPassword(password, salt);
      await withFileLock(file, async () => {
        const rows = (await readRows(file)).filter((row) => row.username !== username);
        rows.push({ username, bindingId, salt, hash });
        rows.sort((left, right) => left.username.localeCompare(right.username));
        await writeRows(file, rows);
      });
    },
    async remove(username) {
      return withFileLock(file, async () => {
        const rows = await readRows(file);
        const kept = rows.filter((row) => row.username !== username);
        if (kept.length === rows.length) return false;
        await writeRows(file, kept);
        return true;
      });
    },
  });
}
