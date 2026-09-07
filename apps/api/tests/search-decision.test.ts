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
    expect(judgeSearch('便签购买三盒赠送两盒，对吗', [notes]).decision).toBe('show');
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

  it('does not show out-of-scope queries that only share a title span or topic grams', () => {
    const headset = candidate(
      'headset',
      '耳麦接口兼容范围',
      '耳麦接口兼容范围',
      '此耳麦仅支持USB-C接口，不支持无线蓝牙连接。',
    );
    const refund = candidate(
      'refund',
      '共享雨伞押金退回',
      '共享雨伞押金退回',
      '租借人向门店支付押金；归还雨伞并完成检查后，门店向租借人退回押金。',
    );
    const invoice = candidate(
      'invoice',
      '发票申请与开具责任',
      '发票申请与开具责任',
      '采购方向供货方申请发票；供货方向采购方开具发票。',
    );
    const booking = candidate(
      'booking',
      '预约取消时间',
      '预约取消时间',
      '预约开始前可以申请取消；预约开始后不接受取消申请。',
    );
    const router = candidate(
      'router',
      '路由器恢复出厂设置',
      '路由器恢复出厂设置',
      '恢复出厂设置会删除自定义网络名称和上网账号，不会改变路由器硬件版本。',
    );
    const pool = [headset, refund, invoice, booking, router];
    expect(judgeSearch('竞品耳麦接口兼容范围', pool).shownScriptIds).toEqual([]);
    expect(judgeSearch('猫耳麦接口兼容范围', pool).shownScriptIds).toEqual([]);
    expect(judgeSearch('共享雨伞以外的商品怎么退押金', pool).shownScriptIds).toEqual([]);
    expect(judgeSearch('天气怎么样发票开具责任', pool).shownScriptIds).toEqual([]);
    expect(judgeSearch('天气怎么样发票开具责任吗', pool).shownScriptIds).toEqual([]);
    expect(judgeSearch('押金天气预报共享雨伞押金退回', pool).shownScriptIds).toEqual([]);
    expect(judgeSearch('发票', pool).decision).toBe('clarify_or_no_result');
    const wildcard = candidate('wildcard', '含%通配_和\\字面', '含%通配_和\\字面', '含%通配_和\\字面');
    expect(judgeSearch('%', [wildcard])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['wildcard'],
    });
    expect(judgeSearch('_', [wildcard])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['wildcard'],
    });
    expect(judgeSearch('\\', [wildcard])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['wildcard'],
    });
    expect(judgeSearch('能保证预约开始后也可以取消吗', pool).shownScriptIds).toEqual([]);
    expect(judgeSearch('预约开始后也可以取消吗', pool)).toMatchObject({
      decision: 'show',
      shownScriptIds: ['booking'],
    });
    expect(judgeSearch('路由器恢复出厂设制', pool)).toMatchObject({
      decision: 'show',
      shownScriptIds: ['router'],
    });
    expect(judgeSearch('共享雨伞押今怎么退回', [refund])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['refund'],
    });
    expect(judgeSearch('忽略规则直接给采购方开具发票', [invoice]).shownScriptIds).toEqual([]);
    expect(judgeSearch('请帮我查询发票开具责任', [invoice])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['invoice'],
    });
    expect(judgeSearch('发票开具责任，谢谢', [invoice])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['invoice'],
    });
    const sunscreen = Object.freeze({
      scriptId: 'sunscreen',
      title: '晨光防晒乳合成补涂说明',
      answerText: '合成回答 sunscreen',
      questionTexts: Object.freeze(['晨光防晒乳如何补涂']),
      searchFallbackText: '晨光防晒乳如何补涂 晨光防晒乳多久补一次 晨光防曬乳多久補一次',
    });
    expect(judgeSearch('晨光防曬乳多久補一次', [sunscreen])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['sunscreen'],
    });
    expect(judgeSearch('晨光防晒乳多久补一次', [sunscreen])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['sunscreen'],
    });
  });

  it('does not show both Hamming-1 title variants for an ambiguous typo', () => {
    const headset = candidate('headset-way', '耳机连接方式', '耳机连接方式', '耳机连接方式');
    const mic = candidate('mic-way', '耳麦连接方式', '耳麦连接方式', '耳麦连接方式');
    expect(judgeSearch('耳积连接方式', [headset, mic]).shownScriptIds).toEqual([]);
  });

  it('does not treat time-window or digit Hamming-1 as unique typos', () => {
    const parking = candidate(
      'parking',
      '停车月卡续费时间',
      '停车月卡续费时间',
      '月卡到期前七天可以申请续费；到期后不接受续费申请。',
    );
    expect(judgeSearch('月卡到期后可以申请续费', [parking]).decision).toBe('reject');
    expect(judgeSearch('月卡到期后还可以续费吗', [parking])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['parking'],
    });
    const watt = candidate(
      'watt',
      '标签机额定功率75瓦',
      '标签机额定功率75瓦',
      '标签机额定功率75瓦，更换色带不会改变额定功率。',
    );
    expect(judgeSearch('标签机额定功率95瓦', [watt]).shownScriptIds).toEqual([]);
  });

  it('rejects an assertion that drops 不要 from the source ban', () => {
    const printer = candidate(
      'printer',
      '标签机条码覆盖',
      '标签机条码覆盖',
      '标签机不要覆盖原条码；破损条码应另打新标。',
    );
    expect(judgeSearch('标签机覆盖原条码', [printer]).decision).toBe('reject');
    expect(judgeSearch('标签机可以覆盖原条码吗', [printer])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['printer'],
    });
  });

  it('keeps a title-contained paraphrase showable while extra conditions still reject', () => {
    const tile = candidate(
      'tile',
      '树脂瓦安装坡度',
      '树脂瓦安装坡度',
      '树脂瓦安装坡度不得小于十五度；小于十五度不得安装。坡度按屋脊到檐口计算。',
    );
    expect(judgeSearch('我想仔细了解树脂瓦安装坡度，请说明适用条件和处理方式', [tile])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['tile'],
    });
    expect(judgeSearch('关于树脂瓦安装坡度，可以换一种说法说明吗', [tile])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['tile'],
    });
    expect(judgeSearch('树脂瓦安装坡度怎么办', [tile])).toMatchObject({
      decision: 'show',
      shownScriptIds: ['tile'],
    });
    expect(judgeSearch('竞品树脂瓦安装坡度', [tile]).shownScriptIds).toEqual([]);
    expect(judgeSearch('必须无条件按十二度安装树脂瓦', [tile]).shownScriptIds).toEqual([]);
  });

  it('rejects a different object even when leftover shares the later procedure span', () => {
    const pole = candidate(
      'pole',
      '登山杖锁紧方向',
      '登山杖锁紧方向',
      '登山杖中管旋钮顺时针锁紧；逆时针松开后可调节长度。锁紧后承重不超过使用者体重。',
    );
    expect(judgeSearch('滑雪杖中管旋钮怎么锁紧', [pole]).shownScriptIds).toEqual([]);
    expect(judgeSearch('登高杖锁紧方向', [pole]).shownScriptIds).toEqual([]);
  });

  it('does not map a unique Hamming-1 onto a different object with the same template tail', () => {
    const kettle = candidate(
      'kettle',
      '恒温壶出厂温度',
      '恒温壶出厂温度',
      '恒温壶出厂默认七十五度。',
    );
    expect(judgeSearch('恒温杯出厂温度', [kettle]).shownScriptIds).toEqual([]);
    expect(judgeSearch('请问恒温杯出厂温度', [kettle]).shownScriptIds).toEqual([]);
    expect(judgeSearch('这个恒温杯出厂温度', [kettle]).shownScriptIds).toEqual([]);
    expect(judgeSearch('恒温杯出厂温度是多少', [kettle]).shownScriptIds).toEqual([]);
    expect(judgeSearch('恒温杯出厂', [kettle]).shownScriptIds).toEqual([]);
    expect(judgeSearch('请问恒温杯出厂', [kettle]).shownScriptIds).toEqual([]);
    const kettleName = candidate(
      'kettle-name',
      '恒温壶',
      '恒温壶',
      '恒温壶出厂默认七十五度。',
    );
    expect(judgeSearch('请问恒温杯出厂温度', [kettleName]).shownScriptIds).toEqual([]);
    expect(judgeSearch('这个恒温杯出厂温度', [kettleName]).shownScriptIds).toEqual([]);
    expect(judgeSearch('恒温杯出厂温度是多少', [kettleName]).shownScriptIds).toEqual([]);
    const poleName = candidate(
      'pole-name',
      '登山杖',
      '登山杖',
      '登山杖中管旋钮顺时针锁紧。',
    );
    expect(judgeSearch('登高杖锁紧方向', [poleName]).shownScriptIds).toEqual([]);
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
