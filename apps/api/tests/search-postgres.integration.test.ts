import { createHash } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import type { Client, ClientConfig } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import {
  createSearchRepository,
  SEARCH_CANDIDATES_SQL,
} from '../src/search-repository.js';
import { createSearchBackend, type SearchBackend } from '../src/search-service.js';

const describePg15 = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1'
  ? describe.sequential
  : describe.skip;

const RELEASE_ID = 'rel_synthetic_search_v1';
const INTENT_TAXONOMY_VERSION = 'itax_synthetic_search_v1';
const INTENT_ID = 'intent_synthetic_shipping';
const SOURCE_BINDINGS = Object.freeze([
  ['aftersale', 'srcv_synth_aftersale_v1', 'SRC-SYNTH-AFTERSALE'],
  ['campaign', 'srcv_synth_campaign_v1', 'SRC-SYNTH-CAMPAIGN'],
  ['presale', 'srcv_synth_presale_v1', 'SRC-SYNTH-PRESALE'],
  ['product', 'srcv_synth_product_v1', 'SRC-SYNTH-PRODUCT'],
] as const);

type CandidateFixture = Readonly<{
  id: string;
  title: string;
  question: string;
  searchable: string;
  fallback: string;
  platformScope?: readonly ('qianniu' | 'douyin')[];
  productScopeType?: 'storewide' | 'category' | 'sku';
  productScopeRefs?: readonly string[];
  temporal?: 'active' | 'future' | 'expired';
}>;

type ExplainPlanNode = Readonly<{
  'Node Type'?: string;
  Plans?: readonly ExplainPlanNode[];
}>;

type ExplainResult = Readonly<{
  Plan?: ExplainPlanNode;
  'Execution Time'?: number;
}>;

function containsPlanNode(plan: ExplainPlanNode | undefined, nodeType: string): boolean {
  if (plan === undefined) return false;
  if (plan['Node Type'] === nodeType) return true;
  return plan.Plans?.some((child) => containsPlanNode(child, nodeType)) ?? false;
}

