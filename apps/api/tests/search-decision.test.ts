import { describe, expect, it } from 'vitest';
import { judgeSearch } from '../src/search-decision.js';

function candidate(
  scriptId: string,
  title: string,
  question: string,
  fallback: string,
) {
  return Object.freeze({
    scriptId,
    title,
    answerText: `合成回答 ${scriptId}`,
    questionTexts: Object.freeze([question]),
    searchFallbackText: fallback,
  });
}

describe('search decision', () => {
  it('does not glue title/question fragments into a false shipping match', () => {
    const pool = [
      candidate('s01', '合成配送说明一', '什么时候发货', '什么时候发货 合成配送说明一'),
      candidate('s03', '合成配送说明三', '请问什么时候发货呢', '请问什么时候发货呢 合成配送说明三'),
      candidate('s13', '可以不退货', '可以不退货', '可以不退货'),
      candidate('s19', '杯退货流程', '杯退货流程', '杯退货流程'),
    ];
    const result = judgeSearch('我想了解合成分类专用,请说明流程', pool);
    expect(result.decision).toBe('reject');
    expect(result.shownScriptIds).toEqual([]);
  });

  it('rejects inverted desk/visitor deposit roles while showing the confirmation', () => {
    const badge = candidate(
      'badge',
      '借用证押金退还流程',
      '借用证押金退还流程',
      '访客离馆时将借用证交回前台；前台收到借用证并核对后，向访客退还押金。',
    );
    expect(judgeSearch('借用证交回核对完成后，访客向前台退还押金', [badge]).decision).toBe('reject');
    expect(judgeSearch('借用证交回核对完成后，是访客向前台退还押金吗', [badge])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['badge'],
    });
  });

  it('rejects a box-quantity assertion that inverts the gift rule', () => {
    const notes = candidate(
      'notes',
      '便签赠送活动',
      '便签赠送活动',
      '购买五盒便签赠送两盒同款便签。赠品不能兑换现金。',
    );
    expect(judgeSearch('便签购买两盒赠送五盒', [notes]).decision).toBe('reject');
    expect(judgeSearch('便签活动是买两盒送五盒，对不对', [notes]).decision).toBe('show');
  });

  it('treats a quoted fragment as clarify, not as an assertion', () => {
    const badge = candidate(
      'badge',
      '借用证押金退还流程',
      '借用证押金退还流程',
      '访客离馆时将借用证交回前台；前台收到借用证并核对后，向访客退还押金。',
    );
    expect(judgeSearch('“访客给前台退押金”这一句', [badge]).decision).toBe('clarify_or_no_result');
  });

  it('keeps an assertion of inverted invoice roles rejected', () => {
    const invoice = candidate(
      'invoice',
      '发票申请与开具责任',
      '发票申请与开具责任',
      '采购方向供货方申请发票；供货方向采购方开具发票。',
    );
    const assertion = judgeSearch('采购方向供货方开具发票', [invoice]);
    const confirmation = judgeSearch('采购方需要给供货方开具发票吗', [invoice]);
    expect(assertion.decision).toBe('reject');
    expect(confirmation.decision).toBe('show');
    expect(confirmation.shownScriptIds).toEqual(['invoice']);
  });
});
