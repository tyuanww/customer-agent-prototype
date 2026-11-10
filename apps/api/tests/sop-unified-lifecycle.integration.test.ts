import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseContractSchema as parse, type ContractSchemaName, type components } from '@customer-agent/contracts/sop-unified';
import { parseContractSchema as parseLegacy, type components as LegacyComponents } from '@customer-agent/contracts';
import { SOP_TASK_FORMAT, SOP_TASK_STRUCTURE_SHA256 } from '@customer-agent/content-intake';
import { syntheticGraphMapping, syntheticTaskGraphWorkbook, graphImageFixtures, readSyntheticQualityReport } from '../../../packages/content-intake/tests/support/sop-task-graph-workbook.js';
import { createIntakeSyntheticHost, type IntakeSyntheticHost, type IntakeSyntheticIdentity } from './support/intake-synthetic-host.js';
import { SOP_CONTRACT_SET, LEGACY_CONTRACT_SET } from '../src/content-intake/contract-view.js';
import { canonical, digest } from '../src/content-intake/material.js';
import type { IntakePool } from '../src/content-intake/transaction.js';

type C = components['schemas'];
const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const evidenceRoot = path.join(os.tmpdir(), `sop-unified-lifecycle-evidence-${randomUUID()}`);
describe.skipIf(!enabled)('normal unified SOP HTTP lifecycle on PostgreSQL 15', () => {
  let host: Pick<IntakeSyntheticHost, 'requestAs' | 'close' | 'root' | 'apiOrigin' | 'identityOrigin' | 'selectIdentity'>, admin: Client;
  let arm: 'freeze' | 'quality-check' | 'publish' | 'rollback' | null = null;
  const diagnostics: string[] = [];
  let sequence = 0;
  let backupInput: string;
  let agentAuthorization: string | null = null;
  const operation = (name: string) => `graph-${name}-${++sequence}`;
  const candidatePath = (key: C['IntakeCandidateKey']) => `/v1/intake/candidates/${key.candidateId}/versions/${key.version}`;
  const request = (actor: IntakeSyntheticIdentity, pathname: string, init: RequestInit = {}, view: string = SOP_CONTRACT_SET) => {
    const headers = new Headers(init.headers);
    if (view !== 'absent') headers.set('X-Intake-Contract-Set', view);
    return host.requestAs(actor, pathname, { ...init, headers });
  };
  const post = (actor: IntakeSyntheticIdentity, pathname: string, body: unknown, view: string = SOP_CONTRACT_SET) =>
    request(actor, pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, view);
  async function checked<Name extends ContractSchemaName>(response: Response, schema: Name): Promise<C[Name]> {
    const body: unknown = await response.json();
    expect(response.ok, `${response.status} ${JSON.stringify(body)}\n${diagnostics.slice(-3).join('\n')}`).toBe(true);
    expect(response.headers.get('cache-control')).toContain('no-store');
    return parse(schema, body);
  }
  async function denial(response: Response, status: number, reason?: string) {
    const body = parse('IntakeError', await response.json());
    expect(response.status, JSON.stringify(body)).toBe(status);
    if (reason) expect(body.error.details.reason).toBe(reason);
    expect(Object.keys(body)).toEqual(['error']);
    expect(JSON.stringify(body)).not.toMatch(/answerText|graphDigest|canonical_graph|base64|payloadObjectId/);
  }
  function uncertain(pool: IntakePool): IntakePool {
    return { connect: async () => {
      const client = await pool.connect();
      let lose: typeof arm = null;
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (arm === 'freeze' && sql.startsWith('SELECT content_intake.freeze_sop_graph_candidate')) lose = 'freeze';
          if (arm && sql.startsWith('INSERT INTO backend_review.receipts') && values?.[1] === `intake:${arm}`) lose = arm;
          if (sql === 'COMMIT' && lose && arm === lose) { arm = null; throw new Error('SYNTHETIC_COMMIT_RESPONSE_LOST_AFTER_REAL_COMMIT'); }
          return result;
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
  }
  beforeAll(async () => {
    mkdirSync(evidenceRoot, { mode: 0o700 });
    console.info(JSON.stringify({ probe: 'sop-unified-evidence-directory', path: evidenceRoot }));
    host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime', includeLegacySearch: false, wrapBusinessPool: uncertain,
      observeSyntheticRequest: (actor, headers) => { if (actor === 'agent') agentAuthorization = headers.get('authorization'); },
      observeError: error => diagnostics.push(error instanceof Error
        ? `${error.stack ?? error.message}\n${JSON.stringify(error, ['code', 'detail', 'where'])}` : String(error)),
      configureDatabase: async client => {
        admin = client;
        await admin.query('BEGIN');
        try {
          await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
            VALUES('source-a',2,$1,$2,$3,$4,$5::jsonb)`, [SOP_TASK_FORMAT.templateVersion, SOP_TASK_FORMAT.ruleVersion, SOP_TASK_FORMAT.mappingVersion,
            SOP_TASK_STRUCTURE_SHA256, JSON.stringify(syntheticGraphMapping())]);
          await admin.query("UPDATE content_intake.sources SET current_mapping_version=2 WHERE source_id='source-a'");
          await admin.query(`INSERT INTO content_intake.scopes SELECT (jsonb_populate_record(NULL::content_intake.scopes,
            to_jsonb(s)||jsonb_build_object('scope_id','scope-solo','domain','sop'))).* FROM content_intake.scopes s WHERE scope_id='scope-a'`);
          await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES('source-solo','scope-solo',1,'v2-preview')");
          await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
            VALUES('source-solo',1,$1,$2,$3,$4,$5::jsonb)`, [SOP_TASK_FORMAT.templateVersion, SOP_TASK_FORMAT.ruleVersion, SOP_TASK_FORMAT.mappingVersion,
            SOP_TASK_STRUCTURE_SHA256, JSON.stringify(syntheticGraphMapping(true))]);
          await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
            to_jsonb(g)||jsonb_build_object('grant_id',grant_id||'-solo','scope_id','scope-solo','source_id',CASE WHEN source_id IS NULL THEN NULL ELSE 'source-solo' END,
              'parent_grant_id',CASE WHEN parent_grant_id IS NULL THEN NULL ELSE parent_grant_id||'-solo' END))).*
            FROM content_intake.grants g WHERE scope_id='scope-a' ORDER BY CASE kind WHEN 'allocation' THEN 0 WHEN 'delegation' THEN 1 ELSE 2 END`);
          await admin.query(`INSERT INTO content_intake.store_set_members(tenant_id,app_id,version,scope_id,source_id,content_valid_until)
            SELECT tenant_id,app_id,version,'scope-solo','source-solo',content_valid_until FROM content_intake.store_set_members WHERE source_id='source-a'`);
          await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES('source-unmapped','scope-solo',1,'v2-preview')");
          await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest)
            SELECT 'source-unmapped',version,template_version,rule_version,mapping_version,structure_digest FROM content_intake.source_mappings WHERE source_id='source-solo'`);
          await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
            to_jsonb(g)||jsonb_build_object('grant_id',grant_id||'-unmapped','source_id',CASE WHEN source_id IS NULL THEN NULL ELSE 'source-unmapped' END,
              'parent_grant_id',CASE WHEN parent_grant_id IS NULL THEN NULL ELSE parent_grant_id||'-unmapped' END))).*
            FROM content_intake.grants g WHERE scope_id='scope-solo' ORDER BY CASE kind WHEN 'allocation' THEN 0 WHEN 'delegation' THEN 1 ELSE 2 END`);
          for (const [id, scope, kind] of [['product-graph', 'scope-a', 'product'], ['scenario-graph', 'scope-a', 'scenario'],
            ['product-solo', 'scope-solo', 'product'], ['scenario-solo', 'scope-solo', 'scenario']]) {
            await admin.query('INSERT INTO content_intake.vocabulary VALUES($1,$2,$3,$4,true)', [id, scope, kind, digest(id!)]);
            await admin.query('INSERT INTO content_intake.vocabulary_displays VALUES($1,1,$2)', [id, `合成词项 ${id}`]);
          }
          await admin.query('COMMIT');
        } catch (error) { await admin.query('ROLLBACK'); throw error; }
      } });
    expect((await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_graph_versions')).rows[0].count).toBe(0);
  }, 120_000);
  afterAll(async () => {
    writeFileSync(path.join(evidenceRoot, 'http-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    await host?.close();
  });

  async function receiveJob(sourceId: string, bytes: Buffer, base: string, prior: C['IntakeCandidateKey'] | null = null) {
    const form = new FormData(); form.set('operationId', operation('upload'));
    form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), 'synthetic-task-graph.xlsx');
    const object = await checked(await request('enabler', `/v1/intake/sources/${sourceId}/objects`, { method: 'POST', body: form }), 'IntakeObject');
    const body = { operationId: operation('receive'), objectId: object.objectId, sourceVersion: sourceId === 'source-a' ? 2 : 1, baseReleaseId: base,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: prior };
    let job = await checked(await post('enabler', `/v1/intake/sources/${sourceId}/candidates`, body), 'IntakeParseJob');
    const until = Date.now() + 20_000;
    while (job.state === 'reading' || job.state === 'parsing') {
      if (Date.now() >= until) throw new Error(`Parse did not settle ${JSON.stringify(job)}`);
      await new Promise(resolve => setTimeout(resolve, 20));
      job = await checked(await request('enabler', `/v1/intake/parse-jobs/${job.jobId}`), 'IntakeParseJob');
    }
    return { object, job, receiveBody: body };
  }
  async function receive(sourceId: 'source-a' | 'source-solo', bytes: Buffer, base: string, prior: C['IntakeCandidateKey'] | null = null) {
    const { object, job, receiveBody } = await receiveJob(sourceId, bytes, base, prior);
    expect(job.state, `${JSON.stringify(job)}\n${diagnostics.slice(-3).join('\n')}`).toBe('validated');
    const candidate = await checked(await request('enabler', `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`), 'IntakeCandidate');
    expect((await admin.query('SELECT contract_view FROM content_intake.parse_jobs WHERE job_id=$1', [job.jobId])).rows[0].contract_view).toBe('graph');
    return { candidate, object, job, receiveBody };
  }
  async function material(key: C['IntakeCandidateKey']) {
    const pages: C['IntakeCandidatePage'][] = [];
    let cursor: string | null = null;
    do {
      const page: C['IntakeCandidatePage'] = await checked(await request('enabler', `${candidatePath(key)}/material?limit=1${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeCandidatePage');
      if (pages[0]) expect(page.materialHeader).toEqual(pages[0].materialHeader);
      if (cursor && pages.length === 1) {
        const previous = await checked(await request('enabler', `${candidatePath(key)}/material?limit=1&cursor=${cursor}&previous=true`), 'IntakeCandidatePage');
        expect(previous).toEqual(pages[0]);
      }
      expect(page.entries.length + page.differences.length + (page.sopFlows?.length ?? 0) + (page.sopDifferences?.length ?? 0)).toBeLessThanOrEqual(1);
      pages.push(page); cursor = page.nextCursor;
    } while (cursor);
    const result = parse('IntakeMaterial', { ...pages[0]!.materialHeader, entries: pages.flatMap(p => p.entries), differences: pages.flatMap(p => p.differences),
      sopFlows: pages.flatMap(p => p.sopFlows ?? []), sopDifferences: pages.flatMap(p => p.sopDifferences ?? []) });
    expect(digest(canonical(result))).toBe(key.digest);
    return { result, pages };
  }
  async function confirm(input: Awaited<ReturnType<typeof receive>>) {
    const key = input.candidate.key;
    return checked(await post('enabler', `${candidatePath(key)}/source-confirmation`, { operationId: operation('confirm'), key,
      expectedEvidenceVersion: 0, confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-explicit-source', acquisition: 'controlled-synthetic-export',
      objectSha256: input.object.sha256, reason: '合成来源与完整显式映射已核对' }), 'IntakeCandidate');
  }
  async function quality(key: C['IntakeCandidateKey'], lose = false) {
    const frozen = await checked(await post('reviewer', `${candidatePath(key)}/quality/freeze`, { operationId: operation('freeze'), key }), 'IntakeQualityReceipt');
    expect(frozen.canonicalEncodingVersion).toBe('candidate-sop-task-graph-v2');
    const status = await checked(await request('reviewer', `${candidatePath(key)}/quality?digest=${key.digest}`), 'IntakeQualityStatus');
    const faq: C['IntakeQualitySample'][] = [], sop: C['IntakeSopSopQualitySample'][] = [];
    let cursor: string | null = null;
    do {
      const page: C['IntakeQualitySamplePage'] = await checked(await request('reviewer', `${candidatePath(key)}/quality/samples?digest=${key.digest}&viewHash=${status.viewHash}&phase=initial&limit=1${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeQualitySamplePage');
      expect(page.items.length + (page.sopItems?.length ?? 0)).toBeLessThanOrEqual(1);
      faq.push(...page.items); sop.push(...page.sopItems ?? []); cursor = page.nextCursor;
    } while (cursor);
    expect(sop.length).toBe(status.plan.sopPlan!.targetCount);
    expect(digest(canonical(sop.map(item => item.target)))).toBe(status.plan.sopPlan!.targetsDigest);
    const body = { operationId: operation('check'), key, phase: 'initial', materialDigest: key.digest,
      checks: faq.map(item => ({ scriptId: item.scriptId, contentHash: item.contentHash, defect: false, reason: '' })),
      sopChecks: sop.map(item => ({ ...item.target, defect: false, reason: '' })) };
    await denial(await post('reviewer', `${candidatePath(key)}/quality/checks`, { ...body, operationId: operation('missing-check'), sopChecks: [] }), 422, 'SOP_GRAPH_INVALID');
    if (lose) arm = 'quality-check';
    const submitted = await post('reviewer', `${candidatePath(key)}/quality/checks`, body);
    if (lose) await denial(submitted, 503, 'COMMIT_UNKNOWN');
    else expect((await checked(submitted, 'IntakeQualityReceipt')).state).toBe('passed');
    const recovered = await checked(await request('reviewer', `/v1/intake/quality/operations/${body.operationId}?action=quality-check`), 'IntakeQualityReceipt');
    expect(recovered.state).toBe('passed'); expect(recovered.sopPlan).toEqual(status.plan.sopPlan);
    await denial(await request('reviewer', `/v1/intake/quality/operations/${body.operationId}?action=quality-check`, {}, LEGACY_CONTRACT_SET), 409, 'IDEMPOTENCY_CONFLICT');
    const replay = await checked(await post('reviewer', `${candidatePath(key)}/quality/checks`, body), 'IntakeQualityReceipt');
    expect(replay).toEqual(recovered);
    const after = await checked(await request('reviewer', `${candidatePath(key)}/quality?digest=${key.digest}`), 'IntakeQualityStatus');
    expect(after.rounds[0]?.sopChecksSummary).toEqual({ checkedCount: sop.length, defectCount: 0, checksDigest: digest(canonical(body.sopChecks)) });
    return { faq, sop, after };
  }
  async function publish(candidate: C['IntakeCandidate'], base: string, lose = false) {
    const body = { operationId: operation('publish'), key: candidate.key, baseReleaseId: base,
      sourceEvidenceVersion: candidate.sourceEvidenceVersion, title: '合成图发布', summary: '完整正常写链合成验证', confirmed: true };
    if (lose) arm = 'publish';
    const response = await post('director', `${candidatePath(candidate.key)}/publish`, body);
    if (lose) await denial(response, 503, 'COMMIT_UNKNOWN');
    else await checked(response, 'IntakeReceipt');
    const receipt = await checked(await request('director', `/v1/intake/operations/${body.operationId}?action=publish`), 'IntakeReceipt');
    expect(receipt.state).toBe('published');
    expect(await checked(await post('director', `${candidatePath(candidate.key)}/publish`, body), 'IntakeReceipt')).toEqual(receipt);
    await denial(await request('director', `/v1/intake/operations/${body.operationId}?action=publish`, {}, LEGACY_CONTRACT_SET), 409, 'IDEMPOTENCY_CONFLICT');
    return receipt;
  }
  async function snapshot() {
    const entitlement = await checked(await post('agent', '/v1/intake/entitlements', { shopId: 'shop-a', productIds: ['product-graph', 'product-solo'],
      scenarioIds: ['scenario-graph', 'scenario-solo'], contextGeneration: sequence + 1, releaseId: null }), 'IntakeEntitlement');
    const pages: C['IntakeSnapshot'][] = [];
    let cursor: string | null = null;
    do {
      const page: C['IntakeSnapshot'] = await checked(await request('agent', `/v1/intake/snapshot?entitlementId=${entitlement.entitlementId}&limit=2${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeSnapshot');
      expect(page.pageIndex).toBe(pages.length);
      if (pages[0]) { expect(page.snapshotDigest).toBe(pages[0].snapshotDigest); expect(page.totals).toEqual(pages[0].totals); }
      pages.push(page); cursor = page.nextCursor;
    } while (cursor);
    const collections = { faq: pages.flatMap(p => p.faq), vocabulary: pages.flatMap(p => p.vocabulary), sopFlows: pages.flatMap(p => p.sopFlows),
      sopNodes: pages.flatMap(p => p.sopNodes), sopEdges: pages.flatMap(p => p.sopEdges), media: pages.flatMap(p => p.media) };
    expect(pages.length).toBe(pages[0]!.pageCount);
    for (const name of Object.keys(collections) as (keyof typeof collections)[]) expect(collections[name].length).toBe(pages[0]!.totals[name]);
    expect(digest(canonical({ releaseId: entitlement.releaseId, entitlementId: entitlement.entitlementId, contextGeneration: entitlement.contextGeneration, ...collections }))).toBe(pages[0]!.snapshotDigest);
    return { entitlement, pages, ...collections };
  }

  it('publishes independent and complete graphs, verifies objects and restores R1 lineage through R3', async () => {
    const policy = await checked(await request('enabler', '/v1/intake/policy'), 'IntakePolicy');
    expect(policy.inputFormats).toHaveLength(3);
    const solo = await receive('source-solo', await syntheticTaskGraphWorkbook({ solo: true }), 'rel_native_base');
    const soloMaterial = await material(solo.candidate.key);
    expect(soloMaterial.result.entries).toEqual([]); expect(soloMaterial.result.sopFlows?.[0]?.header.anchorEntry).toBeNull();
    const soloConfirmed = await confirm(solo);
    await denial(await post('director', `${candidatePath(solo.candidate.key)}/publish`, { operationId: operation('premature'), key: solo.candidate.key,
      baseReleaseId: 'rel_native_base', sourceEvidenceVersion: soloConfirmed.sourceEvidenceVersion, title: '合成', summary: '合成', confirmed: true }), 409, 'MATERIAL_CHANGED');
    const soloChecks = await quality(solo.candidate.key);
    expect(soloChecks.faq).toEqual([]); expect(soloChecks.sop).toHaveLength(1);
    const soloRelease = (await publish(soloConfirmed, 'rel_native_base')).releaseId!;
    const soloSnapshot = await snapshot();
    expect(soloSnapshot.faq).toEqual([]); expect(soloSnapshot.sopFlows).toHaveLength(1); expect(soloSnapshot.vocabulary).toHaveLength(2);

    arm = 'freeze';
    const first = await receive('source-a', await syntheticTaskGraphWorkbook(), soloRelease);
    const resumed = await checked(await post('enabler', '/v1/intake/sources/source-a/candidates', first.receiveBody), 'IntakeParseJob');
    expect(resumed.jobId).toBe(first.job.jobId);
    expect((await checked(await request('enabler', `/v1/intake/parse-jobs/${resumed.jobId}`), 'IntakeParseJob')).candidateId).toBe(first.candidate.key.candidateId);
    expect((await admin.query('SELECT count(*)::int AS n FROM content_intake.sop_graph_versions WHERE candidate_id=$1', [first.candidate.key.candidateId])).rows[0].n).toBe(1);
    const firstMaterial = await material(first.candidate.key);
    await denial(await request('reviewer', `${candidatePath(first.candidate.key)}/material?limit=1&cursor=${firstMaterial.pages[0]!.nextCursor}`, {}, LEGACY_CONTRACT_SET), 409, 'UPGRADE_REQUIRED');
    await denial(await post('enabler', `${candidatePath(first.candidate.key)}/source-confirmation`, { operationId: operation('digest-is-not-source'), key: first.candidate.key,
      expectedEvidenceVersion: 0, confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-explicit-source', acquisition: 'controlled-synthetic-export',
      objectSha256: first.candidate.key.digest, reason: '合成错误来源摘要负例' }), 409, 'SOURCE_MISMATCH');
    const flow = firstMaterial.result.sopFlows![0]!;
    expect(flow.nodes.find(node => node.id === 'task-a')?.body.requirements.map(item => item.ordinal)).toEqual([1, 2]);
    expect(flow.nodes.find(node => node.id === 'task-a')?.body.scripts).toHaveLength(2);
    expect(flow.nodes.find(node => node.id === 'task-b')?.body.scripts).toHaveLength(1);
    expect(flow.edges.filter(edge => edge.action.kind === 'choice' && edge.action.unableToDetermine)).toHaveLength(1);
    expect(firstMaterial.result.media).toHaveLength(3);
    const imageOwners = new Set<string>();
    for (const image of firstMaterial.result.media) {
      const binding = image.entry ? { ownerKind: 'entry', ownerId: image.entry.businessEntryId, scriptVersion: image.entry.scriptVersion }
        : { ownerKind: image.graphTarget!.kind, ownerId: image.graphTarget!.id };
      imageOwners.add(binding.ownerKind);
      const query = new URLSearchParams({ digest: first.candidate.key.digest, sourceId: image.flowKey.sourceId, flowId: image.flowKey.flowId,
        flowVersion: String(image.flowKey.flowVersion), ownerKind: binding.ownerKind, ownerId: binding.ownerId, resourceId: image.resourceId,
        ...('scriptVersion' in binding ? { scriptVersion: String(binding.scriptVersion) } : {}) });
      const preview = await checked(await request('reviewer', `${candidatePath(first.candidate.key)}/sop/media/${image.objectId}?${query}`), 'IntakeSopCandidateMediaPayload');
      expect(Buffer.from(preview.base64, 'base64')).toEqual(graphImageFixtures.get(image.resourceId)!.bytes);
      expect(createHash('sha256').update(Buffer.from(preview.base64, 'base64')).digest('hex')).toBe(image.sha256);
    }
    expect([...imageOwners].sort()).toEqual(['entry', 'knowledge', 'task']);
    const confirmed = await confirm(first);
    const firstQuality = await quality(first.candidate.key, true);
    const report = await request('enabler', `/v1/intake/parse-jobs/${first.job.jobId}/report`);
    expect(report.status).toBe(200);
    const qualityRows = await readSyntheticQualityReport(Buffer.from(await report.arrayBuffer()));
    expect(qualityRows.filter(row => row[0] === 'sopTarget').map(row => parse('IntakeSopSopQualityTarget', JSON.parse(row[2]!))))
      .toEqual(firstQuality.sop.map(item => item.target));
    expect(qualityRows.filter(row => row[0] === 'sopCheck')).toHaveLength(firstQuality.sop.length);
    expect(JSON.parse(qualityRows.find(row => row[0] === 'sopPlan')![2]!)).toEqual(firstQuality.after.plan.sopPlan);
    const r1 = (await publish(confirmed, soloRelease, true)).releaseId!;
    const s1 = await snapshot();
    for (const view of ['absent', LEGACY_CONTRACT_SET]) {
      const issued = await post('agent', '/v1/intake/entitlements', { shopId: 'shop-a', productIds: ['product-graph'],
        scenarioIds: ['scenario-graph'], contextGeneration: 700, releaseId: null }, view);
      expect(issued.status).toBe(200);
      const legacyEntitlement = parseLegacy('IntakeEntitlement', await issued.json());
      const faq: string[] = [];
      let cursor: string | null = null;
      do {
        const response = await request('agent', `/v1/intake/snapshot?entitlementId=${legacyEntitlement.entitlementId}&limit=1${cursor ? `&cursor=${cursor}` : ''}`, {}, view);
        expect(response.status).toBe(200);
        const page: LegacyComponents['schemas']['IntakeSnapshot'] = parseLegacy('IntakeSnapshot', await response.json());
        expect(page).not.toHaveProperty('snapshotDigest');
        expect(page.sopNodes).toEqual([]); expect(page.sopEdges).toEqual([]); expect(page.media).toEqual([]);
        faq.push(...page.faq.map(item => item.entry.businessEntryId)); cursor = page.nextCursor;
      } while (cursor);
      expect(faq).toEqual(['script-a', 'script-b']);
    }
    await denial(await request('agent', `/v1/intake/snapshot?entitlementId=${s1.entitlement.entitlementId}&limit=2&cursor=${s1.pages[0]!.nextCursor}`, {}, LEGACY_CONTRACT_SET), 409, 'UPGRADE_REQUIRED');
    expect(s1.entitlement.releaseId).toBe(r1); expect(s1.sopFlows).toHaveLength(2); expect(s1.media).toHaveLength(3); expect(s1.faq).toHaveLength(2);
    const second = await receive('source-a', await syntheticTaskGraphWorkbook({ revision: 2 }), r1);
    expect((await material(second.candidate.key)).result.sopFlows?.[0]?.header.key.flowVersion).toBe(2);
    const secondConfirmed = await confirm(second); await quality(second.candidate.key);
    const r2 = (await publish(secondConfirmed, r1)).releaseId!;
    const s2 = await snapshot();
    expect(s2.sopFlows.find(item => item.header.key.flowId === 'flow-main')?.graphDigest).not.toBe(s1.sopFlows.find(item => item.header.key.flowId === 'flow-main')?.graphDigest);
    const impact = await checked(await post('director', '/v1/intake/rollback/preview', { baseReleaseId: r2, targetReleaseId: r1 }), 'IntakeRollbackImpact');
    expect(impact.scopes.map(scope => scope.sourceId)).toContain('source-a');
    const rollbackBody = { operationId: operation('rollback'), baseReleaseId: r2, targetReleaseId: r1,
      impactDigest: impact.impactDigest, rollbackPlanId: impact.rollbackPlanId, confirmed: true };
    arm = 'rollback';
    await denial(await post('director', '/v1/intake/rollback', rollbackBody), 503, 'COMMIT_UNKNOWN');
    const rollback = await checked(await request('director', `/v1/intake/operations/${rollbackBody.operationId}?action=rollback`), 'IntakeRollbackReceipt');
    expect(await checked(await post('director', '/v1/intake/rollback', rollbackBody), 'IntakeRollbackReceipt')).toEqual(rollback);
    const s3 = await snapshot();
    expect(s3.entitlement.releaseId).toBe(rollback.releaseId); expect(rollback.releaseId).not.toBe(r1); expect(rollback.releaseId).not.toBe(r2);
    expect(s3.sopFlows).toEqual(s1.sopFlows); expect(s3.sopNodes).toEqual(s1.sopNodes); expect(s3.sopEdges).toEqual(s1.sopEdges); expect(s3.media).toEqual(s1.media); expect(s3.faq).toEqual(s1.faq);
    const lineage = await admin.query(`SELECT release_id,source_id,flow_id,candidate_id,candidate_version,publication_policy,review_request_id FROM content_intake.sop_graph_release_lineage
      WHERE release_id=ANY($1::text[]) ORDER BY release_id,source_id,flow_id`, [[r1, r2, rollback.releaseId]]);
    expect(lineage.rows.filter(row => row.release_id === rollback.releaseId).map(({ release_id: _release, ...row }) => row))
      .toEqual(lineage.rows.filter(row => row.release_id === r1).map(({ release_id: _release, ...row }) => row));
    expect((await admin.query(`SELECT count(*)::int AS count FROM content_intake.sop_graph_release_lineage l LEFT JOIN content_intake.publications p
      ON p.candidate_id=l.candidate_id AND p.candidate_version=l.candidate_version WHERE p.candidate_id IS NULL`)).rows[0].count).toBe(0);
    writeFileSync(path.join(evidenceRoot, 'normal-http-results.json'), JSON.stringify({ source: SOP_CONTRACT_SET, r1, r2, r3: rollback.releaseId,
      lineage: lineage.rows, graphDigests: s3.sopFlows.map(item => item.graphDigest), targets: (await admin.query('SELECT * FROM content_intake.sop_graph_quality_targets')).rows,
      checks: (await admin.query('SELECT * FROM content_intake.sop_graph_quality_checks')).rows }, null, 2));
    const config = (await admin.query<{ host: string; port: number; user: string; database: string }>(`SELECT current_database() AS database,current_user AS user,
      current_setting('unix_socket_directories') AS host,current_setting('port')::int AS port`)).rows[0]!;
    backupInput = path.join(host.root, 'nonempty-backup-input.json');
    expect(agentAuthorization).toMatch(/^Bearer /);
    writeFileSync(backupInput, JSON.stringify({ root: host.root, host: config.host, port: config.port, user: config.user, database: config.database, agentAuthorization,
      evidenceRoot, entitlementHash: digest(s3.entitlement.entitlementId), graphDigests: s3.sopFlows.map(item => item.graphDigest),
      imageSha256: [...graphImageFixtures.values()].map(item => digest(item.bytes)), releaseId: rollback.releaseId }), { mode: 0o600 });
  }, 120_000);

  it('consumes a nonempty normal HTTP graph backup after dump and restore', () => {
    expect(backupInput).toBeTruthy();
    const result = spawnSync(process.execPath, ['tests/support/sop-graph-backup.mjs', backupInput], {
      cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    writeFileSync(path.join(evidenceRoot, 'nonempty-backup.log'), output);
    if (result.error) throw result.error;
    expect(result.status, output).toBe(0);
    expect(result.stdout).toContain('NONEMPTY_GRAPH_RESTORE_PASS');
  }, 240_000);

  it('negotiates only after resource authorization and rejects wrong views without protected output', async () => {
    for (const view of ['absent', LEGACY_CONTRACT_SET, '', 'unsupported-contract']) {
      await denial(await request('enabler', '/v1/intake/sources/not-existing/management-context', {}, view), 404, 'SCOPE_DENIED');
      await denial(await request('enabler', '/v1/intake/sources/source-solo/management-context', {}, view), 409, 'UPGRADE_REQUIRED');
      await denial(await request('agent', '/v1/intake/sources/source-solo/management-context', {}, view), 404, 'SCOPE_DENIED');
    }
    for (const actor of ['enabler', 'agent'] as const) {
      await denial(await host.requestAs(actor, '/v1/intake/sources/source-solo/management-context', {}, [SOP_CONTRACT_SET, SOP_CONTRACT_SET]),
        actor === 'enabler' ? 409 : 404, actor === 'enabler' ? 'UPGRADE_REQUIRED' : 'SCOPE_DENIED');
      await denial(await host.requestAs(actor, '/v1/intake/sources/not-existing/management-context', {}, [SOP_CONTRACT_SET, SOP_CONTRACT_SET]), 404, 'SCOPE_DENIED');
    }
    for (const view of ['absent', LEGACY_CONTRACT_SET]) {
      const response = await request('agent', '/v1/intake/sources?limit=50', {}, view);
      expect(response.status).toBe(200); expect(await response.json()).not.toHaveProperty('sopFlows');
    }
  });

  it('rejects unmapped maintenance and graph records through normal parser jobs without partial candidates', async () => {
    const base = (await snapshot()).entitlement.releaseId;
    const count = (await admin.query('SELECT count(*)::int AS n FROM content_intake.candidate_versions')).rows[0].n;
    for (const options of [{ missingUnknown: true }, { unresolvedConfirmation: true }, { wrongHeader: true }]) {
      const result = await receiveJob('source-a', await syntheticTaskGraphWorkbook(options), base);
      expect(result.job.state).toBe('failed'); expect(result.job.candidateId).toBeNull(); expect(result.job.totalIssues).toBeGreaterThan(0);
      if ('wrongHeader' in options) expect(result.job.issues[0]?.location).toEqual({ sheet: '执行任务', row: 1, column: 1 });
    }
    const unmapped = await receiveJob('source-unmapped', await syntheticTaskGraphWorkbook({ solo: true }), base);
    expect(unmapped.job.state).toBe('failed'); expect(unmapped.job.candidateId).toBeNull();
    expect(unmapped.job.issues[0]?.code).toBe('SOP_MAPPING_REQUIRED');
    expect((await admin.query('SELECT count(*)::int AS n FROM content_intake.candidate_versions')).rows[0].n).toBe(count);
    expect((await snapshot()).entitlement.releaseId).toBe(base);
  });

  it('preserves standalone disable history and re-enables with a new flow version', async () => {
    const base = (await snapshot()).entitlement.releaseId;
    const disabled = await receive('source-solo', await syntheticTaskGraphWorkbook({ solo: true, disable: true }), base);
    const disabledMaterial = (await material(disabled.candidate.key)).result;
    expect(disabledMaterial.sopDifferences?.[0]?.change).toBe('disable');
    expect(disabledMaterial.sopFlows?.[0]?.header.key.flowVersion).toBe(2);
    const confirmed = await confirm(disabled); await quality(confirmed.key);
    const disabledRelease = (await publish(confirmed, base)).releaseId!;
    expect((await snapshot()).sopFlows.map(item => item.header.key.flowId)).toEqual(['flow-main']);
    const reenabled = await receive('source-solo', await syntheticTaskGraphWorkbook({ solo: true, revision: 5 }), disabledRelease);
    const enabledMaterial = (await material(reenabled.candidate.key)).result;
    expect(enabledMaterial.sopDifferences?.[0]?.change).toBe('reenable');
    expect(enabledMaterial.sopFlows?.[0]?.header.key.flowVersion).toBe(3);
    const enabled = await confirm(reenabled); await quality(enabled.key); await publish(enabled, disabledRelease);
    expect((await snapshot()).sopFlows).toHaveLength(2);
    expect((await admin.query('SELECT target_id FROM content_intake.sop_graph_disable_events WHERE release_id=$1', [disabledRelease])).rows)
      .toEqual([{ target_id: 'flow-solo' }]);
  });

  it('revises by exact prior key and rolls back graph projection failures before a safe normal retry', async () => {
    const base = (await snapshot()).entitlement.releaseId;
    const initial = await receive('source-a', await syntheticTaskGraphWorkbook({ revision: 3, longTaskId: true }), base);
    const fullLength = (await material(initial.candidate.key)).result.sopFlows![0]!;
    expect(fullLength.nodes.some(node => node.id.length === 128)).toBe(true);
    expect(fullLength.edges.every(edge => edge.id.length <= 128)).toBe(true);
    const revision = await receive('source-a', await syntheticTaskGraphWorkbook({ revision: 4 }), base, initial.candidate.key);
    expect(revision.candidate.key.candidateId).toBe(initial.candidate.key.candidateId);
    expect(revision.candidate.key.version).toBe(initial.candidate.key.version + 1);
    expect((await checked(await request('enabler', candidatePath(initial.candidate.key)), 'IntakeCandidate')).state).toBe('invalidated');
    const confirmed = await confirm(revision); await quality(confirmed.key);
    const body = { operationId: operation('atomic-retry'), key: confirmed.key, baseReleaseId: base,
      sourceEvidenceVersion: confirmed.sourceEvidenceVersion, title: '合成原子失败重试', summary: '合成完整图', confirmed: true };
    const state = async () => (await admin.query(`SELECT (SELECT current_release_id FROM public.content_current WHERE id=1) AS current,
      (SELECT count(*)::int FROM public.content_releases) AS releases,(SELECT count(*)::int FROM public.announcements) AS announcements,
      (SELECT count(*)::int FROM content_intake.publications) AS publications,(SELECT count(*)::int FROM content_intake.sop_graph_release_lineage) AS lineage,
      (SELECT count(*)::int FROM content_intake.sop_graph_release_media) AS media,(SELECT count(*)::int FROM backend_review.receipts) AS receipts`)).rows[0];
    const before = await state();
    const payload = (await admin.query(`SELECT m.payload_object_id FROM content_intake.sop_graph_media_bindings b
      JOIN content_intake.sop_media_objects m ON m.media_object_id=b.object_id WHERE b.candidate_id=$1 AND b.candidate_version=$2 LIMIT 1`,
    [confirmed.key.candidateId, confirmed.key.version])).rows[0].payload_object_id;
    const file = path.join(host.root, 'objects', 'objects', payload), bytes = readFileSync(file);
    try {
      writeFileSync(file, Buffer.from('synthetic-corrupt-image'));
      await denial(await post('director', `${candidatePath(confirmed.key)}/publish`, body), 503, 'SOP_MEDIA_UNAVAILABLE');
    } finally { writeFileSync(file, bytes); }
    expect(await state()).toEqual(before);
    await admin.query(`CREATE FUNCTION content_intake.synthetic_graph_projection_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'SYNTHETIC_GRAPH_PROJECTION_FAILURE'; END $$;
      CREATE TRIGGER synthetic_graph_failure AFTER INSERT ON content_intake.sop_graph_release_media
        FOR EACH ROW EXECUTE FUNCTION content_intake.synthetic_graph_projection_failure()`);
    try {
      await denial(await post('director', `${candidatePath(confirmed.key)}/publish`, body), 500, 'COMMIT_UNKNOWN');
      expect(await state()).toEqual(before);
      await denial(await request('director', `/v1/intake/operations/${body.operationId}?action=publish`), 404, 'COMMIT_UNKNOWN');
    } finally {
      await admin.query('DROP TRIGGER synthetic_graph_failure ON content_intake.sop_graph_release_media; DROP FUNCTION content_intake.synthetic_graph_projection_failure()');
    }
    const published = await checked(await post('director', `${candidatePath(confirmed.key)}/publish`, body), 'IntakeReceipt');
    expect((await snapshot()).entitlement.releaseId).toBe(published.releaseId);
    expect((await state()).publications).toBe(before.publications + 1);
  });
});
