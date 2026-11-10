import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseContractSchema as parse, type components } from '@customer-agent/contracts/sop-unified';
import { assertSopContinuationAction, sopContinuationHash } from '../src/sop-continuation-action.js';
import { graphDigest as computeGraphDigest, validateGraph, type Graph } from '../src/content-intake/sop-graph.js';

type C = components['schemas'];
const key = { sourceId: 'synthetic-source', flowId: 'synthetic-flow', flowVersion: 1 };
const ref = { sourceId: key.sourceId, businessEntryId: 'synthetic-script', scriptVersion: 1 };
const handle = `sct_${'b'.repeat(64)}`;
const applicability = { productRefs: [{ id: 'synthetic-product', displayVersion: 1 }], scenarioRefs: [] };
const node = (id: string, kind: C['IntakeSopNode']['body']['kind'], scripts: C['IntakeSopNode']['body']['scripts'] = []): C['IntakeSopNode'] => ({
  key, id, body: { kind, title: '合成任务', stageLabel: '合成阶段', instruction: '合成明确操作', audience: 'agent',
    requirements: [], knowledge: [], scripts },
});
const graph: Graph = {
  definition: parse('IntakeSopFlowDefinition', {
    header: { key, title: '合成流程', anchorEntry: ref, entryTerms: ['合成入口'], applicability, startNodeId: 'start',
      operation: 'upsert', audience: 'agent', effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: null },
    nodes: [node('start', 'action', [{ entry: ref, relation: 'independent', condition: '合成条件' }]),
      node('decision', 'decision'), node('known', 'terminal'), node('unknown', 'terminal')],
    edges: [{ key, id: 'next', from: 'start', to: 'decision', action: { kind: 'next' } },
      ...['known', 'unknown'].map((id, index) => ({ key, id, from: 'decision', to: id,
        action: { kind: 'choice', label: `合成 ${id}`, ordinal: index + 1, matchTerms: [`合成 ${id}`],
          criterion: `合成明确依据 ${id}`, unableToDetermine: id === 'unknown' } }))],
  }),
  entries: [{ sourceId: key.sourceId, entry: parse('IntakePublishedEntry', { ...applicability,
    businessEntryId: ref.businessEntryId, scriptVersion: 1, operation: 'upsert', title: '合成话术', answerText: '第一行\n第二行',
    questions: [], effectiveFrom: '2020-01-01T00:00:00Z', effectiveTo: null, applicabilityNote: '合成范围',
    familySourceId: null, familyBusinessEntryId: null, brandNonOverridable: false, category: '合成', riskNote: '' }) }],
  media: [],
};
const permissions: C['MenokinSopQuerySopEntryPermission'][] = [{ entry: ref, risk_level: 'low', copy_allowed: true, source_ref: 'synthetic-only' }];
validateGraph(graph);
const graphDigest = computeGraphDigest(graph);
function request(changes: Partial<C['IntakeSopActionCheck']> = {}): C['IntakeSopActionCheck'] {
  return parse('IntakeSopActionCheck', { entitlementId: 'synthetic-entitlement', releaseId: 'synthetic-release',
    contextGeneration: 1, key, graphDigest, nodeId: 'start', action: 'open', edgeId: null, entry: null, continuationId: handle, ...changes });
}
function check(value: C['IntakeSopActionCheck']): void {
  return assertSopContinuationAction({ graph, graphDigest, permissions, request: value });
}

describe('frozen continuation action boundary', () => {
  it('hashes exact Main handles and rejects weak or malformed handles', () => {
    expect(sopContinuationHash(handle)).toBe(createHash('sha256').update(handle).digest('hex'));
    for (const value of ['sct_short', handle.toUpperCase(), `${handle}0`, null]) expect(() => sopContinuationHash(value)).toThrow();
  });

  it('accepts only a start open, a legal next and the declared decision choices', () => {
    expect(() => check(request())).not.toThrow();
    expect(() => check(request({ action: 'next', edgeId: 'next' }))).not.toThrow();
    expect(() => check(request({ nodeId: 'decision', action: 'choose', edgeId: 'unknown' }))).not.toThrow();
    for (const value of [request({ nodeId: 'decision' }), request({ action: 'choose', edgeId: 'known' }),
      request({ nodeId: 'decision', action: 'next', edgeId: 'next' }), request({ nodeId: 'known', action: 'choose', edgeId: 'unknown' })]) {
      expect(() => check(value)).toThrow('SOP_GRAPH_INVALID');
    }
  });

  it('authorizes the exact current-node script without changing the graph or action', () => {
    const before = JSON.stringify(graph), action = request({ action: 'copy', entry: ref });
    expect(() => check(action)).not.toThrow();
    expect(JSON.stringify(graph)).toBe(before); expect(action.nodeId).toBe('start');
    expect(() => check(request({ action: 'copy', nodeId: 'decision', entry: ref }))).toThrow('SOP_DEPENDENCY_INVALID');
    expect(() => check(request({ action: 'copy', entry: { ...ref, scriptVersion: 2 } }))).toThrow('SOP_DEPENDENCY_INVALID');
    expect(() => assertSopContinuationAction({ graph, graphDigest, request: action,
      permissions: permissions.map(item => ({ ...item, copy_allowed: false })) })).toThrow('SCOPE_DENIED');
  });

  it('rejects cross-flow and altered digest requests before action selection', () => {
    for (const value of [request({ key: { ...key, flowVersion: 2 } }), request({ graphDigest: 'c'.repeat(64) })]) {
      expect(() => check(value)).toThrow('SOP_SNAPSHOT_INVALID');
    }
  });

  it('preserves shared resource bytes across distinct task and knowledge owners', () => {
    const media = (kind: 'task' | 'knowledge', id: string, required: boolean) => parse('IntakeSopMedia', {
      flowKey: key, graphTarget: { kind, id }, resourceId: 'shared-resource', objectId: 'shared-object', sha256: 'd'.repeat(64),
      bytes: 68, mime: 'image/png', alt: '合成共享图片', audience: 'agent', required, ordinal: 1, applicability,
    });
    const bindings = [media('task', 'start', true), media('task', 'decision', true), media('knowledge', 'synthetic-knowledge', false)];
    const complete: Graph = { ...graph, media: bindings, definition: { ...graph.definition,
      nodes: graph.definition.nodes.map(item => item.id !== 'start' ? item : { ...item, body: { ...item.body,
        knowledge: [{ id: 'synthetic-knowledge', title: '合成知识', body: '合成知识正文', audience: 'agent' }] } }) } };
    validateGraph(complete);
    const originalDigest = computeGraphDigest(complete);
    expect(() => assertSopContinuationAction({ graph: complete, graphDigest: originalDigest, permissions,
      request: request({ graphDigest: originalDigest }) })).not.toThrow();
    expect(complete.media).toEqual(bindings);
  });

  it('keeps renderer confirmation progress and invented operation fields outside the wire', () => {
    expect(() => parse('IntakeSopActionCheck', { ...request(), confirmed: true })).toThrow();
    expect(() => parse('IntakeSopActionCheck', { ...request(), operationId: 'invented' })).toThrow();
    expect(() => request({ action: 'copy', entry: null })).toThrow();
    expect(() => request({ action: 'observe', edgeId: 'next' })).toThrow();
  });
});
