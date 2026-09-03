import { describe, expect, it } from 'vitest';
import {
  hmacRedactedQuery,
  normalizeSearchText,
  unicodeBigramTokens,
} from '../src/search-text.js';

describe('DEV-M1 Chinese search text contract', () => {
  it.each([
    ['ＡＢＣ　客服，退款', 'abc 客服,退款'],
    ['  活动  什么时候结束？ ', '活动 什么时候结束?'],
    ['【售后】　换货', '[售后] 换货'],
    ['Ｔ恤　XL', 't恤 xl'],
  ])('normalizes %s with the frozen order', (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected);
  });

  it('generates overlapping bigrams within alphanumeric segments only', () => {
    expect(unicodeBigramTokens('退款进度')).toEqual(['退款', '款进', '进度']);
    expect(unicodeBigramTokens('a🦊b 客服')).toEqual(['客服']);
    expect(unicodeBigramTokens('abc-12')).toEqual(['ab', 'bc', '12']);
    expect(unicodeBigramTokens('单')).toEqual([]);
  });

  it('binds the normalized redacted text to a secret and key version', () => {
    expect(hmacRedactedQuery('[REDACTED]，退款', 'hmac-v1', 'synthetic-test-key'))
      .toBe('f1c43255846110026686a6d33d729f484fdc4063b79d50d2eaa58f1faefa14b0');
    expect(() => hmacRedactedQuery('safe', ' hmac-v1', 'synthetic-test-key'))
      .toThrow(RangeError);
  });
});
