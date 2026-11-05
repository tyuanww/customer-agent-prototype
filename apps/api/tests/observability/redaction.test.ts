import { describe, expect, it } from 'vitest';
import {
  assembleTrace,
  redactQueryTelemetry,
  redactStageRecord,
  serializeAssembledTrace,
  serializeQueryTelemetry,
  serializeStageRecord,
} from '../../src/observability/index.js';
import type {
  QueryTelemetryRecord,
  StageRecord,
} from '../../../../packages/unified-contracts/src/index.ts';
import {
  makeQuery,
  makeStage,
  makeTrace,
} from './fixtures.js';

describe('observability redaction and serialization', () => {
  it('drops unknown fields and never serializes raw query, answer, or customer data', () => {
    const rawQuery = {
      ...makeQuery(),
      question: 'raw customer question',
      customerId: 'customer-secret',
    } as unknown as QueryTelemetryRecord;
    const redactedQuery = redactQueryTelemetry(rawQuery);
    const serializedQuery = serializeQueryTelemetry(rawQuery);
    expect(redactedQuery).not.toHaveProperty('question');
    expect(serializedQuery).not.toContain('raw customer question');
    expect(serializedQuery).not.toContain('customer-secret');

    const trace = makeTrace();
    const rawStage = {
      ...makeStage('request', trace),
      answerText: 'raw answer',
      orderId: 'order-secret',
      path: '/private/file.xlsx',
    } as unknown as StageRecord;
    const serializedStage = serializeStageRecord(rawStage);
    expect(redactStageRecord(rawStage)).not.toHaveProperty('answerText');
    expect(serializedStage).not.toContain('raw answer');
    expect(serializedStage).not.toContain('order-secret');
    expect(serializedStage).not.toContain('/private/file.xlsx');
  });

  it('serializes stable field order and assembled traces deterministically', () => {
    const trace = makeTrace();
    const query = makeQuery('ordinary', trace);
    const left = serializeQueryTelemetry(query);
    const right = serializeQueryTelemetry(makeQuery());
    expect(left).toBe(right);

    const assembled = assembleTrace(query, [
      makeStage('request', trace, 'succeeded', null, 2),
      makeStage('transport', trace, 'succeeded', null, 3),
    ]);
    expect(serializeAssembledTrace(assembled)).toBe(serializeAssembledTrace(assembled));
    expect(serializeAssembledTrace(assembled)).toContain('"status": "complete"');
  });
});
