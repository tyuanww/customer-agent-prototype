import { exactKeys, productFailure, type ProductFailure } from './product-session';
import { isQueryIdentity, queryFailure, type QueryIdentity } from './product-search';

export type ProductAnnouncement = { title: string; summary: string | null; createdAt: string };
export type ProductAnnounceView = QueryIdentity & {
  ok: true; releaseId: string; releaseSeq: number; leaseExpiresAt: string; announcement: ProductAnnouncement | null;
};
export type ProductAnnounceFailure = ProductFailure & { generation: number };
export type ProductAnnounceResult = ProductAnnounceView | ProductAnnounceFailure;
export type ProductAnnounceInvalidation = {
  sessionEpoch: number; reason: 'expired' | 'replaced' | 'source_gate' | 'signed_out' | 'unavailable';
};
export type AnnounceGate = {
  allows(releaseId: string): boolean;
  subscribe(listener: () => void): () => void;
};
export const announceFailure = (code: ProductFailure['code'], identity: QueryIdentity): ProductAnnounceFailure =>
  queryFailure(code, identity);
export function isProductAnnounceRequest(v: unknown): v is QueryIdentity {
  return exactKeys(v, ['sessionEpoch', 'generation']) && isQueryIdentity(v);
}
export function isProductAnnounceResult(v: unknown): v is ProductAnnounceResult {
  if (!isQueryIdentity(v)) return false;
  const x = v as unknown as Record<string, unknown>;
  if (x.ok === false) return exactKeys(x, ['ok', 'sessionEpoch', 'generation', 'code', 'message'])
    && typeof x.code === 'string' && x.message === productFailure(x.code as ProductFailure['code']).message;
  if (x.ok !== true || !exactKeys(x, ['ok', 'sessionEpoch', 'generation', 'releaseId', 'releaseSeq', 'leaseExpiresAt', 'announcement'])) return false;
  if (typeof x.releaseId !== 'string' || x.releaseId.length < 1 || x.releaseId.length > 128 || !Number.isSafeInteger(x.releaseSeq)
    || (x.releaseSeq as number) < 1 || typeof x.leaseExpiresAt !== 'string' || !Number.isFinite(Date.parse(x.leaseExpiresAt))) return false;
  if (x.announcement === null) return true;
  return exactKeys(x.announcement, ['title', 'summary', 'createdAt']) && typeof x.announcement.title === 'string'
    && (x.announcement.summary === null || typeof x.announcement.summary === 'string') && typeof x.announcement.createdAt === 'string';
}
export function isProductAnnounceInvalidation(v: unknown): v is ProductAnnounceInvalidation {
  return exactKeys(v, ['sessionEpoch', 'reason']) && Number.isSafeInteger((v as ProductAnnounceInvalidation).sessionEpoch)
    && (v as ProductAnnounceInvalidation).sessionEpoch >= 0
    && ['expired', 'replaced', 'source_gate', 'signed_out', 'unavailable'].includes((v as ProductAnnounceInvalidation).reason);
}
export type ProductAnnounceApi = {
  refresh(request: QueryIdentity): Promise<ProductAnnounceResult>;
  onInvalidated(listener: (value: ProductAnnounceInvalidation) => void): () => void;
};
