import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations, verifyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createSyntheticSopWorkbook } from '@customer-agent/content-intake';
import type { components } from '@customer-agent/contracts';
import type { AuthenticatedUser, ProductAuthService } from '../src/auth-service.js';
import { createProductAuthService } from '../src/product-auth-service.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { createIntakeTransactions, type IntakePool, type IntakeResult } from '../src/content-intake/transaction.js';
import { canonical, digest } from '../src/content-intake/material.js';
import { createIntakeUsage } from '../src/content-intake/usage.js';
import { contentIntakeUsageRoutes } from '../src/content-intake/usage-http.js';
import { createIntakePurposePool, type IntakePurposePool } from '../src/content-intake/runtime-pool.js';
import { discardPreviews } from '../src/content-intake/linked-preview.js';
import { createTrustedSopStage } from '../experiments/sop-row-deletion/trusted-stage.js';
import { createSopRowDeletionCandidate } from '../experiments/sop-row-deletion/consumer.js';
import { createSopPreviewReader } from '../experiments/sop-row-deletion/persistent-media.js';
import { parseImportFile, parkedRowPayload, qualityTargets, selectionManifestHash } from '../src/content-normalize.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';
import { seedContentWriteAuthority } from './support/write-authority.js';

type C = components['schemas'];
const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const actor = (id = 'enabler'): AuthenticatedUser => ({ user_id: `user-${id}`, role: 'owner', auth_mode: 'mock' });
function value<T>(result: IntakeResult<T>): T {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}


