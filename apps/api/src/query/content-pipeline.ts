import {
  buildBm25Index,
  characterUnigramBigramTerms,
  countCoveringTerms,
  rankBm25,
  type Bm25Index,
  type Bm25Parameters,
} from '@customer-agent/retrieval-core';
import {
  parseQueryOutcome,
  type ContentCandidate,
  type QueryAccessView,
  type QueryId,
  type QueryOutcome,
  type ReleaseId,
  type ReleaseSnapshot,
  type Scope,
} from '@customer-agent/unified-contracts';

/** A publish-time content row. `scope` belongs to the row, not to the query. */
export type ContentIndexItem = Readonly<{
  releaseId: ReleaseId;
  scriptId: string;
  scriptVersion: number;
  contentHash: string;
  title: string;
  body: string;
  questionTexts: readonly string[];
  platformScope: readonly ('qianniu' | 'douyin')[];
  productScopeType: 'storewide' | 'category' | 'sku';
  productScopeRefs: readonly string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  scope: Scope;
}>;

export type ContentPipelineFailureReason =
  | 'cancelled'
  | 'release_mismatch'
  | 'content_empty'
  | 'weak_hit'
  | 'no_match'
  | 'out_of_scope';

export type ContentPipelineResult =
  | Readonly<{
      ok: true;
      content: Extract<QueryOutcome, { kind: 'content' }>;
    }>
  | Readonly<{
      ok: false;
      reason: ContentPipelineFailureReason;
    }>;

export type ContentPipelineQuery = Readonly<{
  queryId: QueryId;
  text: string;
  snapshot: ReleaseSnapshot;
  access: QueryAccessView;
  signal?: AbortSignal;
  platform?: 'qianniu' | 'douyin';
  productContextType?: 'category' | 'sku' | null;
  productContextRef?: string | null;
}>;

export type BoundedEnrichment = Readonly<{
  deadlineMs: number;
  run: (
    input: Readonly<{
      queryId: QueryId;
      text: string;
      deterministic: Readonly<{
        kind: 'content';
        queryId: QueryId;
        releaseId: ReleaseId;
        candidates: readonly Readonly<ContentCandidate>[];
      }>;
    }>,
    signal: AbortSignal,
  ) => Promise<void>;
}>;

export type EnrichmentScheduler = (callback: () => void) => void;

type PreparedDocument = Readonly<{
  item: ContentIndexItem;
  questionText: string;
  copyHandle: string;
}>;

type PreparedContentIndex = Readonly<{
  snapshot: ReleaseSnapshot;
  index: Bm25Index;
  documents: readonly PreparedDocument[];
  copyHandles: ReadonlyMap<string, string>;
  activation: number;
}>;

export type PreparedContentIndexView = Readonly<{
  releaseId: ReleaseId;
  indexId: string;
  indexVersion: number;
  indexHash: string;
  itemCount: number;
  copyHandleFor: (scriptId: string) => string;
}>;

export type ContentPipelineInspection = Readonly<{
  activationCount: number;
  queryCount: number;
  releaseId: ReleaseId | null;
  indexId: string | null;
  itemCount: number;
}>;

const K1 = 1.2;
const B = 0.75;
const MAX_ENRICHMENT_DEADLINE_MS = 5_000;
const FIELD_WEIGHTS = Object.freeze([
  Object.freeze({ field: 'title', weight: 3 }),
  Object.freeze({ field: 'question', weight: 2.5 }),
  Object.freeze({ field: 'body', weight: 1 }),
]);
const BM25_PARAMETERS: Bm25Parameters = Object.freeze({
  k1: K1,
  b: B,
  fieldWeights: FIELD_WEIGHTS,
});
const STOP_BIGRAMS = Object.freeze([
  '什么', '怎么', '可以', '一下', '这个', '那个', '有没', '没有', '是不', '不是',
  '还是', '还有', '一个', '我们', '你们', '亲爱', '的话', '是否', '哪种',
]);
const PLATFORMS = new Set(['qianniu', 'douyin']);
const SCOPE_TYPES = new Set(['storewide', 'category', 'sku']);

const scheduleMacrotask: EnrichmentScheduler = (callback) => {
  const timer = setTimeout(callback, 0);
  timer.unref?.();
};

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function copyHandleFor(
  snapshot: ReleaseSnapshot,
  item: ContentIndexItem,
): string {
  return `copy:${snapshot.content.indexId}:${item.scriptId}:${String(item.scriptVersion)}:${item.contentHash}`;
}

