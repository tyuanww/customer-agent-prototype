import type { ScriptFixture } from '../features/search/types';
import { deepFreeze } from '@shared/deep-freeze';

function defineScript(fixture: ScriptFixture): ScriptFixture {
  return Object.freeze(fixture);
}

export const SYNTHETIC_SCRIPTS: readonly ScriptFixture[] = deepFreeze([
  defineScript({
    scriptId: 'syn-prod-001',
    domain: '产品',
    questionVariants: [
      '澄芽氨基酸洁面怎么用',
      '澄芽洁面怎么用',
      '澄芽洁面乳用法',
      '澄芽洁面泡沫太少',
    ],
    search: {
      intents: ['usage'],
      anchors: [
        {
          kind: 'entity',
          label: '澄芽洁面',
          canonical: '澄芽洁面',
          aliases: ['澄芽洗面奶', '澄芽洁面乳', '氨基酸洁面'],
        },
      ],
    },
    answerText:
      '请先取约一颗黄豆大小的「澄芽氨基酸洁面乳」（合成演示产品），加水揉出泡沫后轻柔按摩面部 30 秒，避开眼周，再以清水洗净。该说明仅用于 Demo 合成场景，不代表真实产品说明书。',
    platform: '私域企微',
    scopeLabel: '日常清洁 · 合成演示',
    riskLevel: 'low',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
  }),
  defineScript({
    scriptId: 'syn-prod-001-quick',
    domain: '产品',
    questionVariants: [
      '澄芽氨基酸洁面怎么用',
      '澄芽洁面怎么用',
      '澄芽洁面乳用法',
      '澄芽洁面快速回复',
    ],
    search: {
      intents: ['usage'],
      anchors: [
        {
          kind: 'entity',
          label: '澄芽洁面',
          canonical: '澄芽洁面',
          aliases: ['澄芽洗面奶', '澄芽洁面乳', '氨基酸洁面'],
        },
      ],
    },
    answerText:
      '简洁版合成话术：取黄豆大小的「澄芽氨基酸洁面乳」，加水揉出泡沫，轻柔按摩约 30 秒后洗净，注意避开眼周。本条仅供 Demo 展示，不代表真实产品说明。',
    platform: '抖音私信',
    scopeLabel: '日常清洁 · 简洁回复',
    riskLevel: 'low',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
  }),
  defineScript({
    scriptId: 'syn-prod-001-care',
    domain: '售前',
    questionVariants: [
      '澄芽氨基酸洁面怎么用',
      '澄芽洁面怎么用',
      '澄芽洁面乳用法',
      '澄芽洁面敏感肌怎么用',
    ],
    search: {
      intents: ['usage', 'safety'],
      anchors: [
        {
          kind: 'entity',
          label: '澄芽洁面',
          canonical: '澄芽洁面',
          aliases: ['澄芽洗面奶', '澄芽洁面乳', '氨基酸洁面'],
        },
        {
          kind: 'topic',
          label: '敏感使用',
          canonical: '敏感肌',
          aliases: ['刺痛', '泛红'],
        },
      ],
    },
    answerText:
      '温和提醒版合成话术：首次使用「澄芽氨基酸洁面乳」可先少量试用，揉出泡沫后减少摩擦；如持续刺痛或泛红，请停止使用并转人工复核。Demo 不作真实肤质判断。',
    platform: '售前咨询',
    scopeLabel: '日常清洁 · 温和提醒',
    riskLevel: 'medium',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
  }),
  defineScript({
    scriptId: 'syn-prod-002',
    domain: '产品',
    questionVariants: [
      '雾屿舒缓精华敏感肌能用吗',
      '雾屿精华刺痛怎么办',
      '雾屿舒缓精华怎么用',
      '雾屿精华敏感肌',
    ],
    search: {
      intents: ['usage', 'safety', 'aftersales'],
      anchors: [
        {
          kind: 'entity',
          label: '雾屿精华',
          canonical: '雾屿舒缓精华',
          aliases: ['雾屿精华', '舒缓精华'],
        },
        {
          kind: 'topic',
          label: '敏感不适',
          canonical: '敏感肌',
          aliases: ['刺痛', '泛红'],
        },
      ],
    },
    answerText:
      '「雾屿舒缓精华」为合成演示产品：建议先在耳后或下颌做 24 小时局部试用。全脸使用时取 2–3 滴，按压吸收，不要与高浓度酸类同天叠加。此条不构成真实功效或医美建议。',
    platform: '天猫咨询',
    scopeLabel: '敏感护理 · 合成演示',
    riskLevel: 'medium',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
  }),
  defineScript({
    scriptId: 'syn-prod-003',
    domain: '产品',
    questionVariants: [
      '月白防晒要不要卸妆',
      '月白轻透防晒乳怎么用',
      '月白防晒闷痘吗',
      '月白防晒补涂',
    ],
    search: {
      intents: ['usage', 'safety'],
      anchors: [
        {
          kind: 'entity',
          label: '月白防晒',
          canonical: '月白防晒',
          aliases: ['月白轻透防晒乳', '月白防晒乳'],
        },
        {
          kind: 'topic',
          label: '防晒使用',
          canonical: '补涂',
          aliases: ['卸妆', '清洁'],
        },
      ],
    },
    answerText:
      '「月白轻透防晒乳」为合成演示产品：日间出门前取两指长涂匀面部，出汗或擦拭后约两小时补涂。晚间请用洁面充分清洁，无需专用卸妆油也可洗净。Demo 不读取真实肤质档案。',
    platform: '抖音私信',
    scopeLabel: '日间防护 · 合成演示',
    riskLevel: 'low',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
  }),
  defineScript({
    scriptId: 'syn-camp-001',
    domain: '活动',
    questionVariants: [
      '白露季满赠怎么参加',
      '白露季满赠规则',
      '白露季买赠活动',
      '白露季满 299 送面膜',
    ],
    search: {
      intents: ['promotion'],
      anchors: [
        {
          kind: 'entity',
          label: '白露季满赠',
          canonical: '白露季满赠',
          aliases: ['白露季买赠', '满299送面膜', '白露季赠品'],
        },
      ],
    },
    answerText:
      '「白露季满赠」为合成活动：单笔实付满 299 赠「露芷修护面膜」体验装 1 片，每位用户限赠 1 次，不与会员日券叠加。结算页需勾选「白露季满赠」。Demo 不核验真实订单或库存。',
    platform: '商城结算页',
    scopeLabel: '白露季满赠 · 全店合成商品',
    riskLevel: 'medium',
    effectiveFrom: '2026-08-01',
    effectiveTo: '2026-08-31',
  }),
  defineScript({
    scriptId: 'syn-camp-002',
    domain: '活动',
    questionVariants: [
      '青禾会员日积分怎么兑',
      '青禾会员日兑换规则',
      '青禾会员日 100 积分换什么',
      '青禾积分兑换截止了吗',
    ],
    search: {
      intents: ['promotion'],
      anchors: [
        {
          kind: 'entity',
          label: '青禾会员日',
          canonical: '青禾会员日',
          aliases: ['青禾积分兑换', '青禾兑换'],
        },
      ],
    },
    answerText:
      '「青禾会员日」为已结束的合成活动：每 100 积分可兑 5 元券，每日限兑 2 张。QINGHE_EXPIRED_DEMO_BODY。当前有效期已过，检索层不得返回本条。此条仅用于演示过期过滤。',
    platform: '会员中心',
    scopeLabel: '青禾会员日（合成 · 已结束）',
    riskLevel: 'medium',
    effectiveFrom: '2026-06-01',
    effectiveTo: '2026-06-30',
  }),
  defineScript({
    scriptId: 'syn-pre-001',
    domain: '售前',
    questionVariants: [
      '露芷修护面膜孕妇能用吗',
      '露芷面膜怀孕能敷吗',
      '露芷修护面膜孕期',
      '面膜孕妇可以用吗',
    ],
    search: {
      intents: ['safety'],
      anchors: [
        {
          kind: 'entity',
          label: '露芷面膜',
          canonical: '露芷修护面膜',
          aliases: ['露芷面膜', '修护面膜'],
        },
        {
          kind: 'topic',
          label: '孕期咨询',
          canonical: '孕期',
          aliases: ['孕妇', '怀孕'],
        },
      ],
    },
    answerText:
      '「露芷修护面膜」为合成演示产品，Demo 不能替代医学判断。请告知用户：孕期皮肤更敏感，建议先咨询医师，并做局部试用；不要承诺“一定安全”或“医生推荐”。必要时升级话术师复核。',
    platform: '售前咨询',
    scopeLabel: '孕期咨询 · 合成演示',
    riskLevel: 'high',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
  }),
  defineScript({
    scriptId: 'syn-pre-002',
    domain: '售前',
    questionVariants: [
      '澄芽洁面和雾屿精华能一起用吗',
      '澄芽和雾屿叠加顺序',
      '洁面后能用雾屿精华吗',
      '澄芽雾屿搭配',
    ],
    search: {
      intents: ['compatibility'],
      anchors: [
        {
          kind: 'entity',
          label: '澄芽与雾屿',
          canonical: '澄芽雾屿',
          aliases: ['澄芽和雾屿', '洁面后用雾屿精华'],
        },
      ],
    },
    answerText:
      '合成演示搭配：可先用「澄芽氨基酸洁面乳」洗净，拍干后再用「雾屿舒缓精华」。不要在同一晚叠加高浓度酸类或视黄醇类。此条不构成真实配方相容性结论。',
    platform: '售前咨询',
    scopeLabel: '产品搭配 · 合成演示',
    riskLevel: 'medium',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
  }),
  defineScript({
    scriptId: 'syn-after-001',
    domain: '售后',
    questionVariants: [
      '用了月白防晒闷痘怎么办',
      '月白防晒长痘了',
      '防晒乳闷痘怎么处理',
      '月白防晒致痘',
    ],
    search: {
      intents: ['safety', 'aftersales'],
      anchors: [
        {
          kind: 'entity',
          label: '月白防晒',
          canonical: '月白防晒',
          aliases: ['月白防晒乳', '月白轻透防晒乳'],
        },
        {
          kind: 'topic',
          label: '闷痘反馈',
          canonical: '闷痘',
          aliases: ['长痘', '致痘'],
        },
      ],
    },
    answerText:
      '请先引导用户暂停该合成演示防晒 2–3 天，观察是否缓解，并确认是否清洁不彻底或用量过大。不要承诺“一定不是产品问题”或包治。持续红肿请建议就医，并升级话术师复核。',
    platform: '售后工单',
    scopeLabel: '不适反馈 · 合成演示',
    riskLevel: 'high',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
  }),
  defineScript({
    scriptId: 'syn-after-002',
    domain: '售后',
    questionVariants: [
      '用了露芷面膜过敏了怎么办',
      '面膜过敏了怎么处理',
      '敷完面膜红肿',
      '露芷面膜过敏',
    ],
    search: {
      intents: ['safety', 'aftersales'],
      anchors: [
        {
          kind: 'entity',
          label: '露芷面膜',
          canonical: '露芷面膜',
          aliases: ['露芷修护面膜', '敷面膜'],
        },
        {
          kind: 'topic',
          label: '过敏反馈',
          canonical: '过敏',
          aliases: ['红肿', '刺痛'],
        },
      ],
    },
    answerText:
      '请立即停用并清水冲洗；不要自行推荐激素药膏。记录首次使用时间、部位和照片（Demo 不会上传）。持续刺痛或扩散请就医。此为合成售后话术，不会创建真实工单。',
    platform: '售后工单',
    scopeLabel: '过敏应急 · 合成演示',
    riskLevel: 'high',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
  }),
  defineScript({
    scriptId: 'syn-after-003',
    domain: '售后',
    questionVariants: [
      '澄芽洁面能退货吗',
      '澄芽洁面七天无理由',
      '澄芽洁面退换货规则',
      '洁面拆封了还能退吗',
    ],
    search: {
      intents: ['return_policy', 'aftersales'],
      anchors: [
        {
          kind: 'entity',
          label: '澄芽洁面',
          canonical: '澄芽洁面',
          aliases: ['澄芽洁面乳', '澄芽洗面奶'],
        },
        {
          kind: 'topic',
          label: '退换货',
          canonical: '退换货',
          aliases: ['退货', '退款', '七天无理由', '拆封'],
        },
      ],
    },
    answerText:
      '「澄芽氨基酸洁面乳」合成规则：未开封且附件齐全可 7 天无理由退货；已开封仅支持质量问题换货。涉及退款路径时不要口头承诺到账时间，请转人工话术师核对。',
    platform: '售后 / 退换货',
    scopeLabel: '退换说明 · 合成演示',
    riskLevel: 'medium',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2099-12-31',
  }),
] satisfies readonly ScriptFixture[]);

export const EXAMPLE_QUESTIONS = [
  '澄芽氨基酸洁面怎么用',
  '白露季满赠怎么参加',
  '用了露芷面膜过敏了怎么办',
] as const;
