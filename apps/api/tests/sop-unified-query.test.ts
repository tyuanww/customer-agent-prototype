import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockAuthService } from '../src/auth-service.js';
import { registerSopQueryRoute } from '../src/sop-query-routes.js';
import { MENOKIN_SOP_QUERY_CONTRACT_SET_ID } from '../src/sop-query-model.js';
import { SOP_UNIFIED_QUERY_CONTRACT_SET_ID, type SopGraph, type UnifiedSopQueryResponse } from '../src/sop-unified-query-model.js';
import { parseUnifiedSopQueryResponse, assertSopQueryGraph, sopGraphDigest } from '../src/sop-unified-query-validation.js';
import { parseSopQueryBundle, sopQueryMatches, selectSopQueryCandidate } from '../src/sop-unified-query-context.js';
import { parseSyntheticSopQueryFacts, parseSopQueryPublicationFacts } from '../src/sop-unified-query-facts.js';
import { knowledgeFlow, scriptFlow, faqEntry, entryRef, queryRequest, permission } from '../../../packages/contracts/tests/sop-unified.fixtures.js';

const apps: FastifyInstance[] = [];
const auth = { 'x-mock-user': 'usr_synthetic_agent_001', 'x-mock-role': 'agent' };
const headers = { ...auth, 'x-intake-contract-set': SOP_UNIFIED_QUERY_CONTRACT_SET_ID };
const now = Date.parse('2026-11-10T00:00:00Z');
const expiry = new Date(now + 240_000).toISOString();
const publicationFacts = {
  publicationReleaseId: 'synthetic-original-publication', materialDigest: 'c'.repeat(64), sourceVersion: 2,
  mappingDigest: 'd'.repeat(64), mappingSha256: 'e'.repeat(64),
  sourceClaim: { versionKind: 'unknown', versionValue: null, acquisition: 'controlled-synthetic-export', fileSha256: 'f'.repeat(64) },
  risk: { policyVersion: 'risk-p1.1', level: 'critical', reasons: ['CRITICAL_CHANGE'], explicitDisableCount: 0,
    sameSourceDisabledLast24Hours: 0, evaluatedAt: '2026-11-09T00:00:00Z' },
  confirmation: { evidenceVersion: 1, versionKind: 'opaque', versionValue: 'synthetic-source-version-7',
    acquisition: 'controlled-synthetic-export', objectSha256: 'f'.repeat(64) },
};
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function graph(): SopGraph { return { definition: structuredClone(knowledgeFlow), entries: [], media: [] }; }
function response(input = graph(), time = expiry): UnifiedSopQueryResponse {
  return { status: 'ready', request_id: queryRequest.request_id, release_id: 'synthetic-release', lease_expires_at: time,
    reasons: [], result: { flow: input.definition, graph_digest: sopGraphDigest(input), entries: input.entries,
      media: input.media.map((binding, index) => ({ binding, preview_handle: `synthetic-preview-${index}`, expires_at: time })), permissions: [] } };
}
function bundle(input = graph(), selectedMedia = input.media) {
  return { graphs: [{ graphDigest: sopGraphDigest(input), payload: input, selectedMedia,
    facts: { candidateId: 'synthetic-candidate', candidateVersion: 1, version: 1, sopGroup: queryRequest.sop_group,
      permissions: [], publicationFacts } }], validUntil: expiry };
}
function appWith(value?: UnifiedSopQueryResponse) {
  const execute = vi.fn(async () => value ?? response(graph(), new Date(Date.now() + 240_000).toISOString()));
  const app = Fastify(); apps.push(app);
  registerSopQueryRoute(app, createMockAuthService(), { unifiedOperation: { execute } });
  return { app, execute };
}

