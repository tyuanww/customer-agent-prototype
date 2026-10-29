import { mkdtempSync, rmSync } from 'node:fs';
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
      version: 1, createdAt: new Date().toISOString(), stackRoot: root,
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
      const unconfigured = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime' });
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
        const body = { displayName: '合成坐席', username: 'stack_seat', password: 'synthetic-seat-password', post: '客服' };
        const create = (identity: 'roster-director' | 'roster-query-only') => host.requestAs(identity, '/v1/intake/seats', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
        expect((await create('roster-query-only')).status).toBe(403);
        const created = await create('roster-director');
        expect(created.status).toBe(200);
        expect(await created.json()).toMatchObject({ seat: { displayName: body.displayName, username: body.username, post: body.post, enabled: true } });
        const listed = await host.requestAs('roster-director', '/v1/intake/seats');
        expect(await listed.json()).toMatchObject({ seats: [{ displayName: body.displayName, username: body.username, post: body.post, enabled: true }] });
        const accounts = loadPasswordAccounts(path.join(root, 'password-accounts.json'));
        const account = accounts.get(body.username);
        expect(account && passwordMatches(account, body.password)).toBe(true);
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
