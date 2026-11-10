import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseContractSchema as parseAuth } from '@customer-agent/contracts';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseContractSchema as parse, type components, type ContractSchemaName, CONTRACT_PROVENANCE } from '@customer-agent/contracts/sop-resource-disable';
import { SOP_RESOURCE_FORMAT, SOP_TASK_FORMAT, SOP_TASK_STRUCTURE_SHA256 } from '@customer-agent/content-intake';
import { syntheticGraphMapping, syntheticTaskGraphWorkbook, syntheticResourceDisableWorkbook, readSyntheticQualityReport } from '../../../packages/content-intake/tests/support/sop-task-graph-workbook.js';
import { createIntakeSyntheticHost, type IntakeSyntheticHost, type DesktopSyntheticIdentity } from './support/intake-synthetic-host.js';
import { LEGACY_CONTRACT_SET, SOP_CONTRACT_SET, parseContractSchema, withIntakeView } from '../src/content-intake/contract-view.js';
import { canonical, digest } from '../src/content-intake/material.js';
import { graphFor } from '../src/content-intake/sop-graph.js';
import type { IntakePool } from '../src/content-intake/transaction.js';

type C = components['schemas'];
const enabled = process.env.CUSTOMER_AGENT_API_SOP_RESOURCE_PG15_INTEGRATION === '1';
const evidenceRoot = path.join(os.tmpdir(), `sop-resource-lifecycle-${randomUUID()}`);
const contract = CONTRACT_PROVENANCE.contract_set_id;
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
describe.skipIf(!enabled).sequential('normal 88 resource lifecycle with full selection and exact ready proof', () => {
  let host: Pick<IntakeSyntheticHost, 'requestAs' | 'writeSopQueryFacts' | 'close' | 'root' | 'apiOrigin' | 'identityOrigin' | 'selectIdentity'>, admin: Client;
  let sequence = 0;
  let arm: 'publish' | 'rollback' | 'open' | 'query' | null = null;
  const diagnostics: string[] = [];
  let agentAuthorization: string | null = null;
  let replacementAuthorization: string | null = null;
  let restorable: Awaited<ReturnType<typeof query>>;
  const op = (label: string) => `resource-${label}-${++sequence}`;
  const base = (key: C['IntakeCandidateKey']) => `/v1/intake/candidates/${key.candidateId}/versions/${key.version}`;
  const request = (actor: DesktopSyntheticIdentity, url: string, init: RequestInit = {}, view: string = contract) => {
    const headers = new Headers(init.headers); headers.set('x-intake-contract-set', view);
    if (actor === 'agent' && replacementAuthorization) {
      headers.set('authorization', replacementAuthorization); agentAuthorization = replacementAuthorization;
      return fetch(`${host.apiOrigin}${url}`, { ...init, headers });
    }
    return host.requestAs(actor, url, { ...init, headers });
  };
  const post = (actor: DesktopSyntheticIdentity, url: string, body: unknown, view: string = contract) =>
    request(actor, url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, view);
  async function checked<Name extends ContractSchemaName>(response: Response, name: Name): Promise<C[Name]> {
    const body: unknown = await response.json();
    expect(response.ok, `${response.status} ${JSON.stringify(body)}\n${diagnostics.slice(-4).join('\n')}`).toBe(true);
    expect(response.headers.get('cache-control')).toContain('no-store');
    return parse(name, body);
  }
  async function denied(response: Response, status: number, reason?: string) {
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(status);
    if (reason) expect(parse('IntakeError', body).error.details.reason).toBe(reason);
    expect(JSON.stringify(body)).not.toMatch(/base64|answerText|graphDigest|payloadObjectId/);
  }
  function uncertain(pool: IntakePool): IntakePool {
    return { connect: async () => {
      const client = await pool.connect(); let lost = false;
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (arm === 'query' && sql.startsWith('SELECT content_intake.complete_sop_unified_query')) lost = true;
          if (arm === 'open' && sql.startsWith('SELECT content_intake.open_sop_active_use')) lost = true;
          if (arm && sql.startsWith('INSERT INTO backend_review.receipts') && values?.[1] === `intake:${arm}`) lost = true;
          if (sql === 'COMMIT' && lost) { arm = null; throw new Error('SYNTHETIC_RESPONSE_LOST_AFTER_REAL_COMMIT'); }
          return result;
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
  }
  beforeAll(async () => {
    mkdirSync(evidenceRoot, { mode: 0o700 });
    console.info(JSON.stringify({ probe: 'sop-resource-lifecycle', path: evidenceRoot }));
    host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime', includeSopQuery: true,
      includeSopContinuation: true, includeLegacySearch: true, wrapBusinessPool: uncertain, wrapUsagePool: uncertain,
      observeSyntheticRequest: (actor, headers) => { if (actor === 'agent') agentAuthorization = headers.get('authorization'); },
      observeError: error => diagnostics.push(error instanceof Error ? `${error.stack}\n${JSON.stringify(error, ['code','detail','where','issues','instancePath','schemaPath','keyword','message'])}` : String(error)),
      configureDatabase: async client => {
        admin = client;
        await admin.query('BEGIN');
        await admin.query(`INSERT INTO content_intake.scopes SELECT (jsonb_populate_record(NULL::content_intake.scopes,
          to_jsonb(scope)||jsonb_build_object('scope_id','scope-resource','domain','sop'))).* FROM content_intake.scopes scope WHERE scope_id='scope-a'`);
        await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES('source-resource','scope-resource',2,'v2-preview')");
        await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
          VALUES('source-resource',2,$1,$2,$3,$4,$5::jsonb)`, [SOP_RESOURCE_FORMAT.templateVersion, SOP_RESOURCE_FORMAT.ruleVersion,
          SOP_RESOURCE_FORMAT.mappingVersion, SOP_TASK_STRUCTURE_SHA256, JSON.stringify(syntheticGraphMapping())]);
        await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
          to_jsonb(g)||jsonb_build_object('grant_id',grant_id||'-resource','scope_id','scope-resource',
            'source_id',CASE WHEN source_id IS NULL THEN NULL ELSE 'source-resource' END,
            'parent_grant_id',CASE WHEN parent_grant_id IS NULL THEN NULL ELSE parent_grant_id||'-resource' END))).*
          FROM content_intake.grants g WHERE scope_id='scope-a'
          ORDER BY CASE kind WHEN 'allocation' THEN 0 WHEN 'delegation' THEN 1 ELSE 2 END`);
        await admin.query(`INSERT INTO content_intake.store_set_members(tenant_id,app_id,version,scope_id,source_id,content_valid_until)
          SELECT tenant_id,app_id,version,'scope-resource','source-resource',content_valid_until
          FROM content_intake.store_set_members WHERE source_id='source-a'`);
        for (const [id, kind] of [['product-graph', 'product'], ['product-extra', 'product'], ['scenario-graph', 'scenario']]) {
          await admin.query('INSERT INTO content_intake.vocabulary VALUES($1,$2,$3,$4,true)', [id, 'scope-resource', kind, digest(id!)]);
          await admin.query('INSERT INTO content_intake.vocabulary_displays VALUES($1,1,$2)', [id, `合成词项 ${id}`]);
        }
        for (const [sourceId, mapping, format] of [['source-solo', syntheticGraphMapping(true, true), SOP_RESOURCE_FORMAT],
          ['source-quality', syntheticGraphMapping(false, false, false, 501), SOP_RESOURCE_FORMAT],
          ['source-v11-discovery', syntheticGraphMapping(), SOP_TASK_FORMAT]] as const) {
          await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES($1,'scope-resource',2,'v2-preview')", [sourceId]);
          await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
            VALUES($1,2,$2,$3,$4,$5,$6::jsonb)`, [sourceId, format.templateVersion, format.ruleVersion,
            format.mappingVersion, SOP_TASK_STRUCTURE_SHA256, JSON.stringify(mapping)]);
          await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
            to_jsonb(g)||jsonb_build_object('grant_id',grant_id||'-'||$1::text,'source_id',$1::text))).*
            FROM content_intake.grants g WHERE source_id='source-resource'`, [sourceId]);
          await admin.query(`INSERT INTO content_intake.store_set_members(tenant_id,app_id,version,scope_id,source_id,content_valid_until)
            SELECT tenant_id,app_id,version,scope_id,$1,content_valid_until FROM content_intake.store_set_members WHERE source_id='source-resource'`, [sourceId]);
        }
        await admin.query('COMMIT');
      } });
    for (const table of ['sop_graph_versions','sop_resource_disables','sop_resource_disable_quality_targets','sop_resource_disable_publications']) {
      expect((await admin.query(`SELECT count(*)::int AS n FROM content_intake.${table}`)).rows[0].n).toBe(0);
    }
  }, 120_000);
  afterAll(async () => {
    writeFileSync(path.join(evidenceRoot, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    await host?.close();
  });
  async function receive(bytes: Buffer, releaseId: string, sourceId = 'source-resource') {
    const form = new FormData(); form.set('operationId', op('upload'));
    form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), 'synthetic-resource.xlsx');
    const object = await checked(await request('enabler', `/v1/intake/sources/${sourceId}/objects`, { method: 'POST', body: form }), 'IntakeObject');
    let job = await checked(await post('enabler', `/v1/intake/sources/${sourceId}/candidates`, {
      operationId: op('receive'), objectId: object.objectId, sourceVersion: 2, baseReleaseId: releaseId, expectedPriorKey: null,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true },
    }), 'IntakeParseJob');
    const deadline = Date.now() + 25_000;
    while (job.state === 'reading' || job.state === 'parsing') {
      if (Date.now() > deadline) throw new Error(`Parser did not settle ${JSON.stringify(job)}`);
      await new Promise(resolve => setTimeout(resolve, 20));
      job = await checked(await request('enabler', `/v1/intake/parse-jobs/${job.jobId}`), 'IntakeParseJob');
    }
    expect(job.state, `${JSON.stringify(job)}\n${diagnostics.slice(-4)}`).toBe('validated');
    const candidate = await checked(await request('enabler', `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`), 'IntakeCandidate');
    const pages: C['IntakeCandidatePage'][] = []; const pageLimit = sourceId === 'source-quality' ? 100 : 1; let cursor: string | null = null;
    do {
      const page: C['IntakeCandidatePage'] = await checked(await request('enabler', `${base(candidate.key)}/material?limit=${pageLimit}${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeCandidatePage');
      expect(page.entries.length + page.differences.length + page.sopFlows!.length + page.sopDifferences!.length + page.resourceDisables.length).toBeLessThanOrEqual(pageLimit);
      pages.push(page); cursor = page.nextCursor;
    } while (cursor);
    const material = withIntakeView('resource-disable', () => parseContractSchema('IntakeMaterial', { ...pages[0]!.materialHeader,
      entries: pages.flatMap(page => page.entries), differences: pages.flatMap(page => page.differences),
      sopFlows: pages.flatMap(page => page.sopFlows ?? []), sopDifferences: pages.flatMap(page => page.sopDifferences ?? []),
      resourceDisables: pages.flatMap(page => page.resourceDisables) }));
    if (material.canonicalEncodingVersion !== 'candidate-sop-resource-disable-v1') throw new Error('Expected v12 material');
    expect(digest(canonical(material))).toBe(candidate.key.digest);
    expect((await admin.query('SELECT contract_view FROM content_intake.parse_jobs WHERE job_id=$1', [job.jobId])).rows[0].contract_view).toBe('resource-disable');
    writeFileSync(path.join(evidenceRoot, `${candidate.key.candidateId}.json`), JSON.stringify(material, null, 2));
    return { key: candidate.key, object, job, material, pages };
  }
  async function confirm(item: Awaited<ReturnType<typeof receive>>) {
    const body = { operationId: op('confirm'), key: item.key, expectedEvidenceVersion: 0,
      confirmedVersionKind: 'opaque', confirmedVersionValue: 'synthetic-resource-v1', acquisition: 'controlled-synthetic-export',
      objectSha256: item.object.sha256, reason: '逐项核对合成来源及资源历史', resourceDisableSetDigest: item.material.resourceDisableSetDigest };
    await denied(await post('enabler', `${base(item.key)}/source-confirmation`, { ...body, resourceDisableSetDigest: '0'.repeat(64) }), 409);
    return checked(await post('enabler', `${base(item.key)}/source-confirmation`, body), 'IntakeCandidate');
  }
  async function quality(item: Awaited<ReturnType<typeof receive>>) {
    await checked(await post('reviewer', `${base(item.key)}/quality/freeze`, { operationId: op('quality-freeze'), key: item.key }), 'IntakeQualityReceipt');
    const state = await checked(await request('reviewer', `${base(item.key)}/quality?digest=${item.key.digest}`), 'IntakeQualityStatus');
    const samples: C['IntakeQualitySamplePage'][] = []; const pageLimit = item.material.entries.length > 100 ? 100 : 1; let cursor: string | null = null;
    do {
      const page: C['IntakeQualitySamplePage'] = await checked(await request('reviewer', `${base(item.key)}/quality/samples?digest=${item.key.digest}&viewHash=${state.viewHash}&phase=initial&limit=${pageLimit}${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeQualitySamplePage');
      samples.push(page); cursor = page.nextCursor;
    } while (cursor);
    const body = { operationId: op('quality-check'), key: item.key, materialDigest: item.key.digest, phase: 'initial',
      checks: samples.flatMap(page => page.items).map(sample => ({ scriptId: sample.scriptId, contentHash: sample.contentHash, defect: false, reason: '' })),
      sopChecks: samples.flatMap(page => page.sopItems ?? []).map(sample => ({ ...sample.target, defect: false, reason: '' })),
      resourceDisableChecks: samples.flatMap(page => page.resourceDisableItems).map(sample => ({ target: sample.target, defect: false, reason: '' })) };
    if (!body.checks.length && body.sopChecks.length) {
      await denied(await post('reviewer', `${base(item.key)}/quality/checks`, { ...body, sopChecks: [] }), 422);
    }
    if (item.material.resourceDisableCount) {
      expect(samples.flatMap(page => page.resourceDisableItems)).toHaveLength(item.material.resourceDisableCount);
      await denied(await post('reviewer', `${base(item.key)}/quality/checks`, { ...body, resourceDisableChecks: [] }), 422);
    }
    const receipt = await checked(await post('reviewer', `${base(item.key)}/quality/checks`, body), 'IntakeQualityReceipt');
    expect(receipt.state).toBe('passed');
    const report = await request('enabler', `/v1/intake/parse-jobs/${item.job.jobId}/report`);
    expect(report.ok).toBe(true);
    const rows = await readSyntheticQualityReport(Buffer.from(await report.arrayBuffer()));
    expect(rows.filter(row => row[0] === 'resourceDisableTarget')).toHaveLength(item.material.resourceDisableCount);
    return { receipt, samples, state };
  }
  async function publish(item: Awaited<ReturnType<typeof receive>>, loseCommit = false) {
    const confirmed = await confirm(item); await quality(item);
    const body = { operationId: op('publish'), key: item.key, baseReleaseId: item.material.baseReleaseId,
      sourceEvidenceVersion: confirmed.sourceEvidenceVersion, title: '合成资源生命周期', summary: 'v12正常完整写链', confirmed: true };
    if (loseCommit) { arm = 'publish'; await denied(await post('director', `${base(item.key)}/publish`, body), 503, 'COMMIT_UNKNOWN'); }
    const receipt = await checked(await post('director', `${base(item.key)}/publish`, body), 'IntakeReceipt');
    expect(receipt.resourceDisableLineage).toEqual({ materialDigest: item.key.digest,
      resourceDisableCount: item.material.resourceDisableCount, resourceDisableSetDigest: item.material.resourceDisableSetDigest });
    expect(await checked(await post('director', `${base(item.key)}/publish`, body), 'IntakeReceipt')).toEqual(receipt);
    if (!receipt.releaseId) throw new Error('Published release missing');
    return { ...item, releaseId: receipt.releaseId, receipt };
  }
  async function registerFacts(item: Awaited<ReturnType<typeof receive>>, version = 0, group = '税收相关规则') {
    const flow = item.material.sopFlows[0]; if (!flow) throw new Error('Graph missing');
    const graph = graphFor(item.material, flow), ref = `synthetic:resource-${item.key.candidateId}`;
    const document = { candidateId: item.key.candidateId, candidateVersion: item.key.version,
      sourceId: flow.header.key.sourceId, flowId: flow.header.key.flowId, graphDigest: digest(canonical(graph)), sopGroup: group,
      permissions: graph.entries.map(entry => ({ entry: { sourceId: entry.sourceId, businessEntryId: entry.entry.businessEntryId, scriptVersion: entry.entry.scriptVersion },
        risk_level: 'low', copy_allowed: true, source_ref: `${ref}@${version + 1}#${entry.entry.businessEntryId}` })) };
    expect(await host.writeSopQueryFacts('enabler', { operationId: op('facts'), expectedVersion: version,
      source: { ref, version: String(version + 1), bytes: Buffer.from(JSON.stringify(document)) } })).toEqual({ ok: true, value: version + 1 });
  }
  async function query(generation = 1, loseCommit = false, group = '税收相关规则', storewide = false) {
    const entitlement = await checked(await post('agent', '/v1/intake/entitlements', { shopId: 'shop-a', contextGeneration: generation,
      releaseId: null, productIds: storewide ? [] : ['product-extra', 'product-graph'], scenarioIds: storewide ? [] : ['scenario-graph'] }), 'IntakeEntitlement');
    const body = { sop_group: group, shop_id: 'shop-a', product_context: storewide ? null : { type: 'sku', ref: 'product-graph' },
      query_text: '合成入口', context_generation: `opaque-ctx-${randomUUID()}`, request_id: randomUUID(), entitlement_id: entitlement.entitlementId };
    if (loseCommit) { arm = 'query'; await denied(await post('agent', '/v1/sop/query', body), 503); }
    const ready = await checked(await post('agent', '/v1/sop/query', body), 'MenokinSopQuerySopQueryResponse');
    if (ready.status !== 'ready') throw new Error(`Expected ready ${JSON.stringify(ready)}`);
    const opening: C['IntakeSopActionCheck'] = { entitlementId: entitlement.entitlementId, contextGeneration: generation,
      releaseId: entitlement.releaseId, key: ready.result.flow.header.key, graphDigest: ready.result.graph_digest,
      nodeId: ready.result.flow.header.startNodeId, action: 'open', entry: null, edgeId: null,
      continuationId: `sct_${randomBytes(32).toString('hex')}`, queryRequestId: body.request_id };
    return { entitlement, body, ready, opening };
  }
  async function freshAgentSession() {
    host.selectIdentity('agent');
    const verifier = randomBytes(32).toString('base64url');
    const request = parseAuth('LoginCreated', await (await fetch(`${host.apiOrigin}/v1/auth/login-requests`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        client_challenge: createHash('sha256').update(verifier).digest('base64url'), challenge_method: 'S256' }) })).json());
    const redirected = await fetch(request.authorize_url, { redirect: 'manual' });
    const callback = redirected.headers.get('location');
    if (!callback?.startsWith(`${host.apiOrigin}/v1/auth/callback?`)) throw new Error('Synthetic callback missing');
    expect((await fetch(callback)).status).toBe(200);
    const session = parseAuth('LoginSession', await (await fetch(`${host.apiOrigin}/v1/auth/login-requests/${request.login_id}/exchange`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_verifier: verifier }) })).json());
    return `Bearer ${session.access_token}`;
  }
  async function grantQuery(seconds: number) {
    const facts = (await admin.query("SELECT principal_id,current_facts_version FROM content_intake.principals WHERE principal_id IN ('roster-director','agent')")).rows;
    const version = (id: string) => Number(facts.find(row => row.principal_id === id).current_facts_version);
    const policyVersion = Number((await admin.query("SELECT version FROM content_intake.policy_versions WHERE tenant_id='tenant-a' AND app_id='app-a'")).rows[0].version);
    return checked(await post('roster-director', '/v1/intake/grants', { operationId: op('replacement-query'),
      issuerFactsVersion: version('roster-director'), policyVersion, items: [{ kind: 'business', recipientPrincipalId: 'agent',
        recipientFactsVersion: version('agent'), action: 'query', scope: { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a',
          shopId: 'shop-a', domain: 'sop', sourceId: 'source-resource' }, startsAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), reason: '合成原资格到期和授权换链' }] }), 'IntakeGrantList');
  }
  const open = async (input: Awaited<ReturnType<typeof query>>) => checked(await postResponse(input), 'IntakeSopContinuationReceipt');
  async function postResponse(input: Awaited<ReturnType<typeof query>>) { return post('agent', '/v1/intake/sop/check', input.opening); }
  let r1: Awaited<ReturnType<typeof publish>>, r2: Awaited<ReturnType<typeof publish>>;
  let q1: Awaited<ReturnType<typeof query>>, q2: Awaited<ReturnType<typeof query>>, active: C['IntakeSopContinuationReceipt'];
  it('discovers sources and complete vocabulary through the selected view before entering the normal write chain', async () => {
    const resourceIds = ['source-quality', 'source-resource', 'source-solo'];
    const observations: Record<string, { sourceIds: string[]; capabilityIds: (string | null)[] }> = {};
    let resourceCursor: string | null = null;
    for (const view of [
      { name: 'resource-disable', id: contract }, { name: 'graph', id: SOP_CONTRACT_SET },
      { name: 'legacy', id: LEGACY_CONTRACT_SET }, { name: 'legacy-absent', id: null },
    ] as const) {
      const selected = view.name === 'legacy-absent' ? 'legacy' : view.name;
      const read = async (url: string): Promise<unknown> => {
        const response = view.id === null ? await host.requestAs('agent', url) : await request('agent', url, {}, view.id);
        expect(response.status, await response.clone().text()).toBe(200);
        expect(response.headers.get('cache-control')).toContain('no-store');
        if (selected !== 'legacy') expect(response.headers.get('x-intake-contract-set')).toBe(view.id);
        return response.json();
      };
      const sources: C['IntakeSource'][] = [];
      let cursor: string | null = null;
      do {
        const body: unknown = await read(`/v1/intake/sources?${new URLSearchParams({ limit: '1', ...(cursor ? { cursor } : {}) })}`);
        const page = withIntakeView(selected, () => parseContractSchema('IntakeSourceList', body));
        sources.push(...page.items);
        if (view.name === 'resource-disable' && resourceCursor === null) resourceCursor = page.nextCursor;
        cursor = page.nextCursor;
      } while (cursor);
      const capabilities: C['IntakeAuthorization']['capabilities'] = [];
      do {
        const body: unknown = await read(`/v1/intake/authorization?${new URLSearchParams({ limit: '1', ...(cursor ? { cursor } : {}) })}`);
        const page = withIntakeView(selected, () => parseContractSchema('IntakeAuthorization', body));
        capabilities.push(...page.capabilities); cursor = page.nextCursor;
      } while (cursor);
      const sourceIds = sources.map(source => source.scope.sourceId).sort();
      const capabilityIds = capabilities.map(capability => capability.scope.sourceId).sort();
      expect(capabilityIds).toEqual(sourceIds);
      expect(new Set(sourceIds).size).toBe(sourceIds.length);
      expect(sourceIds).toContain('source-a');
      if (selected === 'resource-disable') {
        expect(sourceIds).toEqual(expect.arrayContaining([...resourceIds, 'source-v11-discovery']));
        for (const source of sources.filter(source => resourceIds.includes(source.scope.sourceId))) {
          expect(source).toMatchObject({ ...SOP_RESOURCE_FORMAT, structureDigest: SOP_TASK_STRUCTURE_SHA256 });
        }
      } else {
        expect(sourceIds.some(id => resourceIds.includes(id))).toBe(false);
        expect(sourceIds.includes('source-v11-discovery')).toBe(selected === 'graph');
      }
      observations[view.name] = { sourceIds, capabilityIds };
    }
    if (!resourceCursor) throw new Error('Expected resource discovery cursor');
    await denied(await request('agent', `/v1/intake/sources?${new URLSearchParams({ limit: '1', cursor: resourceCursor })}`, {}, SOP_CONTRACT_SET), 409);
    const vocabulary: C['IntakeVocabulary'][] = [];
    let cursor: string | null = null;
    do {
      const page: C['IntakeVocabularyList'] = await checked(await request('agent', `/v1/intake/sources/source-resource/vocabulary?${new URLSearchParams({ limit: '1', ...(cursor ? { cursor } : {}) })}`), 'IntakeVocabularyList');
      vocabulary.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    expect(vocabulary.map(item => [item.id, item.kind])).toEqual([
      ['product-extra', 'product'], ['product-graph', 'product'], ['scenario-graph', 'scenario'],
    ]);
    for (const item of vocabulary) expect(item).toMatchObject({ displayVersion: 1, meaningDigest: digest(item.id), active: true });
    for (const sourceId of ['source-b', 'source-does-not-exist']) {
      await denied(await request('agent', `/v1/intake/sources/${sourceId}/vocabulary?limit=1`), 404, 'SCOPE_DENIED');
    }
    writeFileSync(path.join(evidenceRoot, 'source-discovery.json'), JSON.stringify({ observations, vocabulary }, null, 2));
  });
  it('publishes real graph/media and consumes the entire existing E selection without issuing another E', async () => {
    const selectedContract = (await admin.query("SELECT content_intake.sop_query_contract('resource-disable') AS id")).rows[0].id;
    expect(selectedContract).toBe(contract);
    r1 = await publish(await receive(await syntheticTaskGraphWorkbook({ sharedTaskImage: true }), 'rel_native_base'));
    await registerFacts(r1);
    q1 = await query();
    const rows = (await admin.query(`SELECT e.entitlement_hash,ctx.product_ids,ctx.scenario_ids,l.context_generation
      FROM content_intake.sop_unified_query_bindings b JOIN content_intake.sop_query_leases l USING(lease_id)
      JOIN content_intake.entitlements e USING(entitlement_hash) JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
      WHERE l.request_id=$1`, [q1.body.request_id])).rows;
    expect(rows).toHaveLength(1); expect(rows[0].entitlement_hash).toBe(digest(q1.entitlement.entitlementId));
    expect(rows[0].product_ids).toEqual(['product-extra','product-graph']); expect(rows[0].scenario_ids).toEqual(['scenario-graph']);
    expect(rows[0].context_generation).toBe(q1.body.context_generation);
    const receiptKey = (await admin.query("SELECT operation,request_key FROM backend_review.receipts WHERE operation='intake:sop-query-v12'")).rows[0];
    expect(receiptKey.request_key).toHaveLength(101); expect(receiptKey.request_key).toMatch(/^[a-f0-9]{64}:[a-f0-9-]{36}$/);
  });
  it('binds Q1 to F1 while Q2 consumes F2 and recovers original open after a real lost commit', async () => {
    await registerFacts(r1, 1); q2 = await query();
    arm = 'open'; await denied(await post('agent', '/v1/intake/sop/check', q1.opening), 503, 'COMMIT_UNKNOWN');
    active = await open(q1);
    const row = (await admin.query('SELECT * FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [digest(q1.opening.continuationId)])).rows[0];
    expect(Number(row.facts_version)).toBe(1); expect(row.opening_query_request_id).toBe(q1.body.request_id);
    expect(row.opening_query_proof.selectedContractSetId).toBe(contract);
    expect(row.opening_query_proof.factsVersion).toBe(1); expect(row.opening_query_proof_hash).toBe(digest(canonical(row.opening_query_proof)));
    expect((await open(q1)).continuationId).toBe(active.continuationId);
    const second = await open(q2); expect(second.entitlement.releaseId).toBe(r1.releaseId);
    await denied(await post('agent', '/v1/intake/sop/check', { ...q1.opening, queryRequestId: q2.body.request_id }), 409);
  });
  it('authorizes exact copy and edges, reads all owner bytes and converges concurrent exact opens', async () => {
    const action = { ...q1.opening, entitlementId: active.entitlement.entitlementId, queryRequestId: null };
    const scripted = q1.ready.result.flow.nodes.find(node => node.body.scripts.length)!;
    const copy = await post('agent', '/v1/intake/sop/check', { ...action, nodeId: scripted.id,
      action: 'copy', entry: scripted.body.scripts[0]!.entry });
    expect(copy.status, await copy.text()).toBe(204);
    for (const edge of q1.ready.result.flow.edges) {
      const result = await post('agent', '/v1/intake/sop/check', { ...action, nodeId: edge.from,
        action: edge.action.kind === 'next' ? 'next' : 'choose', edgeId: edge.id });
      expect(result.status, await result.text()).toBe(204);
    }
    await denied(await post('agent', '/v1/intake/sop/check', { ...action, action: 'next', edgeId: 'absent-edge' }), 422);
    const owners = new Set<string>();
    for (const media of q1.ready.result.media) {
      const binding = media.binding;
      const ownerKind = binding.entry ? 'entry' : binding.graphTarget!.kind;
      const ownerId = binding.entry?.businessEntryId ?? binding.graphTarget!.id;
      owners.add(ownerKind);
      const url = new URLSearchParams({ entitlementId: active.entitlement.entitlementId,
        sourceId: binding.flowKey.sourceId, flowId: binding.flowKey.flowId, ownerKind, ownerId, resourceId: binding.resourceId });
      const payload = await checked(await request('agent', `/v1/intake/sop/releases/${r1.releaseId}/media/${binding.objectId}?${url}`,
        { headers: { 'x-sop-continuation': q1.opening.continuationId } }), 'IntakeSopMediaPayload');
      expect(payload.mime).toBe(binding.mime); expect(payload.bytes).toBe(binding.bytes);
      expect(digest(Buffer.from(payload.base64, 'base64'))).toBe(binding.sha256);
    }
    expect([...owners].sort()).toEqual(['entry','knowledge','task']);
    const copies = await Promise.all([open(q2), open(q2)]);
    expect(copies.every(copy => copy.continuationId === q2.opening.continuationId)).toBe(true);
    expect((await admin.query('SELECT count(*)::int n FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
      [digest(q2.opening.continuationId)])).rows[0].n).toBe(1);
  });
  it('recovers exact C ready after unknown commit and concurrent replay without issuing another E', async () => {
    const recovered = await query(1, true);
    const responses = await Promise.all([post('agent', '/v1/sop/query', recovered.body), post('agent', '/v1/sop/query', recovered.body)]);
    for (const response of responses) expect(await checked(response, 'MenokinSopQuerySopQueryResponse')).toEqual(recovered.ready);
    expect((await admin.query(`SELECT count(*)::int n FROM content_intake.sop_query_leases
      WHERE request_id=$1`, [recovered.body.request_id])).rows[0].n).toBe(1);
    const binding = (await admin.query(`SELECT b.entitlement_hash FROM content_intake.sop_unified_query_bindings b
      JOIN content_intake.sop_query_leases l USING(lease_id) WHERE l.request_id=$1`, [recovered.body.request_id])).rows[0];
    expect(binding.entitlement_hash).toBe(digest(recovered.entitlement.entitlementId));
  });
  it('rejects cross-view E/Q and unrelated shop or product without leaking a graph', async () => {
    await denied(await post('agent', '/v1/sop/query', { ...q1.body, request_id: randomUUID(), shop_id: 'shop-absent' }), 403);
    await denied(await post('agent', '/v1/sop/query', { ...q1.body, request_id: randomUUID(), product_context: { type: 'sku', ref: 'x'.repeat(256) } }), 403);
    await denied(await post('reviewer', '/v1/sop/query', { ...q1.body, request_id: randomUUID() }), 403);
    const legacy = 'cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f';
    const oldE = await host.requestAs('agent', '/v1/intake/entitlements', { method: 'POST', headers: { 'x-intake-contract-set': legacy, 'content-type': 'application/json' },
      body: JSON.stringify({ shopId: 'shop-a', contextGeneration: 2, releaseId: null, productIds: ['product-graph'], scenarioIds: ['scenario-graph'] }) });
    const old = await oldE.json() as C['IntakeEntitlement'];
    await denied(await post('agent', '/v1/sop/query', { ...q1.body, request_id: randomUUID(), entitlement_id: old.entitlementId }), 403);
  });
  it('freezes explicit historical bindings, requires full resource checks and atomically ends old active handles', async () => {
    const item = await receive(await syntheticResourceDisableWorkbook(['image-task','document-a']), r1.releaseId);
    expect(item.material.differences).toEqual([]); expect(item.material.sopDifferences).toEqual([]);
    expect(item.material.resourceDisableCount).toBe(2); expect(item.material.risk.explicitDisableCount).toBe(2);
    expect(item.material.resourceDisables.find(disable => disable.key.resourceId === 'image-task')!.bindings.map(binding => binding.owner)).toEqual([
      { kind: 'task', id: 'task-a' }, { kind: 'task', id: 'task-b' }]);
    for (const disable of item.material.resourceDisables) for (const binding of disable.bindings) expect(binding.releaseId).toBe(r1.releaseId);
    const selected = item.material.resourceDisables.find(disable => disable.key.resourceId === 'image-task')!.bindings[0]!;
    if (selected.content.kind !== 'image' || selected.owner.kind === 'entry') throw new Error('Expected task image history');
    const mediaQuery = new URLSearchParams({ digest: item.key.digest, sourceId: selected.flowKey.sourceId,
      flowId: selected.flowKey.flowId, flowVersion: String(selected.flowKey.flowVersion), ownerKind: selected.owner.kind,
      ownerId: selected.owner.id, resourceId: 'image-task' });
    const preview = await checked(await request('reviewer', `${base(item.key)}/sop/media/${selected.content.objectId}?${mediaQuery}`), 'IntakeSopCandidateMediaPayload');
    expect(digest(Buffer.from(preview.base64, 'base64'))).toBe(selected.content.sha256);
    r2 = await publish(item, true);
    expect((await admin.query("SELECT closed_at,termination_reason FROM content_intake.sop_active_uses WHERE continuation_hash=$1", [digest(q1.opening.continuationId)])).rows[0]).toMatchObject({ termination_reason: 'content-disabled' });
    await denied(await post('agent', '/v1/intake/sop/check', q1.opening), 409);
    const stale = await checked(await post('agent', '/v1/sop/query', q1.body), 'MenokinSopQuerySopQueryResponse');
    expect(stale.status).toBe('stale'); expect(stale.result).toBeNull(); expect(stale.lease_expires_at).toBeNull();
    const lineage = (await admin.query('SELECT candidate_id,candidate_version FROM content_intake.sop_graph_release_lineage WHERE release_id=$1', [r2.releaseId])).rows;
    expect(lineage[0]).toMatchObject({ candidate_id: r1.key.candidateId, candidate_version: String(r1.key.version) });
    expect((await admin.query('SELECT count(*)::int AS n FROM content_intake.sop_resource_disable_publications WHERE release_id=$1', [r2.releaseId])).rows[0].n).toBe(1);
    expect((await admin.query("SELECT count(*)::int AS n FROM content_intake.sop_graph_disable_events WHERE release_id=$1 AND target_kind='resource'", [r2.releaseId])).rows[0].n).toBe(2);
  });
  it('rolls back the catalog with retained events, keeps old H closed and admits a distinct new current H', async () => {
    const impact = await checked(await post('director', '/v1/intake/rollback/preview', { baseReleaseId: r2.releaseId, targetReleaseId: r1.releaseId }), 'IntakeRollbackImpact');
    expect(impact.newResourceDisableCount).toBe(0);
    const body = { operationId: op('rollback'), rollbackPlanId: impact.rollbackPlanId, baseReleaseId: impact.baseReleaseId,
      targetReleaseId: impact.targetReleaseId, impactDigest: impact.impactDigest, retainedResourceDisableEventsDigest: impact.retainedResourceDisableEventsDigest, confirmed: true };
    await denied(await post('director', '/v1/intake/rollback', { ...body, retainedResourceDisableEventsDigest: '0'.repeat(64) }), 409);
    arm = 'rollback'; await denied(await post('director', '/v1/intake/rollback', body), 503, 'COMMIT_UNKNOWN');
    const receipt = await checked(await post('director', '/v1/intake/rollback', body), 'IntakeRollbackReceipt');
    expect(receipt.retainedResourceDisableEventsDigest).toBe(impact.retainedResourceDisableEventsDigest);
    expect((await admin.query("SELECT count(*)::int AS n FROM content_intake.sop_graph_disable_events WHERE release_id=$1", [receipt.releaseId])).rows[0].n).toBe(0);
    await denied(await post('agent', '/v1/intake/sop/check', q1.opening), 409);
    const fresh = await query(3); restorable = fresh; expect(fresh.ready.release_id).toBe(receipt.releaseId);
    const current = await open(fresh); expect(current.entitlement.releaseId).toBe(receipt.releaseId);
    writeFileSync(path.join(evidenceRoot, 'normal-results.json'), JSON.stringify({ r1: r1.releaseId, r2: r2.releaseId,
      r3: receipt.releaseId, oldHandleClosed: true, newCurrentOpen: true, retainedEventsDigest: receipt.retainedResourceDisableEventsDigest }, null, 2));
  });
  it('publishes a new R4 disable after rollback and stops a historical resource absent from the next current graph', async () => {
    const afterRollback = restorable;
    const fourth = await publish(await receive(await syntheticResourceDisableWorkbook(['image-knowledge']), afterRollback.ready.release_id));
    await denied(await post('agent', '/v1/intake/sop/check', afterRollback.opening), 409);
    const pinnedFourth = await query(4); await open(pinnedFourth);
    const without = await publish(await receive(await syntheticTaskGraphWorkbook({ withoutTaskImages: true }), fourth.releaseId));
    await registerFacts(without);
    const present = await query(5); await open(present);
    expect(present.ready.result.media.some(media => media.binding.resourceId === 'image-task')).toBe(false);
    const historical = await receive(await syntheticResourceDisableWorkbook(['image-task']), without.releaseId);
    expect(historical.material.resourceDisables[0]!.bindings.some(binding => binding.releaseId === r1.releaseId)).toBe(true);
    expect(historical.material.resourceDisables[0]!.bindings.some(binding => binding.releaseId === without.releaseId)).toBe(false);
    const sixth = await publish(historical);
    await denied(await post('agent', '/v1/intake/sop/check', pinnedFourth.opening), 409);
    const resumed = await checked(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: present.opening.continuationId, contextGeneration: 6 }), 'IntakeSopContinuationReceipt');
    expect(resumed.entitlement.releaseId).toBe(without.releaseId);
    restorable = await query(7); await open(restorable);
    expect(restorable.ready.release_id).toBe(sixth.releaseId);
    writeFileSync(path.join(evidenceRoot, 'historical-resource-stop.json'), JSON.stringify({ fourth: fourth.releaseId,
      fifth: without.releaseId, sixth: sixth.releaseId, oldStopped: true, absentCurrentHandleRemainsValid: true }, null, 2));
  });
  it('requires a real flow quality target even with no FAQ and opens the independent graph through v12', async () => {
    const solo = await publish(await receive(await syntheticTaskGraphWorkbook({ solo: true, shopWide: true }), restorable.ready.release_id, 'source-solo'));
    expect(solo.material.entries).toEqual([]);
    await registerFacts(solo, 0, '品质售后SOP');
    const independent = await query(8, false, '品质售后SOP', true);
    expect(independent.ready.result.entries).toEqual([]); expect(independent.ready.result.flow.header.anchorEntry).toBeNull();
    await open(independent);
    restorable = await query(9); await open(restorable);
  });
  it('expires the original Q/E under a real short grant while exact active replay accepts a replacement grant', async () => {
    const current = restorable;
    const grants = (await admin.query("SELECT grant_id,version FROM content_intake.grants WHERE recipient_id='agent' AND source_id='source-resource' AND action='query' AND revoked_at IS NULL")).rows;
    for (const grant of grants) await checked(await request('director', `/v1/intake/grants/${grant.grant_id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: op('revoke-query'),
        expectedVersion: Number(grant.version), change: 'revoke', stewardPrincipalId: null, reason: '合成换链' }) }), 'IntakeGrant');
    await denied(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: current.opening.continuationId,
      contextGeneration: 10 }), 404, 'SCOPE_DENIED');
    await grantQuery(3);
    const short = await query(11); const opened = await open(short);
    const before = (await admin.query('SELECT opening_query_proof_hash FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
      [digest(short.opening.continuationId)])).rows[0].opening_query_proof_hash;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(short.ready.lease_expires_at) - Date.now() + 30)));
    await denied(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: short.opening.continuationId,
      contextGeneration: 12 }), 404, 'SCOPE_DENIED');
    expect((await admin.query('SELECT closed_at FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
      [digest(short.opening.continuationId)])).rows[0].closed_at).toBeNull();
    await grantQuery(180);
    const expired = (await admin.query(`SELECT e.principal_generation,p.revocation_generation,
      e.valid_until<=clock_timestamp() AS entitlement_expired,l.expires_at<=clock_timestamp() AS query_expired
      FROM content_intake.entitlements e JOIN content_intake.principals p ON p.principal_id=e.principal_id
      JOIN content_intake.sop_unified_query_bindings b USING(entitlement_hash)
      JOIN content_intake.sop_query_leases l USING(lease_id) WHERE e.entitlement_hash=$1`, [digest(short.entitlement.entitlementId)])).rows[0];
    expect(expired.entitlement_expired).toBe(true); expect(expired.query_expired).toBe(true);
    expect(expired.principal_generation).not.toBe(expired.revocation_generation);
    await denied(await post('agent', '/v1/sop/query', short.body), 403);
    const replay = await open(short);
    expect(replay.entitlement.entitlementId).not.toBe(opened.entitlement.entitlementId);
    expect(Date.parse(replay.entitlement.validUntil)).toBeGreaterThan(Date.now());
    const proof = (await admin.query('SELECT opening_query_proof_hash FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
      [digest(short.opening.continuationId)])).rows[0].opening_query_proof_hash;
    expect(proof).toBe(before);
    restorable = await query(13); await open(restorable);
    writeFileSync(path.join(evidenceRoot, 'real-query-entitlement-expiry.json'), JSON.stringify({ expiredAt: short.ready.lease_expires_at,
      observedAt: new Date().toISOString(), expiredQueryDeniedAfterGrantGenerationChanged: true, expired, sameOpeningProofHash: proof, replacementGrantAccepted: true }, null, 2));
  });
  it('rebinds only after natural same-account session expiry and keeps logout terminal with retained proof', async () => {
    const original = restorable;
    const previous = agentAuthorization;
    if (!previous) throw new Error('Synthetic session missing');
    replacementAuthorization = await freshAgentSession();
    await denied(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: original.opening.continuationId,
      contextGeneration: 14 }), 404, 'SCOPE_DENIED');
    const oldHash = digest(previous.slice('Bearer '.length));
    await admin.query("UPDATE backend_identity.sessions SET expires_at=clock_timestamp()-interval '1 millisecond' WHERE token_hash=$1 AND revoked_at IS NULL", [oldHash]);
    const resumed = await checked(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: original.opening.continuationId,
      contextGeneration: 15 }), 'IntakeSopContinuationReceipt');
    expect(resumed.entitlement.releaseId).toBe(original.ready.release_id);
    const row = (await admin.query(`SELECT e.contract_view,ctx.product_ids,ctx.scenario_ids FROM content_intake.entitlements e
      JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash) WHERE e.entitlement_hash=$1`, [digest(resumed.entitlement.entitlementId)])).rows[0];
    expect(row).toEqual({ contract_view: 'resource-disable', product_ids: ['product-extra','product-graph'], scenario_ids: ['scenario-graph'] });
    expect((await admin.query('SELECT revoked_at,expires_at<clock_timestamp() expired FROM backend_identity.sessions WHERE token_hash=$1', [oldHash])).rows[0])
      .toEqual({ revoked_at: null, expired: true });
    await expect(admin.query('DELETE FROM backend_identity.sessions WHERE token_hash=$1', [oldHash])).rejects.toMatchObject({ code: '23503' });
    expect((await fetch(`${host.apiOrigin}/v1/auth/logout`, { method: 'POST', headers: { authorization: replacementAuthorization } })).status).toBe(204);
    replacementAuthorization = await freshAgentSession();
    await denied(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: original.opening.continuationId,
      contextGeneration: 16 }), 409, 'SOP_RELEASE_CHANGED');
    expect((await admin.query('SELECT termination_reason,session_hash FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
      [digest(original.opening.continuationId)])).rows[0]).toEqual({ termination_reason: 'logout', session_hash: null });
    restorable = await query(17); await open(restorable);
  });
  it('retains exact resource checks through both real quality phases and blocks publication with remaining defects', async () => {
    const full = await publish(await receive(await syntheticTaskGraphWorkbook({ qualityCount: 501 }), restorable.ready.release_id, 'source-quality'));
    await registerFacts(full, 0, '长痘痘SOP');
    const item = await receive(await syntheticResourceDisableWorkbook(['image-task']), full.releaseId, 'source-quality');
    expect(item.material.risk.level).toBe('routine');
    const confirmed = await confirm(item);
    await checked(await post('reviewer', `${base(item.key)}/quality/freeze`, { operationId: op('phase-freeze'), key: item.key }), 'IntakeQualityReceipt');
    async function samples(phase: 'initial' | 'expanded') {
      const state = await checked(await request('reviewer', `${base(item.key)}/quality?digest=${item.key.digest}`), 'IntakeQualityStatus');
      const pages: C['IntakeQualitySamplePage'][] = []; let cursor: string | null = null;
      do {
        const page: C['IntakeQualitySamplePage'] = await checked(await request('reviewer', `${base(item.key)}/quality/samples?digest=${item.key.digest}&viewHash=${state.viewHash}&phase=${phase}&limit=100${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeQualitySamplePage');
        pages.push(page); cursor = page.nextCursor;
      } while (cursor);
      return { state, faq: pages.flatMap(page => page.items), resources: pages.flatMap(page => page.resourceDisableItems) };
    }
    const initial = await samples('initial');
    const ordinary = initial.faq.filter(sample => !sample.mandatory);
    const defectCount = Math.floor(ordinary.length * 0.02) + 1;
    const defectIds = new Set(ordinary.slice(0, defectCount).map(sample => sample.scriptId));
    expect(defectCount / ordinary.length).toBeLessThanOrEqual(0.05);
    const checks = initial.faq.map(sample => ({ scriptId: sample.scriptId, contentHash: sample.contentHash,
      defect: defectIds.has(sample.scriptId), reason: defectIds.has(sample.scriptId) ? '合成待修订缺陷' : '' }));
    const resources = initial.resources.map(sample => ({ target: sample.target, defect: false, reason: '' }));
    const command = { operationId: op('phase-initial'), key: item.key, materialDigest: item.key.digest,
      phase: 'initial', checks, sopChecks: [], resourceDisableChecks: resources };
    const first = await checked(await post('reviewer', `${base(item.key)}/quality/checks`, command), 'IntakeQualityReceipt');
    expect(first.state).toBe('expansion_required');
    const expanded = await samples('expanded');
    expect(expanded.faq.length).toBeGreaterThan(initial.faq.length);
    expect(expanded.resources.map(sample => sample.check)).toEqual(resources);
    const prior = new Map(checks.map(check => [check.scriptId, check]));
    const expandedCommand = { ...command, operationId: op('phase-expanded'), phase: 'expanded',
      checks: expanded.faq.map(sample => prior.get(sample.scriptId) ?? { scriptId: sample.scriptId,
        contentHash: sample.contentHash, defect: false, reason: '' }) };
    await denied(await post('reviewer', `${base(item.key)}/quality/checks`, { ...expandedCommand,
      resourceDisableChecks: resources.map(check => ({ ...check, defect: true, reason: '不得改写第一轮资源结论' })) }), 422);
    const second = await checked(await post('reviewer', `${base(item.key)}/quality/checks`, expandedCommand), 'IntakeQualityReceipt');
    expect(second.state).toBe('revision_required');
    const final = await checked(await request('reviewer', `${base(item.key)}/quality?digest=${item.key.digest}`), 'IntakeQualityStatus');
    expect(final.rounds.map(round => round.resourceDisableChecksSummary)).toEqual([
      { checkedCount: 1, defectCount: 0, checksDigest: digest(canonical(resources)) },
      { checkedCount: 1, defectCount: 0, checksDigest: digest(canonical(resources)) },
    ]);
    await denied(await post('director', `${base(item.key)}/publish`, { operationId: op('blocked-publish'), key: item.key,
      baseReleaseId: full.releaseId, sourceEvidenceVersion: confirmed.sourceEvidenceVersion, title: '合成缺陷发布拒绝',
      summary: '两阶段检查仍需修订', confirmed: true }), 409, 'MATERIAL_CHANGED');
    const report = await request('enabler', `/v1/intake/parse-jobs/${item.job.jobId}/report`);
    expect(report.ok).toBe(true);
    const rows = await readSyntheticQualityReport(Buffer.from(await report.arrayBuffer()));
    expect(rows.filter(row => row[0] === 'resourceDisableCheck')).toHaveLength(2);
    writeFileSync(path.join(evidenceRoot, 'two-phase-quality.json'), JSON.stringify({ first, second, final }, null, 2));
    restorable = await query(18); await open(restorable);
  }, 120_000);
  it('enforces actual four-role ACLs, deferred original-publication FKs and immutable nonempty resource/proof history', async () => {
    const tables = ['sop_resource_disables','sop_resource_disable_quality_targets','sop_resource_disable_quality_checks',
      'sop_resource_disable_publications','sop_resource_disable_event_lineage'];
    const roles = ['app_runtime','intake_business','intake_worker','intake_usage'];
    const evidence: { role: string; table: string; denied: boolean }[] = [];
    for (const table of tables) {
      expect((await admin.query(`SELECT count(*)::int n FROM content_intake.${table}`)).rows[0].n).toBeGreaterThan(0);
      await expect(admin.query(`UPDATE content_intake.${table} SET source_id=source_id`)).rejects.toMatchObject({ code: 'ZA003', message: 'MATERIAL_CHANGED' });
      await expect(admin.query(`DELETE FROM content_intake.${table}`)).rejects.toMatchObject({ code: 'ZA003', message: 'MATERIAL_CHANGED' });
      for (const role of roles) {
        await admin.query('BEGIN');
        try {
          await admin.query(`SET LOCAL ROLE ${role}`);
          await expect(admin.query(`SELECT * FROM content_intake.${table} LIMIT 1`)).rejects.toMatchObject({ code: '42501' });
          evidence.push({ role, table, denied: true });
        } finally { await admin.query('ROLLBACK'); }
      }
    }
    const signatures = [
      ['content_intake.read_sop_resource_history(text,text,text,text)', 'intake_business'],
      ['content_intake.freeze_sop_resource_quality(text,text,bigint)', 'intake_business'],
      ['content_intake.check_sop_resource_quality(text,text,bigint,text,jsonb,timestamptz)', 'intake_business'],
      ['content_intake.resolve_sop_open_ready_query(text,text,text,text,jsonb,text,uuid)', 'none'],
      ['content_intake.assert_sop_resource_material(text,text,text,jsonb,text)', 'none'],
      ['content_intake.open_sop_active_use(text,text,text,text,bigint,text,jsonb,text,text,boolean,jsonb)', 'intake_usage'],
    ];
    for (const [signature, allowed] of signatures) for (const role of roles) {
      expect((await admin.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [role, signature])).rows[0].allowed,
        `${role} ${signature}`).toBe(role === allowed);
    }
    const fks = (await admin.query(`SELECT c.conrelid::regclass::text AS relation,c.confrelid::regclass::text AS foreign_table,
      c.condeferrable,c.condeferred,c.convalidated,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
      WHERE c.contype='f' AND c.conrelid=ANY($1::regclass[]) ORDER BY 1,2`, [tables.map(table => `content_intake.${table}`)])).rows;
    expect(fks.every(row => row.convalidated)).toBe(true);
    const original = fks.find(row => row.foreign_table === 'content_intake.publications');
    expect(original).toMatchObject({ condeferrable: true, condeferred: true });
    await admin.query('BEGIN');
    try {
      await admin.query(`INSERT INTO content_intake.sop_resource_disable_event_lineage(release_id,source_id,resource_id,
        candidate_id,candidate_version,material_digest,disable_digest) SELECT release_id,source_id,'missing-resource',
        candidate_id,candidate_version,material_digest,disable_digest FROM content_intake.sop_resource_disable_event_lineage LIMIT 1`);
      await expect(admin.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toMatchObject({ code: '23503' });
    } finally { await admin.query('ROLLBACK'); }
    await expect(admin.query('UPDATE content_intake.sop_active_uses SET opening_query_proof=NULL WHERE continuation_hash=$1',
      [digest(q1.opening.continuationId)])).rejects.toMatchObject({ code: 'ZA003', message: 'MATERIAL_CHANGED' });
    await expect(admin.query('DELETE FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
      [digest(q1.opening.continuationId)])).rejects.toMatchObject({ code: 'ZA003', message: 'MATERIAL_CHANGED' });
    writeFileSync(path.join(evidenceRoot, 'actual-acl-fk-immutability.json'), JSON.stringify({ evidence, fks,
      immutableResourceTables: tables, immutableOpeningProof: true }, null, 2));
  });
  it('restores nonempty resource lineage, exact opening proofs, closed/active handles and actual media through backup', async () => {
    const config = (await admin.query(`SELECT current_database() AS database,current_user AS user,
      current_setting('unix_socket_directories') AS host,current_setting('port')::int AS port`)).rows[0];
    const images = (await admin.query(`SELECT DISTINCT m.payload_object_id,m.sha256 FROM content_intake.sop_graph_release_media b
      JOIN content_intake.sop_media_objects m ON m.media_object_id=b.object_id WHERE b.release_id=$1`, [restorable.ready.release_id])).rows;
    const input = path.join(host.root, 'resource-backup-input.json');
    writeFileSync(input, JSON.stringify({ root: host.root, ...config, agentAuthorization, evidenceRoot, resourceProbe: true,
      entitlementHash: digest(restorable.entitlement.entitlementId), graphDigests: (await admin.query('SELECT content_intake.read_sop_graph_current($1,$2) AS value', ['agent', digest(restorable.entitlement.entitlementId)])).rows[0].value.graphs.map((graph: { graphDigest: string }) => graph.graphDigest),
      imageSha256: images.map(item => item.sha256), releaseId: restorable.ready.release_id,
      query: { request: restorable.body, response: restorable.ready }, continuationProbe: true }), { mode: 0o600 });
    const media = restorable.ready.result.media[0]!.binding;
    const binding = { sourceId: media.flowKey.sourceId, flowId: media.flowKey.flowId,
      ownerKind: media.entry ? 'entry' : media.graphTarget!.kind,
      ownerId: media.entry?.businessEntryId ?? media.graphTarget!.id, resourceId: media.resourceId };
    const result = spawnSync(process.execPath, ['tests/support/sop-graph-backup.mjs', input], {
      cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
      input: JSON.stringify({ active: restorable.opening.continuationId, closed: q1.opening.continuationId,
        releaseId: restorable.ready.release_id, binding, objectId: media.objectId, sha256: media.sha256 }) });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    writeFileSync(path.join(evidenceRoot, 'populated-backup.log'), output);
    if (result.error) throw result.error;
    expect(result.status, output).toBe(0);
    expect(output).toContain('NONEMPTY_GRAPH_RESTORE_PASS');
    const restored = JSON.parse(readFileSync(path.join(evidenceRoot, 'nonempty-restore-results.json'), 'utf8'));
    expect(restored.report.migrationCount).toBe(88);
    expect(restored.http.continuation).toMatchObject({ restoredRenew: true, closedRejected: true, repeatedClose: true });
  }, 180_000);

});