describe.skipIf(!enabled)('Versioned SOP durable media: real publication and cold HTTP preview', () => {
  let pg: Pg15Harness, admin: Client, business: IntakePurposePool, usagePool: IntakePurposePool;
  let store: ReturnType<typeof createContentObjectStore>, service: ReturnType<typeof createContentIntakeService>;
  let stage: ReturnType<typeof createTrustedSopStage>, auth: ProductAuthService, http: FastifyInstance | undefined;
  let token: string;
  const diagnostics: unknown[] = [];

  beforeEach(async () => {
    diagnostics.length = 0;
    pg = new Pg15Harness(); pg.start();
    const db = pg.createDatabase('sop_media_delivery');
    admin = await pg.connect(db.config);
    await applyDatabaseMigrations(admin);
    await seedIntakeSyntheticHost(admin, 'product', 'xlsx', true);
    // The intake read path and the legacy publisher both read authorization_sources now.
    await seedContentWriteAuthority(admin, {
      tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a',
      signer: { principalId: 'media-signer', userId: 'user-media-signer', jobId: 'job-media-director', role: 'director' },
      recipients: [
        { principalId: 'media-director', userId: 'user-director', jobId: 'job-media-director', role: 'director' },
        { principalId: 'media-enabler', userId: 'user-enabler', jobId: 'job-media-lead', role: 'lead' },
        { principalId: 'media-reviewer', userId: 'user-reviewer', jobId: 'job-media-supervisor', role: 'supervisor' },
        { principalId: 'media-agent', userId: 'user-agent', jobId: 'job-media-agent', role: 'agent' },
      ],
      domains: ['aftersale', 'campaign', 'presale', 'product'],
      actions: ['query', 'import', 'source-confirm', 'content-manage', 'publish', 'rollback'],
      query: true,
      idPrefix: 'sop',
      extraSources: [{ scopeId: 'scope-a', sourceId: 'source-sop', domain: 'product' }],
    });
    expect(await verifyDatabaseMigrations(admin)).toMatchObject({ status: 'PASS', migrationCount: 53 });
    await admin.query(`CREATE ROLE sop_media_business LOGIN NOINHERIT; GRANT intake_business TO sop_media_business;
      CREATE ROLE sop_media_usage LOGIN NOINHERIT; GRANT intake_usage TO sop_media_usage;
      CREATE ROLE sop_media_auth LOGIN NOINHERIT; GRANT app_backend_auth TO sop_media_auth`);
    business = createIntakePurposePool({ ...db.config, user: 'sop_media_business', max: 4 }, 'business');
    usagePool = createIntakePurposePool({ ...db.config, user: 'sop_media_usage', max: 4 }, 'usage');
    store = createContentObjectStore(path.join(pg.root, 'objects'));
    service = createContentIntakeService(business, store, (_id, error) => diagnostics.push(error));
    stage = createTrustedSopStage(business, store, false);
    auth = await createProductAuthService({
      connectionString: `postgresql://sop_media_auth@localhost/${db.name}?${new URLSearchParams({ host: pg.socket, port: String(pg.port) })}`,
      poolMax: 2, connectionTimeoutMs: 2000, readinessTimeoutMs: 3000,
    }, { authorizeUrl: state => `http://127.0.0.1:45000/authorize?state=${state}`, exchange: async code => code, close: () => undefined }, 'mock');
    const verifier = 'v'.repeat(43);
    const login = await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
    await auth.callback(new URL(login.authorize_url).searchParams.get('state')!, 'agent');
    const session = await auth.exchange(login.login_id, verifier);
    expect(session).not.toBeNull(); token = session!.access_token;
  }, 60_000);

  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of [() => http?.close(), () => auth?.close(), () => business?.end(), () => usagePool?.end(), () => admin?.end(), () => pg?.stop()]) {
      try { await close(); } catch (error) { failures.push(error); }
    }
    http = undefined;
    if (failures.length) throw new AggregateError(failures, 'SOP media fixture cleanup failed');
  });

  async function freeze(name: string, options: Parameters<typeof createSyntheticSopWorkbook>[0] = {}, baseReleaseId = 'rel_native_base',
    decorateMaterial?: (material: C['IntakeMaterial']) => void) {
    const workbook = await createSyntheticSopWorkbook(options);
    const form = new FormData(); form.set('operationId', `${name}-upload`);
    form.set('file', new Blob([new Uint8Array(workbook.bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
    const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    const object = value(await service.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
    const job = value(await service.receive(actor(), 'source-sop', { operationId: `${name}-receive`, objectId: object.objectId,
      sourceVersion: 1, baseReleaseId, contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    // The workbook parser intentionally assigns no product/scenario conditions.
    // These reader-boundary fixtures supply synthetic trusted material to the
    // real freeze SQL; they do not claim XLSX column-to-condition import support.
    const fixturePool: IntakePool = { async connect() {
      const client = await business.connect();
      return new Proxy(client, { get(target, property) {
        if (property === 'query') return async (sql: string, args?: unknown[]) => {
          if (decorateMaterial && sql.startsWith('SELECT content_intake.freeze_sop_parsed_candidate')) {
            const parameters = [...args!], material = JSON.parse(parameters[2] as string) as C['IntakeMaterial'];
            decorateMaterial(material);
            parameters[2] = JSON.stringify(material);
            const media = JSON.parse(parameters[4] as string); media.materialDigest = digest(canonical(material)); parameters[4] = JSON.stringify(media);
            return target.query(sql, parameters);
          }
          return target.query(sql, args);
        };
        const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
      } });
    } };
    const freezeStage = decorateMaterial ? createTrustedSopStage(fixturePool, store, false) : stage;
    return { candidate: value(await freezeStage(actor(), job.jobId)), workbook, job };
  }

  async function publish(key: C['IntakeCandidate']['key'], name: string, baseReleaseId = 'rel_native_base') {
    const material = (await admin.query('SELECT material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2', [key.candidateId, key.version])).rows[0].material;
    value(await service.confirmSource(actor(), { operationId: `${name}-source`, key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: name, acquisition: 'controlled-synthetic-export', objectSha256: material.object.sha256, reason: '合成确认' }));
    value(await service.freezeQuality(actor('reviewer'), { operationId: `${name}-quality-freeze`, key }));
    const quality = value(await service.qualityPreview(actor('reviewer'), key));
    value(await service.checkQuality(actor('reviewer'), { operationId: `${name}-quality-check`, key, phase: 'initial',
      checks: quality.population.filter(row => quality.initialScriptIds.includes(row.script_id)).map(row => ({ scriptId: row.script_id, contentHash: row.content_hash, defect: false, reason: '' })) }));
    const result = value(await service.publish(actor(), { operationId: `${name}-publish`, key, baseReleaseId, sourceEvidenceVersion: 1,
      confirmed: true, title: '合成图片发布', summary: '合成图片发布' }));
    expect(result.releaseId).toBeTruthy();
    return result.releaseId!;
  }

  async function restartReader(afterRead?: (bytes: Buffer) => Promise<void>) {
    if (http) await http.close();
    const keys = await admin.query<{ key: string }>(`SELECT release_id AS key FROM public.content_releases
      UNION SELECT candidate_id FROM content_intake.candidate_versions UNION SELECT object_id FROM content_intake.objects`);
    for (const { key } of keys.rows) discardPreviews(key);
    const coldStore = createContentObjectStore(store.rootDirectory);
    const report = (_id: string, error: unknown) => diagnostics.push(error);
    const reader = createSopPreviewReader(coldStore);
    const usage = createIntakeUsage(createIntakeTransactions(usagePool, report, { requireProductSession: true }), {
      list: reader.list,
      async read(item) { const bytes = await reader.read(item); await afterRead?.(bytes); return bytes; },
    });
    http = Fastify({ logger: false });
    await http.register(contentIntakeUsageRoutes, { auth, usage: { ...createContentIntakeService(usagePool, coldStore, report, undefined, { requireProductSession: true }), ...usage }, report });
    await http.ready();
  }
  async function entitlement(productIds: string[] = []) {
    const response = await http!.inject({ method: 'POST', url: '/v1/intake/entitlements', headers: { authorization: `Bearer ${token}` },
      payload: { shopId: 'shop-a', releaseId: null, contextGeneration: 1, productIds, scenarioIds: [] } });
    expect(response.statusCode, response.body + JSON.stringify(diagnostics)).toBe(200);
    return response.json<C['IntakeEntitlement']>();
  }
  async function preview(entitlementId: string, objectId?: string) {
    const query = new URLSearchParams({ entitlementId, ...(objectId ? { objectId } : {}) });
    return http!.inject({ method: 'GET', url: `/v1/intake/preview?${query}`, headers: { authorization: `Bearer ${token}` } });
  }

  async function prepareLegacyPublish(base: string) {
    const batch = 'batch_media_legacy', job = 'job_media_legacy', plan = 'qplan_media_legacy';
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    const csv = Buffer.from('script_id,category,title,answer_text,source_version_id,source_ref,question_text,risk_level,has_conflict\n'
      + 'legacy-presale-media,presale,合成售前,合成售前说明,srcv_pub_presale,SRC-SYNTH-PUB-PRESALE,合成售前问题,low,false\n');
    const rows = parseImportFile(csv, 'csv', { intentTaxonomyVersion: 'itax_media_legacy', intentId: 'intent_media_legacy', orgReviewedBatchId: batch })
      .map(row => ({ ...row, staging_id: `stg_${hash(`${batch}:${row.staging_id}`)}` }));
    const ordinary = rows.filter(row => row.risk_level !== 'high' && !row.has_conflict).length;
    const targets = qualityTargets(ordinary), seed = hash(`seed:${batch}:${job}`), json = JSON.stringify(rows.map(parkedRowPayload));
    await admin.query(`INSERT INTO public.intent_taxonomy_versions(intent_taxonomy_version,approval_evd,approved_by,approved_at)
      VALUES ('itax_media_legacy','EVD-MEDIA-LEGACY-TAXONOMY','synthetic-owner',clock_timestamp());
      INSERT INTO public.intent_taxonomy_entries(intent_taxonomy_version,intent_id,label,lifecycle)
      VALUES ('itax_media_legacy','intent_media_legacy','合成售前','active')`);
    // Admin creates only the synthetic pre-worker fixture under the same binding fence.
    await admin.query('BEGIN');
    await admin.query("SELECT set_config('app.import_binding_write','on',true)");
    await admin.query(`INSERT INTO public.import_batches(import_batch_id,source_type,source_binding_hash,status,base_release_id,tenant_id,actor_user_id,actor_role)
      SELECT $1,'csv',source_binding_hash,'validating',release_id,'tenant-a','user-director','owner'
      FROM public.content_releases WHERE release_id=$2`, [batch, base]);
    await admin.query("INSERT INTO public.import_batch_source_bindings(import_batch_id,domain,source_version_id) VALUES ($1,'presale','srcv_pub_presale')", [batch]);
    await admin.query(`INSERT INTO public.outbox_jobs(job_id,job_type,payload,status,lease_owner,lease_version,lease_expires_at)
      VALUES ($1,'import_validate',jsonb_build_object('import_batch_id',$2::text),'running','media-legacy-fixture',1,clock_timestamp()+interval '60 seconds')`, [job, batch]);
    await admin.query('COMMIT');
    // Exercise the existing normalization and quality functions. This is a
    // synthetic old-contract fixture, not a new SOP approval requirement.
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE app_backend_worker');
      await admin.query(`SELECT * FROM public.freeze_content_quality_review_plan(
        $1,'media-legacy-fixture',1,$2,$3,'quality-sampling-v1',clock_timestamp(),$4,$5,$6,$7,$8,'sha256-ranked-v1',$9::jsonb)`,
      [job, batch, plan, rows.length, ordinary, rows.length - ordinary, seed, selectionManifestHash(rows, seed, targets.initial, targets.expanded), json]);
      await admin.query("SELECT public.record_org_reviewed_quality_evidence($1,'media-legacy-fixture',1,$2,$3,$4::jsonb)", [job, batch, plan, json]);
      await admin.query("SELECT public.finalize_org_reviewed_import_validation($1,'media-legacy-fixture',1,$2,$3::jsonb)", [job, batch, json]);
      await admin.query('COMMIT');
    } catch (error) { await admin.query('ROLLBACK'); throw error; }
    expect((await admin.query('SELECT status FROM public.import_batches WHERE import_batch_id=$1', [batch])).rows[0].status).toBe('staged');
    return batch;
  }
  async function legacyPublish(batch: string) {
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE app_content_admin');
      const result = await admin.query("SELECT * FROM public.publish_content_release($1,'合成旧发布继承','合成非SOP域更新','user-director','owner')", [batch]);
      await admin.query('COMMIT');
      return result.rows[0].release_id as string;
    } catch (error) { await admin.query('ROLLBACK'); throw error; }
  }
  async function mediaRelations(releaseId: string) {
    return (await admin.query(`SELECT to_jsonb(m)-'release_id' AS relation
      FROM content_intake.sop_release_media m WHERE release_id=$1 ORDER BY row_id,ordinal`, [releaseId])).rows;
  }

  it('inherits SOP images through the versioned legacy publisher and serves the new release cold', async () => {
    const { candidate, workbook } = await freeze('legacy-inherit', { sameImageOnLastTextRow: true });
    const r1 = await publish(candidate.key, 'legacy-inherit');
    const before = await mediaRelations(r1);
    const adopted = (await admin.query('SELECT media_object_id,adopted_at FROM content_intake.sop_media_objects ORDER BY media_object_id')).rows;
    const lineage = (await admin.query("SELECT to_jsonb(l)-'release_id' AS lineage FROM content_intake.release_lineage l WHERE release_id=$1 ORDER BY business_entry_id", [r1])).rows;
    const r2 = await legacyPublish(await prepareLegacyPublish(r1));
    expect(r2).not.toBe(r1);
    expect((await admin.query('SELECT current_release_id FROM public.content_current')).rows[0].current_release_id).toBe(r2);
    expect((await admin.query('SELECT tenant_id FROM public.content_releases WHERE release_id=$1', [r2])).rows[0].tenant_id).toBe('tenant-a');
    expect((await admin.query("SELECT answer_text FROM public.release_items WHERE release_id=$1 AND script_id='legacy-presale-media'", [r2])).rows).toEqual([{ answer_text: '合成售前说明' }]);
    expect(await mediaRelations(r2)).toEqual(before); expect(before).toHaveLength(2);
    expect((await admin.query("SELECT to_jsonb(l)-'release_id' AS lineage FROM content_intake.release_lineage l WHERE release_id=$1 ORDER BY business_entry_id", [r2])).rows).toEqual(lineage);
    expect((await admin.query('SELECT media_object_id,adopted_at FROM content_intake.sop_media_objects ORDER BY media_object_id')).rows).toEqual(adopted);
    await restartReader();
    const lease = await entitlement(); expect(lease.releaseId).toBe(r2);
    const listed = await preview(lease.entitlementId); expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    const opened = await preview(lease.entitlementId, listed.json().items[0].objectId);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(Buffer.from(opened.json().bytesBase64, 'base64')).toEqual(workbook.png);
  }, 60_000);

  it('rolls back the entire legacy publication when inherited SOP row mapping is missing', async () => {
    const { candidate } = await freeze('legacy-fault', { sameImageOnLastTextRow: true });
    const r1 = await publish(candidate.key, 'legacy-fault');
    const batch = await prepareLegacyPublish(r1);
    const tables = ['public.content_current', 'public.content_releases', 'public.announcements', 'public.scripts', 'public.release_items',
      'content_intake.release_catalogs', 'content_intake.release_lineage', 'content_intake.sop_release_media'];
    const snapshot = async () => {
      const result = [];
      for (const table of tables) result.push((await admin.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows);
      return result;
    };
    // Real metadata fault, not a replacement SQL return or a disabled trigger.
    // SQL cannot detect missing physical files; cold-reader tests cover those.
    await admin.query('DELETE FROM content_intake.sop_candidate_rows WHERE candidate_id=$1 AND candidate_version=$2 AND row_id=$3',
      [candidate.key.candidateId, candidate.key.version, 'sop:过敏流程SOP:2']);
    const before = await snapshot();
    await expect(legacyPublish(batch)).rejects.toMatchObject({ code: 'ZA003' });
    expect(await snapshot()).toEqual(before);
    expect((await admin.query('SELECT status FROM public.import_batches WHERE import_batch_id=$1', [batch])).rows[0].status).toBe('staged');
  }, 60_000);

  it('keeps two rows of one physical image through publication and serves it after all preview maps are cleared', async () => {
    const { candidate, workbook } = await freeze('shared', { sameImageOnLastTextRow: true });
    const refs = (await admin.query('SELECT row_id,media_object_id,ordinal FROM content_intake.sop_candidate_media WHERE candidate_id=$1 AND candidate_version=$2 ORDER BY row_id', [candidate.key.candidateId, candidate.key.version])).rows;
    expect(refs).toHaveLength(2);
    expect(new Set(refs.map(row => row.row_id)).size).toBe(2);
    expect(new Set(refs.map(row => row.media_object_id)).size).toBe(1);
    expect(refs.every(row => row.ordinal === 1)).toBe(true);
    expect((await admin.query("SELECT count(*)::int n FROM content_intake.objects WHERE purpose='sop-media'")).rows[0].n).toBe(1);
    const releaseId = await publish(candidate.key, 'shared');
    expect((await admin.query('SELECT row_id,media_object_id,ordinal FROM content_intake.sop_release_media WHERE release_id=$1 ORDER BY row_id', [releaseId])).rows).toEqual(refs);
    expect((await admin.query('SELECT state FROM content_intake.sop_media_objects')).rows).toEqual([{ state: 'adopted' }]);
    await restartReader();
    const lease = await entitlement();
    const listed = await preview(lease.entitlementId);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(listed.body).not.toContain('payloadObjectId'); expect(listed.body).not.toContain('obj_');
    const image = await preview(lease.entitlementId, refs[0].media_object_id);
    expect(image.statusCode, image.body).toBe(200);
    expect(image.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(image.json().bytesBase64, 'base64')).toEqual(workbook.png);
  }, 60_000);

  it('deletes one unused row without discarding another row that uses the same image', async () => {
    const { candidate } = await freeze('shared-delete', { sameImageOnLastTextRow: true });
    const next = value(await createSopRowDeletionCandidate(business, false)(actor(), { key: candidate.key, rowId: 'sop:过敏流程SOP:2', operationId: 'shared-delete-row' }));
    expect((await admin.query('SELECT row_id FROM content_intake.sop_candidate_media WHERE candidate_id=$1 AND candidate_version=$2', [next.key.candidateId, next.key.version])).rows).toEqual([{ row_id: 'sop:品质售后SOP:2' }]);
    expect((await admin.query('SELECT state FROM content_intake.sop_media_objects')).rows).toEqual([{ state: 'staged' }]);
    const releaseId = await publish(next.key, 'shared-delete');
    expect((await admin.query('SELECT row_id FROM content_intake.sop_release_media WHERE release_id=$1', [releaseId])).rows).toEqual([{ row_id: 'sop:品质售后SOP:2' }]);
  }, 60_000);

  it.each(['corrupted', 'missing'] as const)('rejects %s durable bytes instead of borrowing the former preview cache', async fault => {
    const { candidate } = await freeze('corruption');
    await publish(candidate.key, 'corruption');
    await restartReader();
    const lease = await entitlement();
    const row = (await admin.query('SELECT media_object_id,payload_object_id FROM content_intake.sop_media_objects')).rows[0];
    const intact = await preview(lease.entitlementId, row.media_object_id);
    expect(intact.statusCode, intact.body).toBe(200);
    const file = path.join(store.rootDirectory, 'objects', row.payload_object_id);
    if (fault === 'missing') rmSync(file);
    else writeFileSync(file, Buffer.from('synthetic corruption'));
    const response = await preview(lease.entitlementId, row.media_object_id);
    expect(response.statusCode).not.toBe(200);
    expect(response.body).not.toContain('bytesBase64');
  }, 60_000);

  it('copies exact historical image bindings through actual rollback while old valid leases keep their release', async () => {
    const first = await freeze('rollback-one');
    const r1 = await publish(first.candidate.key, 'rollback-one');
    const oldRelations = (await admin.query('SELECT row_id,media_object_id,sha256 FROM content_intake.sop_release_media WHERE release_id=$1 ORDER BY row_id', [r1])).rows;
    await restartReader();
    const oldLease = await entitlement();
    const second = await freeze('rollback-two', { replaceFirstImage: true, textSuffix: '新版' }, r1);
    const r2 = await publish(second.candidate.key, 'rollback-two', r1);
    expect((await admin.query('SELECT sha256 FROM content_intake.sop_release_media WHERE release_id=$1', [r2])).rows[0].sha256).not.toBe(oldRelations[0].sha256);
    await restartReader();
    const oldImage = await preview(oldLease.entitlementId, oldRelations[0].media_object_id);
    expect(oldImage.statusCode, oldImage.body).toBe(200);
    expect(Buffer.from(oldImage.json().bytesBase64, 'base64')).toEqual(first.workbook.png);
    const plan = value(await service.rollbackPreview(actor(), { baseReleaseId: r2, targetReleaseId: r1 }));
    const rolled = value(await service.rollback(actor(), { operationId: 'media-rollback', rollbackPlanId: plan.rollbackPlanId,
      baseReleaseId: r2, targetReleaseId: r1, impactDigest: plan.impactDigest, confirmed: true }));
    expect(rolled.releaseId).toBeTruthy();
    expect((await admin.query('SELECT row_id,media_object_id,sha256 FROM content_intake.sop_release_media WHERE release_id=$1 ORDER BY row_id', [rolled.releaseId])).rows).toEqual(oldRelations);
    await restartReader();
    const lease = await entitlement();
    expect(lease.releaseId).toBe(rolled.releaseId);
    const image = await preview(lease.entitlementId, oldRelations[0].media_object_id);
    expect(image.statusCode, image.body).toBe(200);
    expect(Buffer.from(image.json().bytesBase64, 'base64')).toEqual(first.workbook.png);
    const answers = (await admin.query(`SELECT e->>'answerText' AS answer FROM content_intake.release_lineage l
      JOIN content_intake.candidate_versions v ON v.candidate_id=l.candidate_id AND v.version=l.candidate_version
      CROSS JOIN LATERAL jsonb_array_elements(v.material->'entries') e
      WHERE l.release_id=$1 AND e->>'businessEntryId'=l.business_entry_id`, [rolled.releaseId])).rows;
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every(row => !row.answer.includes('新版'))).toBe(true);
  }, 60_000);

  it('inherits a missing row and its image from durable lineage after reconstructing the parser and store', async () => {
    const first = await freeze('inherit-one', { imageOnFinalRow: true });
    const r1 = await publish(first.candidate.key, 'inherit-one');
    const original = (await admin.query("SELECT row_id,media_object_id,sha256 FROM content_intake.sop_release_media WHERE release_id=$1 AND row_id='sop:长痘痘SOP:1'", [r1])).rows;
    expect(original).toHaveLength(1);
    await restartReader();
    store = createContentObjectStore(store.rootDirectory);
    stage = createTrustedSopStage(business, store, false);
    const second = await freeze('inherit-two', { omitLastTextRow: true }, r1);
    expect((await admin.query("SELECT row_id,media_object_id,sha256 FROM content_intake.sop_candidate_media WHERE candidate_id=$1 AND candidate_version=$2 AND row_id='sop:长痘痘SOP:1'", [second.candidate.key.candidateId, second.candidate.key.version])).rows).toEqual(original);
    const r2 = await publish(second.candidate.key, 'inherit-two', r1);
    await restartReader();
    const lease = await entitlement();
    expect(lease.releaseId).toBe(r2);
    const image = await preview(lease.entitlementId, original[0].media_object_id);
    expect(image.statusCode, image.body).toBe(200);
    expect(createHash('sha256').update(Buffer.from(image.json().bytesBase64, 'base64')).digest('hex')).toBe(original[0].sha256);
  }, 60_000);

  it.each(['unchanged', 'revoked'] as const)('releases the content lock while reading preview bytes and rechecks %s access', async change => {
    const { candidate } = await freeze(`unlocked-read-${change}`);
    await publish(candidate.key, `unlocked-read-${change}`);
    let reads = 0, lockAcquired = false;
    await restartReader(async bytes => {
      expect(bytes.length).toBeGreaterThan(0); reads++;
      await admin.query('BEGIN');
      try {
        await admin.query("SET LOCAL lock_timeout='100ms'");
        await admin.query('SELECT backend_review.lock_content()');
        lockAcquired = true;
        if (change === 'revoked') await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成读图间撤权' WHERE grant_id='sop-media-agent-source-sop-query'");
        await admin.query('COMMIT');
      } catch (error) { await admin.query('ROLLBACK'); throw error; }
    });
    const ent = await entitlement();
    const listed = await preview(ent.entitlementId); expect(listed.statusCode, listed.body).toBe(200);
    expect(reads).toBe(0);
    const response = await preview(ent.entitlementId, listed.json().items[0].objectId);
    expect(lockAcquired).toBe(true); expect(reads).toBe(1);
    if (change === 'unchanged') {
      expect(response.statusCode, response.body).toBe(200);
      expect(Buffer.from(response.json().bytesBase64, 'base64').length).toBeGreaterThan(0);
    } else {
      expect(response.statusCode, response.body).toBe(403);
      expect(response.body).not.toContain('bytesBase64');
      expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN', details: { reason: 'PERMISSION_CHANGED' } } });
    }
  });

  it('refuses a formerly valid preview after query permission is revoked', async () => {
    const { candidate } = await freeze('revoked');
    await publish(candidate.key, 'revoked');
    await restartReader();
    const lease = await entitlement();
    const listed = await preview(lease.entitlementId);
    expect(listed.statusCode, listed.body).toBe(200);
    await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成撤权' WHERE grant_id='sop-media-agent-source-sop-query'");
    const response = await preview(lease.entitlementId, listed.json().items[0].objectId);
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('bytesBase64');
  }, 60_000);
  it('filters row applicability before deduplicating shared durable media, and never reads hidden bytes', async () => {
    for (const id of ['prod-hidden', 'prod-visible', 'prod-none']) {
      await admin.query("INSERT INTO content_intake.vocabulary VALUES ($1,'scope-a','product',repeat('a',64),true)", [id]);
      await admin.query("INSERT INTO content_intake.vocabulary_displays VALUES ($1,1,'合成条件')", [id]);
    }
    const { candidate, workbook } = await freeze('filtered-media', { sameImageOnLastTextRow: true }, 'rel_native_base', material => {
      for (const entry of material.entries) {
        if (entry.businessEntryId === 'sop2') entry.productRefs = [{ id: 'prod-visible', displayVersion: 1 }];
        if (entry.businessEntryId === 'sop6') entry.productRefs = [{ id: 'prod-hidden', displayVersion: 1 }];
      }
    });
    await publish(candidate.key, 'filtered-media');
    let reads = 0;
    await restartReader(async () => { reads++; });
    const selected = await entitlement(['prod-visible']);
    const response = await preview(selected.entitlementId);
    expect(response.statusCode, response.body).toBe(200);
    const items = response.json<{ items: { objectId: string }[] }>().items;
    expect(items).toHaveLength(1); expect(reads).toBe(0);
    // Verify the database reader's first physical relation is the invisible one.
    const rows = (await admin.query(`SELECT r.business_entry_id FROM content_intake.sop_release_media m
      JOIN content_intake.sop_candidate_rows r ON r.candidate_id=m.candidate_id AND r.candidate_version=m.candidate_version AND r.row_id=m.row_id
      WHERE m.release_id=$1 ORDER BY m.source_id,m.row_id,m.ordinal,m.media_object_id`, [selected.releaseId])).rows;
    expect(rows.map(row => row.business_entry_id)).toEqual(['sop6', 'sop2']);
    const opened = await preview(selected.entitlementId, items[0]!.objectId);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(Buffer.from(opened.json().bytesBase64, 'base64')).toEqual(workbook.png); expect(reads).toBe(1);
    const hidden = await entitlement(['prod-none']);
    expect((await preview(hidden.entitlementId)).json()).toEqual({ items: [] });
    const denied = await preview(hidden.entitlementId, items[0]!.objectId);
    expect(denied.statusCode, denied.body).toBe(404); expect(denied.body).not.toContain('bytesBase64'); expect(reads).toBe(1);
  });

  it.each(['future', 'expired', 'disabled'] as const)('does not expose durable images contributed only by %s rows', async boundary => {
    const { candidate } = await freeze(`image-time-${boundary}`, { sameImageOnLastTextRow: true }, 'rel_native_base', material => {
      for (const entry of material.entries.filter(row => ['sop2', 'sop6'].includes(row.businessEntryId))) {
        entry.effectiveFrom = boundary === 'future' ? '2098-01-01T00:00:00Z' : '2020-01-01T00:00:00Z';
        entry.effectiveTo = boundary === 'expired' ? '2021-01-01T00:00:00Z' : null;
        if (boundary === 'disabled') entry.operation = 'disable';
      }
    });
    const mediaId = (await admin.query('SELECT media_object_id FROM content_intake.sop_candidate_media WHERE candidate_id=$1 LIMIT 1', [candidate.key.candidateId])).rows[0].media_object_id;
    await publish(candidate.key, `image-time-${boundary}`);
    let reads = 0; await restartReader(async () => { reads++; });
    const ent = await entitlement();
    const listed = await preview(ent.entitlementId); expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toEqual({ items: [] });
    const opened = await preview(ent.entitlementId, mediaId); expect(opened.statusCode, opened.body).toBe(404);
    expect(opened.body).not.toContain('bytesBase64'); expect(reads).toBe(0);
  });

  it.each(['grant', 'lease'] as const)('does not return bytes when %s expires during a real persistent file read', async expiry => {
    const { candidate } = await freeze(`read-deadline-${expiry}`);
    await publish(candidate.key, `read-deadline-${expiry}`);
    if (expiry === 'grant') {
      await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成短授权' WHERE grant_id='sop-media-agent-source-sop-query'");
      await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
        to_jsonb(g)||jsonb_build_object('grant_id','short-media-query','version',1,'last_change_reason',NULL,'revoked_at',NULL,
          'expires_at',clock_timestamp()+interval '2 seconds'))).*
        FROM content_intake.grants g WHERE grant_id='sop-media-agent-source-sop-query'`);
    } else {
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('agent',2,ARRAY['dept-a'],'job-agent',true,
        clock_timestamp(),clock_timestamp()+interval '2 seconds',repeat('b',64))`);
      await admin.query("UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='agent'");
    }
    let openedBytes = false, deadline = '';
    await restartReader(async bytes => {
      expect(bytes.length).toBeGreaterThan(0); openedBytes = true;
      await admin.query("SELECT pg_sleep(greatest(0,extract(epoch FROM $1::timestamptz-clock_timestamp()))+0.05)", [deadline]);
    });
    const ent = await entitlement(); deadline = ent.validUntil;
    const images = await preview(ent.entitlementId); expect(images.statusCode, images.body).toBe(200);
    const mediaId = images.json<{ items: { objectId: string }[] }>().items[0]!.objectId;
    if (expiry === 'lease') {
      // Renew the facts, not the immutable lease. The final refusal must still
      // respect the lease acquired before renewal rather than this new deadline.
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('agent',3,ARRAY['dept-a'],'job-agent',true,
        clock_timestamp(),clock_timestamp()+interval '299 seconds',repeat('c',64))`);
      await admin.query("UPDATE content_intake.principals SET current_facts_version=3 WHERE principal_id='agent'");
    }
    const response = await preview(ent.entitlementId, mediaId);
    expect(openedBytes).toBe(true);
    expect(response.statusCode, response.body).toBe(403); expect(response.body).not.toContain('bytesBase64');
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN', details: { reason: 'PERMISSION_CHANGED' } } });
  });

});
