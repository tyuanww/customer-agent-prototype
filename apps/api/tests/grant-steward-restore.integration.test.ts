import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { seedContentWriteAuthority } from './support/write-authority.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const TENANT = 'tenant-steward-guard';
const APP = 'app-steward-guard';
const ACTION = 'publish';

/** A parented business grant authorizes only while it keeps a steward, which makes that column
 *  an authorization switch. Revocation is already one-way; a cleared steward has to be one-way
 *  too, or the writer holding the column privilege can undo a revocation. */
describe.skipIf(!enabled)('grant steward is one-way', () => {
  it('refuses to restore a cleared steward, and keeps the grant switched off', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const admin = await harness.connect(harness.createDatabase('steward_guard').config);
    try {
      await applyDatabaseMigrations(admin);
      await seedContentWriteAuthority(admin, {
        tenantId: TENANT, appId: APP, brandId: 'brand-steward-guard',
        signer: { principalId: 'sg-signer', userId: 'usr_sg_signer', jobId: 'job-sg-director', role: 'director' },
        recipients: [{ principalId: 'sg-seat', userId: 'usr_sg_seat', jobId: 'job-sg-lead', role: 'lead' }],
        domains: ['presale'],
        actions: [ACTION],
      });
      const child = (await admin.query<{ grant_id: string }>(
        `SELECT grant_id FROM content_intake.grants
          WHERE recipient_id='sg-seat' AND kind='business' AND action=$1`, [ACTION])).rows[0]!;
      await expect(authorized(admin)).resolves.toBe(1);

      // Clearing the steward is how the product severs a child whose delegation was revoked
      // without a successor. It stops the grant, and that stop has to hold.
      await asWriter(admin, `UPDATE content_intake.grants
        SET steward_id=NULL, version=version+1, last_change_reason='severed' WHERE grant_id=$1`, [child.grant_id]);
      await expect(authorized(admin)).resolves.toBe(0);

      const restored = await asWriter(admin, `UPDATE content_intake.grants
        SET steward_id='sg-signer', version=version+1, last_change_reason='restore' WHERE grant_id=$1`,
      [child.grant_id]);
      expect(restored).toMatchObject({ ok: false, code: 'GRANT_STEWARD_RESTORE_FORBIDDEN' });
      await expect(authorized(admin)).resolves.toBe(0);
    } finally {
      await admin.end();
      harness.stop();
    }
  }, 300_000);

  it('still lets a live steward be replaced, which is what a takeover does', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const admin = await harness.connect(harness.createDatabase('steward_takeover').config);
    try {
      await applyDatabaseMigrations(admin);
      await seedContentWriteAuthority(admin, {
        tenantId: TENANT, appId: APP, brandId: 'brand-steward-guard',
        signer: { principalId: 'sg-signer', userId: 'usr_sg_signer', jobId: 'job-sg-director', role: 'director' },
        recipients: [
          { principalId: 'sg-seat', userId: 'usr_sg_seat', jobId: 'job-sg-lead', role: 'lead' },
          { principalId: 'sg-other', userId: 'usr_sg_other', jobId: 'job-sg-manager', role: 'manager' },
        ],
        domains: ['presale'],
        actions: [ACTION],
        idPrefix: 'takeover',
      });
      const child = (await admin.query<{ grant_id: string }>(
        `SELECT grant_id FROM content_intake.grants
          WHERE recipient_id='sg-seat' AND kind='business' AND action=$1`, [ACTION])).rows[0]!;
      const replaced = await asWriter(admin, `UPDATE content_intake.grants
        SET steward_id='sg-other', version=version+1, last_change_reason='takeover' WHERE grant_id=$1`,
      [child.grant_id]);
      expect(replaced).toEqual({ ok: true });
      await expect(authorized(admin)).resolves.toBe(1);
    } finally {
      await admin.end();
      harness.stop();
    }
  }, 300_000);
});

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

async function authorized(admin: Client): Promise<number> {
  const result = await admin.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM content_intake.authorization_sources($1,$2,clock_timestamp())',
    ['sg-seat', ACTION]);
  return result.rows[0]?.n ?? -1;
}
