import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
 * login into a 503, so the write lands as a complete file by rename.
 */
const USERNAME = /^[A-Za-z0-9_-]{1,64}$/;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export type SeatPasswordFile = Readonly<{
  /** Replaces any existing entry for the username, so a retried reset cannot fail on a leftover. */
  upsert: (username: string, bindingId: string, password: string) => void;
  remove: (username: string) => boolean;
}>;

type Row = Readonly<{ username: string; bindingId: string; salt: string; hash: string }>;

function readRows(file: string): Row[] {
  if (!existsSync(file)) return [];
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('password account file is not an array');
  const rows: Row[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
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

function writeRows(file: string, rows: readonly Row[]): void {
  const temporary = `${file}.tmp-${randomBytes(6).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

/** The identity server resolves this exact path, so it is not configurable. */
export function seatPasswordFilePath(stackRoot: string): string {
  if (!path.isAbsolute(stackRoot)) throw new Error('stack root must be absolute');
  return path.join(stackRoot, 'password-accounts.json');
}

export function createSeatPasswordFile(file: string): SeatPasswordFile {
  return Object.freeze({
    upsert(username, bindingId, password) {
      if (!USERNAME.test(username)) throw new Error('seat username is not valid');
      if (typeof password !== 'string' || password.length < 8 || password.length > 256) {
        throw new Error('seat password is not valid');
      }
      const salt = randomBytes(SALT_BYTES).toString('hex');
      const hash = scryptSync(password, salt, KEY_BYTES).toString('hex');
      const rows = readRows(file).filter((row) => row.username !== username);
      rows.push({ username, bindingId, salt, hash });
      rows.sort((left, right) => left.username.localeCompare(right.username));
      writeRows(file, rows);
    },
    remove(username) {
      const rows = readRows(file);
      const kept = rows.filter((row) => row.username !== username);
      if (kept.length === rows.length) return false;
      writeRows(file, kept);
      return true;
    },
  });
}
