import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { forgetJobSnapshot, rememberJobSnapshot } from '../src/feishu-job-snapshot.js';
import { projectRosterLogin, rosterPrincipalId } from '../src/project-roster-login.js';
import { publishLineage, seedLibrary } from './support/roster-library.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const seat = 'ou_rosterseat01';

function remember(title = '客服坐席') {
  rememberJobSnapshot(seat, {
    title,
    directory: [{ name: title, enabled: true }],
    departmentIds: ['dept-a'],
  });
}

async function ensureStoreSet(client: Client): Promise<void> {
  await client.query(`INSERT INTO content_intake.store_sets(
    tenant_id,app_id,version,approved_at,provenance)
    VALUES ('tenant-a','app-a',1,clock_timestamp(),'manual-roster-test')
    ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO content_intake.store_set_current(tenant_id,app_id,version)
    VALUES ('tenant-a','app-a',1)
    ON CONFLICT (tenant_id,app_id) DO UPDATE SET version=EXCLUDED.version`);
  await client.query(`INSERT INTO content_intake.store_set_members(
    tenant_id,app_id,version,scope_id,source_id,content_valid_until)
    VALUES ('tenant-a','app-a',1,'scope-a','source-a',clock_timestamp()+interval '1 day')
    ON CONFLICT DO NOTHING`);
}

async function login(client: Client) {
  await client.query('SET ROLE intake_business');
  const status = await projectRosterLogin(client, seat);
  await client.query('RESET ROLE');
  return status;
}

async function deadline(client: Client) {
  return (await client.query<{ until: Date | null }>(
    `SELECT content_intake.authorization_deadline(
      $1,'query','scope-a','source-a',clock_timestamp()) AS until`,
    [rosterPrincipalId(seat)],
  )).rows[0]?.until ?? null;
}

