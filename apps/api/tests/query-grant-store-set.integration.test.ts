import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { seedContentWriteAuthority } from './support/write-authority.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const TENANT = 'tenant-restamp';
const APP = 'app-restamp';
const BRAND = 'brand-restamp';
const ACTION = 'query';
const SOURCE = `source-${TENANT}-presale`;
const OTHER_SOURCE = 'source-restamp-other';

/** Pins the invariant `0059_query_grant_restamp` owns: an approved set that advances must not
 *  silently de-authorize a grant whose source it still contains. The two cases differ only in
 *  whether the source stays a member. */
describe.skipIf(!enabled)('query grant follows the store set', () => {
  it('keeps a manual query grant working when the same source stays approved', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const admin = await harness.connect(harness.createDatabase('restamp').config);
    try {
      await applyDatabaseMigrations(admin);
      await seedContentWriteAuthority(admin, {
        tenantId: TENANT, appId: APP, brandId: BRAND,
        signer: { principalId: 'rs-signer', userId: 'usr_rs_signer', jobId: 'job-rs-director', role: 'director' },
        recipients: [{ principalId: 'rs-seat', userId: 'usr_rs_seat', jobId: 'job-rs-lead', role: 'lead' }],
        domains: ['presale'],
        actions: [ACTION],
        query: true,
      });
      await expect(authorized(admin)).resolves.toBe(1);

      // The approved set advances with the same source still in it. This is what the roster
      // refresh does when the release lineage changes, and it is the moment a stamped grant
      // goes stale.
      await advanceStoreSet(admin, 2, [SOURCE]);

      await expect(authorized(admin)).resolves.toBe(1);
    } finally {
      await admin.end();
      harness.stop();
    }
  }, 300_000);

  it('stops the grant when its source leaves the approved set', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const admin = await harness.connect(harness.createDatabase('restamp_drop').config);
    try {
      await applyDatabaseMigrations(admin);
      await seedContentWriteAuthority(admin, {
        tenantId: TENANT, appId: APP, brandId: BRAND,
        signer: { principalId: 'rs-signer', userId: 'usr_rs_signer', jobId: 'job-rs-director', role: 'director' },
        recipients: [{ principalId: 'rs-seat', userId: 'usr_rs_seat', jobId: 'job-rs-lead', role: 'lead' }],
        domains: ['presale'],
        actions: [ACTION],
        query: true,
      });
      await expect(authorized(admin)).resolves.toBe(1);

      await admin.query('BEGIN');
      await admin.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
        SELECT $1,scope_id,1,'v2-preview' FROM content_intake.sources WHERE source_id=$2`, [OTHER_SOURCE, SOURCE]);
      await admin.query(`INSERT INTO content_intake.source_mappings(
          source_id,version,template_version,rule_version,mapping_version,structure_digest)
        VALUES ($1,1,'faq-p1.1','intake-p1.1','faq-map',repeat('ab',32))`, [OTHER_SOURCE]);
      await admin.query('COMMIT');
      // 0062 retains the old pointer for an empty set. A nonempty replacement
      // reaches the withdrawal branch without changing that retention guarantee.
      await advanceStoreSet(admin, 2, [OTHER_SOURCE]);

      await expect(authorized(admin)).resolves.toBe(0);
    } finally {
      await admin.end();
      harness.stop();
    }
  }, 300_000);
});

/** Advance the approved set the way the roster refresh does, without needing a release in
 *  `content_current`: write the next version, its members, then move the pointer. */
async function advanceStoreSet(admin: Client, version: number, sourceIds: readonly string[]): Promise<void> {
  await admin.query('BEGIN');
  try {
    await admin.query(`INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
      VALUES ($1,$2,$3,clock_timestamp(),'synthetic-advance')`, [TENANT, APP, version]);
    await admin.query(`INSERT INTO content_intake.store_set_members(
        tenant_id, app_id, version, scope_id, source_id, content_valid_until)
      SELECT scope.tenant_id,scope.app_id,$3,scope.scope_id,source.source_id,clock_timestamp()+interval '1 hour'
      FROM content_intake.sources source JOIN content_intake.scopes scope USING(scope_id)
      WHERE scope.tenant_id=$1 AND scope.app_id=$2 AND source.source_id=ANY($4::text[])`, [TENANT, APP, version, sourceIds]);
    const moved = await admin.query(`UPDATE content_intake.store_set_current SET version=$3
      WHERE tenant_id=$1 AND app_id=$2 RETURNING version`, [TENANT, APP, version]);
    expect(moved.rows.map(row => Number(row.version))).toEqual([version]);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

async function authorized(admin: Client): Promise<number> {
  const result = await admin.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM content_intake.authorization_sources($1,$2,clock_timestamp())',
    ['rs-seat', ACTION]);
  return result.rows[0]?.n ?? -1;
}