function validateItem(
  snapshot: ReleaseSnapshot,
  item: ContentIndexItem,
): void {
  if (item.releaseId !== snapshot.releaseId) {
    throw new Error(`content candidate release does not match the active release: ${item.scriptId}`);
  }
  if (!isNonEmpty(item.scriptId) || item.scriptId.length > 128) {
    throw new Error('content candidate id is invalid');
  }
  if (!Number.isSafeInteger(item.scriptVersion) || item.scriptVersion < 1) {
    throw new Error(`content candidate version is invalid: ${item.scriptId}`);
  }
  if (!/^[a-f0-9]{64}$/u.test(item.contentHash)) {
    throw new Error(`content candidate hash is invalid: ${item.scriptId}`);
  }
  if (!isNonEmpty(item.title) || !isNonEmpty(item.body)) {
    throw new Error(`content candidate title or body is empty: ${item.scriptId}`);
  }
  if (!Array.isArray(item.questionTexts) || item.questionTexts.some((text) => typeof text !== 'string')) {
    throw new Error(`content candidate questions are invalid: ${item.scriptId}`);
  }
  if (!Array.isArray(item.platformScope)
    || item.platformScope.length === 0
    || item.platformScope.some((platform) => !PLATFORMS.has(platform))) {
    throw new Error(`content candidate platform scope is invalid: ${item.scriptId}`);
  }
  if (!SCOPE_TYPES.has(item.productScopeType)
    || !Array.isArray(item.productScopeRefs)
    || item.productScopeRefs.some((value) => typeof value !== 'string')) {
    throw new Error(`content candidate product scope is invalid: ${item.scriptId}`);
  }
  const from = timestamp(item.effectiveFrom);
  const to = item.effectiveTo === null ? null : timestamp(item.effectiveTo);
  if (from === null || (item.effectiveTo !== null && to === null) || (to !== null && to <= from)) {
    throw new Error(`content candidate effective window is invalid: ${item.scriptId}`);
  }
  if (item.scope === null || typeof item.scope !== 'object') {
    throw new Error(`content candidate access scope is invalid: ${item.scriptId}`);
  }
}

function freezeIndexItem(item: ContentIndexItem): ContentIndexItem {
  return Object.freeze({
    ...item,
    questionTexts: Object.freeze([...item.questionTexts]),
    platformScope: Object.freeze([...item.platformScope]),
    productScopeRefs: Object.freeze([...item.productScopeRefs]),
    scope: Object.freeze({ ...item.scope }),
  });
}

function buildPreparedIndex(
  snapshot: ReleaseSnapshot,
  items: readonly ContentIndexItem[],
  activation: number,
): PreparedContentIndex {
  const { content } = snapshot;
  if (content.state !== 'ready') throw new Error('content release index is not ready');
  if (content.itemCount !== items.length) {
    throw new Error(`content release index item count mismatch: expected ${String(content.itemCount)}, got ${String(items.length)}`);
  }
  const seen = new Set<string>();
  const copyHandles = new Map<string, string>();
  const frozen = [...items]
    .map((item) => {
      validateItem(snapshot, item);
      if (seen.has(item.scriptId)) throw new Error(`duplicate content candidate id: ${item.scriptId}`);
      seen.add(item.scriptId);
      return freezeIndexItem(item);
    })
    .sort((left, right) => left.scriptId.localeCompare(right.scriptId));
  const documents = frozen.map((item) => {
    const handle = copyHandleFor(snapshot, item);
    if (copyHandles.has(handle)) throw new Error('duplicate content copy handle');
    copyHandles.set(item.scriptId, handle);
    return Object.freeze({
      item,
      questionText: item.questionTexts.filter((text) => text.length > 0).join(' '),
      copyHandle: handle,
    });
  });
  const index = buildBm25Index(
    documents.map((document) => ({
      id: document.item.scriptId,
      fields: [
        { name: 'title', text: document.item.title },
        { name: 'question', text: document.questionText },
        { name: 'body', text: document.item.body },
      ],
    })),
    characterUnigramBigramTerms,
  );
  return Object.freeze({
    snapshot,
    index,
    documents: Object.freeze(documents),
    copyHandles,
    activation,
  });
}

