import {
  parseQueryTelemetryRecord,
  parseStageRecord,
  parseTraceIdentity,
} from '@customer-agent/unified-contracts';
import type {
  ObservabilityStage,
  StageOutcome,
  TraceIdentity,
} from '@customer-agent/unified-contracts';

export const TEST_RELEASE = 'rel_obs_test';
export const TEST_TIME = '2026-11-05T00:00:00.000Z';

export function makeTrace(
  kind: 'ordinary' | 'sop' = 'ordinary',
  suffix = '1',
): TraceIdentity {
  return parseTraceIdentity({
    requestId: `req-${suffix}`,
    operationId: null,
    queryId: `query-${suffix}`,
    parentQueryId: null,
    sessionEpoch: 1,
    generation: 1,
    releaseId: TEST_RELEASE,
    kind,
  });
}

export function makeQuery(
  kind: 'ordinary' | 'sop' = 'ordinary',
  trace: TraceIdentity = makeTrace(kind),
) {
  return parseQueryTelemetryRecord({
    trace,
    kind,
    releaseId: TEST_RELEASE,
    queryFingerprint: 'a'.repeat(64),
    queryLength: 12,
    intent: kind === 'sop' ? 'sop' : 'product',
  });
}

export function makeStage(
  stage: ObservabilityStage,
  trace: TraceIdentity,
  outcome: StageOutcome = 'succeeded',
  errorCode: string | null = null,
  durationMs = 1,
) {
  return parseStageRecord({
    trace,
    stage,
    startedAt: TEST_TIME,
    durationMs,
    outcome,
    errorCode,
    budgetClass: 'interactive',
    external: false,
  });
}
