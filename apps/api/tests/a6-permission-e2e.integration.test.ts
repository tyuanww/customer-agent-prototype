import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client } from 'pg';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import type { IntakeResult } from '../src/content-intake/transaction.js';
import type { AuthenticatedUser, ProductAuthService } from '../src/auth-service.js';
import { feishuAdmitOpenId, feishuUserId } from '../src/feishu-admit.js';
import { forgetJobSnapshot, rememberJobSnapshot } from '../src/feishu-job-snapshot.js';
import { createProductAuthService } from '../src/product-auth-service.js';
import { projectRosterLogin, readAuthorizationActions } from '../src/project-roster-login.js';
import { publishLineage, seedLibrary } from './support/roster-library.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

const HOME = { tenant: 'tenant-a', app: 'app-a', department: 'dept-a' };
const OPEN_ID = 'ou_a6freshread1';
const SEAT_USERNAME = 'a6lead';
const SCOPE: components['schemas']['IntakeScope'] = {
  tenantId: HOME.tenant,
  appId: HOME.app,
  brandId: 'brand-a',
  shopId: 'shop-a',
  domain: 'product',
  sourceId: 'source-a',
};

const SCENARIOS = [
  'feishu-new-open-id-can-query',
  'password-seat-query-after-login-projection',
  'publish-grant-visible-on-intake-read',
  'publish-revoke-hidden-on-next-read',
  'stale-principal-facts-are-unavailable',
] as const;

type ScenarioName = typeof SCENARIOS[number];
type IntakeAction = components['schemas']['IntakeAction'];
type IntakeService = ReturnType<typeof createContentIntakeService>;

function actor(userId: string, role: AuthenticatedUser['role']): AuthenticatedUser {
  return { user_id: userId, role, auth_mode: 'mock' };
}

function accepted<T>(result: IntakeResult<T>, label: string): T {
  expect(result, `${label} ${JSON.stringify(result)}`).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

async function asIntakeBusiness<T extends Record<string, unknown>>(
  client: Client,
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE intake_business');
    const result = await client.query<T>(sql, values as unknown[]);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* the thrown error is the outcome */ }
    throw error;
  }
}

async function advanceFacts(client: Client, principalId: string, timing: 'fresh' | 'past', jobId: string | null = null): Promise<void> {
  const checked = timing === 'fresh'
    ? `clock_timestamp() - interval '1 second'`
    : `clock_timestamp() - interval '2 minutes'`;
  const until = timing === 'fresh'
    ? `clock_timestamp() + interval '4 minutes'`
    : `clock_timestamp() - interval '1 second'`;
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO content_intake.principal_facts(
        principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
      SELECT person.principal_id, person.current_facts_version + 1, facts.department_ids,
             COALESCE($2, facts.job_id), true, ${checked}, ${until}, facts.facts_digest
        FROM content_intake.principals person
        JOIN content_intake.principal_facts facts
          ON facts.principal_id = person.principal_id
         AND facts.facts_version = person.current_facts_version
       WHERE person.principal_id = $1`, [principalId, jobId]);
    await client.query(
      `UPDATE content_intake.principals SET current_facts_version = current_facts_version + 1 WHERE principal_id = $1`,
      [principalId]);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* the thrown error is the outcome */ }
    throw error;
  }
}

async function numberAt(client: Client, sql: string, values: readonly unknown[] = []): Promise<number> {
  const found = await client.query<{ value: string }>(sql, values as unknown[]);
  return Number(found.rows[0]?.value);
}

function grantBatch(
  action: 'query' | 'publish',
  operationId: string,
  issuerFactsVersion: number,
  recipientId: string,
  recipientFactsVersion: number,
  policyVersion: number,
  startsAt: string,
  expiresAt: string,
): components['schemas']['IntakeGrantBatch'] {
  return {
    operationId,
    issuerFactsVersion,
    policyVersion,
    items: [{
      kind: 'business',
      recipientPrincipalId: recipientId,
      recipientFactsVersion,
      action,
      scope: SCOPE,
      startsAt,
      expiresAt,
      reason: action === 'query' ? '合成查询' : '合成发布',
    }],
  };
}

function openAuth(
  harness: Pg15Harness,
  databaseName: string,
  client: Client,
  afterLogin: (openId: string) => Promise<void>,
): Promise<ProductAuthService> {
  return client.query('CREATE ROLE synthetic_intake_auth LOGIN NOINHERIT')
    .then(() => client.query('GRANT app_backend_auth TO synthetic_intake_auth'))
    .then(() => createProductAuthService(
      {
        connectionString: `postgresql://synthetic_intake_auth@localhost/${databaseName}?${new URLSearchParams({
          host: harness.socket,
          port: String(harness.port),
        })}`,
        poolMax: 2,
        connectionTimeoutMs: 2_000,
        readinessTimeoutMs: 3_000,
      },
      {
        authorizeUrl: (state) => `http://127.0.0.1:45000/authorize?state=${state}`,
        exchange: async (code) => code,
        close: () => undefined,
      },
      'mock',
      afterLogin,
      async () => { throw new Error('password hook'); },
    ));
}

