import { describe, expect, it } from 'vitest';
import {
  assembleTrace,
  ObservabilityError,
  type ObservabilityErrorCode,
} from '../../src/observability/index.js';
import type { StageRecord } from '@customer-agent/unified-contracts';
import {
  makeQuery,
  makeStage,
  makeTrace,
} from './fixtures.js';

function expectCode(run: () => unknown, code: ObservabilityErrorCode): void {
  try {
    run();
    throw new Error('expected observability error');
  } catch (error) {
    expect(error).toBeInstanceOf(ObservabilityError);
    expect((error as ObservabilityError).code).toBe(code);
  }
}

describe('observability trace assembler', () => {
  it('orders ordinary stages and aggregates their duration', () => {
    const trace = makeTrace();
    const stages = [
      makeStage('request', trace, 'succeeded', null, 1),
      makeStage('access', trace, 'succeeded', null, 2),
      makeStage('release-read', trace, 'succeeded', null, 3),
      makeStage('recall', trace, 'succeeded', null, 4),
      makeStage('fusion', trace, 'succeeded', null, 5),
      makeStage('rerank', trace, 'succeeded', null, 6),
      makeStage('response-validation', trace, 'succeeded', null, 7),
      makeStage('transport', trace, 'succeeded', null, 8),
    ];
    const result = assembleTrace(makeQuery('ordinary', trace), stages);
    expect(result.status).toBe('complete');
    expect(result.totalDurationMs).toBe(36);
    expect(result.stageDurations.map((row) => row.stage)).toEqual([
      'request',
      'access',
      'release-read',
      'recall',
      'fusion',
      'rerank',
      'response-validation',
      'transport',
    ]);
  });

  it('rejects duplicate, out-of-order, late, and unrelated stages', () => {
    const trace = makeTrace();
    const query = makeQuery('ordinary', trace);

    expectCode(() => assembleTrace(query, [
      makeStage('request', trace),
      makeStage('request', trace),
    ]), 'TRACE_STAGE_DUPLICATE');

    expectCode(() => assembleTrace(query, [
      makeStage('access', trace),
      makeStage('request', trace),
    ]), 'TRACE_STAGE_OUT_OF_ORDER');

    expectCode(() => assembleTrace(query, [
      makeStage('transport', trace, 'failed', 'SYNTHETIC_FAILURE'),
      makeStage('copy', trace),
    ]), 'TRACE_ALREADY_TERMINAL');

    expectCode(() => assembleTrace(query, [
      makeStage('request', makeTrace('ordinary', 'other')),
    ]), 'TRACE_STAGE_UNRELATED');
  });

  it('reports cancellation and incomplete traces without inventing success', () => {
    const trace = makeTrace();
    const query = makeQuery('ordinary', trace);
    expect(assembleTrace(query, [
      makeStage('request', trace),
      makeStage('access', trace, 'cancelled', 'CANCELLED'),
    ]).status).toBe('cancelled');
    expect(assembleTrace(query, [
      makeStage('request', trace),
    ]).status).toBe('incomplete');
    expect(assembleTrace(query, []).status).toBe('incomplete');
  });

  it('rejects stages outside the query kind and above the cardinality limit', () => {
    const ordinary = makeTrace();
    expectCode(() => assembleTrace(makeQuery('ordinary', ordinary), [
      {
        ...makeStage('request', ordinary),
        stage: 'sop-match',
      } as StageRecord,
    ]), 'TRACE_STAGE_NOT_APPLICABLE');

    const sop = makeTrace('sop');
    expectCode(() => assembleTrace(makeQuery('sop', sop), [
      makeStage('request', sop),
      makeStage('access', sop),
    ], 1), 'TRACE_STAGE_LIMIT');
  });
});
