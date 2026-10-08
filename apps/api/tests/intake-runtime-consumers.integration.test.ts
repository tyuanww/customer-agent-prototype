import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Client, PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createTemplate } from '@customer-agent/content-intake';
import type { components } from '@customer-agent/contracts';
import type { AuthenticatedUser, ProductAuthService } from '../src/auth-service.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { authenticatedProductSession, createProductAuthService } from '../src/product-auth-service.js';
import { type IntakePool, type IntakeResult } from '../src/content-intake/transaction.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';
import { createIntakePurposePool, type IntakePurposePool, type IntakePurpose } from '../src/content-intake/runtime-pool.js';

type C = components['schemas'];
type Service = ReturnType<typeof createContentIntakeService>;
const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const context = { shopId: 'shop-a', contextGeneration: 1, productIds: [], scenarioIds: [], releaseId: null };
const rows = (body = '第一行。\n第二行。') => ['one', 'two', 'three'].map(id =>
  [`faq-${id}`, `合成问题${id}`, body, '', '', '分类', '', '启用', '', '', '', '内部说明', '', '', 'false']);

describe.skipIf(!enabled)('actual service on formal purpose roles (synthetic PG15)', () => {
  let harness: Pg15Harness, admin: Client, auth: ProductAuthService;
  type TestPool = IntakePurposePool & { query: PoolClient['query'] };
  let business: TestPool, usage: TestPool, worker: TestPool, organization: TestPool;
  let businessPool: IntakePool, usagePool: IntakePool;
  let service: Service, reader: Service, store: ReturnType<typeof createContentObjectStore>;
  let actors: Record<string, AuthenticatedUser>;
  const errors: unknown[] = [];
  const report = (_id: string, error: unknown) => { errors.push(error); };
  function value<T>(result: IntakeResult<T>): T {
    if (!result.ok) throw new Error(JSON.stringify({ result, diagnostics: errors.map(e => String(e)) }));
    return result.value;
  }
  function configured(pool = businessPool, terminalPool: IntakePool = worker) {
    return createContentIntakeService(pool, store, report, undefined, { requireProductSession: true, terminalPool });
  }
  function intercept(pool: IntakePool, hook: (sql: string, client: PoolClient, args?: unknown[]) => Promise<void>, trace?: string[]): IntakePool {
    return { connect: async () => {
      const client = await pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, args?: unknown[]) => {
          trace?.push(sql);
          const result = await target.query(sql, args);
          await hook(sql, target, args);
          return result;
        };
        if (key === 'release') return (broken?: boolean) => { trace?.push(`release:${!!broken}`); target.release(broken); };
        const v: unknown = Reflect.get(target, key);
        return typeof v === 'function' ? v.bind(target) : v;
      } });
    } };
  }
  beforeEach(async () => {
    harness = new Pg15Harness(); harness.start();
    const db = harness.createDatabase('intake_consumers');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await seedIntakeSyntheticHost(admin);
    const pool = async (purpose: IntakePurpose): Promise<TestPool> => {
      const user = `synthetic_${purpose}`, capability = purpose === 'organization' ? 'intake_org_writer' : `intake_${purpose}`;
      await admin.query(`CREATE ROLE ${user} LOGIN NOINHERIT; GRANT ${capability} TO ${user}`);
      const owned = createIntakePurposePool({ ...db.config, user, max: 2 }, purpose);
      return Object.assign(owned, { query: async (sql: string, args?: unknown[]) => { const client = await owned.connect(); try { return await client.query(sql, args); } finally { client.release(); } } }) as TestPool;
    };
    business = await pool('business'); usage = await pool('usage'); worker = await pool('worker'); organization = await pool('organization');
    businessPool = business; usagePool = usage;
    store = createContentObjectStore(path.join(harness.root, db.name));
    service = configured(); reader = configured(usagePool);
    await admin.query('CREATE ROLE synthetic_consumer_auth LOGIN NOINHERIT; GRANT app_backend_auth TO synthetic_consumer_auth');
    auth = await createProductAuthService({
      connectionString: `postgresql://synthetic_consumer_auth@localhost/${db.name}?${new URLSearchParams({ host: harness.socket, port: String(harness.port) })}`,
      poolMax: 1, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
    }, { authorizeUrl: s => `http://127.0.0.1/auth?state=${s}`, exchange: async c => c, close: () => undefined }, 'mock');
    actors = {}; errors.length = 0;
    for (const id of ['director', 'enabler', 'reviewer', 'agent']) {
      const verifier = 'v'.repeat(43);
      const login = await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
      await auth.callback(new URL(login.authorize_url).searchParams.get('state')!, id);
      const session = (await auth.exchange(login.login_id, verifier))!;
      actors[id] = (await auth.authenticate({ authorization: `Bearer ${session.access_token}` }))!;
    }
  }, 60_000);
  afterEach(async () => {
    await auth?.close(); await business?.end(); await usage?.end(); await worker?.end(); await organization?.end(); await admin?.end(); harness?.stop();
  }, 60_000);
  async function uploaded(label: string, table = rows()) {
    const bytes = await createTemplate({ sourceId: 'source-a', brandId: 'brand-a', scope: 'shop-a', domain: 'product', sheet: 'FAQ', templateVersion: 'faq-p1.1' }, table);
    const form = new FormData(); form.set('operationId', `${label}-upload`);
    form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic.xlsx');
    const body = new Request('http://127.0.0.1/', { method: 'POST', body: form });
    const object = value(await service.upload(actors.enabler!, 'source-a', Readable.from(Buffer.from(await body.arrayBuffer())), body.headers.get('content-type')!));
    const base = (await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id as string;
    const received = value(await service.receive(actors.enabler!, 'source-a', {
      operationId: `${label}-receive`, objectId: object.objectId, sourceVersion: 1, baseReleaseId: base,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null,
    }));
    return { object, jobId: received.jobId, base };
  }
  async function prepared(label: string, table = rows()) {
    const input = await uploaded(label, table);
    const candidate = value(await service.parse(actors.enabler!, input.jobId));
    value(await service.confirmSource(actors.enabler!, { operationId: `${label}-source`, key: candidate.key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-v1', acquisition: 'controlled-synthetic-export',
      objectSha256: input.object.sha256, reason: '合成来源确认' }));
    const quality = value(await service.freezeQuality(actors.reviewer!, { operationId: `${label}-freeze`, key: candidate.key }));
    const hashes = new Map(quality.plan!.population.map(row => [row.script_id, row.content_hash]));
    value(await service.checkQuality(actors.reviewer!, { operationId: `${label}-quality`, key: candidate.key, phase: 'initial',
      checks: quality.plan!.initialScriptIds.map(id => ({ scriptId: id, contentHash: hashes.get(id), defect: false, reason: '' })) }));
    const request: C['IntakePublish'] = { operationId: `${label}-publish`, key: candidate.key, baseReleaseId: input.base,
      sourceEvidenceVersion: 1, confirmed: true, title: '合成用途发布', summary: '三条合成FAQ' };
    return { ...input, candidate, request };
  }
  async function publish(label: string, table = rows()) {
    const ready = await prepared(label, table);
    return { ...ready, receipt: value(await service.publish(actors.enabler!, ready.request)) };
  }
  async function readAll() {
    const entitlement = value(await reader.issueEntitlement(actors.agent!, context));
    const result: C['IntakeSnapshot']['faq'] = [];
    let cursor: string | null = null;
    do {
      const page: C['IntakeSnapshot'] = value(await reader.snapshot(actors.agent!, { entitlementId: entitlement.entitlementId, limit: 1, ...(cursor ? { cursor } : {}) }));
      result.push(...page.faq); cursor = page.nextCursor;
    } while (cursor);
    expect(JSON.stringify({ entitlement, result })).not.toContain('osl_');
    return { entitlement, result };
  }
  it('evicts a terminated idle connection and admits a new one through the purpose guard', async () => {
    const client = await usage.connect(); const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    client.release();
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    await expect.poll(() => usage.totalCount).toBe(0);
    const next = await usage.connect();
    try {
      expect((await next.query('SELECT pg_backend_pid() AS pid, current_user AS role')).rows[0]).toMatchObject({ role: 'intake_usage' });
      expect((await next.query('SELECT pg_backend_pid() AS pid')).rows[0].pid).not.toBe(pid);
    } finally { next.release(); }
  });

  it('uploads, parses, checks, publishes and serves all non-empty pages to another authenticated actor', async () => {
    const published = await publish('success');
    const used = await readAll();
    expect(used.entitlement.releaseId).toBe(published.receipt.releaseId);
    expect(used.result).toHaveLength(3);
    expect(used.result[0]!.entry.answerText).toBe('第一行。\n第二行。');
    value(await reader.authorization(actors.agent!, 'source-a', 'query'));
    expect(value(await service.publish(actors.enabler!, published.request))).toEqual(published.receipt);
    expect((await admin.query('SELECT count(*) FROM content_intake.review_bindings')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('1');
  });
  it('publishes a confirmed corrective rollback through the actual service', async () => {
    const first = await publish('first'); const second = await publish('second', rows('合成新版正文'));
    const impact = value(await service.rollbackPreview(actors.enabler!, { baseReleaseId: second.receipt.releaseId, targetReleaseId: first.receipt.releaseId }));
    const request = { operationId: 'rollback', rollbackPlanId: impact.rollbackPlanId, baseReleaseId: impact.baseReleaseId,
      targetReleaseId: impact.targetReleaseId, impactDigest: impact.impactDigest, confirmed: true };
    const receipt = value(await service.rollback(actors.enabler!, request));
    expect(receipt.releaseId).not.toBe(first.receipt.releaseId);
    expect((await readAll()).result[0]!.entry.answerText).toBe('第一行。\n第二行。');
    expect(value(await service.rollback(actors.enabler!, request))).toEqual(receipt);
  });
  it('grants through the actual allocator and invalidates saved usage after revocation', async () => {
    await publish('grant');
    value(await service.changeGrant(actors.director!, 'business-agent-query', { operationId: 'revoke-original', expectedVersion: 1, change: 'revoke', reason: '合成替换', stewardPrincipalId: null }));
    const policyVersion = Number((await admin.query('SELECT version FROM content_intake.policy_versions')).rows[0].version);
    const request = { operationId: 'grant-query', issuerFactsVersion: 1, policyVersion, items: [{ kind: 'business', recipientPrincipalId: 'agent', recipientFactsVersion: 1,
      action: 'query', scope: { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'product', sourceId: 'source-a' },
      startsAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), reason: '合成查询授权' }] };
    expect(await service.grantBatch(actors.reviewer!, request)).toMatchObject({ ok: false });
    const granted = value(await service.grantBatch(actors.director!, request));
    const used = await readAll();
    value(await service.changeGrant(actors.director!, granted.items[0]!.grantId, { operationId: 'revoke-new', expectedVersion: 1, change: 'revoke', reason: '合成撤权', stewardPrincipalId: null }));
    expect(await reader.snapshot(actors.agent!, { entitlementId: used.entitlement.entitlementId })).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED' });
    expect(await reader.issueEntitlement(actors.agent!, context)).toMatchObject({ ok: false });
  });
  it('recovers an actually committed publication after a lost COMMIT response', async () => {
    const ready = await prepared('unknown'); let publishing = false; let lost = false; const trace: string[] = [];
    const changed = configured(intercept(businessPool, async sql => {
      if (sql.includes('SELECT content_intake.publish_candidate(')) publishing = true;
      if (sql === 'COMMIT' && publishing && !lost) { lost = true; throw new Error('synthetic lost COMMIT'); }
    }, trace));
    expect(await changed.publish(actors.enabler!, ready.request)).toMatchObject({ ok: false, commit: 'unknown' });
    expect(trace.slice(-2)).toEqual(['COMMIT', 'release:true']);
    const recovered = value(await service.operationReceipt(actors.enabler!, ready.request.operationId, 'publish'));
    expect(value(await service.publish(actors.enabler!, ready.request))).toEqual(recovered);
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('1');
  });
  it('rolls back publication and its receipt if consumed permission expires before COMMIT', async () => {
    const ready = await prepared('deadline');
    await admin.query(`UPDATE content_intake.grants SET version=version+1,revoked_at=clock_timestamp(),last_change_reason='synthetic' WHERE grant_id='business-enabler-publish'`);
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
      VALUES('short','business','director','enabler','tenant-a','app-a','scope-a','source-a','publish',clock_timestamp()-interval '1 second',clock_timestamp()+interval '0.3 seconds','合成到期','director','root-publish')`);
    let wroteReceipt = false;
    const delayed = configured(intercept(businessPool, async (sql, client) => {
      if (sql.includes('INSERT INTO backend_review.receipts')) { wroteReceipt = true; await client.query('SELECT pg_sleep(0.4)'); }
    }));
    expect(await delayed.publish(actors.enabler!, ready.request)).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED', commit: 'rolled_back' });
    expect(wroteReceipt).toBe(true);
    expect((await admin.query('SELECT count(*) FROM content_intake.publications')).rows[0].count).toBe('0');
    expect(await service.operationReceipt(actors.enabler!, ready.request.operationId, 'publish')).toMatchObject({ ok: false });
  });
  it('uses the worker pool for actual parser failure and report capacity without business writes', async () => {
    const bad = rows(); bad[0]![2] = '';
    const input = await uploaded('bad', bad); const trace: string[] = [];
    const withWorker = configured(businessPool, intercept(worker, async () => undefined, trace));
    expect(await withWorker.parse(actors.enabler!, input.jobId)).toMatchObject({ ok: false, reason: 'FILE_INVALID' });
    const job = value(await service.job(actors.enabler!, input.jobId));
    expect(job.state).toBe('failed'); expect(job.reportObjectId).not.toBeNull();
    expect(trace.some(sql => sql.includes('INSERT INTO content_intake.object_reservations'))).toBe(true);
    expect(trace.some(sql => sql.includes('INSERT INTO content_intake.objects'))).toBe(true);
    expect(trace.some(sql => sql.includes('candidate_versions') || sql.includes('receipts'))).toBe(false);
  });
  it('retains report capacity after an actual worker COMMIT has an unknown response', async () => {
    const bad = rows(); bad[0]![2] = '';
    const input = await uploaded('worker-unknown', bad); const trace: string[] = []; let lost = false;
    const withWorker = configured(businessPool, intercept(worker, async sql => {
      if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('synthetic worker COMMIT lost'); }
    }, trace));
    expect(await withWorker.parse(actors.enabler!, input.jobId)).toMatchObject({ ok: false, reason: 'COMMIT_UNKNOWN', commit: 'unknown' });
    expect(trace.slice(-2)).toEqual(['COMMIT', 'release:true']);
    expect((await admin.query("SELECT state FROM content_intake.object_reservations WHERE purpose='report'")).rows).toEqual([{ state: 'reserved' }]);
  });
  // Imported historical fixture only; no current API creates approval-v1 data.
  async function legacyRelease() {
    const ready = await prepared('legacy', rows().slice(0, 1));
    const id = 'history-candidate', reviewId = 'history-review';
    await admin.query(`INSERT INTO content_intake.candidate_versions(candidate_id,version,source_id,scope_id,source_version,object_id,file_sha256,actor_id,base_release_id,
      canonical_encoding,canonical_material,material,risk,explicit_disable_count,state,source_evidence_version,approval_evidence_version,revocation_generation,created_at,updated_at,publication_policy)
      SELECT $2,version,source_id,scope_id,source_version,object_id,file_sha256,actor_id,base_release_id,canonical_encoding,canonical_material,material,risk,explicit_disable_count,
      'awaiting-evidence',0,0,0,created_at,updated_at,'approval-v1' FROM content_intake.candidate_versions WHERE candidate_id=$1`, [ready.candidate.key.candidateId, id]);
    await admin.query(`INSERT INTO content_intake.source_confirmations SELECT (jsonb_populate_record(NULL::content_intake.source_confirmations,
      to_jsonb(e)||jsonb_build_object('candidate_id',$2::text))).* FROM content_intake.source_confirmations e WHERE candidate_id=$1`, [ready.candidate.key.candidateId, id]);
    const object = await store.persist((async function* () { yield Buffer.from('synthetic historical review'); })(), 'csv');
    await admin.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES($1,'source-a','enabler','tenant-a','app-a',$2,$3,$4,'application/json','review-package',clock_timestamp()-interval '10 seconds')`, [object.objectId, `intake/${object.objectId}`, object.sha256, object.sizeBytes]);
    await admin.query(`INSERT INTO content_intake.review_bindings(review_request_id,candidate_id,candidate_version,candidate_digest,evidence_version,tenant_id,app_id,definition_id,node_id,create_uuid,instance_code,package_object_id,package_sha256,attachment_file_code)
      VALUES($1,$2,1,$3,1,'tenant-a','app-a','historical-definition','human-node',gen_random_uuid(),'historical-instance',$4,$5,'historical-attachment')`, [reviewId, id, ready.candidate.key.digest, object.objectId, object.sha256]);
    await admin.query(`INSERT INTO content_intake.approval_facts VALUES($1,1,0,'approved',clock_timestamp(),clock_timestamp()+interval '299 seconds',repeat('a',64),$2,'historical-task','reviewer',1,clock_timestamp()-interval '1 second')`, [reviewId, object.sha256]);
    await admin.query('INSERT INTO content_intake.approval_current VALUES($1,1)', [reviewId]);
    await admin.query("UPDATE content_intake.candidate_versions SET source_evidence_version=1,approval_evidence_version=1,revocation_generation=1,state='ready' WHERE candidate_id=$1", [id]);
    await admin.query("UPDATE content_intake.candidate_versions SET state='publishing' WHERE candidate_id=$1", [id]);
    await admin.query("UPDATE content_intake.candidate_versions SET state='published' WHERE candidate_id=$1", [id]);
    await admin.query('BEGIN'); await admin.query("SELECT set_config('app.publishing','on',true)");
    await admin.query(`INSERT INTO public.content_releases(release_id,release_seq,title,status,source_binding_hash,tenant_id)
      SELECT 'rel_history',nextval('public.content_release_seq'),'合成历史目录','published',source_binding_hash,tenant_id FROM public.content_releases WHERE release_id='rel_native_base'`);
    await admin.query("INSERT INTO public.release_source_bindings SELECT 'rel_history',domain,source_version_id FROM public.release_source_bindings WHERE release_id='rel_native_base'");
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES('rel_history','intake-v2.1')");
    await admin.query(`INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy)
      VALUES('rel_history','source-a','faq-one',1,$1,1,$2,'infinity','approval-v1')`, [id, reviewId]);
    await admin.query("UPDATE public.content_current SET current_release_id='rel_history' WHERE id=1"); await admin.query('COMMIT');
    return reviewId;
  }
  it.each(['revoked', 'expired'] as const)('keeps a real-shaped historical %s approval unavailable to reads and rollback', async state => {
    const reviewId = await legacyRelease();
    const old = await readAll(); expect(old.result).toHaveLength(1);
    const current = await publish('after-history');
    await admin.query(`INSERT INTO content_intake.approval_facts SELECT (jsonb_populate_record(NULL::content_intake.approval_facts,to_jsonb(f)||jsonb_build_object(
      'facts_version',facts_version+1,'revocation_generation',revocation_generation+1,'state',$2::text,
      'decided_at',clock_timestamp()-interval '3 seconds','checked_at',clock_timestamp()-interval '2 seconds',
      'valid_until',CASE WHEN $3 THEN clock_timestamp()-interval '1 second' ELSE clock_timestamp()+interval '297 seconds' END))).*
      FROM content_intake.approval_current p JOIN content_intake.approval_facts f USING(review_request_id,facts_version) WHERE review_request_id=$1`, [reviewId, state === 'revoked' ? 'revoked' : 'approved', state === 'expired']);
    await admin.query('UPDATE content_intake.approval_current SET facts_version=facts_version+1 WHERE review_request_id=$1', [reviewId]);
    expect(await reader.snapshot(actors.agent!, { entitlementId: old.entitlement.entitlementId })).toMatchObject({ ok: false, reason: 'APPROVAL_UNAVAILABLE' });
    expect(await service.rollbackPreview(actors.enabler!, { baseReleaseId: current.receipt.releaseId, targetReleaseId: 'rel_history' }))
      .toMatchObject({ ok: false, reason: 'APPROVAL_UNAVAILABLE' });
    expect((await readAll()).result).toHaveLength(3);
  });
  it('refuses cloned actors and wrong-purpose writes while leaving root allocations and identity protected', async () => {
    await expect(usage.query("SELECT intake_runtime.assert_purpose('business')")).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query("SELECT intake_runtime.assert_purpose('usage')")).rejects.toMatchObject({ code: '42501' });
    expect(await reader.issueEntitlement({ ...actors.agent! }, context)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    const rawRoot = `INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
      VALUES('forged-root','allocation','director','director','tenant-a','app-a','scope-a','publish',clock_timestamp(),clock_timestamp()+interval '1 hour','x','director')`;
    await expect(business.query(rawRoot)).rejects.toMatchObject({ code: '42501' });
    await expect(business.query("UPDATE content_intake.grants SET version=version+1,last_change_reason='forged' WHERE grant_id='root-publish'")).rejects.toMatchObject({ code: '42501' });
    const reservation = (purpose: string) => `INSERT INTO content_intake.object_reservations
      (object_id,tenant_id,app_id,actor_id,source_id,purpose,reserved_bytes,state)
      VALUES('obj_${'f'.repeat(64)}','tenant-a','app-a','enabler','source-a','${purpose}',10,'reserved')`;
    await expect(worker.query(reservation('input'))).rejects.toMatchObject({ code: '42501', message: 'WORKER_RESERVATION_PURPOSE' });
    await expect(business.query(reservation('report'))).rejects.toMatchObject({ code: '42501', message: 'BUSINESS_RESERVATION_PURPOSE' });
    for (const pool of [business, usage, worker]) {
      await expect(pool.query("UPDATE backend_identity.subject_bindings SET enabled=true WHERE user_id='user-agent'")).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query("UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='agent'")).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('SET ROLE intake_runtime_fn_owner')).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('INSERT INTO content_intake.principal_facts DEFAULT VALUES')).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('INSERT INTO content_intake.publications DEFAULT VALUES')).rejects.toMatchObject({ code: '42501' });
    }
    for (const pool of [usage, worker, organization]) {
      await expect(pool.query("INSERT INTO content_intake.quality_plans DEFAULT VALUES")).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query("SELECT content_intake.publish_candidate('enabler','{}','null')")).rejects.toMatchObject({ code: '42501' });
    }
    await expect(business.query("UPDATE public.content_current SET current_release_id='forged'")).rejects.toMatchObject({ code: '42501' });
    await expect(business.query("INSERT INTO backend_review.receipts VALUES('user-director','decision','forged','a','{}')")).rejects.toMatchObject({ code: '42501' });
    await admin.query('UPDATE backend_identity.sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1', [authenticatedProductSession(actors.agent!)!]);
    expect(await reader.issueEntitlement(actors.agent!, context)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });
});
