import { describe, expect, it } from 'vitest';
import { prepareIdempotencyHashes } from '../src/idempotency.js';

const keyRing = Object.freeze({
  currentVersion: 'hmac-idempotency-v2',
  keys: Object.freeze({
    'hmac-idempotency-v1': 'synthetic-idempotency-unit-key-old-0001',
    'hmac-idempotency-v2': 'synthetic-idempotency-unit-key-new-0002',
  }),
});

describe('idempotency request hashes', () => {
  it('canonicalizes object key order while retaining every configured replay version', () => {
    const left = prepareIdempotencyHashes({ query_id: 'synthetic', action: 'open_feishu' }, keyRing);
    const right = prepareIdempotencyHashes({ action: 'open_feishu', query_id: 'synthetic' }, keyRing);

    expect(left).toEqual(right);
    expect(left.currentVersion).toBe('hmac-idempotency-v2');
    expect(Object.keys(left.hashes)).toEqual(['hmac-idempotency-v1', 'hmac-idempotency-v2']);
    expect(Object.values(left.hashes)).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
    expect(Object.isFrozen(left.hashes)).toBe(true);
  });

  it('binds arrays, nulls and changed values without retaining request material', () => {
    const first = prepareIdempotencyHashes({
      query_text: '合成问题一', context: null, ranks: [1, 2, 3],
    }, keyRing);
    const changed = prepareIdempotencyHashes({
      query_text: '合成问题二', context: null, ranks: [1, 2, 3],
    }, keyRing);

    expect(first.hashes['hmac-idempotency-v2']).not.toBe(changed.hashes['hmac-idempotency-v2']);
    expect(JSON.stringify(first)).not.toContain('合成问题一');
  });

  it('rejects non-finite values instead of inventing a digest', () => {
    expect(() => prepareIdempotencyHashes({ invalid: Number.NaN }, keyRing)).toThrow(
      'Canonical JSON rejects non-finite numbers',
    );
  });
});
