// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseContractSchema } from '@customer-agent/contracts/sop-unified';
import { SopTaskGraph, sopMediaKey } from '../../src/shared/sop-task-graph';
import { isSopUnifiedCommand, isSopUnifiedProjection } from '../../src/shared/sop-unified';
import { unifiedFixture } from '../support/sop-unified-fixture';

describe('unified graph semantics', () => {
  it('consumes complete synthetic graph and stable ordinal confirmations', () => {
    const { result } = unifiedFixture();
    parseContractSchema('MenokinSopQuerySopReadyResult', result);
    const graph = new SopTaskGraph(result, 'agent');
    expect(graph.requirements().map(item => item.id)).toEqual(['confirm-z', 'confirm-a']);
    expect(graph.advance('next-one')).toBe(false);
    graph.confirm('confirm-a'); expect(graph.complete()).toBe(false);
    graph.confirm('confirm-z'); expect(graph.advance('next-one')).toBe(true);
    expect(graph.current().body.kind).toBe('decision');
    expect(graph.edges().find(edge => edge.action.kind === 'choice' && edge.action.unableToDetermine)).toBeDefined();
    expect(graph.advance('choice-unknown')).toBe(true);
    expect(graph.current().body.kind).toBe('terminal');
    expect(graph.edges()).toEqual([]);
  });
  it('accepts standalone flows with a null anchor and no FAQ', () => {
    const { result } = unifiedFixture(); result.entries = []; result.permissions = []; result.media = [];
    for (const node of result.flow.nodes) { node.body.scripts = []; node.body.knowledge = []; }
    expect(() => new SopTaskGraph(result, 'agent')).not.toThrow();
  });
  it.each(['ordinal', 'edge', 'coach-task', 'coach-knowledge', 'coach-image', 'binding', 'permission', 'duplicate-entry', 'cycle'])( 'rejects invalid %s without inferring a replacement', defect => {
    const { result } = unifiedFixture();
    if (defect === 'ordinal') result.flow.nodes[0]!.body.requirements[0]!.ordinal = 3;
    if (defect === 'edge') result.flow.edges[0]!.to = 'missing';
    if (defect === 'coach-task') result.flow.nodes[0]!.body.audience = 'coach';
    if (defect === 'coach-knowledge') result.flow.nodes[0]!.body.knowledge[0]!.audience = 'coach';
    if (defect === 'coach-image') result.media[0]!.binding.audience = 'coach';
    if (defect === 'binding') result.media[0]!.binding.flowKey = { ...result.flow.header.key, flowVersion: 2 };
    if (defect === 'permission') result.permissions = [];
    if (defect === 'duplicate-entry') result.entries.push(result.entries[0]!);
    if (defect === 'cycle') result.flow.edges[0]!.to = 'start';
    expect(() => new SopTaskGraph(result, 'agent')).toThrow();
  });
  it('rejects missing ordinal, criterion, unknown choice and unclassified risk at the wire boundary', () => {
    const { result } = unifiedFixture();
    const invalids = [
      { ...result, flow: { ...result.flow, nodes: result.flow.nodes.map(node => ({ ...node, body: { ...node.body, requirements: node.body.requirements.map(({ id, label }) => ({ id, label })) } })) } },
      { ...result, permissions: result.permissions.map(permission => ({ ...permission, risk_level: 'unclassified' })) },
    ];
    for (const value of invalids) expect(() => parseContractSchema('MenokinSopQuerySopReadyResult', value)).toThrow();
    const graph = structuredClone(result);
    for (const edge of graph.flow.edges) if (edge.action.kind === 'choice') edge.action.unableToDetermine = false;
    expect(() => new SopTaskGraph(graph, 'agent')).toThrow();
    for (const edge of result.flow.edges) if (edge.action.kind === 'choice') edge.action.criterion = '';
    expect(() => new SopTaskGraph(result, 'agent')).toThrow();
  });
  it('accepts canonical knowledge projected into several tasks with one image binding', () => {
    const { result } = unifiedFixture();
    result.flow.nodes[1]!.body.knowledge = structuredClone(result.flow.nodes[0]!.body.knowledge);
    expect(result.flow.nodes[0]!.body.knowledge[1]!.id).toBe('resource-knowledge');
    expect(result.flow.nodes[0]!.body.knowledge[1]!.resourceBinding?.ownerId).toBe('knowledge-one');
    const graph = new SopTaskGraph(result, 'agent');
    for (const requirement of graph.requirements()) graph.confirm(requirement.id);
    graph.advance('next-one');
    expect(graph.media().map(media => media.binding.resourceId)).toContain('image-resource-knowledge');
  });
  it('allows text resource projections without requiring an image descriptor', () => {
    const { result } = unifiedFixture(); result.media = [];
    expect(() => new SopTaskGraph(result, 'agent')).not.toThrow();
  });
  it.each(['title', 'body', 'audience', 'missing-owner', 'wrong-resource-id', 'ambiguous-image'] as const)('rejects %s in repeated knowledge and resource ownership', defect => {
    const { result } = unifiedFixture();
    result.flow.nodes[1]!.body.knowledge = structuredClone(result.flow.nodes[0]!.body.knowledge);
    const repeated = result.flow.nodes[1]!.body.knowledge[0]!;
    if (defect === 'title') repeated.title += ' changed';
    if (defect === 'body') repeated.body += ' changed';
    if (defect === 'audience') { result.flow.header.audience = 'coach'; repeated.audience = 'coach'; }
    if (defect === 'missing-owner') result.flow.nodes[0]!.body.knowledge.shift();
    if (defect === 'wrong-resource-id') result.flow.nodes[0]!.body.knowledge[1]!.id = 'wrong-resource';
    if (defect === 'ambiguous-image') {
      result.flow.nodes[0]!.body.knowledge.push({ ...repeated, id: 'another-owner' });
      const duplicate = structuredClone(result.media[1]!);
      duplicate.binding.objectId = 'conflicting-image-at-same-owner-position';
      result.media.push(duplicate);
    }
    expect(() => new SopTaskGraph(result, defect === 'audience' ? 'coach' : 'agent')).toThrow();
  });
  it.each(['task', 'knowledge'] as const)('allows a shared resource and object for distinguishable task and %s owners', ownerKind => {
    const { result } = unifiedFixture();
    const first = structuredClone(result.media[0]!);
    const second = structuredClone(first);
    second.binding.graphTarget = { kind: ownerKind, id: ownerKind === 'task' ? 'decision' : 'knowledge-one' };
    result.media = [first, second];
    parseContractSchema('MenokinSopQuerySopReadyResult', result);
    expect(() => new SopTaskGraph(result, 'agent')).not.toThrow();
    expect(sopMediaKey(first)).not.toBe(sopMediaKey(second));
  });
  it('allows two image objects of one resource at distinct positions of the same owner', () => {
    const { result } = unifiedFixture();
    const first = structuredClone(result.media[0]!);
    const second = structuredClone(first);
    second.binding.objectId = 'synthetic-image-other'; second.binding.ordinal = 2;
    result.media = [first, second];
    expect(() => new SopTaskGraph(result, 'agent')).not.toThrow();
  });
  it('allows the same image through separate knowledge owners in one task', () => {
    const { result } = unifiedFixture();
    result.flow.nodes[0]!.body.knowledge.push({ id: 'knowledge-two', title: '第二合成知识', body: '第二合成知识正文。', audience: 'agent' });
    const second = structuredClone(result.media[1]!);
    second.binding.graphTarget = { kind: 'knowledge', id: 'knowledge-two' };
    result.media.push(second);
    const graph = new SopTaskGraph(result, 'agent');
    expect(graph.media().filter(media => media.binding.resourceId === second.binding.resourceId)).toHaveLength(2);
  });
  it.each(['duplicate-binding', 'same-binding-second-position', 'same-owner-position-other-resource', 'same-owner-position-other-object',
    'object-hash', 'object-bytes', 'object-mime'] as const)('rejects genuinely ambiguous or inconsistent %s', defect => {
    const { result } = unifiedFixture();
    const first = structuredClone(result.media[0]!);
    const second = structuredClone(first);
    if (defect === 'same-binding-second-position') second.binding.ordinal = 2;
    if (defect === 'same-owner-position-other-resource') second.binding.resourceId = 'another-resource';
    if (defect === 'same-owner-position-other-object') second.binding.objectId = 'another-object';
    if (defect.startsWith('object-')) second.binding.graphTarget = { kind: 'task', id: 'decision' };
    if (defect === 'object-hash') second.binding.sha256 = 'f'.repeat(64);
    if (defect === 'object-bytes') second.binding.bytes++;
    if (defect === 'object-mime') second.binding.mime = 'image/gif';
    result.media = [first, second];
    parseContractSchema('MenokinSopQuerySopReadyResult', result);
    expect(() => new SopTaskGraph(result, 'agent')).toThrow('SOP_DEPENDENCY_INVALID');
  });
  it('uses raw identity tuples irrespective of JSON object property order', () => {
    const { result } = unifiedFixture(), first = result.media[1]!;
    const reordered = structuredClone(first);
    const key = first.binding.flowKey;
    reordered.binding.flowKey = { flowVersion: key.flowVersion, flowId: key.flowId, sourceId: key.sourceId };
    reordered.binding.graphTarget = { id: 'knowledge-one', kind: 'knowledge' };
    expect(sopMediaKey(first)).toBe(sopMediaKey(reordered));
  });
  it('validates narrow commands and concealed projections', () => {
    expect(isSopUnifiedCommand({ kind: 'confirm', key: 'opaque' })).toBe(true);
    for (const value of [{ kind: 'confirm', key: 'opaque', token: 'bad' }, { kind: 'next' }, { kind: 'media', key: 'opaque', url: 'https://example.invalid' }]) expect(isSopUnifiedCommand(value)).toBe(false);
    const projection = { projectionVersion: 'sop-unified-v11', sessionId: 1, shops: [], notice: '', busy: false, copied: false, state: 'paused', title: '', node: null };
    expect(isSopUnifiedProjection(projection)).toBe(true);
    expect(isSopUnifiedProjection({ ...projection, node: { instruction: 'protected' } })).toBe(false);
  });
});
