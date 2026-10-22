import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '../src/runner.js';
import { Pg15Harness } from '../src/testkit/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readOverlay = (name: string) => readFileSync(path.join(packageRoot, 'overlays', name), 'utf8');
const readMigration = (name: string) => readFileSync(path.join(packageRoot, 'migrations', name), 'utf8');

describe('roster permission authority boundary', () => {
  it('keeps the applied 0044 bytes free of the system signer', () => {
    const sql = readOverlay('0044_intake_role_defaults.sql');
    expect(sql).not.toContain('content-intake-system');
    expect(sql).not.toContain('query-signer');
  });

  it('requires a business grant and drops the role-only allow', () => {
    const sql = readOverlay('0047_roster_query_signer.sql');
    const authority = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION content_intake.authorization_deadline'));
    expect(authority).toContain("g.kind='business'");
    expect(authority).toContain('least(f.valid_until, max(g.expires_at))');
    expect(authority).not.toContain('COALESCE(');
  });

  it('allows only the synthetic query signer to issue parentless query grants', () => {
    const sql = readOverlay('0047_roster_query_signer.sql');
    const guard = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION content_intake.grant_parent_guard'));
    expect(guard).toContain("NEW.kind = 'business' AND NEW.action = 'query'");
    expect(guard).toContain("signer.identity_scope = 'content-intake-system'");
    expect(guard).toContain("signer.person_key = 'query-signer'");
  });

  it('keeps login from writing role rules or grants', () => {
    const sql = readOverlay('0046_project_feishu_roster.sql');
    expect(sql).toContain("RETURN 'policy-pending'");
    expect(sql).toContain('FROM content_intake.role_rules');
    expect(sql).not.toContain('INSERT INTO content_intake.role_rules');
    expect(sql).not.toContain('INSERT INTO content_intake.grants');
    expect(sql).toContain("IS DISTINCT FROM ARRAY['query']");
  });

  it('issues query only from the system signer', () => {
    const sql = readOverlay('0047_roster_query_signer.sql');
    const issue = sql.slice(sql.indexOf('CREATE FUNCTION content_intake.issue_roster_query'));
    expect(issue).toContain("'职位名单系统签发。'");
    expect(issue).toContain('content_intake.release_lineage');
    expect(issue).not.toContain('live_grant.issuer_id = v_signer');
    expect(issue).not.toContain("'publish'");
    expect(issue).not.toContain("'import'");
    expect(issue).not.toContain('kind IN (\'allocation\'');
  });

  it('binds query grants to the current policy version and store set', () => {
    const sql = readOverlay('0048_roster_store_set.sql');
    expect(sql).toContain('content_intake.store_set_members');
    expect(sql).toContain('g.policy_version');
    expect(sql).toContain('g.store_set_version');
    expect(sql).toContain("p_action='query' AND g.source_id=p_source");
    expect(sql).not.toContain('0033_intake_runtime');
    expect(sql).not.toContain('0044_intake_role_defaults');
  });

  it('records the job, the store provenance, and a read-only day-one report', () => {
    const sql = readOverlay('0049_roster_lifecycle.sql');
    expect(sql).toContain('roster_job_id');
    expect(sql).toContain('provenance');
    expect(sql).toContain('content_intake.withdraw_roster_query');
    expect(sql).toContain('content_intake.roster_day_one');
    expect(sql).toContain('live_grant.issuer_id = v_signer');
    expect(sql).toContain('current_facts_version + 1');
    expect(sql).toContain('content_intake.roster_permission_for_user');
    expect(sql).toContain('person.user_id = p_user_id');
    expect(sql).toContain('p_department_ids, p_job_id, false');
    expect(sql).toContain('count(DISTINCT rule.role) = 1');
    expect(sql).toContain('(SELECT count(*) FROM written_members) >= 0');
    expect(sql).toContain('member.source_id = live_grant.source_id');
    expect(sql).toContain('existing.user_id = v_user');
    expect(sql).not.toContain('0033_intake_runtime');
    expect(sql).not.toContain('0044_intake_role_defaults');
  });

  it('keeps generated 0047, 0048, and 0049 migrations equal to their overlays', () => {
    for (const name of ['0047_roster_query_signer.sql', '0048_roster_store_set.sql', '0049_roster_lifecycle.sql']) {
      expect(readMigration(name)).toContain(readOverlay(name).trim());
    }
  });

  it('keeps the 0049 body and the 0047 execute grant on intake_business only', () => {
    const replaced = readOverlay('0049_roster_lifecycle.sql');
    expect(replaced).toContain('CREATE OR REPLACE FUNCTION content_intake.issue_roster_query');
    expect(replaced).not.toContain('GRANT EXECUTE ON FUNCTION content_intake.issue_roster_query');
    const signer = readOverlay('0047_roster_query_signer.sql');
    const grants = signer.split('\n').filter(line => line.includes('GRANT EXECUTE ON FUNCTION content_intake.issue_roster_query'));
    expect(grants).toEqual(['GRANT EXECUTE ON FUNCTION content_intake.issue_roster_query(TEXT, TEXT, TEXT) TO intake_business;']);
  });
});

