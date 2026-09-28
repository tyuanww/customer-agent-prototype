import { exactKeys } from './product-session';
import {
  isLibraryDomain,
  isLibraryDomainCounts,
  type LibraryDomain,
  type LibraryDomainCounts,
} from './library-delta';
import type { ProductAnnouncement } from './product-announce';

/**
 * 工作台「系统同步 · 话术版本更新」的四卡投影。
 *
 * 卡状态唯一源是发布成功时写入 `Announcement.summary` 的四库 delta，所有机器从
 * `/v1/announce/current` 读。**禁止**用 hydrate 哈希或本机 sourceBindings 填卡。
 * `counts` / `domainHashes` 来自当次 snapshot 内存（不是 kept-larger 磁盘 hydrate）。
 */
export type DashboardAnnounceView = Readonly<{
  ok: true;
  signedIn: boolean;
  releaseId: string;
  announcement: ProductAnnouncement | null;
  /** null = 本次拿不到域条数（降级显示「—」），不是 0。 */
  counts: LibraryDomainCounts | null;
  unread: boolean;
  unreadDomains: readonly LibraryDomain[];
}>;

export type DashboardAnnounceUnavailable = Readonly<{
  ok: false;
  code: 'NO_CURRENT' | 'FORBIDDEN' | 'UNAVAILABLE';
  signedIn: boolean;
}>;

export type DashboardAnnounceResult = DashboardAnnounceView | DashboardAnnounceUnavailable;

export type DashboardAnnounceApi = {
  current(): Promise<DashboardAnnounceResult>;
  /** 仅「话术版本更新」tab 实际可见时调用；只传域，不传 userId。 */
  markRead(domains: readonly LibraryDomain[]): Promise<void>;
};

export function dashboardAnnounceUnavailable(
  code: DashboardAnnounceUnavailable['code'],
  signedIn = false,
): DashboardAnnounceUnavailable {
  return Object.freeze({ ok: false, code, signedIn });
}

function isAnnouncement(value: unknown): value is ProductAnnouncement {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['title', 'summary', 'createdAt'])
    && typeof record.title === 'string'
    && (record.summary === null || typeof record.summary === 'string')
    && typeof record.createdAt === 'string';
}

export function isDashboardAnnounceResult(value: unknown): value is DashboardAnnounceResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return exactKeys(record, ['ok', 'code', 'signedIn'])
      && (record.code === 'NO_CURRENT' || record.code === 'FORBIDDEN' || record.code === 'UNAVAILABLE')
      && typeof record.signedIn === 'boolean';
  }
  if (record.ok !== true
    || !exactKeys(record, ['ok', 'signedIn', 'releaseId', 'announcement', 'counts', 'unread', 'unreadDomains'])) {
    return false;
  }
  if (typeof record.signedIn !== 'boolean' || typeof record.releaseId !== 'string' || record.releaseId.length < 1) return false;
  if (!(record.announcement === null || isAnnouncement(record.announcement))) return false;
  if (!(record.counts === null || isLibraryDomainCounts(record.counts))) return false;
  if (typeof record.unread !== 'boolean') return false;
  if (!Array.isArray(record.unreadDomains) || record.unreadDomains.length > 4) return false;
  if (!record.unreadDomains.every((domain) => isLibraryDomain(domain))) return false;
  if (new Set(record.unreadDomains).size !== record.unreadDomains.length) return false;
  return record.unread === ((record.unreadDomains as readonly unknown[]).length > 0);
}
