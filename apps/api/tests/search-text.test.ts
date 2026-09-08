import { describe, expect, it } from 'vitest';
import {
  hmacRedactedQuery,
  isEntityFreeGenericSearchText,
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

  it('separates entity-free generic intent from scoped business questions', () => {
    expect(isEntityFreeGenericSearchText('请问怎么用呢')).toBe(true);
    expect(isEntityFreeGenericSearchText('活动规则是什么')).toBe(true);
    expect(isEntityFreeGenericSearchText('%')).toBe(false);
    expect(isEntityFreeGenericSearchText('星澜洁面露怎么用')).toBe(false);
    expect(isEntityFreeGenericSearchText('云朵会员周活动什么时候结束')).toBe(false);
  });

  it.each([
    '这类服务问题该如何解决',
    '请问这种情况怎么处理呢',
    '怎么解决这类质量问题',
    '麻烦问一下那个问题应该如何处理',
    '这个该怎么办',
    '售前问题如何处理',
  ])('suppresses unresolved support references: %s', (query) => {
    expect(isEntityFreeGenericSearchText(query)).toBe(true);
  });

  it.each([
    '合成收纳袋拉链卡住这个问题怎么处理',
    '这类质量问题怎么申请退款',
    '这个商品开封后还能退吗',
    '合成面霜泵头按不出来该怎么处理',
    '这个问题会不会影响退款',
    '订单延迟怎么处理',
  ])('keeps a concrete object, symptom or operation: %s', (query) => {
    expect(isEntityFreeGenericSearchText(query)).toBe(false);
  });

  it('binds the normalized redacted text to a secret and key version', () => {
    expect(hmacRedactedQuery('[REDACTED]，退款', 'hmac-v1', 'synthetic-test-key'))
      .toBe('f1c43255846110026686a6d33d729f484fdc4063b79d50d2eaa58f1faefa14b0');
    expect(() => hmacRedactedQuery('safe', ' hmac-v1', 'synthetic-test-key'))
      .toThrow(RangeError);
  });
});
