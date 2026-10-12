import path from 'node:path';
import { Readable } from 'node:stream';
import { Pool, type Client } from 'pg';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { applyDatabaseMigrations, verifyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createSyntheticSopWorkbook, tryParseSopAsFaq } from '@customer-agent/content-intake';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { createIntakePurposePool, type IntakePurposePool } from '../src/content-intake/runtime-pool.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';
import { createTrustedSopStage } from '../experiments/sop-row-deletion/trusted-stage.js';
import { createSopRowDeletionCandidate, type DeleteSopRow } from '../experiments/sop-row-deletion/consumer.js';
import type { AuthenticatedUser } from '../src/auth-service.js';
import { discardPreviews, listPreviews } from '../src/content-intake/linked-preview.js';
import { canonical, digest } from '../src/content-intake/material.js';
import type { IntakePool, IntakeResult } from '../src/content-intake/transaction.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const actor = (id = 'enabler'): AuthenticatedUser => ({ user_id: `user-${id}`, role: 'owner', auth_mode: 'mock' });
function value<T>(result: IntakeResult<T>): T { expect(result.ok, JSON.stringify(result)).toBe(true); if (!result.ok) throw new Error(JSON.stringify(result)); return result.value; }
describe.skipIf(!enabled)('Versioned SOP row deletion: actual PG15, restricted business capability, synthetic parser', () => {
  let pg: Pg15Harness, admin: Client, setupPool: Pool, business: IntakePurposePool;
  let key: DeleteSopRow['key'];
  let bindings: NonNullable<Awaited<ReturnType<typeof tryParseSopAsFaq>>>['rowBindings'];
  let svc: ReturnType<typeof createContentIntakeService>;
  let remove: ReturnType<typeof createSopRowDeletionCandidate>;
  let stage: ReturnType<typeof createTrustedSopStage>;
  beforeEach(async () => {
    pg = new Pg15Harness(); pg.start(); const db = pg.createDatabase('sop_row');
    admin = await pg.connect(db.config); await applyDatabaseMigrations(admin); await seedIntakeSyntheticHost(admin, 'product', 'xlsx', true);
    expect(await verifyDatabaseMigrations(admin)).toMatchObject({ status: 'PASS', migrationCount: 40 });
    await admin.query('CREATE ROLE sop_business LOGIN NOINHERIT; GRANT intake_business TO sop_business');
    business = createIntakePurposePool({ ...db.config, user: 'sop_business', max: 4 }, 'business');
    setupPool = new Pool(db.config);
    const store = createContentObjectStore(path.join(pg.root, 'objects'));
    svc = createContentIntakeService(setupPool, store, (_id, error) => console.error(error));
    stage = createTrustedSopStage(business, store, false);
    const workbook = await createSyntheticSopWorkbook();
    const parsed = await tryParseSopAsFaq(workbook.bytes, { sourceId: 'source-sop', brandId: 'brand-a', shopId: 'shop-a' });
    expect(parsed?.parsed.ok).toBe(true); bindings = parsed!.rowBindings;
    const form = new FormData(); form.set('operationId', 'sop-delete-upload'); form.set('file', new Blob([new Uint8Array(workbook.bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
    const request = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    const object = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await request.arrayBuffer())), request.headers.get('content-type')!));
    const job = value(await svc.receive(actor(), 'source-sop', { operationId: 'sop-delete-receive', objectId: object.objectId, sourceVersion: 1,
      baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    key = value(await stage(actor(), job.jobId)).key;
    remove = createSopRowDeletionCandidate(business, false, (_id, error) => { if (!(error instanceof Error && 'reason' in error)) console.error(error); });
  }, 60_000);
  afterEach(async () => {
    try {
      // Each isolated database restarts its release sequence (rel_2), while the
      // module cache lives for the whole suite. Release only this fixture's aliases.
      if (admin) {
        const keys = await admin.query<{ key: string }>(`SELECT release_id AS key FROM public.content_releases
          UNION SELECT candidate_id FROM content_intake.candidate_versions
          UNION SELECT object_id FROM content_intake.objects`);
        for (const { key: cacheKey } of keys.rows) discardPreviews(cacheKey);
      }
    } finally {
      try { await business?.end(); await setupPool?.end(); await admin?.end(); } finally { pg?.stop(); }
    }
  });
  const request = (rowId: string, operationId = 'sop-delete-one'): DeleteSopRow => ({ key, rowId, operationId });
  async function state() {
    return (await admin.query(`SELECT c.version::int,c.state,c.digest,c.material,c.source_evidence_version::int,
      content_intake.quality_state(c.candidate_id,c.version) AS quality FROM content_intake.candidate_versions c WHERE candidate_id=$1 ORDER BY version`, [key.candidateId])).rows;
  }
  it('restricted role cannot execute the old media-only command or write the new provenance table', async () => {
    const c = await business.connect();
    try {
      await expect(c.query('SELECT content_intake.delete_unused_sop_row($1,$2,$3)', [key.candidateId, key.version, bindings[0]!.rowId])).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('DELETE FROM content_intake.sop_candidate_rows')).rejects.toMatchObject({ code: '42501' });
      expect((await c.query("SELECT has_function_privilege('intake_usage','content_intake.revise_unused_sop_row(text,text,bigint,text,text)','EXECUTE') AS allowed")).rows[0].allowed).toBe(false);
    } finally { c.release(); }
  });
  it('removes a text-only row in a new version, keeps immutable history and resets evidence/quality', async () => {
    const row = bindings.find(b => b.rowId !== 'sop:过敏流程SOP:2')!; const before = await state();
    const result = value(await remove(actor(), request(row.rowId)));
    expect(result.key.version).toBe(2); expect(result.key.digest).not.toBe(key.digest);
    const after = await state(); expect(after[0].material).toEqual(before[0].material); expect(after[0].digest).toBe(before[0].digest);
    expect(after[0].state).toBe('invalidated'); expect(after[1].material.entries).toHaveLength(bindings.length - 1);
    expect(after[1].material.entries.some((e: { businessEntryId: string }) => e.businessEntryId === row.businessEntryId)).toBe(false);
    expect(digest(canonical(after[1].material))).toBe(result.key.digest);
    expect(after[1].source_evidence_version).toBe(0); expect(after[1].quality).toBe('not_frozen');
    expect((await admin.query('SELECT count(*)::int n FROM content_intake.sop_candidate_media WHERE candidate_id=$1 AND candidate_version=2', [key.candidateId])).rows[0].n).toBe(1);
  });
  it('removes image-row text and its exclusive unused media in the same transaction', async () => {
    value(await remove(actor(), request('sop:过敏流程SOP:2')));
    expect((await state())[1].material.entries).toHaveLength(bindings.length - 1);
    expect((await admin.query('SELECT state FROM content_intake.sop_media_objects')).rows).toEqual([{ state: 'discarded' }]);
    expect((await admin.query('SELECT count(*)::int n FROM content_intake.sop_candidate_media')).rows[0].n).toBe(0);
  });
  it('does not delete shared media still referenced by another row', async () => {
    const other = bindings.find(b => b.rowId !== 'sop:过敏流程SOP:2')!;
    await admin.query(`INSERT INTO content_intake.sop_candidate_media SELECT candidate_id,candidate_version,source_id,media_object_id,
      split_part($2,':',2),split_part($2,':',3)::int,column_number,$2,2,sha256,mime,bytes FROM content_intake.sop_candidate_media WHERE candidate_id=$1`, [key.candidateId, other.rowId]);
    value(await remove(actor(), request('sop:过敏流程SOP:2')));
    expect((await admin.query('SELECT state FROM content_intake.sop_media_objects')).rows).toEqual([{ state: 'staged' }]);
    expect((await admin.query('SELECT row_id FROM content_intake.sop_candidate_media WHERE candidate_version=2')).rows).toEqual([{ row_id: other.rowId }]);
  });
  it('rejects unauthorized, unknown row and stale digest without changing material', async () => {
    const before = await state();
    expect(await remove(actor('agent'), request(bindings[0]!.rowId))).toMatchObject({ ok: false, reason: 'SCOPE_DENIED' });
    expect(await remove(actor(), request('sop:不存在:999'))).toMatchObject({ ok: false, reason: 'SCOPE_DENIED', code: 'NOT_FOUND' });
    expect(await remove(actor(), { ...request(bindings[0]!.rowId), key: { ...key, digest: 'b'.repeat(64) } })).toMatchObject({ ok: false, reason: 'MATERIAL_CHANGED' });
    expect(await state()).toEqual(before);
  });
  it('serializes identical operations and rejects changed-body reuse', async () => {
    const req = request(bindings[1]!.rowId);
    const [a, b] = await Promise.all([remove(actor(), req), remove(actor(), req)]); value(a); expect(b).toEqual(a);
    expect(await state()).toHaveLength(2);
    expect(await remove(actor(), { ...req, rowId: bindings[2]!.rowId })).toMatchObject({ ok: false });
    expect(await state()).toHaveLength(2);
  });
  it('keeps a committed revision on lost COMMIT acknowledgement and replays it once', async () => {
    let lose = true;
    const lossy: IntakePool = { async connect() {
      const c = await business.connect();
      return new Proxy(c, { get(target, property) {
        if (property === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (lose && sql === 'COMMIT') { lose = false; throw new Error('synthetic lost commit response'); }
          return result;
        };
        const member: unknown = Reflect.get(target, property);
        return typeof member === 'function' ? member.bind(target) : member;
      } });
    } };
    const command = createSopRowDeletionCandidate(lossy, false), req = request('sop:过敏流程SOP:2');
    const previewBefore = listPreviews(key.candidateId, new Set(['source-sop']));
    expect(await command(actor(), req)).toMatchObject({ ok: false, commit: 'unknown' });
    expect(listPreviews(key.candidateId, new Set(['source-sop']))).toEqual(previewBefore);
    const committed = await state(); expect(committed).toHaveLength(2);
    expect(value(await command(actor(), req)).key.version).toBe(2); expect(await state()).toEqual(committed);
    expect(listPreviews(key.candidateId, new Set(['source-sop']))).toEqual([]);
  });
  it('deleting the final unused row cancels the candidate and never creates an empty publication', async () => {
    for (const [i, row] of bindings.entries()) {
      const next = value(await remove(actor(), request(row.rowId, `delete-${i}`))); key = next.key;
      if (i === bindings.length - 1) expect(next.state).toBe('cancelled');
    }
    const all = await state(); expect(all).toHaveLength(bindings.length); expect(all.at(-1).state).toBe('cancelled');
    expect((await admin.query('SELECT count(*)::int n FROM content_intake.publications')).rows[0].n).toBe(0);
  });
  async function publishCurrent() {
    const material = (await state()).find(row => row.version === key.version).material;
    value(await svc.confirmSource(actor(), { operationId: 'source-ok', key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-v1', acquisition: 'controlled-synthetic-export', objectSha256: material.object.sha256, reason: '合成确认' }));
    value(await svc.freezeQuality(actor('reviewer'), { operationId: 'quality-freeze', key }));
    const quality = value(await svc.qualityPreview(actor('reviewer'), key));
    value(await svc.checkQuality(actor('reviewer'), { operationId: 'quality-check', key, phase: 'initial',
      checks: quality.population.filter(row => quality.initialScriptIds.includes(row.script_id)).map(row => ({ scriptId: row.script_id, contentHash: row.content_hash, defect: false, reason: '' })) }));
    return value(await svc.publish(actor(), { operationId: 'publish-one', key, baseReleaseId: 'rel_native_base', sourceEvidenceVersion: 1,
      confirmed: true, title: '合成', summary: '合成' }));
  }
  it('refuses published text/media after an actual source/quality/publish sequence', async () => {
    const material = (await state())[0].material;
    const release = await publishCurrent();
    const published = await state();
    expect(await remove(actor(), request(bindings[0]!.rowId))).toMatchObject({ ok: false, reason: 'ALREADY_PUBLISHED' });
    expect(await state()).toEqual(published);
    // The versioned lineage trigger adopts the exact media mapping on real publication.
    expect((await admin.query('SELECT state FROM content_intake.sop_media_objects')).rows).toEqual([{ state: 'adopted' }]);
    const job = value(await svc.receive(actor(), 'source-sop', { operationId: 'after-published-receive', objectId: material.object.objectId, sourceVersion: 1,
      baseReleaseId: release.releaseId, contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null }));
    key = value(await stage(actor(), job.jobId)).key;
    const next = await state();
    expect(await remove(actor(), request(bindings[1]!.rowId, 'delete-published-history'))).toMatchObject({ ok: false, reason: 'ALREADY_PUBLISHED' });
    expect(await state()).toEqual(next);
  });
  it.each(['revoked', 'expired', 'role', 'tenant'] as const)('refuses current %s authority and leaves the row intact', async cause => {
    const before = await state();
    if (cause === 'revoked' || cause === 'expired') await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成撤权' WHERE grant_id='business-enabler-candidate-cancel-sop'");
    if (cause === 'expired') {
      await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
        to_jsonb(g)||jsonb_build_object('grant_id','short-grant','version',1,'last_change_reason',NULL,'revoked_at',NULL,'expires_at',clock_timestamp()+interval '100 milliseconds'))).*
        FROM content_intake.grants g WHERE grant_id='business-enabler-candidate-cancel-sop'`);
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
    expect(await remove(actor(cause === 'tenant' ? 'other' : 'enabler'), request(bindings[0]!.rowId))).toMatchObject({ ok: false, reason: 'SCOPE_DENIED', code: 'NOT_FOUND' });
    expect(await state()).toEqual(before);
  });
  it('refuses a missing/mismatched trusted row binding rather than inferring by ordinal', async () => {
    const c = await setupPool.connect();
    try { await expect(c.query('SELECT content_intake.register_sop_candidate_rows($1,$2,$3,$4)',
      ['enabler', key.candidateId, key.version, JSON.stringify(bindings.map((row, index) => index ? row : { ...row, answerText: 'changed' }))])).rejects.toMatchObject({ code: 'ZA003' }); }
    finally { c.release(); }
    await admin.query('DELETE FROM content_intake.sop_candidate_rows WHERE candidate_id=$1', [key.candidateId]);
    expect(await remove(actor(), request(bindings[0]!.rowId))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await state()).toHaveLength(1);
  });
  it('rolls back text, media, version and receipt together if failure occurs after the function returns', async () => {
    const before = await state(), previews = [...listPreviews(key.candidateId, new Set(['source-sop']))];
    const broken: IntakePool = { async connect() { const c = await business.connect(); return new Proxy(c, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => {
        const result = await target.query(sql, values);
        if (sql.startsWith('SELECT content_intake.revise_unused_sop_row')) throw new Error('synthetic failure after deletion, before receipt');
        return result;
      };
      const member: unknown = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
    } }); } };
    expect(await createSopRowDeletionCandidate(broken, false)(actor(), request('sop:过敏流程SOP:2'))).toMatchObject({ ok: false, commit: 'rolled_back' });
    expect(await state()).toEqual(before); expect(listPreviews(key.candidateId, new Set(['source-sop']))).toEqual(previews);
    expect((await admin.query('SELECT state FROM content_intake.sop_media_objects')).rows).toEqual([{ state: 'staged' }]);
    expect((await admin.query("SELECT count(*)::int n FROM backend_review.receipts WHERE operation='intake:sop-row-delete-v2'")).rows[0].n).toBe(0);
  });

  it.each(['delete-image', 'delete-text'] as const)('a late parse COMMIT response preserves the confirmed row image set: %s', async deletion => {
    const original = key, objectId = (await state())[0].material.object.objectId;
    const row = deletion === 'delete-image' ? bindings.find(item => item.rowId === 'sop:过敏流程SOP:2')!
      : bindings.find(item => item.rowId !== 'sop:过敏流程SOP:2')!;
    const expectedImages = deletion === 'delete-image' ? 0 : 1;
    // Model a first candidate projection: the new parse will stage the exact
    // input object again, while its candidate alias has not been installed yet.
    discardPreviews(original.candidateId);
    const job = value(await svc.receive(actor(), 'source-sop', { operationId: 'late-parse-receive', objectId, sourceVersion: 1,
      baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: key }));
    let signalCommitted!: () => void, releaseResponse!: () => void;
    const committed = new Promise<void>(resolve => { signalCommitted = resolve; });
    const response = new Promise<void>(resolve => { releaseResponse = resolve; });
    const delayed: IntakePool = { async connect() {
      const c = await business.connect(); let staged = false;
      return new Proxy(c, { get(target, property) {
        if (property === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (sql.startsWith('SELECT content_intake.freeze_sop_parsed_candidate')) staged = true;
          if (staged && sql === 'COMMIT') {
            // The real database has committed and released its locks. Delay only
            // this connection's response, not the SQL or a SELECT's result rows.
            staged = false; signalCommitted(); await response;
          }
          return result;
        };
        const member: unknown = Reflect.get(target, property);
        return typeof member === 'function' ? member.bind(target) : member;
      } });
    } };
    const parsing = createTrustedSopStage(delayed, createContentObjectStore(path.join(pg.root, 'objects')), false)(actor(), job.jobId);
    try {
      await Promise.race([committed, parsing.then(result => { throw new Error(`Parse returned before the COMMIT gate: ${JSON.stringify(result)}`); })]);
      // A second normal service connection observes the committed job/key before
      // the first parser has projected its previews; no admin-derived key is used.
      const observed = value(await svc.job(actor(), job.jobId));
      expect(observed.state).toBe('validated'); expect(observed.candidateId).toBe(original.candidateId);
      key = value(await svc.candidate(actor(), observed.candidateId!, observed.candidateVersion!)).key;
      expect(key.version).toBe(2);
      key = value(await remove(actor(), request(row.rowId, 'delete-before-parse-response'))).key;
      expect(key.version).toBe(3);
      expect(listPreviews(key.candidateId, new Set(['source-sop']))).toHaveLength(expectedImages);
    } finally { releaseResponse(); await parsing; }
    expect(value(await parsing).key.version).toBe(2);
    expect((await state()).at(-1).material.entries.some((entry: { businessEntryId: string }) =>
      entry.businessEntryId === row.businessEntryId)).toBe(false);
    expect(listPreviews(key.candidateId, new Set(['source-sop']))).toHaveLength(expectedImages);
    const published = await publishCurrent();
    expect(published.releaseId).not.toBeNull();
    expect(listPreviews(published.releaseId!, new Set(['source-sop']))).toHaveLength(expectedImages);
  });

  it('old deletion replay never removes images from a reimported or published newer version', async () => {
    const original = key;
    const oldRequest = request('sop:过敏流程SOP:2');
    const removed = value(await remove(actor(), oldRequest));
    expect(listPreviews(key.candidateId, new Set(['source-sop']))).toEqual([]);
    // Explicitly upload a new content version; a new job for the old bytes
    // must not restore the deleted row. The original deletion receipt survives.
    const workbook = await createSyntheticSopWorkbook({ textSuffix: '新版' });
    const form = new FormData(); form.set('operationId', 'reimport-new-content-upload');
    form.set('file', new Blob([new Uint8Array(workbook.bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'synthetic-sop.xlsx');
    const upload = new Request('http://synthetic.invalid', { method: 'POST', body: form });
    const object = value(await svc.upload(actor(), 'source-sop', Readable.from(Buffer.from(await upload.arrayBuffer())), upload.headers.get('content-type')!));
    const job = value(await svc.receive(actor(), 'source-sop', { operationId: 'reimport-after-delete', objectId: object.objectId, sourceVersion: 1,
      baseReleaseId: 'rel_native_base', contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: removed.key }));
    key = value(await stage(actor(), job.jobId)).key;
    expect(key.candidateId).toBe(original.candidateId); expect(key.version).toBe(3);
    const currentPreview = [...listPreviews(key.candidateId, new Set(['source-sop']))]; expect(currentPreview).toHaveLength(1);
    expect(value(await remove(actor(), oldRequest))).toEqual(removed);
    expect(listPreviews(key.candidateId, new Set(['source-sop']))).toEqual(currentPreview);
    const release = await publishCurrent();
    expect(release.releaseId).not.toBeNull();
    expect(value(await remove(actor(), oldRequest))).toEqual(removed);
    expect(listPreviews(release.releaseId!, new Set(['source-sop']))).toEqual(currentPreview);
    expect(listPreviews(key.candidateId, new Set(['source-sop']))).toEqual(currentPreview);
  });

});
