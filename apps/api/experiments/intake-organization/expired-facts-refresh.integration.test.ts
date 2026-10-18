import path from 'node:path';
import { createHash } from 'node:crypto';
import { Pool, type Client } from 'pg';
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
import { createIntakePurposePool, type IntakePurposePool } from '../../src/content-intake/runtime-pool.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const scope = { tenantId: 'tenant-a', appId: 'app-a' };
const seat = { shopId: 'shop-a', contextGeneration: 1, productIds: [], scenarioIds: [], releaseId: null };

describe.skipIf(!enabled)('expired facts stay unavailable until the registered directory refresh', () => {
  let harness: Pg15Harness, admin: Client, pool: Pool, writerPool: IntakePurposePool;
  let service: ReturnType<typeof createContentIntakeService>, auth: ProductAuthService, actor: AuthenticatedUser;
  let contact: Awaited<ReturnType<typeof startSyntheticContactDouble>>;
  let refresh: ReturnType<typeof createRegisteredOrganizationRefresh>;

  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('expired_facts_refresh');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await seedIntakeSyntheticHost(admin, 'product', 'xlsx', false, 'expired');
    await admin.query('CREATE ROLE expired_facts_writer LOGIN NOINHERIT; GRANT intake_org_writer TO expired_facts_writer; CREATE ROLE expired_facts_auth LOGIN NOINHERIT; GRANT app_backend_auth TO expired_facts_auth');
    pool = new Pool({ ...db.config, max: 2 });
    writerPool = createIntakePurposePool({ ...db.config, user: 'expired_facts_writer', max: 2 }, 'organization');
    service = createContentIntakeService(pool, createContentObjectStore(path.join(harness.root, db.name)), () => undefined, undefined, { requireProductSession: true });
    auth = await createProductAuthService({
      connectionString: `postgresql://expired_facts_auth@localhost/${db.name}?${new URLSearchParams({ host: harness.socket, port: String(harness.port) })}`,
      poolMax: 1, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
    }, { authorizeUrl: state => `http://127.0.0.1/authorize?state=${state}`, exchange: async code => code, close: () => undefined }, 'mock');
    const verifier = 'v'.repeat(43);
    const login = await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
    await auth.callback(new URL(login.authorize_url).searchParams.get('state')!, 'agent');
    const session = await auth.exchange(login.login_id, verifier);
    actor = (await auth.authenticate({ authorization: `Bearer ${session!.access_token}` }))!;
    contact = await startSyntheticContactDouble();
    const now = Date.now();
    const owner = createOrganizationHttpSessionOwner({
      tokenTimeoutMs: 1_000, now: () => now,
      supplier: () => ({ current: async () => ({ token: 'synthetic-expired-token', expiresAtMs: now + 3_600_000 }) }),
    });
    const transport = createOrganizationHttpTransport({ origin: contact.origin, session: owner.session(scope), requestTimeoutMs: 2_000 });
    refresh = createRegisteredOrganizationRefresh(writerPool, scope, transport);
  }, 60_000);

  afterEach(async () => {
    await contact?.close();
    await auth?.close();
    await pool?.end();
    await writerPool?.end();
    await admin?.end();
    harness?.stop();
  }, 60_000);

  it('returns ORG_FACTS_UNAVAILABLE until createRegisteredOrganizationRefresh writes a new facts version', async () => {
    const before = (await admin.query(`SELECT facts_version, checked_at, valid_until FROM content_intake.principal_facts
      WHERE principal_id='agent' ORDER BY facts_version`)).rows;
    expect(before).toHaveLength(1);
    expect(await service.issueEntitlement(actor, seat)).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });

    const registered = await refresh.register({
      principalId: 'agent', openId: contact.user.open_id, expectedBindingVersion: 0,
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(registered).toMatchObject({ ok: true, binding: { bindingVersion: 1 } });
    const observation = await refresh.observe('agent');
    expect(observation.kind).toBe('observation');
    const written = await refresh.write(observation);
    expect(written).toMatchObject({ ok: true, status: 'applied', factsVersion: 2 });

    const after = (await admin.query(`SELECT facts_version, checked_at, valid_until FROM content_intake.principal_facts
      WHERE principal_id='agent' ORDER BY facts_version`)).rows;
    expect(after[0]).toEqual(before[0]);
    expect(after).toHaveLength(2);
    expect(await admin.query('SELECT count(*) FROM intake_organization.observations')).toMatchObject({ rows: [{ count: '1' }] });
    expect(await service.issueEntitlement(actor, { ...seat, contextGeneration: 2 })).toMatchObject({ ok: true });
  });
});
