import { describe, expect, it } from 'vitest';
import type { SopGroupId } from '@customer-agent/content-intake';
import {
  validateQueryOutcome,
  type QueryOutcome,
} from '../../../packages/unified-contracts/src/index.js';
import {
  SopPipeline,
  type SopPipelineProjection,
  type SopPipelineQueryLease,
} from '../src/query/sop-pipeline.js';

const lease: SopPipelineQueryLease = {
  releaseId: 'rel_synthetic_sop_1',
  sessionEpoch: 1,
  revoked: false,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

const projection: SopPipelineProjection = {
  schemaVersion: 'sop-release-v1',
  releaseId: 'rel_synthetic_sop_1',
  indexHash: 'a'.repeat(64),
  itemCount: 4,
  severityOrder: ['allergy', 'acne', 'quality-after-sale', 'minor-error-broken', 'tax'],
  definitions: [
    {
      sopId: 'synthetic-allergy',
      sceneId: 'synthetic-allergy',
      groupId: 'allergy',
      title: '合成过敏流程',
      entryStepId: 'step1',
      steps: [
        { stepId: 'step1', kind: 'instruction', sequence: 1, text: '第一步', media: [] },
        {
          stepId: 'A',
          kind: 'decision',
          sequence: 2,
          text: '由坐席选择',
          media: [],
        },
        { stepId: 'A1', kind: 'instruction', sequence: 3, text: '分支 A', media: ['med-a'] },
      ],
      branches: [{ branchId: 'branch-a', sourceStepId: 'A', label: '选择 A', targetStepId: 'A1' }],
    },
    {
      sopId: 'synthetic-acne',
      sceneId: 'synthetic-acne',
      groupId: 'acne',
      title: '合成长痘流程',
      entryStepId: 'start',
      steps: [{ stepId: 'start', kind: 'instruction', sequence: 1, text: '开始', media: [] }],
      branches: [],
    },
  ],
  searchEntries: [
    { entryId: 'allergy-route', sceneId: 'synthetic-allergy', stepId: 'step1', purpose: 'classify', text: '过敏流程', normalizedText: '过敏流程' },
    { entryId: 'acne-route', sceneId: 'synthetic-acne', stepId: 'start', purpose: 'classify', text: '长痘痘流程', normalizedText: '长痘痘流程' },
  ],
};

function queryText(pipeline: SopPipeline, text: string, current: SopPipelineQueryLease = lease): QueryOutcome {
  return pipeline.query({ queryId: 'query-synthetic-1', text, lease: current });
}

describe('SopPipeline', () => {
  it('returns only the SOP outcome variant and applies the configured complete severity order', () => {
    const pipeline = new SopPipeline(projection);
    const outcome = queryText(pipeline, '客户问长痘痘流程和过敏流程');
    expect(validateQueryOutcome(outcome).ok).toBe(true);
    expect(outcome.kind).toBe('sop');
    if (outcome.kind !== 'sop') throw new Error('expected sop outcome');
    expect(outcome.flow.sopId).toBe('synthetic-allergy');
    expect('candidates' in outcome).toBe(false);
  });

  it('rejects an absent severity order instead of choosing a default', () => {
    const pipeline = new SopPipeline({ ...projection, severityOrder: null });
    expect(queryText(pipeline, '过敏流程')).toMatchObject({
      kind: 'failure',
      failureCode: 'SOP_SEVERITY_ORDER_REQUIRED',
      retryable: false,
    });
  });

  it('rejects a partial or duplicate severity order', () => {
    expect(() => new SopPipeline({
      ...projection,
      severityOrder: ['allergy', 'acne'],
    })).toThrow('SOP_SEVERITY_ORDER_INVALID');
    expect(() => new SopPipeline({
      ...projection,
      severityOrder: ['allergy', 'allergy', 'quality-after-sale', 'minor-error-broken', 'tax'],
    })).toThrow('SOP_SEVERITY_ORDER_INVALID');
  });

  it('returns no-hit for a non-SOP question instead of ordinary content candidates', () => {
    expect(queryText(new SopPipeline(projection), '怎么开发票')).toEqual({
      kind: 'no-hit',
      queryId: 'query-synthetic-1',
      reason: 'SOP_NOT_MATCHED',
    });
  });

  it('fails closed after release change, revocation, or expiry', () => {
    const pipeline = new SopPipeline(projection);
    expect(queryText(pipeline, '过敏流程', { ...lease, releaseId: 'rel_other' })).toMatchObject({
      kind: 'failure',
      failureCode: 'SOP_RELEASE_CHANGED',
    });
    expect(queryText(pipeline, '过敏流程', { ...lease, revoked: true })).toMatchObject({
      kind: 'failure',
      failureCode: 'SOP_REVOKED',
    });
    expect(queryText(pipeline, '过敏流程', { ...lease, expiresAt: '2020-01-01T00:00:00.000Z' })).toMatchObject({
      kind: 'failure',
      failureCode: 'SOP_EXPIRED',
    });
  });

  it('does not choose a sales-agent branch when several valid paths exist', () => {
    const pipeline = new SopPipeline(projection);
    const outcome = queryText(pipeline, '过敏流程');
    expect(outcome.kind).toBe('sop');
    if (outcome.kind !== 'sop') throw new Error('expected sop outcome');
    expect(outcome.flow.branches).toHaveLength(1);
    expect(outcome.flow.steps.find((step) => step.stepId === 'A')?.kind).toBe('decision');
  });

  it('uses every configured severity permutation as the only conflict authority', () => {
    const groups: readonly SopGroupId[] = [
      'allergy',
      'acne',
      'quality-after-sale',
      'minor-error-broken',
      'tax',
    ];
    const allScenes: SopPipelineProjection = {
      ...projection,
      severityOrder: groups,
      definitions: groups.map((groupId) => ({
        sopId: `synthetic-${groupId}`,
        sceneId: `synthetic-${groupId}`,
        groupId,
        title: `合成 ${groupId}`,
        entryStepId: 'start',
        steps: [{ stepId: 'start', kind: 'instruction', sequence: 1, text: '开始', media: [] }],
        branches: [],
      })),
      searchEntries: groups.map((groupId) => ({
        entryId: `route-${groupId}`,
        sceneId: `synthetic-${groupId}`,
        stepId: 'start',
        purpose: 'classify',
        text: `合成${groupId}`,
        normalizedText: `合成${groupId}`,
      })),
    };
    const permutations = (values: readonly SopGroupId[]): SopGroupId[][] => values.length === 0
      ? [[]]
      : values.flatMap((value, index) =>
          permutations(values.filter((_, current) => current !== index))
            .map((tail) => [value, ...tail]));
    for (const order of permutations(groups)) {
      const pipeline = new SopPipeline({ ...allScenes, severityOrder: order });
      const outcome = queryText(pipeline, groups.map((groupId) => `合成${groupId}`).join(' '));
      expect(outcome).toMatchObject({ kind: 'sop' });
      if (outcome.kind === 'sop') expect(outcome.flow.sopId).toBe(`synthetic-${order[0]}`);
    }
  });
});
