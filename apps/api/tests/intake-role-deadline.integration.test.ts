import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const actions = ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'] as const;

describe.skipIf(!enabled)('authorization_deadline requires an active business grant', () => {
  let harness: Pg15Harness;
  let admin: Client;
  beforeEach(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('role_defaults');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await admin.query('BEGIN');
    await admin.query(`INSERT INTO content_intake.policy_versions(tenant_id, app_id, version)
      VALUES ('tenant-menokin','app-customer-agent',1) ON CONFLICT DO NOTHING`);
    const posts = [
      ['director', 'job-director', 'director'],
      ['manager', 'job-manager', 'manager'],
      ['supervisor', 'job-supervisor', 'supervisor'],
      ['engineer', 'job-engineer', 'engineer'],
      ['agent', 'job-agent', 'agent'],
    ] as const;
    for (const [id, job, role] of posts) {
      await admin.query(`INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','tenant-menokin',$1,$2,repeat('c',64),true,'owner')`, [id, `user-${id}`]);
      await admin.query(`INSERT INTO content_intake.principals(principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version,revocation_generation)
        VALUES ($1,$2,'tenant-menokin','app-customer-agent','confirmed-synthetic',$1,1,0)`, [id, `user-${id}`]);
      await admin.query(`INSERT INTO content_intake.principal_facts(principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
        VALUES ($1,1,ARRAY['dept-a'],$2,true,statement_timestamp()-interval '1 second',statement_timestamp()+interval '299 seconds',repeat('c',64))`, [id, job]);
      await admin.query(`INSERT INTO content_intake.role_rules(tenant_id,app_id,department_id,job_id,policy_version,role)
        VALUES ('tenant-menokin','app-customer-agent','dept-a',$1,1,$2)`, [job, role]);
    }
    await admin.query('COMMIT');
  }, 120_000);
  afterEach(async () => {
    await admin?.end();
    harness?.stop();
  }, 60_000);

  it('returns no deadline when role rules exist but no business grant is active', async () => {
    const grants = await admin.query(`SELECT count(*)::int AS count FROM content_intake.grants WHERE kind='business'`);
    expect(grants.rows[0]?.count).toBe(0);
    const deadline = async (principal: string, action: string) => (await admin.query<{ until: Date | null }>(
      `SELECT content_intake.authorization_deadline($1,$2,'scope-menokin-product','src-menokin-faq',clock_timestamp()) AS until`,
      [principal, action])).rows[0]?.until ?? null;
    for (const principal of ['director', 'manager', 'supervisor', 'engineer', 'agent']) {
      for (const action of actions) expect(await deadline(principal, action)).toBeNull();
    }
  });
});
