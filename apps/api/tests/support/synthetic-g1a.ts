import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Client } from 'pg';
import type { SearchBackend } from '../../src/search-service.js';
import { normalizeSearchText, unicodeBigramTokens } from '../../src/search-text.js';

export type SyntheticG1aStratum = 'positive' | 'safety_negative' | 'robustness';

export type SyntheticG1aCase = Readonly<{
  id: string;
  query_text: string;
  platform: 'qianniu' | 'douyin';
  product_context_type: 'category' | 'sku' | null;
  product_context_ref: string | null;
  sku_hint: string | null;
  as_of: string;
  expected_any_top3: readonly string[];
  forbidden_script_ids: readonly string[];
  note: string;
  stratum: SyntheticG1aStratum;
}>;

type CandidateDomain = 'aftersale' | 'campaign' | 'presale' | 'product';

export type SyntheticG1aCandidate = Readonly<{
  id: string;
  domain: CandidateDomain;
  title: string;
  searchTerms: readonly string[];
  platformScope: readonly ('qianniu' | 'douyin')[];
  productScopeType?: 'storewide' | 'category' | 'sku';
  productScopeRefs?: readonly string[];
  validity?: 'active' | 'expired' | 'future';
}>;

const FIXTURE_URL = new URL('../../../../tests/fixtures/search/zh-gold.jsonl', import.meta.url);
const RELEASE_ID = 'rel_synthetic_g1a_v1';
const INTENT_TAXONOMY_VERSION = 'itax_synthetic_g1a_v1';
const INTENT_ID = 'intent_synthetic_g1a';
export const SYNTHETIC_G1A_SOURCE_BINDINGS = Object.freeze([
  ['aftersale', 'srcv_synth_g1a_aftersale_v1', 'SRC-SYNTH-G1A-AFTERSALE'],
  ['campaign', 'srcv_synth_g1a_campaign_v1', 'SRC-SYNTH-G1A-CAMPAIGN'],
  ['presale', 'srcv_synth_g1a_presale_v1', 'SRC-SYNTH-G1A-PRESALE'],
  ['product', 'srcv_synth_g1a_product_v1', 'SRC-SYNTH-G1A-PRODUCT'],
] as const);

export const SYNTHETIC_G1A_CANDIDATES = Object.freeze([
  {
    id: 'syn-presale-cleanser-001',
    domain: 'presale',
    title: '星澜洁面露合成使用说明',
    searchTerms: [
      '星澜洁面露怎样使用',
      '星澜洁面露怎么用',
      '星澜洗面露用法',
      '星澜洁面露每天用几次',
      '星澜洗面露咋使',
    ],
    platformScope: ['qianniu', 'douyin'],
  },
  {
    id: 'syn-campaign-cloud-week-001',
    domain: 'campaign',
    title: '云朵会员周合成活动说明',
    searchTerms: [
      '云朵会员周活动什么时候结束',
      '云朵会员周截止时间',
      '云朵会员周到几号',
      '云朵会员周赠品怎么领',
      '云朵会员週活動什麼時候結束',
      '云朵会员周赠品咋领',
      '云朵会员周截止到几号',
    ],
    platformScope: ['qianniu', 'douyin'],
  },
  {
    id: 'syn-product-serum-refill-001',
    domain: 'product',
    title: '月屿精华补充装合成安装说明',
    searchTerms: [
      '月屿精华的补充装怎么安装',
      '月屿精华替换芯安装',
      '月屿精华补充装装法',
      '月屿精华补充装如何更换',
      '月屿精华替換芯怎麼安裝',
      '月屿精华补充装咋换',
      '月屿精华补充装怎么安装',
    ],
    platformScope: ['qianniu'],
    productScopeType: 'sku',
    productScopeRefs: ['syn-sku-serum-refill'],
  },
  {
    id: 'syn-product-sunscreen-001',
    domain: 'product',
    title: '晨光防晒乳合成补涂说明',
    searchTerms: [
      '晨光防晒乳如何补涂',
      '晨光防晒乳补涂频率',
      '晨光防晒乳多久补一次',
      '晨光防晒霜怎么补',
      '晨光防曬乳多久補一次',
    ],
    platformScope: ['qianniu', 'douyin'],
  },
  {
    id: 'syn-aftersale-mask-001',
    domain: 'aftersale',
    title: '雾岚面膜合成售后说明',
    searchTerms: [
      '雾岚面膜使用后泛红怎么办',
      '雾岚面膜敷完红肿怎么处理',
      '雾岚修护膜过敏了怎么办',
      '雾岚面膜泛红咋办',
      '雾岚修護膜過敏怎麼處理',
      '雾岚面膜敷完红肿怎么办',
    ],
    platformScope: ['qianniu', 'douyin'],
  },
  {
    id: 'syn-douyin-live-001',
    domain: 'campaign',
    title: '星河直播间合成赠品说明',
    searchTerms: [
      '星河直播间赠品怎么领取',
      '星河直播间赠品咋领',
      '星河直播間贈品怎麼領取',
    ],
    platformScope: ['douyin'],
  },
  {
    id: 'syn-qianniu-service-001',
    domain: 'presale',
    title: '青石专席合成服务时间',
    searchTerms: ['青石专席服务时间'],
    platformScope: ['qianniu'],
  },
  {
    id: 'syn-product-serum-standard-001',
    domain: 'product',
    title: '月屿精华正装合成说明',
    searchTerms: ['月屿精华正装使用方法'],
    platformScope: ['qianniu'],
  },
  {
    id: 'syn-expired-cleanser-001',
    domain: 'presale',
    title: '暮色洁面露合成旧版说明',
    searchTerms: ['暮色洁面露旧版用法'],
    platformScope: ['qianniu'],
    validity: 'expired',
  },
  {
    id: 'syn-campaign-expired-001',
    domain: 'campaign',
    title: '落日会员周合成历史说明',
    searchTerms: ['落日会员周历史赠品规则'],
    platformScope: ['douyin'],
    validity: 'expired',
  },
  {
    id: 'syn-campaign-future-001',
    domain: 'campaign',
    title: '落日会员周合成未来说明',
    searchTerms: ['落日会员周历史赠品规则'],
    platformScope: ['douyin'],
    validity: 'future',
  },
] satisfies readonly SyntheticG1aCandidate[]);

