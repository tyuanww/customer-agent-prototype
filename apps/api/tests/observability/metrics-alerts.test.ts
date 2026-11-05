import { describe, expect, it } from 'vitest';
import {
  parseAlertRecord,
  type OperationId,
  type ReleaseId,
} from '@customer-agent/unified-contracts';
import {
  BUDGET_SURFACES,
  DEFAULT_OBSERVABILITY_BUDGETS,
  ObservabilityError,
  buildAlertRecords,
  evaluateBudget,
  summarizeLatency,
  type LatencyBatch,
} from '../../src/observability/index.js';
import {
  TEST_TIME,
  makeTrace,
} from './fixtures.js';

function batch(
  surface: LatencyBatch['surface'],
  temperature: LatencyBatch['temperature'],
  durations: readonly number[],
): LatencyBatch {
  return Object.freeze({
    surface,
    stage: surface === 'dashboard-acceptance' ? 'dashboard-operation' : 'transport',
    budgetClass: 'interactive',
    temperature,
    limiter: 'synthetic-unit-fixture',
    observations: Object.freeze(durations.map((durationMs) => ({
      durationMs,
      error: false,
    }))),
  });
}

describe('observability percentiles and budgets', () => {
  it('returns deterministic nearest-rank p50, p95, and p99 values', () => {
    const summary = summarizeLatency(batch(
      'ordinary-query',
      'warm',
      Array.from({ length: 100 }, (_, index) => index + 1),
    ));
    expect(summary).toMatchObject({
      sampleCount: 100,
      errorCount: 0,
      p50Ms: 50,
      p95Ms: 95,
      p99Ms: 99,
      temperature: 'warm',
      limiter: 'synthetic-unit-fixture',
    });
  });

  it('uses injected program defaults and rejects empty or invalid batches', () => {
    expect(DEFAULT_OBSERVABILITY_BUDGETS).toEqual({
      'ordinary-query': 500,
      'sop-query': 250,
      'dashboard-acceptance': 300,
      'overlay-dispatch': 50,
    });
    const summary = summarizeLatency(batch('ordinary-query', 'cold', [501]));
    expect(evaluateBudget(summary).breached).toBe(true);
    expect(evaluateBudget(summary, {
      ...DEFAULT_OBSERVABILITY_BUDGETS,
      'ordinary-query': 600,
    }).breached).toBe(false);
    expect(() => summarizeLatency(batch('ordinary-query', 'warm', [])))
      .toThrowError(ObservabilityError);
    expect(() => summarizeLatency(batch('ordinary-query', 'warm', [Number.NaN])))
      .toThrowError(ObservabilityError);
  });
});

describe('observability alert aggregation', () => {
  it('emits every alert kind from typed observations without owning domain state', () => {
    const latency = BUDGET_SURFACES.flatMap((surface) => (
      (['warm', 'cold'] as const).map((temperature) => summarizeLatency(
        batch(surface, temperature, [1_000]),
      ))
    ));
    const staleTrace = makeTrace();
    const alerts = buildAlertRecords({
      observedAt: TEST_TIME,
      latency,
      unknownOperations: [{
        observedAt: TEST_TIME,
        operationId: 'op_unknown' as OperationId,
        reasonCode: 'UNKNOWN_OPERATION',
      }],
      deadLetters: [{
        observedAt: TEST_TIME,
        queue: 'content-parse',
        previousDepth: 1,
        currentDepth: 3,
      }, {
        observedAt: TEST_TIME,
        queue: 'release-index',
        previousDepth: 2,
        currentDepth: 2,
      }],
      staleReleases: [{
        observedAt: TEST_TIME,
        trace: staleTrace,
        expectedReleaseId: 'rel_expected' as ReleaseId,
      }],
      releaseIndexFailures: [{
        observedAt: TEST_TIME,
        releaseId: 'rel_broken' as ReleaseId,
        projection: 'content',
        errorCode: 'INDEX_FAILED',
      }],
    });
    expect(new Set(alerts.map((alert) => alert.kind))).toEqual(new Set([
      'budget_breach',
      'unknown_operation',
      'dead_letter_growth',
      'stale_release',
      'release_index_failure',
    ]));
    expect(alerts.filter((alert) => alert.kind === 'dead_letter_growth')).toHaveLength(1);
    for (const alert of alerts) expect(parseAlertRecord(alert).kind).toBe(alert.kind);
  });

  it('rejects stale release observations that do not identify a change', () => {
    const trace = makeTrace();
    expect(() => buildAlertRecords({
      observedAt: TEST_TIME,
      latency: [],
      unknownOperations: [],
      deadLetters: [],
      staleReleases: [{
        observedAt: TEST_TIME,
        trace,
        expectedReleaseId: trace.releaseId as ReleaseId,
      }],
      releaseIndexFailures: [],
    })).toThrowError(ObservabilityError);
  });
});
