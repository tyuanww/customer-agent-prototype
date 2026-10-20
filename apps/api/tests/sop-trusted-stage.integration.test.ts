import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Pool, type Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations, verifyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createSyntheticSopWorkbook, tryParseSopAsFaq } from '@customer-agent/content-intake';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { createIntakePurposePool, type IntakePurposePool } from '../src/content-intake/runtime-pool.js';
import { discardPreviews, listPreviews } from '../src/content-intake/linked-preview.js';
import { createTrustedSopStage } from '../experiments/sop-row-deletion/trusted-stage.js';
import { attachmentDescriptor, createSopMediaLifecycle } from '../experiments/sop-row-deletion/media-lifecycle.js';
import { createSopRowDeletionCandidate } from '../experiments/sop-row-deletion/consumer.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';
import type { AuthenticatedUser } from '../src/auth-service.js';
import { createIntakeTransactions, type IntakePool, type IntakeResult } from '../src/content-intake/transaction.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const actor = (): AuthenticatedUser => ({ user_id: 'user-enabler', role: 'owner', auth_mode: 'mock' });
function value<T>(result: IntakeResult<T>): T { expect(result.ok, JSON.stringify(result)).toBe(true); if (!result.ok) throw new Error(JSON.stringify(result)); return result.value; }
describe.skipIf(!enabled)('Versioned trusted SOP parser-stage: exact source bytes and atomic freeze', () => {
  let pg: Pg15Harness, admin: Client, setupPool: Pool, business: IntakePurposePool;
  let store: ReturnType<typeof createContentObjectStore>, svc: ReturnType<typeof createContentIntakeService>;
  let stage: ReturnType<typeof createTrustedSopStage>, jobId: string, objectId: string;
  beforeEach(async () => {
    pg = new Pg15Harness(); pg.start(); const db = pg.createDatabase('sop_stage');
    admin = await pg.connect(db.config); await applyDatabaseMigrations(admin); await seedIntakeSyntheticHost(admin, 'product', 'xlsx', true);
    expect(await verifyDatabaseMigrations(admin)).toMatchObject({ status: 'PASS', migrationCount: 52 });
    await admin.query('CREATE ROLE sop_stage_business LOGIN NOINHERIT; GRANT intake_business TO sop_stage_business');
    business = createIntakePurposePool({ ...db.config, user: 'sop_stage_business', max: 4 }, 'business');
    setupPool = new Pool(db.config); store = createContentObjectStore(path.join(pg.root, 'objects'));
    svc = createContentIntakeService(setupPool, store);
    stage = createTrustedSopStage(business, store, false);
    const workbook = await createSyntheticSopWorkbook();
    const form = new FormData(); form.set('operationId', 'sop-stage-upload'); form.set('file', new Blob([new Uint8Array(workbook.bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
    const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    objectId = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!)).objectId;
    jobId = value(await svc.receive(actor(), 'source-sop', { operationId: 'sop-stage-receive', objectId, sourceVersion: 1,
      baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null })).jobId;
  }, 60_000);
  afterEach(async () => {
    try {
      if (admin) {
        const keys = await admin.query<{ key: string }>(`SELECT release_id AS key FROM public.content_releases
          UNION SELECT candidate_id FROM content_intake.candidate_versions UNION SELECT object_id FROM content_intake.objects`);
        for (const { key } of keys.rows) discardPreviews(key);
      }
    } finally { try { await business?.end(); await setupPool?.end(); await admin?.end(); } finally { pg?.stop(); } }
  });
  async function shape() {
    return (await admin.query(`SELECT (SELECT count(*)::int FROM content_intake.candidate_versions) candidates,
      (SELECT count(*)::int FROM content_intake.sop_candidate_rows) rows,
      (SELECT count(*)::int FROM content_intake.sop_candidate_media) media,
      (SELECT count(*)::int FROM content_intake.sop_media_objects) objects,
      (SELECT state FROM content_intake.parse_jobs WHERE job_id=$1) job`, [jobId])).rows[0];
  }
  async function matrixInput(tag: string, options: Parameters<typeof createSyntheticSopWorkbook>[0], base = 'rel_native_base') {
    const workbook = await createSyntheticSopWorkbook(options);
    const form = new FormData(); form.set('operationId', `${tag}-upload`);
    form.set('file', new Blob([new Uint8Array(workbook.bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-matrix.xlsx');
    const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    const object = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
    const job = value(await svc.receive(actor(), 'source-sop', { operationId: `${tag}-receive`, objectId: object.objectId, sourceVersion: 1,
      baseReleaseId: base, contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    return { workbook, object, job };
  }
  async function matrixPublish(candidate: Awaited<ReturnType<typeof stage>> & { ok: true }, tag: string, base: string) {
    const key = candidate.value.key;
    const material = (await admin.query('SELECT material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2', [key.candidateId, key.version])).rows[0].material;
    value(await svc.confirmSource(actor(), { operationId: `${tag}-source`, key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-matrix', acquisition: 'controlled-synthetic-export', objectSha256: material.object.sha256, reason: '合成规模确认' }));
    const reviewer: AuthenticatedUser = { user_id: 'user-reviewer', role: 'owner', auth_mode: 'mock' };
    value(await svc.freezeQuality(reviewer, { operationId: `${tag}-quality-freeze`, key }));
    const quality = value(await svc.qualityPreview(reviewer, key));
    value(await svc.checkQuality(reviewer, { operationId: `${tag}-quality-check`, key, phase: 'initial', checks: quality.population
      .filter(row => quality.initialScriptIds.includes(row.script_id)).map(row => ({ scriptId: row.script_id, contentHash: row.content_hash, defect: false, reason: '' })) }));
    const releaseId = value(await svc.publish(actor(), { operationId: `${tag}-publish`, key, baseReleaseId: base, sourceEvidenceVersion: 1,
      confirmed: true, title: '合成规模', summary: '合成规模' })).releaseId;
    expect(releaseId).not.toBeNull(); if (!releaseId) throw new Error('Synthetic matrix publish did not create a release');
    return releaseId;
  }
  it('recovers and releases redundant payloads after an unknown freeze commit', async () => {
    const second = value(await svc.receive(actor(), 'source-sop', { operationId: 'unknown-second-job', objectId, sourceVersion: 1,
      baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    const parsed = (await tryParseSopAsFaq(await store.readPayload(objectId), { sourceId: 'source-sop', brandId: 'brand-a', shopId: 'shop-a' }))!;
    const image = parsed.previews[0]!;
    const lifecycle = createSopMediaLifecycle(createIntakeTransactions(business, undefined, { requireProductSession: false }), store);
    const a = value(await lifecycle.persist(actor(), jobId, 'source-sop', image.bytes, image.mime));
    const b = value(await lifecycle.persist(actor(), second.jobId, 'source-sop', image.bytes, image.mime));
    expect(a.objectId).not.toBe(b.objectId); value(await stage(actor(), jobId));
    let freezeReturned = false, lost = false;
    const lossy: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, args?: unknown[]) => {
        const result = await target.query(sql, args);
        if (sql.includes('SELECT content_intake.freeze_sop_parsed_candidate')) freezeReturned = true;
        if (sql === 'COMMIT' && freezeReturned && !lost) { lost = true; throw new Error('synthetic lost freeze COMMIT response'); }
        return result;
      };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    const unknown = await createTrustedSopStage(lossy, store, false)(actor(), second.jobId);
    expect(unknown).toMatchObject({ ok:false, commit:'unknown', reason:'COMMIT_UNKNOWN' }); expect(lost).toBe(true);
    expect((await admin.query('SELECT state FROM content_intake.parse_jobs WHERE job_id=$1',[second.jobId])).rows).toEqual([{state:'validated'}]);
    const replay = value(await stage(actor(), second.jobId));
    expect(replay.sourceId).toBe('source-sop');
    expect((await admin.query('SELECT payload_object_id FROM content_intake.sop_media_objects')).rows).toEqual([{payload_object_id:a.objectId}]);
    expect((await admin.query('SELECT state,reserved_bytes::int AS bytes FROM content_intake.object_reservations WHERE object_id=$1',[b.objectId])).rows).toEqual([{state:'released',bytes:image.bytes.length}]);
    await expect(store.readPayload(b.objectId)).rejects.toMatchObject({code:'ENOENT'});
    expect(await store.readAttachment(attachmentDescriptor(a))).toEqual(image.bytes);
  }, 60_000);
  it.each(['unchanged', 'revoked', 'deleted'] as const)('reads validated payloads without a content lock and rechecks %s state', async change => {
    const first = value(await stage(actor(), jobId));
    let marked!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { marked = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let once = false;
    const reading = createTrustedSopStage(business, { ...store, async readAttachment(expected) {
      if (!once) { once = true; marked(); await gate; }
      return store.readAttachment(expected);
    } }, false);
    const pending = reading(actor(), jobId); await entered;
    try {
      await admin.query('BEGIN'); await admin.query("SET LOCAL lock_timeout='100ms'");
      await admin.query('SELECT backend_review.lock_content()'); await admin.query('COMMIT');
      if (change === 'revoked') await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成读取间撤权' WHERE grant_id='business-enabler-import-sop'");
      if (change === 'deleted') value(await createSopRowDeletionCandidate(business, false)(actor(), {
        key: first.key, rowId: 'sop:过敏流程SOP:2', operationId: 'delete-during-cold-read' }));
    } finally { await admin.query('ROLLBACK'); release(); }
    const recovered = await pending;
    if (change === 'unchanged') expect(value(recovered)).toEqual(first);
    else expect(recovered).toMatchObject({ ok: false, commit: 'rolled_back', reason: change === 'revoked' ? 'SCOPE_DENIED' : 'MATERIAL_CHANGED' });
    if (change === 'deleted') expect(listPreviews(first.key.candidateId, new Set(['source-sop']))).toEqual([]);
  }, 60_000);
  it('media matrix: different jobs adopt one canonical payload, release the redundant file and replay the second job', async () => {
    const second = value(await svc.receive(actor(), 'source-sop', { operationId: 'matrix-second-job', objectId, sourceVersion: 1,
      baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    const parsed = (await tryParseSopAsFaq(await store.readPayload(objectId), { sourceId: 'source-sop', brandId: 'brand-a', shopId: 'shop-a' }))!;
    const image = parsed.previews[0]!;
    const lifecycle = createSopMediaLifecycle(createIntakeTransactions(business, undefined, { requireProductSession: false }), store);
    const a = value(await lifecycle.persist(actor(), jobId, 'source-sop', image.bytes, image.mime));
    const b = value(await lifecycle.persist(actor(), second.jobId, 'source-sop', image.bytes, image.mime));
    expect(a.objectId).not.toBe(b.objectId);
    value(await stage(actor(), jobId)); const other = value(await stage(actor(), second.jobId));
    expect((await admin.query('SELECT payload_object_id FROM content_intake.sop_media_objects')).rows).toEqual([{ payload_object_id: a.objectId }]);
    expect((await admin.query('SELECT state FROM content_intake.object_reservations WHERE object_id=$1', [b.objectId])).rows).toEqual([{ state: 'released' }]);
    await expect(store.readPayload(b.objectId)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(value(await stage(actor(), second.jobId))).toEqual(other);
    expect(await store.readAttachment(attachmentDescriptor(a))).toEqual(image.bytes);
    expect((await admin.query("SELECT count(*)::int n FROM content_intake.objects WHERE purpose='sop-media'")).rows[0].n).toBe(1);
  }, 60_000);
  it.each(['reverse', 'duplicate-position'] as const)('media matrix: full freeze handles %s media input atomically', async variant => {
    const { job } = await matrixInput(`matrix-${variant}`, { imageOnLastTextRow: true });
    const original = variant === 'reverse' ? value(await stage(actor(), job.jobId)) : null;
    const before = await shape();
    const changed: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT content_intake.freeze_sop_parsed_candidate')) {
          values = [...values!]; const rows = JSON.parse(String(values[3])), media = JSON.parse(String(values[4]));
          expect(media.items).toHaveLength(2);
          if (variant === 'reverse') { rows.reverse(); media.items.reverse(); media.freshRowIds.reverse(); }
          else for (const key of ['sheetName', 'rowNumber', 'columnNumber', 'ordinal']) media.items[1][key] = media.items[0][key];
          values[3] = JSON.stringify(rows); values[4] = JSON.stringify(media);
        }
        return target.query(sql, values);
      };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    const result = await createTrustedSopStage(changed, store, false)(actor(), job.jobId);
    if (variant === 'reverse') expect(value(result)).toEqual(original);
    else expect(result).toMatchObject({ ok: false, commit: 'rolled_back' });
    expect(await shape()).toEqual(before);
    if (variant === 'duplicate-position') {
      expect((await admin.query('SELECT state,result_candidate_id FROM content_intake.parse_jobs WHERE job_id=$1', [job.jobId])).rows)
        .toEqual([{ state: 'reading', result_candidate_id: null }]);
      expect((await admin.query("SELECT count(*)::int n FROM content_intake.objects WHERE purpose='sop-media'")).rows[0].n).toBe(0);
    }
  }, 60_000);
  it('media matrix: reaches 500 inherited relationships with sequential durable reads and rejects 501', async () => {
    let base = 'rel_native_base', active = 0, peak = 0, reads = 0;
    const diagnostics: unknown[] = [];
    const measured = createTrustedSopStage(business, { ...store, async readAttachment(expected) {
      active++; peak = Math.max(peak, active); reads++;
      try { return await store.readAttachment(expected); } finally { active--; }
    } }, false, (_id, error) => { diagnostics.push(error instanceof Error ? { ...error, message: error.message } : error); });
    for (let generation = 0; generation < 5; generation++) {
      const tailRows = 501 - generation * 100, tag = `matrix-scale-${generation}`;
      const { job } = await matrixInput(tag, { omitFirstImage: true, tailRows, tailImageStart: tailRows - 100, tailImageCount: 100 }, base);
      const result = await measured(actor(), job.jobId); expect(result.ok, JSON.stringify({ generation, active, peak, reads, diagnostics, result })).toBe(true); const candidate = value(result);
      expect((await admin.query('SELECT count(*)::int n FROM content_intake.sop_candidate_media WHERE candidate_id=$1 AND candidate_version=$2', [candidate.key.candidateId, candidate.key.version])).rows[0].n).toBe((generation + 1) * 100);
      base = await matrixPublish(result as typeof result & { ok: true }, tag, base);
      discardPreviews(candidate.key.candidateId); discardPreviews(base);
    }
    expect(peak).toBe(1); expect(active).toBe(0); expect(reads).toBeGreaterThanOrEqual(1000);
    expect((await admin.query('SELECT count(*)::int n FROM content_intake.sop_release_media WHERE release_id=$1', [base])).rows[0].n).toBe(500);
    const { job } = await matrixInput('matrix-scale-overflow', { omitFirstImage: true, tailRows: 1, tailImageStart: 0, tailImageCount: 1 }, base);
    const before = (await admin.query('SELECT count(*)::int n FROM content_intake.candidate_versions')).rows[0].n;
    expect(await measured(actor(), job.jobId)).toMatchObject({ ok: false, commit: 'rolled_back' });
    expect((await admin.query('SELECT count(*)::int n FROM content_intake.candidate_versions')).rows[0].n).toBe(before);
    expect((await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id).toBe(base);
    expect((await admin.query('SELECT state FROM content_intake.parse_jobs WHERE job_id=$1', [job.jobId])).rows[0].state).toBe('reading');
    expect(peak).toBe(1);
  }, 120_000);
  it('freezes actual synthetic workbook, maps every text row and image, then deletes one row with restricted business', async () => {
    const parsed = (await tryParseSopAsFaq(await store.readPayload(objectId), { sourceId: 'source-sop', brandId: 'brand-a', shopId: 'shop-a' }))!;
    const candidate = value(await stage(actor(), jobId));
    expect(await shape()).toEqual({ candidates: 1, rows: parsed.rowBindings.length, media: 1, objects: 1, job: 'validated' });
    expect(listPreviews(candidate.key.candidateId, new Set(['source-sop']))).toHaveLength(1);
    const remove = createSopRowDeletionCandidate(business, false);
    const next = value(await remove(actor(), { key: candidate.key, rowId: 'sop:过敏流程SOP:2', operationId: 'stage-delete' }));
    expect(next.key.version).toBe(2); expect(listPreviews(next.key.candidateId, new Set(['source-sop']))).toEqual([]);
  });
  it('replays the same job without duplicate candidate, mapping or media', async () => {
    const first = value(await stage(actor(), jobId)), before = await shape();
    expect(value(await stage(actor(), jobId))).toEqual(first); expect(await shape()).toEqual(before);
  });
  it('keeps freeze, job transition, mappings and media rolled back on an actual asset-stage rejection', async () => {
    await admin.query(`CREATE FUNCTION content_intake.synthetic_reject_media() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic media rejection'; END$$;
      CREATE TRIGGER synthetic_reject BEFORE INSERT ON content_intake.sop_candidate_media FOR EACH ROW EXECUTE FUNCTION content_intake.synthetic_reject_media()`);
    const before = await shape(); expect(await stage(actor(), jobId)).toMatchObject({ ok: false, commit: 'rolled_back' });
    expect(await shape()).toEqual(before); expect(listPreviews(objectId, new Set(['source-sop']))).toEqual([]);
  });
  it('refuses changed adopted object bytes before freeze', async () => {
    const altered = createTrustedSopStage(setupPool, { readPayload: async () => Buffer.from('changed synthetic input') }, false);
    const before = await shape(); expect(await altered(actor(), jobId)).toMatchObject({ ok: false, reason: 'FILE_INVALID' }); expect(await shape()).toEqual(before);
  });
  it('allows the narrow freeze capability while denying arbitrary parser DML', async () => {
    const c = await business.connect();
    try {
      await expect(c.query("UPDATE content_intake.parse_jobs SET contributor_ids=ARRAY['agent'] WHERE job_id=$1", [jobId])).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('DELETE FROM content_intake.candidate_versions')).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('DELETE FROM content_intake.sop_candidate_rows')).rejects.toMatchObject({ code: '42501' });
    } finally { c.release(); }
    expect(value(await stage(actor(), jobId)).sourceId).toBe('source-sop');
  });
  it.each(['director','manager','supervisor','lead'] as const)('allows currently authorized %s role through the same restricted login', async role => {
    await admin.query("UPDATE content_intake.role_rules SET role=$1 WHERE job_id='job-lead'", [role]);
    expect(value(await stage(actor(), jobId)).sourceId).toBe('source-sop');
  });
  it.each(['revoked','expired','role','tenant'] as const)('refuses current %s authority without partial state', async cause => {
    if (cause === 'revoked') await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成撤权' WHERE recipient_id='enabler' AND action='import'");
    if (cause === 'expired') {
      await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成撤权' WHERE grant_id='business-enabler-import-sop'");
      await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
        to_jsonb(g)||jsonb_build_object('grant_id','stage-short-grant','version',1,'last_change_reason',NULL,'revoked_at',NULL,'expires_at',clock_timestamp()+interval '100 milliseconds'))).*
        FROM content_intake.grants g WHERE grant_id='business-enabler-import-sop'`);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (cause === 'role') await admin.query("UPDATE content_intake.role_rules SET role='agent' WHERE job_id='job-lead'");
    if (cause === 'tenant') {
      await admin.query('BEGIN');
      await admin.query(`INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ('other','synthetic','tenant-other','other','user-other',repeat('a',64),true,'owner')`);
      await admin.query("INSERT INTO content_intake.principals VALUES ('other','user-other','tenant-other','app-a','confirmed-synthetic','other',1,0)");
      await admin.query("INSERT INTO content_intake.principal_facts VALUES ('other',1,ARRAY['dept-a'],'job-lead',true,clock_timestamp()-interval '1 second',clock_timestamp()+interval '200 seconds',repeat('a',64))");
      await admin.query("INSERT INTO content_intake.role_rules VALUES ('tenant-other','app-a','dept-a','job-lead',1,'lead')");
      await admin.query('COMMIT');
    }
    const before = await shape(); expect(await stage(cause === 'tenant' ? { ...actor(), user_id: 'user-other' } : actor(), jobId)).toMatchObject({ ok: false, commit: 'rolled_back' }); expect(await shape()).toEqual(before);
  });
  async function prepareInheritedJob(options: Parameters<typeof createSyntheticSopWorkbook>[0] = { omitLastTextRow: true }) {
    const first = value(await stage(actor(), jobId));
    const material = (await admin.query('SELECT material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2', [first.key.candidateId, first.key.version])).rows[0].material;
    value(await svc.confirmSource(actor(), { operationId: 'stage-source-ok', key: first.key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-v1', acquisition: 'controlled-synthetic-export', objectSha256: material.object.sha256, reason: '合成确认' }));
    const reviewer: AuthenticatedUser = { user_id: 'user-reviewer', role: 'owner', auth_mode: 'mock' };
    value(await svc.freezeQuality(reviewer, { operationId: 'stage-quality-freeze', key: first.key }));
    const quality = value(await svc.qualityPreview(reviewer, first.key));
    value(await svc.checkQuality(reviewer, { operationId: 'stage-quality-check', key: first.key, phase: 'initial',
      checks: quality.population.filter(row => quality.initialScriptIds.includes(row.script_id)).map(row => ({ scriptId: row.script_id, contentHash: row.content_hash, defect: false, reason: '' })) }));
    const published = value(await svc.publish(actor(), { operationId: 'stage-publish-one', key: first.key, baseReleaseId: 'rel_native_base', sourceEvidenceVersion: 1,
      confirmed: true, title: '合成', summary: '合成' }));
    const workbook = await createSyntheticSopWorkbook(options);
    const form = new FormData(); form.set('operationId', 'stage-next-upload'); form.set('file', new Blob([new Uint8Array(workbook.bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
    const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    const object = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
    jobId = value(await svc.receive(actor(), 'source-sop', { operationId: 'stage-next-receive', objectId: object.objectId, sourceVersion: 1,
      baseReleaseId: published.releaseId, contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null })).jobId;
    return first;
  }
  it('inherits omitted text only from exact published source lineage with a reliable row mapping', async () => {
    await prepareInheritedJob(); const next = value(await stage(actor(), jobId));
    const rows = (await admin.query('SELECT row_id,business_entry_id FROM content_intake.sop_candidate_rows WHERE candidate_id=$1 AND candidate_version=$2 ORDER BY business_entry_id', [next.key.candidateId, next.key.version])).rows;
    expect(rows).toHaveLength(9); expect(rows[8]).toEqual({ row_id: 'sop:长痘痘SOP:1', business_entry_id: 'sop9' });
    const entries = (await admin.query("SELECT material->'entries' AS entries FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2", [next.key.candidateId, next.key.version])).rows[0].entries;
    expect(entries).toHaveLength(9);
  });
  it('rejects inherited content without reliable prior mapping and rolls back the new candidate', async () => {
    const first = await prepareInheritedJob();
    await admin.query("DELETE FROM content_intake.sop_candidate_rows WHERE candidate_id=$1 AND candidate_version=$2 AND business_entry_id='sop9'", [first.key.candidateId, first.key.version]);
    const before = await shape(); expect(await stage(actor(), jobId)).toMatchObject({ ok: false, commit: 'rolled_back' }); expect(await shape()).toEqual(before);
  });
  it.each([false,true])('inherits exact published row media from durable payloads with missing cache=%s', async missing => {
    const workbook = await createSyntheticSopWorkbook({ imageOnFinalRow: true });
    const form = new FormData(); form.set('operationId', 'inherited-image-upload'); form.set('file', new Blob([new Uint8Array(workbook.bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
    const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    const object = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
    jobId = value(await svc.receive(actor(), 'source-sop', { operationId: 'inherited-image-receive', objectId: object.objectId, sourceVersion: 1,
      baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null })).jobId;
    const first = await prepareInheritedJob();
    if (missing) discardPreviews(first.key.candidateId);
    const next = value(await stage(actor(), jobId));
    const media = (await admin.query(`SELECT m.row_id,o.payload_object_id AS "objectId",o.sha256,o.bytes::int,o.mime
      FROM content_intake.sop_candidate_media m JOIN content_intake.sop_media_objects o USING(media_object_id)
      WHERE m.candidate_id=$1 AND m.candidate_version=$2 ORDER BY m.row_id`, [next.key.candidateId, next.key.version])).rows;
    expect(media.map(item => item.row_id).sort()).toEqual(['sop:过敏流程SOP:2','sop:长痘痘SOP:1'].sort());
    for (const item of media) {
      const bytes = await store.readAttachment(attachmentDescriptor(item));
      expect(bytes.length).toBe(item.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256);
    }
  });
  it.each(['omit','replace'] as const)('accepts a fresh same-text row with %s image and preserves the old published snapshot', async change => {
    const first = await prepareInheritedJob(change === 'omit' ? { omitFirstImage: true } : { replaceFirstImage: true });
    const old = (await admin.query('SELECT * FROM content_intake.sop_candidate_media WHERE candidate_id=$1 AND candidate_version=$2', [first.key.candidateId, first.key.version])).rows;
    const next = value(await stage(actor(), jobId));
    const media = (await admin.query('SELECT * FROM content_intake.sop_candidate_media WHERE candidate_id=$1 AND candidate_version=$2', [next.key.candidateId, next.key.version])).rows;
    expect(media).toHaveLength(change === 'omit' ? 0 : 1);
    if (change === 'replace') expect(media[0].sha256).not.toBe(old[0].sha256);
    expect((await admin.query('SELECT * FROM content_intake.sop_candidate_media WHERE candidate_id=$1 AND candidate_version=$2', [first.key.candidateId, first.key.version])).rows).toEqual(old);
    expect(listPreviews(next.key.candidateId, new Set(['source-sop']))).toHaveLength(change === 'omit' ? 0 : 1);
  });
  it('rejects changed-body or cross-source replay without replacing committed assets', async () => {
    const candidate = value(await stage(actor(), jobId));
    const material = (await admin.query('SELECT material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2', [candidate.key.candidateId, candidate.key.version])).rows[0].material;
    const parsed = (await tryParseSopAsFaq(await store.readPayload(objectId), { sourceId: 'source-sop', brandId: 'brand-a', shopId: 'shop-a' }))!;
    const media = { sourceId: 'source-sop', sourceVersion: 1, fileSha256: material.object.sha256, materialDigest: candidate.key.digest,
      freshRowIds: parsed.rowBindings.map(row => row.rowId), contentVersion: parsed.contentVersion, items: [] };
    const before = await shape(), c = await business.connect();
    try {
      await expect(c.query('SELECT content_intake.freeze_sop_parsed_candidate($1,$2,$3,$4,$5)', ['enabler', jobId, JSON.stringify(material), JSON.stringify(parsed.rowBindings), JSON.stringify(media)])).rejects.toMatchObject({ code: 'ZA003' });

      await expect(c.query('SELECT content_intake.freeze_sop_parsed_candidate($1,$2,$3,$4,$5)', ['enabler', jobId, JSON.stringify({ ...material, scope: { ...material.scope, sourceId: 'source-a' } }), JSON.stringify(parsed.rowBindings), JSON.stringify({ ...media, sourceId: 'source-a' })])).rejects.toMatchObject({ code: 'ZA003' });
    } finally { c.release(); }
    expect(await shape()).toEqual(before);
  });
  it.each(['null-kind','nested-unknown','unknown'] as const)('rejects %s metadata before fresh stage registration', async variant => {
    const malformed: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT content_intake.freeze_sop_parsed_candidate')) {
          const media = JSON.parse(String(values![4]));
          if (variant === 'null-kind') media.contentVersion.kind = null;
          else if (variant === 'nested-unknown') media.contentVersion.unexpected = true;
          else media.unexpected = true;
          values = [...values!]; values[4] = JSON.stringify(media);
        }
        return target.query(sql, values);
      };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    const before = await shape();
    expect(await createTrustedSopStage(malformed, store, false)(actor(), jobId)).toMatchObject({ ok: false, reason: variant === 'unknown' ? 'MATERIAL_CHANGED' : 'FILE_INVALID', commit: 'rolled_back' });
    expect(await shape()).toEqual(before);
  });
  it('rolls back all staged state when a second connection revokes import after the freeze SQL returns', async () => {
    const between: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => { const result = await target.query(sql, values);
        if (sql.includes('SELECT content_intake.freeze_sop_parsed_candidate')) await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成提交前撤权' WHERE grant_id='business-enabler-import-sop'");
        return result; };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    const before = await shape(); expect(await createTrustedSopStage(between, store, false)(actor(), jobId)).toMatchObject({ ok: false, commit: 'rolled_back', reason: 'SCOPE_DENIED' });
    expect(await shape()).toEqual(before); expect(listPreviews(objectId, new Set(['source-sop']))).toEqual([]);
  });
  it.each(['same','changed-text','declared-same','declared-new'] as const)('keeps deletion history and applies content-version restage for %s', async variant => {
    const declared = variant.startsWith('declared-');
    if (declared) {
      const bytes = (await createSyntheticSopWorkbook({ declaredVersion: 'synthetic-v1' })).bytes;
      const form = new FormData(); form.set('operationId', 'declared-initial-upload'); form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
      const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
      objectId = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!)).objectId;
      jobId = value(await svc.receive(actor(), 'source-sop', { operationId: 'declared-initial-receive', objectId, sourceVersion: 1, baseReleaseId: 'rel_native_base',
        contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null })).jobId;
    }
    const first = value(await stage(actor(), jobId));
    const removed = value(await createSopRowDeletionCandidate(business, false)(actor(), {
      key: first.key, rowId: 'sop:过敏流程SOP:2', operationId: 'restage-remove-image-row' }));
    const before = await shape();
    const mediaBefore = (await admin.query(`SELECT o.media_object_id,o.state,o.adopted_at,o.discarded_at,
      (SELECT count(*)::int FROM content_intake.sop_candidate_media m WHERE m.media_object_id=o.media_object_id) AS candidate_refs,
      (SELECT count(*)::int FROM content_intake.sop_release_media m WHERE m.media_object_id=o.media_object_id) AS release_refs
      FROM content_intake.sop_media_objects o`)).rows;
    const deletionEvents = (await admin.query('SELECT to_jsonb(e) AS value FROM content_intake.sop_row_deletion_events e')).rows;
    const oldMaterials = (await admin.query('SELECT version::int,digest,material FROM content_intake.candidate_versions WHERE candidate_id=$1 ORDER BY version', [first.key.candidateId])).rows;
    const originalBytes = await store.readPayload(objectId);
    const bytes = variant === 'same' ? originalBytes : (await createSyntheticSopWorkbook({ textSuffix: '-修订', ...(declared ? { declaredVersion: variant === 'declared-new' ? 'synthetic-v2' : 'synthetic-v1' } : {}) })).bytes;
    const form = new FormData(); form.set('operationId', 'restage-same-bytes-upload'); form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
    const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    const uploaded = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
    const nextJob = value(await svc.receive(actor(), 'source-sop', { operationId: 'restage-new-job', objectId: uploaded.objectId, sourceVersion: 1,
      baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: removed.key }));
    const result = await stage(actor(), nextJob.jobId);
    const after = await shape();
    const nextJobRow = (await admin.query('SELECT state,result_candidate_id,result_candidate_version FROM content_intake.parse_jobs WHERE job_id=$1', [nextJob.jobId])).rows[0];
    const versions = (await admin.query('SELECT version::int,state,object_id FROM content_intake.candidate_versions WHERE candidate_id=$1 ORDER BY version', [first.key.candidateId])).rows;
    const parseScope = { sourceId: 'source-sop', brandId: 'brand-a', shopId: 'shop-a' };
    const originalParsed = (await tryParseSopAsFaq(originalBytes, parseScope))!;
    const nextParsed = (await tryParseSopAsFaq(bytes, parseScope))!;
    const sameParsedText = JSON.stringify(originalParsed.rowBindings) === JSON.stringify(nextParsed.rowBindings);
    const imageHashes = (items: typeof originalParsed.previews) => items.map(item => createHash('sha256').update(item.bytes).digest('hex'));
    expect(imageHashes(nextParsed.previews)).toEqual(imageHashes(originalParsed.previews)); expect(sameParsedText).toBe(variant === 'same');
    const report = { sourceId: 'source-sop', variant, sameParsedText, sameImageHashes: imageHashes(nextParsed.previews), originalFileSha256: createHash('sha256').update(originalBytes).digest('hex'), inputFileSha256: uploaded.sha256, sameSourceMappingVersion: 1,
      firstCandidate: first.key, deletionCandidate: removed.key, newJobId: nextJob.jobId, originalObjectId: objectId, newObjectId: uploaded.objectId,
      mediaBefore, deletionEvents, originalContentVersion: originalParsed.contentVersion, nextContentVersion: nextParsed.contentVersion, before, result, after, nextJobRow, versions,
      semantics: 'New upload operation and new receive operation/job; expected prior key is deletion version. Same variant keeps exact workbook bytes; changed-text variant changes row text but keeps the same PNG. Neither replays the original parse job.' };
    const output = process.env.CUSTOMER_AGENT_SOP_RESTAGE_REPORT;
    if (output) { if (!path.isAbsolute(output)) throw new Error('Absolute probe report path required'); writeFileSync(`${output}.${variant}.json`, `${JSON.stringify(report, null, 2)}\n`); }
    expect(uploaded.sha256 === createHash('sha256').update(originalBytes).digest('hex')).toBe(variant === 'same');
    expect(mediaBefore).toHaveLength(1); expect(mediaBefore[0]).toMatchObject({ state: 'discarded', adopted_at: null, candidate_refs: 0, release_refs: 0 });
    const isNewVersion = variant === 'changed-text' || variant === 'declared-new';
    expect(originalParsed.contentVersion.kind).toBe(declared ? 'declared' : 'sha256');
    expect(nextParsed.contentVersion.value === originalParsed.contentVersion.value).toBe(!isNewVersion);
    expect(deletionEvents).toHaveLength(1);
    expect((await admin.query('SELECT to_jsonb(e) AS value FROM content_intake.sop_row_deletion_events e')).rows).toEqual(deletionEvents);
    expect((await admin.query('SELECT version::int,digest,material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version<=2 ORDER BY version', [first.key.candidateId])).rows).toEqual(oldMaterials);
    if (isNewVersion) {
      const next = value(result); expect(next.key.version).toBe(3); expect(nextJobRow.state).toBe('validated');
      const restored = (await admin.query('SELECT state,adopted_at,discarded_at FROM content_intake.sop_media_objects WHERE media_object_id=$1', [mediaBefore[0].media_object_id])).rows[0];
      expect(restored).toEqual({ state: 'staged', adopted_at: null, discarded_at: null });
      const deletedMedia = deletionEvents[0]!.value.media.find((item: { mediaObjectId: string }) => item.mediaObjectId === mediaBefore[0].media_object_id);
      expect(Date.parse(deletedMedia.discardedAt)).toBe(mediaBefore[0].discarded_at.getTime());
      expect(listPreviews(next.key.candidateId, new Set(['source-sop']))).toHaveLength(1);
      // Replaying the old logical content version must stay denied even after a
      // newer version has made the shared media object staged again.
      const oldJob = value(await svc.receive(actor(), 'source-sop', { operationId: 'restage-old-version-again', objectId, sourceVersion: 1,
        baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: next.key }));
      expect(await stage(actor(), oldJob.jobId)).toMatchObject({ ok: false, reason: 'MATERIAL_CHANGED', commit: 'rolled_back' });
      expect((await admin.query('SELECT count(*)::int n FROM content_intake.candidate_versions WHERE candidate_id=$1', [first.key.candidateId])).rows[0].n).toBe(3);
    } else {
      expect(result).toMatchObject({ ok: false, reason: 'MATERIAL_CHANGED', commit: 'rolled_back' });
      expect(after).toEqual(before); expect(nextJobRow).toEqual({ state: 'reading', result_candidate_id: null, result_candidate_version: null });
      expect(versions.map(row => ({ version: row.version, state: row.state }))).toEqual([{ version: 1, state: 'invalidated' }, { version: 2, state: 'awaiting-evidence' }]);
    }
  });
  it('does not restore a deleted text-only row when a new job repeats the same content version', async () => {
    const first = value(await stage(actor(), jobId));
    const removed = value(await createSopRowDeletionCandidate(business, false)(actor(), {
      key: first.key, rowId: 'sop:长痘痘SOP:1', operationId: 'restage-remove-text-row' }));
    const events = (await admin.query('SELECT to_jsonb(e) AS value FROM content_intake.sop_row_deletion_events e')).rows;
    expect(events).toHaveLength(1); expect(events[0].value.media).toEqual([]);
    for (const statement of ['UPDATE content_intake.sop_row_deletion_events SET deleted_at=clock_timestamp()', 'DELETE FROM content_intake.sop_row_deletion_events']) {
      await expect(admin.query(statement)).rejects.toThrow('INTAKE_HISTORY_IMMUTABLE');
    }
    const restricted = await business.connect();
    try {
      for (const statement of ['INSERT INTO content_intake.sop_row_deletion_events SELECT * FROM content_intake.sop_row_deletion_events',
        'UPDATE content_intake.sop_row_deletion_events SET deleted_at=clock_timestamp()', 'DELETE FROM content_intake.sop_row_deletion_events']) {
        await expect(restricted.query(statement)).rejects.toMatchObject({ code: '42501' });
      }
    } finally { restricted.release(); }
    const nextJob = value(await svc.receive(actor(), 'source-sop', { operationId: 'restage-repeat-text-job', objectId, sourceVersion: 1,
      baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: removed.key }));
    const before = await shape(); expect(await stage(actor(), nextJob.jobId)).toMatchObject({ ok: false, reason: 'MATERIAL_CHANGED', commit: 'rolled_back' });
    expect(await shape()).toEqual(before);
    expect((await admin.query('SELECT to_jsonb(e) AS value FROM content_intake.sop_row_deletion_events e')).rows).toEqual(events);
  });
  it('keeps cancellation empty when the preceding deletion receipt replays at the same version', async () => {
    let key = value(await stage(actor(), jobId)).key;
    const parsed = (await tryParseSopAsFaq(await store.readPayload(objectId), { sourceId: 'source-sop', brandId: 'brand-a', shopId: 'shop-a' }))!;
    const remove = createSopRowDeletionCandidate(business, false);
    let preceding: { key: typeof key; rowId: string; operationId: string } | undefined;
    for (const row of parsed.rowBindings.filter(row => row.rowId !== 'sop:过敏流程SOP:2')) {
      preceding = { key, rowId: row.rowId, operationId: `preview-remove-${key.version}` };
      key = value(await remove(actor(), preceding)).key;
    }
    expect(listPreviews(key.candidateId, new Set(['source-sop']))).toHaveLength(1);
    const cancelled = value(await remove(actor(), { key, rowId: 'sop:过敏流程SOP:2', operationId: 'preview-cancel-last' }));
    expect(cancelled.key.version).toBe(key.version); expect(cancelled.state).toBe('cancelled');
    expect(listPreviews(key.candidateId, new Set(['source-sop']))).toEqual([]);
    value(await remove(actor(), preceding!));
    expect(listPreviews(key.candidateId, new Set(['source-sop']))).toEqual([]);
  });
  it('restores the adopted input preview after a replay freeze rolls back before commit', async () => {
    const first = value(await stage(actor(), jobId));
    const initial = listPreviews(objectId, new Set(['source-sop'])); expect(initial).toHaveLength(1);
    let frozenSqlReturned = false, authorityChecks = 0;
    const rejected: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => {
        if (frozenSqlReturned && sql.includes('SELECT content_intake.authorization_deadline') && ++authorityChecks === 2) {
          await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成重放提交前撤权' WHERE grant_id='business-enabler-import-sop'");
        }
        const result = await target.query(sql, values);
        if (sql.includes('SELECT content_intake.freeze_sop_parsed_candidate')) frozenSqlReturned = true;
        return result; };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    expect(await createTrustedSopStage(rejected, store, false)(actor(), jobId)).toMatchObject({ ok: false, reason: 'SCOPE_DENIED', commit: 'rolled_back' });
    expect(listPreviews(objectId, new Set(['source-sop']))).toEqual(initial);
    const next = value(await createSopRowDeletionCandidate(business, false)(actor(), { key: first.key, rowId: 'sop:长痘痘SOP:1', operationId: 'preview-after-replay-rollback' }));
    expect(listPreviews(next.key.candidateId, new Set(['source-sop']))).toEqual(initial);
  });
  it('rejects same-input cross-base restage after deletion and preserves the delayed receipt images', async () => {
    type Key = NonNullable<Extract<Awaited<ReturnType<typeof stage>>, { ok: true }>['value']>['key'];
    async function uploadAndReceive(bytes: Buffer, name: string, baseReleaseId: string) {
      const form = new FormData(); form.set('operationId', `${name}-upload`); form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
      const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
      const object = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
      const job = value(await svc.receive(actor(), 'source-sop', { operationId: `${name}-receive`, objectId: object.objectId, sourceVersion: 1,
        baseReleaseId, contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
      return { object, job };
    }
    async function publish(key: Key, name: string, baseReleaseId: string) {
      const material = (await admin.query('SELECT material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2', [key.candidateId, key.version])).rows[0].material;
      value(await svc.confirmSource(actor(), { operationId: `${name}-source`, key, expectedEvidenceVersion: 0,
        confirmedVersionKind: 'opaque', confirmedVersionValue: name, acquisition: 'controlled-synthetic-export', objectSha256: material.object.sha256, reason: '合成确认' }));
      const reviewer: AuthenticatedUser = { user_id: 'user-reviewer', role: 'owner', auth_mode: 'mock' };
      value(await svc.freezeQuality(reviewer, { operationId: `${name}-quality-freeze`, key }));
      const quality = value(await svc.qualityPreview(reviewer, key));
      value(await svc.checkQuality(reviewer, { operationId: `${name}-quality-check`, key, phase: 'initial',
        checks: quality.population.filter(row => quality.initialScriptIds.includes(row.script_id)).map(row => ({ scriptId: row.script_id, contentHash: row.content_hash, defect: false, reason: '' })) }));
      return value(await svc.publish(actor(), { operationId: `${name}-publish`, key, baseReleaseId, sourceEvidenceVersion: 1,
        confirmed: true, title: '合成基线', summary: '合成基线' }));
    }
    const original = await uploadAndReceive((await createSyntheticSopWorkbook({ imageOnFinalRow: true })).bytes, 'cross-r1', 'rel_native_base');
    const frozenR1 = value(await stage(actor(), original.job.jobId));
    // Create a legitimate hole before publishing R1. Its absent sop1 can later
    // be removed from A; deleting any already-published entry would be denied.
    const r1Key = value(await createSopRowDeletionCandidate(business, false)(actor(), { key: frozenR1.key,
      rowId: 'sop:过敏流程SOP:1', operationId: 'cross-r1-remove-unused' })).key;
    const r1 = await publish(r1Key, 'cross-r1', 'rel_native_base');
    expect((await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id).toBe(r1.releaseId);
    const shared = await uploadAndReceive((await createSyntheticSopWorkbook({ omitLastTextRow: true })).bytes, 'cross-shared', r1.releaseId!);
    const a = value(await stage(actor(), shared.job.jobId));
    const originalImages = listPreviews(a.key.candidateId, new Set(['source-sop']));
    expect(originalImages.map(image => image.rowId).sort()).toEqual(['sop:过敏流程SOP:2', 'sop:长痘痘SOP:1'].sort());
    const deletion = { key: a.key, rowId: 'sop:过敏流程SOP:1', operationId: 'cross-delayed-deletion' };
    let lost = false;
    const lossy: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => { const result = await target.query(sql, values);
        if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('synthetic delayed deletion acknowledgement'); } return result; };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    expect(await createSopRowDeletionCandidate(lossy, false)(actor(), deletion)).toMatchObject({ ok: false, commit: 'unknown' });
    expect((await admin.query("SELECT count(*)::int n FROM backend_review.receipts WHERE operation='intake:sop-row-delete-v2' AND request_key=$1", [deletion.operationId])).rows[0].n).toBe(1);
    expect(listPreviews(a.key.candidateId, new Set(['source-sop']))).toEqual(originalImages);
    const replacement = await uploadAndReceive((await createSyntheticSopWorkbook()).bytes, 'cross-r2', r1.releaseId!);
    const r2Candidate = value(await stage(actor(), replacement.job.jobId));
    const r2 = await publish(r2Candidate.key, 'cross-r2', r1.releaseId!);
    expect(r2.releaseId).not.toBe(r1.releaseId);
    expect((await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id).toBe(r2.releaseId);
    const nextJob = value(await svc.receive(actor(), 'source-sop', { operationId: 'cross-same-object-new-base', objectId: shared.object.objectId, sourceVersion: 1,
      baseReleaseId: r2.releaseId!, contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    const events = (await admin.query('SELECT row_id,content_version FROM content_intake.sop_row_deletion_events WHERE candidate_id=$1', [a.key.candidateId])).rows;
    const parsedShared = (await tryParseSopAsFaq(await store.readPayload(shared.object.objectId), { sourceId: 'source-sop', brandId: 'brand-a', shopId: 'shop-a' }))!;
    expect(events).toContainEqual({ row_id: deletion.rowId, content_version: parsedShared.contentVersion });
    const beforeRejectedStage = await shape();
    const beforeRegistrations = (await admin.query('SELECT candidate_id,candidate_version,payload_digest,content_version FROM content_intake.sop_asset_registrations ORDER BY candidate_id,candidate_version')).rows;
    let observedSqlError: { code: string | undefined; message: string; where: string | undefined } | undefined;
    const observed: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => {
        try { return await target.query(sql, values); }
        catch (error) {
          if (sql.includes('SELECT content_intake.freeze_sop_parsed_candidate') && error instanceof Error) {
            const pgError = error as Error & { code?: string; where?: string };
            observedSqlError = { code: pgError.code, message: pgError.message, where: pgError.where };
          }
          throw error; // Observe the genuine PG rejection without replacing it.
        }
      };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    const observedStage = createTrustedSopStage(observed, store, false);
    const b = await observedStage(actor(), nextJob.jobId);
    expect(b).toMatchObject({ ok: false, reason: 'MATERIAL_CHANGED', commit: 'rolled_back' });
    expect(await shape()).toEqual(beforeRejectedStage);
    expect((await admin.query('SELECT candidate_id,candidate_version,payload_digest,content_version FROM content_intake.sop_asset_registrations ORDER BY candidate_id,candidate_version')).rows).toEqual(beforeRegistrations);
    expect(observedSqlError).toMatchObject({ code: 'ZA003', message: 'MATERIAL_CHANGED' });
    const raisedLine = Number(observedSqlError!.where!.match(/stage_sop_candidate_assets\(text,text,bigint,jsonb,jsonb\) line (\d+) at RAISE/)?.[1]);
    const functionBody = (await admin.query<{ prosrc: string }>("SELECT prosrc FROM pg_proc WHERE oid='content_intake.stage_sop_candidate_assets(text,text,bigint,jsonb,jsonb)'::regprocedure")).rows[0]!.prosrc.split('\n');
    const rejectionBranch = functionBody.slice(raisedLine - 4, raisedLine).join('\n');
    expect(rejectionBranch).toContain('FROM content_intake.sop_row_deletion_events');
    expect(rejectionBranch).toContain("d.content_version=p_media->'contentVersion'");
    expect(functionBody[raisedLine - 1]).toContain("ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'");
    expect((await admin.query('SELECT state,result_candidate_id,result_candidate_version FROM content_intake.parse_jobs WHERE job_id=$1', [nextJob.jobId])).rows[0])
      .toEqual({ state: 'reading', result_candidate_id: null, result_candidate_version: null });
    expect(listPreviews(shared.object.objectId, new Set(['source-sop']))).toEqual(originalImages);
    const replayed = value(await createSopRowDeletionCandidate(business, false)(actor(), deletion));
    expect(replayed.key.version).toBe(a.key.version + 1);
    const actual = listPreviews(a.key.candidateId, new Set(['source-sop']));
    const output = process.env.CUSTOMER_AGENT_SOP_CROSS_BASE_REPORT;
    if (output) {
      if (!path.isAbsolute(output)) throw new Error('Absolute report path required');
      writeFileSync(output, JSON.stringify({ r1, r2, sharedObject: shared.object, a: a.key, rejectedStage: b, observedSqlError, rejectionBranch, events, contentVersion: parsedShared.contentVersion, deletion, replayed: replayed.key,
        oldBaseImages: originalImages.map(({ rowId, sha256 }) => ({ rowId, sha256 })), actual: actual.map(({ rowId, sha256 }) => ({ rowId, sha256 })),
        setupBoundary: 'Synthetic identity/source seed and admin upload/admission/quality/publication preparation; actual restricted business trusted freeze and row deletion; both release pointer changes through publish API service, no admin UPDATE of release or lineage.' }, null, 2) + '\n');
    }
    expect(actual).toEqual(originalImages);
    expect(listPreviews(r1.releaseId!, new Set(['source-sop'])).map(image => image.rowId).sort()).toEqual(originalImages.map(image => image.rowId).sort());
    expect(listPreviews(r2.releaseId!, new Set(['source-sop'])).map(image => image.rowId)).toEqual(['sop:过敏流程SOP:2']);
  }, 60_000);
  it.each(['first-sheet-row-count','middle-row-deletion'] as const)('rejects shifted SOP ordinal identities without wrong binding: %s', async variant => {
    const published = await prepareInheritedJob();
    const baseReleaseId = (await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id as string;
    const beforePublishedRows = (await admin.query('SELECT * FROM content_intake.sop_candidate_rows WHERE candidate_id=$1 AND candidate_version=$2 ORDER BY business_entry_id', [published.key.candidateId, published.key.version])).rows;
    const beforePublishedMedia = (await admin.query('SELECT * FROM content_intake.sop_candidate_media WHERE candidate_id=$1 AND candidate_version=$2', [published.key.candidateId, published.key.version])).rows;
    const input = await createSyntheticSopWorkbook();
    // Test-only mutation of generated bytes through the existing parser package's
    // installed ExcelJS. No extra runtime dependency and no real workbook input.
    const bytes = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import ExcelJS from 'exceljs'; import { readFileSync } from 'node:fs';
      const book = new ExcelJS.Workbook(); await book.xlsx.load(readFileSync(0));
      if (process.argv[1] === 'first-sheet-row-count') book.worksheets[0].getCell('A1').value = null;
      else book.worksheets[1].spliceRows(1, 1);
      process.stdout.write(Buffer.from(await book.xlsx.writeBuffer()));`, variant], {
      cwd: path.resolve(import.meta.dirname, '../../../packages/content-intake'), input: input.bytes, maxBuffer: 16 * 1024 * 1024 });
    const parsed = (await tryParseSopAsFaq(bytes, { sourceId: 'source-sop', brandId: 'brand-a', shopId: 'shop-a' }))!;
    expect(parsed.parsed.ok).toBe(true); expect(parsed.rowBindings).toHaveLength(8);
    const form = new FormData(); form.set('operationId', `shift-${variant}-upload`); form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
    const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    const object = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
    const oldMaterial = (await admin.query('SELECT material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2', [published.key.candidateId, published.key.version])).rows[0].material;
    expect(object.sha256).not.toBe(oldMaterial.object.sha256);
    expect(parsed.contentVersion).toEqual({ kind: 'sha256', value: object.sha256 });
    const job = value(await svc.receive(actor(), 'source-sop', { operationId: `shift-${variant}-receive`, objectId: object.objectId, sourceVersion: 1,
      baseReleaseId, contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    let freezeRows: unknown, freezeMedia: unknown, observedSqlError: { code: string | undefined; message: string; where: string | undefined } | undefined;
    const observed: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT content_intake.freeze_sop_parsed_candidate')) { freezeRows = JSON.parse(String(values![3])); freezeMedia = JSON.parse(String(values![4])); }
        try { return await target.query(sql, values); }
        catch (error) {
          if (sql.includes('SELECT content_intake.freeze_sop_parsed_candidate') && error instanceof Error) {
            const pgError = error as Error & { code?: string; where?: string };
            observedSqlError = { code: pgError.code, message: pgError.message, where: pgError.where };
          }
          throw error;
        }
      };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    const before = await shape();
    const result = await createTrustedSopStage(observed, store, false)(actor(), job.jobId);
    const duplicateBindings = (freezeRows as { rowId: string; businessEntryId: string }[]).filter(row => row.rowId === 'sop:长痘痘SOP:1');
    expect(duplicateBindings.map(row => row.businessEntryId).sort()).toEqual(['sop8', 'sop9']);
    expect(observedSqlError).toMatchObject({ code: 'ZA003', message: 'MATERIAL_CHANGED' });
    const raisedLine = Number(observedSqlError!.where!.match(/register_sop_candidate_rows\(text,text,bigint,jsonb\) line (\d+) at RAISE/)?.[1]);
    const functionBody = (await admin.query<{ prosrc: string }>("SELECT prosrc FROM pg_proc WHERE oid='content_intake.register_sop_candidate_rows(text,text,bigint,jsonb)'::regprocedure")).rows[0]!.prosrc.split('\n');
    const rejectionBranch = functionBody.slice(raisedLine - 2, raisedLine).join('\n');
    expect(rejectionBranch).toContain("count(DISTINCT r->>'rowId')<>v_count");
    expect(functionBody[raisedLine - 1]).toContain("ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'");
    const output = process.env.CUSTOMER_AGENT_SOP_ROW_SHIFT_REPORT;
    if (output) {
      if (!path.isAbsolute(output)) throw new Error('Absolute report path required');
      writeFileSync(`${output}.${variant}.json`, JSON.stringify({ variant, baseReleaseId, published: published.key,
        fileSha256: object.sha256, contentVersion: parsed.contentVersion, parsedRows: parsed.rowBindings, beforePublishedRows,
        freezeRows, freezeMedia, result, observedSqlError, rejectionBranch, duplicateBindings }, null, 2) + '\n');
    }
    expect(result).toMatchObject({ ok: false, reason: 'MATERIAL_CHANGED', commit: 'rolled_back' });
    expect(await shape()).toEqual(before);
    expect((await admin.query('SELECT state,result_candidate_id,result_candidate_version FROM content_intake.parse_jobs WHERE job_id=$1', [job.jobId])).rows[0])
      .toEqual({ state: 'reading', result_candidate_id: null, result_candidate_version: null });
    expect((await admin.query('SELECT * FROM content_intake.sop_candidate_rows WHERE candidate_id=$1 AND candidate_version=$2 ORDER BY business_entry_id', [published.key.candidateId, published.key.version])).rows).toEqual(beforePublishedRows);
    expect((await admin.query('SELECT * FROM content_intake.sop_candidate_media WHERE candidate_id=$1 AND candidate_version=$2', [published.key.candidateId, published.key.version])).rows).toEqual(beforePublishedMedia);
    expect(listPreviews(object.objectId, new Set(['source-sop']))).toEqual([]);
  });
  it('converges concurrent requests and any busy retry onto one candidate and payload', async () => {
    const results = await Promise.all([stage(actor(), jobId), stage(actor(), jobId)]);
    const successful = results.filter(result => result.ok);
    expect(successful.length).toBeGreaterThan(0);
    const first = value(successful[0]!);
    for (const result of results) {
      if (result.ok) expect(result.value).toEqual(first);
      else expect(result).toMatchObject({ ok: false, code: 'OVERLOADED', reason: 'QUOTA_EXCEEDED', commit: 'rolled_back', diagnosticId: 'sop-media-busy' });
    }
    expect(value(await stage(actor(), jobId))).toEqual(first);
    expect((await shape()).candidates).toBe(1);
    expect((await admin.query("SELECT count(*)::int n FROM content_intake.objects WHERE purpose='sop-media'")).rows[0].n).toBe(1);
  });
  it('retains the other image when deletion commits before the freeze caller projects previews', async () => {
    const workbook = await createSyntheticSopWorkbook({ imageOnLastTextRow: true });
    const form = new FormData(); form.set('operationId', 'two-images-upload'); form.set('file', new Blob([new Uint8Array(workbook.bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
    const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    const object = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
    const nextJob = value(await svc.receive(actor(), 'source-sop', { operationId: 'two-images-receive', objectId: object.objectId, sourceVersion: 1,
      baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    let freezeReturned = false, deletionInjected = false;
    let deleted: Awaited<ReturnType<ReturnType<typeof createSopRowDeletionCandidate>>> | undefined;
    const delayed: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => { const result = await target.query(sql, values);
        if (sql.includes('SELECT content_intake.freeze_sop_parsed_candidate')) freezeReturned = true;
        if (sql === 'COMMIT' && freezeReturned && !deletionInjected) {
          deletionInjected = true;
          const row = (await admin.query('SELECT candidate_id,version::int,digest FROM content_intake.candidate_versions WHERE object_id=$1', [object.objectId])).rows[0];
          deleted = await createSopRowDeletionCandidate(business, false)(actor(), { operationId: 'delete-before-stage-response',
            key: { candidateId: row.candidate_id, version: row.version, digest: row.digest }, rowId: 'sop:过敏流程SOP:2' });
        }
        return result; };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    const frozen = value(await createTrustedSopStage(delayed, store, false)(actor(), nextJob.jobId));
    expect(value(deleted!).key.version).toBe(2);
    expect(listPreviews(frozen.key.candidateId, new Set(['source-sop'])).map(item => item.rowId)).toEqual(['sop:品质售后SOP:2']);
  });
  it('keeps committed registration on lost COMMIT acknowledgement and recovers from the validated job', async () => {
    let freezeReturned = false, acknowledgementLost = false;
    const lossy: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => { const result = await target.query(sql, values);
        if (sql.includes('SELECT content_intake.freeze_sop_parsed_candidate')) freezeReturned = true;
        if (sql === 'COMMIT' && freezeReturned && !acknowledgementLost) { acknowledgementLost = true; throw new Error('synthetic lost COMMIT response'); }
        return result; };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    expect(await createTrustedSopStage(lossy, store, false)(actor(), jobId)).toMatchObject({ ok: false, commit: 'unknown' });
    expect((await shape()).candidates).toBe(1); const recovered = value(await stage(actor(), jobId));
    expect((await shape()).candidates).toBe(1); expect(listPreviews(recovered.key.candidateId, new Set(['source-sop']))).toHaveLength(1);
  });
});
