import { describe, expect, it, vi } from 'vitest';
import type { SopReleaseProjection } from '@customer-agent/content-intake';
import {
  type ReleaseId,
  type ReleaseSnapshot,
  type Scope,
} from '@customer-agent/unified-contracts';
import { createMockAccessEvaluator } from '../../src/access/evaluator.js';
import {
  createApiQueryRuntime,
  type QueryObservation,
} from '../../src/integration/query-runtime.js';
import {
  createPostgresQueryReleaseLoader,
  type LoadedQueryRelease,
} from '../../src/integration/release.js';
import { serializeAssembledTrace, assembleTrace } from '../../src/observability/index.js';
import type { ContentIndexItem } from '../../src/query/content-pipeline.js';
import type { PreparedSearchOperation } from '../../src/search-routes.js';

const releaseId = 'rel_int_api_001' as ReleaseId;
const sourceScope: Scope = {
  kind: 'source',
  tenantId: 'synthetic-tenant' as never,
  appId: 'synthetic-app' as never,
  brandId: 'synthetic-brand' as never,
  shopId: 'synthetic-shop' as never,
  domain: 'product',
  sourceId: 'synthetic-source' as never,
};

function snapshot(sop: boolean): ReleaseSnapshot {
  return {
    releaseId,
    sequence: 1,
    publishedAt: '2026-11-05T00:00:00.000Z',
    content: {
      state: 'ready',
      indexId: 'content:rel_int_api_001',
      indexVersion: 1,
      itemCount: 1,
      indexHash: 'a'.repeat(64),
    },
    sop: sop
      ? {
        state: 'ready',
        indexId: 'sop:rel_int_api_001',
        indexVersion: 1,
        itemCount: 1,
        indexHash: 'b'.repeat(64),
      }
      : {
        state: 'empty',
        indexId: null,
        indexVersion: null,
        itemCount: 0,
        indexHash: null,
      },
  };
}

function contentItem(): ContentIndexItem {
  return {
    releaseId,
    scriptId: 'synthetic-source:shipping',
    scriptVersion: 1,
    contentHash: 'c'.repeat(64),
    title: '合成发货时效',
    body: '合成回答：今天发货。',
    questionTexts: ['什么时候发货'],
    platformScope: ['qianniu', 'douyin'],
    productScopeType: 'storewide',
    productScopeRefs: [],
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    scope: sourceScope,
  };
}

function loaded(sopProjection: SopReleaseProjection | null = null): LoadedQueryRelease {
  const item = contentItem();
  return {
    snapshot: snapshot(sopProjection !== null),
    sourceBindingHash: 'd'.repeat(64),
    items: [item],
    candidates: new Map([[
      item.scriptId,
      {
        release_id: releaseId,
        script_id: 'shipping',
        script_version: 1,
        content_hash: item.contentHash,
        title: item.title,
        category: 'product',
        answer_text: item.body,
        platform_scope: ['qianniu', 'douyin'],
        product_scope_type: 'storewide',
        product_scope_refs: [],
        effective_from: item.effectiveFrom,
        effective_to: null,
        intent_taxonomy_version: 'itax_synthetic_v1',
        intent_id: 'intent_shipping',
        risk_level: 'low',
        risk_categories: [],
        has_conflict: false,
        placeholder_keys: [],
      },
    ]]),
    sourceScopes: [sourceScope],
    sopProjection,
  };
}

function sopProjection(): SopReleaseProjection {
  return {
    schemaVersion: 'sop-release-v1',
    releaseId,
    indexHash: 'b'.repeat(64),
    itemCount: 1,
    severityOrder: null,
    definitions: [{
      sopId: 'synthetic-allergy',
      sceneId: 'synthetic-allergy-scene',
      groupId: 'allergy',
      title: '合成过敏流程',
      entryStepId: 'step1',
      steps: [{
        stepId: 'step1',
        kind: 'instruction',
        sequence: 1,
        text: '合成流程话术',
        media: [],
      }],
      branches: [],
    }],
    searchEntries: [{
      entryId: 'classify-allergy',
      sceneId: 'synthetic-allergy-scene',
      stepId: 'step1',
      purpose: 'classify',
      text: '过敏流程',
      normalizedText: '过敏流程',
    }],
  };
}

function searchRequest(queryText = '什么时候发货'): PreparedSearchOperation {
  return {
    actor: {
      user_id: 'usr_synthetic_agent',
      role: 'agent',
      auth_mode: 'mock',
    } as never,
    requestId: 'request-123',
    queryId: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
    parentQueryId: null,
    interactionReason: 'original',
    collectionMode: 'synthetic',
    detectedPlatform: 'qianniu',
    platformSource: 'foreground_process',
    search: {
      normalizedQuery: queryText,
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      topK: 3,
    },
    queryTextRedacted: queryText,
    retainQueryText: false,
    redactionPolicyVersion: 'synthetic-redaction-v1',
    queryHash: 'e'.repeat(64),
    queryHashKeyVersion: 'hmac-log-v1',
    productContextRefHash: null,
    requestHashes: {
      currentVersion: 'hmac-idempotency-v1',
      hashes: { 'hmac-idempotency-v1': 'f'.repeat(64) },
    },
    sourceDenial: {
      denialKey: 'sda_synthetic',
      actorSubjectHash: 'a'.repeat(64),
      hashKeyVersion: 'hmac-log-v1',
      diagnosticId: 'diag_synthetic',
    },
  };
}

