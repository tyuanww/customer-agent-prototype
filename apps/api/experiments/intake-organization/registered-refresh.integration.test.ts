import path from 'node:path';
import { createHash } from 'node:crypto';
import { Pool, type Client, type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createRegisteredOrganizationRefresh } from '../../src/content-intake/organization/registered-refresh.js';
import { createOrganizationHttpSessionOwner, createOrganizationHttpTransport } from './http-transport.js';
import { startSyntheticContactDouble } from './synthetic-contact-double.js';
import { seedIntakeSyntheticHost } from '../../tests/support/intake-synthetic-seed.js';
import { createContentIntakeService } from '../../src/content-intake/service.js';
import { createContentObjectStore } from '../../src/content-object-store.js';
import { createProductAuthService } from '../../src/product-auth-service.js';
import type { AuthenticatedUser, ProductAuthService } from '../../src/auth-service.js';
import type { IntakePool } from '../../src/content-intake/transaction.js';

import { createIntakePurposePool, type IntakePurposePool } from '../../src/content-intake/runtime-pool.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const scope = { tenantId: 'tenant-a', appId: 'app-a' };
describe.skipIf(!enabled)('registered organization input through the existing atomic facts writer', () => {
  let harness: Pg15Harness, admin: Client, pool: Pool, writerPool: IntakePurposePool;
  let service: ReturnType<typeof createContentIntakeService>, auth: ProductAuthService, actor: AuthenticatedUser;
  let contact: Awaited<ReturnType<typeof startSyntheticContactDouble>>;
  let transport: ReturnType<typeof createOrganizationHttpTransport>;
  let refresh: ReturnType<typeof createRegisteredOrganizationRefresh>;
  let quotaNow = Date.now();
  beforeEach(async () => {
    harness = new Pg15Harness(); harness.start();
    const db = harness.createDatabase('registered_organization');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await seedIntakeSyntheticHost(admin);
    await admin.query('CREATE ROLE registered_facts_writer LOGIN NOINHERIT; GRANT intake_org_writer TO registered_facts_writer; CREATE ROLE registered_org_auth LOGIN NOINHERIT; GRANT app_backend_auth TO registered_org_auth');
    pool = new Pool({ ...db.config, max: 3 });
    writerPool = createIntakePurposePool({ ...db.config, user: 'registered_facts_writer', max: 3 }, 'organization');
    service = createContentIntakeService(pool, createContentObjectStore(path.join(harness.root, db.name)), () => undefined, undefined, { requireProductSession: true });
    auth = await createProductAuthService({ connectionString: `postgresql://registered_org_auth@localhost/${db.name}?${new URLSearchParams({ host: harness.socket, port: String(harness.port) })}`,
      poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000 }, { authorizeUrl: state => `http://127.0.0.1/authorize?state=${state}`, exchange: async code => code, close: () => undefined }, 'mock');
    const verifier = 'v'.repeat(43), login = await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
    await auth.callback(new URL(login.authorize_url).searchParams.get('state')!, 'agent');
    const session = await auth.exchange(login.login_id, verifier);
    actor = (await auth.authenticate({ authorization: `Bearer ${session!.access_token}` }))!;
    contact = await startSyntheticContactDouble(); quotaNow = Date.now();
    const owner = createOrganizationHttpSessionOwner({ tokenTimeoutMs: 1_000, now: () => quotaNow,
      supplier: () => ({ current: async () => ({ token: 'synthetic-registered-token', expiresAtMs: quotaNow + 3_600_000 }) }) });
    transport = createOrganizationHttpTransport({ origin: contact.origin, session: owner.session(scope), requestTimeoutMs: 2_000 });
    refresh = createRegisteredOrganizationRefresh(writerPool, scope, transport);
    expect(await refresh.register({ principalId: 'agent', openId: contact.user.open_id, expectedBindingVersion: 0,
      validUntil: new Date(Date.now() + 3_600_000).toISOString() })).toMatchObject({ ok: true, binding: { bindingVersion: 1 } });
  }, 60_000);
  afterEach(async () => {
    await contact?.close(); await auth?.close(); await pool?.end(); await writerPool?.end(); await admin?.end(); harness?.stop();
  }, 60_000);
  const gap = () => new Promise(resolve => setTimeout(resolve, 20));
  async function state() {
    return (await admin.query(`SELECT p.current_facts_version,p.revocation_generation,f.enabled,
      (SELECT count(*) FROM intake_organization.observations) AS observations,
      (SELECT binding_version FROM intake_organization.current_bindings WHERE principal_id='agent') AS binding_version
      FROM content_intake.principals p JOIN content_intake.principal_facts f
      ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version WHERE p.principal_id='agent'`)).rows[0];
  }
  function intercepted(onQuery: (sql: string) => Promise<void>): IntakePool {
    return { connect: async () => {
      const client = await writerPool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values); await onQuery(sql); return result;
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } }) as PoolClient;
    } };
  }

  it('reads registered identity, persists exact provenance atomically and rejects modified replay', async () => {
    const request = await refresh.observe('agent');
    expect(request.kind).toBe('observation');
    expect(await refresh.write(request)).toMatchObject({ ok: true, status: 'applied', factsVersion: 2 });
    const rows = await admin.query('SELECT * FROM intake_organization.observations');
    expect(rows.rows[0]).toMatchObject({ principal_id: 'agent', facts_version: '2', binding_version: '1',
      mapping_version: 'feishu-contact-job-title-v1', directory_digest: request.kind === 'observation' ? request.provenance.directoryDigest : '' });
    expect(await refresh.write(request)).toMatchObject({ ok: true, status: 'replayed' });
    if (request.kind !== 'observation') throw new Error('missing provenance');
    expect(await refresh.write({ ...request, provenance: { ...request.provenance, directoryDigest: '0'.repeat(64) } })).toMatchObject({ ok: false, reason: 'VERSION_CONFLICT' });
    expect(await state()).toMatchObject({ current_facts_version: '2', observations: '1' });
    expect(await service.issueEntitlement(actor, { shopId: 'shop-a', contextGeneration: 1, productIds: [], scenarioIds: [], releaseId: null })).toMatchObject({ ok: true });
  });

  it('revokes binding and facts atomically, denies old/new usage and rejects a pre-rebind snapshot', async () => {
    expect(await refresh.write(await refresh.observe('agent'))).toMatchObject({ ok: true });
    const lease = await service.issueEntitlement(actor, { shopId: 'shop-a', contextGeneration: 1, productIds: [], scenarioIds: [], releaseId: null });
    if (!lease.ok) throw new Error(lease.reason);
    await gap();
    const stale = await refresh.observe('agent');
    await gap();
    const revoke = await refresh.prepareRevocation('agent');
    expect(await refresh.write(revoke)).toMatchObject({ ok: true, factsVersion: 3 });
    expect(await state()).toMatchObject({ current_facts_version: '3', revocation_generation: '1', enabled: false, binding_version: '2' });
    expect(await service.snapshot(actor, { entitlementId: lease.value.entitlementId })).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
    expect(await service.issueEntitlement(actor, { shopId: 'shop-a', contextGeneration: 2, productIds: [], scenarioIds: [], releaseId: null })).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
    await expect(refresh.observe('agent')).rejects.toThrow('SUBJECT_UNAVAILABLE');
    expect(await refresh.write(revoke)).toMatchObject({ ok: true, status: 'replayed' });
    contact.user.open_id = 'synthetic-rebound';
    expect(await refresh.register({ principalId: 'agent', openId: contact.user.open_id, expectedBindingVersion: 2,
      validUntil: new Date(Date.now() + 3_600_000).toISOString() })).toMatchObject({ ok: true, binding: { bindingVersion: 3 } });
    expect(await refresh.write(stale)).toMatchObject({ ok: false, reason: 'VERSION_CONFLICT' });
    quotaNow += 60_000; await gap();
    expect(await refresh.write(await refresh.observe('agent'))).toMatchObject({ ok: true, factsVersion: 4 });
    expect(await state()).toMatchObject({ enabled: true, binding_version: '3', revocation_generation: '2' });
  });

  it('serializes concurrent identical observations and fences different provenance', async () => {
    const request = await refresh.observe('agent');
    const results = await Promise.all([refresh.write(request), refresh.write(request)]);
    expect(results.map(result => result.ok && result.status).sort()).toEqual(['applied','replayed']);
    expect(await state()).toMatchObject({ current_facts_version: '2', observations: '1' });
  });

  it('recovers a lost COMMIT from the original observation and original revocation only', async () => {
    const uncertain = createRegisteredOrganizationRefresh(intercepted(async sql => { if (sql === 'COMMIT') throw new Error('synthetic lost commit'); }), scope, transport);
    const request = await refresh.observe('agent');
    expect(await uncertain.write(request)).toMatchObject({ ok: false, commit: 'unknown' });
    expect(await refresh.write(request)).toMatchObject({ ok: true, status: 'replayed' });
    await gap();
    const revoke = await refresh.prepareRevocation('agent');
    expect(await uncertain.write(revoke)).toMatchObject({ ok: false, commit: 'unknown' });
    expect(await state()).toMatchObject({ enabled: false, binding_version: '2' });
    expect(await refresh.write(revoke)).toMatchObject({ ok: true, status: 'replayed' });
    expect(await refresh.write({ ...revoke, snapshot: { ...revoke.snapshot, checkedAt: new Date(Date.parse(revoke.snapshot.checkedAt) + 1).toISOString() } })).toMatchObject({ ok: false, reason: 'VERSION_CONFLICT' });
  });

  it('rolls fact and binding pointers back if evidence insertion or final deadline fails', async () => {
    const request = await refresh.observe('agent');
    expect(await refresh.write(request)).toMatchObject({ ok: true });
    await gap();
    const revoke = await refresh.prepareRevocation('agent');
    const failed = createRegisteredOrganizationRefresh(intercepted(async sql => {
      if (sql.includes('INSERT INTO intake_organization.observations')) throw new Error('synthetic association failure');
    }), scope, transport);
    expect(await failed.write(revoke)).toMatchObject({ ok: false, commit: 'rolled_back' });
    expect(await state()).toMatchObject({ current_facts_version: '2', binding_version: '1', enabled: true, observations: '1' });
    const expiring = { ...revoke, snapshot: { ...revoke.snapshot, validUntil: new Date(Date.now() + 100).toISOString() } };
    const delayed = createRegisteredOrganizationRefresh(intercepted(async sql => {
      if (sql.includes('INSERT INTO intake_organization.observations')) await new Promise(resolve => setTimeout(resolve, 150));
    }), scope, transport);
    expect(await delayed.write(expiring)).toMatchObject({ ok: false, reason: 'STALE_OBSERVATION', commit: 'rolled_back' });
    expect(await state()).toMatchObject({ current_facts_version: '2', binding_version: '1', enabled: true, observations: '1' });
  });

  it('rejects wrong scope and active rebinding; cancellation cannot create an observation', async () => {
    const other = createRegisteredOrganizationRefresh(writerPool, { ...scope, appId: 'other-app' }, transport);
    expect(await other.register({ principalId: 'agent', openId: contact.user.open_id, expectedBindingVersion: 0,
      validUntil: new Date(Date.now() + 3_600_000).toISOString() })).toMatchObject({ ok: false, reason: 'SUBJECT_UNAVAILABLE' });
    expect(await refresh.register({ principalId: 'agent', openId: 'synthetic-other', expectedBindingVersion: 1,
      validUntil: new Date(Date.now() + 3_600_000).toISOString() })).toMatchObject({ ok: false, reason: 'VERSION_CONFLICT' });
    contact.mode = { kind: 'hang' };
    const controller = new AbortController(), pending = refresh.observe('agent', controller.signal);
    const limit = Date.now() + 1_000;
    while (!contact.requests.length && Date.now() < limit) await gap();
    expect(contact.requests.length).toBeGreaterThan(0);
    controller.abort();
    await expect(pending).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
    expect(await state()).toMatchObject({ current_facts_version: '1', observations: '0', binding_version: '1' });
  });

  it('revokes an expired active registration before registering a new identity', async () => {
    // Start with a revoked registration, then give the next active registration a
    // deliberately short synthetic lifetime; no immutable binding row is edited.
    expect(await refresh.write(await refresh.prepareRevocation('agent'))).toMatchObject({ ok: true });
    const short = { principalId: 'agent', openId: contact.user.open_id, expectedBindingVersion: 2,
      validUntil: new Date(Date.now() + 80).toISOString() };
    expect(await refresh.register(short)).toMatchObject({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    await expect(refresh.observe('agent')).rejects.toThrow('SUBJECT_UNAVAILABLE');
    const revoke = await refresh.prepareRevocation('agent');
    expect(await refresh.write(revoke)).toMatchObject({ ok: true });
    expect(await state()).toMatchObject({ enabled: false, binding_version: '4' });
    expect(await refresh.register({ ...short, openId: 'synthetic-next', expectedBindingVersion: 4,
      validUntil: new Date(Date.now() + 3_600_000).toISOString() })).toMatchObject({ ok: true, binding: { bindingVersion: 5 } });
    expect(await refresh.register(short)).toMatchObject({ ok: true, status: 'replayed', binding: { bindingVersion: 3 } });
    expect(await state()).toMatchObject({ binding_version: '5', enabled: false });
  });

  it('recovers registration COMMIT without rebinding and rejects an open ID already assigned to another principal', async () => {
    const uncertain = createRegisteredOrganizationRefresh(intercepted(async sql => { if (sql === 'COMMIT') throw new Error('synthetic lost commit'); }), scope, transport);
    const input = { principalId: 'enabler', openId: 'synthetic-other-principal', expectedBindingVersion: 0,
      validUntil: new Date(Date.now() + 3_600_000).toISOString() };
    expect(await uncertain.register(input)).toMatchObject({ ok: false, commit: 'unknown' });
    expect(await refresh.register(input)).toMatchObject({ ok: true, status: 'replayed' });
    // The established agent binding's open ID cannot also name a second principal.
    expect(await refresh.register({ ...input, principalId: 'reviewer', openId: contact.user.open_id })).toMatchObject({ ok: false, commit: 'rolled_back', reason: 'DEPENDENCY_UNAVAILABLE' });
    expect((await admin.query("SELECT count(*) FROM intake_organization.bindings WHERE principal_id='reviewer'")).rows[0].count).toBe('0');
  });

  it('rolls an expired registration insert back at its final database-clock checkpoint', async () => {
    const delayed = createRegisteredOrganizationRefresh(intercepted(async sql => {
      if (sql.includes('INSERT INTO intake_organization.current_bindings')) await new Promise(resolve => setTimeout(resolve, 150));
    }), scope, transport);
    expect(await delayed.register({ principalId: 'enabler', openId: 'synthetic-expiring-binding', expectedBindingVersion: 0,
      validUntil: new Date(Date.now() + 100).toISOString() })).toMatchObject({ ok: false, reason: 'STALE_OBSERVATION', commit: 'rolled_back' });
    expect((await admin.query("SELECT count(*) FROM intake_organization.bindings WHERE principal_id='enabler'")).rows[0].count).toBe('0');
    expect((await admin.query("SELECT count(*) FROM intake_organization.current_bindings WHERE principal_id='enabler'")).rows[0].count).toBe('0');
  });

  it('rejects cross-scope, invalid domains, non-finite timestamps and null provenance in SQL itself', async () => {
    const insert = `INSERT INTO intake_organization.bindings VALUES($1,$2,$3,$4,$5,$6,true,$7)`;
    const common = ['tenant-a','app-a','enabler',1,'0'.repeat(64),'synthetic-other',new Date(Date.now() + 60_000).toISOString()];
    await expect(admin.query(insert, ['tenant-a','other-app',...common.slice(2)])).rejects.toMatchObject({ code: '23503' });
    await expect(admin.query(insert, [...common.slice(0,6),'infinity'])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(insert, ['',...common.slice(1)])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(insert, [...common.slice(0,3),0,...common.slice(4)])).rejects.toMatchObject({ code: '23514' });
    const observation = `INSERT INTO intake_organization.observations VALUES('agent',1,'tenant-a','app-a',1,$1,'observation',$2,$3,$4)`;
    await expect(admin.query(observation, ['0'.repeat(64),null,null,new Date().toISOString()])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(observation, ['0'.repeat(64),'feishu-contact-job-title-v1','0'.repeat(64),'infinity'])).rejects.toMatchObject({ code: 'ZA003', message: 'ORGANIZATION_PROVENANCE_CONFLICT' });
  });
});
