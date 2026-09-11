import { existsSync, readFileSync } from 'node:fs';
import type { ProductCandidate } from '../shared/product-search';
import type { RankedRetrieval } from '../shared/hybrid-retrieve';

export type HydrateCatalog = Readonly<{
  releaseId: string;
  candidate(scriptId: string): ProductCandidate | null;
  hydrate(ranked: readonly RankedRetrieval[]): ProductCandidate[];
}>;

const CATEGORIES = ['presale', 'campaign', 'aftersale', 'product'] as const;
const PLATFORMS = ['qianniu', 'douyin'] as const;
const SCOPE_TYPES = ['storewide', 'category', 'sku'] as const;
const RISK_LEVELS = ['low', 'medium', 'high'] as const;
const RISK_CATEGORIES = [
  'refund_compensation', 'price_discount', 'campaign_rules', 'efficacy_safety_claim',
  'account_privacy', 'complaint_escalation', 'legal_commitment',
] as const;
const PLACEHOLDERS = ['order_id', 'date'] as const;

type SnapshotRow = Readonly<{
  releaseId: string;
  scriptId: string;
  scriptVersion: number;
  contentHash: string;
  title: string;
  category: (typeof CATEGORIES)[number];
  answerText: string;
  platformScope: ProductCandidate['platform_scope'];
  productScopeType: (typeof SCOPE_TYPES)[number];
  productScopeRefs: readonly string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  intentTaxonomyVersion: string;
  intentId: string;
  riskLevel: ProductCandidate['risk_level'];
  riskCategories: ProductCandidate['risk_categories'];
  hasConflict: boolean;
  placeholderKeys: ProductCandidate['placeholder_keys'];
}>;

function isMember<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function parseStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

function parseEnumList<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  const raw = parseStringList(value);
  if (!raw) return null;
  const out: T[] = [];
  for (const item of raw) {
    if (!isMember(item, allowed)) return null;
    out.push(item);
  }
  return out;
}

function parseSnapshotRow(item: object, releaseId: string): SnapshotRow | null {
  const scriptId = Reflect.get(item, 'scriptId');
  const scriptVersion = Reflect.get(item, 'scriptVersion');
  const contentHash = Reflect.get(item, 'contentHash');
  const title = Reflect.get(item, 'title');
  const category = Reflect.get(item, 'category');
  const answerText = Reflect.get(item, 'answerText');
  const productScopeType = Reflect.get(item, 'productScopeType');
  const effectiveFrom = Reflect.get(item, 'effectiveFrom');
  const effectiveTo = Reflect.get(item, 'effectiveTo');
  const intentTaxonomyVersion = Reflect.get(item, 'intentTaxonomyVersion');
  const intentId = Reflect.get(item, 'intentId');
  const riskLevel = Reflect.get(item, 'riskLevel');
  const hasConflict = Reflect.get(item, 'hasConflict');
  const platformScope = parseEnumList(Reflect.get(item, 'platformScope'), PLATFORMS);
  const productScopeRefs = parseStringList(Reflect.get(item, 'productScopeRefs'));
  const riskCategories = parseEnumList(Reflect.get(item, 'riskCategories'), RISK_CATEGORIES);
  const placeholderKeys = parseEnumList(Reflect.get(item, 'placeholderKeys'), PLACEHOLDERS);
  if (typeof scriptId !== 'string' || scriptId.length < 1) return null;
  if (typeof scriptVersion !== 'number' || !Number.isInteger(scriptVersion) || scriptVersion < 1) return null;
  if (typeof contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(contentHash)) return null;
  if (typeof title !== 'string' || title.trim().length < 1) return null;
  if (!isMember(category, CATEGORIES)) return null;
  if (typeof answerText !== 'string' || answerText.trim().length < 1) return null;
  if (!platformScope || platformScope.length === 0) return null;
  if (!isMember(productScopeType, SCOPE_TYPES)) return null;
  if (!productScopeRefs) return null;
  if (typeof effectiveFrom !== 'string' || effectiveFrom.length < 1) return null;
  if (!(effectiveTo === null || typeof effectiveTo === 'string')) return null;
  if (typeof intentTaxonomyVersion !== 'string' || intentTaxonomyVersion.length < 1) return null;
  if (typeof intentId !== 'string' || intentId.length < 1) return null;
  if (!isMember(riskLevel, RISK_LEVELS)) return null;
  if (!riskCategories) return null;
  if (typeof hasConflict !== 'boolean') return null;
  if (!placeholderKeys) return null;
  return Object.freeze({
    releaseId,
    scriptId,
    scriptVersion,
    contentHash,
    title,
    category,
    answerText,
    platformScope: Object.freeze(platformScope) as ProductCandidate['platform_scope'],
    productScopeType,
    productScopeRefs: Object.freeze(productScopeRefs),
    effectiveFrom,
    effectiveTo,
    intentTaxonomyVersion,
    intentId,
    riskLevel,
    riskCategories: Object.freeze(riskCategories) as ProductCandidate['risk_categories'],
    hasConflict,
    placeholderKeys: Object.freeze(placeholderKeys) as ProductCandidate['placeholder_keys'],
  });
}

function asCandidate(row: SnapshotRow, rank: 1 | 2 | 3): ProductCandidate {
  return {
    rank,
    release_id: row.releaseId,
    script_id: row.scriptId,
    script_version: row.scriptVersion,
    content_hash: row.contentHash,
    title: row.title,
    category: row.category,
    answer_text: row.answerText,
    platform_scope: [...row.platformScope],
    product_scope_type: row.productScopeType,
    product_scope_refs: [...row.productScopeRefs],
    effective_from: row.effectiveFrom,
    effective_to: row.effectiveTo,
    intent_taxonomy_version: row.intentTaxonomyVersion,
    intent_id: row.intentId,
    risk_level: row.riskLevel,
    risk_categories: [...row.riskCategories],
    has_conflict: row.hasConflict,
    placeholder_keys: [...row.placeholderKeys],
  };
}

export function loadHydrateCatalog(indexPath = process.env.CUSTOMER_AGENT_HYDRATE_INDEX): HydrateCatalog | null {
  if (!indexPath || indexPath.trim().length === 0 || !existsSync(indexPath)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(indexPath, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const releaseId = Reflect.get(raw, 'releaseId');
    const scripts = Reflect.get(raw, 'scripts');
    if (typeof releaseId !== 'string' || releaseId.length < 1 || !Array.isArray(scripts)) return null;
    const byId = new Map<string, SnapshotRow>();
    for (const item of scripts) {
      if (!item || typeof item !== 'object') continue;
      const row = parseSnapshotRow(item, releaseId);
      if (!row) continue;
      byId.set(row.scriptId, row);
    }
    return Object.freeze({
      releaseId,
      candidate(scriptId: string) {
        const row = byId.get(scriptId);
        return row ? asCandidate(row, 1) : null;
      },
      hydrate(ranked: readonly RankedRetrieval[]) {
        const out: ProductCandidate[] = [];
        for (const row of ranked) {
          const found = byId.get(row.scriptId);
          if (!found) continue;
          out.push(asCandidate(found, 1));
        }
        return out;
      },
    });
  } catch {
    return null;
  }
}
