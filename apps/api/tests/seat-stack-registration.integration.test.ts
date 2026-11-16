import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiEnvironment } from '../../../scripts/synthetic-stack/profile.ts';
import { loadPasswordAccounts, passwordMatches } from '../../../scripts/synthetic-stack/identity-admission.ts';
import { createIntakeSyntheticHost } from './support/intake-synthetic-host.ts';

describe.skipIf(process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION !== '1')('seat routes with the stack API environment', () => {
  it('registers seat management for an administrator and refuses a query-only user', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'seat-stack-registration-'));
    const profile = {
      version: 1, environment: 'synthetic-local', createdAt: new Date().toISOString(), stackRoot: root,
      apiOrigin: 'http://127.0.0.1:43100', identityOrigin: 'http://127.0.0.1:43101',
      apiPort: 43100, identityPort: 43101, databaseName: 'synthetic', pgPort: 43199,
      pgSocketDirectory: path.join(root, 'socket'), objectStoreDirectory: path.join(root, 'objects'), clientId: 'synthetic',
    } as const;
    const environment = apiEnvironment(profile, { ROSTER_TENANT_ID: 'tenant-a', ROSTER_APP_ID: 'app-a' });
    const keys = ['CUSTOMER_AGENT_STACK_ROOT', 'ROSTER_TENANT_ID', 'ROSTER_APP_ID'] as const;
    const previous = keys.map(key => process.env[key]);
    for (const key of keys) {
      if (environment[key] === undefined) delete process.env[key];
      else process.env[key] = environment[key];
    }
    try {
      delete process.env.CUSTOMER_AGENT_STACK_ROOT;
      const unconfigured = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime', includeSeats: false });
      try {
        expect((await unconfigured.requestAs('roster-director', '/v1/intake/seats')).status).toBe(404);
      } finally {
        await unconfigured.close();
      }
      process.env.CUSTOMER_AGENT_STACK_ROOT = environment.CUSTOMER_AGENT_STACK_ROOT;
      const host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime' });
      try {
        const allowed = await host.requestAs('roster-director', '/v1/intake/seats');
        expect(allowed.status).toBe(200);
        expect(await allowed.json()).toEqual({ seats: [] });
        const denied = await host.requestAs('roster-query-only', '/v1/intake/seats');
        expect(denied.status).toBe(403);
        const body = { displayName: '合'.repeat(256), username: 'stack_seat', password: 'synthetic-seat-password', post: '客服' };
        const create = (identity: 'roster-director' | 'roster-query-only') => host.requestAs(identity, '/v1/intake/seats', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
        expect((await create('roster-query-only')).status).toBe(403);
        const created = await create('roster-director');
        expect(created.status).toBe(200);
        expect(await created.json()).toMatchObject({ seat: { displayName: body.displayName, username: body.username, post: body.post, enabled: true } });
        const listed = await host.requestAs('roster-director', '/v1/intake/seats');
        expect(await listed.json()).toMatchObject({ seats: [{ displayName: body.displayName, username: body.username, post: body.post, enabled: true }] });
        const directory = await host.requestAs('roster-director', '/v1/intake/principals?sourceId=source-a&purpose=grant-recipient');
        expect(directory.status).toBe(200);
        expect(await directory.json()).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ principalId: 'seat_stack_seat', displayLabel: body.displayName })]) });
        const accounts = loadPasswordAccounts(host.seatPasswordAccountsFile);
        const account = accounts.get(body.username);
        expect(account && passwordMatches(account, body.password)).toBe(true);
        expect(existsSync(path.join(root, 'password-accounts.json'))).toBe(false);
      } finally {
        await host.close();
      }
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      });
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});

it.skipIf(process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION !== '1')('finishes an admitted HTTP reset after revocation and refuses the next reset without changing the password', async () => {
  let armed = false;
  let admitted = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let revoke: () => Promise<void> = async () => { throw new Error('Synthetic authority was not configured'); };
  const host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime',
    configureDatabase: async client => {
      revoke = async () => {
        await client.query(`UPDATE content_intake.grants SET revoked_at=clock_timestamp(), version=version+1,
          last_change_reason='合成请求时授权回归' WHERE grant_id='alloc-roster-review-only'`);
      };
    },
    wrapBusinessPool: pool => ({ connect: async () => {
      const client = await pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (armed && sql === 'SELECT content_intake.seat_administration_allowed($1) AS allowed' && result.rows[0]?.allowed === true) {
            armed = false;
            admitted = true;
            await gate;
          }
          return result;
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } }),
  });
  const passwordA = 'synthetic-request-time-A';
  const passwordB = 'synthetic-request-time-B';
  const reset = (password: string) => host.requestAs('roster-review-only', '/v1/intake/seats/request-time/password', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
  });
  try {
    const created = await host.requestAs('roster-review-only', '/v1/intake/seats', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '合成撤权坐席', username: 'request-time', password: passwordA, post: '客服' }),
    });
    expect(created.status).toBe(200);
    armed = true;
    const accepted = reset(passwordB);
    await expect.poll(() => admitted).toBe(true);
    await revoke();
    release();
    expect((await accepted).status).toBe(200);
    expect((await reset('synthetic-forbidden-password')).status).toBe(403);
    const account = loadPasswordAccounts(host.seatPasswordAccountsFile).get('request-time');
    expect(account && passwordMatches(account, passwordB)).toBe(true);
    expect(account && passwordMatches(account, passwordA)).toBe(false);
    expect(account && passwordMatches(account, 'synthetic-forbidden-password')).toBe(false);
  } finally { release(); await host.close(); }
}, 120_000);
