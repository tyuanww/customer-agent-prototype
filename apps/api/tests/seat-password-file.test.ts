import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSeatPasswordFile, seatPasswordFilePath } from '../src/content-intake/seat-password-file.js';
import { buildAccount, loadPasswordAccounts, passwordMatches, reloadPasswordAccounts } from '../../../scripts/synthetic-stack/identity-admission.js';

/**
 * The password file is read by the identity server, which owns its format. This module is a second
 * writer, and a second writer is only safe if its output is verified by the real reader. Every
 * assertion goes through `identity-admission.ts` rather than reading the JSON back directly.
 *
 * The file always carries one baseline account, because the reader refuses a file with no usable
 * account at all: an empty file makes the identity server refuse every login.
 */
describe('seat password file', () => {
  let root: string;
  let file: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'seat-password-'));
    file = seatPasswordFilePath(root);
    writeFileSync(file, `${JSON.stringify([buildAccount('synthetic_owner', 'synthetic_owner', 'baseline pass')])}\n`, { mode: 0o600 });
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('writes an entry the identity server accepts', () => {
    createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery');
    const account = loadPasswordAccounts(file).get('alice');
    expect(account, 'reader must find the account').toBeDefined();
    expect(account?.bindingId).toBe('synthetic_seat_alice');
    expect(passwordMatches(account!, 'correct horse battery')).toBe(true);
    expect(passwordMatches(account!, 'wrong password')).toBe(false);
  });

  it('replaces an existing entry rather than adding a second one', () => {
    const store = createSeatPasswordFile(file);
    store.upsert('alice', 'synthetic_seat_alice', 'first password');
    store.upsert('alice', 'synthetic_seat_alice', 'second password');
    const rows = JSON.parse(readFileSync(file, 'utf8')) as { username: string }[];
    expect(rows.filter((row) => row.username === 'alice')).toHaveLength(1);
    expect(passwordMatches(loadPasswordAccounts(file).get('alice')!, 'second password')).toBe(true);
  });

  it('keeps entries this writer did not create', () => {
    createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery');
    expect([...loadPasswordAccounts(file).keys()].sort()).toEqual(['alice', 'synthetic_owner']);
  });

  it('refuses to rewrite a file holding a row it cannot read', () => {
    // Dropping the row would silently delete an account somebody else created.
    const rows = JSON.parse(readFileSync(file, 'utf8')) as unknown[];
    writeFileSync(file, `${JSON.stringify([...rows, { username: 'odd' }])}\n`, { mode: 0o600 });
    expect(() => createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery'))
      .toThrow(/cannot preserve/);
  });

  it('leaves a readable file behind after a refused write', () => {
    // A truncated or half-written file makes the reader return null, which turns every seat's next
    // login into a 503, so a refusal must not touch the file at all.
    createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', 'correct horse battery');
    const before = readFileSync(file, 'utf8');
    expect(() => createSeatPasswordFile(file).upsert('bad name', 'synthetic_seat_bad_name', 'correct horse battery'))
      .toThrow(/not valid/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(reloadPasswordAccounts(file)?.size).toBe(2);
  });

  it('rejects a password outside the length bound before writing', () => {
    for (const bad of ['short', 'x'.repeat(257)]) {
      expect(() => createSeatPasswordFile(file).upsert('alice', 'synthetic_seat_alice', bad))
        .toThrow(/not valid/);
    }
    expect(reloadPasswordAccounts(file)?.size).toBe(1);
  });
});