const GOLD_KEYS = Object.freeze([
  'as_of',
  'expected_any_top3',
  'forbidden_script_ids',
  'id',
  'note',
  'platform',
  'product_context_ref',
  'product_context_type',
  'query_text',
  'sku_hint',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceBindingHash(): string {
  return sha256(SYNTHETIC_G1A_SOURCE_BINDINGS
    .map(([domain, sourceVersionId]) => `${domain}:${sourceVersionId}`)
    .join('|'));
}

function stratumAt(index: number): SyntheticG1aStratum {
  if (index < 20) return 'positive';
  if (index < 32) return 'safety_negative';
  return 'robustness';
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return Object.freeze([...value]);
}

function parseGoldCase(value: unknown, index: number): SyntheticG1aCase {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Gold case line ${index + 1} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (JSON.stringify(keys) !== JSON.stringify(GOLD_KEYS)) {
    throw new Error(`Gold case line ${index + 1} has a non-closed shape`);
  }
  const expectedId = `ZH-${String(index + 1).padStart(3, '0')}`;
  if (record.id !== expectedId) throw new Error(`Gold case line ${index + 1} must be ${expectedId}`);
  if (typeof record.query_text !== 'string' || record.query_text.length === 0) {
    throw new Error(`${expectedId} query_text is invalid`);
  }
  if (record.platform !== 'qianniu' && record.platform !== 'douyin') {
    throw new Error(`${expectedId} must use a confirmed synthetic platform`);
  }
  const contextType = record.product_context_type;
  const contextRef = record.product_context_ref;
  if (
    !(
      (contextType === null && contextRef === null)
      || ((contextType === 'category' || contextType === 'sku') && typeof contextRef === 'string' && contextRef.length > 0)
    )
  ) {
    throw new Error(`${expectedId} product context is not paired`);
  }
  if (record.sku_hint !== null && typeof record.sku_hint !== 'string') {
    throw new Error(`${expectedId} sku_hint is invalid`);
  }
  if (typeof record.as_of !== 'string' || Number.isNaN(new Date(record.as_of).valueOf())) {
    throw new Error(`${expectedId} as_of is invalid`);
  }
  if (typeof record.note !== 'string' || !record.note.startsWith('合成')) {
    throw new Error(`${expectedId} must carry an explicit synthetic note`);
  }
  const expected = requireStringArray(record.expected_any_top3, `${expectedId} expected_any_top3`);
  const forbidden = requireStringArray(record.forbidden_script_ids, `${expectedId} forbidden_script_ids`);
  return Object.freeze({
    id: expectedId,
    query_text: record.query_text,
    platform: record.platform,
    product_context_type: contextType,
    product_context_ref: contextRef,
    sku_hint: record.sku_hint,
    as_of: record.as_of,
    expected_any_top3: expected,
    forbidden_script_ids: forbidden,
    note: record.note,
    stratum: stratumAt(index),
  });
}

export async function readSyntheticG1aCases(): Promise<Readonly<{
  fixtureSha256: string;
  cases: readonly SyntheticG1aCase[];
}>> {
  const source = await readFile(FIXTURE_URL, 'utf8');
  if (!source.endsWith('\n') || source.includes('\r')) {
    throw new Error('Gold fixture must use LF and end with exactly one line feed');
  }
  const lines = source.trimEnd().split('\n');
  if (lines.length !== 50) throw new Error(`Gold fixture denominator must be 50, got ${lines.length}`);
  const cases = lines.map((line, index) => {
    try {
      return parseGoldCase(JSON.parse(line), index);
    } catch (error) {
      throw new Error(`Gold fixture line ${index + 1} is invalid`, { cause: error });
    }
  });
  return Object.freeze({ fixtureSha256: sha256(source), cases: Object.freeze(cases) });
}

function searchDocument(terms: readonly string[]): string {
  return [...new Set(terms.flatMap((term) => unicodeBigramTokens(normalizeSearchText(term))))].join(' ');
}

function sourceFor(domain: CandidateDomain): Readonly<{ versionId: string; ref: string }> {
  const binding = SYNTHETIC_G1A_SOURCE_BINDINGS.find(([bindingDomain]) => bindingDomain === domain);
  if (!binding) throw new Error(`Missing synthetic source binding for ${domain}`);
  return Object.freeze({ versionId: binding[1], ref: binding[2] });
}

async function seedCandidate(owner: Client, candidate: SyntheticG1aCandidate, index: number): Promise<void> {
  const suffix = String(index + 1).padStart(2, '0');
  const sourceAssetId = `sa_synthetic_g1a_${suffix}`;
  const originFingerprint = sha256(`synthetic-g1a-origin-${suffix}`);
  const source = sourceFor(candidate.domain);
  const questionBase = {
    question_id: `q_synthetic_g1a_${suffix}`,
    question_version: 1,
    question_text: candidate.searchTerms[0],
    semantic_family_id: `sf_synthetic_g1a_${suffix}`,
    origin_fingerprint: originFingerprint,
    origin_fingerprint_key_version: 'hmac-synthetic-g1a-v1',
    source_asset_id: sourceAssetId,
    source: 'manual',
    intent_taxonomy_version: INTENT_TAXONOMY_VERSION,
    intent_id: INTENT_ID,
  };
  const questionHash = await owner.query<{ question_hash: string }>(
    'SELECT public.content_question_hash($1::jsonb) AS question_hash',
    [JSON.stringify(questionBase)],
  );
  const questions = [{ ...questionBase, question_hash: questionHash.rows[0]?.question_hash }];

  await owner.query(`
    INSERT INTO public.semantic_source_assets(
      source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version
    ) VALUES ($1, 'manual', $2, 'hmac-synthetic-g1a-v1')
  `, [sourceAssetId, originFingerprint]);

  const validity = candidate.validity ?? 'active';
  const effectiveFrom = validity === 'future' ? '2099-01-01T00:00:00Z' : '2020-01-01T00:00:00Z';
  const effectiveTo = validity === 'expired' ? '2021-01-01T00:00:00Z' : '2100-01-01T00:00:00Z';
  const productScopeType = candidate.productScopeType ?? 'storewide';
  const productScopeRefs = candidate.productScopeRefs ?? [];

  await owner.query(`
    INSERT INTO public.release_items(
      release_id, script_id, script_version, content_hash, answer_text, title, category,
      source_ref, source_version_id, owner_role, review_due_at, effective_from, effective_to,
      platform_scope, product_scope_type, product_scope_refs, intent_taxonomy_version, intent_id,
      risk_level, risk_categories, has_conflict, review_mode, primary_reviewer_id,
      primary_reviewer_role, primary_review_evd, secondary_reviewer_id,
      secondary_reviewer_role, secondary_review_evd, placeholder_keys, questions_json,
      search_document, search_fallback_text
    ) VALUES (
      $1, $2, 1, $3, $4, $5, $6,
      $7, $8, 'ROLE-CONTENT-LEAD', '2099-01-01T00:00:00Z', $9, $10,
      $11::text[], $12, $13::text[], $14, $15,
      'low', ARRAY[]::text[], FALSE, 'single', $16,
      'ROLE-CONTENT-LEAD', 'EVD-SYNTHETIC-G1A', NULL, NULL, NULL,
      ARRAY[]::text[], $17::jsonb, pg_catalog.to_tsvector('simple', $18), $19
    )
  `, [
    RELEASE_ID,
    candidate.id,
    sha256(`synthetic-g1a-content-${suffix}`),
    `纯合成回答 ${suffix}，仅用于本机确定性检索验证。`,
    candidate.title,
    candidate.domain,
    source.ref,
    source.versionId,
    effectiveFrom,
    effectiveTo,
    [...candidate.platformScope],
    productScopeType,
    [...productScopeRefs],
    INTENT_TAXONOMY_VERSION,
    INTENT_ID,
    sha256('synthetic-g1a-primary-reviewer'),
    JSON.stringify(questions),
    searchDocument(candidate.searchTerms),
    candidate.searchTerms.join(' '),
  ]);
}

export async function seedSyntheticG1aRelease(owner: Client): Promise<void> {
  await owner.query('BEGIN');
  try {
    await owner.query("SELECT pg_catalog.set_config('app.publishing', 'on', true)");
    await owner.query("SELECT pg_catalog.set_config('app.semantic_asset_write', 'publish', true)");
    for (const [domain, sourceVersionId, sourceRef] of SYNTHETIC_G1A_SOURCE_BINDINGS) {
      await owner.query(`
        INSERT INTO public.authoritative_source_versions(
          source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
          use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at
        ) VALUES (
          $1, $2, $3, 'synthetic-g1a-v1', $4,
          'canonical', 'ROLE-CONTENT-LEAD', 'EVD-SYNTHETIC-G1A-SOURCE',
          'synthetic-owner', '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z'
        )
      `, [sourceVersionId, sourceRef, domain, sha256(`synthetic-g1a-source-${domain}`)]);
    }
    await owner.query(`
      INSERT INTO public.intent_taxonomy_versions(
        intent_taxonomy_version, approval_evd, approved_by, approved_at
      ) VALUES ($1, 'EVD-SYNTHETIC-G1A-TAXONOMY', 'synthetic-owner', '2020-01-01T00:00:00Z')
    `, [INTENT_TAXONOMY_VERSION]);
    await owner.query(`
      INSERT INTO public.intent_taxonomy_entries(
        intent_taxonomy_version, intent_id, label, lifecycle
      ) VALUES ($1, $2, '纯合成检索意图', 'active')
    `, [INTENT_TAXONOMY_VERSION, INTENT_ID]);
    await owner.query(`
      INSERT INTO public.content_releases(
        release_id, release_seq, title, status, source_binding_hash,
        published_by, published_by_role
      ) VALUES ($1, 1, '纯合成 G1a runner 发布', 'published', $2, 'synthetic-owner', 'owner')
    `, [RELEASE_ID, sourceBindingHash()]);
    for (const [domain, sourceVersionId] of SYNTHETIC_G1A_SOURCE_BINDINGS) {
      await owner.query(`
        INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
        VALUES ($1, $2, $3)
      `, [RELEASE_ID, domain, sourceVersionId]);
    }
    for (const [index, candidate] of SYNTHETIC_G1A_CANDIDATES.entries()) {
      await seedCandidate(owner, candidate, index);
    }
    await owner.query('INSERT INTO public.content_current(id, current_release_id) VALUES (1, $1)', [RELEASE_ID]);
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
}

type G1aFailure = Readonly<{
  id: string;
  reason: 'BACKEND_ERROR' | 'EXPECTED_TOP3_MISS' | 'EXPECTED_NO_HIT_MISS' | 'FORBIDDEN_RETURNED';
  actual_script_ids: readonly string[];
  backend_code?: string;
}>;

export type SyntheticG1aReport = Readonly<{
  schema: 'customer-agent/synthetic-g1a-report/v1';
  status: 'NOT_SIGNED';
  runner_result: 'EXECUTABLE' | 'FAILED';
  business_accuracy_claim: 'NOT_EVALUATED';
  fixture_sha256: string;
  fixture_as_of: string;
  runtime_time_source: 'POSTGRES_CLOCK_TIMESTAMP_WITH_FIXED_SYNTHETIC_WINDOWS';
  denominator: 50;
  strata: Readonly<Record<SyntheticG1aStratum, Readonly<{ total: number; correct: number }>>>;
  raw: Readonly<{
    expected_hit_total: number;
    hit_at_3_count: number;
    expected_no_hit_total: number;
    no_hit_count: number;
    forbidden_violations: number;
    backend_errors: number;
  }>;
  failures: readonly G1aFailure[];
}>;

export async function runSyntheticG1a(
  backend: SearchBackend,
  fixture: Awaited<ReturnType<typeof readSyntheticG1aCases>>,
): Promise<SyntheticG1aReport> {
  const failures: G1aFailure[] = [];
  const totals: Record<SyntheticG1aStratum, { total: number; correct: number }> = {
    positive: { total: 0, correct: 0 },
    safety_negative: { total: 0, correct: 0 },
    robustness: { total: 0, correct: 0 },
  };
  let expectedHitTotal = 0;
  let hitAt3Count = 0;
  let expectedNoHitTotal = 0;
  let noHitCount = 0;
  let forbiddenViolations = 0;
  let backendErrors = 0;

  for (const testCase of fixture.cases) {
    totals[testCase.stratum].total += 1;
    const result = await backend.search({
      normalizedQuery: testCase.query_text,
      platform: testCase.platform,
      productContextType: testCase.product_context_type,
      productContextRef: testCase.product_context_ref,
      topK: 3,
    });
    if (!result.ok) {
      backendErrors += 1;
      failures.push(Object.freeze({
        id: testCase.id,
        reason: 'BACKEND_ERROR',
        actual_script_ids: Object.freeze([]),
        backend_code: result.code,
      }));
      continue;
    }

    const actualIds = Object.freeze(result.candidates.map((candidate) => candidate.script_id));
    const expectedHit = testCase.expected_any_top3.length > 0;
    const hitAt3 = testCase.expected_any_top3.some((id) => actualIds.includes(id));
    const forbiddenReturned = testCase.forbidden_script_ids.some((id) => actualIds.includes(id));
    if (expectedHit) {
      expectedHitTotal += 1;
      if (hitAt3) hitAt3Count += 1;
    } else {
      expectedNoHitTotal += 1;
      if (actualIds.length === 0) noHitCount += 1;
    }
    if (forbiddenReturned) forbiddenViolations += 1;

    const reason = forbiddenReturned
      ? 'FORBIDDEN_RETURNED'
      : expectedHit && !hitAt3
        ? 'EXPECTED_TOP3_MISS'
        : !expectedHit && actualIds.length > 0
          ? 'EXPECTED_NO_HIT_MISS'
          : null;
    if (reason === null) {
      totals[testCase.stratum].correct += 1;
    } else {
      failures.push(Object.freeze({ id: testCase.id, reason, actual_script_ids: actualIds }));
    }
  }

  return Object.freeze({
    schema: 'customer-agent/synthetic-g1a-report/v1',
    status: 'NOT_SIGNED',
    runner_result: failures.length === 0 ? 'EXECUTABLE' : 'FAILED',
    business_accuracy_claim: 'NOT_EVALUATED',
    fixture_sha256: fixture.fixtureSha256,
    fixture_as_of: fixture.cases[0]?.as_of ?? 'NOT_AVAILABLE',
    runtime_time_source: 'POSTGRES_CLOCK_TIMESTAMP_WITH_FIXED_SYNTHETIC_WINDOWS',
    denominator: 50,
    strata: Object.freeze({
      positive: Object.freeze(totals.positive),
      safety_negative: Object.freeze(totals.safety_negative),
      robustness: Object.freeze(totals.robustness),
    }),
    raw: Object.freeze({
      expected_hit_total: expectedHitTotal,
      hit_at_3_count: hitAt3Count,
      expected_no_hit_total: expectedNoHitTotal,
      no_hit_count: noHitCount,
      forbidden_violations: forbiddenViolations,
      backend_errors: backendErrors,
    }),
    failures: Object.freeze(failures),
  });
}
