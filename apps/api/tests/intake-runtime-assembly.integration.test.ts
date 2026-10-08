import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import type { AuthenticatedUser, ProductAuthService } from '../src/auth-service.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { lockProductSession, type IntakePool } from '../src/content-intake/transaction.js';
import { authenticatedProductSession, createProductAuthService } from '../src/product-auth-service.js';
import { createIntakeRuntimeAssembly } from '../experiments/intake-runtime/assembly.js';
import { createOrganizationFactsWriter } from '../experiments/intake-organization/facts-writer.js';
import { createPurposeBoundary, finishParseTerminal } from '../experiments/intake-runtime/purpose-boundary.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';

// Disposable cluster only. These roles are not a production ACL.
const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
describe.skipIf(!enabled)('intake runtime purpose assembly (synthetic PG15)', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let usage: Pool;
  let business: Pool;
  let worker: Pool;
  let organization: Pool;
  let auth: ProductAuthService;
  let actor: AuthenticatedUser;
  let databaseName = '';

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('intake_runtime_assembly');
    databaseName = db.name;
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await seedIntakeSyntheticHost(admin);
    await admin.query(await readFile(new URL('../experiments/intake-runtime/session-lock.sql', import.meta.url), 'utf8'));
    await admin.query(await readFile(new URL('../experiments/intake-runtime/purpose-acl.sql', import.meta.url), 'utf8'));
    await admin.query(`CREATE ROLE synthetic_runtime_auth LOGIN NOINHERIT; GRANT app_backend_auth TO synthetic_runtime_auth;`);
    const narrow = (user: string) => new Pool({ ...db.config, user, max: 2 });
    usage = narrow('intake_usage');
    business = narrow('intake_business');
    worker = narrow('intake_worker');
    organization = narrow('intake_org_writer');
    auth = await createProductAuthService({
      connectionString: `postgresql://synthetic_runtime_auth@localhost/${db.name}?${new URLSearchParams({ host: harness.socket, port: String(harness.port) })}`,
      poolMax: 1, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
    }, { authorizeUrl: state => `http://127.0.0.1/authorize?state=${state}`, exchange: async code => code, close: () => undefined }, 'mock');
    const verifier = 'v'.repeat(43);
    const login = await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
    await auth.callback(new URL(login.authorize_url).searchParams.get('state')!, 'agent');
    const session = await auth.exchange(login.login_id, verifier);
    expect(session).not.toBeNull();
    actor = (await auth.authenticate({ authorization: `Bearer ${session!.access_token}` }))!;
    expect(authenticatedProductSession(actor)).toMatch(/^[0-9a-f]{64}$/);
  }, 180_000);

  afterAll(async () => {
    await auth?.close();
    await usage?.end();
    await business?.end();
    await worker?.end();
    await organization?.end();
    await admin?.end();
    harness?.stop();
  }, 60_000);

  const seat = { shopId: 'shop-a', contextGeneration: 1, productIds: [] as string[], scenarioIds: [] as string[], releaseId: null };
  async function denied(pool: Pool, sql: string, params: readonly unknown[] = []) {
    await expect(pool.query(sql, params as unknown[])).rejects.toMatchObject({ code: '42501' });
  }

  it('installs non-login definer owners and empty purpose gaps for the four login roles', async () => {
    const functions = await admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; owner: string; public_execute: boolean }>(`
      SELECT p.proname, p.prosecdef, p.proconfig, r.rolname AS owner,
        (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0)) AS public_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
      WHERE (n.nspname,p.proname) IN (
        ('content_intake','entitlement_context_guard'),('content_intake','publish_candidate'),
        ('content_intake','preview_rollback'),('content_intake','execute_rollback'),
        ('intake_runtime_probe','lock_product_session'),('intake_runtime_probe','purpose_gap'))
      ORDER BY p.proname`);
    expect(functions.rows).toEqual([
      { proname: 'entitlement_context_guard', prosecdef: true, proconfig: ['search_path=pg_catalog'], owner: 'intake_runtime_fn_owner', public_execute: false },
      { proname: 'execute_rollback', prosecdef: true, proconfig: ['search_path=pg_catalog, public, pg_temp'], owner: 'intake_runtime_fn_owner', public_execute: false },
      { proname: 'lock_product_session', prosecdef: true, proconfig: ['search_path=pg_catalog'], owner: 'intake_runtime_fn_owner', public_execute: false },
      { proname: 'preview_rollback', prosecdef: true, proconfig: ['search_path=pg_catalog, public, pg_temp'], owner: 'intake_runtime_fn_owner', public_execute: false },
      { proname: 'publish_candidate', prosecdef: true, proconfig: ['search_path=pg_catalog, public, pg_temp'], owner: 'intake_runtime_fn_owner', public_execute: false },
      { proname: 'purpose_gap', prosecdef: true, proconfig: ['search_path=pg_catalog'], owner: 'intake_runtime_fn_owner', public_execute: false },
    ]);
    const invoker = await admin.query(`SELECT bool_or(p.prosecdef) AS any_definer FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='content_intake'
      AND p.proname IN ('quality_state','assert_family_catalog','authorization_deadline')`);
    expect(invoker.rows[0].any_definer).toBe(false);
    const roles = await admin.query(`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolcanlogin,rolbypassrls,rolinherit
      FROM pg_roles WHERE rolname LIKE 'intake_%' ORDER BY rolname`);
    expect(roles.rows).toEqual([
      { rolname: 'intake_business', rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true, rolbypassrls: false, rolinherit: false },
      { rolname: 'intake_org_writer', rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true, rolbypassrls: false, rolinherit: false },
      { rolname: 'intake_runtime_fn_owner', rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: false, rolbypassrls: false, rolinherit: false },
      { rolname: 'intake_usage', rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true, rolbypassrls: false, rolinherit: false },
      { rolname: 'intake_worker', rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true, rolbypassrls: false, rolinherit: false },
    ]);
    for (const [pool, purpose] of [[usage, 'usage'], [business, 'business'], [worker, 'worker'], [organization, 'organization']] as const) {
      expect((await pool.query('SELECT intake_runtime_probe.purpose_gap($1) AS gap', [purpose])).rows[0].gap).toEqual([]);
    }
    expect((await admin.query(`SELECT intake_runtime_probe.purpose_gap('usage') AS gap`)).rows[0].gap).toEqual(['role_mismatch']);
  });

  it('does not treat an empty or later non-empty catalog as legacy adoption', async () => {
    const input = {
      claimManifest: null,
      connections: { usage, business, worker, organization },
      parser: { probe: async () => true },
      organization: { refresh: async () => { throw new Error('REFRESH_CALLED'); } },
      catalog: worker,
    };
    await expect(createIntakeRuntimeAssembly(input).start()).resolves.toEqual({
      state: 'running', legacyAdopted: false, reason: 'CLAIM_MANIFEST_ABSENT', catalogObjects: 0, claimManifest: null,
    });
    await expect(createIntakeRuntimeAssembly({ ...input, connections: { ...input.connections, usage: admin } }).start())
      .rejects.toMatchObject({ reason: 'PURPOSE_PRIVILEGE_MISSING', gaps: ['role_mismatch'] });
  });

  it('issues, pages and reads copy eligibility on the usage role without returning a lease token', async () => {
    const diagnostics: { code: string | undefined; message: string | undefined; detail: string | undefined; routine: string | undefined }[] = [];
    const boundary = createPurposeBoundary(usage, (_id, error) => {
      const value = error as { code?: string; message?: string; detail?: string; routine?: string };
      diagnostics.push({ code: value.code, message: value.message, detail: value.detail, routine: value.routine });
    });
    const early = await boundary.run(actor, async client => { client.validUntil(0); return true; });
    expect(early).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED', code: 'FORBIDDEN', commit: 'rolled_back' });
    const seen: string[] = [];
    const raw = await usage.connect();
    const wrapped = { connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        seen.push(sql);
        if (sql === 'COMMIT') throw new Error('COMMIT_BROKEN');
        return raw.query(sql, params);
      },
      release: (broken?: boolean) => raw.release(broken),
    }) } as IntakePool;
    const unknown = await createPurposeBoundary(wrapped).run(actor, async () => true);
    expect(unknown).toMatchObject({ ok: false, reason: 'COMMIT_UNKNOWN', commit: 'unknown' });
    expect(seen.includes('ROLLBACK')).toBe(false);
    const errors: unknown[] = [];
    const service = createContentIntakeService(usage, createContentObjectStore(path.join(harness.root, databaseName)),
      (_id, error) => errors.push(error), undefined, { requireProductSession: true });
    const serviceResult = await service.issueEntitlement(actor, seat);
    expect(serviceResult).toMatchObject({ ok: false, code: 'INTERNAL_ERROR', reason: 'COMMIT_UNKNOWN', commit: 'rolled_back' });
    expect(errors[0]).toMatchObject({ code: '42501' });
    const locked = await usage.connect();
    try {
      await locked.query('BEGIN');
      await expect(lockProductSession({ query: locked.query.bind(locked), validUntil: () => undefined }, actor)).rejects.toMatchObject({ code: '42501' });
    } finally { await locked.query('ROLLBACK'); locked.release(); }
    const forged = await boundary.issueUsageQualification(actor, { ...seat, sessionTokenHash: 'a'.repeat(64) });
    expect(forged).toMatchObject({ ok: false, reason: 'FILE_INVALID', code: 'VALIDATION', commit: 'rolled_back' });
    const issued = await boundary.issueUsageQualification(actor, seat);
    expect(issued.ok, JSON.stringify({ issued, diagnostics })).toBe(true);
    if (!issued.ok) return;
    expect(JSON.stringify(issued.value)).not.toContain('osl_');
    expect(issued.value.entitlementHash).toMatch(/^[0-9a-f]{64}$/);
    const stored = await admin.query(`SELECT c.session_token_hash IS NULL AS missing_context, c.session_token_hash, l.client_id
      FROM content_intake.entitlements e JOIN content_intake.entitlement_contexts c USING(entitlement_hash)
      JOIN public.snapshot_offline_leases l ON l.lease_token_hash=e.lease_token_hash WHERE e.entitlement_hash=$1`, [issued.value.entitlementHash]);
    expect(stored.rows[0].session_token_hash).toBe(authenticatedProductSession(actor));
    expect(stored.rows[0].client_id).toMatch(/^intake:[0-9a-f]{64}$/);
    const page = await boundary.pageEmptyLineage(actor, 'rel_native_base');
    expect(page).toMatchObject({ ok: true, value: { rows: 0, approvalInvalid: false } });
    const copy = await boundary.readCopyEligibility(actor, 'source-a');
    expect(copy.ok, JSON.stringify(copy)).toBe(true);
    await denied(usage, `SELECT content_intake.publish_candidate('agent','{}'::jsonb,'null'::jsonb)`);
    await denied(usage, `INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ('forged','allocation','director','director','tenant-a','app-a','scope-a','publish',clock_timestamp(),clock_timestamp()+interval '1 hour','x','director')`);
    await denied(usage, `INSERT INTO content_intake.approval_facts(review_request_id,facts_version,revocation_generation,state,checked_at,valid_until,raw_facts_digest)
      VALUES ('forged',1,0,'pending',clock_timestamp(),clock_timestamp()+interval '1 minute',repeat('b',64))`);
    await denied(usage, 'CREATE TABLE content_intake.usage_probe(id int)');
    await denied(usage, 'SET ROLE intake_runtime_fn_owner');
  });

  it('lets business execute direct publication denials and blocks grant, fact and quality writes', async () => {
    const grantsBefore = (await admin.query('SELECT count(*) FROM content_intake.grants')).rows[0].count;
    await expect(business.query(`SELECT content_intake.publish_candidate('enabler',$1::jsonb,'null'::jsonb)`,
      [JSON.stringify({ confirmed: false })])).rejects.toMatchObject({ code: 'ZA003', message: 'MODE_CONFLICT' });
    await expect(business.query(`SELECT content_intake.publish_candidate('enabler',$1::jsonb,$2::jsonb)`, [
      JSON.stringify({ confirmed: true, approvalEvidenceVersion: 1 }), JSON.stringify({ decision: 'APPROVED' }),
    ])).rejects.toMatchObject({ code: 'ZA003', message: 'MODE_CONFLICT' });
    await expect(business.query(`SELECT content_intake.publish_candidate('enabler',$1::jsonb,'null'::jsonb)`, [JSON.stringify({
      confirmed: true, key: { candidateId: 'missing-candidate', version: 1, digest: 'a'.repeat(64) },
    })])).rejects.toMatchObject({ code: 'ZA003', message: 'MATERIAL_CHANGED' });
    await expect(business.query(`SELECT content_intake.execute_rollback('enabler',$1::jsonb,'null'::jsonb)`,
      [JSON.stringify({ confirmed: false })])).rejects.toMatchObject({ code: 'ZA003', message: 'MODE_CONFLICT' });
    await expect(business.query(`SELECT content_intake.execute_rollback('enabler',$1::jsonb,'null'::jsonb)`,
      [JSON.stringify({ confirmed: true, rollbackPlanId: 'missing-plan' })])).rejects.toMatchObject({ code: 'ZA003', message: 'MATERIAL_CHANGED' });
    await expect(business.query(`SELECT content_intake.preview_rollback('agent','rel_native_base','missing-target')`)).rejects.toMatchObject({ code: 'ZA003' });
    expect((await business.query(`SELECT content_intake.quality_state('missing',1) AS state`)).rows[0].state).toBe('not_frozen');
    expect((await business.query(`SELECT content_intake.authorization_deadline('agent','publish','scope-a','source-a',clock_timestamp()) AS until`)).rows[0].until).toBeNull();
    expect((await business.query(`SELECT content_intake.authorization_deadline('enabler','publish','scope-a','source-a',clock_timestamp()) AS until`)).rows[0].until).toBeInstanceOf(Date);
    await denied(business, `INSERT INTO content_intake.quality_plans(candidate_id,candidate_version,candidate_digest,policy_version,plan,frozen_by,facts_version)
      VALUES ('missing',1,repeat('c',64),'intake-quality-v1','{}'::jsonb,'agent',1)`);
    await denied(business, `INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ('forged-b','allocation','director','director','tenant-a','app-a','scope-a','publish',clock_timestamp(),clock_timestamp()+interval '1 hour','x','director')`);
    await denied(business, `INSERT INTO content_intake.principal_facts VALUES ('agent',9,ARRAY['dept-a'],'job-agent',true,clock_timestamp(),clock_timestamp()+interval '1 minute',repeat('d',64))`);
    await denied(business, `INSERT INTO content_intake.publications DEFAULT VALUES`);
    await denied(business, 'SET ROLE intake_runtime_fn_owner');
    await denied(business, 'CREATE TABLE content_intake.business_probe(id int)');
    await denied(worker, `SELECT content_intake.publish_candidate('agent','{}'::jsonb,'null'::jsonb)`);
    await denied(organization, `SELECT content_intake.publish_candidate('agent','{}'::jsonb,'null'::jsonb)`);
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM content_intake.grants')).rows[0].count).toBe(grantsBefore);
  });

  it('finishes a report on the worker role and rejects validated input, grants and DDL', async () => {
    const report = Buffer.from('{"ok":false,"synthetic":true}');
    const sha = createHash('sha256').update(report).digest('hex');
    const reportId = `obj_${sha}`;
    const inputSha = 'b'.repeat(64);
    const inputId = `obj_${inputSha}`;
    await admin.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES ($1,'source-a','agent','tenant-a','app-a',$2,$3,4,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','input',clock_timestamp())`,
    [inputId, `intake/${inputId}`, inputSha]);
    await admin.query(`INSERT INTO content_intake.parse_jobs(job_id,source_version,contributor_ids,generation,source_id,object_id,actor_id,state,started_at)
      VALUES ('job-report-1',1,ARRAY['agent'],1,'source-a',$1,'agent','reading',clock_timestamp())`, [inputId]);
    await admin.query(`INSERT INTO content_intake.object_reservations(object_id,tenant_id,app_id,actor_id,source_id,purpose,reserved_bytes,actual_bytes,sha256,state)
      VALUES ($1,'tenant-a','app-a','agent','source-a','report',$2,$2,$3,'persisted')`, [reportId, report.length, sha]);
    await expect(worker.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES ('obj_${'c'.repeat(64)}','source-a','agent','tenant-a','app-a','intake/obj_${'c'.repeat(64)}','${'c'.repeat(64)}',4,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','input',clock_timestamp())`)).rejects.toMatchObject({ code: 'ZA003', message: 'WORKER_OBJECT_PURPOSE' });
    await expect(worker.query(`UPDATE content_intake.parse_jobs SET state='validated' WHERE job_id='job-report-1'`)).rejects.toMatchObject({ code: 'ZA003', message: 'WORKER_TERMINAL_ONLY' });
    await expect(finishParseTerminal(worker, 'job-report-1', 'user-agent', { objectId: reportId, sha256: sha, sizeBytes: report.length })).resolves.toEqual({ finished: true });
    expect((await admin.query(`SELECT state,report_object_id FROM content_intake.parse_jobs WHERE job_id='job-report-1'`)).rows[0]).toMatchObject({ state: 'failed', report_object_id: reportId });
    expect((await admin.query('SELECT state FROM content_intake.object_reservations WHERE object_id=$1', [reportId])).rows[0].state).toBe('adopted');
    await denied(worker, `INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ('forged-w','allocation','director','director','tenant-a','app-a','scope-a','publish',clock_timestamp(),clock_timestamp()+interval '1 hour','x','director')`);
    // PostgreSQL accepts GRANT from a non-owner without GRANT OPTION and changes nothing.
    await worker.query('GRANT SELECT, DELETE ON content_intake.objects TO intake_usage');
    expect((await admin.query(`SELECT has_table_privilege('intake_usage','content_intake.objects','SELECT') AS sel,
      has_table_privilege('intake_usage','content_intake.objects','DELETE') AS del`)).rows[0]).toEqual({ sel: false, del: false });
    await denied(worker, 'SET ROLE intake_runtime_fn_owner');
    await denied(worker, 'CREATE TABLE content_intake.worker_probe(id int)');
    const again = createIntakeRuntimeAssembly({
      claimManifest: null, connections: { usage, business, worker, organization },
      parser: { probe: async () => true }, organization: { refresh: async () => undefined }, catalog: worker,
    });
    const started = await again.start();
    expect(started.legacyAdopted).toBe(false);
    expect(started.catalogObjects).toBeGreaterThan(0);
  });

  it('applies one organization fact refresh and refuses the same write from the other roles', async () => {
    const now = (await admin.query('SELECT clock_timestamp() AS time')).rows[0].time as Date;
    const write = createOrganizationFactsWriter(organization, { tenantId: 'tenant-a', appId: 'app-a' });
    const applied = await write({ principalId: 'agent', expectedFactsVersion: 1, departmentIds: ['dept-a'], jobId: 'job-agent', enabled: true,
      checkedAt: now.toISOString(), validUntil: new Date(now.getTime() + 60_000).toISOString() });
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, status: 'applied', factsVersion: 2 });
    const insert = `INSERT INTO content_intake.principal_facts VALUES ('director',9,ARRAY['dept-a'],'job-director',true,clock_timestamp(),clock_timestamp()+interval '1 minute',repeat('e',64))`;
    await denied(usage, insert);
    await denied(business, insert);
    await denied(worker, insert);
  });

  it('rejects a legacy source mode, a missing purpose privilege, and a caller reopening a disabled session', async () => {
    await admin.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await admin.query(`UPDATE content_intake.sources SET mode='legacy', mode_version=mode_version+1 WHERE source_id='source-b'`);
    await admin.query('COMMIT');
    const input = {
      claimManifest: null, connections: { usage, business, worker, organization },
      parser: { probe: async () => true }, organization: { refresh: async () => undefined }, catalog: worker,
    };
    await expect(createIntakeRuntimeAssembly(input).start()).rejects.toMatchObject({ reason: 'SOURCE_MODE_UNUSABLE' });
    await admin.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await admin.query(`UPDATE content_intake.sources SET mode='v2-preview', mode_version=mode_version+1 WHERE source_id='source-b'`);
    await admin.query('COMMIT');
    await admin.query('REVOKE EXECUTE ON FUNCTION intake_runtime_probe.lock_product_session(text,text) FROM intake_usage');
    await expect(createIntakeRuntimeAssembly(input).start()).rejects.toMatchObject({ reason: 'PURPOSE_PRIVILEGE_MISSING', gaps: ['session_lock'] });
    await admin.query('GRANT EXECUTE ON FUNCTION intake_runtime_probe.lock_product_session(text,text) TO intake_usage');
    await admin.query(`UPDATE backend_identity.subject_bindings SET enabled=false WHERE user_id='user-agent'`);
    await denied(usage, `UPDATE backend_identity.subject_bindings SET enabled=true WHERE user_id='user-agent'`);
    await denied(usage, 'UPDATE backend_identity.sessions SET revoked_at=NULL');
    await expect(usage.query('SELECT intake_runtime_probe.lock_product_session($1,$2)', [authenticatedProductSession(actor), actor.user_id]))
      .rejects.toMatchObject({ code: 'ZA003', message: 'SESSION_UNAVAILABLE' });
    const locked = await createPurposeBoundary(usage).run(actor, async () => true);
    expect(locked).toMatchObject({ ok: false, reason: 'SCOPE_DENIED', code: 'UNAUTHORIZED', commit: 'rolled_back' });
  });
});
