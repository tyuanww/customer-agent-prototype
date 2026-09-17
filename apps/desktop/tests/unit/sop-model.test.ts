import { describe, expect, it } from 'vitest';
import { isAllergySopEntry } from '../../src/shared/sop-entry';
import {
  SopTreeValidationError,
  chooseSopEdge,
  projectSop,
  startSopProgress,
  validateSopTree,
  type SopTree,
} from '../../src/shared/sop-model';
import { ALLERGY_SOP_TREE } from '../../src/shared/synthetic-sops';
import { SOP_HIGH_RISK_BANNER } from '../../src/shared/sop-window';
import { compactQueryText } from '../../src/shared/query-analyze';

function tree(partial: Partial<SopTree> & Pick<SopTree, 'nodes' | 'startNodeId'>): SopTree {
  return {
    sceneId: 'allergy-aftersale-demo',
    sceneTitle: '过敏流程',
    stageLabel: '环节',
    ...partial,
  };
}

describe('allergy SOP entry', () => {
  it('accepts aftersale allergy questions and excludes usage', () => {
    expect(isAllergySopEntry(compactQueryText('过敏了怎么办'))).toBe(true);
    expect(isAllergySopEntry(compactQueryText('用了露芷面膜过敏了怎么办'))).toBe(true);
    expect(isAllergySopEntry(compactQueryText('怎么用过敏'))).toBe(false);
    expect(isAllergySopEntry(compactQueryText('如何用过敏'))).toBe(false);
    expect(isAllergySopEntry(compactQueryText('怎样用过敏'))).toBe(false);
    expect(isAllergySopEntry(compactQueryText('过敏用法'))).toBe(false);
    expect(isAllergySopEntry(compactQueryText('月白防晒长痘怎么办'))).toBe(false);
  });
});

describe('SOP tree validator', () => {
  it('accepts the allergy fixture', () => {
    expect(() => validateSopTree(ALLERGY_SOP_TREE)).not.toThrow();
    expect(ALLERGY_SOP_TREE.startNodeId).toBe('voucher-ask');
  });

  it('rejects cycles', () => {
    expect(() => validateSopTree(tree({
      startNodeId: 'a',
      nodes: [
        { id: 'a', kind: 'decision', edges: [{ id: 'to-b', label: '去B', targetId: 'b' }] },
        { id: 'b', kind: 'decision', edges: [{ id: 'to-a', label: '去A', targetId: 'a' }] },
      ],
    }))).toThrow(SopTreeValidationError);
  });

  it('rejects copyable nodes without scriptId', () => {
    expect(() => validateSopTree(tree({
      startNodeId: 'a',
      nodes: [{ id: 'a', kind: 'copyable', answerText: '正文', edges: [] }],
    }))).toThrow(/scriptId/);
  });

  it('rejects voucher nodes with payout extras', () => {
    expect(() => validateSopTree(tree({
      startNodeId: 'a',
      nodes: [{
        id: 'a',
        kind: 'copyable',
        voucher: true,
        scriptId: 'syn-bad',
        answerText: '可以直接打款和现金红包',
        edges: [],
      }],
    }))).toThrow(/payout/);
  });

  it('rejects more than 4 edges', () => {
    expect(() => validateSopTree(tree({
      startNodeId: 'a',
      nodes: [
        {
          id: 'a',
          kind: 'decision',
          edges: [
            { id: 'e1', label: '1', targetId: 'b' },
            { id: 'e2', label: '2', targetId: 'b' },
            { id: 'e3', label: '3', targetId: 'b' },
            { id: 'e4', label: '4', targetId: 'b' },
            { id: 'e5', label: '5', targetId: 'b' },
          ],
        },
        { id: 'b', kind: 'internal', edges: [] },
      ],
    }))).toThrow(/4 edges/);
  });
});

describe('SOP projection', () => {
  it('projects the voucher screen without payout extras or internal notes for agents', () => {
    const projection = projectSop({
      tree: ALLERGY_SOP_TREE,
      progress: startSopProgress(ALLERGY_SOP_TREE),
      role: 'agent',
      sessionId: 1,
    });
    expect(projection.script?.rank).toBe(1);
    expect(projection.script?.answerText).toContain('照片');
    expect(projection.script?.answerText).not.toMatch(/赔付|打款|现金红包/);
    expect(projection.edges.map((edge) => edge.label)).toEqual(['未给照片', '已给照片']);
    expect(projection.internalNote).toBeNull();
    expect(projection.internalTask).toBeNull();
    expect(projection.unpublished).toBe(false);
    expect(projection.highRiskBanner).toBe(SOP_HIGH_RISK_BANNER);
  });

  it('keeps the voucher constraint banner off decision, mild, and internal steps', () => {
    const start = startSopProgress(ALLERGY_SOP_TREE);
    const severity = chooseSopEdge(ALLERGY_SOP_TREE, start, 'has-photo')!;
    const mild = chooseSopEdge(ALLERGY_SOP_TREE, severity, 'mild')!;
    const insist = chooseSopEdge(ALLERGY_SOP_TREE, start, 'no-photo')!;
    const severe = chooseSopEdge(ALLERGY_SOP_TREE, severity, 'severe')!;
    expect(projectSop({
      tree: ALLERGY_SOP_TREE,
      progress: severity,
      role: 'agent',
      sessionId: 1,
    }).highRiskBanner).toBe('');
    expect(projectSop({
      tree: ALLERGY_SOP_TREE,
      progress: mild,
      role: 'agent',
      sessionId: 1,
    }).highRiskBanner).toBe('');
    expect(projectSop({
      tree: ALLERGY_SOP_TREE,
      progress: insist,
      role: 'agent',
      sessionId: 1,
    }).highRiskBanner).toBe(SOP_HIGH_RISK_BANNER);
    expect(projectSop({
      tree: ALLERGY_SOP_TREE,
      progress: severe,
      role: 'agent',
      sessionId: 1,
    }).highRiskBanner).toBe('');
  });

  it('omits unpublished as an open failure and keeps it as a projection field', () => {
    const projection = projectSop({
      tree: ALLERGY_SOP_TREE,
      progress: startSopProgress(ALLERGY_SOP_TREE),
      role: 'agent',
      sessionId: 1,
      published: new Set(),
    });
    expect(projection.unpublished).toBe(true);
    expect(projection.script?.scriptId).toBe('syn-sop-allergy-voucher');
  });

  it('shows internal banners only to coach or owner', () => {
    let progress = startSopProgress(ALLERGY_SOP_TREE);
    progress = chooseSopEdge(ALLERGY_SOP_TREE, progress, 'has-photo')!;
    progress = chooseSopEdge(ALLERGY_SOP_TREE, progress, 'severe')!;
    const agent = projectSop({ tree: ALLERGY_SOP_TREE, progress, role: 'agent', sessionId: 1 });
    const coach = projectSop({ tree: ALLERGY_SOP_TREE, progress, role: 'coach', sessionId: 1 });
    expect(agent.internalNote).toBeNull();
    expect(coach.internalNote).toContain('升级路径');
    expect(coach.internalTask).toContain('话术师');
    expect(JSON.stringify(coach)).not.toMatch(/班牛|群名/);
  });
});
