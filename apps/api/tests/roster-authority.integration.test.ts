import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { feishuUserId } from '../src/feishu-admit.js';
import { forgetJobSnapshot, rememberJobSnapshot } from '../src/feishu-job-snapshot.js';
import { projectRosterLogin, readStoredRosterPermission, rosterPrincipalId } from '../src/project-roster-login.js';
import { JOB_ROSTER } from '@customer-agent/job-roster';
import { publishLineage, seedLibrary } from './support/roster-library.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const seat = 'ou_rosterseat01';

function remember() {
  rememberJobSnapshot(seat, { title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }], departmentIds: ['dept-a'] });
}

async function login(client: Client) {
  await client.query('SET ROLE intake_business');
  const status = await projectRosterLogin(client, seat);
  await client.query('RESET ROLE');
  return status;
}

describe.skipIf(!enabled)('roster authority stays one current query grant', () => {
  let harness: Pg15Harness;
  beforeEach(() => { harness = new Pg15Harness(); harness.start(); }, 120_000);
  afterEach(() => { forgetJobSnapshot(seat); harness.stop(); }, 60_000);

  it('records the issuer, reason, and source on the grant history row', async () => {
    const database = harness.createDatabase('roster_audit');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      remember();
      await expect(login(client)).resolves.toBe('projected');
      const history = await client.query<{ reason: string; source_id: string; issuer_scope: string }>(`
        SELECT h.record->>'reason' AS reason, h.record->>'source_id' AS source_id, p.identity_scope AS issuer_scope
        FROM content_intake.grant_history h
        JOIN content_intake.principals p ON p.principal_id = h.record->>'issuer_id'
        WHERE h.record->>'recipient_id' = $1 AND h.version = 1`, [rosterPrincipalId(seat)]);
      expect(history.rows).toEqual([{
        reason: '职位名单系统签发。', source_id: 'source-a', issuer_scope: 'content-intake-system',
      }]);
    } finally { await client.end(); }
  }, 60_000);

  it('does not move the expiry of a live query grant when facts are refreshed', async () => {
    const database = harness.createDatabase('roster_facts');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      remember();
      await expect(login(client)).resolves.toBe('projected');
      const first = await client.query<{ grant_id: string; expires_at: Date }>(
        `SELECT grant_id, expires_at FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND revoked_at IS NULL`, [rosterPrincipalId(seat)]);
      await expect(login(client)).resolves.toBe('projected');
      const second = await client.query<{ grant_id: string; expires_at: Date }>(
        `SELECT grant_id, expires_at FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND revoked_at IS NULL`, [rosterPrincipalId(seat)]);
      expect(second.rows).toEqual(first.rows);
    } finally { await client.end(); }
  }, 60_000);

  it('keeps an expired system query grant expired when the source is not current', async () => {
    const database = harness.createDatabase('roster_expired_grant');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      remember();
      await expect(login(client)).resolves.toBe('registered');
      await client.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,parent_grant_id,policy_version,store_set_version)
        SELECT 'grant-old-query','business',signer.principal_id,$1,'tenant-a','app-a','scope-a','source-a','query',
          clock_timestamp()-interval '1 hour', clock_timestamp()-interval '1 minute','职位名单系统签发。',NULL,
          pol.version, cur.version
        FROM content_intake.principals signer
        JOIN content_intake.policy_versions pol ON pol.tenant_id = signer.tenant_id AND pol.app_id = signer.app_id
        JOIN content_intake.store_set_current cur ON cur.tenant_id = signer.tenant_id AND cur.app_id = signer.app_id
        WHERE signer.identity_scope = 'content-intake-system' AND signer.person_key = 'query-signer'`, [rosterPrincipalId(seat)]);
      await expect(login(client)).resolves.toBe('expired');
      const before = await client.query<{ expires_at: Date; revoked: boolean; version: string }>(
        `SELECT expires_at, revoked_at IS NOT NULL AS revoked, version::text AS version
         FROM content_intake.grants WHERE grant_id = 'grant-old-query'`);
      await expect(login(client)).resolves.toBe('expired');
      const after = await client.query<{ expires_at: Date; revoked: boolean; version: string }>(
        `SELECT expires_at, revoked_at IS NOT NULL AS revoked, version::text AS version
         FROM content_intake.grants WHERE grant_id = 'grant-old-query'`);
      expect(after.rows).toEqual(before.rows);
      expect(after.rows[0]?.revoked).toBe(false);
    } finally { await client.end(); }
  }, 60_000);

  it('leaves a revoked query grant revoked when the source is still current', async () => {
    const database = harness.createDatabase('roster_keep');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      remember();
      await expect(login(client)).resolves.toBe('projected');
      await client.query(`UPDATE content_intake.grants
        SET version = version + 1, last_change_reason = '撤销。', revoked_at = clock_timestamp()
        WHERE recipient_id = $1 AND kind = 'business' AND revoked_at IS NULL`, [rosterPrincipalId(seat)]);
      await expect(login(client)).resolves.toBe('revoked');
      await expect(login(client)).resolves.toBe('revoked');
      const revoked = await client.query<{ revoked: boolean }>(
        `SELECT revoked_at IS NOT NULL AS revoked FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND action = 'query'`, [rosterPrincipalId(seat)]);
      expect(revoked.rows).toEqual([{ revoked: true }]);
    } finally { await client.end(); }
  }, 60_000);

  it('keeps one live query grant when two logins overlap', async () => {
    const database = harness.createDatabase('roster_race');
    const first = await harness.connect(database.config);
    const second = await harness.connect(database.config);
    try {
      await seedLibrary(first, false);
      await publishLineage(first);
      remember();
      const statuses = await Promise.all([login(first), login(second)]);
      expect(statuses.every((status) => status === 'projected' || status === 'registered')).toBe(true);
      const live = await first.query(
        `SELECT count(*)::int AS count FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND action = 'query' AND revoked_at IS NULL`,
        [rosterPrincipalId(seat)]);
      expect(live.rows[0]?.count).toBe(1);
    } finally {
      await first.end();
      await second.end();
    }
  }, 60_000);

  it('revokes the old query grant when the job changes and issues a new one', async () => {
    const database = harness.createDatabase('roster_job_change');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      remember();
      await expect(login(client)).resolves.toBe('projected');
      const first = await client.query<{ grant_id: string }>(
        `SELECT grant_id FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND revoked_at IS NULL`, [rosterPrincipalId(seat)]);
      rememberJobSnapshot(seat, { title: '客服总监', directory: [{ name: '客服总监', enabled: true }], departmentIds: ['dept-a'] });
      await expect(login(client)).resolves.toBe('projected');
      const rows = await client.query<{ grant_id: string; revoked: boolean; job_id: string | null }>(
        `SELECT grant_id, revoked_at IS NOT NULL AS revoked, roster_job_id AS job_id
         FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND action = 'query'
         ORDER BY revoked_at NULLS FIRST, grant_id`, [rosterPrincipalId(seat)]);
      expect(rows.rows).toEqual([
        { grant_id: expect.any(String), revoked: false, job_id: 'job-customer-service-director' },
        { grant_id: first.rows[0]?.grant_id, revoked: true, job_id: 'job-customer-service-seat' },
      ]);
      expect(rows.rows[0]?.grant_id).not.toBe(first.rows[0]?.grant_id);
    } finally { await client.end(); }
  }, 60_000);

  it('revokes query access when the person leaves and does not revive that grant', async () => {
    const database = harness.createDatabase('roster_leave');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      remember();
      await expect(login(client)).resolves.toBe('projected');
      const original = await client.query<{ grant_id: string }>(
        `SELECT grant_id FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND revoked_at IS NULL`, [rosterPrincipalId(seat)]);
      rememberJobSnapshot(seat, { title: '客服坐席', directory: [{ name: '客服坐席', enabled: false }], departmentIds: ['dept-a'], departed: true });
      await expect(login(client)).resolves.toBe('revoked');
      const deadline = await client.query<{ until: Date | null }>(
        `SELECT content_intake.authorization_deadline($1,'query','scope-a','source-a',clock_timestamp()) AS until`,
        [rosterPrincipalId(seat)]);
      expect(deadline.rows[0]?.until).toBeNull();
      remember();
      await expect(login(client)).resolves.toBe('projected');
      const rows = await client.query<{ grant_id: string; revoked: boolean }>(
        `SELECT grant_id, revoked_at IS NOT NULL AS revoked FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND action = 'query'`, [rosterPrincipalId(seat)]);
      expect(rows.rows).toContainEqual({ grant_id: original.rows[0]?.grant_id, revoked: true });
      expect(rows.rows.filter((row) => !row.revoked)).toHaveLength(1);
      expect(rows.rows.find((row) => !row.revoked)?.grant_id).not.toBe(original.rows[0]?.grant_id);
    } finally { await client.end(); }
  }, 60_000);

  it('stops a department mismatch and revokes an existing system query grant', async () => {
    const database = harness.createDatabase('roster_department');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      rememberJobSnapshot(seat, { title: '客服总监', directory: [{ name: '客服总监', enabled: true }], departmentIds: ['dept-b'] });
      await expect(login(client)).resolves.toBe('policy-pending');
      const before = await client.query(
        `SELECT count(*)::int AS count FROM content_intake.principals WHERE principal_id = $1`, [rosterPrincipalId(seat)]);
      expect(before.rows[0]?.count).toBe(0);
      remember();
      await expect(login(client)).resolves.toBe('projected');
      rememberJobSnapshot(seat, { title: '客服总监', directory: [{ name: '客服总监', enabled: true }], departmentIds: ['dept-b'] });
      await expect(login(client)).resolves.toBe('policy-pending');
      const live = await client.query(
        `SELECT count(*)::int AS count FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND action = 'query' AND revoked_at IS NULL`,
        [rosterPrincipalId(seat)]);
      expect(live.rows[0]?.count).toBe(0);
    } finally { await client.end(); }
  }, 60_000);

  it('issues a new grant id when the store set version changes after a revoke', async () => {
    const database = harness.createDatabase('roster_version');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      remember();
      await expect(login(client)).resolves.toBe('projected');
      const first = await client.query<{ grant_id: string; store_set_version: string }>(
        `SELECT grant_id, store_set_version::text FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND revoked_at IS NULL`, [rosterPrincipalId(seat)]);
      await client.query(`UPDATE content_intake.grants
        SET version = version + 1, last_change_reason = '撤销。', revoked_at = clock_timestamp()
        WHERE grant_id = $1`, [first.rows[0]?.grant_id]);
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.publishing','on',true)");
      const hash = (await client.query<{ source_binding_hash: string }>(
        "SELECT source_binding_hash FROM public.content_releases WHERE release_id='rel-roster'")).rows[0]!.source_binding_hash;
      await client.query(`INSERT INTO public.content_releases(release_id,release_seq,title,status,source_binding_hash,tenant_id)
        VALUES('rel-next',2,'下一版发布','published',$1,'tenant-a')`, [hash]);
      await client.query(`INSERT INTO public.release_source_bindings(release_id,domain,source_version_id)
        SELECT 'rel-next', domain, source_version_id FROM public.release_source_bindings WHERE release_id='rel-roster'`);
      await client.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES('rel-next','intake-v2.1')");
      await client.query(`INSERT INTO content_intake.release_lineage(
        release_id,source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy)
        VALUES('rel-next','source-a','faq-one',1,'cand-roster',1,'review-roster',clock_timestamp()+interval '2 days','approval-v1')`);
      await client.query("UPDATE public.content_current SET current_release_id='rel-next', updated_at=clock_timestamp() WHERE id=1");
      await client.query('COMMIT');
      await expect(login(client)).resolves.toBe('projected');
      const rows = await client.query<{ grant_id: string; revoked: boolean; store_set_version: string }>(
        `SELECT grant_id, revoked_at IS NOT NULL AS revoked, store_set_version::text
         FROM content_intake.grants
         WHERE recipient_id = $1 AND kind = 'business' AND action = 'query'`, [rosterPrincipalId(seat)]);
      const live = rows.rows.find((row) => !row.revoked);
      expect(rows.rows).toContainEqual({
        grant_id: first.rows[0]?.grant_id, revoked: true, store_set_version: first.rows[0]?.store_set_version,
      });
      expect(live?.grant_id).not.toBe(first.rows[0]?.grant_id);
      expect(Number(live?.store_set_version)).toBeGreaterThan(Number(first.rows[0]?.store_set_version));
      const provenance = await client.query<{ provenance: string }>(
        `SELECT provenance FROM content_intake.store_sets
         WHERE tenant_id = 'tenant-a' AND app_id = 'app-a' AND version = $1::bigint`, [live?.store_set_version]);
      expect(provenance.rows[0]?.provenance).toBe('rel-next');
    } finally { await client.end(); }
  }, 60_000);

  it('reports only the current policy and store set and leaves expired history alone', async () => {
    const database = harness.createDatabase('roster_day_one');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      remember();
      await expect(login(client)).resolves.toBe('projected');
      await client.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,parent_grant_id,policy_version,store_set_version,roster_job_id)
        SELECT 'grant-day-one-expired','business',signer.principal_id,$1,'tenant-a','app-a','scope-a','source-a','query',
          clock_timestamp()-interval '2 hours', clock_timestamp()-interval '1 minute','职位名单系统签发。',NULL,
          pol.version, cur.version, 'job-customer-service-seat'
        FROM content_intake.principals signer
        JOIN content_intake.policy_versions pol ON pol.tenant_id = signer.tenant_id AND pol.app_id = signer.app_id
        JOIN content_intake.store_set_current cur ON cur.tenant_id = signer.tenant_id AND cur.app_id = signer.app_id
        WHERE signer.identity_scope = 'content-intake-system' AND signer.person_key = 'query-signer'`, [rosterPrincipalId(seat)]);
      const before = await client.query<{ expires_at: Date; revoked: boolean }>(
        `SELECT expires_at, revoked_at IS NOT NULL AS revoked FROM content_intake.grants WHERE grant_id = 'grant-day-one-expired'`);
      const report = await client.query<{ grant_id: string | null; provenance: string }>(
        `SELECT grant_id, provenance FROM content_intake.roster_day_one('tenant-a','app-a')`);
      expect(report.rows.map((row) => row.grant_id)).not.toContain('grant-day-one-expired');
      expect(report.rows.every((row) => row.provenance === 'rel-roster' && row.grant_id !== null)).toBe(true);
      const after = await client.query<{ expires_at: Date; revoked: boolean }>(
        `SELECT expires_at, revoked_at IS NOT NULL AS revoked FROM content_intake.grants WHERE grant_id = 'grant-day-one-expired'`);
      expect(after.rows).toEqual(before.rows);
    } finally { await client.end(); }
  }, 60_000);

  it('registers the first user in an empty principal table from the trusted home', async () => {
    const database = harness.createDatabase('roster_first_user');
    const client = await harness.connect(database.config);
    try {
      await applyDatabaseMigrations(client);
      await client.query(`INSERT INTO backend_identity.subject_bindings
        (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'feishu','feishu-tenant',$1,$2,repeat('cd',32),true,'agent')`, [seat, feishuUserId(seat)]);
      await client.query(`INSERT INTO content_intake.role_rules
        VALUES ('tenant-menokin','app-customer-agent','dept-a','job-customer-service-seat',1,'agent')`);
      remember();
      await client.query('SET ROLE intake_business');
      const status = await projectRosterLogin(client, seat, { tenantId: 'tenant-menokin', appId: 'app-customer-agent' });
      await client.query('RESET ROLE');
      expect(status).toBe('registered');
      const person = await client.query<{ tenant_id: string; app_id: string }>(
        `SELECT tenant_id, app_id FROM content_intake.principals WHERE principal_id = $1`, [rosterPrincipalId(seat)]);
      expect(person.rows).toEqual([{ tenant_id: 'tenant-menokin', app_id: 'app-customer-agent' }]);
    } finally { await client.end(); }
  }, 60_000);

  it('keeps the query button visible while the database says the grant is revoked', async () => {
    const database = harness.createDatabase('roster_visible_denied');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      remember();
      await expect(login(client)).resolves.toBe('projected');
      forgetJobSnapshot(seat);
      await expect(readStoredRosterPermission(client, feishuUserId(seat))).resolves.toEqual({
        title: '客服坐席', state: 'ready',
      });
      await client.query(`UPDATE content_intake.grants
        SET version = version + 1, last_change_reason = '撤销。', revoked_at = clock_timestamp()
        WHERE recipient_id = $1 AND kind = 'business' AND revoked_at IS NULL`, [rosterPrincipalId(seat)]);
      const started = performance.now();
      const deadline = await client.query<{ until: Date | null }>(
        `SELECT content_intake.authorization_deadline($1,'query','scope-a','source-a',clock_timestamp()) AS until`,
        [rosterPrincipalId(seat)]);
      const revokeDelayMs = performance.now() - started;
      expect(deadline.rows[0]?.until).toBeNull();
      expect(Number.isFinite(revokeDelayMs)).toBe(true);
      await expect(readStoredRosterPermission(client, feishuUserId(seat))).resolves.toEqual({
        title: '客服坐席', state: 'revoked',
      });
      const rights = JOB_ROSTER.find((row) => row.title === '客服坐席')?.rights;
      expect(rights).toMatchObject({ search: true, publish: false, grant: false });
      console.info(`[roster] revoke-to-deny ${revokeDelayMs.toFixed(3)} ms`);
    } finally { await client.end(); }
  }, 60_000);

  it('measures store scope and login-to-ready without a latency budget', async () => {
    const database = harness.createDatabase('roster_timing');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      remember();
      await expect(login(client)).resolves.toBe('projected');
      const scope: number[] = [];
      const ready: number[] = [];
      for (let round = 0; round < 5; round += 1) {
        const scopeStarted = performance.now();
        const deadline = await client.query<{ until: Date | null }>(
          `SELECT content_intake.authorization_deadline($1,'query','scope-a','source-a',clock_timestamp()) AS until`,
          [rosterPrincipalId(seat)]);
        scope.push(performance.now() - scopeStarted);
        expect(deadline.rows[0]?.until).not.toBeNull();
        const readyStarted = performance.now();
        await expect(login(client)).resolves.toBe('projected');
        ready.push(performance.now() - readyStarted);
      }
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[2]!;
      console.info(`[roster] store-scope median ${median(scope).toFixed(3)} ms range ${Math.min(...scope).toFixed(3)}-${Math.max(...scope).toFixed(3)}`);
      console.info(`[roster] login-to-ready median ${median(ready).toFixed(3)} ms range ${Math.min(...ready).toFixed(3)}-${Math.max(...ready).toFixed(3)}`);
      expect(scope.every((value) => Number.isFinite(value))).toBe(true);
      expect(ready.every((value) => Number.isFinite(value))).toBe(true);
    } finally { await client.end(); }
  }, 60_000);
});
