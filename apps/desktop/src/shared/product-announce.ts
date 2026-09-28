import { exactKeys, productFailure, type ProductFailure } from './product-session';
import { isQueryIdentity, queryFailure, type QueryIdentity } from './product-search';
import {
  isLibraryDomain,
  isLibraryDomainHashes,
  type LibraryDomain,
  type LibraryDomainHashes,
} from './library-delta';

export type ProductAnnouncement = { title: string; summary: string | null; createdAt: string };
export type ProductAnnounceView = QueryIdentity & {
  ok: true; releaseId: string; releaseSeq: number; leaseExpiresAt: string; announcement: ProductAnnouncement | null;
};
export type ProductAnnounceFailure = ProductFailure & { generation: number };
export type ProductAnnounceResult = ProductAnnounceView | ProductAnnounceFailure;
export type ProductAnnounceInvalidation = {
  sessionEpoch: number; reason: 'expired' | 'replaced' | 'source_gate' | 'signed_out' | 'unavailable';
};
/**
 * 软更新信号：`releaseId` 变了（内容发布），但租约仍然有效。
 * 独立于 `ProductAnnounceInvalidation`——收到它**不得**抽空结果，也不得把结果当失效。
 * `unreadDomains` 是相对该 session userId 的 last_seen 基线算出的未读域（固定顺序）。
 */
export type ProductAnnounceContentUpdate = {
  sessionEpoch: number; releaseId: string; summary: string | null; domainHashes: LibraryDomainHashes;
  unreadDomains: readonly LibraryDomain[];
};
export type ProductAnnounceUnread = {
  ok: true; signedIn: true; unread: boolean; domains: readonly LibraryDomain[];
} | {
  ok: false; signedIn: false; unread: false; domains: readonly [];
};
export type AnnounceGate = {
  allows(releaseId: string): boolean;
  currentReleaseId?(): string | null;
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
export function isProductAnnounceContentUpdate(v: unknown): v is ProductAnnounceContentUpdate {
  if (!v || typeof v !== 'object') return false;
  const x = v as Record<string, unknown>;
  if (!exactKeys(x, ['sessionEpoch', 'releaseId', 'summary', 'domainHashes', 'unreadDomains'])) return false;
  if (!Number.isSafeInteger(x.sessionEpoch) || (x.sessionEpoch as number) < 0) return false;
  if (typeof x.releaseId !== 'string' || x.releaseId.length < 1 || x.releaseId.length > 128) return false;
  if (!(x.summary === null || typeof x.summary === 'string')) return false;
  if (!isLibraryDomainHashes(x.domainHashes)) return false;
  return Array.isArray(x.unreadDomains) && x.unreadDomains.length <= 4
    && x.unreadDomains.every((domain) => isLibraryDomain(domain))
    && new Set(x.unreadDomains).size === x.unreadDomains.length;
}
export function isProductAnnounceUnread(v: unknown): v is ProductAnnounceUnread {
  if (!v || typeof v !== 'object') return false;
  const x = v as Record<string, unknown>;
  if (!exactKeys(x, ['ok', 'signedIn', 'unread', 'domains'])) return false;
  if (typeof x.signedIn !== 'boolean' || typeof x.unread !== 'boolean') return false;
  if (!Array.isArray(x.domains) || x.domains.length > 4) return false;
  if (!x.domains.every((domain) => isLibraryDomain(domain)) || new Set(x.domains).size !== x.domains.length) return false;
  if (x.ok === false) return x.signedIn === false && x.unread === false && x.domains.length === 0;
  return x.ok === true && x.signedIn === true && x.unread === (x.domains.length > 0);
}
export type ProductAnnounceApi = {
  refresh(request: QueryIdentity): Promise<ProductAnnounceResult>;
  onInvalidated(listener: (value: ProductAnnounceInvalidation) => void): () => void;
  /** Query / Fox 共用的软更新订阅。Fox 只用它读未读，不 refresh。 */
  onContentUpdated(listener: (value: ProductAnnounceContentUpdate) => void): () => void;
  /** 只读未读投影。Fox 可调；不 refresh、不 mark-read。 */
  unread(): Promise<ProductAnnounceUnread>;
  /** 把当前 session userId 的指定域标已读。调用方只传域，不传 userId。 */
  markRead(domains: readonly LibraryDomain[]): Promise<void>;
};
