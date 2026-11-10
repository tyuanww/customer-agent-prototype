import { verifyDatabaseMigrations } from '@customer-agent/database';
import { request as rawRequest } from 'node:http';
import { parseContractSchema as parseAuth } from '@customer-agent/contracts';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseContractSchema as parse, type ContractSchemaName, type components } from '@customer-agent/contracts/sop-unified';
import { SOP_TASK_FORMAT, SOP_TASK_STRUCTURE_SHA256 } from '@customer-agent/content-intake';
import { syntheticGraphMapping, syntheticTaskGraphWorkbook } from '../../../packages/content-intake/tests/support/sop-task-graph-workbook.js';
import { createIntakeSyntheticHost, type IntakeSyntheticHost, type DesktopSyntheticIdentity } from './support/intake-synthetic-host.js';
import { graphFor, type GraphMaterial } from '../src/content-intake/sop-graph.js';
import { sopGraphDigest } from '../src/sop-unified-query-validation.js';
import { SOP_UNIFIED_QUERY_CONTRACT_SET_ID, type UnifiedSopQueryRequest } from '../src/sop-unified-query-model.js';
import type { IntakePool } from '../src/content-intake/transaction.js';
import { digest } from '../src/content-intake/material.js';

type C = components['schemas'];
const enabled = process.env.CUSTOMER_AGENT_API_SOP_CONTINUATION_PG15_INTEGRATION === '1';
const evidenceRoot = path.join(os.tmpdir(), `sop-unified-continuation-http-${randomUUID()}`);
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
describe.skipIf(!enabled).sequential('normal 87 continuation through real HTTP, PostgreSQL and objects', () => {
  let host: Pick<IntakeSyntheticHost, 'requestAs' | 'writeSopQueryFacts' | 'close' | 'root' | 'apiOrigin' | 'identityOrigin' | 'selectIdentity'>, admin: Client;
  let sequence = 0;
  let arm: 'facts' | 'open' | 'close' | 'renew' | 'media' | null = null;
  let r1: Awaited<ReturnType<typeof publish>>;
  let pinned: Awaited<ReturnType<typeof openCurrent>>;
  let r2: Awaited<ReturnType<typeof publish>>, r3: string;
  let agentAuthorization: string | null = null;
  let closedContinuation: string;
  let replacementAuthorization: string | null = null;
  const diagnostics: string[] = [];
  let protectedQueries = 0;
  let afterObjectRead: (() => Promise<void>) | null = null;
  let mediaCommitReads = 0;
  const operation = (label: string) => `continuation-${label}-${++sequence}`;
  const candidatePath = (key: C['IntakeCandidateKey']) => `/v1/intake/candidates/${key.candidateId}/versions/${key.version}`;
  const request = (actor: DesktopSyntheticIdentity, pathname: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.set('x-intake-contract-set', SOP_UNIFIED_QUERY_CONTRACT_SET_ID);
    if (actor === 'agent' && replacementAuthorization) {
      headers.set('authorization', replacementAuthorization); agentAuthorization = replacementAuthorization;
      return fetch(`${host.apiOrigin}${pathname}`, { ...init, headers });
    }
    return host.requestAs(actor, pathname, { ...init, headers });
  };
  const post = (actor: DesktopSyntheticIdentity, pathname: string, body: unknown) => request(actor, pathname,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  async function checked<Name extends ContractSchemaName>(response: Response, name: Name): Promise<C[Name]> {
    const body: unknown = await response.json();
    expect(response.ok, `${response.status} ${JSON.stringify(body)}\n${diagnostics.slice(-3).join('\n')}`).toBe(true);
    expect(response.headers.get('cache-control')).toContain('no-store');
    return parse(name, body);
  }
  function uncertain(pool: IntakePool): IntakePool {
    return { connect: async () => {
      const client = await pool.connect(); let lose = false;
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          if (/content_intake\.(prepare_sop_action|read_sop_action_bundle|open_sop_active_use|issue_sop_continuation_lease|read_sop_continuation_media)\(/.test(sql)) protectedQueries++;
          const result = await target.query(sql, values);
          if (arm === 'facts' && sql.startsWith('SELECT to_jsonb(content_intake.write_sop_query_facts')) lose = true;
          if (arm === 'open' && sql.startsWith('SELECT content_intake.open_sop_active_use')) lose = true;
          if (arm === 'close' && sql.startsWith('SELECT content_intake.close_sop_active_use')) lose = true;
          if (arm === 'renew' && sql.startsWith('SELECT content_intake.issue_sop_continuation_lease')) lose = true;
          if (arm === 'media' && sql.startsWith('SELECT content_intake.read_sop_continuation_media') && ++mediaCommitReads === 2) lose = true;
          if (sql === 'COMMIT' && lose) { arm = null; throw new Error('SYNTHETIC_RESPONSE_LOST_AFTER_REAL_COMMIT'); }
          return result;
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
  }
  beforeAll(async () => {
    mkdirSync(evidenceRoot, { mode: 0o700 });
    host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime', includeSopQuery: true,
      includeSopContinuation: true, afterSopAttachmentRead: async () => { const action = afterObjectRead; afterObjectRead = null; await action?.(); }, includeLegacySearch: false, wrapBusinessPool: uncertain, wrapUsagePool: uncertain,
      observeSyntheticRequest: (actor, headers) => { if (actor === 'agent') agentAuthorization = headers.get('authorization'); },
      observeError: error => diagnostics.push(error instanceof Error ? `${error.stack}\n${JSON.stringify(error, ['code','detail','where'])}` : String(error)),
      configureDatabase: async client => {
        admin = client;
        await admin.query('BEGIN');
        try {
        await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
          VALUES('source-a',2,$1,$2,$3,$4,$5::jsonb)`, [SOP_TASK_FORMAT.templateVersion, SOP_TASK_FORMAT.ruleVersion,
          SOP_TASK_FORMAT.mappingVersion, SOP_TASK_STRUCTURE_SHA256, JSON.stringify(syntheticGraphMapping(false, true))]);
        await admin.query("UPDATE content_intake.sources SET current_mapping_version=2 WHERE source_id='source-a'");
        await admin.query(`INSERT INTO content_intake.scopes SELECT (jsonb_populate_record(NULL::content_intake.scopes,
          to_jsonb(scope)||jsonb_build_object('scope_id','scope-solo','domain','sop'))).* FROM content_intake.scopes scope WHERE scope_id='scope-a'`);
        await admin.query("INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES('source-solo','scope-solo',1,'v2-preview')");
        await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
          VALUES('source-solo',1,$1,$2,$3,$4,$5::jsonb)`, [SOP_TASK_FORMAT.templateVersion, SOP_TASK_FORMAT.ruleVersion,
          SOP_TASK_FORMAT.mappingVersion, SOP_TASK_STRUCTURE_SHA256, JSON.stringify(syntheticGraphMapping(true, true))]);
        await admin.query(`INSERT INTO content_intake.grants SELECT (jsonb_populate_record(NULL::content_intake.grants,
          to_jsonb(grant_row)||jsonb_build_object('grant_id',grant_id||'-solo','scope_id','scope-solo',
          'source_id',CASE WHEN source_id IS NULL THEN NULL ELSE 'source-solo' END,
          'parent_grant_id',CASE WHEN parent_grant_id IS NULL THEN NULL ELSE parent_grant_id||'-solo' END))).*
          FROM content_intake.grants grant_row WHERE scope_id='scope-a'
          ORDER BY CASE kind WHEN 'allocation' THEN 0 WHEN 'delegation' THEN 1 ELSE 2 END`);
        await admin.query(`INSERT INTO content_intake.store_set_members(tenant_id,app_id,version,scope_id,source_id,content_valid_until)
          SELECT tenant_id,app_id,version,'scope-solo','source-solo',content_valid_until FROM content_intake.store_set_members WHERE source_id='source-a'`);
        await admin.query('COMMIT');
        } catch (error) { await admin.query('ROLLBACK'); throw error; }
      } });
    console.info(`SOP_CONTINUATION_EVIDENCE=${evidenceRoot}`);
    expect((await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_graph_versions')).rows[0].count).toBe(0);
  }, 120_000);
  afterAll(async () => {
    writeFileSync(path.join(evidenceRoot, 'http-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    await host?.close();
  });

  function rawAgent(pathname: string, body: unknown, contractHeaders: string[], authorization = agentAuthorization): Promise<Response> {
    if (!authorization) throw new Error('Synthetic session missing');
    const bytes = Buffer.from(JSON.stringify(body));
    const headers = ['Host', new URL(host.apiOrigin).host, 'Authorization', authorization,
      'Content-Type', 'application/json', 'Content-Length', String(bytes.length),
      ...contractHeaders.flatMap(value => ['X-Intake-Contract-Set', value])];
    return new Promise((resolve, reject) => {
      const req = rawRequest(`${host.apiOrigin}${pathname}`, { method: 'POST', headers }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => {
          const status = response.statusCode;
          if (status === undefined) return reject(new Error('Synthetic HTTP status missing'));
          resolve(new Response(Buffer.concat(chunks), { status, headers: { 'cache-control': String(response.headers['cache-control'] ?? '') } }));
        });
      });
      req.on('error', reject); req.end(bytes);
    });
  }

  async function freshAgentSession(): Promise<string> {
    host.selectIdentity('agent');
    const verifier = randomBytes(32).toString('base64url');
    const created = parseAuth('LoginCreated', await (await fetch(`${host.apiOrigin}/v1/auth/login-requests`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        client_challenge: createHash('sha256').update(verifier).digest('base64url'), challenge_method: 'S256' }) })).json());
    const redirected = await fetch(created.authorize_url, { redirect: 'manual' });
    expect(redirected.status).toBe(302);
    const location = redirected.headers.get('location');
    if (!location || !location.startsWith(`${host.apiOrigin}/v1/auth/callback?`)) throw new Error('Synthetic identity callback missing');
    expect((await fetch(location)).status).toBe(200);
    const session = parseAuth('LoginSession', await (await fetch(`${host.apiOrigin}/v1/auth/login-requests/${created.login_id}/exchange`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_verifier: verifier }) })).json());
    return `Bearer ${session.access_token}`;
  }

  async function denial(response: Response, status: number, reason?: string) {
    expect(response.status).toBe(status);
    const body = parse('IntakeError', await response.json());
    if (reason) expect(body.error.details.reason).toBe(reason);
    expect(JSON.stringify(body)).not.toMatch(/answerText|base64|payloadObjectId|graphDigest/);
  }

  async function currentOpening(contextGeneration = 1, group: UnifiedSopQueryRequest['sop_group'] = '税收相关规则') {
    const query = { sop_group: group, shop_id: 'shop-a', query_text: '合成入口',
      context_generation: `synthetic-D-${contextGeneration}`, request_id: randomUUID() };
    const ready = await checked(await post('agent', '/v1/sop/query', query), 'MenokinSopQuerySopQueryResponse');
    if (ready.status !== 'ready') throw new Error(`Normal C query did not return ready ${JSON.stringify(ready)}`);
    const entitlement = await checked(await post('agent', '/v1/intake/entitlements', { shopId: 'shop-a', contextGeneration,
      releaseId: null, productIds: [], scenarioIds: [] }), 'IntakeEntitlement');
    const opening: C['IntakeSopActionCheck'] = { entitlementId: entitlement.entitlementId, releaseId: entitlement.releaseId, contextGeneration,
      key: ready.result.flow.header.key, graphDigest: ready.result.graph_digest, nodeId: ready.result.flow.header.startNodeId,
      action: 'open', edgeId: null, entry: null, continuationId: `sct_${randomBytes(32).toString('hex')}` };
    return { opening, ready, query };
  }

  async function openCurrent(contextGeneration = 1, group: UnifiedSopQueryRequest['sop_group'] = '税收相关规则') {
    const { opening, ready } = await currentOpening(contextGeneration, group);
    const receipt = await checked(await post('agent', '/v1/intake/sop/check', opening), 'IntakeSopContinuationReceipt');
    return { opening, receipt, ready };
  }

  function mediaUrl(entitlementId: string, releaseId: string, binding: C['IntakeSopMedia']) {
    const ownerKind = binding.entry ? 'entry' : binding.graphTarget?.kind;
    const ownerId = binding.entry?.businessEntryId ?? binding.graphTarget?.id;
    if (!ownerKind || !ownerId) throw new Error('Missing canonical media owner');
    const query = new URLSearchParams({ entitlementId, sourceId: binding.flowKey.sourceId, flowId: binding.flowKey.flowId,
      ownerKind, ownerId, resourceId: binding.resourceId });
    return `/v1/intake/sop/releases/${releaseId}/media/${binding.objectId}?${query}`;
  }
  async function publish(sourceId: string, base: string, revision = 1, effectiveTo?: string, options: { solo?: boolean; disable?: boolean; sourceVersion?: number } = {}) {
    const form = new FormData(); form.set('operationId', operation('upload'));
    form.set('file', new Blob([new Uint8Array(await syntheticTaskGraphWorkbook({ ...options, shopWide: true, revision, queryBudgetProbe: sourceId === 'source-query-large', sharedTaskImage: sourceId === 'source-a', narrowKnowledgeImage: sourceId === 'source-query-b', ...(effectiveTo ? { effectiveTo } : {}) }))], { type: mime }), 'synthetic-query.xlsx');
    const object = await checked(await request('enabler', `/v1/intake/sources/${sourceId}/objects`, { method: 'POST', body: form }), 'IntakeObject');
    let job = await checked(await post('enabler', `/v1/intake/sources/${sourceId}/candidates`, {
      operationId: operation('receive'), objectId: object.objectId, sourceVersion: options.sourceVersion ?? (sourceId === 'source-a' ? 2 : 1), baseReleaseId: base,
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
    const flow = graphMaterial.sopFlows[0];
    const graph = flow ? graphFor(graphMaterial, flow) : null;
    if (!graph && !options.disable) throw new Error('Expected upsert graph in normal material');
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
    const graph = input.graph;
    if (!graph) throw new Error('Disabled material has no query graph to annotate');
    const ref = `synthetic:query-${graph.definition.header.key.sourceId}-${input.key.candidateId}`, version = String(expectedVersion + 1);
    const document = { candidateId: input.key.candidateId, candidateVersion: input.key.version,
      sourceId: graph.definition.header.key.sourceId, flowId: graph.definition.header.key.flowId,
      graphDigest: sopGraphDigest(graph), sopGroup: group,
      permissions: graph.entries.map(dep => ({ entry: { sourceId: dep.sourceId, businessEntryId: dep.entry.businessEntryId, scriptVersion: dep.entry.scriptVersion },
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

  it('publishes through B, queries through C, opens, checks, reads real graph bytes, renews and closes', async () => {
    const first = await publish('source-a', 'rel_native_base');
    r1 = first;
    await facts(first, '税收相关规则');
    const ready = await checked(await post('agent', '/v1/sop/query', { sop_group: '税收相关规则', shop_id: 'shop-a',
      query_text: '合成入口', context_generation: 'synthetic-D-context', request_id: randomUUID() }), 'MenokinSopQuerySopQueryResponse');
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw new Error('Normal C query did not return ready');
    const entitlement = await checked(await post('agent', '/v1/intake/entitlements', { shopId: 'shop-a', contextGeneration: 1,
      releaseId: null, productIds: [], scenarioIds: [] }), 'IntakeEntitlement');
    const continuationId = `sct_${randomBytes(32).toString('hex')}`;
    const opening = { entitlementId: entitlement.entitlementId, releaseId: first.releaseId, contextGeneration: 1,
      key: ready.result.flow.header.key, graphDigest: ready.result.graph_digest, nodeId: ready.result.flow.header.startNodeId,
      action: 'open', edgeId: null, entry: null, continuationId };
    const opened = await checked(await post('agent', '/v1/intake/sop/check', opening), 'IntakeSopContinuationReceipt');
    expect(opened.entitlement.releaseId).toBe(first.releaseId);
    const observed = await post('agent', '/v1/intake/sop/check', { ...opening, action: 'observe', entitlementId: opened.entitlement.entitlementId });
    expect(observed.status, await observed.text()).toBe(204);
    const renewed = await checked(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId, contextGeneration: 3 }), 'IntakeSopContinuationReceipt');
    expect(renewed.entitlement.contextGeneration).toBe(3);
    expect(renewed.entitlement.scopes).toEqual(opened.entitlement.scopes);
    closedContinuation = continuationId;
    const closed = await post('agent', '/v1/intake/sop/continuations/close', { continuationId });
    expect(closed.status, await closed.text()).toBe(204);
    const row = await admin.query('SELECT closed_at,session_hash,termination_reason FROM content_intake.sop_active_uses');
    expect(row.rows).toHaveLength(1); expect(row.rows[0].closed_at).not.toBeNull(); expect(row.rows[0].session_hash).toBeNull();
    expect(row.rows[0].termination_reason).toBe('finished');
    writeFileSync(path.join(evidenceRoot, 'normal-first-slice.json'), JSON.stringify({ release: first.releaseId,
      candidate: first.key, graphDigest: ready.result.graph_digest, returnedScopeCount: renewed.entitlement.scopes.length }));
  }, 120_000);

  it('checks legal actions and consumes every full media owner binding and C preview from real stored bytes', async () => {
    pinned = await openCurrent(5);
    const { opening, receipt, ready } = pinned;
    const action = { ...opening, entitlementId: receipt.entitlement.entitlementId };
    const scripted = ready.result.flow.nodes.find(node => node.body.scripts.length)!;
    expect(scripted).toBeTruthy();
    const copied = await post('agent', '/v1/intake/sop/check', { ...action, nodeId: scripted.id, action: 'copy', entry: scripted.body.scripts[0]!.entry });
    expect(copied.status, await copied.text()).toBe(204);
    for (const edge of ready.result.flow.edges) {
      const response = await post('agent', '/v1/intake/sop/check', { ...action, nodeId: edge.from,
        action: edge.action.kind === 'next' ? 'next' : 'choose', edgeId: edge.id });
      expect(response.status, await response.text()).toBe(204);
    }
    await denial(await post('agent', '/v1/intake/sop/check', { ...action, action: 'next', edgeId: 'synthetic-missing-edge' }), 422, 'SOP_GRAPH_INVALID');
    const owners = new Set<string>(), payloadIds = new Set<string>();
    for (const media of ready.result.media) {
      const binding = media.binding;
      owners.add(binding.entry ? 'entry' : binding.graphTarget!.kind);
      const response = await checked(await request('agent', mediaUrl(receipt.entitlement.entitlementId, opening.releaseId, binding), {
        headers: { 'X-Sop-Continuation': opening.continuationId } }), 'IntakeSopMediaPayload');
      const row = await admin.query('SELECT payload_object_id FROM content_intake.sop_media_objects WHERE media_object_id=$1', [binding.objectId]);
      const bytes = readFileSync(path.join(host.root, 'objects', 'objects', row.rows[0].payload_object_id));
      expect(Buffer.from(response.base64, 'base64')).toEqual(bytes); expect(response.sha256).toBe(digest(bytes));
      payloadIds.add(row.rows[0].payload_object_id);
      const preview = await checked(await request('agent', mediaUrl(media.preview_handle, opening.releaseId, binding)), 'IntakeSopMediaPayload');
      expect(preview.base64).toBe(response.base64);
    }
    expect(owners).toEqual(new Set(['entry', 'task', 'knowledge']));
    expect(ready.result.media.length).toBeGreaterThan(payloadIds.size);
    const first = ready.result.media[0]!.binding;
    await denial(await request('agent', mediaUrl(receipt.entitlement.entitlementId, opening.releaseId, first).replace('resourceId=', 'resourceId=foreign-'), {
      headers: { 'X-Sop-Continuation': opening.continuationId } }), 404);
    const required = ready.result.media.find(item => item.binding.required)!.binding;
    const object = await admin.query('SELECT payload_object_id FROM content_intake.sop_media_objects WHERE media_object_id=$1', [required.objectId]);
    const file = path.join(host.root, 'objects', 'objects', object.rows[0].payload_object_id);
    const original = readFileSync(file);
    writeFileSync(file, Buffer.from('synthetic-corruption'));
    try {
      await denial(await post('agent', '/v1/intake/sop/check', { ...action, nodeId: scripted.id, action: 'copy', entry: scripted.body.scripts[0]!.entry }), 503, 'SOP_MEDIA_UNAVAILABLE');
      await denial(await request('agent', mediaUrl(receipt.entitlement.entitlementId, opening.releaseId, required), { headers: { 'X-Sop-Continuation': opening.continuationId } }), 503, 'SOP_MEDIA_UNAVAILABLE');
    } finally { writeFileSync(file, original); }
  }, 120_000);

  it('retains the original pin through real R2 publication and R3 rollback while new queries use current', async () => {
    r2 = await publish('source-a', r1.releaseId, 2); await facts(r2, '税收相关规则');
    const renewed = await checked(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: pinned.opening.continuationId, contextGeneration: 7 }), 'IntakeSopContinuationReceipt');
    expect(renewed.entitlement.releaseId).toBe(r1.releaseId); pinned.receipt = renewed;
    const current = await openCurrent(8); expect(current.ready.release_id).toBe(r2.releaseId);
    expect(current.ready.result.graph_digest).not.toBe(pinned.ready.result.graph_digest);
    const old = pinned.ready.result.media[0]!;
    await denial(await request('agent', mediaUrl(pinned.opening.entitlementId, r1.releaseId, old.binding)), 409, 'SOP_RELEASE_CHANGED');
    await denial(await request('agent', mediaUrl(old.preview_handle, r1.releaseId, old.binding)), 409, 'SOP_RELEASE_CHANGED');
    const impact = await checked(await post('director', '/v1/intake/rollback/preview', { baseReleaseId: r2.releaseId, targetReleaseId: r1.releaseId }), 'IntakeRollbackImpact');
    const rolledBack = await checked(await post('director', '/v1/intake/rollback', { operationId: operation('rollback'),
      baseReleaseId: r2.releaseId, targetReleaseId: r1.releaseId, impactDigest: impact.impactDigest,
      rollbackPlanId: impact.rollbackPlanId, confirmed: true }), 'IntakeRollbackReceipt');
    r3 = parse('IntakeSopId', rolledBack.releaseId);
    expect(r3).not.toBe(r1.releaseId); expect(r3).not.toBe(r2.releaseId);
    const continued = await checked(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: current.opening.continuationId, contextGeneration: 10 }), 'IntakeSopContinuationReceipt');
    expect(continued.entitlement.releaseId).toBe(r2.releaseId);
    const restored = await openCurrent(11); expect(restored.ready.release_id).toBe(r3);
    expect(restored.ready.result.graph_digest).toBe(pinned.ready.result.graph_digest);
    writeFileSync(path.join(evidenceRoot, 'normal-r1-r3.json'), JSON.stringify({ r1: r1.releaseId, r2: r2.releaseId, r3,
      oldDigest: pinned.ready.result.graph_digest, revisedDigest: current.ready.result.graph_digest,
      restoredDigest: restored.ready.result.graph_digest, oldPinned: continued.entitlement.releaseId }));
  }, 120_000);

  it('converges concurrent exact open/close and recovers real committed open, renew and close responses', async () => {
    const input = await currentOpening(20);
    arm = 'open';
    await denial(await post('agent', '/v1/intake/sop/check', input.opening), 503, 'COMMIT_UNKNOWN');
    const hash = digest(input.opening.continuationId);
    expect((await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [hash])).rows[0].count).toBe(1);
    const replays = await Promise.all([post('agent', '/v1/intake/sop/check', input.opening), post('agent', '/v1/intake/sop/check', input.opening)]);
    for (const response of replays) {
      const receipt = await checked(response, 'IntakeSopContinuationReceipt');
      expect(receipt.continuationId).toBe(input.opening.continuationId);
      expect(receipt.entitlement.releaseId).toBe(r3);
    }
    const bound = await checked(await post('agent', '/v1/intake/sop/check', input.opening), 'IntakeSopContinuationReceipt');
    const media = input.ready.result.media[0]!.binding;
    const url = mediaUrl(bound.entitlement.entitlementId, bound.entitlement.releaseId, media);
    arm = 'media'; mediaCommitReads = 0;
    try { await denial(await request('agent', url, { headers: { 'x-sop-continuation': input.opening.continuationId } }), 503, 'COMMIT_UNKNOWN'); }
    finally { arm = null; }
    expect(mediaCommitReads).toBe(2);
    const recovered = await checked(await request('agent', url, { headers: { 'x-sop-continuation': input.opening.continuationId } }), 'IntakeSopMediaPayload');
    expect(digest(Buffer.from(recovered.base64, 'base64'))).toBe(media.sha256);
    const renewal = { continuationId: input.opening.continuationId, contextGeneration: 21 };
    arm = 'renew';
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', renewal), 503, 'COMMIT_UNKNOWN');
    expect((await checked(await post('agent', '/v1/intake/sop/continuations/renew', renewal), 'IntakeSopContinuationReceipt')).entitlement.contextGeneration).toBe(21);
    arm = 'close';
    await denial(await post('agent', '/v1/intake/sop/continuations/close', { continuationId: input.opening.continuationId }), 503, 'COMMIT_UNKNOWN');
    const closed = (await admin.query('SELECT closed_at,session_hash FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [hash])).rows[0];
    expect(closed.closed_at).not.toBeNull(); expect(closed.session_hash).toBeNull();
    const repeated = await Promise.all([post('agent', '/v1/intake/sop/continuations/close', { continuationId: input.opening.continuationId }),
      post('agent', '/v1/intake/sop/continuations/close', { continuationId: input.opening.continuationId })]);
    for (const response of repeated) expect(response.status, await response.text()).toBe(204);
    await denial(await post('agent', '/v1/intake/sop/check', input.opening), 409, 'SOP_RELEASE_CHANGED');
    expect((await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [hash])).rows[0].count).toBe(1);
  }, 120_000);

  it('opens an independent no-FAQ graph and preserves an old pin when the new current release has an unrelated source failure', async () => {
    const base = (await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id;
    const independent = await publish('source-solo', base, 1, undefined, { solo: true });
    await facts(independent, '品质售后SOP');
    const flow = await openCurrent(30, '品质售后SOP');
    expect(flow.ready.result.flow.header.anchorEntry).toBeNull(); expect(flow.ready.result.entries).toEqual([]);
    const targets = (await admin.query('SELECT count(*)::int AS count FROM content_intake.sop_graph_quality_targets WHERE candidate_id=$1 AND candidate_version=$2', [independent.key.candidateId, independent.key.version])).rows[0].count;
    expect(targets).toBeGreaterThan(0);
    await admin.query("UPDATE content_intake.sources SET mode='legacy',mode_version=mode_version+1,revocation_generation=revocation_generation+1 WHERE source_id='source-solo'");
    await denial(await post('agent', '/v1/intake/entitlements', { shopId: 'shop-a', productIds: [], scenarioIds: [], contextGeneration: 31, releaseId: null }), 409, 'SOURCE_MISMATCH');
    const old = await checked(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: pinned.opening.continuationId, contextGeneration: 32 }), 'IntakeSopContinuationReceipt');
    expect(old.entitlement.releaseId).toBe(r1.releaseId); pinned.receipt = old;
    await admin.query("UPDATE content_intake.sources SET mode='v2-preview',mode_version=mode_version+1,revocation_generation=revocation_generation+1 WHERE source_id='source-solo'");
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: flow.opening.continuationId, contextGeneration: 33 }), 409, 'SOP_RELEASE_CHANGED');
    const state = (await admin.query('SELECT termination_reason,session_hash FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [digest(flow.opening.continuationId)])).rows[0];
    expect(state).toEqual({ termination_reason: 'source-suspended', session_hash: null });
  }, 120_000);

  it('permanently ends an opened graph after normal workbook disable publication and permits only a new handle after reenable', async () => {
    const original = await openCurrent(40, '品质售后SOP');
    const base = (await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id;
    const disabled = await publish('source-solo', base, 2, undefined, { solo: true, disable: true });
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: original.opening.continuationId, contextGeneration: 41 }), 409, 'SOP_RELEASE_CHANGED');
    const impact = await checked(await post('director', '/v1/intake/rollback/preview', {
      baseReleaseId: disabled.releaseId, targetReleaseId: original.opening.releaseId }), 'IntakeRollbackImpact');
    const restored = await checked(await post('director', '/v1/intake/rollback', { operationId: operation('rollback-disabled-flow'),
      baseReleaseId: disabled.releaseId, targetReleaseId: original.opening.releaseId, impactDigest: impact.impactDigest,
      rollbackPlanId: impact.rollbackPlanId, confirmed: true }), 'IntakeRollbackReceipt');
    const restoredReleaseId = parse('IntakeSopId', restored.releaseId);
    const queryAfterRollback = await checked(await post('agent', '/v1/sop/query', { sop_group: '品质售后SOP', shop_id: 'shop-a',
      query_text: '合成入口', context_generation: 'synthetic-current-rollback-open', request_id: randomUUID() }), 'MenokinSopQuerySopQueryResponse');
    expect(queryAfterRollback.status).toBe('ready');
    expect(queryAfterRollback.release_id).toBe(restoredReleaseId);
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: original.opening.continuationId, contextGeneration: 43 }), 409, 'SOP_RELEASE_CHANGED');
    const afterRollback = await openCurrent(44, '品质售后SOP');
    expect(afterRollback.receipt.entitlement.releaseId).toBe(restoredReleaseId);
    expect(afterRollback.receipt.continuationId).not.toBe(original.opening.continuationId);
    const oldState = (await admin.query('SELECT closed_at,session_hash,termination_reason FROM content_intake.sop_active_uses WHERE continuation_hash=$1',
      [digest(original.opening.continuationId)])).rows[0];
    expect(oldState.closed_at).not.toBeNull();
    expect(oldState.session_hash).toBeNull();
    expect(oldState.termination_reason).toBe('content-disabled');
    const reenabled = await publish('source-solo', restoredReleaseId, 3, undefined, { solo: true });
    await facts(reenabled, '品质售后SOP');
    await denial(await post('agent', '/v1/intake/sop/check', original.opening), 409, 'SOP_RELEASE_CHANGED');
    const fresh = await openCurrent(42, '品质售后SOP');
    expect(fresh.receipt.continuationId).not.toBe(original.opening.continuationId);
    expect(fresh.ready.result.flow.header.key.flowVersion).toBe(3);
    const rows = (await admin.query('SELECT target_kind,target_id,release_id FROM content_intake.sop_graph_disable_events WHERE source_id=$1', ['source-solo'])).rows;
    expect(rows).toContainEqual({ target_kind: 'flow', target_id: original.opening.key.flowId, release_id: disabled.releaseId });
  }, 120_000);
  it('paginates only the pinned flow and exact dependencies and binds cursors to view and entitlement', async () => {
    const renewed = await checked(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: pinned.opening.continuationId, contextGeneration: 50 }), 'IntakeSopContinuationReceipt');
    const pages: C['IntakeSnapshot'][] = [];
    let cursor: string | null = null;
    do {
      const page: C['IntakeSnapshot'] = await checked(await request('agent', `/v1/intake/snapshot?entitlementId=${renewed.entitlement.entitlementId}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), 'IntakeSnapshot');
      expect(page.pageIndex).toBe(pages.length); pages.push(page); cursor = page.nextCursor;
    } while (cursor);
    expect(pages.length).toBe(pages[0]!.pageCount);
    expect(pages.flatMap(page => page.sopFlows)).toEqual([{ header: pinned.ready.result.flow.header,
      graphDigest: pinned.ready.result.graph_digest }]);
    expect(pages.flatMap(page => page.faq)).toEqual(pinned.ready.result.entries);
    expect(pages.flatMap(page => page.media)).toHaveLength(pinned.ready.result.media.length);
    expect(pages.every(page => page.releaseId === r1.releaseId)).toBe(true);
    const second = await checked(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: pinned.opening.continuationId, contextGeneration: 51 }), 'IntakeSopContinuationReceipt');
    const cursorQuery = encodeURIComponent(pages[0]!.nextCursor!);
    await denial(await request('agent', `/v1/intake/snapshot?entitlementId=${second.entitlement.entitlementId}&limit=1&cursor=${cursorQuery}`), 409, 'SOP_SNAPSHOT_INVALID');
    await denial(await request('agent', `/v1/intake/preview?entitlementId=${second.entitlement.entitlementId}&objectId=${pinned.ready.result.media[0]!.binding.objectId}`), 404, 'SCOPE_DENIED');
    pinned.receipt = second;
    writeFileSync(path.join(evidenceRoot, 'pinned-pages.json'), JSON.stringify({ releaseId: r1.releaseId,
      pageCount: pages.length, totals: pages[0]!.totals, snapshotDigest: pages[0]!.snapshotDigest, exactClosure: true }));
  });

  it('authorizes identity and resource before invalid, empty, duplicate or legacy header rejection without protected reads or writes', async () => {
    const input = await currentOpening(55);
    const before = protectedQueries;
    for (const headers of [['wrong-view'], [''], [SOP_UNIFIED_QUERY_CONTRACT_SET_ID, SOP_UNIFIED_QUERY_CONTRACT_SET_ID], []]) {
      await denial(await rawAgent('/v1/intake/sop/check', input.opening, headers), 409, 'UPGRADE_REQUIRED');
    }
    for (const sourceId of ['source-b', 'source-absent']) {
      const unknown = { ...input.opening, key: { ...input.opening.key, sourceId } };
      await denial(await rawAgent('/v1/intake/sop/check', unknown, ['wrong-view']), 404, 'SCOPE_DENIED');
    }
    await denial(await rawAgent('/v1/intake/sop/continuations/renew', { continuationId: `sct_${randomBytes(32).toString('hex')}`,
      contextGeneration: 56 }, ['wrong-view']), 404, 'SCOPE_DENIED');
    expect((await rawAgent('/v1/intake/sop/check', input.opening, ['wrong-view'], `Bearer ${randomBytes(32).toString('base64url')}`)).status).toBe(401);
    expect(protectedQueries).toBe(before);
    expect((await admin.query('SELECT count(*)::int count FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [digest(input.opening.continuationId)])).rows[0].count).toBe(0);
    const valid = await checked(await post('agent', '/v1/intake/sop/check', input.opening), 'IntakeSopContinuationReceipt');
    await denial(await post('agent', '/v1/intake/sop/check', { ...input.opening, graphDigest: 'f'.repeat(64) }), 409, 'SOP_SNAPSHOT_INVALID');
    await denial(await post('agent', '/v1/intake/sop/check', { ...input.opening, action: 'observe',
      entitlementId: valid.entitlement.entitlementId, contextGeneration: 999 }), 404, 'SCOPE_DENIED');
  });

  it('actually dumps, restores and consumes active/closed continuations, original lineage, leases, session proof and media bytes', async () => {
    const body = { sop_group: '税收相关规则', shop_id: 'shop-a', query_text: '合成入口',
      context_generation: 'synthetic-D-backup', request_id: randomUUID() };
    const response = await checked(await post('agent', '/v1/sop/query', body), 'MenokinSopQuerySopQueryResponse');
    expect(response.status).toBe('ready');
    const config = (await admin.query(`SELECT current_database() AS database,current_user AS user,
      current_setting('unix_socket_directories') AS host,current_setting('port')::int AS port`)).rows[0];
    const context = (await admin.query(`SELECT binding.entitlement_hash FROM content_intake.sop_unified_query_bindings binding
      JOIN content_intake.sop_query_leases lease USING(lease_id) WHERE lease.request_id=$1`, [body.request_id])).rows[0];
    const releaseId = (await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id;
    const graphs = (await admin.query('SELECT graph_digest FROM content_intake.sop_graph_release_lineage WHERE release_id=$1 ORDER BY source_id COLLATE "C",flow_id COLLATE "C"', [releaseId])).rows;
    const images = (await admin.query(`SELECT DISTINCT object.payload_object_id,object.sha256 FROM content_intake.sop_graph_release_media media
      JOIN content_intake.sop_media_objects object ON object.media_object_id=media.object_id WHERE media.release_id=$1`, [releaseId])).rows;
    const input = path.join(host.root, 'continuation-backup-input.json');
    writeFileSync(input, JSON.stringify({ root: host.root, ...config, agentAuthorization, evidenceRoot,
      entitlementHash: context.entitlement_hash, graphDigests: graphs.map(item => item.graph_digest), imageSha256: images.map(item => item.sha256),
      releaseId, query: { request: body, response }, continuationProbe: true }), { mode: 0o600 });
    const binding = pinned.ready.result.media[0]!.binding;
    const resource = new URL(mediaUrl('placeholder', r1.releaseId, binding), 'http://127.0.0.1');
    const fullBinding = Object.fromEntries([...resource.searchParams].filter(([key]) => key !== 'entitlementId'));
    const result = spawnSync(process.execPath, ['tests/support/sop-graph-backup.mjs', input], {
      cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
      input: JSON.stringify({ active: pinned.opening.continuationId, closed: closedContinuation, releaseId: r1.releaseId,
        binding: fullBinding, objectId: binding.objectId, sha256: binding.sha256 }) });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    writeFileSync(path.join(evidenceRoot, 'continuation-backup.log'), output);
    if (result.error) throw result.error;
    expect(result.status, output).toBe(0); expect(output).toContain('NONEMPTY_GRAPH_RESTORE_PASS');
    const restored = JSON.parse(readFileSync(path.join(evidenceRoot, 'nonempty-restore-results.json'), 'utf8'));
    expect(restored.http.continuation).toMatchObject({ restoredRenew: true, closedRejected: true, repeatedClose: true });
    expect(restored.report.migrationCount).toBe(88);
  }, 180_000);

  it('pins consumed permission facts and blocks ambiguous first-open observations without replacing old active facts', async () => {
    await facts(r1, '税收相关规则', 'low', false, 1);
    const input = await currentOpening(58);
    expect(input.ready.result.permissions.every(item => !item.copy_allowed)).toBe(true);
    await denial(await post('agent', '/v1/intake/sop/check', input.opening), 409, 'SOP_SNAPSHOT_INVALID');
    const ref = pinned.ready.result.flow.nodes.find(node => node.body.scripts.length)!.body.scripts[0]!.entry;
    const checkedCopy = await post('agent', '/v1/intake/sop/check', { ...pinned.opening, action: 'copy',
      nodeId: pinned.ready.result.flow.nodes.find(node => node.body.scripts.length)!.id, entry: ref,
      entitlementId: pinned.receipt.entitlement.entitlementId, contextGeneration: pinned.receipt.entitlement.contextGeneration });
    expect(checkedCopy.status).toBe(204);
    expect(Number((await admin.query('SELECT facts_version FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [digest(pinned.opening.continuationId)])).rows[0].facts_version)).toBe(1);
    const base = (await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id;
    const next = await publish('source-a', base, 3);
    await facts(next, '税收相关规则');
    expect((await openCurrent(59)).receipt.entitlement.releaseId).toBe(next.releaseId);
  });

  it('pauses on grant loss, resumes under a new ancestor chain and replays the original open after its short entitlement expires', async () => {
    const grants = (await admin.query("SELECT grant_id,version FROM content_intake.grants WHERE recipient_id='agent' AND source_id='source-a' AND action='query' AND revoked_at IS NULL")).rows;
    for (const grant of grants) await checked(await request('director', `/v1/intake/grants/${grant.grant_id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: operation('revoke'),
        expectedVersion: Number(grant.version), change: 'revoke', stewardPrincipalId: null, reason: '合成续用换链' }) }), 'IntakeGrant');
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: pinned.opening.continuationId, contextGeneration: 60 }), 404, 'SCOPE_DENIED');
    expect((await admin.query('SELECT closed_at FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [digest(pinned.opening.continuationId)])).rows[0].closed_at).toBeNull();
    const policyVersion = Number((await admin.query("SELECT version FROM content_intake.policy_versions WHERE tenant_id='tenant-a' AND app_id='app-a'")).rows[0].version);
    const scope = { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'product', sourceId: 'source-a' };
    const grant = async (issuer: DesktopSyntheticIdentity, recipient: string, kind: 'business' | 'delegation', seconds: number) => {
      const issuerVersion = Number((await admin.query('SELECT current_facts_version FROM content_intake.principals WHERE principal_id=$1', [issuer])).rows[0].current_facts_version);
      const recipientVersion = Number((await admin.query('SELECT current_facts_version FROM content_intake.principals WHERE principal_id=$1', [recipient])).rows[0].current_facts_version);
      const body = { operationId: operation('new-chain'), issuerFactsVersion: issuerVersion, policyVersion, items: [{ kind,
        recipientPrincipalId: recipient, recipientFactsVersion: recipientVersion, action: 'query', scope, startsAt: new Date(Date.now()).toISOString(),
        expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), reason: '合成续用新授权链' }] };
      return (await checked(await post(issuer, '/v1/intake/grants', body), 'IntakeGrantList')).items[0]!;
    };
    const ancestor = { grantId: 'alloc-roster-query' };
    const short = await grant('roster-director', 'agent', 'business', 3);
    expect((await admin.query('SELECT parent_grant_id FROM content_intake.grants WHERE grant_id=$1', [short.grantId])).rows[0].parent_grant_id).toBe(ancestor.grantId);
    const shortOpen = await openCurrent(61);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(shortOpen.receipt.entitlement.validUntil) - Date.now() + 20)));
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: shortOpen.opening.continuationId,
      contextGeneration: 62 }), 404, 'SCOPE_DENIED');
    const replacement = await grant('roster-director', 'agent', 'business', 100);
    const renewed = await checked(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: pinned.opening.continuationId,
      contextGeneration: 63 }), 'IntakeSopContinuationReceipt');
    expect(renewed.entitlement.releaseId).toBe(r1.releaseId);
    const replay = await checked(await post('agent', '/v1/intake/sop/check', shortOpen.opening), 'IntakeSopContinuationReceipt');
    expect(replay.entitlement.entitlementId).not.toBe(shortOpen.receipt.entitlement.entitlementId);
    expect(Date.parse(replay.entitlement.validUntil)).toBeGreaterThan(Date.now());
    expect((await admin.query('SELECT parent_grant_id FROM content_intake.grants WHERE grant_id=$1', [replacement.grantId])).rows[0].parent_grant_id).toBe(ancestor.grantId);
    const membership = (await admin.query("DELETE FROM content_intake.store_set_members WHERE source_id='source-a' RETURNING *")).rows;
    try {
      await denial(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: pinned.opening.continuationId,
        contextGeneration: 64 }), 404, 'SCOPE_DENIED');
      expect((await admin.query('SELECT closed_at FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [digest(pinned.opening.continuationId)])).rows[0].closed_at).toBeNull();
    } finally {
      for (const row of membership) await admin.query('INSERT INTO content_intake.store_set_members SELECT (jsonb_populate_record(NULL::content_intake.store_set_members,$1::jsonb)).*', [JSON.stringify(row)]);
    }
    expect((await checked(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: pinned.opening.continuationId,
      contextGeneration: 65 }), 'IntakeSopContinuationReceipt')).entitlement.scopes).toEqual(renewed.entitlement.scopes);
  }, 120_000);

  it('requires natural old-session expiry for same-account rebind and permanently closes on real explicit logout', async () => {
    const opened = await openCurrent(70);
    const previous = agentAuthorization;
    if (!previous) throw new Error('Synthetic product session missing');
    const newer = await freshAgentSession();
    replacementAuthorization = newer;
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: opened.opening.continuationId, contextGeneration: 71 }), 404, 'SCOPE_DENIED');
    const oldHash = digest(previous.slice('Bearer '.length));
    await admin.query("UPDATE backend_identity.sessions SET expires_at=clock_timestamp()-interval '1 millisecond' WHERE token_hash=$1 AND revoked_at IS NULL", [oldHash]);
    const renewed = await checked(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: opened.opening.continuationId, contextGeneration: 72 }), 'IntakeSopContinuationReceipt');
    expect(renewed.entitlement.releaseId).toBe(opened.opening.releaseId);
    const newHash = digest(newer.slice('Bearer '.length));
    expect((await admin.query('SELECT session_hash FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [digest(opened.opening.continuationId)])).rows[0].session_hash).toBe(newHash);
    expect((await admin.query('SELECT revoked_at,expires_at<clock_timestamp() expired FROM backend_identity.sessions WHERE token_hash=$1', [oldHash])).rows[0]).toEqual({ revoked_at: null, expired: true });
    await expect(admin.query('DELETE FROM backend_identity.sessions WHERE token_hash=$1', [newHash])).rejects.toMatchObject({ code: '23503' });
    await denial(await post('reviewer', '/v1/intake/sop/continuations/renew', {
      continuationId: opened.opening.continuationId, contextGeneration: 73 }), 404, 'SCOPE_DENIED');
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: `sct_${randomBytes(32).toString('hex')}`, contextGeneration: 74 }), 404, 'SCOPE_DENIED');
    const expiredAction = await fetch(`${host.apiOrigin}/v1/intake/sop/continuations/renew`, { method: 'POST',
      headers: { authorization: previous, 'content-type': 'application/json', 'x-intake-contract-set': SOP_UNIFIED_QUERY_CONTRACT_SET_ID },
      body: JSON.stringify({ continuationId: opened.opening.continuationId, contextGeneration: 75 }) });
    expect(expiredAction.status).toBe(401);
    const logout = await fetch(`${host.apiOrigin}/v1/auth/logout`, { method: 'POST', headers: { authorization: newer } });
    expect(logout.status).toBe(204);
    const terminal = (await admin.query('SELECT closed_at,session_hash,termination_reason FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [digest(opened.opening.continuationId)])).rows[0];
    expect(terminal.closed_at).not.toBeNull(); expect(terminal.session_hash).toBeNull(); expect(terminal.termination_reason).toBe('logout');
    replacementAuthorization = await freshAgentSession();
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', {
      continuationId: opened.opening.continuationId, contextGeneration: 76 }), 409, 'SOP_RELEASE_CHANGED');
    await denial(await post('agent', '/v1/intake/sop/check', opened.opening), 409, 'SOP_RELEASE_CHANGED');
    expect((await post('agent', '/v1/intake/sop/continuations/close', { continuationId: opened.opening.continuationId })).status).toBe(204);
    writeFileSync(path.join(evidenceRoot, 'session-rebind-logout.json'), JSON.stringify({ naturalExpiryProof: true, sessionFkRetention: true,
      crossAccountDenied: true, explicitLogoutPermanent: true, closedSessionReference: terminal.session_hash }));
  }, 120_000);

  it('rechecks after real object I/O and withholds bytes when membership or explicit logout changes during the read', async () => {
    const flow = await openCurrent(80);
    const binding = flow.ready.result.media[0]!.binding;
    const url = mediaUrl(flow.receipt.entitlement.entitlementId, flow.opening.releaseId, binding);
    let removed: unknown[] = [];
    let readObserved = false;
    afterObjectRead = async () => { readObserved = true; removed = (await admin.query("DELETE FROM content_intake.store_set_members WHERE source_id='source-a' RETURNING *")).rows; };
    try { await denial(await request('agent', url, { headers: { 'x-sop-continuation': flow.opening.continuationId } }), 404, 'SCOPE_DENIED'); }
    finally { for (const row of removed) await admin.query('INSERT INTO content_intake.store_set_members SELECT (jsonb_populate_record(NULL::content_intake.store_set_members,$1::jsonb)).*', [JSON.stringify(row)]); }
    expect(readObserved).toBe(true);
    expect((await checked(await request('agent', url, { headers: { 'x-sop-continuation': flow.opening.continuationId } }), 'IntakeSopMediaPayload')).sha256).toBe(binding.sha256);
    afterObjectRead = async () => {
      const response = await fetch(`${host.apiOrigin}/v1/auth/logout`, { method: 'POST', headers: { authorization: agentAuthorization! } });
      expect(response.status).toBe(204);
    };
    expect((await request('agent', url, { headers: { 'x-sop-continuation': flow.opening.continuationId } })).status).toBe(401);
    expect((await admin.query('SELECT termination_reason FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [digest(flow.opening.continuationId)])).rows[0].termination_reason).toBe('logout');
    replacementAuthorization = await freshAgentSession();
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: flow.opening.continuationId, contextGeneration: 81 }), 409, 'SOP_RELEASE_CHANGED');
  });

  it('keeps unavailable optional media optional for open/copy/advance and returns its own explicit media failure', async () => {
    const declared = syntheticGraphMapping(false, true);
    const mapping = { ...declared, images: { ...declared.images,
      'image-knowledge': { required: false, alt: '合成 image-knowledge', ordinal: 1 } } };
    await admin.query('BEGIN');
    try {
      await admin.query(`INSERT INTO content_intake.source_mappings(source_id,version,template_version,rule_version,mapping_version,structure_digest,graph_mapping)
        VALUES('source-a',3,$1,$2,$3,$4,$5::jsonb)`, [SOP_TASK_FORMAT.templateVersion, SOP_TASK_FORMAT.ruleVersion,
        SOP_TASK_FORMAT.mappingVersion, SOP_TASK_STRUCTURE_SHA256, JSON.stringify(mapping)]);
      await admin.query("UPDATE content_intake.sources SET current_mapping_version=3 WHERE source_id='source-a'");
      await admin.query('COMMIT');
    } catch (error) { await admin.query('ROLLBACK'); throw error; }
    const base = (await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id;
    const optionalRelease = await publish('source-a', base, 4, undefined, { sourceVersion: 3 });
    await facts(optionalRelease, '税收相关规则');
    const input = await currentOpening(85);
    const binding = input.ready.result.media.find(item => item.binding.graphTarget?.kind === 'knowledge')!.binding;
    expect(binding.required).toBe(false);
    const descriptor = (await admin.query('SELECT payload_object_id FROM content_intake.sop_media_objects WHERE media_object_id=$1', [binding.objectId])).rows[0];
    const filename = path.join(host.root, 'objects', 'objects', descriptor.payload_object_id);
    const original = readFileSync(filename), corrupt = Buffer.from(original);
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 1;
    writeFileSync(filename, corrupt);
    try {
      const outcomes: { label: string; httpStatus: number; value: C['MenokinSopQuerySopQueryResponse'] | null }[] = [];
      for (const [label, query] of [
        ['first-with-bad-optional', { ...input.query, request_id: randomUUID(), context_generation: 'synthetic-optional-first' }],
        ['new-with-bad-optional', { ...input.query, request_id: randomUUID(), context_generation: 'synthetic-optional-new' }],
        ['old-ready-replay', input.query],
      ] as const) {
        const response = await post('agent', '/v1/sop/query', query);
        const body: unknown = await response.json();
        outcomes.push({ label, httpStatus: response.status,
          value: response.ok ? parse('MenokinSopQuerySopQueryResponse', body) : null });
      }
      writeFileSync(path.join(evidenceRoot, 'optional-query-physical-evidence.json'), JSON.stringify(outcomes.map(item => ({
        label: item.label, httpStatus: item.httpStatus, status: item.value?.status ?? 'http-error', reasons: item.value?.reasons,
        optionalBindingPreserved: item.value?.status === 'ready' && item.value.result.media.some(media => JSON.stringify(media.binding) === JSON.stringify(binding)),
      })), null, 2));
      for (const outcome of outcomes) {
        expect(outcome.httpStatus, outcome.label).toBe(200);
        expect(outcome.value?.status, outcome.label).toBe('ready');
        if (outcome.value?.status === 'ready') expect(outcome.value.result.media.map(item => item.binding)).toContainEqual(binding);
      }
      expect(outcomes.at(-1)?.value).toEqual(input.ready);
      const preview = input.ready.result.media.find(item => item.binding.objectId === binding.objectId)!;
      await denial(await request('agent', mediaUrl(preview.preview_handle, optionalRelease.releaseId, binding)), 503, 'SOP_MEDIA_UNAVAILABLE');
      const receipt = await checked(await post('agent', '/v1/intake/sop/check', input.opening), 'IntakeSopContinuationReceipt');
      const scripted = input.ready.result.flow.nodes.find(node => node.body.scripts.length)!;
      expect((await post('agent', '/v1/intake/sop/check', { ...input.opening, entitlementId: receipt.entitlement.entitlementId,
        action: 'copy', nodeId: scripted.id, entry: scripted.body.scripts[0]!.entry })).status).toBe(204);
      const edge = input.ready.result.flow.edges.find(item => item.from === scripted.id && item.action.kind === 'next')!;
      expect((await post('agent', '/v1/intake/sop/check', { ...input.opening, entitlementId: receipt.entitlement.entitlementId,
        action: 'next', nodeId: scripted.id, edgeId: edge.id })).status).toBe(204);
      await denial(await request('agent', mediaUrl(receipt.entitlement.entitlementId, optionalRelease.releaseId, binding), {
        headers: { 'x-sop-continuation': input.opening.continuationId } }), 503, 'SOP_MEDIA_UNAVAILABLE');
    } finally { writeFileSync(filename, original); }
  });

  it('ends a genuinely expired normal publication while keeping grant expiry separate from active lifetime', async () => {
    const base = (await admin.query('SELECT current_release_id FROM public.content_current WHERE id=1')).rows[0].current_release_id;
    const expiry = new Date(Date.now() + 3000).toISOString();
    const expiring = await publish('source-solo', base, 4, expiry, { solo: true });
    await facts(expiring, '品质售后SOP');
    const flow = await openCurrent(90, '品质售后SOP');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(expiry) - Date.now() + 20)));
    await denial(await post('agent', '/v1/intake/sop/continuations/renew', { continuationId: flow.opening.continuationId, contextGeneration: 91 }), 409, 'SOP_RELEASE_CHANGED');
    const row = (await admin.query('SELECT closed_at,session_hash,termination_reason FROM content_intake.sop_active_uses WHERE continuation_hash=$1', [digest(flow.opening.continuationId)])).rows[0];
    expect(row.closed_at).not.toBeNull(); expect(row.session_hash).toBeNull(); expect(row.termination_reason).toBe('content-expired');
  }, 120_000);

  it('verifies real 87 private owners, search paths, execution ACLs and rejects a PUBLIC privilege mutation', async () => {
    const names = ['assert_sop_graph_scope','project_sop_authorized_graph','project_sop_query_bundle','resolve_sop_open_facts',
      'open_sop_active_use','lock_sop_active_use','read_sop_action_bundle','issue_sop_continuation_lease',
      'read_sop_continuation_media','terminate_sop_active_uses','prepare_sop_action'];
    const rows = (await admin.query(`SELECT p.oid::regprocedure::text signature,owner.rolname owner,p.prosecdef,p.proconfig,
      has_function_privilege('public',p.oid,'EXECUTE') public_execute,has_function_privilege('app_runtime',p.oid,'EXECUTE') app_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE n.nspname='content_intake' AND p.proname=ANY($1::text[]) ORDER BY 1`, [names])).rows;
    expect(rows).toHaveLength(names.length + 1);
    expect(rows.filter(row => row.signature.startsWith('content_intake.open_sop_active_use('))).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ owner: 'intake_runtime_fn_owner', prosecdef: true,
      proconfig: ['search_path=pg_catalog'], public_execute: false, app_execute: false });
    expect((await verifyDatabaseMigrations(admin)).status).toBe('PASS');
    await admin.query('GRANT EXECUTE ON FUNCTION content_intake.resolve_sop_open_facts(text,text,text,text,jsonb,text) TO PUBLIC');
    try { await expect(verifyDatabaseMigrations(admin)).rejects.toMatchObject({ code: 'MIGRATION_VERIFY_FAILED' }); }
    finally { await admin.query('REVOKE ALL ON FUNCTION content_intake.resolve_sop_open_facts(text,text,text,text,jsonb,text) FROM PUBLIC'); }
    expect((await verifyDatabaseMigrations(admin)).status).toBe('PASS');
    await admin.query('BEGIN; SET LOCAL ROLE intake_usage');
    try {
      await expect(admin.query("SELECT content_intake.project_sop_authorized_graph('agent','rel_native_base','{}','{}','{}',clock_timestamp(),NULL,NULL)")).rejects.toMatchObject({ code: '42501' });
    } finally { await admin.query('ROLLBACK'); }
    writeFileSync(path.join(evidenceRoot, 'private-acl.json'), JSON.stringify({ rows, publicMutationRejected: true, arbitraryHistoricalReadDenied: true }, null, 2));
  });

});