describe('SOP query Unicode boundary', () => {
  it('rejects unrepresentable text and preserves Chinese and paired astral characters', async () => {
    const { app, execute } = appWith();
    for (const text of ['合成\u0000', '合成\ud800', '合成\udfff']) {
      for (const overrides of [
        { query_text: text },
        { context_generation: text },
        { product_context: { type: 'sku', ref: text } },
      ]) {
        const result = await app.inject({ method: 'POST', url: '/v1/sop/query', headers,
          payload: { ...queryRequest, ...overrides } });
        expect(result.statusCode).toBe(400);
      }
    }
    expect(execute).not.toHaveBeenCalled();
    const result = await app.inject({ method: 'POST', url: '/v1/sop/query', headers,
      payload: { ...queryRequest, query_text: '合成入口😀', context_generation: '中文代际😀',
        product_context: { type: 'sku', ref: '合成商品😀' } } });
    expect(result.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
  });
});

function syntheticDocument(overrides: Record<string, unknown> = {}) {
  return { candidateId: 'synthetic-candidate', candidateVersion: 1, sourceId: 'synthetic-sop', flowId: 'flow-a',
    graphDigest: 'a'.repeat(64), sopGroup: queryRequest.sop_group, permissions: [], ...overrides };
}

describe('unified SOP graph query boundary', () => {
  it('allows the same image/resource across task, knowledge and entry owners while rejecting an ambiguous owner ordinal', () => {
    const input = graph();
    const ref = { ...entryRef, sourceId: input.definition.header.key.sourceId };
    input.definition.header.anchorEntry = ref;
    input.definition.nodes[0]!.body.scripts = [{ entry: ref, relation: 'independent', condition: '合成条件' }];
    input.entries = [{ sourceId: ref.sourceId, entry: structuredClone(faqEntry) }];
    const image = { flowKey: input.definition.header.key, resourceId: 'shared-image', objectId: `med_${'a'.repeat(64)}`,
      sha256: 'b'.repeat(64), mime: 'image/png', bytes: 25, ordinal: 1, alt: '合成图片', required: true,
      applicability: { productRefs: [], scenarioRefs: [] } } satisfies Omit<SopGraph['media'][number], 'entry' | 'graphTarget' | 'audience'>;
    input.media = [
      { ...image, graphTarget: { kind: 'task', id: 'task-a' }, audience: 'agent' },
      { ...image, graphTarget: { kind: 'task', id: 'task-end' }, audience: 'agent' },
      { ...image, graphTarget: { kind: 'knowledge', id: 'knowledge-a' }, audience: 'agent' },
      { ...image, entry: ref, audience: 'customer' },
    ];
    expect(() => assertSopQueryGraph(input, sopGraphDigest(input))).not.toThrow();
    input.media.push({ ...input.media[0]!, resourceId: 'other-image' });
    expect(() => assertSopQueryGraph(input, sopGraphDigest(input))).toThrow('MEDIA_UNVERIFIED');
  });
  it('verifies original digest before any scoped media projection', () => {
    const input = graph();
    input.media.push({ flowKey: input.definition.header.key, graphTarget: { kind: 'task', id: 'task-a' },
      resourceId: 'synthetic-image', objectId: `med_${'a'.repeat(64)}`, sha256: 'b'.repeat(64), mime: 'image/png', bytes: 25,
      ordinal: 1, alt: '合成图片', required: true, audience: 'agent',
      applicability: { productRefs: [{ id: 'product-a', displayVersion: 1 }], scenarioRefs: [] } });
    const parsed = parseSopQueryBundle(bundle(input, []));
    expect(parsed.graphs[0]?.selectedMedia).toEqual([]);
    expect(parsed.graphs[0]?.graphDigest).toBe(sopGraphDigest(input));
    expect(() => assertSopQueryGraph({ ...input, media: [] }, sopGraphDigest(input))).toThrow('GRAPH_UNRESOLVED');
    const ready = response(input);
    if (ready.status !== 'ready') throw new Error('fixture');
    ready.result.media = [];
    expect(parseUnifiedSopQueryResponse(ready, queryRequest.request_id, now)).toEqual(ready);
  });
  it('rejects bad original digest, unexpected media, duplicate dependencies and missing permissions', () => {
    const source = bundle(); source.graphs[0]!.graphDigest = 'f'.repeat(64);
    expect(() => parseSopQueryBundle(source)).toThrow('GRAPH_UNRESOLVED');
    const input: SopGraph = { definition: scriptFlow, entries: [{ sourceId: entryRef.sourceId, entry: faqEntry }], media: [] };
    // Same-source dependencies are mandatory, even if their body happens to match.
    expect(() => parseSopQueryBundle(bundle(input))).toThrow('GRAPH_UNRESOLVED');
    const duplicate = response();
    if (duplicate.status !== 'ready') throw new Error('fixture');
    duplicate.result.permissions = [permission, permission];
    expect(() => parseUnifiedSopQueryResponse(duplicate, queryRequest.request_id, now)).toThrow('GRAPH_UNRESOLVED');
  });
  it.each([
    ['E1', 'task-a'], ['E1', 'unresolved-target'],
    ['E2', 'task-a'], ['E2', 'unresolved-target'],
  ])('blocks terminal %s with any outgoing edge to %s', (terminalId, target) => {
    const input = graph();
    input.definition.nodes[1]!.id = terminalId;
    input.definition.edges[0]!.to = terminalId;
    input.definition.edges.push({ ...input.definition.edges[0]!, id: 'forbidden-outgoing', from: terminalId, to: target });
    expect(() => assertSopQueryGraph(input, sopGraphDigest(input))).toThrow('TERMINAL_HAS_OUTGOING_EDGE');
  });
  it.each(['task', 'knowledge', 'entry'] as const)('checks title-only and body-only allergy triggers for %s', owner => {
    for (const titleOnly of [true, false]) {
      const input = graph();
      const title = titleOnly ? '过敏合成标题' : '合成标题';
      const body = titleOnly ? '继续使用' : '过敏后继续使用';
      if (owner === 'task') {
        input.definition.nodes[0]!.body.title = title;
        input.definition.nodes[0]!.body.instruction = body;
      } else if (owner === 'knowledge') {
        input.definition.nodes[0]!.body.knowledge[0]!.title = title;
        input.definition.nodes[0]!.body.knowledge[0]!.body = body;
      } else {
        const ref = { ...entryRef, sourceId: input.definition.header.key.sourceId };
        input.definition.header.anchorEntry = ref;
        input.definition.nodes[0]!.body.scripts = [{ entry: ref, relation: 'independent', condition: '合成条件' }];
        input.entries = [{ sourceId: ref.sourceId, entry: { ...structuredClone(faqEntry), title, answerText: body } }];
      }
      expect(() => assertSopQueryGraph(input, sopGraphDigest(input))).toThrow('SAFETY_REVIEW_REQUIRED');
    }
  });
  it('rejects unsafe allergy, cycles and unclassified facts', () => {
    const input = graph(); input.definition.nodes[0]!.body.instruction = '过敏后继续使用';
    expect(() => assertSopQueryGraph(input, sopGraphDigest(input))).toThrow('SAFETY_REVIEW_REQUIRED');
    const cyclic = graph(); cyclic.definition.edges[0]!.to = 'task-a';
    expect(() => assertSopQueryGraph(cyclic, sopGraphDigest(cyclic))).toThrow('GRAPH_UNRESOLVED');
    const raw = bundle();
    const unsafe = { ...raw, graphs: raw.graphs.map(item => ({ ...item, facts: { ...item.facts,
      permissions: [{ ...permission, risk_level: 'unclassified' }] } })) };
    const unresolved = parseSopQueryBundle(unsafe);
    expect(selectSopQueryCandidate(unresolved.graphs, queryRequest)).toEqual({ kind: 'blocked', reason: 'SAFETY_REVIEW_REQUIRED' });
  });
  it('keeps unresolved permissions local to an explicitly registered different group', () => {
    const complete = bundle().graphs[0]!;
    const other = { ...complete, facts: { ...complete.facts, sopGroup: '品质售后SOP',
      permissions: [{ ...permission, risk_level: 'unclassified' }] } };
    const parsed = parseSopQueryBundle({ graphs: [complete, other], validUntil: expiry });
    expect(selectSopQueryCandidate(parsed.graphs, queryRequest).kind).toBe('ready');
    expect(selectSopQueryCandidate(parsed.graphs, { ...queryRequest, sop_group: '品质售后SOP' })).toEqual({ kind: 'blocked', reason: 'SAFETY_REVIEW_REQUIRED' });
    const missingGroup = parseSopQueryBundle({ graphs: [complete, { ...complete, facts: null }], validUntil: expiry });
    expect(selectSopQueryCandidate(missingGroup.graphs, queryRequest)).toEqual({ kind: 'blocked', reason: 'SOURCE_GATE_NOT_READY' });
  });
  it('matches only explicit authored terms and keeps unmatched requests empty', () => {
    expect(sopQueryMatches(graph(), '合成查询')).toBe('match');
    expect(sopQueryMatches(graph(), '阅读合成知识并确认。')).toBe('none');
  });
  it('measures the full actual UTF-8 JSON and rejects expired or excessive leases', () => {
    expect(() => parseUnifiedSopQueryResponse(response(graph(), new Date(now).toISOString()), queryRequest.request_id, now)).toThrow('LEASE_EXPIRED');
    expect(() => parseUnifiedSopQueryResponse(response(graph(), new Date(now + 300_001).toISOString()), queryRequest.request_id, now)).toThrow('LEASE_EXPIRED');
    const oversized = response();
    if (oversized.status !== 'ready') throw new Error('fixture');
    oversized.result.flow.nodes[0]!.body.instruction = '合'.repeat(360_000);
    expect(Buffer.byteLength(JSON.stringify(oversized))).toBeGreaterThan(1_048_576);
    expect(() => parseUnifiedSopQueryResponse(oversized, queryRequest.request_id, now)).toThrow('GRAPH_UNRESOLVED');
  });
});

describe('exact v11 query HTTP dispatch', () => {
  it('authenticates before rejecting a missing or wrong header', async () => {
    const { app, execute } = appWith();
    const denied = await app.inject({ method: 'POST', url: '/v1/sop/query', payload: { userId: 'forged' } });
    expect(denied.statusCode).toBe(401); expect(execute).not.toHaveBeenCalled();
    for (const header of ['', 'menokin-sop-query-v1', `${SOP_UNIFIED_QUERY_CONTRACT_SET_ID}, ${SOP_UNIFIED_QUERY_CONTRACT_SET_ID}`, MENOKIN_SOP_QUERY_CONTRACT_SET_ID]) {
      const result = await app.inject({ method: 'POST', url: '/v1/sop/query', headers: { ...auth, 'x-intake-contract-set': header }, payload: queryRequest });
      expect(result.statusCode).toBe(409);
    }
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['userId', 'token', 'scope', 'principal_id', 'entitlementId'])('rejects body %s before operation execution', async key => {
    const { app, execute } = appWith();
    const result = await app.inject({ method: 'POST', url: '/v1/sop/query', headers, payload: { ...queryRequest, [key]: 'forged' } });
    expect(result.statusCode).toBe(400); expect(execute).not.toHaveBeenCalled();
  });
  it('serves schema-valid complete graph wire with exact response header and no-store', async () => {
    const { app } = appWith();
    const result = await app.inject({ method: 'POST', url: '/v1/sop/query', headers, payload: queryRequest });
    expect(result.statusCode).toBe(200);
    expect(result.headers['x-intake-contract-set']).toBe(SOP_UNIFIED_QUERY_CONTRACT_SET_ID);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json().result.flow.nodes).toHaveLength(2);
  });
  it('rejects stale success and oversized actual HTTP responses', async () => {
    const stale = appWith(response());
    expect((await stale.app.inject({ method: 'POST', url: '/v1/sop/query', headers, payload: queryRequest })).statusCode).toBe(503);
    const giant = response(graph(), new Date(Date.now() + 240_000).toISOString());
    if (giant.status !== 'ready') throw new Error('fixture');
    giant.result.flow.nodes[0]!.body.instruction = '合'.repeat(360_000);
    const huge = appWith(giant);
    const result = await huge.app.inject({ method: 'POST', url: '/v1/sop/query', headers, payload: queryRequest });
    expect(result.statusCode).toBe(503); expect(result.body).not.toContain('flow');
  });
});

describe('synthetic permission facts registration', () => {
  it('preserves original publication risk, claim and mapping version independently of query permissions', () => {
    const parsed = parseSopQueryPublicationFacts(publicationFacts);
    expect(parsed.risk.level).toBe('critical');
    expect(parsed.sourceVersion).toBe(2);
    expect(parsed.sourceClaim.versionKind).toBe('unknown');
    expect(parsed.confirmation.versionValue).toBe('synthetic-source-version-7');
    expect(parsed.publicationReleaseId).toBe('synthetic-original-publication');
    expect(parsed).not.toHaveProperty('permissions');
    expect(parsed).not.toHaveProperty('copy_allowed');
  });
  it.each([
    { ...publicationFacts, sourceClaim: { ...publicationFacts.sourceClaim, fileSha256: 'a'.repeat(64) } },
    { ...publicationFacts, confirmation: { ...publicationFacts.confirmation, acquisition: 'feishu-export' } },
    { ...publicationFacts, confirmation: { ...publicationFacts.confirmation, versionKind: 'integer', versionValue: 'not-an-integer' } },
    { ...publicationFacts, mappingSha256: 'invalid' },
  ])('rejects incomplete or mismatched original publication facts', raw => {
    expect(() => parseSopQueryPublicationFacts(raw)).toThrow();
  });
  it('binds exact source bytes and version without inventing entry facts', () => {
    const bytes = Buffer.from(JSON.stringify(syntheticDocument()));
    const parsed = parseSyntheticSopQueryFacts({ ref: 'synthetic:query-facts', version: 'source-version-1', bytes });
    expect(parsed.document.permissions).toEqual([]); expect(parsed.sourceSha256).toHaveLength(64);
    expect(parsed.sourceVersion).toBe('source-version-1');
    expect(() => parseSyntheticSopQueryFacts({ ref: 'real:unapproved', version: '1', bytes })).toThrow('FILE_INVALID');
  });
  it('rejects source locators and permission suffixes outside the exact registered entry', () => {
    const permissionFact = { ...permission, source_ref: 'synthetic:query-facts@1#entry-a' };
    const document = syntheticDocument({ permissions: [permissionFact] });
    const source = { ref: 'synthetic:query-facts', version: '1', bytes: Buffer.from(JSON.stringify(document)) };
    expect(() => parseSyntheticSopQueryFacts({ ...source, ref: 'synthetic:https://internal.invalid/file' })).toThrow('FILE_INVALID');
    expect(() => parseSyntheticSopQueryFacts({ ...source, version: '/private/source' })).toThrow('FILE_INVALID');
    permissionFact.source_ref += '/permanent-url';
    expect(() => parseSyntheticSopQueryFacts({ ...source, bytes: Buffer.from(JSON.stringify(document)) })).toThrow('FILE_INVALID');
  });
  it('preserves an explicitly unresolved copy permission', () => {
    const permissionFact = { ...permission, copy_allowed: null, source_ref: 'synthetic:query-facts@1#entry-a' };
    const bytes = Buffer.from(JSON.stringify(syntheticDocument({ permissions: [permissionFact] })));
    expect(parseSyntheticSopQueryFacts({ ref: 'synthetic:query-facts', version: '1', bytes }).document.permissions[0]?.copy_allowed).toBeNull();
  });
  it('preserves explicitly unclassified risk and rejects foreign provenance or unknown fields', () => {
    const permissionFact = { ...permission, risk_level: 'unclassified', source_ref: 'synthetic:query-facts@1#entry-a' };
    const bytes = Buffer.from(JSON.stringify(syntheticDocument({ permissions: [permissionFact] })));
    expect(parseSyntheticSopQueryFacts({ ref: 'synthetic:query-facts', version: '1', bytes }).document.permissions[0]?.risk_level).toBe('unclassified');
    expect(() => parseSyntheticSopQueryFacts({ ref: 'synthetic:query-facts', version: '2', bytes })).toThrow('FILE_INVALID');
    expect(() => parseSyntheticSopQueryFacts({ ref: 'synthetic:query-facts', version: '1', bytes: Buffer.from(JSON.stringify(syntheticDocument({ token: 'forged' }))) })).toThrow('FILE_INVALID');
  });
});
