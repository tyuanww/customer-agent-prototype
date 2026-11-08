import { createHash } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { parseSopReleaseProjection, type SopReleaseProjection } from '@customer-agent/content-intake';
import type { components } from '@customer-agent/contracts';
import {
  parseReleaseSnapshot,
  type ReleaseId,
  type ReleaseSnapshot,
  type Scope,
} from '@customer-agent/unified-contracts';
import { arcDomain, type ArcSourceScope } from './access.js';
import type { IntegrationPool } from './database.js';
import type { ContentIndexItem } from '../query/content-pipeline.js';

type SearchCandidate = components['schemas']['SearchCandidate'];
type CandidateMetadata = Omit<SearchCandidate, 'rank'>;

type ReleaseRow = QueryResultRow & Readonly<{
  release_id: string;
  release_seq: string | number;
  published_at: Date | string;
  source_binding_hash: string;
}>;

type ReleaseItemRow = QueryResultRow & Readonly<{
  script_id: string;
  script_version: number;
  content_hash: string;
  title: string;
  category: 'presale' | 'campaign' | 'aftersale' | 'product';
  answer_text: string;
  platform_scope: string[];
  product_scope_type: 'storewide' | 'category' | 'sku';
  product_scope_refs: string[];
  effective_from: Date | string;
  effective_to: Date | string | null;
  intent_taxonomy_version: string;
  intent_id: string;
  risk_level: 'low' | 'medium' | 'high';
  risk_categories: string[];
  has_conflict: boolean;
  placeholder_keys: string[];
  questions_json: unknown;
  source_id: string;
  tenant_id: string;
  app_id: string;
  brand_id: string;
  shop_id: string | null;
  domain: string;
}>;

export type LoadedQueryRelease = Readonly<{
  snapshot: ReleaseSnapshot;
  sourceBindingHash: string;
  items: readonly ContentIndexItem[];
  candidates: ReadonlyMap<string, CandidateMetadata>;
  sourceScopes: readonly Scope[];
  sopProjection: SopReleaseProjection | null;
}>;

export type QueryReleaseLoader = () => Promise<LoadedQueryRelease | null>;
export type CurrentReleaseIdentityReader = () => Promise<string | null>;

const GLOBAL_SHOP_ID = '__all__';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.valueOf())) throw new Error('RELEASE_TIMESTAMP_INVALID');
  return parsed.toISOString();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('RELEASE_ITEM_INVALID');
  }
  return [...value] as string[];
}

function riskCategories(value: unknown): CandidateMetadata['risk_categories'] {
  const items = stringArray(value);
  const allowed = new Set<CandidateMetadata['risk_categories'][number]>([
    'refund_compensation',
    'price_discount',
    'campaign_rules',
    'efficacy_safety_claim',
    'account_privacy',
    'complaint_escalation',
    'legal_commitment',
  ]);
  if (items.some((item) => !allowed.has(item as CandidateMetadata['risk_categories'][number]))) {
    throw new Error('RELEASE_ITEM_INVALID');
  }
  return items as CandidateMetadata['risk_categories'];
}

function placeholderKeys(value: unknown): CandidateMetadata['placeholder_keys'] {
  const items = stringArray(value);
  if (items.some((item) => item !== 'order_id' && item !== 'date')) {
    throw new Error('RELEASE_ITEM_INVALID');
  }
  return items as CandidateMetadata['placeholder_keys'];
}

function questionTexts(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) throw new Error('RELEASE_ITEM_INVALID');
  const texts: string[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (row.active === false) continue;
    const text = row.question_text ?? row.questionText ?? row.text;
    if (typeof text === 'string' && text.length > 0) texts.push(text);
  }
  return [...new Set(texts)];
}

function sourceScope(
  row: Pick<ReleaseItemRow, 'tenant_id' | 'app_id' | 'brand_id' | 'shop_id' | 'domain' | 'source_id'>,
): ArcSourceScope {
  const scope: ArcSourceScope = {
    kind: 'source',
    tenantId: row.tenant_id as never,
    appId: row.app_id as never,
    brandId: row.brand_id as never,
    shopId: (row.shop_id ?? GLOBAL_SHOP_ID) as never,
    domain: arcDomain(row.domain),
    sourceId: row.source_id as never,
  };
  return Object.freeze(scope);
}