const CANDIDATES = Object.freeze([
  {
    id: 'script_01_exact_question',
    title: '合成配送说明一',
    question: '什么时候发货',
    searchable: '什么 么时 时候 候发 发货',
    fallback: '什么时候发货 合成配送说明一',
  },
  {
    id: 'script_02_exact_title',
    title: '什么时候发货',
    question: '合成配送时效问题',
    searchable: '什么 么时 时候 候发 发货',
    fallback: '什么时候发货 合成配送时效问题',
  },
  {
    id: 'script_03_phrase_question',
    title: '合成配送说明三',
    question: '请问什么时候发货呢',
    searchable: '什么 么时 时候 候发 发货',
    fallback: '请问什么时候发货呢 合成配送说明三',
  },
  {
    id: 'script_04_phrase_title',
    title: '关于什么时候发货的说明',
    question: '合成配送一般问题',
    searchable: '什么 么时 时候 候发 发货',
    fallback: '关于什么时候发货的说明 合成配送一般问题',
  },
  {
    id: 'script_05_category',
    title: '合成分类专用',
    question: '合成分类专用',
    searchable: '合成 成分 分类 类专 专用',
    fallback: '合成分类专用',
    productScopeType: 'category',
    productScopeRefs: ['skin-care'],
  },
  {
    id: 'script_06_sku',
    title: '合成单品专用',
    question: '合成单品专用',
    searchable: '合成 成单 单品 品专 专用',
    fallback: '合成单品专用',
    productScopeType: 'sku',
    productScopeRefs: ['sku-synthetic-001'],
  },
  {
    id: 'script_07_douyin',
    title: '合成抖音专用',
    question: '合成抖音专用',
    searchable: '合成 成抖 抖音 音专 专用',
    fallback: '合成抖音专用',
    platformScope: ['douyin'],
  },
  {
    id: 'script_08_literal_wildcard',
    title: '合成字面通配符',
    question: '合成字面通配符',
    searchable: '合成 成字 字面 面通 通配 配符',
    fallback: '合成%_\\标记',
  },
  {
    id: 'script_09_future',
    title: '合成未来话术',
    question: '合成未来话术',
    searchable: '合成 成未 未来 来话 话术',
    fallback: '合成未来话术',
    temporal: 'future',
  },
  {
    id: 'script_10_expired',
    title: '合成过期话术',
    question: '合成过期话术',
    searchable: '合成 成过 过期 期话 话术',
    fallback: '合成过期话术',
    temporal: 'expired',
  },
  { id: 'script_11_ambiguous_cup_a', title: '合成甲杯售后流程', question: '合成甲杯售后流程', searchable: '合成 成甲 甲杯 杯售 售后 后流 流程', fallback: '合成甲杯售后流程' },
  { id: 'script_12_ambiguous_cup_b', title: '合成乙杯售后流程', question: '合成乙杯售后流程', searchable: '合成 成乙 乙杯 杯售 售后 后流 流程', fallback: '合成乙杯售后流程' },
  { id: 'script_13_negative_phrase', title: '可以不退货', question: '可以不退货', searchable: '可以 以不 不退 退货', fallback: '可以不退货' },
  { id: 'script_14_numeric_phrase', title: '买1件送1件', question: '买1件送1件', searchable: '买1 1件 件送 送1 1件', fallback: '买1件送1件' },
  { id: 'script_15_payment_phrase', title: '付款发货', question: '付款发货', searchable: '付款 款发 发货', fallback: '付款发货' },
  { id: 'script_16_refund_phrase', title: '可以退款', question: '可以退款', searchable: '可以 以退 退款', fallback: '可以退款' },
  { id: 'script_17_free_shipping_phrase', title: '退货免运费', question: '退货免运费', searchable: '退货 货免 免运 运费', fallback: '退货免运费' },
  { id: 'script_18_chinese_number_phrase', title: '买一件送十一件', question: '买一件送十一件', searchable: '买一 一件 件送 送十 十一 一件', fallback: '买一件送十一件' },
  { id: 'script_19_cup_phrase', title: '杯退货流程', question: '杯退货流程', searchable: '杯退 退货 货流 流程', fallback: '杯退货流程' },
] satisfies readonly CandidateFixture[]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceBindingHash(): string {
  return sha256(SOURCE_BINDINGS
    .map(([domain, sourceVersionId]) => `${domain}:${sourceVersionId}`)
    .join('|'));
}

async function seedCandidate(owner: Client, fixture: CandidateFixture, index: number): Promise<void> {
  const suffix = String(index + 1).padStart(2, '0');
  const sourceAssetId = `sa_synthetic_search_${suffix}`;
  const originFingerprint = sha256(`synthetic-origin-${suffix}`);
  const questionBase = {
    question_id: `q_synthetic_search_${suffix}`,
    question_version: 1,
    question_text: fixture.question,
    semantic_family_id: `sf_synthetic_search_${suffix}`,
    origin_fingerprint: originFingerprint,
    origin_fingerprint_key_version: 'hmac-synthetic-v1',
    source_asset_id: sourceAssetId,
    source: 'manual',
    intent_taxonomy_version: INTENT_TAXONOMY_VERSION,
    intent_id: INTENT_ID,
  };
  const questionHash = await owner.query<{ question_hash: string }>(
    'SELECT public.content_question_hash($1::jsonb) AS question_hash',
    [JSON.stringify(questionBase)],
  );
  const questions = [{
    ...questionBase,
    question_hash: questionHash.rows[0]?.question_hash,
  }];

  await owner.query(`
    INSERT INTO public.semantic_source_assets(
      source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version
    ) VALUES ($1, 'manual', $2, 'hmac-synthetic-v1')
  `, [sourceAssetId, originFingerprint]);

  const temporal = fixture.temporal ?? 'active';
  const effectiveFrom = temporal === 'future'
    ? "pg_catalog.clock_timestamp() + INTERVAL '1 day'"
    : temporal === 'expired'
      ? "pg_catalog.clock_timestamp() - INTERVAL '2 days'"
      : "pg_catalog.clock_timestamp() - INTERVAL '1 day'";
  const effectiveTo = temporal === 'expired'
    ? "pg_catalog.clock_timestamp() - INTERVAL '1 day'"
    : 'NULL::timestamptz';
  const platformScope = fixture.platformScope ?? ['qianniu'];
  const productScopeType = fixture.productScopeType ?? 'storewide';
  const productScopeRefs = fixture.productScopeRefs ?? [];

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
      $1, $2, 1, $3, $4, $5, 'presale',
      'SRC-SYNTH-PRESALE', 'srcv_synth_presale_v1', 'ROLE-CONTENT-LEAD',
      pg_catalog.clock_timestamp() + INTERVAL '365 days', ${effectiveFrom}, ${effectiveTo},
      $6::text[], $7, $8::text[], $9, $10,
      'low', ARRAY[]::text[], FALSE, 'single', $11,
      'ROLE-CONTENT-LEAD', 'EVD-SYNTHETIC-SEARCH', NULL, NULL, NULL,
      ARRAY[]::text[], $12::jsonb, pg_catalog.to_tsvector('simple', $13), $14
    )
  `, [
    RELEASE_ID,
    fixture.id,
    sha256(`synthetic-content-${suffix}`),
    `合成回答 ${suffix}`,
    fixture.title,
    [...platformScope],
    productScopeType,
    [...productScopeRefs],
    INTENT_TAXONOMY_VERSION,
    INTENT_ID,
    sha256('synthetic-primary-reviewer'),
    JSON.stringify(questions),
    fixture.searchable,
    fixture.fallback,
  ]);
}

async function seedSearchRelease(owner: Client): Promise<void> {
  await owner.query('BEGIN');
  try {
    await owner.query("SELECT pg_catalog.set_config('app.publishing', 'on', true)");
    await owner.query("SELECT pg_catalog.set_config('app.semantic_asset_write', 'publish', true)");
    for (const [domain, sourceVersionId, sourceRef] of SOURCE_BINDINGS) {
      await owner.query(`
        INSERT INTO public.authoritative_source_versions(
          source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
          use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at
        ) VALUES (
          $1, $2, $3, 'synthetic-v1', $4,
          'canonical', 'ROLE-CONTENT-LEAD', 'EVD-SYNTHETIC-SOURCE',
          'synthetic-owner', pg_catalog.clock_timestamp() - INTERVAL '1 day',
          pg_catalog.clock_timestamp() + INTERVAL '365 days'
        )
      `, [sourceVersionId, sourceRef, domain, sha256(`synthetic-source-${domain}`)]);
    }
    await owner.query(`
      INSERT INTO public.intent_taxonomy_versions(
        intent_taxonomy_version, approval_evd, approved_by, approved_at
      ) VALUES ($1, 'EVD-SYNTHETIC-TAXONOMY', 'synthetic-owner', pg_catalog.clock_timestamp())
    `, [INTENT_TAXONOMY_VERSION]);
    await owner.query(`
      INSERT INTO public.intent_taxonomy_entries(
        intent_taxonomy_version, intent_id, label, lifecycle
      ) VALUES ($1, $2, '合成发货意图', 'active')
    `, [INTENT_TAXONOMY_VERSION, INTENT_ID]);
    await owner.query(`
      INSERT INTO public.content_releases(
        release_id, release_seq, title, status, source_binding_hash,
        published_by, published_by_role
      ) VALUES ($1, 1, '合成搜索发布', 'published', $2, 'synthetic-owner', 'owner')
    `, [RELEASE_ID, sourceBindingHash()]);
    for (const [domain, sourceVersionId] of SOURCE_BINDINGS) {
      await owner.query(`
        INSERT INTO public.release_source_bindings(release_id, domain, source_version_id)
        VALUES ($1, $2, $3)
      `, [RELEASE_ID, domain, sourceVersionId]);
    }
    for (const [index, candidate] of CANDIDATES.entries()) {
      await seedCandidate(owner, candidate, index);
    }
    await owner.query(`
      INSERT INTO public.content_current(id, current_release_id) VALUES (1, $1)
    `, [RELEASE_ID]);
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
}

describePg15('Search backend PostgreSQL 15 boundary', () => {
  let harness: Pg15Harness;
  let database: Readonly<{ name: string; config: ClientConfig }>;
  let owner: Client;
  let runtime: Client;
  let backend: SearchBackend;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    database = harness.createDatabase('search_backend');
    owner = await harness.connect(database.config);
    await applyDatabaseMigrations(owner);
    await owner.query('CREATE ROLE w2_search_runtime LOGIN');
    await owner.query('GRANT app_runtime TO w2_search_runtime');
    await seedSearchRelease(owner);
    runtime = await harness.connect({ ...database.config, user: 'w2_search_runtime' });
    const repository = createSearchRepository(runtime as never);
    backend = createSearchBackend({ searchCandidates: repository.search });
  }, 120_000);

  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
    harness?.stop();
  }, 60_000);

  it('keeps backing content unreadable while exposing only the controlled search function', async () => {
    await expect(runtime.query('SELECT * FROM public.release_items')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(runtime.query('SELECT * FROM public.v_scripts_recommendable')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(runtime.query(
      "SELECT pg_catalog.count(*) FROM public.search_recommendable_scripts('qianniu', NULL, NULL)",
    )).resolves.toMatchObject({ rows: [{ count: '14' }] });
  });

  it('ranks exact question, exact title and phrase question deterministically inside database Top 3', async () => {
    const result = await backend.search({
      normalizedQuery: '什么时候发货',
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      topK: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      releaseId: RELEASE_ID,
      sourceBindingHash: sourceBindingHash(),
      candidates: [
        { rank: 1, script_id: 'script_01_exact_question' },
        { rank: 2, script_id: 'script_02_exact_title' },
        { rank: 3, script_id: 'script_03_phrase_question' },
      ],
    });
  });

  it('applies platform, product and half-open effective scope before ranking', async () => {
    const search = (normalizedQuery: string, overrides: Partial<Parameters<SearchBackend['search']>[0]> = {}) => (
      backend.search({
        normalizedQuery,
        platform: 'qianniu',
        productContextType: null,
        productContextRef: null,
        topK: 3,
        ...overrides,
      })
    );

    await expect(search('合成分类专用')).resolves.toMatchObject({ ok: true, candidates: [] });
    await expect(search('合成分类专用', {
      productContextType: 'category',
      productContextRef: 'skin-care',
    })).resolves.toMatchObject({
      ok: true,
      candidates: [{ script_id: 'script_05_category' }],
    });
    await expect(search('合成单品专用', {
      productContextType: 'sku',
      productContextRef: 'sku-synthetic-001',
    })).resolves.toMatchObject({
      ok: true,
      candidates: [{ script_id: 'script_06_sku' }],
    });
    await expect(search('合成抖音专用')).resolves.toMatchObject({ ok: true, candidates: [] });
    await expect(search('合成抖音专用', { platform: 'douyin' })).resolves.toMatchObject({
      ok: true,
      candidates: [{ script_id: 'script_07_douyin' }],
    });
    await expect(search('合成未来话术')).resolves.toMatchObject({ ok: true, candidates: [] });
    await expect(search('合成过期话术')).resolves.toMatchObject({ ok: true, candidates: [] });
  });

  it('escapes ILIKE wildcard characters and distinguishes a ready no-hit', async () => {
    for (const literal of ['%', '_', '\\']) {
      await expect(backend.search({
        normalizedQuery: literal,
        platform: 'qianniu',
        productContextType: null,
        productContextRef: null,
        topK: 3,
      })).resolves.toMatchObject({
        ok: true,
        candidates: [{ script_id: 'script_08_literal_wildcard' }],
      });
    }
    await expect(backend.search({
      normalizedQuery: '完全不存在的合成查询',
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      topK: 3,
    })).resolves.toEqual({
      ok: true,
      releaseId: RELEASE_ID,
      sourceBindingHash: sourceBindingHash(),
      decision: 'reject',
      candidates: [],
    });
  });

  it('keeps the gated pool plus in-process judgement under the 300ms p95 budget', async () => {
    const samples: number[] = [];
    const queries = [
      '什么时候发货',
      '退货运费',
      '可以不退货',
      '合成分类专用',
      '完全不存在的合成查询',
    ];
    for (let index = 0; index < 40; index += 1) {
      const query = queries[index % queries.length] ?? '什么时候发货';
      const started = performance.now();
      const result = await backend.search({
        normalizedQuery: query,
        platform: 'qianniu',
        productContextType: null,
        productContextRef: null,
        topK: 3,
      });
      samples.push(performance.now() - started);
      expect(result.ok).toBe(true);
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    expect(p95).toBeLessThan(300);
  });

  it('keeps database-side Top 3 limiting inside the controlled PG15 execution budget', async () => {
    const explained = await runtime.query<{ 'QUERY PLAN': ExplainResult[] }>(
      `EXPLAIN (ANALYZE, FORMAT JSON) ${SEARCH_CANDIDATES_SQL}`,
      [
        'qianniu',
        null,
        null,
        false,
        512,
      ],
    );
    const result = explained.rows[0]?.['QUERY PLAN'][0];

    expect(containsPlanNode(result?.Plan, 'Limit')).toBe(true);
    expect(result?.['Execution Time']).toBeTypeOf('number');
    expect(result?.['Execution Time']).toBeLessThan(250);
  });

  it.each([
    '不要告诉我什么时候发货，我要取消订单',
    '不是问什么时候发货，我要查询退款进度',
    '无条件保证今天必须发货',
    '请问合成单品专用如何查询',
    '您好请问怎么用呢',
    '合成杯售后流程',
    '可以退货',
    '买1件送11件',
    '付款前发货',
    '可以退全款',
    '买一件送一件',
    '你好杯退货流程',
    '我想了解合成分类专用,请说明流程',
    '请问合成抖音专用呢',
    '请问合成未来话术呢',
    '请问合成过期话术呢',
  ])('does not recall a different business condition from a near-match query: %s', async (normalizedQuery) => {
    await expect(backend.search({ normalizedQuery, platform: 'qianniu', productContextType: null, productContextRef: null, topK: 3 }))
      .resolves.toMatchObject({ ok: true, candidates: [] });
  });

  it('shows a conditioned source for a broader freight keyword without rewriting it', async () => {
    await expect(backend.search({
      normalizedQuery: '退货运费',
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      topK: 3,
    })).resolves.toMatchObject({
      ok: true,
      decision: 'show',
      candidates: [{ script_id: 'script_17_free_shipping_phrase', answer_text: '合成回答 17' }],
    });
  });

  it('repairs an unambiguous shipping typo without treating it as a different condition', async () => {
    await expect(backend.search({
      normalizedQuery: '什么时候法货',
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      topK: 3,
    })).resolves.toMatchObject({
      ok: true,
      decision: 'show',
      candidates: [
        { script_id: 'script_01_exact_question' },
        { script_id: 'script_02_exact_title' },
        { script_id: 'script_03_phrase_question' },
      ],
    });
  });

  it('does not prevent a literal negative question from matching the approved phrase', async () => {
    await expect(backend.search({ normalizedQuery: '可以不退货', platform: 'qianniu', productContextType: null, productContextRef: null, topK: 3 }))
      .resolves.toMatchObject({ ok: true, candidates: [{ script_id: 'script_13_negative_phrase' }] });
  });

  it('fails closed without inventing no-hit semantics when the four-source gate becomes unavailable', async () => {
    await owner.query(`
      SELECT public.suspend_authoritative_source(
        'srcv_synth_presale_v1', 'SOURCE_REVOKED',
        'EVD-SYNTHETIC-SUSPENSION', 'synthetic-owner', 'owner'
      )
    `);

    for (const normalizedQuery of ['什么时候发货', '请问什么时候发货呢', '什么时发货']) {
      await expect(backend.search({
        normalizedQuery,
        platform: 'qianniu',
        productContextType: null,
        productContextRef: null,
        topK: 3,
      })).resolves.toEqual({ ok: false, code: 'SOURCE_GATE_NOT_READY' });
    }
  });
});
