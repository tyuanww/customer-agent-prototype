import { describe, expect, it, vi } from 'vitest';
import type { ReleaseId, Scope } from '@customer-agent/unified-contracts';
import type { SopReleaseProjection } from '@customer-agent/content-intake';
import { parseContractSchema } from '@customer-agent/contracts';
import { createApiApp } from '../../src/app.js';
import { createMockAccessEvaluator } from '../../src/access/evaluator.js';
import { unavailableContentImportRepository } from '../../src/content-import-repository.js';
import { createEventRepository } from '../../src/event-repository.js';
import {
  createApiQueryRuntime,
  type QueryObservation,
} from '../../src/integration/query-runtime.js';
import type { LoadedQueryRelease } from '../../src/integration/release.js';
import type { OperationFailureReason } from '../../src/operation-result.js';
import type { ContentIndexItem } from '../../src/query/content-pipeline.js';
import { SopPipeline } from '../../src/query/sop-pipeline.js';
import { parseApiRuntimeConfig } from '../../src/runtime-config.js';
import type { ServiceRepository } from '../../src/service-repository.js';

const releaseId = 'rel_int_api_http_001' as ReleaseId;
const scope: Scope = {
  kind: 'source',
  tenantId: 'synthetic-tenant' as never,
  appId: 'synthetic-app' as never,
  brandId: 'synthetic-brand' as never,
  shopId: 'synthetic-shop' as never,
  domain: 'product',
  sourceId: 'synthetic-source' as never,
};

function loaded(): LoadedQueryRelease {
  const item: ContentIndexItem = {
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
    scope,
  };
  return {
    snapshot: {
      releaseId,
      sequence: 1,
      publishedAt: '2026-11-05T00:00:00.000Z',
      content: {
        state: 'ready',
        indexId: `content:${releaseId}`,
        indexVersion: 1,
        itemCount: 1,
        indexHash: 'a'.repeat(64),
      },
      sop: {
        state: 'empty',
        indexId: null,
        indexVersion: null,
        itemCount: 0,
        indexHash: null,
      },
    },
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
    sourceScopes: [scope],
    sopProjection: null,
  };
}