describe.skipIf(!enabled)('manual roster authority', () => {
  let harness: Pg15Harness;
  beforeEach(() => {
    harness = new Pg15Harness();
    harness.start();
  }, 120_000);
  afterEach(() => {
    forgetJobSnapshot(seat);
    harness.stop();
  }, 60_000);

  it('registers a matched Feishu identity with fresh facts but no business grant', async () => {
    const client = await harness.connect(harness.createDatabase('roster_no_auto').config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      await ensureStoreSet(client);
      remember();

      await expect(login(client)).resolves.toBe('registered');
      expect((await client.query(
        `SELECT 1 FROM content_intake.grants
         WHERE recipient_id=$1 AND kind='business'`,
        [rosterPrincipalId(seat)],
      )).rowCount).toBe(0);
      expect(await deadline(client)).toBeNull();
      expect((await client.query(
        `SELECT 1 FROM content_intake.principals person
         JOIN content_intake.principal_facts facts
           ON facts.principal_id=person.principal_id
          AND facts.facts_version=person.current_facts_version
         WHERE person.principal_id=$1 AND facts.enabled`,
        [rosterPrincipalId(seat)],
      )).rowCount).toBe(1);
    } finally {
      await client.end();
    }
  }, 60_000);

  it('keeps a human query grant revocable and never recreates it on re-login', async () => {
    const client = await harness.connect(harness.createDatabase('roster_revoke').config);
    try {
      await seedLibrary(client, true);
      await publishLineage(client);
      await ensureStoreSet(client);
      remember();
      await expect(login(client)).resolves.toBe('registered');
      expect((await client.query(
        `SELECT recipient_id,scope_id,source_id,action,kind,
                revoked_at,starts_at,expires_at
         FROM content_intake.grants WHERE grant_id='root-query'`,
      )).rows[0]).toMatchObject({
        recipient_id: 'director',
        scope_id: 'scope-a',
        source_id: null,
        action: 'query',
        kind: 'allocation',
        revoked_at: null,
      });
      const inserted = await client.query(`INSERT INTO content_intake.grants(
        grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
        starts_at,expires_at,reason,parent_grant_id,steward_id,policy_version,store_set_version)
        SELECT 'grant-human-query','business',parent.recipient_id,$1,parent.tenant_id,parent.app_id,
          parent.scope_id,'source-a',parent.action,parent.starts_at,parent.expires_at-interval '1 second',
          '人工查询。',parent.grant_id,parent.recipient_id,policy.version,current_set.version
        FROM content_intake.grants parent
        JOIN content_intake.policy_versions policy
          ON policy.tenant_id=parent.tenant_id AND policy.app_id=parent.app_id
        JOIN content_intake.store_set_current current_set
          ON current_set.tenant_id=parent.tenant_id AND current_set.app_id=parent.app_id
        WHERE parent.grant_id='root-query'`,
      [rosterPrincipalId(seat)]);
      expect(inserted.rowCount, 'manual grant must exist').toBe(1);
      const diagnostic = await client.query<{
        action: string; scope_id: string; source_id: string | null;
        grant_policy: string | null; current_policy: string; grant_store: string | null; current_store: string;
      }>(`SELECT g.action,g.scope_id,g.source_id,g.policy_version::text AS grant_policy,
          policy.version::text AS current_policy,g.store_set_version::text AS grant_store,
          current_set.version::text AS current_store
        FROM content_intake.grants g
        JOIN content_intake.policy_versions policy
          ON policy.tenant_id=g.tenant_id AND policy.app_id=g.app_id
        JOIN content_intake.store_set_current current_set
          ON current_set.tenant_id=g.tenant_id AND current_set.app_id=g.app_id
        WHERE g.grant_id='grant-human-query'`);
      expect(diagnostic.rows).toEqual([{
        action: 'query',
        scope_id: 'scope-a',
        source_id: 'source-a',
        grant_policy: expect.any(String),
        current_policy: expect.any(String),
        grant_store: '1',
        current_store: '1',
      }]);
      expect(diagnostic.rows[0]?.grant_policy).toBe(diagnostic.rows[0]?.current_policy);
      expect((await client.query<{ n: string }>(
        `SELECT count(*)::text AS n
         FROM content_intake.store_set_members
         WHERE tenant_id='tenant-a' AND app_id='app-a' AND version=1
           AND scope_id='scope-a' AND source_id='source-a'
           AND content_valid_until>clock_timestamp()`,
      )).rows[0]?.n).toBe('1');
      expect((await client.query(`SELECT facts.enabled,
          facts.checked_at<=clock_timestamp() AS checked_ok,
          clock_timestamp()<facts.valid_until AS valid_ok,
          facts.job_id, facts.department_ids,
          (SELECT array_agg(role.role ORDER BY role.role)
             FROM content_intake.role_rules role
            WHERE role.tenant_id=person.tenant_id AND role.app_id=person.app_id
              AND role.department_id=ANY(facts.department_ids) AND role.job_id=facts.job_id) AS roles,
          parent.revoked_at IS NULL AS parent_live,
          parent.starts_at<=grant_row.starts_at AS start_ok,
          parent.expires_at>=grant_row.expires_at AS expiry_ok,
          (parent.source_id IS NULL OR parent.source_id=grant_row.source_id) AS source_ok
        FROM content_intake.principals person
        JOIN content_intake.principal_facts facts
          ON facts.principal_id=person.principal_id AND facts.facts_version=person.current_facts_version
        JOIN content_intake.grants grant_row ON grant_row.recipient_id=person.principal_id
        JOIN content_intake.grants parent ON parent.grant_id=grant_row.parent_grant_id
        WHERE grant_row.grant_id='grant-human-query'`)).rows[0]).toMatchObject({
          enabled: true,
          checked_ok: true,
          valid_ok: true,
          roles: ['agent'],
          parent_live: true,
          start_ok: true,
          expiry_ok: true,
          source_ok: true,
        });
      expect((await client.query(`SELECT
          grant_row.kind='business' AS kind_ok,
          grant_row.action='query' AS action_ok,
          grant_row.revoked_at IS NULL AS grant_live,
          grant_row.starts_at<=clock_timestamp() AS grant_started,
          clock_timestamp()<grant_row.expires_at AS grant_not_expired,
          (SELECT count(*) FROM content_intake.store_set_members member
            WHERE member.tenant_id=grant_row.tenant_id
              AND member.app_id=grant_row.app_id
              AND member.version=grant_row.store_set_version
              AND member.scope_id=grant_row.scope_id
              AND member.source_id=grant_row.source_id) AS member_count
        FROM content_intake.grants grant_row
        WHERE grant_row.grant_id='grant-human-query'`)).rows[0]).toMatchObject({
          kind_ok: true,
          action_ok: true,
          grant_live: true,
          grant_started: true,
          grant_not_expired: true,
          member_count: '1',
        });
      expect((await client.query<{ scope_id: string; source_id: string; valid_until: Date }>(
        `SELECT scope_id,source_id,valid_until
         FROM content_intake.authorization_sources($1,'query',clock_timestamp())`,
        [rosterPrincipalId(seat)],
      )).rows).not.toEqual([]);
      expect(await deadline(client)).not.toBeNull();

      await client.query(`UPDATE content_intake.grants
        SET version=version+1,last_change_reason='人工撤销。',revoked_at=clock_timestamp()
        WHERE grant_id='grant-human-query'`);
      await expect(login(client)).resolves.toBe('registered');
      expect(await deadline(client)).toBeNull();
      expect((await client.query<{ revoked: boolean }>(
        `SELECT revoked_at IS NOT NULL AS revoked
         FROM content_intake.grants WHERE grant_id='grant-human-query'`,
      )).rows).toEqual([{ revoked: true }]);
    } finally {
      await client.end();
    }
  }, 60_000);

  it('fail-closes an explicitly departed identity and still does not create a grant', async () => {
    const client = await harness.connect(harness.createDatabase('roster_departed').config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      rememberJobSnapshot(seat, {
        title: '客服坐席',
        directory: [{ name: '客服坐席', enabled: false }],
        departmentIds: ['dept-a'],
        departed: true,
      });
      await expect(login(client)).resolves.toBe('unmatched');
      expect((await client.query(
        `SELECT 1 FROM content_intake.grants
         WHERE recipient_id=$1 AND kind='business' AND revoked_at IS NULL`,
        [rosterPrincipalId(seat)],
      )).rowCount).toBe(0);
    } finally {
      await client.end();
    }
  }, 60_000);
});
