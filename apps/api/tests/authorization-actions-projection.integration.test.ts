import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { readAuthorizationActions } from '../src/project-roster-login.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

/** The historical batch chain admits only an owner binding. `/v1/auth/job` must not advertise
 *  import, publish or rollback to a granted seat, because the upload would answer 403.
 *  `query` stays grant-based: the candidate path still serves those seats. */
describe.skipIf(!enabled)('authorization actions projection', () => {
  let harness: Pg15Harness;
  let admin: Client;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    admin = await harness.connect(harness.createDatabase('action_projection').config);
    await applyDatabaseMigrations(admin);
    await admin.query('BEGIN');
    try {
      for (const [id, role] of [['issuer-seat', 'owner'], ['owner-seat', 'owner'], ['coach-seat', 'coach']] as const) {
        await admin.query(`INSERT INTO backend_identity.subject_bindings(
            binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
          VALUES ($1,'synthetic','t',$1,$2,repeat('a',64),true,$3)`, [id, `usr_${id}`, role]);
        await admin.query(`INSERT INTO content_intake.principals(
            principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
          VALUES ($1,$2,'t','a','p',$1,1)`, [id, `usr_${id}`]);
        await admin.query(`INSERT INTO content_intake.principal_facts(
            principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
          VALUES ($1,1,ARRAY['d'],'j',true,statement_timestamp()-interval '1 second',
            statement_timestamp()+interval '299 seconds',repeat('c',64))`, [id]);
      }
      await admin.query(`INSERT INTO content_intake.policy_versions(tenant_id,app_id,version) VALUES ('t','a',1)`);
      await admin.query(`INSERT INTO content_intake.role_rules(tenant_id,app_id,department_id,job_id,policy_version,role)
        VALUES ('t','a','d','j',1,'director')`);
      await admin.query(`INSERT INTO content_intake.scopes(scope_id,tenant_id,app_id,brand_id,domain)
        VALUES ('s','t','a','b','product')`);
      await admin.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
        VALUES ('src','s',1,'v2-preview')`);
      await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest)
        VALUES ('src',1,'faq-p1.1','intake-p1.1','faq-map',repeat('d',64))`);
      // Directly issued import grants: no parent, which the table allows for import and the
      // authorization predicate admits without a steward. A business grant cannot be
      // self-issued, so one issuer seat signs both.
      for (const seat of ['owner-seat', 'coach-seat']) {
        await admin.query(`INSERT INTO content_intake.grants(
            grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
            starts_at,expires_at,reason)
          VALUES ($1,'business','issuer-seat',$2,'t','a','s','src','import',
            clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','p')`,
        [`grant-import-${seat}`, seat]);
      }
      await admin.query('COMMIT');
    } catch (error) { await admin.query('ROLLBACK'); throw error; }
  }, 120_000);

  afterAll(async () => { await admin?.end(); harness?.stop(); }, 60_000);

  it('withholds import from a granted coach and grants it to an owner', async () => {
    const owner = await readAuthorizationActions(admin, 'usr_owner-seat');
    const coach = await readAuthorizationActions(admin, 'usr_coach-seat');
    // Both seats hold the same grant; only the binding role differs.
    expect({ owner: owner.import, coach: coach.import }).toEqual({ owner: true, coach: false });
  });
});
