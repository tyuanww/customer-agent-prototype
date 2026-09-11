import type { components } from '@customer-agent/contracts';
import { exactKeys, productFailure, type ProductFailure } from './product-session';
export type ProductCandidate = components['schemas']['SearchCandidate'];
export type QueryIdentity = { sessionEpoch: number; generation: number };
export type ProductSearchRequest = QueryIdentity & {
  queryText: string; platform: 'qianniu' | 'douyin' | 'all'; platformSource: 'manual';
  productContextType: 'category' | 'sku' | null; productContextRef: string | null;
  productUnscoped: boolean; parentQueryId: string | null;
};
export type ProductCopyRequest = QueryIdentity & {
  queryId: string; rank: number; scriptId: string; scriptVersion: number; contentHash: string;
  placeholderValues: Partial<Record<'order_id' | 'date', string>>;
};
export type ProductSearchFailure = ProductFailure & { generation: number };
export type ProductSearchResult = (QueryIdentity & { ok: true; queryId: string; hitStatus: 'hit' | 'no_hit'; releaseId: string;
  telemetryStatus: 'recorded' | 'collection_disabled'; candidates: ProductCandidate[] }) | ProductSearchFailure;
export type ProductCopyResult = (QueryIdentity & { ok: true; copied: true; eventStatus: 'recorded' | 'unrecorded' | 'disabled' }) | ProductSearchFailure;
export type ProductCancelResult = (QueryIdentity & { ok: true; cancelled: true }) | ProductSearchFailure;
export const queryFailure = (code: ProductFailure['code'], identity: QueryIdentity): ProductSearchFailure => ({ ...productFailure(code, identity.sessionEpoch), generation: identity.generation });
export function isQueryIdentity(v: unknown): v is QueryIdentity & Record<string, unknown> {
  if (!v || typeof v !== 'object') return false;
  const x = v as QueryIdentity;
  return Number.isSafeInteger(x.sessionEpoch) && x.sessionEpoch >= 0 && Number.isSafeInteger(x.generation) && x.generation >= 0;
}
export function isProductSearchRequest(v: unknown): v is ProductSearchRequest {
  return exactKeys(v, ['sessionEpoch', 'generation', 'queryText', 'platform', 'platformSource', 'productContextType', 'productContextRef', 'productUnscoped', 'parentQueryId'])
    && isQueryIdentity(v) && typeof v.queryText === 'string' && v.queryText.trim().length > 0 && [...v.queryText].length <= 500
    && ['qianniu', 'douyin', 'all'].includes(v.platform as string) && v.platformSource === 'manual'
    && typeof v.productUnscoped === 'boolean'
    && (v.productUnscoped
      ? v.productContextType === null && v.productContextRef === null
      : ((v.productContextType === null && v.productContextRef === null) || (['category', 'sku'].includes(v.productContextType as string)
        && typeof v.productContextRef === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v.productContextRef))))
    && v.parentQueryId === null;
}
export function isProductCopyRequest(v: unknown): v is ProductCopyRequest {
  return exactKeys(v, ['sessionEpoch', 'generation', 'queryId', 'rank', 'scriptId', 'scriptVersion', 'contentHash', 'placeholderValues'])
    && isQueryIdentity(v) && typeof v.queryId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.queryId)
    && Number.isInteger(v.rank) && (v.rank as number) >= 1 && (v.rank as number) <= 3
    && typeof v.scriptId === 'string' && v.scriptId.length > 0 && v.scriptId.length <= 128
    && Number.isSafeInteger(v.scriptVersion) && (v.scriptVersion as number) > 0 && typeof v.contentHash === 'string'
    && /^[a-f0-9]{64}$/.test(v.contentHash) && !!v.placeholderValues && typeof v.placeholderValues === 'object'
    && !Array.isArray(v.placeholderValues) && Object.entries(v.placeholderValues).every(([k, value]) => ['order_id', 'date'].includes(k)
      && typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/[\p{Cc}{}]/u.test(value) && (k !== 'date' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value)));
}
export type ProductSearchApi = {
  search(request: ProductSearchRequest): Promise<ProductSearchResult>;
  cancelSearch(request: QueryIdentity): Promise<ProductCancelResult>;
  copyAdopt(request: ProductCopyRequest): Promise<ProductCopyResult>;
  retrievalPreference?(): Promise<import('./retrieval-preference').RetrievalPreference>;
  setRetrievalPreference?(next: import('./retrieval-preference').RetrievalPreference): Promise<import('./retrieval-preference').RetrievalPreference>;
};
/** Main has validated the frozen HTTP contract; preload still rejects extra projection fields. */
const keysMatch = (v: unknown, keys: string[]): boolean => exactKeys(v, keys);
export function isProductQueryResult(v: unknown): v is ProductSearchResult | ProductCopyResult | ProductCancelResult {
  if (!isQueryIdentity(v)) return false;
  const x = v as unknown as Record<string, unknown>;
  if (x.ok === false) return exactKeys(x, ['ok', 'sessionEpoch', 'generation', 'code', 'message'])
    && typeof x.code === 'string' && x.message === productFailure(x.code as ProductFailure['code']).message && typeof x.message === 'string';
  if (x.ok !== true) return false;
  if (keysMatch(x, ['ok', 'sessionEpoch', 'generation', 'copied', 'eventStatus'])) return x.copied === true && ['recorded', 'unrecorded', 'disabled'].includes(x.eventStatus as string);
  if (keysMatch(x, ['ok', 'sessionEpoch', 'generation', 'cancelled'])) return x.cancelled === true;
  return exactKeys(x, ['ok', 'sessionEpoch', 'generation', 'queryId', 'hitStatus', 'releaseId', 'telemetryStatus', 'candidates'])
    && typeof x.queryId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x.queryId) && typeof x.releaseId === 'string'
    && ['hit', 'no_hit'].includes(x.hitStatus as string) && ['recorded', 'collection_disabled'].includes(x.telemetryStatus as string)
    && Array.isArray(x.candidates) && x.candidates.length <= 3 && x.candidates.every(c => exactKeys(c, [
      'rank', 'release_id', 'script_id', 'script_version', 'content_hash', 'title', 'category', 'answer_text', 'platform_scope',
      'product_scope_type', 'product_scope_refs', 'effective_from', 'effective_to', 'intent_taxonomy_version', 'intent_id',
      'risk_level', 'risk_categories', 'has_conflict', 'placeholder_keys',
    ]) && ['script_id', 'content_hash', 'title', 'category', 'answer_text', 'effective_from'].every(k => typeof c[k] === 'string')
      && c.release_id === x.releaseId && Number.isSafeInteger(c.script_version) && Number.isInteger(c.rank) && (c.rank as number) >= 1 && (c.rank as number) <= 3
      && ['low', 'medium', 'high'].includes(c.risk_level as string) && (c.effective_to === null || typeof c.effective_to === 'string')
      && Array.isArray(c.placeholder_keys) && c.placeholder_keys.every(k => ['order_id', 'date'].includes(k))
      && Array.isArray(c.platform_scope) && c.platform_scope.every(k => ['qianniu', 'douyin'].includes(k))
      && Array.isArray(c.product_scope_refs) && c.product_scope_refs.every(k => typeof k === 'string'));
}