function canonical(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, item]) => [key, normalize(item)]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

function buildLoadedRelease(
  release: ReleaseRow,
  rows: readonly ReleaseItemRow[],
  sopProjection: SopReleaseProjection | null,
): LoadedQueryRelease {
  if (!/^[a-f0-9]{64}$/u.test(release.source_binding_hash)) {
    throw new Error('RELEASE_SOURCE_HASH_INVALID');
  }
  const releaseId = release.release_id as ReleaseId;
  const candidates = new Map<string, CandidateMetadata>();
  const items: ContentIndexItem[] = [];
  const sourceScopes = new Map<string, Scope>();
  const seen = new Set<string>();
  for (const row of rows) {
    const indexedId = `${row.source_id}:${row.script_id}`;
    if (seen.has(indexedId)) throw new Error('RELEASE_ITEM_DUPLICATE');
    seen.add(indexedId);
    const scope = sourceScope(row);
    sourceScopes.set(canonical(scope), scope);
    const effectiveFrom = iso(row.effective_from);
    const effectiveTo = row.effective_to === null ? null : iso(row.effective_to);
    const platforms = stringArray(row.platform_scope).filter(
      (platform): platform is 'qianniu' | 'douyin' => platform === 'qianniu' || platform === 'douyin',
    );
    if (platforms.length === 0) throw new Error('RELEASE_ITEM_INVALID');
    const metadata: CandidateMetadata = Object.freeze({
      release_id: release.release_id,
      script_id: row.script_id,
      script_version: row.script_version,
      content_hash: row.content_hash,
      title: row.title,
      category: row.category,
      answer_text: row.answer_text,
      platform_scope: platforms,
      product_scope_type: row.product_scope_type,
      product_scope_refs: stringArray(row.product_scope_refs),
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      intent_taxonomy_version: row.intent_taxonomy_version,
      intent_id: row.intent_id,
      risk_level: row.risk_level,
      risk_categories: riskCategories(row.risk_categories),
      has_conflict: row.has_conflict,
      placeholder_keys: placeholderKeys(row.placeholder_keys),
    });
    candidates.set(indexedId, metadata);
    items.push(Object.freeze({
      releaseId,
      scriptId: indexedId,
      scriptVersion: row.script_version,
      contentHash: row.content_hash,
      title: row.title,
      body: row.answer_text,
      questionTexts: Object.freeze(questionTexts(row.questions_json)),
      platformScope: Object.freeze(platforms),
      productScopeType: row.product_scope_type,
      productScopeRefs: Object.freeze([...metadata.product_scope_refs]),
      effectiveFrom,
      effectiveTo,
      scope,
    }));
  }
  items.sort((left, right) => compareText(left.scriptId, right.scriptId));
  const content = items.length === 0
    ? Object.freeze({
      state: 'empty' as const,
      indexId: null,
      indexVersion: null,
      itemCount: 0,
      indexHash: null,
    })
    : Object.freeze({
      state: 'ready' as const,
      indexId: `content:${release.release_id}`,
      indexVersion: 1,
      itemCount: items.length,
      indexHash: createHash('sha256').update(canonical(items.map((item) => ({
        scriptId: item.scriptId,
        scriptVersion: item.scriptVersion,
        contentHash: item.contentHash,
        body: item.body,
        scope: item.scope,
      })))).digest('hex'),
    });
  const sop = sopProjection === null
    ? Object.freeze({
      state: 'empty' as const,
      indexId: null,
      indexVersion: null,
      itemCount: 0,
      indexHash: null,
    })
    : Object.freeze({
      state: 'ready' as const,
      indexId: `sop:${release.release_id}`,
      indexVersion: 1,
      itemCount: sopProjection.itemCount,
      indexHash: sopProjection.indexHash,
    });
  return Object.freeze({
    snapshot: parseReleaseSnapshot({
      releaseId: release.release_id,
      sequence: Number(release.release_seq),
      publishedAt: iso(release.published_at),
      content,
      sop,
    }),
    sourceBindingHash: release.source_binding_hash,
    items: Object.freeze(items),
    candidates,
    sourceScopes: Object.freeze([...sourceScopes.values()]),
    sopProjection,
  });
}

