import { describe, expect, it, vi } from 'vitest';
import type {
  AccessDecision,
  QueryId,
  ReleaseId,
  ReleaseSnapshot,
  Scope,
} from '@customer-agent/unified-contracts';
import { toQueryAccessView } from '@customer-agent/unified-contracts';
import {
  ContentPipeline,
  type ContentIndexItem,
} from '../../src/query/content-pipeline.js';

const releaseId = 'rel_synthetic_qry_001' as ReleaseId;
const fixedNow = () => new Date('2026-11-05T00:30:00.000Z');
const sourceScope = {
  kind: 'source',
  tenantId: 'tenant_synthetic',
  appId: 'app_synthetic',
  brandId: 'brand_synthetic',
  shopId: 'shop_synthetic',
  domain: 'general',
  sourceId: 'source_synthetic',
} as Scope;

function snapshot(itemCount = 3): ReleaseSnapshot {
  return {
    releaseId,
    sequence: 1,
    publishedAt: '2026-11-05T00:00:00.000Z',
    content: {
      state: 'ready',
      indexId: 'idx_synthetic_content_001',
      indexVersion: 1,
      itemCount,
      indexHash: 'a'.repeat(64),
    },
    sop: { state: 'empty', indexId: null, indexVersion: null, itemCount: 0, indexHash: null },
  };
}

function item(index: number, overrides: Partial<ContentIndexItem> = {}): ContentIndexItem {
  return {
    releaseId,
    scriptId: `script_synthetic_${String(index).padStart(3, '0')}`,
    scriptVersion: 1,
    contentHash: String(index).repeat(64).slice(0, 64),
    title: `合成发货时效 ${String(index)}`,
    body: `合成发货原文 ${String(index)}`,
    questionTexts: ['什么时候发货', `合成发货 ${String(index)}`],
    platformScope: ['qianniu', 'douyin'],
    productScopeType: 'storewide',
    productScopeRefs: [],
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    scope: sourceScope,
    ...overrides,
  };
}

function access(overrides: Partial<AccessDecision> = {}): AccessDecision {
  return {
    userId: 'usr_synthetic_agent' as never,
    role: 'agent',
    state: 'allowed',
    allowedScopes: [{
      scope: sourceScope,
      actions: ['query'],
      validUntil: '2026-11-06T01:00:00.000Z',
    }],
    accessRevision: 1,
    factsVersion: 1,
    revocationGeneration: 0,
    policyVersion: 1,
    storeSetVersion: 1,
    resolvedAt: '2026-11-05T00:00:00.000Z',
    expiresAt: '2026-11-06T01:00:00.000Z',
    denyReason: null,
    ...overrides,
  };
}

function queryAccess(overrides: Partial<AccessDecision> = {}) {
  return toQueryAccessView(access(overrides));
}

const queryId = 'query_synthetic_001' as QueryId;

