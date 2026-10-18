import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { bootstrapRootAllocation } from '../../src/content-intake/authority.js';
import { IntakeRejection, type IntakeTransaction } from '../../src/content-intake/transaction.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

function transaction(client: Client): IntakeTransaction {
  return {
    query: client.query.bind(client),
    validUntil() {},
    beforeCommit() {},
  };
}

describe.skipIf(!enabled)('privileged root allocation through the shipped authority path', () => {
  let harness: Pg15Harness;
  let admin: Client;
  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('root_allocation');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await admin.query('BEGIN');
    for (const [id, userId] of [['publisher', 'user-publisher'], ['synthetic-owner', 'usr_synthetic_owner']] as const) {
      await admin.query(`INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','tenant-menokin',$1,$2,repeat('b',64),true,'owner')`, [id, userId]);
      await admin.query(`INSERT INTO content_intake.principals VALUES ($1,$2,'tenant-menokin','app-customer-agent','confirmed-synthetic',$1,1,0)`, [id, userId]);
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ($1,1,ARRAY['dept-a'],'job-director',true,
        statement_timestamp()-interval '1 second', statement_timestamp()+interval '299 seconds', repeat('b',64))`, [id]);
    }
    await admin.query('COMMIT');
  }, 60_000);
  afterEach(async () => {
    await admin?.end();
    harness?.stop();
  }, 60_000);

  it('inserts one live parent, refuses intake_business and the disposable owner, and leaves facts unchanged', async () => {
    const before = (await admin.query<{ valid_until: string; facts_version: string }>(`
      SELECT facts_version::text, valid_until::text FROM content_intake.principal_facts ORDER BY principal_id`)).rows;
    const input = {
      recipientId: 'publisher', scopeId: 'scope-menokin-product', sourceId: null, action: 'publish' as const,
      reason: '发布根资格', startsAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const created = await bootstrapRootAllocation(transaction(admin), input);
    expect(created.created).toBe(true);
    const again = await bootstrapRootAllocation(transaction(admin), input);
    expect(again).toEqual({ grantId: created.grantId, created: false });
    const rows = (await admin.query<{ kind: string; issuer_id: string; recipient_id: string; parent_grant_id: string | null; user_id: string }>(`
      SELECT g.kind, g.issuer_id, g.recipient_id, g.parent_grant_id, p.user_id
      FROM content_intake.grants g JOIN content_intake.principals p ON p.principal_id=g.recipient_id
      WHERE g.revoked_at IS NULL`)).rows;
    expect(rows).toEqual([{
      kind: 'allocation', issuer_id: 'publisher', recipient_id: 'publisher', parent_grant_id: null, user_id: 'user-publisher',
    }]);

    await admin.query('SET ROLE intake_business');
    await expect(bootstrapRootAllocation(transaction(admin), { ...input, action: 'import' })).rejects.toMatchObject({
      reason: 'GRANT_AUTHORITY_DENIED', code: 'FORBIDDEN',
    });
    await admin.query('RESET ROLE');
    await expect(bootstrapRootAllocation(transaction(admin), { ...input, recipientId: 'synthetic-owner' })).rejects.toBeInstanceOf(IntakeRejection);
    await expect(bootstrapRootAllocation(transaction(admin), { ...input, recipientId: 'synthetic-owner' })).rejects.toMatchObject({
      reason: 'SCOPE_DENIED', code: 'FORBIDDEN',
    });

    const after = (await admin.query<{ valid_until: string; facts_version: string }>(`
      SELECT facts_version::text, valid_until::text FROM content_intake.principal_facts ORDER BY principal_id`)).rows;
    expect(after).toEqual(before);
    expect((await admin.query(`SELECT count(*) FROM content_intake.grants WHERE revoked_at IS NULL AND kind='allocation'`)).rows[0]).toEqual({ count: '1' });
    expect((await admin.query(`SELECT count(*) FROM content_intake.grants WHERE recipient_id='synthetic-owner'`)).rows[0]).toEqual({ count: '0' });
  });
});
