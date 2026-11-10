import { digest } from '../src/content-intake/material.js';
import { request as rawHttpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseContractSchema as parse, type ContractSchemaName, type components } from '@customer-agent/contracts/sop-unified';
import { SOP_TASK_FORMAT, SOP_TASK_STRUCTURE_SHA256 } from '@customer-agent/content-intake';
import { syntheticGraphMapping, syntheticTaskGraphWorkbook } from '../../../packages/content-intake/tests/support/sop-task-graph-workbook.js';
import type { IntakePool } from '../src/content-intake/transaction.js';
import { createIntakeSyntheticHost, type IntakeSyntheticHost, type IntakeSyntheticIdentity } from './support/intake-synthetic-host.js';
import { graphFor, type GraphMaterial } from '../src/content-intake/sop-graph.js';
import { SOP_UNIFIED_QUERY_CONTRACT_SET_ID, type UnifiedSopQueryRequest } from '../src/sop-unified-query-model.js';
import { parseSopQueryPublicationFacts, parseSyntheticSopQueryFacts } from '../src/sop-unified-query-facts.js';
import { parseSopQueryBundle } from '../src/sop-unified-query-context.js';
import { parseUnifiedSopQueryResponse, sopGraphDigest } from '../src/sop-unified-query-validation.js';

