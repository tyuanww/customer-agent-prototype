import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { seedContentWriteAuthority } from './support/write-authority.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

/** A writer holding INSERT on `grants` can name any parent it likes, and `grant_parent_guard`
 *  used to check only that the child matched it. The parent proves the issuer was once given
 *  the action; it cannot show that the issuer still qualifies. A closed facts window is one way
 *  the two diverge, and it is the state a revocation leaves behind. */
describe.skipIf(!enabled)('grant issuer authority', () => {
  it('refuses a child whose issuer facts window has closed', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const admin = await harness.connect(harness.createDatabase('issuer_authority').config);
    try {
      await applyDatabaseMigrations(admin);
      const { allocation, tenantId, appId } = await seedAllocation(admin, 'ia');
      await closeFactsWindow(admin, 'ia-signer', tenantId);
      const minted = await asWriter(admin, mintChild(), [allocation, 'ia-signer', 'ia-peer', tenantId, appId]);
      expect(minted).toEqual({ ok: false, code: 'GRANT_ISSUER_NOT_AUTHORIZED' });
    } finally {
      await admin.end();
      harness.stop();
    }
  }, 300_000);

  it('admits a child from an issuer whose facts window is open', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const admin = await harness.connect(harness.createDatabase('issuer_authority_ok').config);
    try {
      await applyDatabaseMigrations(admin);
      const { allocation, tenantId, appId } = await seedAllocation(admin, 'ib');
      const minted = await asWriter(admin, mintChild(), [allocation, 'ib-signer', 'ib-peer', tenantId, appId]);
      expect(minted).toEqual({ ok: true });
    } finally {
      await admin.end();
      harness.stop();
    }
  }, 300_000);
});

/** The signer holds the allocation, which is the parent a forged child quotes. */
async function seedAllocation(admin: Client, prefix: string): Promise<
  Readonly<{ allocation: string; tenantId: string; appId: string }>
> {
  const tenantId = `tenant-${prefix}`;
  const appId = `app-${prefix}`;
  await seedContentWriteAuthority(admin, {
    tenantId, appId, brandId: `brand-${prefix}`,
    signer: { principalId: `${prefix}-signer`, userId: `usr_${prefix}_signer`, jobId: `job-${prefix}-director`, role: 'director' },
    recipients: [{ principalId: `${prefix}-peer`, userId: `usr_${prefix}_peer`, jobId: `job-${prefix}-peer`, role: 'agent' }],
    domains: ['presale'],
    actions: ['publish'],
    idPrefix: `${prefix}-authority`,
  });
  const allocation = (await admin.query<{ grant_id: string }>(
    `SELECT grant_id FROM content_intake.grants
      WHERE recipient_id = $1 AND kind = 'allocation' AND action = 'publish'`, [`${prefix}-signer`])).rows[0];
  if (!allocation) throw new Error('the fixture must leave the signer holding an allocation');
  return { allocation: allocation.grant_id, tenantId, appId };
}

/** Facts rows are immutable history, so a closed window is a new version, not an edit. */
async function closeFactsWindow(admin: Client, principalId: string, tenantId: string): Promise<void> {
  await admin.query(`INSERT INTO content_intake.principal_facts(
      principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
    VALUES ($1, 2, ARRAY[$2], $3, true,
      clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '6 minutes', repeat('e', 64))`,
  [principalId, `dept-${tenantId}`, `job-${principalId.replace('-signer', '')}-director`]);
  await admin.query(`UPDATE content_intake.principals SET current_facts_version = 2 WHERE principal_id = $1`,
    [principalId]);
}

function mintChild(): string {
  return `INSERT INTO content_intake.grants(
      grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
      starts_at, expires_at, reason, steward_id, parent_grant_id)
    SELECT 'minted-child', 'business', $2::text, $3::text, $4::text, $5::text, scope_id, source_id, 'publish',
      clock_timestamp(), clock_timestamp() + interval '30 minutes', 'minted', $2::text, grant_id
    FROM content_intake.grants WHERE grant_id = $1::text`;
}

async function asWriter(admin: Client, sql: string, params: readonly unknown[]): Promise<
  { ok: true } | { ok: false; code: string }
> {
  await admin.query('BEGIN');
  await admin.query('SET LOCAL ROLE intake_business');
  try {
    await admin.query(sql, params as unknown[]);
    await admin.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await admin.query('ROLLBACK');
    const code = /GRANT_[A-Z_]+/.exec((error as Error).message)?.[0];
    return { ok: false, code: code ?? 'UNKNOWN' };
  } finally {
    await admin.query('RESET ROLE').catch(() => undefined);
  }
}