describe('INT-API query runtime', () => {
  it('prebuilds once, returns ordinary content, and emits a redacted trace', async () => {
    const observations: QueryObservation[] = [];
    const runtime = createApiQueryRuntime({
      loader: async () => loaded(),
      access: createMockAccessEvaluator(() => new Date('2026-11-05T00:30:00.000Z')),
      observer: { record: (observation) => observations.push(observation) },
      now: () => new Date('2026-11-05T00:30:00.000Z'),
    });

    await expect(runtime.initialize()).resolves.toBe(true);
    await expect(runtime.search(searchRequest())).resolves.toMatchObject({
      ok: true,
      releaseId,
      sourceBindingHash: 'd'.repeat(64),
      candidates: [{ script_id: 'shipping', rank: 1 }],
    });
    await runtime.search(searchRequest());

    expect(runtime.inspect()).toMatchObject({
      activeReleaseId: releaseId,
      activationCount: 1,
      queryCount: 2,
    });
    expect(observations).toHaveLength(2);
    expect(observations[0]?.query).not.toBeNull();
    expect(observations[0]?.trace.requestId).toMatch(/^req_[a-f0-9]{32}$/u);
    expect(observations[0]?.trace.queryId).toMatch(/^qry_[a-f0-9]{72}$/u);
    const serialized = serializeAssembledTrace(assembleTrace(
      observations[0]!.query!,
      observations[0]!.stages,
    ));
    expect(serialized).not.toContain('什么时候发货');
    expect(serialized).not.toContain('合成回答');
  });

  it('fails closed on an SOP match while the business severity gate is missing', async () => {
    const runtime = createApiQueryRuntime({
      loader: async () => loaded(sopProjection()),
      access: createMockAccessEvaluator(() => new Date('2026-11-05T00:30:00.000Z')),
      observer: { record: () => undefined },
      now: () => new Date('2026-11-05T00:30:00.000Z'),
    });

    await runtime.initialize();
    await expect(runtime.search(searchRequest('过敏流程'))).resolves.toEqual({
      ok: false,
      code: 'OVERLOADED',
    });
    expect(runtime.inspect().queryCount).toBe(0);
  });

  it('invalidates the active release when refresh fails and keeps telemetry failures observational', async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce(loaded())
      .mockRejectedValueOnce(new Error('synthetic release read failed'));
    const runtime = createApiQueryRuntime({
      loader,
      access: createMockAccessEvaluator(() => new Date('2026-11-05T00:30:00.000Z')),
      observer: { record: () => { throw new Error('synthetic observer failure'); } },
      now: () => new Date('2026-11-05T00:30:00.000Z'),
    });

    await runtime.initialize();
    await expect(runtime.search(searchRequest())).resolves.toMatchObject({ ok: true });
    await expect(runtime.afterReleaseMutation()).resolves.toBe(false);
    await expect(runtime.search(searchRequest())).resolves.toEqual({
      ok: false,
      code: 'OVERLOADED',
    });
    expect(runtime.inspect().activeReleaseId).toBeNull();
  });

  it('closes idempotently and rejects work after shutdown', async () => {
    const runtime = createApiQueryRuntime({
      loader: async () => loaded(),
      access: createMockAccessEvaluator(),
      observer: { record: () => undefined },
    });
    await runtime.initialize();
    await runtime.close();
    await runtime.close();
    expect(runtime.inspect()).toMatchObject({ closed: true, activeReleaseId: null });
    await expect(runtime.search(searchRequest())).resolves.toEqual({
      ok: false,
      code: 'OVERLOADED',
    });
  });

  it('fails release activation when an intake upsert has no release_items projection', async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.content_current current_release')) {
        return {
          rows: [{
            release_id: 'rel_int_api_gap',
            release_seq: 1,
            published_at: '2026-11-05T00:00:00.000Z',
            source_binding_hash: 'd'.repeat(64),
          }],
        };
      }
      if (sql.includes('FROM content_intake.release_lineage lineage')) {
        return { rows: [{ present: true }] };
      }
      if (sql.includes('FROM public.release_items item')) return { rows: [] };
      return { rows: [] };
    });
    const loader = createPostgresQueryReleaseLoader({
      connect: async () => ({ query, release }),
    } as never);

    await expect(loader()).rejects.toThrow('RELEASE_INDEX_ITEM_GAP');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledWith(false);
  });
});