function scopeCovers(allowed: Scope, actual: Scope): boolean {
  if (allowed.tenantId !== actual.tenantId || allowed.appId !== actual.appId) return false;
  if (allowed.kind === 'tenant') return true;
  if (allowed.brandId === undefined || allowed.brandId !== actual.brandId) return false;
  if (allowed.kind === 'brand') return true;
  if (allowed.shopId === undefined || allowed.shopId !== actual.shopId) return false;
  if (allowed.kind === 'shop') return true;
  return allowed.domain === actual.domain && allowed.sourceId === actual.sourceId;
}

function accessScopeCovers(
  access: QueryAccessView,
  actual: Scope,
  now: number,
): boolean {
  return access.scopes.some(({ scope, validUntil }) => {
    const until = timestamp(validUntil);
    return until !== null && now < until && scopeCovers(scope, actual);
  });
}

function matchesPlatform(
  item: ContentIndexItem,
  platform: 'qianniu' | 'douyin' | undefined,
): boolean {
  return platform === undefined || item.platformScope.includes(platform);
}

function matchesProduct(
  item: ContentIndexItem,
  type: 'category' | 'sku' | null | undefined,
  ref: string | null | undefined,
): boolean {
  if (type === undefined) return true;
  if (type === null) return item.productScopeType === 'storewide';
  return item.productScopeType === type
    && typeof ref === 'string'
    && item.productScopeRefs.includes(ref);
}

function isEffective(item: ContentIndexItem, now: number): boolean {
  const from = timestamp(item.effectiveFrom);
  const to = item.effectiveTo === null ? null : timestamp(item.effectiveTo);
  return from !== null && now >= from && (to === null || now < to);
}

function hasQuestionEvidence(
  item: ContentIndexItem,
  queryTerms: readonly string[],
): boolean {
  return countCoveringTerms(
    queryTerms,
    characterUnigramBigramTerms(`${item.title}\n${item.questionTexts.join('\n')}`),
    { minimumLength: 2, ignoredTerms: STOP_BIGRAMS },
  ) >= 1;
}

function scheduleEnrichment(
  enrichment: BoundedEnrichment | undefined,
  query: ContentPipelineQuery,
  deterministic: Extract<QueryOutcome, { kind: 'content' }>,
  schedule: EnrichmentScheduler,
): void {
  if (enrichment === undefined || query.signal?.aborted) return;
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  query.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, enrichment.deadlineMs);
  timer.unref?.();
  const cleanup = (): void => {
    clearTimeout(timer);
    query.signal?.removeEventListener('abort', cancel);
  };
  const frozen = Object.freeze({
    kind: 'content' as const,
    queryId: deterministic.queryId,
    releaseId: deterministic.releaseId,
    candidates: Object.freeze(deterministic.candidates.map((candidate) => Object.freeze({
      candidateId: candidate.candidateId,
      title: candidate.title,
      body: candidate.body,
      copyHandle: candidate.copyHandle,
      rank: candidate.rank,
    }))),
  });
  try {
    schedule(() => {
      if (controller.signal.aborted) {
        cleanup();
        return;
      }
      try {
        const work = enrichment.run({
          queryId: query.queryId,
          text: query.text,
          deterministic: frozen,
        }, controller.signal);
        void Promise.resolve(work).catch(() => undefined).finally(cleanup);
      } catch {
        cleanup();
      }
    });
  } catch {
    cleanup();
  }
}

function preparedMatchesSnapshot(
  prepared: PreparedContentIndex,
  snapshot: ReleaseSnapshot,
): boolean {
  return prepared.snapshot.releaseId === snapshot.releaseId
    && prepared.snapshot.sequence === snapshot.sequence
    && prepared.snapshot.content.indexId === snapshot.content.indexId
    && prepared.snapshot.content.indexVersion === snapshot.content.indexVersion
    && prepared.snapshot.content.indexHash === snapshot.content.indexHash
    && prepared.snapshot.content.itemCount === snapshot.content.itemCount;
}

/**
 * Owns ordinary content recall, fusion, admission and hydration. Ranking is
 * synchronous over the activation-time index; no request path rebuilds BM25.
 */
export class ContentPipeline {
  private prepared: PreparedContentIndex | null = null;
  private activationCount = 0;
  private queryCount = 0;

  constructor(
    private readonly options: Readonly<{
      now?: () => Date;
      enrichment?: BoundedEnrichment;
      schedule?: EnrichmentScheduler;
    }> = {},
  ) {
    if (options.enrichment !== undefined
      && (!Number.isSafeInteger(options.enrichment.deadlineMs)
        || options.enrichment.deadlineMs < 1
        || options.enrichment.deadlineMs > MAX_ENRICHMENT_DEADLINE_MS)) {
      throw new Error('content enrichment deadline must be between 1 and 5000ms');
    }
  }

