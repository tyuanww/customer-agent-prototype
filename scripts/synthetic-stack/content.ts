/**
 * Synthetic seed content for the local stack.
 *
 * Every row is fictional. Scripts are imported through the real HTTP import ->
 * worker -> review -> publish chain, never inserted into `scripts` directly, so
 * the stack exercises the same governed path a real operator would use.
 *
 * `product_scope_type`/`product_scope_refs` use the ids from
 * `apps/desktop/src/shared/synthetic-catalog.ts`. `storewide` rows carry no
 * reference; `category`/`sku` rows must reference a catalog entry so the
 * renderer can always show a human label for a candidate's scope.
 */

export const SYNTHETIC_SOURCES = Object.freeze([
  Object.freeze({ domain: 'presale', source_version_id: 'srcv_stack_presale_v1', source_ref: 'SRC-STACK-PRESALE' }),
  Object.freeze({ domain: 'campaign', source_version_id: 'srcv_stack_campaign_v1', source_ref: 'SRC-STACK-CAMPAIGN' }),
  Object.freeze({ domain: 'aftersale', source_version_id: 'srcv_stack_aftersale_v1', source_ref: 'SRC-STACK-AFTERSALE' }),
  Object.freeze({ domain: 'product', source_version_id: 'srcv_stack_product_v1', source_ref: 'SRC-STACK-PRODUCT' }),
]);

const HEADER = [
  'script_id', 'category', 'title', 'answer_text', 'source_version_id', 'source_ref',
  'question_text', 'risk_level', 'has_conflict', 'platform_scope', 'product_scope_type',
  'product_scope_refs', 'placeholder_keys', 'effective_from', 'effective_to',
].join(',');

/**
 * `|` separates multiple platforms, scope references or placeholder keys in one
 * cell. Campaign rows must declare `effective_to`: the frozen schema requires a
 * bounded window for that category.
 */
const ROWS: readonly (readonly string[])[] = Object.freeze([
  // Storewide presale/aftersale scripts answer without any product context.
  ['stack-ship-001', 'presale', '发货时效', '您好，订单会在付款后 48 小时内发出，物流单号同步到订单页。', 'srcv_stack_presale_v1', 'SRC-STACK-PRESALE', '什么时候发货', 'low', 'false', 'qianniu', 'storewide', '', '', '', ''],
  ['stack-ship-002', 'presale', '发货时效（抖音）', '抖音订单会在付款后 48 小时内发出，可在订单详情查看物流。', 'srcv_stack_presale_v1', 'SRC-STACK-PRESALE', '抖音订单什么时候发货', 'low', 'false', 'douyin', 'storewide', '', '', '', ''],
  ['stack-return-001', 'aftersale', '七天无理由退货', '未拆封商品支持七天无理由退货，请在订单页提交换货申请。', 'srcv_stack_aftersale_v1', 'SRC-STACK-AFTERSALE', '能退货吗', 'low', 'false', 'qianniu', 'storewide', '', '', '', ''],
  ['stack-campaign-001', 'campaign', '满赠活动', '活动期间单笔订单满 299 元赠送旅行装一份，赠品随单发出。', 'srcv_stack_campaign_v1', 'SRC-STACK-CAMPAIGN', '满赠怎么参加', 'low', 'false', 'qianniu', 'storewide', '', '', '2026-01-01T00:00:00Z', '2099-12-31T00:00:00Z'],

  // Category-scoped script: only matches when the agent confirmed the category.
  ['stack-cleanser-cat', 'product', '洁面使用说明', '取适量洁面乳加水揉出泡沫，轻柔按摩面部 30 秒后以清水洗净，避开眼周。', 'srcv_stack_product_v1', 'SRC-STACK-PRODUCT', '洁面怎么用', 'low', 'false', 'qianniu', 'category', 'cat_cleanser', '', '', ''],

  // SKU-scoped script: only matches the exact product.
  ['stack-cleanser-sku', 'product', '澄芽氨基酸洁面乳用法', '澄芽氨基酸洁面乳取黄豆大小，加水揉出泡沫后轻柔按摩 30 秒，避开眼周再洗净。', 'srcv_stack_product_v1', 'SRC-STACK-PRODUCT', '澄芽氨基酸洁面怎么用', 'low', 'false', 'qianniu', 'sku', 'sku_chengyajiemian', '', '', ''],
  ['stack-essence-sku', 'product', '雾屿舒缓精华用法', '雾屿舒缓精华取 2-3 滴于掌心，轻拍至吸收，敏感肌建议先在耳后试用。', 'srcv_stack_product_v1', 'SRC-STACK-PRODUCT', '雾屿精华怎么用', 'low', 'false', 'qianniu', 'sku', 'sku_wuyujinghua', '', '', ''],
  ['stack-sunscreen-sku', 'product', '月白清透防晒乳补涂', '月白清透防晒乳建议每 2-3 小时补涂一次，出汗或游泳后及时补涂。', 'srcv_stack_product_v1', 'SRC-STACK-PRODUCT', '防晒怎么补涂', 'low', 'false', 'qianniu', 'sku', 'sku_yuebaifangshai', '', '', ''],
  ['stack-mask-sku', 'aftersale', '露芷修护面膜不适处理', '请立即停用露芷修护面膜，用清水洗净并观察；若持续不适请及时就医。', 'srcv_stack_aftersale_v1', 'SRC-STACK-AFTERSALE', '面膜用完过敏怎么办', 'medium', 'false', 'qianniu', 'sku', 'sku_luzhimianmo', '', '', ''],

  // Dual-review rows: high risk or conflicting content needs lead + manager.
  ['stack-order-id', 'presale', '订单查询话术', '您的订单号是 {订单号}，我们已为您登记，请稍候。', 'srcv_stack_presale_v1', 'SRC-STACK-PRESALE', '查一下我的订单', 'high', 'false', 'qianniu', 'storewide', '', 'order_id', '', ''],
  ['stack-date', 'campaign', '活动日期话术', '本次活动截止到 {日期}，请在截止前下单。', 'srcv_stack_campaign_v1', 'SRC-STACK-CAMPAIGN', '活动到什么时候', 'low', 'false', 'qianniu', 'storewide', '', 'date', '2026-01-01T00:00:00Z', '2099-12-31T00:00:00Z'],
]);

/** CSV bytes for the import endpoint. Trailing newline matches the CSV parser. */
export const SYNTHETIC_CONTENT_CSV = Buffer.from(
  [HEADER, ...ROWS.map((row) => row.join(','))].join('\n') + '\n',
  'utf8',
);

/** Script ids the stack expects to become recommendable after publish. */
export const SYNTHETIC_SCRIPT_IDS: readonly string[] = Object.freeze(ROWS.map((row) => String(row[0])));

/** Scope reference declared by each script id, for the stack self-check. */
export function scriptScope(scriptId: string): Readonly<{ type: string; refs: readonly string[] }> {
  const row = ROWS.find((candidate) => candidate[0] === scriptId);
  if (!row) throw new Error(`Unknown synthetic script id: ${scriptId}`);
  const refs = String(row[11]).split('|').map((value) => value.trim()).filter((value) => value.length > 0);
  return Object.freeze({ type: String(row[10]), refs: Object.freeze(refs) });
}
