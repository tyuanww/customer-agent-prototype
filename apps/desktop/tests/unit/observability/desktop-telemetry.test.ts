import { describe, expect, it } from 'vitest';
import {
  parseStageRecord,
  parseTraceIdentity,
} from '@customer-agent/unified-contracts';
import {
  DesktopObservabilityInputError,
  observeDashboardStage,
  observeDesktopCopy,
  observeOverlayDispatch,
} from '../../../src/main/observability/desktop-telemetry';

const trace = parseTraceIdentity({
  requestId: 'req-desktop',
  operationId: 'op-desktop',
  queryId: 'query-desktop',
  parentQueryId: null,
  sessionEpoch: 1,
  generation: 2,
  releaseId: 'rel-desktop',
  kind: 'ordinary',
});

describe('desktop observability adapters', () => {
  it('convert copy, overlay, and Dashboard measurements into contract stages', () => {
    const copy = parseStageRecord(observeDesktopCopy({
      trace,
      startedAt: '2026-11-05T00:00:00.000Z',
      durationMs: 12,
      outcome: 'succeeded',
      errorCode: null,
    }));
    expect(copy).toMatchObject({
      stage: 'copy',
      trace,
      budgetClass: 'interactive',
      outcome: 'succeeded',
    });
    expect(parseStageRecord(observeDesktopCopy({
      trace,
      startedAt: '2026-11-05T00:00:00.000Z',
      durationMs: 9,
      outcome: 'stale',
      errorCode: 'STALE_COPY',
    }))).toMatchObject({
      stage: 'copy',
      outcome: 'stale',
      errorCode: 'STALE_COPY',
    });

    const overlay = parseStageRecord(observeOverlayDispatch({
      startedAt: '2026-11-05T00:00:00.000Z',
      durationMs: 8,
      outcome: 'succeeded',
      errorCode: null,
    }));
    expect(overlay).toMatchObject({ stage: 'transport', trace: null });

    const dashboard = parseStageRecord(observeDashboardStage('dashboard-operation', {
      startedAt: '2026-11-05T00:00:00.000Z',
      durationMs: 20,
      outcome: 'cancelled',
      errorCode: 'USER_CANCELLED',
    }));
    expect(dashboard).toMatchObject({
      stage: 'dashboard-operation',
      outcome: 'cancelled',
      errorCode: 'USER_CANCELLED',
    });
  });

  it('fails closed on invalid durations and outcome/error combinations', () => {
    expect(() => observeOverlayDispatch({
      startedAt: '2026-11-05T00:00:00.000Z',
      durationMs: -1,
      outcome: 'succeeded',
      errorCode: null,
    })).toThrowError(DesktopObservabilityInputError);
    expect(() => observeOverlayDispatch({
      startedAt: '2026-11-05T00:00:00.000Z',
      durationMs: 1,
      outcome: 'failed',
      errorCode: null,
    })).toThrowError(DesktopObservabilityInputError);
    expect(() => observeDesktopCopy({
      trace,
      startedAt: '2026-11-05T00:00:00.000Z',
      durationMs: 1,
      outcome: 'succeeded',
      errorCode: 'NOT_ALLOWED',
    })).toThrowError(DesktopObservabilityInputError);
  });
});