/**
 * Reads one immutable, source-gated release through the intake usage role.
 * The returned index contains every relevant source scope. Query access still
 * filters each document through the ACL projection before ranking.
 */
export function createPostgresQueryReleaseLoader(pool: IntegrationPool): QueryReleaseLoader {
  return async () => {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const releases = await client.query<ReleaseRow>(`
        SELECT current_release.current_release_id AS release_id,
          release.release_seq, release.published_at, release.source_binding_hash
        FROM public.content_current current_release
        JOIN public.content_releases release
          ON release.release_id=current_release.current_release_id
        JOIN public.v_release_source_gate gate
          ON gate.release_id=release.release_id
        WHERE current_release.id=1 AND gate.source_gate_ready
      `);
      const release = releases.rows[0];
      if (release === undefined) {
        await client.query('COMMIT');
        return null;
      }
      const rows = await client.query<ReleaseItemRow>(`
        SELECT item.script_id, item.script_version, item.content_hash, item.title,
          item.category, item.answer_text, item.platform_scope, item.product_scope_type,
          item.product_scope_refs, item.effective_from, item.effective_to,
          item.intent_taxonomy_version, item.intent_id, item.risk_level,
          item.risk_categories, item.has_conflict, item.placeholder_keys,
          item.questions_json, source.source_id, scope.tenant_id, scope.app_id,
          scope.brand_id, scope.shop_id, scope.domain
        FROM public.release_items item
        JOIN content_intake.sources source ON source.mode='v2-preview'
        JOIN content_intake.scopes scope
          ON scope.scope_id=source.scope_id AND scope.domain=item.category
        WHERE item.release_id=$1
        ORDER BY source.source_id COLLATE "C", item.script_id COLLATE "C"
      `, [release.release_id]);
      const unprojected = await client.query<{ present: boolean }>(`
        SELECT EXISTS (
          SELECT 1
          FROM content_intake.release_lineage lineage
          JOIN content_intake.candidate_versions candidate
            ON candidate.candidate_id=lineage.candidate_id
           AND candidate.version=lineage.candidate_version
          CROSS JOIN LATERAL jsonb_array_elements(candidate.material->'entries') entry
          WHERE lineage.release_id=$1
            AND entry->>'businessEntryId'=lineage.business_entry_id
            AND entry->>'operation'='upsert'
            AND NOT EXISTS (
              SELECT 1 FROM public.release_items item
              WHERE item.release_id=lineage.release_id
                AND item.script_id=lineage.business_entry_id
                AND item.script_version=lineage.script_version
            )
          LIMIT 1
        ) AS present
      `, [release.release_id]);
      if (unprojected.rows[0]?.present === true) throw new Error('RELEASE_INDEX_ITEM_GAP');
      const projection = await client.query<{ value: unknown }>(
        'SELECT content_intake.read_sop_release_projection($1) AS value',
        [release.release_id],
      );
      const rawProjection = projection.rows[0]?.value;
      const sop = rawProjection === null || rawProjection === undefined
        ? null
        : parseSopReleaseProjection(rawProjection);
      const loaded = buildLoadedRelease(release, rows.rows, sop);
      await client.query('COMMIT');
      return loaded;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally {
      client.release(broken);
    }
  };
}

export function createPostgresCurrentReleaseIdentityReader(
  pool: IntegrationPool,
): CurrentReleaseIdentityReader {
  return async () => {
    const client = await pool.connect();
    let failed = false;
    try {
      const result = await client.query<{ release_id: string }>(`
        SELECT current_release.current_release_id AS release_id
        FROM public.content_current current_release
        JOIN public.v_release_source_gate gate
          ON gate.release_id=current_release.current_release_id
        WHERE current_release.id=1 AND gate.source_gate_ready
      `);
      return result.rows[0]?.release_id ?? null;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      client.release(failed);
    }
  };
}