  activate(
    snapshot: ReleaseSnapshot,
    items: readonly ContentIndexItem[],
  ): PreparedContentIndexView {
    const activation = this.activationCount + 1;
    const prepared = buildPreparedIndex(snapshot, items, activation);
    this.prepared = prepared;
    this.activationCount = activation;
    return Object.freeze({
      releaseId: snapshot.releaseId,
      indexId: snapshot.content.indexId as string,
      indexVersion: snapshot.content.indexVersion as number,
      indexHash: snapshot.content.indexHash as string,
      itemCount: prepared.documents.length,
      copyHandleFor: (scriptId: string): string => {
        const handle = prepared.copyHandles.get(scriptId);
        if (handle === undefined) throw new Error(`unknown content candidate: ${scriptId}`);
        return handle;
      },
    });
  }

  inspect(): ContentPipelineInspection {
    const prepared = this.prepared;
    return Object.freeze({
      activationCount: this.activationCount,
      queryCount: this.queryCount,
      releaseId: prepared?.snapshot.releaseId ?? null,
      indexId: prepared?.snapshot.content.indexId ?? null,
      itemCount: prepared?.documents.length ?? 0,
    });
  }

  async query(input: ContentPipelineQuery): Promise<ContentPipelineResult> {
    this.queryCount += 1;
    if (input.signal?.aborted) return Object.freeze({ ok: false, reason: 'cancelled' });
    const prepared = this.prepared;
    if (prepared === null || !preparedMatchesSnapshot(prepared, input.snapshot)) {
      return Object.freeze({ ok: false, reason: 'release_mismatch' });
    }
    if (input.snapshot.content.state !== 'ready') {
      return Object.freeze({ ok: false, reason: 'content_empty' });
    }
    const queryText = input.text.trim();
    if (queryText.length === 0) return Object.freeze({ ok: false, reason: 'no_match' });
    const now = (this.options.now?.() ?? new Date()).valueOf();
    const scoped = prepared.documents.filter(({ item }) => (
      accessScopeCovers(input.access, item.scope, now)
    ));
    if (prepared.documents.length > 0 && scoped.length === 0) {
      return Object.freeze({ ok: false, reason: 'out_of_scope' });
    }
    const eligible = scoped.filter(({ item }) => (
      isEffective(item, now)
      && matchesPlatform(item, input.platform)
      && matchesProduct(item, input.productContextType, input.productContextRef)
    ));
    const eligibleIds = new Set(eligible.map(({ item }) => item.scriptId));
    const scopedIndex: Bm25Index = Object.freeze({
      ...prepared.index,
      documents: Object.freeze(
        prepared.index.documents.filter((document) => eligibleIds.has(document.id)),
      ),
    });
    const queryTerms = [...characterUnigramBigramTerms(queryText)];
    const ranked = rankBm25(queryTerms, scopedIndex, BM25_PARAMETERS);
    if (ranked.length === 0) return Object.freeze({ ok: false, reason: 'no_match' });
    const byId = new Map(eligible.map((document) => [document.item.scriptId, document]));
    const seenBodies = new Set<string>();
    const selected: ContentCandidate[] = [];
    let sawWeak = false;
    for (const hit of ranked) {
      const document = byId.get(hit.id);
      if (document === undefined) continue;
      if (!hasQuestionEvidence(document.item, queryTerms)) {
        sawWeak = true;
        continue;
      }
      if (seenBodies.has(document.item.body)) continue;
      seenBodies.add(document.item.body);
      selected.push({
        candidateId: document.item.scriptId,
        title: document.item.title,
        body: document.item.body,
        copyHandle: document.copyHandle,
        rank: selected.length + 1,
      });
      if (selected.length === 3) break;
    }
    if (selected.length === 0) {
      return Object.freeze({ ok: false, reason: sawWeak ? 'weak_hit' : 'no_match' });
    }
    const content = parseQueryOutcome({
      kind: 'content',
      queryId: input.queryId,
      releaseId: input.snapshot.releaseId,
      candidates: selected,
    });
    if (content.kind !== 'content') {
      throw new Error('content pipeline produced a non-content outcome');
    }
    scheduleEnrichment(
      this.options.enrichment,
      input,
      content,
      this.options.schedule ?? scheduleMacrotask,
    );
    return Object.freeze({ ok: true, content });
  }
}
