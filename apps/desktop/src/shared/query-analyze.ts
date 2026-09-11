/**
 * E-commerce query analysis: slots only. Does not pick a script title.
 * Downstream retrieval may expand the BM25 query or boost a domain; it must
 * not hard-map a sentence onto one shortcut id.
 */

export type QueryDomain = 'shipping' | 'address' | 'product' | 'aftersale' | 'campaign' | 'unknown';

export type QuerySlots = Readonly<{
  domain: QueryDomain;
  entities: readonly string[];
  searchText: string;
}>;

const DOMAIN_MARKERS: readonly (readonly [QueryDomain, readonly string[]])[] = Object.freeze([
  ['shipping', Object.freeze(['发货', '到货', '时效', '快递', '物流', '几天到', '什么时候到', '什么时候发'])],
  ['address', Object.freeze(['地址', '改址', '改地址', '填错地址'])],
  ['aftersale', Object.freeze(['退货', '退款', '换货', '破损', '过敏', '售后'])],
  ['campaign', Object.freeze(['活动', '满赠', '优惠', '折扣', '赠品'])],
  ['product', Object.freeze(['面膜', '精华', '洁面', '防晒', '敏感', '适用', '怎么用', '成分'])],
]);

export function compactQueryText(value: string): string {
  return Array.from(value.normalize('NFKC').toLowerCase()).join('').replace(/[^\p{L}\p{N}]+/gu, '');
}

export function analyzeQuery(query: string): QuerySlots {
  const raw = query.trim();
  const compact = compactQueryText(raw);
  const entities: string[] = [];
  let domain: QueryDomain = 'unknown';
  for (const [next, markers] of DOMAIN_MARKERS) {
    const hit = markers.filter((marker) => raw.includes(marker) || compact.includes(compactQueryText(marker)));
    if (hit.length === 0) continue;
    entities.push(...hit);
    if (domain === 'unknown' || next !== 'product') domain = next;
    if (next !== 'product') break;
  }
  return Object.freeze({
    domain,
    entities: Object.freeze([...new Set(entities)]),
    searchText: raw,
  });
}