describe('ContentPipeline', () => {
  it('builds once at activation and returns exact Top 3 copy provenance', async () => {
    const pipeline = new ContentPipeline({ now: fixedNow });
    const prepared = pipeline.activate(snapshot(), [item(3), item(1), item(2)]);

    expect(pipeline.inspect()).toMatchObject({
      activationCount: 1,
      releaseId,
      indexId: 'idx_synthetic_content_001',
      itemCount: 3,
      queryCount: 0,
    });
    expect(prepared.copyHandleFor('script_synthetic_001')).toMatch(
      /^copy:idx_synthetic_content_001:script_synthetic_001:1:[a-f0-9]{64}$/u,
    );

    const result = await pipeline.query({
      queryId,
      text: '发货时效',
      snapshot: snapshot(),
      access: queryAccess(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.content.kind).toBe('content');
    expect(result.content.releaseId).toBe(releaseId);
    expect(result.content.candidates.map((candidate) => candidate.rank)).toEqual([1, 2, 3]);
    expect(result.content.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'script_synthetic_001',
      'script_synthetic_002',
      'script_synthetic_003',
    ]);
    expect(result.content.candidates[0]?.body).toBe('合成发货原文 1');
    expect(new Set(result.content.candidates.map((candidate) => candidate.copyHandle)).size).toBe(3);
    expect(pipeline.inspect()).toMatchObject({ activationCount: 1, queryCount: 1 });
  });

  it('truncates to exactly three candidates when more than three are eligible', async () => {
    const pipeline = new ContentPipeline({ now: fixedNow });
    pipeline.activate(snapshot(5), [item(5), item(4), item(3), item(2), item(1)]);

    const result = await pipeline.query({
      queryId,
      text: '发货时效',
      snapshot: snapshot(5),
      access: queryAccess(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.content.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'script_synthetic_001',
      'script_synthetic_002',
      'script_synthetic_003',
    ]);
    expect(result.content.candidates.map((candidate) => candidate.rank)).toEqual([1, 2, 3]);
  });

  it('filters access scope before ranking and never leaks an out-of-scope candidate', async () => {
    const pipeline = new ContentPipeline({ now: fixedNow });
    pipeline.activate(snapshot(2), [
      item(1, {
        scope: {
          ...sourceScope,
          sourceId: 'source_other',
        } as Scope,
        title: '合成发货时效 外部来源',
      }),
      item(2),
    ]);

    const result = await pipeline.query({
      queryId,
      text: '发货时效',
      snapshot: snapshot(2),
      access: queryAccess(),
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.reason);
    expect(result.content.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'script_synthetic_002',
    ]);
  });

  it('filters platform and product scope before ranking', async () => {
    const pipeline = new ContentPipeline({ now: fixedNow });
    pipeline.activate(snapshot(3), [
      item(1, { platformScope: ['douyin'] }),
      item(2, { productScopeType: 'sku', productScopeRefs: ['sku_synthetic_other'] }),
      item(3, { productScopeType: 'sku', productScopeRefs: ['sku_synthetic_current'] }),
    ]);

    const result = await pipeline.query({
      queryId,
      text: '发货时效',
      snapshot: snapshot(3),
      access: queryAccess(),
      platform: 'qianniu',
      productContextType: 'sku',
      productContextRef: 'sku_synthetic_current',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.content.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'script_synthetic_003',
    ]);
  });

  it('distinguishes weak body-only hits, no match, out-of-scope, and stale indexes', async () => {
    const pipeline = new ContentPipeline({ now: fixedNow });
    pipeline.activate(snapshot(1), [
      item(1, {
        title: '合成收纳说明',
        questionTexts: ['收纳时如何保持干燥'],
        body: '发货时效只出现在正文',
      }),
    ]);

    await expect(pipeline.query({
      queryId,
      text: '发货时效',
      snapshot: snapshot(1),
      access: queryAccess(),
    })).resolves.toEqual({ ok: false, reason: 'weak_hit' });
    await expect(pipeline.query({
      queryId,
      text: '完全无关问题',
      snapshot: snapshot(1),
      access: queryAccess(),
    })).resolves.toEqual({ ok: false, reason: 'no_match' });

    const outOfScope = new ContentPipeline({ now: fixedNow });
    outOfScope.activate(snapshot(1), [item(1, {
      scope: { ...sourceScope, sourceId: 'source_other' } as Scope,
    })]);
    await expect(outOfScope.query({
      queryId,
      text: '合成发货时效',
      snapshot: snapshot(1),
      access: queryAccess(),
    })).resolves.toEqual({ ok: false, reason: 'out_of_scope' });

    await expect(pipeline.query({
      queryId,
      text: '合成发货时效',
      snapshot: { ...snapshot(1), releaseId: 'rel_synthetic_qry_002' as ReleaseId },
      access: queryAccess(),
    })).resolves.toEqual({ ok: false, reason: 'release_mismatch' });
  });

  it('rejects a stale candidate at activation and does not mutate the prepared index on query', async () => {
    const pipeline = new ContentPipeline({ now: fixedNow });
    expect(() => pipeline.activate(snapshot(1), [
      item(1, { releaseId: 'rel_synthetic_qry_old' as ReleaseId }),
    ])).toThrow(/release/u);

    pipeline.activate(snapshot(3), [item(1), item(2), item(3)]);
    const before = pipeline.inspect();
    await pipeline.query({
      queryId,
      text: '合成发货时效',
      snapshot: snapshot(3),
      access: queryAccess(),
    });
    expect(pipeline.inspect()).toMatchObject({
      activationCount: before.activationCount,
      itemCount: before.itemCount,
      indexId: before.indexId,
    });
  });

  it('returns the deterministic result before a bounded model enrichment completes or is cancelled', async () => {
    let releaseEnrichment!: () => void;
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    let receivedSignal: AbortSignal | undefined;
    const run = vi.fn(async (_input: unknown, signal: AbortSignal) => {
      receivedSignal = signal;
      started();
      await new Promise<void>((resolve) => { releaseEnrichment = resolve; });
    });
    const pipeline = new ContentPipeline({
      now: fixedNow,
      enrichment: { deadlineMs: 5_000, run },
    });
    pipeline.activate(snapshot(1), [item(1)]);
    const controller = new AbortController();

    const result = await pipeline.query({
      queryId,
      text: '合成发货时效',
      snapshot: snapshot(1),
      access: queryAccess(),
      signal: controller.signal,
    });
    expect(result).toMatchObject({ ok: true });
    expect(receivedSignal).not.toBe(controller.signal);

    await didStart;
    controller.abort();
    expect(receivedSignal?.aborted).toBe(true);
    releaseEnrichment();
    const after = await pipeline.query({
      queryId,
      text: '合成发货时效',
      snapshot: snapshot(1),
      access: queryAccess(),
    });
    expect(after).toEqual(result);
    expect(pipeline.inspect()).toMatchObject({ activationCount: 1 });
  });

  it('does not launch external enrichment after cancellation', async () => {
    const run = vi.fn(async () => undefined);
    const pipeline = new ContentPipeline({ now: fixedNow, enrichment: { deadlineMs: 100, run } });
    pipeline.activate(snapshot(1), [item(1)]);
    const controller = new AbortController();
    controller.abort();

    await expect(pipeline.query({
      queryId,
      text: '合成发货时效',
      snapshot: snapshot(1),
      access: queryAccess(),
      signal: controller.signal,
    })).resolves.toEqual({ ok: false, reason: 'cancelled' });
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
  });
});
