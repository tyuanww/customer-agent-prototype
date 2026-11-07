// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseSearchTransport, SOP_UNAVAILABLE_REASONS } from '../../src/main/integration/query-api-adapter';

const ordinary = {
  query_id: '00000000-0000-4000-8000-000000000001',
  hit_status: 'no_hit',
  release_id: 'release-synthetic',
  source_binding_hash: 'a'.repeat(64),
  telemetry_status: 'collection_disabled',
  candidates: [],
};

function sopBody(reason: string) {
  return {
    error: {
      code: 'OVERLOADED',
      message: '服务繁忙，请稍后重试',
      details: { reason: 'SOURCE_GATE_NOT_READY', sop_reason: reason, retry_after_sec: 1 },
    },
  };
}

describe('desktop query API boundary', () => {
  it('keeps ordinary 200 and no-hit candidates ordinary', () => {
    expect(parseSearchTransport({ status: 200, body: ordinary })).toEqual({
      kind: 'ordinary', response: ordinary, retryAfterSeconds: null,
    });
  });

  it.each(SOP_UNAVAILABLE_REASONS)('preserves the approved SOP fail-closed reason %s', (reason) => {
    expect(parseSearchTransport({ status: 503, body: sopBody(reason), retryAfter: '1' })).toEqual({
      kind: 'sop-unavailable', reason, retryAfterSeconds: 1,
    });
  });

  it('maps unknown or missing sop_reason to stable generic failure', () => {
    expect(parseSearchTransport({ status: 503, body: sopBody('UNKNOWN') })).toMatchObject({ kind: 'error', code: 'UNAVAILABLE' });
    expect(parseSearchTransport({ status: 503, body: { error: { code: 'OVERLOADED', message: 'x', details: { reason: 'SOURCE_GATE_NOT_READY' } } } }))
      .toMatchObject({ kind: 'error', code: 'UNAVAILABLE' });
  });

  it('does not manufacture candidates from malformed bodies or non-503 errors', () => {
    expect(parseSearchTransport({ status: 200, body: { candidates: ['bad'] } })).toMatchObject({ kind: 'error' });
    expect(parseSearchTransport({ status: 503, body: sopBody('SOP_UNAVAILABLE'), retryAfter: 'invalid' }))
      .toMatchObject({ kind: 'sop-unavailable', retryAfterSeconds: 1 });
    expect(parseSearchTransport({ status: 429, body: { candidates: [] }, retryAfter: '2' }))
      .toEqual({ kind: 'error', code: 'UNAVAILABLE', retryAfterSeconds: 2 });
  });
});
