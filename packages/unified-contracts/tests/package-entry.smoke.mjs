import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCESS_ROLES,
  parseAlertRecord,
  parseEvaluationRecord,
  parseQueryTelemetryRecord,
  parseStageRecord,
  parseTraceIdentity,
  parseOperationEnvelope,
  parseQueryOutcome,
} from '@customer-agent/unified-contracts';

test('compiled unified contract package loads in the supported Node runtime', () => {
  assert.deepEqual(ACCESS_ROLES, [
    'agent',
    'director',
    'enabler',
    'engineer',
    'lead',
    'manager',
    'supervisor',
  ]);
  assert.equal(parseQueryOutcome({
    kind: 'no-hit',
    queryId: 'query-1',
    reason: 'weak-hit',
  }).kind, 'no-hit');
  assert.equal(parseOperationEnvelope({
    operationId: 'operation-1',
    actor: { userId: 'user-1', sessionEpoch: 1 },
    command: 'query',
    requestHash: 'a'.repeat(64),
    idempotencyKey: 'idempotency-1',
    expectedVersion: 1,
    accessRevision: 1,
    cancellation: {
      mode: 'cooperative',
      deadline: '2026-11-05T08:00:05Z',
    },
    createdAt: '2026-11-05T08:00:00Z',
    recoveryDeadline: '2026-11-05T08:05:00Z',
  }).operationId, 'operation-1');
  const trace = parseTraceIdentity({
    requestId: 'request-1',
    operationId: null,
    queryId: 'query-1',
    parentQueryId: null,
    sessionEpoch: null,
    generation: null,
    releaseId: 'release-1',
    kind: 'ordinary',
  });
  assert.equal(trace.kind, 'ordinary');
  assert.equal(parseQueryTelemetryRecord({
    trace,
    kind: 'ordinary',
    releaseId: 'release-1',
    queryFingerprint: 'c'.repeat(64),
    queryLength: 12,
    intent: 'product',
  }).queryFingerprint, 'c'.repeat(64));
  assert.equal(parseStageRecord({
    trace,
    stage: 'recall',
    startedAt: '2026-11-05T08:00:00Z',
    durationMs: 0,
    outcome: 'succeeded',
    errorCode: null,
    budgetClass: 'interactive',
    external: false,
  }).durationMs, 0);
  assert.equal(parseEvaluationRecord({
    kind: 'ordinary',
    datasetId: 'synthetic-ordinary-eval',
    datasetVersion: 1,
    samples: 2,
    metrics: {
      recallAtK: 0.5,
      topK: 3,
      noHitCount: 1,
      responseValidationFailureCount: 0,
    },
    errors: 0,
    limiter: 'none',
  }).kind, 'ordinary');
  assert.equal(parseAlertRecord({
    kind: 'unknown_operation',
    observedAt: '2026-11-05T08:00:00Z',
    operationId: 'operation-unknown',
    reasonCode: 'UNREGISTERED',
  }).kind, 'unknown_operation');
});
