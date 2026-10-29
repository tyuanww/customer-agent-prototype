import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { forgetJobSnapshot, rememberJobSnapshot } from '../src/feishu-job-snapshot.js';
import { projectRosterLogin, composeRosterJob, readStoredRosterPermission, rosterPrincipalId } from '../src/project-roster-login.js';
import { ROSTER_PENDING_MESSAGE } from '@customer-agent/job-roster';
import { publishLineage, seedLibrary } from './support/roster-library.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const seat = 'ou_rosterseat01';
const director = 'ou_rosterdirector1';

function remember(openId: string, title: string) {
  rememberJobSnapshot(openId, { title, directory: [{ name: title, enabled: true }], departmentIds: ['dept-a'] });
}

describe.skipIf(!enabled)('roster projection registers identity without issuing grants', () => {
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

  it('registers without content and does not invent a query grant', async () => {
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
      // The seat is registered and eligible; what it lacks is content. The projection must
      // say that, because the denial sentence would send the operator to ask for a grant
      // that cannot help.
      const stored = await readStoredRosterPermission(client, `usr_${seat}`);
      expect(stored?.state).toBe('pending');
      const job = composeRosterJob(null, stored, true);
      expect(job?.permission_state).toBe('pending');
      expect(job?.message).toBe(ROSTER_PENDING_MESSAGE);
      expect((await client.query(
        `SELECT 1 FROM content_intake.grants WHERE recipient_id=$1 AND kind='business'`,
        [rosterPrincipalId(seat)],
      )).rowCount).toBe(0);
      expect(await deadline('query')).toBeNull();
      expect(await deadline('publish')).toBeNull();
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }, 60_000);

  it('keeps a matched login read-only until a human grants query', async () => {
    const database = harness.createDatabase('roster_lineage');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      const grants = await client.query<{ action: string; parent_grant_id: string | null; issuer_scope: string; policy_version: string; store_set_version: string }>(`
        SELECT g.action, g.parent_grant_id, p.identity_scope AS issuer_scope,
          g.policy_version::text AS policy_version, g.store_set_version::text AS store_set_version
        FROM content_intake.grants g
        JOIN content_intake.principals p ON p.principal_id = g.issuer_id
        WHERE g.recipient_id = $1 AND g.kind = 'business' AND g.revoked_at IS NULL
        ORDER BY g.action`, [rosterPrincipalId(seat)]);
      expect(grants.rows).toEqual([]);
      const until = await client.query<{ until: Date | null }>(
        `SELECT content_intake.authorization_deadline($1,'query','scope-a','source-a',clock_timestamp()) AS until`,
        [rosterPrincipalId(seat)]);
      expect(until.rows[0]?.until).toBeNull();
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }, 60_000);

  it('does not create or revive authority when published content changes', async () => {
    const database = harness.createDatabase('roster_remove');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.publishing','on',true)");
      const hash = (await client.query<{ source_binding_hash: string }>(
        "SELECT source_binding_hash FROM public.content_releases WHERE release_id='rel-roster'")).rows[0]!.source_binding_hash;
      await client.query(`INSERT INTO public.content_releases(release_id,release_seq,title,status,source_binding_hash,tenant_id)
        VALUES('rel-empty',2,'空发布','published',$1,'tenant-a')`, [hash]);
      await client.query(`INSERT INTO public.release_source_bindings(release_id,domain,source_version_id)
        SELECT 'rel-empty', domain, source_version_id FROM public.release_source_bindings WHERE release_id='rel-roster'`);
      await client.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES('rel-empty','intake-v2.1')");
      await client.query("UPDATE public.content_current SET current_release_id='rel-empty', updated_at=clock_timestamp() WHERE id=1");
      await client.query('COMMIT');
      await client.query('SET ROLE intake_business');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      const live = await client.query(
        `SELECT 1 FROM content_intake.grants WHERE recipient_id=$1 AND kind='business' AND action='query' AND revoked_at IS NULL`,
        [rosterPrincipalId(seat)]);
      expect(live.rowCount).toBe(0);
      const until = await client.query<{ until: Date | null }>(
        `SELECT content_intake.authorization_deadline($1,'query','scope-a','source-a',clock_timestamp()) AS until`,
        [rosterPrincipalId(seat)]);
      expect(until.rows[0]?.until).toBeNull();
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }, 60_000);

  it('keeps a human query grant through later logins without adding another', async () => {
    const database = harness.createDatabase('roster_human');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, true);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      await client.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,parent_grant_id)
        VALUES ('grant-human-query','business','director',$1,'tenant-a','app-a','scope-a','source-a','query',
          clock_timestamp(), clock_timestamp()+interval '1 hour','人工查询。','root-query')`, [rosterPrincipalId(seat)]);
      await client.query('SET ROLE intake_business');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      await publishLineage(client);
      await client.query('SET ROLE intake_business');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      const grants = await client.query<{ parent_grant_id: string | null; issuer_scope: string }>(`
        SELECT g.parent_grant_id, p.identity_scope AS issuer_scope
        FROM content_intake.grants g
        JOIN content_intake.principals p ON p.principal_id = g.issuer_id
        WHERE g.recipient_id = $1 AND g.kind = 'business' AND g.action = 'query' AND g.revoked_at IS NULL
        ORDER BY g.parent_grant_id NULLS LAST`, [rosterPrincipalId(seat)]);
      expect(grants.rows).toEqual([
        { parent_grant_id: 'root-query', issuer_scope: 'confirmed-synthetic' },
      ]);
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
