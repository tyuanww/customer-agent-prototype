// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseQueryPlan } from '../../src/main/minimax-plan';

describe('minimax query plan parser', () => {
  it('keeps the original query and appends planned retrieval queries', () => {
    const plan = parseQueryPlan('{"intent":"shipping","queries":["发货时效","什么时候到"]}', '什么时候发货');
    expect(plan.intent).toBe('shipping');
    expect(plan.queries).toEqual(['什么时候发货', '发货时效', '什么时候到']);
  });

  it('falls back to the original query on invalid payload', () => {
    expect(parseQueryPlan('not json', '地址填错了').queries).toEqual(['地址填错了']);
    expect(parseQueryPlan('{"intent":"nope","queries":[1]}', '地址填错了').intent).toBe('other');
  });

  it('drops short, duplicate, and overlong planned queries and caps at three', () => {
    const plan = parseQueryPlan(JSON.stringify({
      intent: 'shipping',
      queries: ['x', '发货时效', '发货时效', 'a'.repeat(81), '什么时候到', '第四条'],
    }), '什么时候发货');
    expect(plan.queries).toEqual(['什么时候发货', '发货时效', '什么时候到']);
    expect(parseQueryPlan('{"intent":"shipping"}', '什么时候发货').queries).toEqual(['什么时候发货']);
  });

  it('keeps a long original customer sentence even when MiniMax returns short queries', () => {
    const original = `客服你好${'地址填错了麻烦改一下'.repeat(8)}`;
    expect(original.length).toBeGreaterThan(80);
    const plan = parseQueryPlan('{"intent":"address","queries":["改地址"]}', original);
    expect(plan.queries[0]).toBe(original);
    expect(plan.queries).toEqual([original, '改地址']);
  });
});
