import path from 'node:path';
import { createHash } from 'node:crypto';
import { Pool, type Client, type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createFeishuOrganizationObserver, type OrganizationObservation } from './feishu-observer.js';
import { createOrganizationFactsWriter } from './facts-writer.js';
import { createOrganizationHttpTransport } from './http-transport.js';
import { startSyntheticContactDouble } from './synthetic-contact-double.js';
import { seedIntakeSyntheticHost } from '../../tests/support/intake-synthetic-seed.js';
import { createContentIntakeService } from '../../src/content-intake/service.js';
import { createContentObjectStore } from '../../src/content-object-store.js';
import { createProductAuthService } from '../../src/product-auth-service.js';
import type { AuthenticatedUser, ProductAuthService } from '../../src/auth-service.js';
import type { IntakePool } from '../../src/content-intake/transaction.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const scope = { tenantId: 'tenant-a', appId: 'app-a' };

describe.skipIf(!enabled)('HTTP organization transport through the restricted writer and real usage', () => {
  let harness: Pg15Harness, admin: Client, pool: Pool, writerPool: Pool;
  let service: ReturnType<typeof createContentIntakeService>;
  let write: ReturnType<typeof createOrganizationFactsWriter>;
  let auth: ProductAuthService, actor: AuthenticatedUser;
  let contact: Awaited<ReturnType<typeof startSyntheticContactDouble>>;
  let http: ReturnType<typeof createOrganizationHttpTransport>;
  let quotaNow = 0;
  const diagnostics: unknown[] = [];

  beforeEach(async () => {
    harness = new Pg15Harness(); harness.start();
    const db = harness.createDatabase('organization_transport');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await seedIntakeSyntheticHost(admin);
    await admin.query(`CREATE ROLE synthetic_facts_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      GRANT USAGE ON SCHEMA content_intake,backend_review TO synthetic_facts_writer;
      GRANT SELECT ON content_intake.principals,content_intake.principal_facts TO synthetic_facts_writer;
      GRANT INSERT ON content_intake.principal_facts TO synthetic_facts_writer;
      GRANT UPDATE(current_facts_version,revocation_generation) ON content_intake.principals TO synthetic_facts_writer;
      GRANT EXECUTE ON FUNCTION backend_review.lock_content() TO synthetic_facts_writer;
      CREATE ROLE synthetic_org_auth LOGIN NOINHERIT; GRANT app_backend_auth TO synthetic_org_auth;`);
    pool = new Pool({ ...db.config, max: 3 });
    writerPool = new Pool({ ...db.config, user: 'synthetic_facts_writer', max: 2 });
    diagnostics.length = 0;
    write = createOrganizationFactsWriter(writerPool, scope, error => diagnostics.push(error));
    service = createContentIntakeService(pool, createContentObjectStore(path.join(harness.root, db.name)), (_id, error) => diagnostics.push(error), undefined, { requireProductSession: true });
    auth = await createProductAuthService({ connectionString: `postgresql://synthetic_org_auth@localhost/${db.name}?${new URLSearchParams({ host: harness.socket, port: String(harness.port) })}`,
      poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 }, { authorizeUrl: state => `http://127.0.0.1/authorize?state=${state}`, exchange: async code => code, close: () => undefined }, 'mock');
    const verifier = 'v'.repeat(43);
    const login = await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
    await auth.callback(new URL(login.authorize_url).searchParams.get('state')!, 'agent');
    const session = await auth.exchange(login.login_id, verifier);
    expect(session).not.toBeNull();
    actor = (await auth.authenticate({ authorization: `Bearer ${session!.access_token}` }))!;
    contact = await startSyntheticContactDouble();
    quotaNow = Date.now();
    http = createOrganizationHttpTransport({
      origin: contact.origin, requestTimeoutMs: 5_000, now: () => quotaNow,
      tokenSupplier: { async current() { return { token: 'synthetic-app-token', expiresAtMs: quotaNow + 3_600_000 }; } },
    });
  }, 60_000);

  afterEach(async () => {
    await contact?.close();
    await auth?.close();
    await pool?.end();
    await writerPool?.end();
    await admin?.end();
    harness?.stop();
  }, 60_000);

  async function observe(expectedFactsVersion: number): Promise<OrganizationObservation> {
    const clock = async () => ((await admin.query('SELECT clock_timestamp() AS time')).rows[0].time as Date).getTime();
    return createFeishuOrganizationObserver(scope, http, clock)({ ...scope, principalId: 'agent', openId: contact.user.open_id, expectedFactsVersion });
  }
  async function entitlement(contextGeneration = 1) {
    const result = await service.issueEntitlement(actor, { shopId: 'shop-a', contextGeneration, productIds: [], scenarioIds: [], releaseId: null });
    expect(result, JSON.stringify({ result, diagnostics })).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  }
  const state = async () => (await admin.query("SELECT current_facts_version,revocation_generation FROM content_intake.principals WHERE principal_id='agent'")).rows[0];
  const gap = () => new Promise(resolve => setTimeout(resolve, 20));
  async function roles() {
    const result = await admin.query<{ roles: string[] }>(`SELECT ARRAY(SELECT DISTINCT r.role FROM content_intake.role_rules r
      JOIN content_intake.principals p ON p.principal_id='agent'
      JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
      WHERE r.tenant_id=p.tenant_id AND r.app_id=p.app_id AND r.job_id=f.job_id AND r.department_id=ANY(f.department_ids)) AS roles`);
    return result.rows[0]!.roles;
  }

  it('refreshes from the local HTTP double and does not extend the existing usage deadline', async () => {
    const lease = await entitlement();
    const rules = (await admin.query('SELECT count(*) FROM content_intake.role_rules')).rows[0].count;
    const first = await observe(1);
    expect(first, JSON.stringify(contact.requests)).toMatchObject({ ok: true, snapshot: { departmentIds: ['dept-a'], jobId: 'job-agent', enabled: true } });
    if (!first.ok) throw new Error(first.reason);
    expect(JSON.stringify(first.snapshot)).not.toContain('合成坐席甲');
    expect(Date.parse(first.snapshot.validUntil) - Date.parse(first.snapshot.checkedAt)).toBe(300_000);
    expect(contact.requests.every(request => request.authorization === 'Bearer synthetic-app-token' && request.method === 'GET')).toBe(true);
    expect(contact.requests.some(request => request.url.startsWith('/open-apis/contact/v3/job_titles?page_size=50'))).toBe(true);
    expect(await write(first.snapshot), JSON.stringify(diagnostics)).toMatchObject({ ok: true, status: 'applied', factsVersion: 2 });
    expect(await write(first.snapshot)).toMatchObject({ ok: true, status: 'replayed', currentFactsVersion: 2 });
    expect(await write({ ...first.snapshot, mappingVersion: 'feishu-contact-job-title-v1-experiment' })).toMatchObject({ ok: false, reason: 'INVALID_INPUT', commit: 'rolled_back' });
    const snap = await service.snapshot(actor, { entitlementId: lease.entitlementId });
    expect(snap).toMatchObject({ ok: true });
    const stored = await admin.query("SELECT valid_until FROM content_intake.entitlements WHERE principal_id='agent'");
    expect(stored.rows[0].valid_until.toISOString()).toBe(lease.validUntil);
    expect(await state()).toMatchObject({ current_facts_version: '2', revocation_generation: '0' });
    expect((await admin.query('SELECT count(*) FROM content_intake.role_rules')).rows[0].count).toBe(rules);
    const menu = await service.authorizations(actor, {});
    expect(menu).toMatchObject({ ok: true });
    if (menu.ok) expect(menu.value.capabilities.flatMap(item => item.actions)).toEqual(['query']);
  });

  it('invalidates old usage after a job change, a department change, and deactivation', async () => {
    const first = await observe(1);
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) throw new Error(first.reason);
    expect(await write(first.snapshot)).toMatchObject({ ok: true, status: 'applied' });
    const old = await entitlement();
    const grants = (await admin.query("SELECT count(*) FROM content_intake.grants WHERE recipient_id='agent' AND revoked_at IS NULL")).rows[0].count;
    const rules = (await admin.query('SELECT count(*) FROM content_intake.role_rules')).rows[0].count;

    quotaNow += 60_000;
    await gap();
    contact.user.job_title = '合成组长';
    const promoted = await observe(2);
    expect(promoted).toMatchObject({ ok: true, snapshot: { jobId: 'job-lead', departmentIds: ['dept-a'], enabled: true } });
    if (!promoted.ok) throw new Error(promoted.reason);
    expect(await write(promoted.snapshot)).toMatchObject({ ok: true, status: 'applied' });
    expect(await service.snapshot(actor, { entitlementId: old.entitlementId })).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED' });
    expect(await roles()).toEqual(['lead']);
    const menu = await service.authorizations(actor, {});
    expect(menu).toMatchObject({ ok: true });
    if (menu.ok) expect(menu.value.capabilities.flatMap(item => item.actions)).toEqual(['query']);
    expect(await entitlement(2)).toMatchObject({ revocationGeneration: 1 });

    quotaNow += 60_000;
    await gap();
    contact.user.job_title = '合成坐席';
    contact.user.department_ids = ['unmapped-department'];
    const moved = await observe(3);
    expect(moved).toMatchObject({ ok: true, snapshot: { departmentIds: ['unmapped-department'], jobId: 'job-agent' } });
    if (!moved.ok) throw new Error(moved.reason);
    expect(await write(moved.snapshot)).toMatchObject({ ok: true, status: 'applied' });
    expect(await roles()).toEqual([]);
    expect(await service.issueEntitlement(actor, { shopId: 'shop-a', contextGeneration: 3, productIds: [], scenarioIds: [], releaseId: null })).toMatchObject({ ok: false, reason: 'SCOPE_DENIED' });
    expect(await service.snapshot(actor, { entitlementId: old.entitlementId })).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED' });
    expect((await admin.query("SELECT count(*) FROM content_intake.grants WHERE recipient_id='agent' AND revoked_at IS NULL")).rows[0].count).toBe(grants);

    quotaNow += 60_000;
    await gap();
    contact.user.department_ids = ['dept-a'];
    contact.user.status.is_frozen = true;
    const disabled = await observe(4);
    expect(disabled).toMatchObject({ ok: true, snapshot: { enabled: false, jobId: 'job-agent', departmentIds: ['dept-a'] } });
    if (!disabled.ok) throw new Error(disabled.reason);
    expect(await write(disabled.snapshot)).toMatchObject({ ok: true, status: 'applied' });
    expect(await service.authorizations(actor, {})).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
    expect(await service.snapshot(actor, { entitlementId: old.entitlementId })).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
    expect(await state()).toMatchObject({ current_facts_version: '5', revocation_generation: '3' });
    expect((await admin.query('SELECT count(*) FROM content_intake.role_rules')).rows[0].count).toBe(rules);
    expect((await admin.query("SELECT user_id FROM content_intake.principals WHERE principal_id='agent'")).rows[0].user_id).toBe('user-agent');
  });

  it('recovers an unknown commit only from the original snapshot, not from a later observation', async () => {
    const first = await observe(1);
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) throw new Error(first.reason);
    const uncertain: IntakePool = { connect: async () => {
      const client = await writerPool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (text: string, values?: unknown[]) => {
          const result = await target.query(text, values);
          if (text === 'COMMIT') throw new Error('synthetic lost response');
          return result;
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } }) as PoolClient;
    } };
    expect(await createOrganizationFactsWriter(uncertain, scope)(first.snapshot)).toMatchObject({ ok: false, commit: 'unknown', reason: 'DEPENDENCY_UNAVAILABLE' });
    expect(await state()).toMatchObject({ current_facts_version: '2' });
    quotaNow += 60_000;
    await gap();
    contact.user.department_ids = ['unmapped-department'];
    const replaced = await observe(1);
    expect(replaced).toMatchObject({ ok: true, snapshot: { departmentIds: ['unmapped-department'], expectedFactsVersion: 1 } });
    if (!replaced.ok) throw new Error(replaced.reason);
    expect(await write(replaced.snapshot)).toMatchObject({ ok: false, reason: 'VERSION_CONFLICT', commit: 'rolled_back' });
    expect(await write(first.snapshot)).toMatchObject({ ok: true, status: 'replayed', factsVersion: 2, currentFactsVersion: 2 });
    const stored = await admin.query("SELECT department_ids,job_id,enabled FROM content_intake.principal_facts WHERE principal_id='agent' AND facts_version=2");
    expect(stored.rows[0]).toMatchObject({ department_ids: ['dept-a'], job_id: 'job-agent', enabled: true });
    expect((await admin.query("SELECT count(*) FROM content_intake.principal_facts WHERE principal_id='agent'")).rows[0].count).toBe('2');
    expect(await entitlement()).toMatchObject({ revocationGeneration: 0 });
    expect(contact.requests.filter(request => request.url.startsWith('/open-apis/contact/v3/users/')).length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the previous facts and expiry when a later HTTP page fails', async () => {
    const before = await admin.query("SELECT facts_version,checked_at,valid_until FROM content_intake.principal_facts WHERE principal_id='agent' ORDER BY facts_version");
    contact.onRequest = request => {
      if (request.url.includes('page_token=second')) contact.mode = { kind: 'status', status: 500, body: '{"msg":"secret-message"}' };
    };
    const observed = await observe(1);
    expect(observed).toEqual({ ok: false, reason: 'DEPENDENCY_UNAVAILABLE' });
    expect(JSON.stringify(observed)).not.toContain('secret-message');
    expect(observed).not.toHaveProperty('snapshot');
    const after = await admin.query("SELECT facts_version,checked_at,valid_until FROM content_intake.principal_facts WHERE principal_id='agent' ORDER BY facts_version");
    expect(after.rows.map(row => ({ version: String(row.facts_version), checked: row.checked_at.toISOString(), until: row.valid_until.toISOString() }))).toEqual(
      before.rows.map(row => ({ version: String(row.facts_version), checked: row.checked_at.toISOString(), until: row.valid_until.toISOString() })));
    expect(await state()).toMatchObject({ current_facts_version: '1', revocation_generation: '0' });
    expect(contact.requests.filter(request => request.url.includes('page_token=second'))).toHaveLength(1);
  });
});
