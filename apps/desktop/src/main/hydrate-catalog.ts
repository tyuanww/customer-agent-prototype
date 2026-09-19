import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductCandidate } from '../shared/product-search';
import type { RankedRetrieval, RetrievalScript } from '../shared/hybrid-retrieve';
import { assertOffRepoIndexPath, syncRetrievalIndexFromSnapshot } from './retrieval-index-store.ts';
import { DEFAULT_HYDRATE_INDEX_PATH, productStackReadPath } from './packaged-retrieval-paths.ts';

export type HydrateCatalog = Readonly<{
  releaseId: string;
  candidate(scriptId: string): ProductCandidate | null;
  hydrate(ranked: readonly RankedRetrieval[]): ProductCandidate[];
  retrievalScripts?(): readonly RetrievalScript[];
}>;

export const HYDRATE_CATALOG_VERSION = 1;
export const DEFAULT_HYDRATE_PATH = DEFAULT_HYDRATE_INDEX_PATH;

export type HydrateSnapshotItem = Readonly<{
  script_id: string;
  script_version: number;
  content_hash: string;
  title: string;
  category: string;
  answer_text: string;
  platform_scope: readonly string[];
  product_scope_type: string;
  product_scope_refs: readonly string[];
  effective_from: string;
  effective_to: string | null;
  intent_taxonomy_version: string;
  intent_id: string;
  risk_level: string;
  risk_categories: readonly string[];
  has_conflict: boolean;
  placeholder_keys: readonly string[];
  questions?: readonly Readonly<{ question_text?: string }>[];
}>;

export type SyncHydrateResult = Readonly<{
  path: string;
  releaseId: string;
  previousReleaseId: string | null;
  total: number;
  wrote: boolean;
  skipped: boolean;
  reason: 'aligned' | 'empty' | 'wrote' | 'dry-run' | 'invalid' | 'kept-larger';
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
  questionText: string;
  questions: readonly string[];
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
  const questionTextRaw = Reflect.get(item, 'questionText');
  const questionText = typeof questionTextRaw === 'string' ? questionTextRaw : '';
  const questionsRaw = Reflect.get(item, 'questions');
  const questions = parseStringList(questionsRaw) ?? [];
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
    questionText,
    questions: Object.freeze(questions),
  });
}

function snapshotItemToObject(item: HydrateSnapshotItem): object {
  const questions: string[] = [];
  for (const question of item.questions ?? []) {
    if (typeof question.question_text === 'string' && question.question_text.trim().length > 0) {
      questions.push(question.question_text.trim());
    }
  }
  return {
    scriptId: item.script_id,
    scriptVersion: item.script_version,
    contentHash: item.content_hash,
    title: item.title,
    category: item.category,
    answerText: item.answer_text,
    platformScope: item.platform_scope,
    productScopeType: item.product_scope_type,
    productScopeRefs: item.product_scope_refs,
    effectiveFrom: item.effective_from,
    effectiveTo: item.effective_to,
    intentTaxonomyVersion: item.intent_taxonomy_version,
    intentId: item.intent_id,
    riskLevel: item.risk_level,
    riskCategories: item.risk_categories,
    hasConflict: item.has_conflict,
    placeholderKeys: item.placeholder_keys,
    questionText: questions[0] ?? '',
    questions,
  };
}

function fingerprint(releaseId: string, rows: readonly Readonly<{ scriptId: string; contentHash: string }>[]): string {
  return `${releaseId}\n${[...rows].map((row) => `${row.scriptId}:${row.contentHash}`).sort().join('\n')}`;
}

