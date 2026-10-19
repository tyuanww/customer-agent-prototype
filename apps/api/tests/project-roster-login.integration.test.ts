import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { forgetJobSnapshot, rememberJobSnapshot } from '../src/feishu-job-snapshot.js';
import { feishuUserId } from '../src/feishu-admit.js';
import { projectRosterLogin, rosterPrincipalId } from '../src/project-roster-login.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const seat = 'ou_rosterseat01';
const director = 'ou_rosterdirector1';

function remember(openId: string, title: string) {
  rememberJobSnapshot(openId, { title, directory: [{ name: title, enabled: true }], departmentIds: ['dept-a'] });
}

async function seedLibrary(client: Client, liveAllocation = true) {
  await applyDatabaseMigrations(client);
  await client.query('BEGIN');
  try {
  await client.query(`INSERT INTO backend_identity.subject_bindings
    (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
    VALUES ('director','synthetic','tenant-a','director','user-director',repeat('ab',32),true,'owner')`);
  await client.query(`INSERT INTO content_intake.principals
    VALUES ('director','user-director','tenant-a','app-a','confirmed-synthetic','director',1,0)`);
  await client.query(`INSERT INTO content_intake.principal_facts
    VALUES ('director',1,ARRAY['dept-a'],'job-director',true,
      statement_timestamp()-interval '1 second', statement_timestamp()+interval '4 minutes', repeat('a',64))`);
  await client.query(`INSERT INTO content_intake.role_rules
    VALUES
      ('tenant-a','app-a','dept-a','job-customer-service-director',1,'director'),
      ('tenant-a','app-a','dept-a','job-customer-service-seat',1,'agent')`);
  await client.query(`INSERT INTO content_intake.scopes
    VALUES ('scope-a','tenant-a','app-a','brand-a','shop-a','product')`);
  await client.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
    VALUES ('source-a','scope-a',1,'v2-preview')`);
  await client.query(`INSERT INTO content_intake.source_mappings
    VALUES ('source-a',1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))`);
  for (const action of ['query', 'publish', 'import']) {
    await client.query(`INSERT INTO content_intake.grants(
      grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ($1,'allocation','director','director','tenant-a','app-a','scope-a',$2,
        clock_timestamp()-interval '1 hour', clock_timestamp() + $3::interval,'合成根资格','director')`,
    [`root-${action}`, action, liveAllocation ? '1 day' : '-1 minute']);
  }
  for (const openId of [seat, director]) {
    await client.query(`INSERT INTO backend_identity.subject_bindings
      (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ($1,'feishu','feishu-tenant',$1,$2,repeat('cd',32),true,'agent')`,     [openId, feishuUserId(openId)]);
  }
  await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe.skipIf(!enabled)('roster projection writes one principal and only content-backed query grants', () => {
  let harness: Pg15Harness;
  beforeEach(() => { harness = new Pg15Harness(); harness.start(); }, 120_000);
  afterEach(() => {
    forgetJobSnapshot(seat);
    forgetJobSnapshot(director);
    harness.stop();
  });

  it('lets intake_business project a seat and a director from the same library', async () => {
    const database = harness.createDatabase('roster_project');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client);
      await client.query('SET ROLE intake_business');
      await expect(client.query(`INSERT INTO content_intake.principals
        VALUES ('blocked','user-blocked','tenant-a','app-a','feishu-job-roster','ou_blocked1',1,0)`)).rejects.toMatchObject({ code: '42501' });
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      remember(director, '客服总监');
      await expect(projectRosterLogin(client, director)).resolves.toBe('registered');
      await expect(projectRosterLogin(client, director)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      const people = await client.query<{ principal_id: string; job_id: string; version: string }>(`
        SELECT p.principal_id, f.job_id, p.current_facts_version::text AS version
        FROM content_intake.principals p
        JOIN content_intake.principal_facts f
          ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
        WHERE p.principal_id = ANY($1::text[])
        ORDER BY p.principal_id`, [[rosterPrincipalId(seat), rosterPrincipalId(director)]]);
      const byId = new Map(people.rows.map(row => [row.principal_id, row]));
      expect(byId.get(rosterPrincipalId(seat))).toEqual({
        principal_id: rosterPrincipalId(seat), job_id: 'job-customer-service-seat', version: '1',
      });
      expect(byId.get(rosterPrincipalId(director))).toEqual({
        principal_id: rosterPrincipalId(director), job_id: 'job-customer-service-director', version: '2',
      });
      const grants = await client.query<{ recipient_id: string; action: string }>(`
        SELECT recipient_id, action FROM content_intake.grants
        WHERE recipient_id = ANY($1::text[]) AND kind='business'
        ORDER BY recipient_id, action`, [[rosterPrincipalId(seat), rosterPrincipalId(director)]]);
      expect(grants.rows).toEqual([]);
      await client.query('SET ROLE intake_business');
      remember(director, '客服坐席');
      await expect(projectRosterLogin(client, director)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      const afterDemotion = await client.query<{ action: string; revoked: boolean }>(`
        SELECT action, revoked_at IS NOT NULL AS revoked FROM content_intake.grants
        WHERE recipient_id = $1 AND kind = 'business' ORDER BY action`, [rosterPrincipalId(director)]);
      expect(afterDemotion.rows).toEqual([]);
      const homes = await client.query<{ tenant_id: string; app_id: string }>(
        'SELECT DISTINCT tenant_id, app_id FROM content_intake.principals');
      expect(homes.rows).toEqual([{ tenant_id: 'tenant-a', app_id: 'app-a' }]);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }, 60_000);

  it('does not register an unknown title or a title with no role rule', async () => {
    const database = harness.createDatabase('roster_unknown');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client);
      await client.query('SET ROLE intake_business');
      remember(seat, '服务赋能师');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('unmatched');
      await client.query('RESET ROLE');
      await client.query(`DELETE FROM content_intake.role_rules WHERE job_id = 'job-customer-service-seat'`);
      await client.query('SET ROLE intake_business');
      forgetJobSnapshot(seat);
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('policy-pending');
      await client.query('RESET ROLE');
      const people = await client.query(`SELECT count(*)::int AS count FROM content_intake.principals WHERE principal_id = $1`, [rosterPrincipalId(seat)]);
      expect(people.rows[0]?.count).toBe(0);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }, 60_000);

  it('opens query only while a system-issued grant is live', async () => {
    const database = harness.createDatabase('roster_deadline');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      const deadline = async (action: string) => (await client.query<{ until: Date | null }>(
        `SELECT content_intake.authorization_deadline($1,$2,'scope-a','source-a',clock_timestamp()) AS until`,
        [rosterPrincipalId(seat), action])).rows[0]?.until ?? null;
      expect(await deadline('query')).toBeNull();
      expect(await deadline('publish')).toBeNull();
      await client.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,parent_grant_id)
        SELECT 'grant-system-query','business',principal_id,$1,'tenant-a','app-a','scope-a','source-a','query',
          clock_timestamp()-interval '1 minute', clock_timestamp()+interval '1 day','职位名单系统签发。',NULL
        FROM content_intake.principals
        WHERE identity_scope = 'content-intake-system' AND person_key = 'query-signer' AND tenant_id = 'tenant-a'`,
      [rosterPrincipalId(seat)]);
      const issued = await client.query<{ issuer_scope: string; parent_grant_id: string | null; action: string }>(`
        SELECT p.identity_scope AS issuer_scope, g.parent_grant_id, g.action
        FROM content_intake.grants g
        JOIN content_intake.principals p ON p.principal_id = g.issuer_id
        WHERE g.grant_id = 'grant-system-query'`);
      expect(issued.rows).toEqual([{ issuer_scope: 'content-intake-system', parent_grant_id: null, action: 'query' }]);
      expect(await deadline('query')).not.toBeNull();
      expect(await deadline('publish')).toBeNull();
      await client.query(`UPDATE content_intake.grants
        SET version = version + 1, last_change_reason = '撤销。', revoked_at = clock_timestamp()
        WHERE grant_id = 'grant-system-query'`);
      expect(await deadline('query')).toBeNull();
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }, 60_000);

  it('registers a matched title and writes no grant when every allocation is expired', async () => {
    const database = harness.createDatabase('roster_expired');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      const grants = await client.query(`SELECT 1 FROM content_intake.grants
        WHERE recipient_id = $1 AND kind = 'business'`, [rosterPrincipalId(seat)]);
      expect(grants.rowCount).toBe(0);
      const person = await client.query(`SELECT 1 FROM content_intake.principals WHERE principal_id = $1`, [rosterPrincipalId(seat)]);
      expect(person.rowCount).toBe(1);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }, 60_000);
});
