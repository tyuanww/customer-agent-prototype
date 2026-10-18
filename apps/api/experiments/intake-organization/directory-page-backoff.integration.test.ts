import path from 'node:path';
import { Pool, type Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createRegisteredOrganizationRefresh } from '../../src/content-intake/organization/registered-refresh.js';
import { createOrganizationHttpSessionOwner, createOrganizationHttpTransport } from './http-transport.js';
import { startSyntheticContactDouble } from './synthetic-contact-double.js';
import { seedIntakeSyntheticHost } from '../../tests/support/intake-synthetic-seed.js';
import { createIntakePurposePool, type IntakePurposePool } from '../../src/content-intake/runtime-pool.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const scope = { tenantId: 'tenant-a', appId: 'app-a' };

describe.skipIf(!enabled)('registered refresh follows a directory past the old five-page cap', () => {
  let harness: Pg15Harness, admin: Client, pool: Pool, writerPool: IntakePurposePool;
  let contact: Awaited<ReturnType<typeof startSyntheticContactDouble>>;
  let refresh: ReturnType<typeof createRegisteredOrganizationRefresh>;
  const jobRequests: number[] = [];

  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('directory_page_backoff');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await seedIntakeSyntheticHost(admin);
    await admin.query('CREATE ROLE directory_page_writer LOGIN NOINHERIT; GRANT intake_org_writer TO directory_page_writer');
    pool = new Pool({ ...db.config, max: 2 });
    writerPool = createIntakePurposePool({ ...db.config, user: 'directory_page_writer', max: 1 }, 'organization');
    contact = await startSyntheticContactDouble();
    contact.pages.first = { items: [{ job_title_id: 'job-agent', name: '合成坐席', status: true }], has_more: true, page_token: 'p2' };
    for (let page = 2; page <= 6; page += 1) {
      contact.pages[`p${page}`] = {
        items: [{ job_title_id: `job-${page}`, name: `合成岗位${page}`, status: true }],
        has_more: page < 6,
        ...(page < 6 ? { page_token: `p${page + 1}` } : {}),
      };
    }
    contact.onRequest = request => {
      if (request.url.includes('job_titles')) jobRequests.push(Date.now());
    };
    const owner = createOrganizationHttpSessionOwner({
      tokenTimeoutMs: 1_000,
      supplier: () => ({ current: async () => ({ token: 'synthetic-page-token', expiresAtMs: Date.now() + 3_600_000 }) }),
    });
    const transport = createOrganizationHttpTransport({
      origin: contact.origin, session: owner.session(scope), requestTimeoutMs: 2_000,
    });
    refresh = createRegisteredOrganizationRefresh(writerPool, scope, transport);
    expect(await refresh.register({
      principalId: 'agent', openId: contact.user.open_id, expectedBindingVersion: 0,
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    })).toMatchObject({ ok: true });
  }, 60_000);

  afterEach(async () => {
    await contact?.close();
    await pool?.end();
    await writerPool?.end();
    await admin?.end();
    harness?.stop();
  }, 60_000);

  it('waits out the job-title limit and writes the facts from all six pages', async () => {
    const before = (await admin.query(`SELECT facts_version::int AS version, valid_until FROM content_intake.principal_facts
      WHERE principal_id='agent'`)).rows;
    const observation = await refresh.observe('agent');
    expect(observation.kind).toBe('observation');
    const written = await refresh.write(observation);
    expect(written).toMatchObject({ ok: true, status: 'applied', factsVersion: 2 });
    const after = (await admin.query(`SELECT facts_version::int AS version, valid_until FROM content_intake.principal_facts
      WHERE principal_id='agent' ORDER BY facts_version`)).rows;
    expect(after[0]).toEqual(before[0]);
    expect(after).toHaveLength(2);
    expect(contact.requests.some(request => request.url.includes('page_token=p6'))).toBe(true);
    expect(jobRequests.length).toBeGreaterThanOrEqual(12);
    expect(jobRequests[10]! - jobRequests[0]!).toBeGreaterThanOrEqual(60_000);
  }, 150_000);
});