async function signIn(auth: ProductAuthService, code: string) {
  const verifier = 'v'.repeat(43);
  const login = await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
  const state = new URL(login.authorize_url).searchParams.get('state');
  if (!state) throw new Error('login state missing');
  await auth.callback(state, code);
  const session = await auth.exchange(login.login_id, verifier);
  if (!session) throw new Error('session missing');
  const user = await auth.authenticate({ authorization: `Bearer ${session.access_token}` });
  if (!user) throw new Error('user missing');
  return user;
}

describe.skipIf(!enabled)('A6 permission reads', () => {
  it('walks the five scenarios in order', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const database = harness.createDatabase('a6_permission');
    const client = await harness.connect(database.config);
    const storeRoot = mkdtempSync(path.join(tmpdir(), 'a6-permission-'));
    const pool = new Pool({ ...database.config, max: 4 });
    const service: IntakeService = createContentIntakeService(pool, createContentObjectStore(storeRoot));
    let auth: ProductAuthService | undefined;
    const owner = actor('user-director', 'owner');
    const walked: ScenarioName[] = [];

    const read = (who: AuthenticatedUser, action: IntakeAction) => service.authorization(who, 'source-a', action);

    async function step(name: ScenarioName, run: () => Promise<void>) {
      expect(SCENARIOS[walked.length], 'scenario order').toBe(name);
      await run();
      walked.push(name);
    }

    try {
      await seedLibrary(client);
      await publishLineage(client);
      await advanceFacts(client, 'director', 'fresh', 'job-customer-service-director');

      const projected: string[] = [];
      auth = await openAuth(harness, database.name, client, async (openId) => {
        await client.query('SET ROLE intake_business');
        try {
          projected.push(await projectRosterLogin(client, openId));
        } finally {
          await client.query('RESET ROLE');
        }
      });

      let seatUserId = '';
      let seatPrincipalId = '';
      let publishGrantId = '';
      let publishVersion = 0;

      await step('feishu-new-open-id-can-query', async () => {
        const before = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM backend_identity.subject_bindings WHERE binding_id = $1`,
          [OPEN_ID]);
        expect(before.rows[0]?.n).toBe('0');
        expect(feishuAdmitOpenId('CAPABILITY_DENIED', OPEN_ID)).toBe(OPEN_ID);
        rememberJobSnapshot(OPEN_ID, {
          title: '客服坐席',
          directory: [{ name: '客服坐席', enabled: true }],
          departmentIds: [HOME.department],
        });
        const user = await signIn(auth!, OPEN_ID);
        expect(user).toMatchObject({ user_id: feishuUserId(OPEN_ID), role: 'agent' });
        expect(projected).toEqual(['projected']);
        const binding = await client.query<{ role: string; enabled: boolean }>(
          `SELECT role, enabled FROM backend_identity.subject_bindings WHERE binding_id = $1`,
          [OPEN_ID]);
        expect(binding.rows).toEqual([{ role: 'agent', enabled: true }]);
        const feishu = actor(feishuUserId(OPEN_ID), 'agent');
        expect(await read(feishu, 'query')).toMatchObject({
          ok: true,
          value: { sourceId: 'source-a', action: 'query' },
        });
        expect(await readAuthorizationActions(client, feishu.user_id)).toEqual({
          query: true, import: false, publish: false, rollback: false,
        });
      });

      await step('password-seat-query-after-login-projection', async () => {
        const created = await asIntakeBusiness<{
          out_principal_id: string; out_binding_id: string; out_user_id: string; out_role: string;
        }>(client, 'SELECT * FROM backend_identity.create_seat($1,$2,$3,$4,$5,$6,$7)', [
          SEAT_USERNAME, '合成主管', '客服主管', HOME.tenant, HOME.app, HOME.department, 'operator',
        ]);
        expect(created[0]).toMatchObject({
          out_principal_id: 'seat_a6lead',
          out_binding_id: 'synthetic_seat_a6lead',
          out_role: 'supervisor',
        });
        seatPrincipalId = created[0]!.out_principal_id;
        seatUserId = created[0]!.out_user_id;
        const renewed = await asIntakeBusiness<{ status: string }>(
          client, 'SELECT content_intake.project_seat_login($1) AS status', [created[0]!.out_binding_id]);
        expect(renewed[0]).toEqual({ status: 'projected' });
        const seatBinding = await client.query<{ role: string }>(
          `SELECT role FROM backend_identity.subject_bindings WHERE binding_id = $1`,
          [created[0]!.out_binding_id]);
        expect(seatBinding.rows).toEqual([{ role: 'coach' }]);
        const seat = actor(seatUserId, 'coach');
        expect(await read(seat, 'query')).toMatchObject({ ok: false, code: 'NOT_FOUND', reason: 'SCOPE_DENIED' });

        const policyVersion = await numberAt(client,
          `SELECT version::text AS value FROM content_intake.policy_versions
            WHERE tenant_id = $1 AND app_id = $2`, [HOME.tenant, HOME.app]);
        const storeVersion = await numberAt(client,
          `SELECT version::text AS value FROM content_intake.store_set_current
            WHERE tenant_id = $1 AND app_id = $2`, [HOME.tenant, HOME.app]);
        await client.query('BEGIN');
        try {
          await client.query(`INSERT INTO backend_identity.subject_bindings
            (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
            VALUES ('reviewer','synthetic',$1,'复核签发人','user-reviewer',repeat('ef',32),true,'owner')`, [HOME.tenant]);
          await client.query(`INSERT INTO content_intake.principals
            VALUES ('reviewer','user-reviewer',$1,$2,'confirmed-synthetic','reviewer',1,0)`, [HOME.tenant, HOME.app]);
          await client.query(`INSERT INTO content_intake.principal_facts
            VALUES ('reviewer',1,ARRAY[$1],'job-customer-service-director',true,
              clock_timestamp()-interval '1 second', clock_timestamp()+interval '4 minutes', repeat('a',64))`,
          [HOME.department]);
          await client.query(`INSERT INTO content_intake.grants(
              grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
            VALUES
              ('a6-alloc-query','allocation','director','reviewer',$1,$2,'scope-a','query',
                clock_timestamp()-interval '1 hour', clock_timestamp()+interval '1 day','合成复核查询','director'),
              ('a6-alloc-publish','allocation','director','reviewer',$1,$2,'scope-a','publish',
                clock_timestamp()-interval '1 hour', clock_timestamp()+interval '1 day','合成复核发布','director')`,
          [HOME.tenant, HOME.app]);
          await client.query(`INSERT INTO content_intake.grants(
              grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
              starts_at,expires_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
            VALUES
              ('a6-holder-query','business','reviewer','director',$1,$2,'scope-a','source-a','query',
                clock_timestamp()-interval '1 minute', clock_timestamp()+interval '1 hour',
                '合成签发人查询','reviewer','a6-alloc-query',$3,$4),
              ('a6-holder-publish','business','reviewer','director',$1,$2,'scope-a',NULL,'publish',
                clock_timestamp()-interval '1 minute', clock_timestamp()+interval '1 hour',
                '合成签发人发布','reviewer','a6-alloc-publish',NULL,NULL)`,
          [HOME.tenant, HOME.app, policyVersion, storeVersion]);
          await client.query('COMMIT');
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch { /* the thrown error is the outcome */ }
          throw error;
        }

        const window = await client.query<{ starts_at: Date; expires_at: Date }>(
          `SELECT clock_timestamp() - interval '1 second' AS starts_at,
                  clock_timestamp() + interval '10 minutes' AS expires_at`);
        const startsAt = window.rows[0]!.starts_at.toISOString();
        const expiresAt = window.rows[0]!.expires_at.toISOString();
        const issuerFactsVersion = await numberAt(client,
          `SELECT current_facts_version::text AS value FROM content_intake.principals WHERE principal_id = 'director'`);
        const recipientFactsVersion = await numberAt(client,
          `SELECT current_facts_version::text AS value FROM content_intake.principals WHERE principal_id = $1`,
          [seatPrincipalId]);
        accepted(await service.grantBatch(owner, grantBatch(
          'query', 'a6-grant-query', issuerFactsVersion, seatPrincipalId, recipientFactsVersion,
          policyVersion, startsAt, expiresAt,
        )), 'query grant');
        expect(await read(seat, 'query')).toMatchObject({
          ok: true,
          value: { sourceId: 'source-a', action: 'query' },
        });
        expect(await read(seat, 'publish')).toMatchObject({ ok: false, code: 'NOT_FOUND', reason: 'SCOPE_DENIED' });
      });

      await step('publish-grant-visible-on-intake-read', async () => {
        const seat = actor(seatUserId, 'coach');
        const window = await client.query<{ starts_at: Date; expires_at: Date }>(
          `SELECT clock_timestamp() - interval '1 second' AS starts_at,
                  clock_timestamp() + interval '10 minutes' AS expires_at`);
        const policyVersion = await numberAt(client,
          `SELECT version::text AS value FROM content_intake.policy_versions
            WHERE tenant_id = $1 AND app_id = $2`, [HOME.tenant, HOME.app]);
        const issuerFactsVersion = await numberAt(client,
          `SELECT current_facts_version::text AS value FROM content_intake.principals WHERE principal_id = 'director'`);
        const recipientFactsVersion = await numberAt(client,
          `SELECT current_facts_version::text AS value FROM content_intake.principals WHERE principal_id = $1`,
          [seatPrincipalId]);
        const granted = accepted(await service.grantBatch(owner, grantBatch(
          'publish', 'a6-grant-publish', issuerFactsVersion, seatPrincipalId, recipientFactsVersion,
          policyVersion, window.rows[0]!.starts_at.toISOString(), window.rows[0]!.expires_at.toISOString(),
        )), 'publish grant');
        const publish = granted.items.find((item) => item.action === 'publish');
        expect(publish?.recipientPrincipalId).toBe(seatPrincipalId);
        publishGrantId = publish!.grantId;
        publishVersion = publish!.version;
        expect(await read(seat, 'publish')).toMatchObject({
          ok: true,
          value: { sourceId: 'source-a', action: 'publish' },
        });
        expect(await readAuthorizationActions(client, seatUserId)).toEqual({
          query: true, import: false, publish: false, rollback: false,
        });
      });

      await step('publish-revoke-hidden-on-next-read', async () => {
        const seat = actor(seatUserId, 'coach');
        accepted(await service.changeGrant(owner, publishGrantId, {
          operationId: 'a6-revoke-publish',
          expectedVersion: publishVersion,
          change: 'revoke',
          reason: '合成撤销',
          stewardPrincipalId: null,
        }), 'revoke publish');
        expect(await read(seat, 'publish')).toMatchObject({ ok: false, code: 'NOT_FOUND', reason: 'SCOPE_DENIED' });
        expect(await read(seat, 'query')).toMatchObject({
          ok: true,
          value: { sourceId: 'source-a', action: 'query' },
        });
      });

      await step('stale-principal-facts-are-unavailable', async () => {
        await advanceFacts(client, seatPrincipalId, 'past');
        expect(await read(actor(seatUserId, 'coach'), 'query')).toMatchObject({
          ok: false,
          code: 'FORBIDDEN',
          reason: 'ORG_FACTS_UNAVAILABLE',
        });
      });

      expect(walked).toEqual([...SCENARIOS]);
    } finally {
      forgetJobSnapshot(OPEN_ID);
      await auth?.close();
      await pool.end();
      await client.end();
      harness.stop();
      rmSync(storeRoot, { recursive: true, force: true });
    }
  }, 180_000);
});
