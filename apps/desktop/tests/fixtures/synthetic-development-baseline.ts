export type SyntheticDevelopmentCase = {
  readonly id: string;
  readonly stratum: 'positive' | 'safety_negative' | 'robustness';
  readonly domain: '产品' | '活动' | '售前' | '售后' | 'cross_domain';
  readonly query?: string;
  readonly repeatedQuery?: {
    readonly value: string;
    readonly count: number;
  };
  readonly expectedStatus: 'hit' | 'no-hit' | 'invalid';
  readonly expectedTopScriptId?: string;
  readonly expectedInvalidReason?: 'too-long';
  readonly humanAction: 'review_before_copy' | 'clarify_or_escalate' | 'manual_review';
};

/**
 * Purely synthetic development contract. These cases freeze expected local-search
 * behavior; they are not real customer tasks, G1a evidence, or a production metric.
 */
export const SYNTHETIC_DEVELOPMENT_BASELINE = [
  { id: 'P01', stratum: 'positive', domain: '产品', query: '澄芽氨基酸洁面怎么用', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-001', humanAction: 'review_before_copy' },
  { id: 'P02', stratum: 'positive', domain: '产品', query: '澄芽洁面快速回复', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-001-quick', humanAction: 'review_before_copy' },
  { id: 'P03', stratum: 'positive', domain: '产品', query: '雾屿舒缓精华敏感肌能用吗', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-002', humanAction: 'manual_review' },
  { id: 'P04', stratum: 'positive', domain: '产品', query: '月白防晒补涂', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-003', humanAction: 'review_before_copy' },
  { id: 'P05', stratum: 'positive', domain: '活动', query: '白露季满赠怎么参加', expectedStatus: 'hit', expectedTopScriptId: 'syn-camp-001', humanAction: 'manual_review' },
  { id: 'P06', stratum: 'positive', domain: '活动', query: '白露季买赠活动', expectedStatus: 'hit', expectedTopScriptId: 'syn-camp-001', humanAction: 'manual_review' },
  { id: 'P07', stratum: 'positive', domain: '售前', query: '露芷修护面膜孕妇能用吗', expectedStatus: 'hit', expectedTopScriptId: 'syn-pre-001', humanAction: 'manual_review' },
  { id: 'P08', stratum: 'positive', domain: '售前', query: '面膜孕妇可以用吗', expectedStatus: 'hit', expectedTopScriptId: 'syn-pre-001', humanAction: 'manual_review' },
  { id: 'P09', stratum: 'positive', domain: '售前', query: '澄芽洁面和雾屿精华能一起用吗', expectedStatus: 'hit', expectedTopScriptId: 'syn-pre-002', humanAction: 'manual_review' },
  { id: 'P10', stratum: 'positive', domain: '售前', query: '洁面后能用雾屿精华吗', expectedStatus: 'hit', expectedTopScriptId: 'syn-pre-002', humanAction: 'manual_review' },
  { id: 'P11', stratum: 'positive', domain: '售后', query: '用了月白防晒闷痘怎么办', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-001', humanAction: 'manual_review' },
  { id: 'P12', stratum: 'positive', domain: '售后', query: '防晒乳闷痘怎么处理', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-001', humanAction: 'manual_review' },
  { id: 'P13', stratum: 'positive', domain: '售后', query: '用了露芷面膜过敏了怎么办', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-002', humanAction: 'manual_review' },
  { id: 'P14', stratum: 'positive', domain: '售后', query: '敷完面膜红肿', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-002', humanAction: 'manual_review' },
  { id: 'P15', stratum: 'positive', domain: '售后', query: '澄芽洁面能退货吗', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-003', humanAction: 'manual_review' },
  { id: 'P16', stratum: 'positive', domain: '售后', query: '洁面拆封了还能退吗', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-003', humanAction: 'manual_review' },
  { id: 'P17', stratum: 'positive', domain: '产品', query: '氨基酸洁面怎么用', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-001', humanAction: 'review_before_copy' },
  { id: 'P18', stratum: 'positive', domain: '售后', query: '修护面膜过敏怎么办', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-002', humanAction: 'manual_review' },
  { id: 'P19', stratum: 'positive', domain: '售后', query: '防晒闷痘怎么办', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-001', humanAction: 'manual_review' },
  { id: 'P20', stratum: 'positive', domain: '售后', query: '洁面拆封后能不能退', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-003', humanAction: 'manual_review' },

  { id: 'N01', stratum: 'safety_negative', domain: 'cross_domain', query: '怎么用', expectedStatus: 'no-hit', humanAction: 'clarify_or_escalate' },
  { id: 'N02', stratum: 'safety_negative', domain: 'cross_domain', query: '有优惠吗', expectedStatus: 'no-hit', humanAction: 'clarify_or_escalate' },
  { id: 'N03', stratum: 'safety_negative', domain: '活动', query: '青禾会员日积分怎么兑', expectedStatus: 'no-hit', humanAction: 'clarify_or_escalate' },
  { id: 'N04', stratum: 'safety_negative', domain: '活动', query: '青禾会员日兑换规则', expectedStatus: 'no-hit', humanAction: 'clarify_or_escalate' },
  { id: 'N05', stratum: 'safety_negative', domain: '产品', query: '外部品牌甲氨基酸洁面怎么用', expectedStatus: 'no-hit', humanAction: 'clarify_or_escalate' },
  { id: 'N06', stratum: 'safety_negative', domain: '售后', query: '外部品牌丙修护面膜过敏怎么办', expectedStatus: 'no-hit', humanAction: 'clarify_or_escalate' },
  { id: 'N07', stratum: 'safety_negative', domain: 'cross_domain', query: '雾屿氨基酸洁面怎么用', expectedStatus: 'no-hit', humanAction: 'clarify_or_escalate' },
  { id: 'N08', stratum: 'safety_negative', domain: 'cross_domain', query: '澄芽舒缓精华敏感肌能用吗', expectedStatus: 'no-hit', humanAction: 'clarify_or_escalate' },
  { id: 'N09', stratum: 'safety_negative', domain: 'cross_domain', query: '手机号怎么修改', expectedStatus: 'no-hit', humanAction: 'clarify_or_escalate' },
  { id: 'N10', stratum: 'safety_negative', domain: '售前', query: '露芷面膜孕妇一定安全吗', expectedStatus: 'hit', expectedTopScriptId: 'syn-pre-001', humanAction: 'manual_review' },
  { id: 'N11', stratum: 'safety_negative', domain: '售后', query: '月白防晒闷痘一定不是产品问题吧', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-001', humanAction: 'manual_review' },
  { id: 'N12', stratum: 'safety_negative', domain: 'cross_domain', repeatedQuery: { value: '测', count: 2001 }, expectedStatus: 'invalid', expectedInvalidReason: 'too-long', humanAction: 'clarify_or_escalate' },

  { id: 'R01', stratum: 'robustness', domain: '产品', query: '澄芽洗面奶咋用', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-001', humanAction: 'review_before_copy' },
  { id: 'R02', stratum: 'robustness', domain: '产品', query: '澄芽洗面奶用法', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-001', humanAction: 'review_before_copy' },
  { id: 'R03', stratum: 'robustness', domain: '产品', query: '雾屿精华刺痛咋办', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-002', humanAction: 'manual_review' },
  { id: 'R04', stratum: 'robustness', domain: '产品', query: '雾屿舒缓精华敏感肌', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-002', humanAction: 'manual_review' },
  { id: 'R05', stratum: 'robustness', domain: '产品', query: '月白防晒乳咋补涂', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-003', humanAction: 'review_before_copy' },
  { id: 'R06', stratum: 'robustness', domain: '产品', query: '月白防晒要卸妆不', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-003', humanAction: 'review_before_copy' },
  { id: 'R07', stratum: 'robustness', domain: '活动', query: '白露季满 299 送面膜', expectedStatus: 'hit', expectedTopScriptId: 'syn-camp-001', humanAction: 'manual_review' },
  { id: 'R08', stratum: 'robustness', domain: '活动', query: '白露季赠品咋领', expectedStatus: 'hit', expectedTopScriptId: 'syn-camp-001', humanAction: 'manual_review' },
  { id: 'R09', stratum: 'robustness', domain: '售前', query: '露芷面膜怀孕能敷不', expectedStatus: 'hit', expectedTopScriptId: 'syn-pre-001', humanAction: 'manual_review' },
  { id: 'R10', stratum: 'robustness', domain: '售前', query: '修护面膜孕期能用吗', expectedStatus: 'hit', expectedTopScriptId: 'syn-pre-001', humanAction: 'manual_review' },
  { id: 'R11', stratum: 'robustness', domain: '售前', query: '澄芽和雾屿叠加顺序', expectedStatus: 'hit', expectedTopScriptId: 'syn-pre-002', humanAction: 'manual_review' },
  { id: 'R12', stratum: 'robustness', domain: 'cross_domain', query: '洁面后用雾屿精华', expectedStatus: 'hit', expectedTopScriptId: 'syn-prod-002', humanAction: 'manual_review' },
  { id: 'R13', stratum: 'robustness', domain: '售后', query: '月白防晒长痘咋办', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-001', humanAction: 'manual_review' },
  { id: 'R14', stratum: 'robustness', domain: '售后', query: '月白防晒致痘', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-001', humanAction: 'manual_review' },
  { id: 'R15', stratum: 'robustness', domain: '售后', query: '露芷面膜敷完红肿', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-002', humanAction: 'manual_review' },
  { id: 'R16', stratum: 'robustness', domain: '售后', query: '面膜过敏了怎么处理', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-002', humanAction: 'manual_review' },
  { id: 'R17', stratum: 'robustness', domain: '售后', query: '澄芽洗面奶拆了还能退不', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-003', humanAction: 'manual_review' },
  { id: 'R18', stratum: 'robustness', domain: '售后', query: '澄芽洁面七天无理由吗', expectedStatus: 'hit', expectedTopScriptId: 'syn-after-003', humanAction: 'manual_review' },
] as const satisfies readonly SyntheticDevelopmentCase[];

export function materializeSyntheticDevelopmentQuery(testCase: SyntheticDevelopmentCase): string {
  if (testCase.query !== undefined) return testCase.query;
  if (testCase.repeatedQuery !== undefined) {
    return testCase.repeatedQuery.value.repeat(testCase.repeatedQuery.count);
  }
  throw new Error(`Synthetic development case ${testCase.id} has no query`);
}
