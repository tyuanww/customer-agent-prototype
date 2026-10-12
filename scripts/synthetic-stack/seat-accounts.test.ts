import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { loadPasswordAccounts, passwordMatches } from './identity-admission.ts';
import { createPasswordAccountFile } from './password-account-file.ts';
import { DATABASE_NAME, PG_PORT, PG_SOCKET_DIRECTORY } from './profile.ts';
import { createSeatAccount, disableSeatAccount, resetSeatPassword } from './seat-accounts.ts';
import { createSubjectBindingPeople, type Sql } from './subject-binding-people.ts';

const LIVE_ACCOUNTS = path.join(process.env.HOME ?? '', '.customer-agent-synthetic-stack', 'password-accounts.json');
const directory = mkdtempSync(path.join(tmpdir(), 'seat-accounts-'));
const accountsFile = path.join(directory, 'password-accounts.json');
const blockedFile = path.join(directory, 'blocked');
let client: Client;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

async function personRow(bindingId: string): Promise<Record<string, unknown> | undefined> {
  const result = await client.query(
    `SELECT binding_id, subject, user_id, subject_hash, enabled, role, provider FROM backend_identity.subject_bindings WHERE binding_id=$1`,
    [bindingId],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

describe('seat accounts', { concurrency: 1 }, () => {
  before(async () => {
    assert.notEqual(path.resolve(accountsFile), path.resolve(LIVE_ACCOUNTS));
    mkdirSync(blockedFile);
    client = new Client({ host: PG_SOCKET_DIRECTORY, port: PG_PORT, user: 'stack_owner', database: DATABASE_NAME });
    await client.connect();
    await client.query('BEGIN');
  });

  after(async () => {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
    rmSync(directory, { recursive: true, force: true });
  });

  it('stops before writing when the person, post, or hash is missing', async () => {
    const people = createSubjectBindingPeople(client as unknown as Sql);
    const passwords = createPasswordAccountFile(accountsFile);
    const missingPerson = await createSeatAccount(people, passwords, { displayName: ' ', username: 'seatmiss', password: 'pw-seat-miss', post: '客服' });
    const missingPost = await createSeatAccount(people, passwords, { displayName: '缺岗位', username: 'seatpost', password: 'pw-seat-post', post: '主管' });
    const missingHash = await createSeatAccount(people, passwords, { displayName: '缺哈希', username: 'seathash', password: '', post: '客服' });
    assert.deepEqual(missingPerson, { ok: false, error: 'missing-person' });
    assert.deepEqual(missingPost, { ok: false, error: 'missing-post' });
    assert.deepEqual(missingHash, { ok: false, error: 'missing-hash' });
    assert.equal(statSync(accountsFile, { throwIfNoEntry: false }), undefined);
    assert.equal(await personRow('synthetic_seatmiss'), undefined);
    assert.equal(await personRow('synthetic_seatpost'), undefined);
    assert.equal(await personRow('synthetic_seathash'), undefined);
  });

  it('stores only a salt and hash, writes the person, and returns the password once', async () => {
    const people = createSubjectBindingPeople(client as unknown as Sql);
    const passwords = createPasswordAccountFile(accountsFile);
    const created = await createSeatAccount(people, passwords, {
      displayName: '外包坐席甲', username: 'seatok', password: 'pw-seat-create', post: '客服',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.password, 'pw-seat-create');
    assert.equal(created.post, '客服');
    const text = readFileSync(accountsFile, 'utf8');
    assert.equal(text.includes('pw-seat-create'), false);
    const stored = JSON.parse(text) as Record<string, unknown>[];
    assert.deepEqual(Object.keys(stored[0] ?? {}).sort(), ['bindingId', 'hash', 'salt', 'username']);
    const loaded = loadPasswordAccounts(accountsFile).get('seatok');
    assert.ok(loaded);
    assert.equal(passwordMatches(loaded, 'pw-seat-create'), true);
    const row = await personRow('synthetic_seatok');
    assert.equal(row?.subject, '外包坐席甲');
    assert.equal(row?.enabled, true);
    assert.equal(row?.role, 'agent');
    assert.equal(row?.user_id, 'usr_synthetic_seatok');
    assert.equal(row?.provider, 'synthetic');
    assert.equal(row?.subject_hash, createHash('sha256').update('synthetic_seatok').digest('hex'));
  });

  it('rolls both stores back when the person or the password file cannot be written', async () => {
    const people = createSubjectBindingPeople(client as unknown as Sql);
    const passwords = createPasswordAccountFile(accountsFile);
    const duplicate = await createSeatAccount(people, passwords, {
      displayName: '重复', username: 'seatok', password: 'pw-seat-duplicate', post: '客服主管',
    });
    assert.deepEqual(duplicate, { ok: false, error: 'person-write-failed' });
    assert.equal(readFileSync(accountsFile, 'utf8').includes('pw-seat-duplicate'), false);
    assert.equal((await personRow('synthetic_seatok'))?.subject, '外包坐席甲');

    const blocked = await createSeatAccount(people, createPasswordAccountFile(blockedFile), {
      displayName: '写失败', username: 'seatblock', password: 'pw-seat-block', post: '客服',
    });
    assert.deepEqual(blocked, { ok: false, error: 'password-write-failed' });
    assert.equal(await personRow('synthetic_seatblock'), undefined);
    assert.equal(readFileSync(accountsFile, 'utf8').includes('seatblock'), false);
  });

  it('resets the hash once and disables without deleting the person', async () => {
    const people = createSubjectBindingPeople(client as unknown as Sql);
    const passwords = createPasswordAccountFile(accountsFile);
    const created = await createSeatAccount(people, passwords, {
      displayName: '外包坐席乙', username: 'seatreset', password: 'pw-seat-old', post: '客服主管',
    });
    assert.equal(created.ok, true);
    const before = loadPasswordAccounts(accountsFile).get('seatreset');
    assert.ok(before);
    const missingPerson = await resetSeatPassword(people, passwords, { username: 'seatghost', password: 'pw-seat-new' });
    const missingHash = await resetSeatPassword(people, passwords, { username: 'seatreset', password: '' });
    assert.deepEqual(missingPerson, { ok: false, error: 'missing-person' });
    assert.deepEqual(missingHash, { ok: false, error: 'missing-hash' });
    assert.equal(loadPasswordAccounts(accountsFile).get('seatreset')?.hash, before.hash);

    const reset = await resetSeatPassword(people, passwords, { username: 'seatreset', password: 'pw-seat-new' });
    assert.deepEqual(reset, { ok: true, username: 'seatreset', password: 'pw-seat-new' });
    const text = readFileSync(accountsFile, 'utf8');
    assert.equal(text.includes('pw-seat-new'), false);
    assert.equal(text.includes('pw-seat-old'), false);
    const after = loadPasswordAccounts(accountsFile).get('seatreset');
    assert.ok(after);
    assert.notEqual(after.hash, before.hash);
    assert.equal(passwordMatches(after, 'pw-seat-new'), true);
    assert.equal(passwordMatches(after, 'pw-seat-old'), false);
    assert.equal((await personRow('synthetic_seatreset'))?.enabled, true);

    const disabled = await disableSeatAccount(people, { username: 'seatreset' });
    assert.deepEqual(disabled, { ok: true });
    const row = await personRow('synthetic_seatreset');
    assert.equal(row?.enabled, false);
    assert.equal(row?.subject, '外包坐席乙');
    assert.equal(loadPasswordAccounts(accountsFile).get('seatreset')?.hash, after.hash);
    assert.deepEqual(await disableSeatAccount(people, { username: 'seatghost' }), { ok: false, error: 'missing-person' });
  });

  it('keeps the password path out of the page and the use case', () => {
    const useCase = readFileSync(new URL('./seat-accounts.ts', import.meta.url), 'utf8');
    assert.equal(useCase.includes('password-accounts.json'), false);
    assert.equal(useCase.includes('node:fs'), false);
    assert.equal(useCase.includes("from 'pg'"), false);
    const renderer = fileURLToPath(new URL('../../apps/desktop/src/renderer', import.meta.url));
    for (const file of walk(renderer)) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
      assert.equal(readFileSync(file, 'utf8').includes('password-accounts.json'), false, file);
    }
  });
});
