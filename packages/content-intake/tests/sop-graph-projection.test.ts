import { describe, expect, it } from 'vitest';
import { projectSopGraph } from '../src/sop-graph-projection.js';

describe('SOP graph projection boundary', () => {
  it('does not project an unresolved draft', () => {
    const result = projectSopGraph({ kind: 'needs-information', publishable: false, review: 'not-verified', issues: [{ kind: 'mapping-required', recordId: 'scene', field: 'flow', reason: 'missing' }] });
    expect(result).toEqual({ kind: 'needs-information', publishable: false, issues: ['scene:flow:missing'] });
  });
  it('projects only prepared graph data and remains non-publishable', () => {
    const result = projectSopGraph({ kind: 'prepared', publishable: false, review: 'not-verified', flows: [{
      header: { key: { sourceId: 'src', flowId: 'flow', flowVersion: 1 }, title: '流程', anchorEntry: null, entryTerms: ['入口'], applicability: { productRefs: [], scenarioRefs: [] }, startNodeId: 'a', operation: 'upsert', audience: 'agent', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
      nodes: [{ key: { sourceId: 'src', flowId: 'flow', flowVersion: 1 }, id: 'a', body: { kind: 'action', title: '开始', stageLabel: '一', instruction: '执行', audience: 'agent', requirements: [], knowledge: [], scripts: [] } }],
      edges: [],
    }], media: [], scriptBodies: [] });
    expect(result.kind).toBe('projected');
    if (result.kind === 'projected') {
      expect(result.publishable).toBe(false);
      expect(result.projection.flows[0]?.nodes).toEqual([{ key: { sourceId: 'src', flowId: 'flow', flowVersion: 1 }, id: 'a', body: { kind: 'action', title: '开始', stageLabel: '一', instruction: '执行', audience: 'agent', requirements: [], knowledge: [], scripts: [] } }]);
      expect(result.projection.contract).toBe('resume-v3-candidate');
    }
  });
  it('retains multiple flows instead of silently dropping all but the first', () => {
    const flow = { header: { key: { sourceId: 'src', flowId: 'flow', flowVersion: 1 }, title: '流程', anchorEntry: null, entryTerms: ['入口'], applicability: { productRefs: [], scenarioRefs: [] }, startNodeId: 'a', operation: 'upsert' as const, audience: 'agent' as const, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null }, nodes: [], edges: [] };
    const result = projectSopGraph({ kind: 'prepared', publishable: false, review: 'not-verified', flows: [
      { ...flow, nodes: [{ key: flow.header.key, id: 'a', body: { kind: 'terminal', title: '结束', stageLabel: '一', instruction: '结束', audience: 'agent', requirements: [], knowledge: [], scripts: [] } }] },
      { ...flow, header: { ...flow.header, key: { ...flow.header.key, flowId: 'flow-2' } }, nodes: [{ key: { ...flow.header.key, flowId: 'flow-2' }, id: 'a', body: { kind: 'terminal', title: '结束二', stageLabel: '一', instruction: '结束', audience: 'agent', requirements: [], knowledge: [], scripts: [] } }] },
    ], media: [], scriptBodies: [] });
    expect(result.kind).toBe('projected');
    if (result.kind === 'projected') expect(result.projection.flows).toHaveLength(2);
  });
  it('retains node requirements, script relations and media constraints', () => {
    const key = { sourceId: 'src', flowId: 'flow', flowVersion: 1 } as const;
    const result = projectSopGraph({ kind: 'prepared', publishable: false, review: 'not-verified', flows: [{
      header: { key, title: '流程', anchorEntry: null, entryTerms: ['入口'], applicability: { productRefs: [], scenarioRefs: [] }, startNodeId: 'a', operation: 'upsert', audience: 'agent', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
      nodes: [{ key, id: 'a', body: { kind: 'action', title: '开始', stageLabel: '一', instruction: '执行', audience: 'agent', requirements: [{ id: 'req', label: '确认', ordinal: 1 }], knowledge: [{ id: 'know', title: '知识', body: '正文', audience: 'agent' }], scripts: [{ entry: { sourceId: 'src', businessEntryId: 'entry', scriptVersion: 1 }, relation: 'complementary', condition: '条件' }] } }],
      edges: [],
    }], media: [{ objectId: 'obj', sha256: 'a'.repeat(64), mime: 'image/png', bytes: 3, ordinal: 1, alt: '图片', required: true, flowKey: key, resourceId: 'res', applicability: { productRefs: [], scenarioRefs: [] }, audience: 'agent', graphTarget: { kind: 'task', id: 'a' } }], scriptBodies: [] });
    expect(result.kind).toBe('projected');
    if (result.kind === 'projected') {
      expect(result.projection.flows[0]?.nodes[0]?.body).toMatchObject({ requirements: [{ id: 'req', ordinal: 1 }], knowledge: [{ id: 'know' }], scripts: [{ relation: 'complementary' }] });
      expect(result.projection.media[0]).toMatchObject({ required: true, resourceId: 'res', graphTarget: { id: 'a' } });
    }
  });
});
