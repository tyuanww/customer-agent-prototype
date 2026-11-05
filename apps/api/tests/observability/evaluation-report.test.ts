import { describe, expect, it } from 'vitest';
import {
  parseEvaluationRecord,
  type EvaluationRecord,
} from '@customer-agent/unified-contracts';
import {
  BUDGET_SURFACES,
  ObservabilityError,
  aggregateEvaluationGroup,
  aggregateEvaluationPair,
  buildObservabilityReport,
  renderObservabilityReport,
  summarizeLatency,
  type LatencySummary,
} from '../../src/observability/index.js';
import { TEST_TIME } from './fixtures.js';

type OrdinaryRecord = Extract<EvaluationRecord, { kind: 'ordinary' }>;
type SopRecord = Extract<EvaluationRecord, { kind: 'sop' }>;

function ordinaryRecord(samples: number, recallAtK: number, errors = 0): OrdinaryRecord {
  return parseEvaluationRecord({
    kind: 'ordinary',
    datasetId: 'ordinary-dataset',
    datasetVersion: 1,
    samples,
    errors,
    limiter: 'dataset-size',
    metrics: {
      recallAtK,
      topK: 3,
      noHitCount: 2,
      responseValidationFailureCount: errors,
    },
  }) as OrdinaryRecord;
}

function sopRecord(samples: number): SopRecord {
  return parseEvaluationRecord({
    kind: 'sop',
    datasetId: 'sop-dataset',
    datasetVersion: 1,
    samples,
    errors: 0,
    limiter: 'dataset-size',
    metrics: {
      matchedCount: samples - 2,
      validPathCount: samples - 3,
      validBranchCount: samples - 4,
      staleReleaseRejectedCount: 1,
      unauthorizedResourceRejectedCount: 1,
    },
  }) as SopRecord;
}

function latencyFixtures(): LatencySummary[] {
  return BUDGET_SURFACES.flatMap((surface) => (
    (['warm', 'cold'] as const).map((temperature) => {
      const samples = temperature === 'warm' ? 200 : 20;
      return summarizeLatency({
        surface,
        stage: surface === 'dashboard-acceptance' ? 'dashboard-operation' : 'transport',
        budgetClass: 'interactive',
        temperature,
        limiter: 'synthetic-fixture-v1',
        observations: Array.from({ length: samples }, (_, index) => ({
          durationMs: 10 + index,
          error: index === 0,
        })),
      });
    })
  ));
}

describe('observability evaluation aggregation', () => {
  it('aggregates a fixed dataset and keeps ordinary and SOP sections separate', () => {
    const pair = aggregateEvaluationPair(
      [ordinaryRecord(100, 0.8, 1), ordinaryRecord(100, 1, 0)],
      [sopRecord(150), sopRecord(50)],
    );
    expect(pair.ordinary).toMatchObject({
      kind: 'ordinary',
      datasetId: 'ordinary-dataset',
      samples: 200,
      errors: 1,
      metrics: { recallAtK: 0.9, topK: 3, noHitCount: 4 },
    });
    expect(pair.sop).toMatchObject({
      kind: 'sop',
      datasetId: 'sop-dataset',
      samples: 200,
      metrics: { matchedCount: 196, validPathCount: 194 },
    });
  });

  it('rejects empty, mixed-kind, mixed-dataset, and mixed-limiter groups', () => {
    expect(() => aggregateEvaluationGroup([], 'ordinary')).toThrowError(ObservabilityError);
    expect(() => aggregateEvaluationGroup(
      [ordinaryRecord(10, 1), sopRecord(10)],
      'ordinary',
    )).toThrowError(ObservabilityError);
    expect(() => aggregateEvaluationGroup([
      ordinaryRecord(10, 1),
      parseEvaluationRecord({
        ...ordinaryRecord(10, 1),
        datasetVersion: 2,
      }),
    ], 'ordinary')).toThrowError(ObservabilityError);
    expect(() => aggregateEvaluationGroup([
      ordinaryRecord(10, 1),
      parseEvaluationRecord({
        ...ordinaryRecord(10, 1),
        limiter: 'time-budget',
      }),
    ], 'ordinary')).toThrowError(ObservabilityError);
  });
});

describe('observability report rendering', () => {
  it('rebuilds deterministic JSON and Markdown with all required latency coverage', () => {
    const evaluations = aggregateEvaluationPair(
      [ordinaryRecord(200, 0.93, 1)],
      [sopRecord(200)],
    );
    const report = buildObservabilityReport({
      observedAt: TEST_TIME,
      latency: latencyFixtures(),
      alerts: [],
      traceStatusCounts: {
        ordinary: {
          complete: 200,
          incomplete: 0,
          cancelled: 0,
          failed: 0,
          stale: 0,
          unknown: 0,
        },
        sop: {
          complete: 200,
          incomplete: 0,
          cancelled: 0,
          failed: 0,
          stale: 0,
          unknown: 0,
        },
      },
      evaluations,
    });
    const first = renderObservabilityReport(report);
    const second = renderObservabilityReport(report);
    expect(first).toEqual(second);
    expect(first.json).toContain('"schemaVersion": 1');
    expect(first.markdown).toContain('| ordinary-query | warm | 200 |');
    expect(first.json).not.toContain('raw question');
    expect(first.json).not.toContain('answerText');
  });

  it('rejects incomplete latency coverage', () => {
    const latency = latencyFixtures();
    expect(() => buildObservabilityReport({
      observedAt: TEST_TIME,
      latency: latency.slice(1),
      alerts: [],
      traceStatusCounts: {
        ordinary: {
          complete: 1, incomplete: 0, cancelled: 0, failed: 0, stale: 0, unknown: 0,
        },
        sop: {
          complete: 1, incomplete: 0, cancelled: 0, failed: 0, stale: 0, unknown: 0,
        },
      },
      evaluations: aggregateEvaluationPair([ordinaryRecord(20, 1)], [sopRecord(20)]),
    })).toThrowError(ObservabilityError);
  });
});
