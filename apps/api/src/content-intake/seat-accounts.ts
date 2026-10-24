import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Password accounts for seats, owned by the API instead of the desktop app.
 *
 * The file format belongs to `scripts/synthetic-stack/identity-admission.ts`, which reads it
 * on every `/password` request, so a write here takes effect on the next login with no reload
 * signal.
 *
 * The hash is scrypt with a per-account salt, exactly what the reader verifies. Writing is
 * atomic through a sibling temporary file and a rename, so a crash cannot leave a half-written
 * file that locks every seat out.
 */
export type PasswordAccountRow = Readonly<{
  username: string;
  bindingId: string;
  salt: string;
  hash: string;
}>;

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function seatUsername(value: unknown): string | null {
  if (typeof value !== 'string' || !USERNAME_PATTERN.test(value)) return null;
  return value;
}

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function readRows(file: string): PasswordAccountRow[] {
  if (!existsSync(file)) return [];
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('password account file is not an array');
  return raw.filter((row): row is PasswordAccountRow => Boolean(row) && typeof row === 'object'
    && typeof (row as PasswordAccountRow).username === 'string'
    && typeof (row as PasswordAccountRow).bindingId === 'string'
    && typeof (row as PasswordAccountRow).salt === 'string'
    && typeof (row as PasswordAccountRow).hash === 'string');
}

function writeRows(file: string, rows: readonly PasswordAccountRow[]): void {
  const temporary = `${file}.tmp-${randomBytes(6).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

export type PasswordAccountFile = Readonly<{
  /** Idempotent: an existing row for the same username is replaced, so a retried create
   *  cannot fail on a half-finished earlier attempt. */
  upsert: (username: string, bindingId: string, password: string) => void;
  remove: (username: string) => boolean;
  usernames: () => readonly string[];
}>;

export function createPasswordAccountFile(file: string): PasswordAccountFile {
  return Object.freeze({
    upsert(username, bindingId, password) {
      const rows = readRows(file);
      const { salt, hash } = hashPassword(password);
      const next = rows.filter((row) => row.username !== username);
      next.push({ username, bindingId, salt, hash });
      next.sort((left, right) => left.username.localeCompare(right.username));
      writeRows(file, next);
    },
    remove(username) {
      const rows = readRows(file);
      const next = rows.filter((row) => row.username !== username);
      if (next.length === rows.length) return false;
      writeRows(file, next);
      return true;
    },
    usernames() {
      return Object.freeze(readRows(file).map((row) => row.username));
    },
  });
}

/** The account file lives beside the stack, which is how the identity server finds it. */
export function seatAccountFilePath(stackRoot: string): string {
  if (!path.isAbsolute(stackRoot)) throw new Error('stack root must be absolute');
  return path.join(stackRoot, 'password-accounts.json');
}

/** Deterministic binding id for a seat, so create, reset and disable agree without a table. */
export function seatBindingId(username: string): string {
  return `synthetic_${username}`;
}

/** Stable per-seat user id, independent of the binding id. */
export function seatUserId(username: string): string {
  return `usr_seat_${createHash('sha256').update(username).digest('hex').slice(0, 24)}`;
}
