import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  LIBRARY_DOMAINS,
  isLibraryDomain,
  type LibraryDomain,
  type LibraryDomainHashes,
} from '../shared/library-delta';

/** 每用户每域的「已读基线」= 该域看到过的内容哈希。缺域即该域尚无基线。 */
export type LibraryBaseline = Readonly<Partial<Record<LibraryDomain, string>>>;
export type LastSeenStore = {
  /** 无基线返回 null。绝不因读取而建基线。 */
  baseline(userId: string): LibraryBaseline | null;
  /** 仅当该用户完全没有基线时写入当前哈希（第一次完整 snapshot 建基线）。 */
  establish(userId: string, hashes: LibraryDomainHashes): void;
  /** 把列出的域基线推到当前哈希 = 已读。 */
  markRead(userId: string, domains: readonly LibraryDomain[], hashes: LibraryDomainHashes): void;
};

export const NO_LAST_SEEN: LastSeenStore = Object.freeze({
  baseline: () => null,
  establish: () => {},
  markRead: () => {},
});

const MAX_BYTES = 262_144;

/** origin-keyed 文件名，对齐 `product-session.${id}.enc`。 */
export function lastSeenFileName(apiOrigin: string): string {
  const id = createHash('sha256').update(apiOrigin).digest('hex').slice(0, 16);
  return `product-last-seen.${id}.json`;
}

function isBaseline(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [domain, hash] of Object.entries(value)) {
    if (!isLibraryDomain(domain) || typeof hash !== 'string' || hash.length === 0 || hash.length > 128) {
      return false;
    }
  }
  return true;
}

type LastSeenDocument = Record<string, Record<string, string>>;

/**
 * 明文 last_seen（不是密钥，不含 token）。文件 0o600，按 origin 分文件，
 * 按 `userId → { domain: hash }` 存。写入用 `wx` + rename，避免半截文件。
 */
export function createLastSeenStore(directory: string, apiOrigin: string): LastSeenStore {
  const target = path.join(directory, lastSeenFileName(apiOrigin));
  const temporary = `${target}.tmp`;
  const read = (): LastSeenDocument => {
    try {
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.size > MAX_BYTES) return {};
      const raw: unknown = JSON.parse(readFileSync(target, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const out: LastSeenDocument = {};
      for (const [userId, baseline] of Object.entries(raw)) {
        if (userId.length < 1 || userId.length > 128) continue;
        if (!isBaseline(baseline)) continue;
        out[userId] = { ...baseline };
      }
      return out;
    } catch {
      return {};
    }
  };
  const write = (document: LastSeenDocument): void => {
    try {
      mkdirSync(directory, { recursive: true });
      try { unlinkSync(temporary); } catch { /* no leftover */ }
      const bytes = `${JSON.stringify(document)}\n`;
      writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, target);
    } catch {
      try { unlinkSync(temporary); } catch { /* best effort */ }
    }
  };
  return {
    baseline(userId: string) {
      if (userId.length === 0) return null;
      const found = read()[userId];
      return found && Object.keys(found).length > 0 ? Object.freeze({ ...found }) : null;
    },
    establish(userId: string, hashes: LibraryDomainHashes) {
      if (userId.length === 0) return;
      const document = read();
      if (document[userId] && Object.keys(document[userId]).length > 0) return;
      document[userId] = Object.fromEntries(LIBRARY_DOMAINS.map((domain) => [domain, hashes[domain]]));
      write(document);
    },
    markRead(userId: string, domains: readonly LibraryDomain[], hashes: LibraryDomainHashes) {
      if (userId.length === 0 || domains.length === 0) return;
      const document = read();
      const current = document[userId] ?? {};
      const next: Record<string, string> = { ...current };
      for (const domain of domains) next[domain] = hashes[domain];
      document[userId] = next;
      write(document);
    },
  };
}