function existingFingerprint(indexPath: string): { releaseId: string; fingerprint: string; total: number } | null {
  if (!existsSync(indexPath)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(indexPath, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const releaseId = Reflect.get(raw, 'releaseId');
    const scripts = Reflect.get(raw, 'scripts');
    if (typeof releaseId !== 'string' || releaseId.length < 1 || !Array.isArray(scripts)) return null;
    const rows: Array<{ scriptId: string; contentHash: string }> = [];
    for (const item of scripts) {
      if (!item || typeof item !== 'object') continue;
      const scriptId = Reflect.get(item, 'scriptId');
      const contentHash = Reflect.get(item, 'contentHash');
      if (typeof scriptId !== 'string' || typeof contentHash !== 'string') continue;
      rows.push({ scriptId, contentHash });
    }
    return { releaseId, fingerprint: fingerprint(releaseId, rows), total: rows.length };
  } catch {
    return null;
  }
}

function writeAtomic(indexPath: string, body: string): void {
  mkdirSync(dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, body);
  renameSync(tempPath, indexPath);
}

function serializeHydrateDocument(
  releaseId: string,
  rows: readonly Readonly<{ row: SnapshotRow; questionText: string }>[],
): string {
  return `${JSON.stringify({
    version: HYDRATE_CATALOG_VERSION,
    releaseId,
    scripts: rows.map(({ row, questionText }) => ({
      releaseId: row.releaseId,
      scriptId: row.scriptId,
      scriptVersion: row.scriptVersion,
      contentHash: row.contentHash,
      title: row.title,
      category: row.category,
      answerText: row.answerText,
      platformScope: [...row.platformScope],
      productScopeType: row.productScopeType,
      productScopeRefs: [...row.productScopeRefs],
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      intentTaxonomyVersion: row.intentTaxonomyVersion,
      intentId: row.intentId,
      riskLevel: row.riskLevel,
      riskCategories: [...row.riskCategories],
      hasConflict: row.hasConflict,
      placeholderKeys: [...row.placeholderKeys],
      questionText,
      questions: [...row.questions],
    })),
  })}\n`;
}

function desktopRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

export function syncHydrateCatalog(options: Readonly<{
  path: string;
  repoRoot: string;
  releaseId: string;
  items: readonly HydrateSnapshotItem[];
  dryRun?: boolean;
  rebuild?: boolean;
}>): SyncHydrateResult {
  const indexPath = assertOffRepoIndexPath(options.path, options.repoRoot);
  const previous = existingFingerprint(indexPath);
  if (options.items.length === 0) {
    return Object.freeze({
      path: indexPath,
      releaseId: options.releaseId,
      previousReleaseId: previous?.releaseId ?? null,
      total: 0,
      wrote: false,
      skipped: true,
      reason: 'empty',
    });
  }
  const parsed: Array<{ row: SnapshotRow; questionText: string }> = [];
  for (const item of options.items) {
    const row = parseSnapshotRow(snapshotItemToObject(item), options.releaseId);
    if (!row) continue;
    parsed.push({
      row,
      questionText: typeof item.questions?.[0]?.question_text === 'string' ? item.questions[0].question_text : '',
    });
  }
  if (parsed.length === 0) {
    return Object.freeze({
      path: indexPath,
      releaseId: options.releaseId,
      previousReleaseId: previous?.releaseId ?? null,
      total: 0,
      wrote: false,
      skipped: true,
      reason: 'invalid',
    });
  }
  if (!options.rebuild && previous && previous.total > parsed.length) {
    return Object.freeze({
      path: indexPath,
      releaseId: previous.releaseId,
      previousReleaseId: previous.releaseId,
      total: previous.total,
      wrote: false,
      skipped: true,
      reason: 'kept-larger',
    });
  }
  const nextFingerprint = fingerprint(options.releaseId, parsed.map(({ row }) => row));
  const aligned = !options.rebuild && previous?.fingerprint === nextFingerprint;
  if (aligned || options.dryRun) {
    return Object.freeze({
      path: indexPath,
      releaseId: options.releaseId,
      previousReleaseId: previous?.releaseId ?? null,
      total: parsed.length,
      wrote: false,
      skipped: aligned,
      reason: aligned ? 'aligned' : 'dry-run',
    });
  }
  writeAtomic(indexPath, serializeHydrateDocument(options.releaseId, parsed));
  return Object.freeze({
    path: indexPath,
    releaseId: options.releaseId,
    previousReleaseId: previous?.releaseId ?? null,
    total: parsed.length,
    wrote: true,
    skipped: false,
    reason: 'wrote',
  });
}

export function persistHydrateFromEnv(
  releaseId: string,
  items: readonly HydrateSnapshotItem[],
): SyncHydrateResult | null {
  const hydratePath = (process.env.CUSTOMER_AGENT_HYDRATE_INDEX ?? '').trim();
  if (hydratePath.length === 0) return null;
  try {
    const repoRoot = desktopRepoRoot();
    const hydrate = syncHydrateCatalog({
      path: hydratePath,
      repoRoot,
      releaseId,
      items,
    });
    if (hydrate.reason === 'kept-larger' || hydrate.reason === 'empty' || hydrate.reason === 'invalid') {
      return hydrate;
    }
    const retrievalPath = (process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX ?? '').trim();
    let indexWrote = false;
    if (retrievalPath.length > 0) {
      try {
        const index = syncRetrievalIndexFromSnapshot({
          path: retrievalPath,
          repoRoot,
          releaseId,
          items,
        });
        indexWrote = index.wrote;
      } catch {
        // Index persist is best-effort. Hydrate remains the copy SoR; BM25 can
        // use hydrate.retrievalScripts() when the index file is missing.
      }
    }
    if (indexWrote && hydrate.reason === 'aligned') {
      return Object.freeze({ ...hydrate, wrote: true, skipped: false, reason: 'wrote' as const });
    }
    return hydrate;
  } catch {
    return null;
  }
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

export function loadHydrateCatalog(
  indexPath = productStackReadPath('CUSTOMER_AGENT_HYDRATE_INDEX', 'retrieval-hydrate.json') || undefined,
): HydrateCatalog | null {
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
      retrievalScripts() {
        return Object.freeze([...byId.values()].map((row) => Object.freeze({
          scriptId: row.scriptId,
          title: row.title,
          questionText: row.questionText,
          answerText: row.answerText,
          category: row.category,
          questions: row.questions,
        })));
      },
    });
  } catch {
    return null;
  }
}