describe.runIf(process.env.CUSTOMER_AGENT_DB_PG15_INTEGRATION === '1')('database role split on PostgreSQL 15', () => {
  let harness: Pg15Harness;
  let client: Client;
  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    client = await harness.connect(harness.createDatabase('role_split').config);
    await applyDatabaseMigrations(client);
  }, 120_000);
  afterAll(async () => {
    await client?.end();
    harness?.stop();
  }, 60_000);

  it('denies the crossed execute privileges', async () => {
    const shared = await client.query<{ rolname: string }>(`
      SELECT login.rolname
      FROM pg_catalog.pg_roles login
      WHERE login.rolcanlogin
        AND NOT login.rolsuper
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_auth_members grant_row
          WHERE grant_row.member = login.oid
            AND grant_row.roleid = 'app_runtime'::pg_catalog.regrole
        )
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_auth_members grant_row
          WHERE grant_row.member = login.oid
            AND grant_row.roleid = 'intake_business'::pg_catalog.regrole
        )
      ORDER BY login.rolname`);
    expect(shared.rows).toEqual([]);
    const privileges = await client.query<{
      runtime_issue: boolean; business_search: boolean; runtime_search: boolean; business_issue: boolean;
      public_issue: boolean; public_search: boolean; search_owner: string;
    }>(`
      SELECT
        pg_catalog.has_function_privilege('app_runtime', 'content_intake.issue_roster_query(text,text,text)', 'EXECUTE') AS runtime_issue,
        pg_catalog.has_function_privilege('intake_business', 'public.search_recommendable_scripts(text,text,text,text)', 'EXECUTE') AS business_search,
        pg_catalog.has_function_privilege('app_runtime', 'public.search_recommendable_scripts(text,text,text,text)', 'EXECUTE') AS runtime_search,
        pg_catalog.has_function_privilege('intake_business', 'content_intake.issue_roster_query(text,text,text)', 'EXECUTE') AS business_issue,
        pg_catalog.has_function_privilege('public', 'content_intake.issue_roster_query(text,text,text)', 'EXECUTE') AS public_issue,
        pg_catalog.has_function_privilege('public', 'public.search_recommendable_scripts(text,text,text,text)', 'EXECUTE') AS public_search,
        pg_catalog.pg_get_userbyid(p.proowner) AS search_owner
      FROM pg_catalog.pg_proc p
      WHERE p.oid = 'public.search_recommendable_scripts(text,text,text,text)'::pg_catalog.regprocedure`);
    expect(privileges.rows[0]).toEqual({
      runtime_issue: false,
      business_search: false,
      runtime_search: true,
      business_issue: true,
      public_issue: false,
      public_search: false,
      search_owner: 'cs_ai_definer',
    });
  });
});
