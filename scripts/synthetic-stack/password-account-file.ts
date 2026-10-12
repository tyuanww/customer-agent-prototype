import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { IntakePost } from '../../apps/desktop/src/shared/intake-post-actions.ts';
import { buildAccount } from './identity-admission.ts';
import type { PreparedPassword, SeatPasswords } from './seat-accounts.ts';

type Row = Record<string, unknown>;
type Rows = { ok: true; rows: Row[] } | { ok: false; error: 'password-write-failed' };

function readRows(file: string): Rows {
  if (!existsSync(file)) return { ok: true, rows: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, error: 'password-write-failed' };
  }
  if (!Array.isArray(raw) || raw.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    return { ok: false, error: 'password-write-failed' };
  }
  return { ok: true, rows: raw as Row[] };
}

function storeRows(file: string, rows: readonly Row[]): { ok: true } | { ok: false; error: 'password-write-failed' } {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
    return { ok: true };
  } catch {
    rmSync(temporary, { force: true });
    return { ok: false, error: 'password-write-failed' };
  }
}

function prepared(username: string, bindingId: string, password: string): { ok: true; account: PreparedPassword } | { ok: false; error: 'missing-hash' } {
  if (password.length === 0 || !/^synthetic_[A-Za-z0-9_-]{1,100}$/.test(bindingId)) {
    return { ok: false, error: 'missing-hash' };
  }
  const account = buildAccount(username, bindingId, password);
  if (!/^[0-9a-f]{32}$/.test(account.salt) || !/^[0-9a-f]{128}$/.test(account.hash)) {
    return { ok: false, error: 'missing-hash' };
  }
  return { ok: true, account: { username: account.username, bindingId: account.bindingId, salt: account.salt, hash: account.hash } };
}

export function createPasswordAccountFile(file: string): SeatPasswords {
  return {
    prepare(username, bindingId, password) {
      return Promise.resolve(prepared(username, bindingId, password));
    },
    async write(account, post: IntakePost) {
      const current = readRows(file);
      if (!current.ok) return current;
      if (current.rows.some((row) => row.username === account.username)) return { ok: false, error: 'password-write-failed' };
      return storeRows(file, [...current.rows, { ...account, post }]);
    },
    async replace(username, bindingId, password) {
      const next = prepared(username, bindingId, password);
      if (!next.ok) return next;
      const current = readRows(file);
      if (!current.ok) return current;
      const row = current.rows.find((candidate) => candidate.username === username);
      if (!row) return { ok: false, error: 'password-write-failed' };
      row.salt = next.account.salt;
      row.hash = next.account.hash;
      const stored = storeRows(file, current.rows);
      if (!stored.ok) return stored;
      return { ok: true };
    },
    async list() {
      const current = readRows(file);
      if (!current.ok) return current;
      const rows: { username: string; bindingId: string; post: string | null }[] = [];
      for (const row of current.rows) {
        const username = row.username;
        const bindingId = row.bindingId;
        if (typeof username !== 'string' || typeof bindingId !== 'string') continue;
        rows.push({ username, bindingId, post: typeof row.post === 'string' ? row.post : null });
      }
      return { ok: true as const, rows };
    },
  };
}
