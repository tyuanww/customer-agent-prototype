/**
 * 诚实四库：本版是否更新了某一域，以及对坐席「未读」用的域内容哈希。
 *
 * 唯一对外用词是「本版已更新 / 本版沿用」。合成 `rel_N` 仍是唯一检索租约，
 * 不在这里出现。卡状态唯一源是发布成功时写入 `Announcement.summary` 的那句 delta；
 * 未读只比较「域内容哈希」（category + 排序后的 scriptId+content_hash，**不含** releaseId）。
 *
 * 这个模块必须是 renderer 安全的：不能 import `node:crypto`，因为工作台 renderer 也用它。
 */

/** 四张卡的固定顺序：产品 → 活动 → 售前 → 售后。 */
export const LIBRARY_DOMAINS = ['product', 'campaign', 'presale', 'aftersale'] as const;
export type LibraryDomain = (typeof LIBRARY_DOMAINS)[number];

export const LIBRARY_DOMAIN_LABELS: Readonly<Record<LibraryDomain, string>> = Object.freeze({
  product: '产品',
  campaign: '活动',
  presale: '售前',
  aftersale: '售后',
});

export const LIBRARY_UPDATED = 'updated';
export const LIBRARY_CARRIED = 'carried';
export type LibraryStatus = typeof LIBRARY_UPDATED | typeof LIBRARY_CARRIED;
export type LibraryDelta = Readonly<Record<LibraryDomain, LibraryStatus>>;
export type LibraryDomainCounts = Readonly<Record<LibraryDomain, number>>;
export type LibraryDomainHashes = Readonly<Record<LibraryDomain, string>>;

/** 卡状态无法从 summary 解析时的兜底文案。四卡仍显示库名 + 条数 + 脚注。 */
export const LIBRARY_DELTA_UNREADABLE = '无法标出本版更新了哪一库';
export const LIBRARY_DELTA_SEPARATOR = ' · ';

export function isLibraryDomain(value: unknown): value is LibraryDomain {
  return typeof value === 'string' && (LIBRARY_DOMAINS as readonly string[]).includes(value);
}

/**
 * 本批绑定的域 = 本版已更新；其余 = 本版沿用。顺序固定 产品 → 活动 → 售前 → 售后。
 * `count` 为 `null` 表示拿不到条数，那就省略括号里的数字（不编造）。
 */
export function composeLibraryDelta(
  updated: readonly Readonly<{ domain: LibraryDomain; count: number | null }>[],
): string {
  const bound = new Map<LibraryDomain, number | null>();
  for (const entry of updated) bound.set(entry.domain, entry.count);
  return LIBRARY_DOMAINS.map((domain) => {
    const label = LIBRARY_DOMAIN_LABELS[domain];
    if (!bound.has(domain)) return `${label}沿用`;
    const count = bound.get(domain);
    return typeof count === 'number' && Number.isFinite(count) && count >= 0
      ? `${label}已更新（${count} 条）`
      : `${label}已更新`;
  }).join(LIBRARY_DELTA_SEPARATOR);
}

const DELTA_SEGMENT = /^(产品|活动|售前|售后)(已更新|沿用)(?:（(\d+) 条）)?$/;
const LABEL_TO_DOMAIN: Readonly<Record<string, LibraryDomain>> = Object.freeze({
  产品: 'product',
  活动: 'campaign',
  售前: 'presale',
  售后: 'aftersale',
});

/**
 * 解析发布回执那一句四库 delta。顺序无关（发布者与坐席可能读到不同书写顺序的旧句）。
 * 四个域必须各出现一次，否则返回 null（四卡走「无法标出本版更新了哪一库」兜底）。
 */
export function parseLibraryDelta(summary: string | null | undefined): LibraryDelta | null {
  if (typeof summary !== 'string' || summary.trim().length === 0) return null;
  const seen = new Map<LibraryDomain, LibraryStatus>();
  for (const rawSegment of summary.split('·')) {
    const segment = rawSegment.trim();
    if (segment.length === 0) return null;
    const match = DELTA_SEGMENT.exec(segment);
    if (!match) return null;
    const domain = LABEL_TO_DOMAIN[match[1]];
    if (!domain || seen.has(domain)) return null;
    seen.set(domain, match[2] === '已更新' ? LIBRARY_UPDATED : LIBRARY_CARRIED);
  }
  if (seen.size !== LIBRARY_DOMAINS.length) return null;
  return Object.freeze({
    product: seen.get('product') as LibraryStatus,
    campaign: seen.get('campaign') as LibraryStatus,
    presale: seen.get('presale') as LibraryStatus,
    aftersale: seen.get('aftersale') as LibraryStatus,
  });
}

type DomainTaggedItem = Readonly<{ category: string; script_id: string; content_hash: string }>;

/**
 * 当次 snapshot 内存里的域条数。**不要**用磁盘 hydrate：`kept-larger` 可能留着一份
 * 比当前发布更大的旧目录，那会把「本版」的条数写错。
 */
export function libraryDomainCounts(items: readonly DomainTaggedItem[]): LibraryDomainCounts {
  const counts: Record<LibraryDomain, number> = { product: 0, campaign: 0, presale: 0, aftersale: 0 };
  for (const item of items) {
    if (isLibraryDomain(item.category)) counts[item.category] += 1;
  }
  return Object.freeze(counts);
}

/**
 * 域内容哈希：category + 排序后的 `scriptId+content_hash`，**不含** releaseId。
 * 两台机器对同一份内容算出同一个值；换 `rel_N` 但某域内容没动时该域哈希不变。
 */
export function libraryDomainHashes(items: readonly DomainTaggedItem[]): LibraryDomainHashes {
  const buckets: Record<LibraryDomain, string[]> = { product: [], campaign: [], presale: [], aftersale: [] };
  for (const item of items) {
    if (!isLibraryDomain(item.category)) continue;
    buckets[item.category].push(`${item.script_id}+${item.content_hash}`);
  }
  return Object.freeze({
    product: hashDomain('product', buckets.product),
    campaign: hashDomain('campaign', buckets.campaign),
    presale: hashDomain('presale', buckets.presale),
    aftersale: hashDomain('aftersale', buckets.aftersale),
  });
}

function hashDomain(domain: LibraryDomain, members: readonly string[]): string {
  const body = `${domain}\u0000${[...members].sort().join('\n')}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < body.length; index += 1) {
    const code = body.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * 未读 = 当前域哈希与基线不同的域，按固定顺序返回。
 * 基线可以是部分（某域从没建过基线时视为该域未读）；`null` 表示完全没有基线，此时
 * 调用方不得点亮——这里只做比较，基线的建立与已读由 main 的 last_seen 负责。
 */
export function unreadDomains(
  current: LibraryDomainHashes,
  baseline: Readonly<Partial<Record<LibraryDomain, string>>> | null,
): readonly LibraryDomain[] {
  if (!baseline) return [];
  return LIBRARY_DOMAINS.filter((domain) => current[domain] !== baseline[domain]);
}

export function isLibraryDomainHashes(value: unknown): value is LibraryDomainHashes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== LIBRARY_DOMAINS.length) return false;
  return LIBRARY_DOMAINS.every((domain) => typeof record[domain] === 'string' && (record[domain] as string).length > 0);
}

export function isLibraryDomainCounts(value: unknown): value is LibraryDomainCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== LIBRARY_DOMAINS.length) return false;
  return LIBRARY_DOMAINS.every((domain) => Number.isSafeInteger(record[domain]) && (record[domain] as number) >= 0);
}
