import { exactKeys } from './product-session';

/** Only display data and opaque copy keys cross this port. Main owns identity,
 * selection generations, complete snapshots, deadlines and original copy text. */
export type IntakeQueryRow = {
  kind: 'intake'; key: string; rank: 1 | 2 | 3; title: string; answerText: string;
  applicabilityNote: string; riskNote: string; releaseId: string; validUntil: string;
};
export type IntakeQuerySelection = { productIds: string[]; scenarioIds: string[] };
export type IntakeQueryOption = { id: string; label: string };
export type IntakeQueryContext = IntakeQuerySelection & { shops: string[]; shopNames: IntakeQueryOption[]; shopNamesValidUntil: string | null; shopId: string | null;
  products: IntakeQueryOption[]; scenarios: IntakeQueryOption[]; validUntil: string | null };
export const emptyIntakeQueryContext = (): IntakeQueryContext => ({ shops: [], shopNames: [], shopNamesValidUntil: null, shopId: null,
  products: [], scenarios: [], productIds: [], scenarioIds: [], validUntil: null });
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100
  && v.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) && new Set(v).size === v.length;
export function isIntakeSelection(value: unknown): value is IntakeQuerySelection {
  return exactKeys(value, ['productIds', 'scenarioIds']) && ids(value.productIds) && ids(value.scenarioIds);
}
function options(value: unknown): value is IntakeQueryOption[] {
  return Array.isArray(value) && value.length <= 5000 && new Set(value.map(v => v?.id)).size === value.length
    && value.every(v => exactKeys(v, ['id','label']) && isIntakeText(v.id,128)
      && typeof v.label === 'string' && v.label.trim().length > 0 && [...v.label].length <= 256);
}
const messages = {
  VALIDATION: '请输入最多 500 字的客户问题。',
  STALE: '请重新查询。',
  EXPIRED: '查询资格已到期，请重新查询。',
  UNAUTHORIZED: '请先登录后查询。',
  FORBIDDEN: '请刷新店铺。',
  NO_PRINCIPAL: '没有权限，请找人开通。',
  FACTS_EXPIRED: '资料资格过期了，请稍后重试。',
  NO_GRANT: '没有权限，请找人开通。',
  ROLE_UNKNOWN: '没有权限，请找人开通。',
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
  return isIntakeFailure(value) || (exactKeys(value, ['ok', 'shops', 'shopNames', 'shopNamesValidUntil', 'shopId', 'products', 'scenarios', 'productIds', 'scenarioIds', 'validUntil']) && value.ok === true
    && Array.isArray(value.shops) && value.shops.length <= 5000 && value.shops.every(s => isIntakeText(s))
    && new Set(value.shops).size === value.shops.length
    && options(value.shopNames) && value.shopNames.every(n => (value.shops as string[]).includes(n.id) && n.label===n.label.trim() && [...n.label].every(char => { const cp=char.codePointAt(0)!;return cp>31 && cp!==127 && cp!==0x2028 && cp!==0x2029; }))
    && (value.shopNamesValidUntil === null ? value.shopNames.length === 0
      : typeof value.shopNamesValidUntil === 'string' && Number.isFinite(Date.parse(value.shopNamesValidUntil)) && value.shopNames.length === value.shops.length)
    && options(value.products) && options(value.scenarios) && ids(value.productIds) && ids(value.scenarioIds)
    && value.productIds.every(id => (value.products as IntakeQueryOption[]).some((v: IntakeQueryOption) => v.id === id))
    && value.scenarioIds.every(id => (value.scenarios as IntakeQueryOption[]).some((v: IntakeQueryOption) => v.id === id))
    && (value.validUntil === null || (typeof value.validUntil === 'string' && Number.isFinite(Date.parse(value.validUntil))))
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
  selectConditions(request: IntakeQuerySelection): Promise<IntakeQueryResult<IntakeQueryContext>>;
  search(request: { queryText: string }): Promise<IntakeQueryResult<{ rows: IntakeQueryRow[] }>>;
  copy(request: { key: string }): Promise<IntakeQueryResult<{ copied: true }>>;
  cancel(): Promise<IntakeQueryResult<{ cancelled: true }>>;
  onInvalidated(listener: (reason: 'invalidated' | 'expired') => void): () => void;
};
