import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { loadPasswordAccounts, passwordMatches } from './identity-admission.ts';
import { createPasswordAccountFile } from './password-account-file.ts';
import { DATABASE_NAME, PG_PORT, PG_SOCKET_DIRECTORY } from './profile.ts';
import { runSeatCommand } from './seat-account-command.ts';
import { createSubjectBindingPeople, type Sql } from './subject-binding-people.ts';

const LIVE_ACCOUNTS = path.join(process.env.HOME ?? '', '.customer-agent-synthetic-stack', 'password-accounts.json');
const directory = mkdtempSync(path.join(tmpdir(), 'seat-command-'));
const accountsFile = path.join(directory, 'password-accounts.json');
const createdPassword = 'pw-seat-command';
const resetPassword = 'pw-seat-command-next';
let client: Client;

describe('seat account command', { concurrency: 1 }, () => {
  before(async () => {
    assert.notEqual(path.resolve(accountsFile), path.resolve(LIVE_ACCOUNTS));
    client = new Client({ host: PG_SOCKET_DIRECTORY, port: PG_PORT, user: 'stack_owner', database: DATABASE_NAME });
    await client.connect();
    await client.query('BEGIN');
  });

  after(async () => {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
    rmSync(directory, { recursive: true, force: true });
  });

  it('stops when the post is not a service post', async () => {
    const people = createSubjectBindingPeople(client as unknown as Sql);
    const passwords = createPasswordAccountFile(accountsFile);
    const absent = await runSeatCommand(people, passwords, {
      action: 'create', displayName: '缺岗位', username: 'seatcmd0', password: createdPassword, post: '主管' as '客服',
    });
    assert.deepEqual(absent, { ok: false, message: '请选择岗位。' });
    assert.equal(existsSync(accountsFile), false);
    const row = await client.query(`SELECT binding_id FROM backend_identity.subject_bindings WHERE binding_id=$1`, ['synthetic_seatcmd0']);
    assert.equal(row.rowCount, 0);
  });

  it('keeps plaintext out of the create, reset, and disable replies', async () => {
    const people = createSubjectBindingPeople(client as unknown as Sql);
    const passwords = createPasswordAccountFile(accountsFile);
    const created = await runSeatCommand(people, passwords, {
      action: 'create', displayName: ' 外包丙 ', username: 'seatcmd', password: createdPassword, post: '客服',
    });
    assert.equal(JSON.stringify(created).includes(createdPassword), false);
    assert.deepEqual(created, {
      ok: true,
      action: 'create',
      seat: { displayName: '外包丙', username: 'seatcmd', post: '客服', enabled: true },
    });
    const stored = readFileSync(accountsFile, 'utf8');
    assert.equal(stored.includes(createdPassword), false);
    assert.equal(passwordMatches(loadPasswordAccounts(accountsFile).get('seatcmd')!, createdPassword), true);

    const reset = await runSeatCommand(people, passwords, {
      action: 'reset', username: 'seatcmd', password: resetPassword,
    });
    assert.equal(JSON.stringify(reset).includes(resetPassword), false);
    assert.deepEqual(reset, { ok: true, action: 'reset', username: 'seatcmd' });
    assert.equal(readFileSync(accountsFile, 'utf8').includes(resetPassword), false);
    assert.equal(passwordMatches(loadPasswordAccounts(accountsFile).get('seatcmd')!, resetPassword), true);

    const disabled = await runSeatCommand(people, passwords, { action: 'disable', username: 'seatcmd' });
    assert.deepEqual(disabled, { ok: true, action: 'disable', username: 'seatcmd' });
    const row = await client.query(`SELECT enabled FROM backend_identity.subject_bindings WHERE binding_id=$1`, ['synthetic_seatcmd']);
    assert.equal(row.rows[0]?.enabled, false);
    assert.equal(loadPasswordAccounts(accountsFile).has('seatcmd'), true);

    const listed = await runSeatCommand(people, passwords, { action: 'list' });
    assert.equal(JSON.stringify(listed).includes(resetPassword), false);
    assert.equal(listed.ok, true);
    if (!listed.ok || listed.action !== 'list') return;
    assert.deepEqual(listed.seats.find((seat) => seat.username === 'seatcmd'), {
      displayName: '外包丙', username: 'seatcmd', post: '客服', enabled: false,
    });
  });
});