function sopProjection(severityOrder: SopReleaseProjection['severityOrder']): SopReleaseProjection {
  return {
    schemaVersion: 'sop-release-v1',
    releaseId,
    indexHash: 'b'.repeat(64),
    itemCount: 1,
    severityOrder,
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

function loadedWithSop(
  projection: SopReleaseProjection | null,
  sopState: 'ready' | 'empty' = projection === null ? 'empty' : 'ready',
): LoadedQueryRelease {
  const base = loaded();
  return {
    ...base,
    snapshot: {
      ...base.snapshot,
      sop: sopState === 'ready'
        ? {
          state: 'ready',
          indexId: `sop:${releaseId}`,
          indexVersion: 1,
          itemCount: 1,
          indexHash: 'b'.repeat(64),
        }
        : base.snapshot.sop,
    },
    sopProjection: projection,
  };
}

function repository(): ServiceRepository {
  return {
    readiness: async () => ({
      database: 'ok',
      schema: 'ok',
      auth: 'ok',
      storage: 'not_ready',
      content: 'not_ready',
    }),
    readPolicyFlags: async () => null,
    searchCandidates: async () => ({ ok: false, code: 'SOURCE_GATE_NOT_READY' }),
    executeSearch: async () => ({ ok: false, code: 'OVERLOADED' }),
    recordAdoption: async () => ({ ok: false, code: 'OVERLOADED' }),
    recordEscalation: async () => ({ ok: false, code: 'OVERLOADED' }),
    contentImport: unavailableContentImportRepository(),
    close: async () => undefined,
  };
}

function eventPool() {
  const statements: string[] = [];
  const query = async (sql: string) => {
    statements.push(sql);
    if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
    if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
    if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
    return { rows: [] };
  };
  return {
    pool: { connect: async () => ({ query, release: () => undefined }) },
    statements,
  };
}

function coordinatedApp(runtime: ReturnType<typeof createApiQueryRuntime>) {
  const access = createMockAccessEvaluator(() => new Date('2026-11-05T00:30:00.000Z'));
  const events = eventPool();
  const eventRepository = createEventRepository(events.pool as never, 'int_api_http_test');
  const app = createApiApp({
    config: config(),
    repository: repository(),
    accessEvaluator: access,
    queryRuntime: runtime,
    searchDependencies: {
      operation: {
        execute: (request) => eventRepository.executeSearch(request, () => runtime.search(request)),
      },
      logHash: { version: 'hmac-log-v1', key: 'synthetic-search-route-key-000001' },
      idempotencyHmac: {
        currentVersion: 'hmac-idempotency-v1',
        keys: { 'hmac-idempotency-v1': 'synthetic-idempotency-route-key-0001' },
      },
    },
  });
  return { app, events };
}

function config() {
  return parseApiRuntimeConfig({
    CUSTOMER_AGENT_PROFILE: 'test',
    AUTH_MODE: 'mock',
    CUSTOMER_AGENT_API_PORT: '0',
    CUSTOMER_AGENT_BUILD_VERSION: '0.3.0-int-api-http-test',
  });
}

describe('coordinated /v1/search composition', () => {
  it('keeps the HTTP contract and records the event through the existing transaction owner', async () => {
    const access = createMockAccessEvaluator(() => new Date('2026-11-05T00:30:00.000Z'));
    const observations: QueryObservation[] = [];
    const runtime = createApiQueryRuntime({
      loader: async () => loaded(),
      access,
      observer: { record: (observation) => observations.push(observation) },
      now: () => new Date('2026-11-05T00:30:00.000Z'),
    });
    await runtime.initialize();
    const events = eventPool();
    const eventRepository = createEventRepository(events.pool as never, 'int_api_http_test');
    const app = createApiApp({
      config: config(),
      repository: repository(),
      accessEvaluator: access,
      queryRuntime: runtime,
      searchDependencies: {
        operation: {
          execute: (request) => eventRepository.executeSearch(request, () => runtime.search(request)),
        },
        logHash: { version: 'hmac-log-v1', key: 'synthetic-search-route-key-000001' },
        idempotencyHmac: {
          currentVersion: 'hmac-idempotency-v1',
          keys: { 'hmac-idempotency-v1': 'synthetic-idempotency-route-key-0001' },
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/search',
      headers: {
        'x-mock-user': 'usr_synthetic_agent',
        'x-mock-role': 'agent',
      },
      payload: {
        query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
        parent_query_id: null,
        interaction_reason: 'original',
        query_text: '什么时候发货',
        collection_mode: 'synthetic',
        detected_platform: 'qianniu',
        platform: 'qianniu',
        platform_source: 'foreground_process',
        product_context_type: null,
        product_context_ref: null,
        top_k: 3,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      hit_status: 'hit',
      release_id: releaseId,
      telemetry_status: 'recorded',
      candidates: [{
        rank: 1,
        script_id: 'shipping',
        answer_text: '合成回答：今天发货。',
      }],
    });
    expect(events.statements.some((sql) => sql.includes('INSERT INTO public.query_events'))).toBe(true);
    expect(events.statements.some((sql) => sql.includes('WITH scoped AS MATERIALIZED'))).toBe(false);
    expect(observations).toHaveLength(1);
    expect(JSON.stringify(observations[0])).not.toContain('什么时候发货');
    await app.close();
  });
});

describe('coordinated /v1/search SOP failure contract', () => {
  async function requestSop(
    runtime: ReturnType<typeof createApiQueryRuntime>,
  ) {
    const { app, events } = coordinatedApp(runtime);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/search',
      headers: {
        'x-mock-user': 'usr_synthetic_agent',
        'x-mock-role': 'agent',
      },
      payload: {
        query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
        parent_query_id: null,
        interaction_reason: 'original',
        query_text: '过敏流程',
        collection_mode: 'synthetic',
        detected_platform: 'qianniu',
        platform: 'qianniu',
        platform_source: 'foreground_process',
        product_context_type: null,
        product_context_ref: null,
        top_k: 3,
      },
    });
    await app.close();
    return { response, events };
  }

  function expectSopFailure(
    result: Awaited<ReturnType<typeof requestSop>>,
    sopReason: OperationFailureReason,
  ): void {
    expect(result.response.statusCode).toBe(503);
    expect(result.response.headers['retry-after']).toBe('1');
    const body = result.response.json();
    expect(body).toEqual({
      error: {
        code: 'OVERLOADED',
        message: '服务暂不可用',
        details: {
          reason: 'SOURCE_GATE_NOT_READY',
          retry_after_sec: 1,
          sop_reason: sopReason,
        },
      },
    });
    expect(parseContractSchema('OverloadedErrorEnvelope', body)).toEqual(body);
    expect(result.response.body).not.toContain('candidates');
    expect(result.events.statements.some((sql) => sql.includes('INSERT INTO public.query_events'))).toBe(false);
    expect(result.events.statements.some((sql) => sql.includes('candidate_impressions'))).toBe(false);
  }

  it('keeps explicit SOP search fail-closed while the same FAQ search operation is available', async () => {
    const access = createMockAccessEvaluator(() => new Date('2099-01-01T00:00:00.000Z'));
    const runtime = createApiQueryRuntime({ loader: async () => loadedWithSop(sopProjection(null)), access,
      observer: { record: () => undefined }, now: () => new Date('2099-01-01T00:00:00.000Z') });
    await runtime.initialize();
    const { app, events } = coordinatedApp(runtime);
    const payload = { parent_query_id: null, interaction_reason: 'original', collection_mode: 'synthetic',
      detected_platform: 'qianniu', platform: 'qianniu', platform_source: 'foreground_process',
      product_context_type: null, product_context_ref: null, top_k: 3 };
    const headers = { 'x-mock-user': 'usr_synthetic_agent', 'x-mock-role': 'agent' };
    try {
      const faq = await app.inject({ method: 'POST', url: '/v1/search', headers,
        payload: { ...payload, query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f', query_text: '什么时候发货' } });
      expect(faq.statusCode).toBe(200); expect(faq.json()).toMatchObject({ hit_status: 'hit', telemetry_status: 'recorded' });
      const recorded = events.statements.filter(sql => sql.includes('INSERT INTO public.query_events')).length;
      expect(recorded).toBeGreaterThan(0);
      const sop = await app.inject({ method: 'POST', url: '/v1/search', headers,
        payload: { ...payload, query_id: 'b33069ba-03fb-48a1-bec6-e89219def340', query_text: '过敏流程' } });
      expect(sop.statusCode).toBe(503);
      expect(sop.json()).toMatchObject({ error: { details: { reason: 'SOURCE_GATE_NOT_READY', sop_reason: 'SOP_SEVERITY_ORDER_REQUIRED' } } });
      expect(sop.body).not.toContain('candidates');
      expect(events.statements.filter(sql => sql.includes('INSERT INTO public.query_events')).length).toBe(recorded);
    } finally { await app.close(); }
  });

  it('distinguishes a ready SOP release whose pipeline is missing', async () => {
    const access = createMockAccessEvaluator(() => new Date('2099-01-01T00:00:00.000Z'));
    const runtime = createApiQueryRuntime({
      loader: async () => loadedWithSop(null, 'ready'),
      access,
      observer: { record: () => undefined },
      now: () => new Date('2099-01-01T00:00:00.000Z'),
    });
    await runtime.initialize();

    expectSopFailure(await requestSop(runtime), 'SOP_UNAVAILABLE');
  });

  it('preserves the missing severity-order gate', async () => {
    const access = createMockAccessEvaluator(() => new Date('2099-01-01T00:00:00.000Z'));
    const runtime = createApiQueryRuntime({
      loader: async () => loadedWithSop(sopProjection(null)),
      access,
      observer: { record: () => undefined },
      now: () => new Date('2099-01-01T00:00:00.000Z'),
    });
    await runtime.initialize();

    expectSopFailure(await requestSop(runtime), 'SOP_SEVERITY_ORDER_REQUIRED');
  });

  it('preserves the unresolved Gate-B node reason', async () => {
    const query = vi.spyOn(SopPipeline.prototype, 'query').mockImplementation((input) => ({
      kind: 'failure',
      queryId: input.queryId as never,
      failureCode: 'SOP_GATE_B_UNRESOLVED',
      retryable: false,
      message: 'SOP Gate B is unresolved',
    }));
    try {
      const access = createMockAccessEvaluator(() => new Date('2099-01-01T00:00:00.000Z'));
      const runtime = createApiQueryRuntime({
        loader: async () => loadedWithSop(sopProjection([
          'allergy',
          'acne',
          'quality-after-sale',
          'minor-error-broken',
          'tax',
        ])),
        access,
        observer: { record: () => undefined },
        now: () => new Date('2099-01-01T00:00:00.000Z'),
      });
      await runtime.initialize();

      expectSopFailure(await requestSop(runtime), 'SOP_GATE_B_UNRESOLVED');
    } finally {
      query.mockRestore();
    }
  });

  it('reports a valid SOP flow as unavailable through the ordinary SearchResponse', async () => {
    const access = createMockAccessEvaluator(() => new Date('2099-01-01T00:00:00.000Z'));
    const runtime = createApiQueryRuntime({
      loader: async () => loadedWithSop(sopProjection([
        'allergy',
        'acne',
        'quality-after-sale',
        'minor-error-broken',
        'tax',
      ])),
      access,
      observer: { record: () => undefined },
      now: () => new Date('2099-01-01T00:00:00.000Z'),
    });
    await runtime.initialize();

    expectSopFailure(await requestSop(runtime), 'SOP_FLOW_CONTRACT_UNAVAILABLE');
  });
});
