import { exactKeys } from './product-session';

/** Only display data and opaque copy keys cross this port. Main owns identity,
 * selection generations, complete snapshots, deadlines and original copy text. */
export type IntakeQueryRow = {
  kind: 'intake'; key: string; rank: 1 | 2 | 3; title: string; answerText: string;
  applicabilityNote: string; riskNote: string; releaseId: string; validUntil: string;
};
export type IntakeQueryContext = { shops: string[]; shopId: string | null };
const messages = {
  VALIDATION: '请检查输入；客户问题最多 500 字。',
  STALE: '查询已取消或上下文已改变，请重新查询。',
  EXPIRED: '查询资格已到期，请重新查询。',
  UNAUTHORIZED: '请先登录后查询。',
  FORBIDDEN: '当前店铺不可用或权限已失效，请重新选择店铺。',
  UNAVAILABLE: '查询服务暂不可用，请重试。',
  LIMIT: '资料超出读取限制，请联系管理员。',
  CLIPBOARD_FAILED: '复制失败，请重试。',
} as const;
export type IntakeQueryFailure = { ok: false; code: keyof typeof messages; message: string };
export type IntakeQueryResult<T> = ({ ok: true } & T) | IntakeQueryFailure;
export function intakeQueryFailure(code: keyof typeof messages): IntakeQueryFailure {
  return { ok: false, code, message: messages[code] };
}
export function isIntakeFailure(value: unknown): value is IntakeQueryFailure {
  return exactKeys(value, ['ok', 'code', 'message']) && value.ok === false
    && typeof value.code === 'string' && Object.hasOwn(messages, value.code)
    && value.message === messages[value.code as keyof typeof messages];
}
export function isIntakeText(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value;
}
export function isIntakeShopRequest(value: unknown): value is { shopId: string } {
  return exactKeys(value, ['shopId']) && isIntakeText(value.shopId);
}
export function isIntakeSearchRequest(value: unknown): value is { queryText: string } {
  return exactKeys(value, ['queryText']) && typeof value.queryText === 'string'
    && value.queryText.trim().length > 0 && [...value.queryText].length <= 500;
}
export function isIntakeCopyRequest(value: unknown): value is { key: string } {
  return exactKeys(value, ['key']) && isIntakeText(value.key);
}
export function isIntakeContextResult(value: unknown): value is IntakeQueryResult<IntakeQueryContext> {
  return isIntakeFailure(value) || (exactKeys(value, ['ok', 'shops', 'shopId']) && value.ok === true
    && Array.isArray(value.shops) && value.shops.length <= 5000 && value.shops.every(s => isIntakeText(s))
    && new Set(value.shops).size === value.shops.length
    && (value.shopId === null || (isIntakeText(value.shopId) && value.shops.includes(value.shopId))));
}
export function isIntakeSearchResult(value: unknown): value is IntakeQueryResult<{ rows: IntakeQueryRow[] }> {
  return isIntakeFailure(value) || (exactKeys(value, ['ok', 'rows']) && value.ok === true && Array.isArray(value.rows)
    && value.rows.length <= 3 && new Set(value.rows.map(r => r?.key)).size === value.rows.length
    && value.rows.every((r: unknown, i: number) => exactKeys(r,
      ['kind', 'key', 'rank', 'title', 'answerText', 'applicabilityNote', 'riskNote', 'releaseId', 'validUntil'])
      && r.kind === 'intake' && isIntakeText(r.key) && r.rank === i + 1 && isIntakeText(r.releaseId)
      && typeof r.title === 'string' && typeof r.answerText === 'string' && r.answerText.length > 0
      && typeof r.applicabilityNote === 'string' && typeof r.riskNote === 'string'
      && typeof r.validUntil === 'string' && Number.isFinite(Date.parse(r.validUntil))));
}
export type IntakeQueryApi = {
  mode(): Promise<IntakeQueryResult<{ enabled: boolean }>>;
  access(): Promise<IntakeQueryResult<IntakeQueryContext>>;
  selectShop(request: { shopId: string }): Promise<IntakeQueryResult<IntakeQueryContext>>;
  search(request: { queryText: string }): Promise<IntakeQueryResult<{ rows: IntakeQueryRow[] }>>;
  copy(request: { key: string }): Promise<IntakeQueryResult<{ copied: true }>>;
  cancel(): Promise<IntakeQueryResult<{ cancelled: true }>>;
  onInvalidated(listener: (reason: 'invalidated' | 'expired') => void): () => void;
};