type C = components['schemas'];
const enabled = process.env.CUSTOMER_AGENT_API_SOP_QUERY_PG15_INTEGRATION === '1';
const evidenceRoot = path.join(os.tmpdir(), `sop-unified-query-http-${randomUUID()}`);
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
describe.skipIf(!enabled).sequential('normal 86 SOP query through actual HTTP and PostgreSQL', () => {
  let host: Pick<IntakeSyntheticHost, 'requestAs' | 'writeSopQueryFacts' | 'close' | 'root' | 'apiOrigin'>, admin: Client;
  let sequence = 0;
  let agentAuthorization: string | null = null;
  let arm: 'facts' | 'query' | 'query-before' | null = null;
  let corruptRead: 'digest' | 'allergy' | null = null;
  let refreshAtSourceStamp = false;
  let observedSourceStamp: string | null = null;
  const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  function uncertain(pool: IntakePool): IntakePool {
    return { connect: async () => {
      const client = await pool.connect();
      let lose: typeof arm = null;
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          if (refreshAtSourceStamp && sql.startsWith('SELECT clock_timestamp()') && sql.endsWith(' AS at')) {
            refreshAtSourceStamp = false;
            const stamp = await target.query<{ at: Date | string; exact: string }>(`SELECT ${sql.includes('::text') ? 'instant::text' : 'instant'} AS at,
              instant::text AS exact FROM (SELECT date_trunc('milliseconds',clock_timestamp()) - interval '500 microseconds' AS instant) sample`);
            observedSourceStamp = stamp.rows[0]!.exact;
            writeFileSync(path.join(evidenceRoot, 'source-stamp-boundary-input.json'), JSON.stringify({ exact: observedSourceStamp,
              dateRoundTrip: new Date(observedSourceStamp).toISOString(), driverAtKind: stamp.rows[0]!.at instanceof Date ? 'date' : 'text' }));
            const inserted = await admin.query<{ facts_version: string }>(`INSERT INTO content_intake.principal_facts
              SELECT (jsonb_populate_record(NULL::content_intake.principal_facts, to_jsonb(f)||jsonb_build_object(
                'facts_version',f.facts_version+1,'checked_at',$1::timestamptz))).*
              FROM content_intake.principal_facts f JOIN content_intake.principals p
                ON p.principal_id=f.principal_id AND p.current_facts_version=f.facts_version
              WHERE p.principal_id='agent' RETURNING facts_version`, [observedSourceStamp]);
            await admin.query("UPDATE content_intake.principals SET current_facts_version=$1 WHERE principal_id='agent'", [inserted.rows[0]!.facts_version]);
            return stamp;
          }
          const result = await target.query<{ value: unknown }>(sql, values);
          if (corruptRead && sql.startsWith('SELECT content_intake.read_sop_unified_query_bundle')) {
            const raw = result.rows[0]?.value;
            if (!record(raw) || !Array.isArray(raw.graphs) || !record(raw.graphs[0])) throw new Error('Missing real PostgreSQL bundle');
            const first = raw.graphs[0];
            if (corruptRead === 'digest') first.graphDigest = '0'.repeat(64);
            else {
              const parsed = parseSopQueryBundle(raw).graphs[0]!;
              parsed.graph.definition.nodes[0]!.body.instruction = '过敏后继续';
              first.payload = parsed.graph; first.graphDigest = sopGraphDigest(parsed.graph);
            }
            corruptRead = null;
          }
          if (arm === 'facts' && sql.startsWith('SELECT to_jsonb(content_intake.write_sop_query_facts')) lose = arm;
          if ((arm === 'query' || arm === 'query-before') && sql.startsWith('SELECT content_intake.complete_sop_unified_query')) lose = arm;
          if (lose === 'query-before') { arm = null; lose = null; throw new Error('SYNTHETIC_FAILURE_BEFORE_COMMIT'); }
          if (sql === 'COMMIT' && lose && arm === lose) { arm = null; throw new Error('SYNTHETIC_RESPONSE_LOST_AFTER_COMMIT'); }
          return result;
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
  }
  const diagnostics: string[] = [];
  const operation = (label: string) => `query-${label}-${++sequence}`;
  const candidatePath = (key: C['IntakeCandidateKey']) => `/v1/intake/candidates/${key.candidateId}/versions/${key.version}`;
  const request = (actor: IntakeSyntheticIdentity, pathname: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.set('x-intake-contract-set', SOP_UNIFIED_QUERY_CONTRACT_SET_ID);
    return host.requestAs(actor, pathname, { ...init, headers });
  };
  const post = (actor: IntakeSyntheticIdentity, pathname: string, body: unknown) => request(actor, pathname,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  async function checked<Name extends ContractSchemaName>(response: Response, name: Name): Promise<C[Name]> {
    const body: unknown = await response.json();
    expect(response.ok, `${response.status} ${JSON.stringify(body)}\n${diagnostics.slice(-3).join('\n')}`).toBe(true);
    return parse(name, body);
  }
  beforeAll(async () => {
    mkdirSync(evidenceRoot, { recursive: true });
    host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime', includeSopQuery: true, includeLegacySearch: false,
      wrapBusinessPool: uncertain, wrapUsagePool: uncertain,
      observeSyntheticRequest: (actor, headers) => { if (actor === 'agent') agentAuthorization = headers.get('authorization'); },
      observeError: error => diagnostics.push(error instanceof Error ? `${error.stack}\n${JSON.stringify(error, ['code', 'detail', 'where'])}` : String(error)),
      configureDatabase: async client => {
        admin = client;
        await admin.query('BEGIN');
        try {
          await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
            VALUES('source-a',2,$1,$2,$3,$4,$5::jsonb)`, [SOP_TASK_FORMAT.templateVersion, SOP_TASK_FORMAT.ruleVersion,
            SOP_TASK_FORMAT.mappingVersion, SOP_TASK_STRUCTURE_SHA256, JSON.stringify(syntheticGraphMapping(false, true))]);
          await admin.query("UPDATE content_intake.sources SET current_mapping_version=2 WHERE source_id='source-a'");
          for (const [sourceId, scopeId, suffix, mapping] of [
            ['source-query-b', 'scope-query-b', '-query-b', syntheticGraphMapping(false, true)],
            ['source-query-large', 'scope-query-b', '-query-large', syntheticGraphMapping(false, true, true)],
            ['source-query-short', 'scope-query-b', '-query-short', syntheticGraphMapping(false, true)],
          ] as const) {
          await admin.query(`INSERT INTO content_intake.scopes SELECT (jsonb_populate_record(NULL::content_intake.scopes,
            to_jsonb(s)||jsonb_build_object('scope_id','${scopeId}','domain','sop'))).* FROM content_intake.scopes s WHERE scope_id='scope-a' ON CONFLICT(scope_id) DO NOTHING`);
          await admin.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES('${sourceId}','${scopeId}',1,'v2-preview')`);
          await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
            VALUES('${sourceId}',1,$1,$2,$3,$4,$5::jsonb)`, [SOP_TASK_FORMAT.templateVersion, SOP_TASK_FORMAT.ruleVersion,
            SOP_TASK_FORMAT.mappingVersion, SOP_TASK_STRUCTURE_SHA256, JSON.stringify(mapping)]);
          await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
            to_jsonb(g)||jsonb_build_object('grant_id',grant_id||'${suffix}','scope_id','${scopeId}',
            'source_id',CASE WHEN source_id IS NULL THEN NULL ELSE '${sourceId}' END,
            'parent_grant_id',CASE WHEN parent_grant_id IS NULL THEN NULL ELSE parent_grant_id||'${suffix}' END))).*
            FROM content_intake.grants g WHERE scope_id='scope-a'
            ORDER BY CASE kind WHEN 'allocation' THEN 0 WHEN 'delegation' THEN 1 ELSE 2 END`);
          await admin.query(`INSERT INTO content_intake.store_set_members(tenant_id,app_id,version,scope_id,source_id,content_valid_until)
            SELECT tenant_id,app_id,version,'${scopeId}','${sourceId}',content_valid_until FROM content_intake.store_set_members WHERE source_id='source-a'`);
          }
          await admin.query("INSERT INTO content_intake.vocabulary VALUES('product-query-image','scope-query-b','product',$1,true)", [digest('product-query-image')]);
          await admin.query("INSERT INTO content_intake.vocabulary_displays VALUES('product-query-image',1,'合成图片适用商品')");
          await admin.query('COMMIT');
        } catch (error) { await admin.query('ROLLBACK'); throw error; }
      } });
    console.info(`SOP_QUERY_EVIDENCE=${evidenceRoot}`);
  }, 120_000);
  afterAll(async () => {
    writeFileSync(path.join(evidenceRoot, 'http-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    await host?.close();
  });
  async function publish(sourceId: string, base: string, revision = 1, effectiveTo?: string) {
    const form = new FormData(); form.set('operationId', operation('upload'));
    form.set('file', new Blob([new Uint8Array(await syntheticTaskGraphWorkbook({ shopWide: true, revision, queryBudgetProbe: sourceId === 'source-query-large', sharedTaskImage: sourceId === 'source-a', narrowKnowledgeImage: sourceId === 'source-query-b', ...(effectiveTo ? { effectiveTo } : {}) }))], { type: mime }), 'synthetic-query.xlsx');
    const object = await checked(await request('enabler', `/v1/intake/sources/${sourceId}/objects`, { method: 'POST', body: form }), 'IntakeObject');
    let job = await checked(await post('enabler', `/v1/intake/sources/${sourceId}/candidates`, {
      operationId: operation('receive'), objectId: object.objectId, sourceVersion: sourceId === 'source-a' ? 2 : 1, baseReleaseId: base,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['enabler'], confirmed: true }, expectedPriorKey: null,
    }), 'IntakeParseJob');
    const deadline = Date.now() + 25_000;
    while (job.state === 'reading' || job.state === 'parsing') {
      if (Date.now() >= deadline) throw new Error('Synthetic query graph parser did not settle');
      await new Promise(resolve => setTimeout(resolve, 20));
      job = await checked(await request('enabler', `/v1/intake/parse-jobs/${job.jobId}`), 'IntakeParseJob');
    }
    expect(job.state).toBe('validated');
    const candidate = await checked(await request('enabler', `/v1/intake/candidates/${job.candidateId}/versions/${job.candidateVersion}`), 'IntakeCandidate');
    const key = candidate.key, pages: C['IntakeCandidatePage'][] = [];
    let cursor: string | null = null;
    do {
      const page: C['IntakeCandidatePage'] = await checked(await request('enabler', `${candidatePath(key)}/material?limit=1${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeCandidatePage');
      pages.push(page); cursor = page.nextCursor;
    } while (cursor);
    const material = parse('IntakeMaterial', { ...pages[0]!.materialHeader, entries: pages.flatMap(page => page.entries),
      differences: pages.flatMap(page => page.differences), sopFlows: pages.flatMap(page => page.sopFlows ?? []),
      sopDifferences: pages.flatMap(page => page.sopDifferences ?? []) });
    if (material.canonicalEncodingVersion !== 'candidate-sop-task-graph-v2' || !material.sopFlows || !material.sopDifferences || !material.mappingDigest) throw new Error('Missing frozen graph material');
    const graphMaterial: GraphMaterial = { ...material, canonicalEncodingVersion: 'candidate-sop-task-graph-v2',
      sopFlows: material.sopFlows, sopDifferences: material.sopDifferences, mappingDigest: material.mappingDigest };
    const graph = graphFor(graphMaterial, graphMaterial.sopFlows[0]!);
    const confirmed = await checked(await post('enabler', `${candidatePath(key)}/source-confirmation`, {
      operationId: operation('confirm'), key, expectedEvidenceVersion: 0, confirmedVersionKind: 'opaque',
      confirmedVersionValue: `synthetic-query-source-${revision}`, acquisition: 'controlled-synthetic-export',
      objectSha256: object.sha256, reason: '合成来源版本与原文件已显式核对',
    }), 'IntakeCandidate');
    await checked(await post('reviewer', `${candidatePath(key)}/quality/freeze`, { operationId: operation('freeze'), key }), 'IntakeQualityReceipt');
    const qualityStatus = await checked(await request('reviewer', `${candidatePath(key)}/quality?digest=${key.digest}`), 'IntakeQualityStatus');
    const faq: C['IntakeQualitySample'][] = [], sop: C['IntakeSopSopQualitySample'][] = [];
    cursor = null;
    do {
      const page: C['IntakeQualitySamplePage'] = await checked(await request('reviewer', `${candidatePath(key)}/quality/samples?digest=${key.digest}&viewHash=${qualityStatus.viewHash}&phase=initial&limit=1${cursor ? `&cursor=${cursor}` : ''}`), 'IntakeQualitySamplePage');
      faq.push(...page.items); sop.push(...page.sopItems ?? []); cursor = page.nextCursor;
    } while (cursor);
    const quality = await checked(await post('reviewer', `${candidatePath(key)}/quality/checks`, { operationId: operation('check'), key,
      phase: 'initial', materialDigest: key.digest, checks: faq.map(item => ({ scriptId: item.scriptId, contentHash: item.contentHash, defect: false, reason: '' })),
      sopChecks: sop.map(item => ({ ...item.target, defect: false, reason: '' })) }), 'IntakeQualityReceipt');
    expect(quality.state).toBe('passed');
    const receipt = await checked(await post('director', `${candidatePath(key)}/publish`, { operationId: operation('publish'), key,
      baseReleaseId: base, sourceEvidenceVersion: confirmed.sourceEvidenceVersion, title: '合成查询图发布', summary: '完整正常HTTP写链', confirmed: true }), 'IntakeReceipt');
    return { key, graph, releaseId: receipt.releaseId! };
  }
  async function facts(input: Awaited<ReturnType<typeof publish>>, group: UnifiedSopQueryRequest['sop_group'],
    risk: 'low' | 'unclassified' = 'low', copy: boolean | null = true, expectedVersion = 0, loseCommit = false) {
    const ref = `synthetic:query-${input.graph.definition.header.key.sourceId}-${input.key.candidateId}`, version = String(expectedVersion + 1);
    const document = { candidateId: input.key.candidateId, candidateVersion: input.key.version,
      sourceId: input.graph.definition.header.key.sourceId, flowId: input.graph.definition.header.key.flowId,
      graphDigest: sopGraphDigest(input.graph), sopGroup: group,
      permissions: input.graph.entries.map(dep => ({ entry: { sourceId: dep.sourceId, businessEntryId: dep.entry.businessEntryId, scriptVersion: dep.entry.scriptVersion },
        risk_level: risk, copy_allowed: copy, source_ref: `${ref}@${version}#${dep.entry.businessEntryId}` })) };
    const source = { ref, version, bytes: Buffer.from(JSON.stringify(document)) };
    writeFileSync(path.join(evidenceRoot, `${operation('facts')}.json`), source.bytes);
    const command = { operationId: operation('register'), expectedVersion, source };
    if (loseCommit) arm = 'facts';
    const result = await host.writeSopQueryFacts('enabler', command);
    if (loseCommit) {
      expect(result).toMatchObject({ ok: false, reason: 'COMMIT_UNKNOWN', commit: 'unknown' });
      expect(await host.writeSopQueryFacts('enabler', command)).toEqual({ ok: true, value: expectedVersion + 1 });
    } else expect(result, JSON.stringify(result)).toEqual({ ok: true, value: expectedVersion + 1 });
    return command;
  }
  const query = (overrides: Partial<UnifiedSopQueryRequest> = {}): UnifiedSopQueryRequest => ({ sop_group: '税收相关规则', shop_id: 'shop-a',
    query_text: '合成入口', context_generation: 'explicit-synthetic-generation', request_id: randomUUID(), ...overrides });
  const readQuery = async (body: UnifiedSopQueryRequest) => {
    const response = await post('agent', '/v1/sop/query', body);
    const raw: unknown = await response.json();
    expect(response.status, `${JSON.stringify(raw)}\n${diagnostics.slice(-3).join('\n')}`).toBe(200);
    expect(response.headers.get('x-intake-contract-set')).toBe(SOP_UNIFIED_QUERY_CONTRACT_SET_ID);
    const parsed = parseUnifiedSopQueryResponse(raw, body.request_id);
    writeFileSync(path.join(evidenceRoot, `${body.request_id}.json`), JSON.stringify(parsed));
    return parsed;
  };
  let first: Awaited<ReturnType<typeof publish>>, second: Awaited<ReturnType<typeof publish>>, currentRelease: string;
  it('publishes normally and returns the complete graph, exact permissions and three media owners', async () => {
    first = await publish('source-a', 'rel_native_base'); currentRelease = first.releaseId;
    await facts(first, '税收相关规则');
    const response = await readQuery(query());
    expect(response.status).toBe('ready');
    if (response.status !== 'ready') throw new Error('Expected ready');
    expect(response.result.graph_digest).toBe(sopGraphDigest(first.graph));
    expect(response.result.entries).toHaveLength(2); expect(response.result.permissions).toHaveLength(2);
    expect(response.result.media).toHaveLength(4);
    expect(new Set(response.result.media.map(item => item.preview_handle)).size).toBe(4);
    const shared = response.result.media.filter(item => item.binding.resourceId === 'image-task');
    expect(shared).toHaveLength(2); expect(shared[0]!.binding.objectId).toBe(shared[1]!.binding.objectId);
    expect(shared[0]!.preview_handle).not.toBe(shared[1]!.preview_handle);
    const wire = JSON.stringify(response);
    for (const privateValue of ['obj_', 'http://', 'https://', 'content_intake', 'sop_query_fact_versions',
      'sourceClaim', 'fileSha256', 'sessionTokenHash', 'authorization', 'access_token']) expect(wire).not.toContain(privateValue);
    expect(response.result.permissions.every(item => item.source_ref.startsWith('synthetic:'))).toBe(true);
  }, 60_000);
  it('preserves a PostgreSQL source-set instant when fresh principal facts share its millisecond', async () => {
    refreshAtSourceStamp = true;
    expect((await readQuery(query())).status).toBe('ready');
    expect(refreshAtSourceStamp).toBe(false);
    expect(observedSourceStamp).toMatch(/\.\d{3}5(?:00)?[+-]/);
    writeFileSync(path.join(evidenceRoot, 'source-stamp-precision.json'), JSON.stringify({ observedSourceStamp,
      expected: 'exact PostgreSQL instant retained across authorization_sources', status: 'PASS' }));
  });
  it('authenticates before negotiation and rejects malformed, duplicated or cross-view headers and body authority', async () => {
    const count = (await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_query_leases')).rows[0].count;
    const unauthenticated = await fetch(`${host.apiOrigin}/v1/sop/query`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-intake-contract-set': 'bad' }, body: JSON.stringify({ userId: 'director' }) });
    expect(unauthenticated.status).toBe(401);
    for (const header of [undefined, '', 'bad', 'cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b',
      'cs-ai-c11-openapi-1.29.0-schema-1.33-33fc543523b9']) {
      const response = await host.requestAs('agent', '/v1/sop/query', { method: 'POST',
        headers: { 'content-type': 'application/json', ...(header === undefined ? {} : { 'x-intake-contract-set': header }) }, body: JSON.stringify(query()) });
      expect(response.status).toBe(409);
      expect(parse('MenokinSopQuerySopErrorEnvelope', await response.json()).code).toBe('CONTRACT_UPGRADE_REQUIRED');
    }
    const body = JSON.stringify(query());
    const duplicate = await new Promise<number>((resolve, reject) => {
      const outgoing = rawHttpRequest(`${host.apiOrigin}/v1/sop/query`, { method: 'POST', headers: [
        'Host', new URL(host.apiOrigin).host, 'Authorization', agentAuthorization ?? '',
        'Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(body)),
        'X-Intake-Contract-Set', SOP_UNIFIED_QUERY_CONTRACT_SET_ID, 'X-Intake-Contract-Set', SOP_UNIFIED_QUERY_CONTRACT_SET_ID,
      ] }, incoming => { incoming.resume(); incoming.on('end', () => resolve(incoming.statusCode ?? 500)); });
      outgoing.on('error', reject); outgoing.end(body);
    });
    expect(duplicate).toBe(409);
    for (const key of ['userId', 'token', 'scope', 'principal_id', 'entitlementId']) {
      expect((await post('agent', '/v1/sop/query', { ...query(), [key]: 'forged' })).status).toBe(400);
    }
    expect((await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_query_leases')).rows[0].count).toBe(count);
  });
  it('rejects unrepresentable Unicode before persistence and accepts normal Chinese and emoji', async () => {
    const before = (await admin.query(`SELECT
      (SELECT count(*)::int FROM content_intake.sop_query_leases) AS leases,
      (SELECT count(*)::int FROM content_intake.entitlements) AS entitlements`)).rows[0];
    for (const text of ['合成\u0000', '合成\ud800', '合成\udfff']) {
      for (const overrides of [
        { query_text: text },
        { context_generation: text },
        { product_context: { type: 'sku', ref: text } },
      ] satisfies Partial<UnifiedSopQueryRequest>[]) {
        const response = await post('agent', '/v1/sop/query', query(overrides));
        expect(response.status).toBe(400);
        expect(parse('MenokinSopQuerySopErrorEnvelope', await response.json()).code).toBe('CONTRACT_UPGRADE_REQUIRED');
      }
    }
    expect((await admin.query(`SELECT
      (SELECT count(*)::int FROM content_intake.sop_query_leases) AS leases,
      (SELECT count(*)::int FROM content_intake.entitlements) AS entitlements`)).rows[0]).toEqual(before);
    expect((await readQuery(query({ query_text: '合成入口😀', context_generation: '中文代际😀' }))).status).toBe('ready');
  });

  it('denies unregistered product references across the complete transport boundary without issuing a lease', async () => {
    const references = ['not-a-vocabulary-item', 'x'.repeat(128), 'x'.repeat(129), 'x'.repeat(256), '../unregistered'];
    const before = (await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_query_leases')).rows[0].count;
    const observed: Array<{ length: number; status: number; code: string }> = [];
    for (const ref of references) {
      const body = parse('MenokinSopQuerySopQueryRequest', query({ product_context: { type: 'sku', ref } }));
      const response = await post('agent', '/v1/sop/query', body);
      const error = parse('MenokinSopQuerySopErrorEnvelope', await response.json());
      observed.push({ length: ref.length, status: response.status, code: error.code });
    }
    writeFileSync(path.join(evidenceRoot, 'unregistered-product-context.json'), JSON.stringify(observed));
    expect(observed).toEqual(references.map(ref => ({ length: ref.length, status: 403, code: 'SCOPE_DENIED' })));
    expect((await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_query_leases')).rows[0].count).toBe(before);
  });
  it('recovers the same immutable result and rejects the same request ID with a different body', async () => {
    const body = query(); const initial = await readQuery(body);
    expect(await readQuery(body)).toEqual(initial);
    const upper = await post('agent', '/v1/sop/query', { ...body, request_id: body.request_id.toUpperCase() });
    expect(upper.status).toBe(409);
    const conflict = await post('agent', '/v1/sop/query', { ...body, query_text: 'different' });
    expect(conflict.status).toBe(409); expect(parse('MenokinSopQuerySopErrorEnvelope', await conflict.json()).code).toBe('IDEMPOTENCY_CONFLICT');
    const unmatched = query({ query_text: '未出现的合成词项', context_generation: 'opaque-z' });
    const terminal = await readQuery(unmatched);
    expect(terminal.status).toBe('no_match');
    expect(await readQuery(unmatched)).toEqual(terminal);
    expect((await post('agent', '/v1/sop/query', { ...unmatched, context_generation: 'opaque-a' })).status).toBe(409);
    expect((await readQuery(query({ context_generation: 'opaque-a' }))).status).toBe('ready');
  });
  it('keeps a known different group with unclassified risk or unknown copy permission local to its candidate', async () => {
    const other = await publish('source-query-b', currentRelease); second = other; currentRelease = other.releaseId;
    const registration = await facts(other, '品质售后SOP', 'unclassified');
    expect(await host.writeSopQueryFacts('enabler', registration)).toEqual({ ok: true, value: 1 });
    expect((await readQuery(query())).status).toBe('ready');
    const blockedRequest = query({ sop_group: '品质售后SOP' });
    const blocked = await readQuery(blockedRequest);
    expect(await readQuery(blockedRequest)).toEqual(blocked);
    expect((await post('agent', '/v1/sop/query', { ...blockedRequest, query_text: 'changed' })).status).toBe(409);
    expect(blocked.status).toBe('blocked'); expect(blocked.reasons).toEqual([{ code: 'SAFETY_REVIEW_REQUIRED' }]);
    await facts(other, '品质售后SOP', 'low', null, 1);
    expect((await readQuery(query())).status).toBe('ready');
    expect((await readQuery(query({ sop_group: '品质售后SOP' }))).status).toBe('blocked');
  }, 60_000);
  it('recovers a facts commit response loss and serializes concurrent CAS writers', async () => {
    const committed = await facts(second, '品质售后SOP', 'low', true, 2, true);
    const pinnedRequest = query({ sop_group: '品质售后SOP' });
    const pinnedResponse = await readQuery(pinnedRequest);
    expect(pinnedResponse.status).toBe('ready');
    const parsed = parseSyntheticSopQueryFacts(committed.source);
    const commands = ['a', 'b'].map(suffix => {
      const version = `4-${suffix}`;
      const document = { ...parsed.document, permissions: parsed.document.permissions.map(permission => ({ ...permission,
        source_ref: `${committed.source.ref}@${version}#${permission.entry.businessEntryId}` })) };
      return { operationId: operation('cas'), expectedVersion: 3,
        source: { ref: committed.source.ref, version, bytes: Buffer.from(JSON.stringify(document)) } };
    });
    const results = await Promise.all(commands.map(command => host.writeSopQueryFacts('enabler', command)));
    expect(results.filter(result => result.ok)).toEqual([{ ok: true, value: 4 }]);
    expect(results.filter(result => !result.ok)).toEqual([expect.objectContaining({ reason: 'MATERIAL_CHANGED' })]);
    expect(await readQuery(pinnedRequest)).toEqual(pinnedResponse);
    const latest = await readQuery(query({ sop_group: '品质售后SOP' }));
    expect(latest.status).toBe('ready');
    if (latest.status !== 'ready' || pinnedResponse.status !== 'ready') throw new Error('Expected versioned facts');
    expect(latest.result.permissions).not.toEqual(pinnedResponse.result.permissions);
    const conflict = { ...committed, source: { ...committed.source, bytes: Buffer.from(JSON.stringify({ ...parsed.document, sopGroup: '长痘痘SOP' })) } };
    expect(await host.writeSopQueryFacts('enabler', conflict)).toMatchObject({ ok: false, reason: 'IDEMPOTENCY_CONFLICT' });
    expect((await admin.query('SELECT max(facts_version)::int AS version,count(*)::int AS count FROM content_intake.sop_query_fact_versions WHERE candidate_id=$1', [second.key.candidateId])).rows[0])
      .toEqual({ version: 4, count: 4 });
  });
  it('projects only applicable child media for shop-only selection while preserving the original graph digest', async () => {
    const object = (await admin.query<{ payload_object_id: string }>(`SELECT object.payload_object_id
      FROM content_intake.sop_graph_release_media media
      JOIN content_intake.sop_media_objects object ON object.media_object_id=media.object_id
      WHERE media.release_id=$1 AND media.source_id='source-query-b' AND media.resource_id='image-knowledge'`, [currentRelease])).rows[0]!;
    const file = path.join(host.root, 'objects', 'objects', object.payload_object_id), saved = `${file}.synthetic-unselected`;
    renameSync(file, saved);
    try {
      const response = await readQuery(query({ sop_group: '品质售后SOP' }));
      expect(response.status).toBe('ready');
      if (response.status !== 'ready') throw new Error('Expected ready for the authorized subset');
      expect(response.result.graph_digest).toBe(sopGraphDigest(second.graph));
      expect(second.graph.media).toHaveLength(3);
      expect(response.result.media).toHaveLength(2);
      expect(JSON.stringify(response)).not.toContain('image-knowledge');
    } finally { renameSync(saved, file); }
  });
  it('rolls back before commit and recovers a committed query with the original lease and handles', async () => {
    for (const failure of ['query-before', 'query'] as const) {
      const body = query(); arm = failure;
      expect((await post('agent', '/v1/sop/query', body)).status).toBe(503);
      const before = (await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_query_leases WHERE request_id=$1', [body.request_id])).rows[0].count;
      expect(before).toBe(failure === 'query-before' ? 0 : 1);
      const recovered = await readQuery(body);
      expect(recovered.status).toBe('ready'); expect(await readQuery(body)).toEqual(recovered);
      expect((await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_query_leases WHERE request_id=$1', [body.request_id])).rows[0].count).toBe(1);
    }
  });
  it('serializes concurrent equal bodies and rejects concurrent different bodies under one request ID', async () => {
    const body = query(); const values = await Promise.all([readQuery(body), readQuery(body)]);
    expect(values[1]).toEqual(values[0]);
    const different = query();
    const responses = await Promise.all([post('agent', '/v1/sop/query', different), post('agent', '/v1/sop/query', { ...different, query_text: '合成入口，另一个请求正文' })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_query_leases WHERE request_id=$1', [different.request_id])).rows[0].count).toBe(1);
  });
  it('rejects corrupted PostgreSQL graph digests and unsafe allergy instructions before disclosure', async () => {
    corruptRead = 'digest';
    expect((await readQuery(query())).reasons).toEqual([{ code: 'GRAPH_UNRESOLVED' }]);
    corruptRead = 'allergy';
    expect((await readQuery(query())).reasons).toEqual([{ code: 'SAFETY_REVIEW_REQUIRED' }]);
    expect((await readQuery(query())).status).toBe('ready');
  });
  it('blocks required applicable media when the real payload is missing or has the wrong digest', async () => {
    const object = (await admin.query<{ payload_object_id: string }>(`SELECT object.payload_object_id FROM content_intake.sop_graph_release_media media
      JOIN content_intake.sop_media_objects object ON object.media_object_id=media.object_id
      WHERE media.release_id=$1 AND media.source_id='source-a' LIMIT 1`, [currentRelease])).rows[0]!;
    const file = path.join(host.root, 'objects', 'objects', object.payload_object_id), saved = `${file}.synthetic-missing`;
    renameSync(file, saved);
    try { expect((await readQuery(query())).reasons).toEqual([{ code: 'MEDIA_UNVERIFIED' }]); }
    finally { renameSync(saved, file); }
    const original = readFileSync(file);
    try {
      const corrupt = Buffer.from(original); corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 1;
      writeFileSync(file, corrupt);
      expect((await readQuery(query())).reasons).toEqual([{ code: 'MEDIA_UNVERIFIED' }]);
    } finally { writeFileSync(file, original); }
    expect((await readQuery(query())).status).toBe('ready');
  });
  it('restores nonempty query facts, leases, preview bindings and receipts and consumes the same HTTP request', async () => {
    const body = query(), response = await readQuery(body);
    expect(response.status).toBe('ready');
    const config = (await admin.query<{ host: string; port: number; user: string; database: string }>(`SELECT current_database() AS database,current_user AS user,
      current_setting('unix_socket_directories') AS host,current_setting('port')::int AS port`)).rows[0]!;
    const context = (await admin.query<{ entitlement_hash: string }>(`SELECT binding.entitlement_hash FROM content_intake.sop_unified_query_bindings binding
      JOIN content_intake.sop_query_leases lease USING(lease_id) WHERE lease.request_id=$1`, [body.request_id])).rows[0]!;
    const graphs = (await admin.query<{ graph_digest: string }>('SELECT graph_digest FROM content_intake.sop_graph_release_lineage WHERE release_id=$1 ORDER BY source_id COLLATE "C",flow_id COLLATE "C"', [currentRelease])).rows;
    const images = (await admin.query<{ sha256: string; payload_object_id: string }>(`SELECT DISTINCT object.payload_object_id,object.sha256
      FROM content_intake.sop_graph_release_media media JOIN content_intake.sop_media_objects object ON object.media_object_id=media.object_id WHERE media.release_id=$1`, [currentRelease])).rows;
    const input = path.join(host.root, 'query-backup-input.json');
    writeFileSync(input, JSON.stringify({ root: host.root, ...config, agentAuthorization, evidenceRoot,
      entitlementHash: context.entitlement_hash, graphDigests: graphs.map(item => item.graph_digest), imageSha256: images.map(item => item.sha256),
      releaseId: currentRelease, query: { request: body, response } }), { mode: 0o600 });
    const restored = spawnSync(process.execPath, ['tests/support/sop-graph-backup.mjs', input], {
      cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
    const output = `${restored.stdout ?? ''}\n${restored.stderr ?? ''}`;
    writeFileSync(path.join(evidenceRoot, 'query-backup.log'), output);
    if (restored.error) throw restored.error;
    expect(restored.status, output).toBe(0); expect(output).toContain('NONEMPTY_GRAPH_RESTORE_PASS');
  }, 180_000);
  it('returns stale for a previous query lease after a normal publication change', async () => {
    const previous = query(); expect((await readQuery(previous)).status).toBe('ready');
    const replacement = await publish('source-a', currentRelease, 2); currentRelease = replacement.releaseId;
    await facts(replacement, '税收相关规则');
    expect((await readQuery(previous)).status).toBe('stale');
    expect((await readQuery(query())).status).toBe('ready');
  }, 60_000);
  it('rejects a normal published complete response whose actual UTF-8 JSON exceeds 1 MiB', async () => {
    const large = await publish('source-query-large', currentRelease); currentRelease = large.releaseId;
    await facts(large, '少错破SOP');
    const represented = { status: 'ready', request_id: randomUUID(), release_id: currentRelease,
      lease_expires_at: new Date(Date.now() + 240_000).toISOString(), reasons: [],
      result: { flow: large.graph.definition, graph_digest: sopGraphDigest(large.graph), entries: large.graph.entries,
        media: [], permissions: [] } };
    expect(Buffer.byteLength(JSON.stringify(represented))).toBeGreaterThan(1_048_576);
    const blocked = await readQuery(query({ sop_group: '少错破SOP' }));
    expect(blocked.status).toBe('blocked'); expect(blocked.result).toBeNull();
    expect((await readQuery(query())).status).toBe('ready');
  }, 60_000);
  it('expires a real server-owned query lease at the published flow deadline', async () => {
    const expires = new Date(Date.now() + 7000).toISOString();
    const short = await publish('source-query-short', currentRelease, 1, expires); currentRelease = short.releaseId;
    await facts(short, '长痘痘SOP');
    const body = query({ sop_group: '长痘痘SOP' });
    const ready = await readQuery(body); expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw new Error('Expected bounded query');
    expect(Date.parse(ready.lease_expires_at)).toBeLessThanOrEqual(Date.parse(expires));
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(expires) - Date.now() + 40)));
    const expired = await readQuery(body);
    expect(expired.status).toBe('stale'); expect(expired.reasons).toEqual([{ code: 'LEASE_EXPIRED' }]);
  }, 30_000);
  it('keeps original publication provenance after a new source mapping is registered', async () => {
    const original = parseSopQueryPublicationFacts((await admin.query<{ value: unknown }>(
      'SELECT content_intake.sop_query_publication_facts($1,$2,$3,$4,$5) AS value',
      [first.key.candidateId, first.key.version, 'source-a', 'flow-main', sopGraphDigest(first.graph)])).rows[0]!.value);
    await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
      SELECT source_id,3,template_version,rule_version,mapping_version,structure_digest,
      jsonb_set(graph_mapping,'{riskLevel}','"critical"'::jsonb) FROM content_intake.source_mappings WHERE source_id='source-a' AND version=2`);
    await admin.query("UPDATE content_intake.sources SET current_mapping_version=3 WHERE source_id='source-a'");
    await facts(first, '税收相关规则', 'low', true, 1);
    const retained = parseSopQueryPublicationFacts((await admin.query<{ publication_facts: unknown }>(
      'SELECT publication_facts FROM content_intake.sop_query_fact_versions WHERE candidate_id=$1 AND facts_version=2', [first.key.candidateId])).rows[0]!.publication_facts);
    expect(retained).toEqual(original);
    expect(retained.sourceVersion).toBe(2); expect(retained.risk.level).toBe('routine');
    const staleSource = await post('agent', '/v1/sop/query', query());
    expect(staleSource.ok).toBe(false);
    expect(JSON.stringify(await staleSource.json())).not.toMatch(/answerText|preview_handle|graph_digest/);
  });
  it('fails closed for foreign shop, unknown body authority and a revoked parent grant', async () => {
    expect((await post('agent', '/v1/sop/query', query({ shop_id: 'shop-b' }))).status).toBe(403);
    expect((await post('agent', '/v1/sop/query', query({ product_context: { type: 'sku', ref: 'not-a-vocabulary-item' } }))).status).toBe(403);
    expect((await post('agent', '/v1/sop/query', { ...query(), userId: 'director' })).status).toBe(400);
    await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成父授权撤销' WHERE kind='allocation' AND action='query' AND parent_grant_id IS NULL AND scope_id IN ('scope-a','scope-query-b')");
    expect((await post('agent', '/v1/sop/query', query())).status).toBe(403);
    expect((await admin.query("SELECT count(*)::int AS count FROM content_intake.grants WHERE kind='business' AND action='query' AND recipient_id='agent' AND revoked_at IS NOT NULL")).rows[0].count).toBe(0);
  });
});
