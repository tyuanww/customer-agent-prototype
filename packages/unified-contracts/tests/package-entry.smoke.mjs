import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCESS_ROLES,
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
});
