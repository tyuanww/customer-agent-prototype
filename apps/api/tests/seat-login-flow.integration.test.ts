import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAuthorizationFixture, type AuthorizationFixture } from './support/authorization-sources-fixture.js';
import { buildAccount } from '../../../scripts/synthetic-stack/identity-admission.js';
import { createIdentityProvider } from '../../../scripts/synthetic-stack/identity-provider.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => { if (error) reject(error); else resolve(port); });
    });
  });
}

async function asBusiness<T>(fixture: AuthorizationFixture, sql: string, values: readonly unknown[] = []): Promise<T[]> {
  const client = fixture.intakeClient();
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE intake_business');
    const result = await client.query(sql, values as unknown[]);
    await client.query('COMMIT');
    return result.rows as T[];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe.skipIf(!enabled)('a created seat can log in and keeps an agent ceiling', () => {
  it('lets an allocator create a seat, logs that seat in, and refuses publish', async () => {
    const fixture = await createAuthorizationFixture('seat_login_flow');
    const directory = mkdtempSync(path.join(os.tmpdir(), 'seat-login-flow-'));
    const accountsFile = path.join(directory, 'password-accounts.json');
    const password = 'seat-flow-password';
    writeFileSync(accountsFile, `${JSON.stringify([
      buildAccount('synthetic_agent', 'synthetic_agent', password),
      buildAccount('flow1', 'synthetic_seat_flow1', password),
    ])}\n`);
    const admin = fixture.intakeClient();
    let origin = '';
    let closeProvider: (() => Promise<void>) | undefined;
    try {
      await admin.query(`INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, steward_id)
        VALUES ('grant-director-steward','allocation','director','director','tenant-menokin',
          'app-customer-agent','scope-product',NULL,'query',
          clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 day',
          '坐席管理所需的根授权。','director')`);

      const director = await asBusiness<{ allowed: boolean }>(
        fixture, 'SELECT content_intake.seat_administration_allowed($1) AS allowed', ['user-director']);
      expect(director[0]?.allowed).toBe(true);
      const agent = await asBusiness<{ allowed: boolean }>(
        fixture, 'SELECT content_intake.seat_administration_allowed($1) AS allowed', ['user-agent']);
      expect(agent[0]?.allowed).toBe(false);

      const before = await admin.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM backend_identity.subject_bindings WHERE binding_id LIKE 'synthetic_seat_%'`);
      expect(before.rows[0]?.n).toBe('0');

      const created = await asBusiness<{
        out_principal_id: string; out_binding_id: string; out_role: string;
      }>(fixture,
        'SELECT * FROM backend_identity.create_seat($1,$2,$3,$4,$5,$6,$7)',
        ['flow1', '合成客服', '客服', 'tenant-menokin', 'app-customer-agent', 'dept-a', 'user-director']);
      expect(created[0]).toMatchObject({
        out_principal_id: 'seat_flow1', out_binding_id: 'synthetic_seat_flow1', out_role: 'agent',
      });

      const port = await freePort();
      const provider = createIdentityProvider({
        port,
        accountsFile,
        seatBindingEnabled: async (bindingId) => {
          const found = await admin.query(
            `SELECT 1 FROM backend_identity.subject_bindings
              WHERE binding_id = $1 AND provider = 'synthetic' AND enabled`,
            [bindingId]);
          return (found.rowCount ?? 0) > 0;
        },
      });
      closeProvider = () => provider.close();
      origin = await provider.listen();
      const post = (username: string) => fetch(`${origin}/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const seated = await post('flow1');
      expect(seated.status).toBe(200);
      expect(await seated.json()).toEqual({ code: 'synthetic_seat_flow1' });
      const exchanged = await fetch(`${origin}/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'synthetic_seat_flow1' }),
      });
      expect(exchanged.status).toBe(200);
      expect(await exchanged.json()).toEqual({ provider: 'synthetic', binding_id: 'synthetic_seat_flow1' });
      const seeded = await post('synthetic_agent');
      expect(seeded.status).toBe(200);
      expect(await seeded.json()).toEqual({ code: 'synthetic_agent' });

      await admin.query(`INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, parent_grant_id, policy_version, store_set_version, steward_id)
        VALUES
          ('grant-seat-publish','business','signer','seat_flow1','tenant-menokin','app-customer-agent',
            'scope-product',NULL,'publish',
            clock_timestamp() - interval '1 minute', clock_timestamp() + interval '30 minutes',
            '坐席发布，角色天花板应挡住。','grant-alloc-publish',NULL,NULL,'signer')`);

      expect((await fixture.sources('seat_flow1', 'query')).map((row) => row.source_id).sort()).toEqual(['source-a', 'source-b']);
      expect(await fixture.sources('seat_flow1', 'publish')).toEqual([]);

      await asBusiness(fixture, 'SELECT backend_identity.disable_seat($1,$2,$3)',
        ['flow1', 'tenant-menokin', 'app-customer-agent']);
      expect((await post('flow1')).status).toBe(401);
      const exchangedAfter = await fetch(`${origin}/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'synthetic_seat_flow1' }),
      });
      expect(exchangedAfter.status).toBe(401);
      expect((await post('synthetic_agent')).status).toBe(200);
    } finally {
      await closeProvider?.();
      rmSync(directory, { recursive: true, force: true });
      await fixture.close();
    }
  }, 180_000);
});
