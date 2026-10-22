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

/** A query grant names the policy and store set current when it was written, and
 *  `authorization_sources` compares both against the live values. When the approved store set
 *  advances, a grant written by the operator therefore stops authorizing even though its source
 *  is still approved. The roster path re-stamps its own grants; a manual one was left behind,
 *  which is the silent failure this suite pins. */
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
      await advanceStoreSet(admin, 2);

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

      // The new set drops the source, so the grant must not survive on a stale stamp.
      await advanceStoreSet(admin, 2, { members: false });

      await expect(authorized(admin)).resolves.toBe(0);
    } finally {
      await admin.end();
      harness.stop();
    }
  }, 300_000);
});

/** Advance the approved set the way the roster refresh does, without needing a release in
 *  `content_current`: write the next version, its members, then move the pointer. */
async function advanceStoreSet(admin: Client, version: number, options: { members?: boolean } = {}): Promise<void> {
  const keepMembers = options.members ?? true;
  await admin.query('BEGIN');
  try {
    await admin.query(`INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
      VALUES ($1,$2,$3,clock_timestamp(),'synthetic-advance')`, [TENANT, APP, version]);
    if (keepMembers) {
      await admin.query(`INSERT INTO content_intake.store_set_members(
          tenant_id, app_id, version, scope_id, source_id, content_valid_until)
        SELECT tenant_id, app_id, $3, scope_id, source_id, content_valid_until
        FROM content_intake.store_set_members
        WHERE tenant_id=$1 AND app_id=$2 AND version=$4`, [TENANT, APP, version, version - 1]);
    }
    await admin.query(`UPDATE content_intake.store_set_current SET version=$3
      WHERE tenant_id=$1 AND app_id=$2`, [TENANT, APP, version]);
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
