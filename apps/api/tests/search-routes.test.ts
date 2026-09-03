import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../src/app.js';
import type { SearchOperation } from '../src/search-routes.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import type { ServiceRepository } from '../src/service-repository.js';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function repository(): ServiceRepository {
  return {
    readiness: async () => ({
      database: 'ok', schema: 'ok', auth: 'ok', storage: 'not_ready', content: 'not_ready',
    }),
    readPolicyFlags: async () => null,
    searchCandidates: async () => ({ ok: false, code: 'SOURCE_GATE_NOT_READY' }),
    executeSearch: async () => ({ ok: false, code: 'OVERLOADED' }),
    recordAdoption: async () => ({ ok: false, code: 'OVERLOADED' }),
    recordEscalation: async () => ({ ok: false, code: 'OVERLOADED' }),
    close: async () => undefined,
  };
}

function config() {
  return parseApiRuntimeConfig({
    CUSTOMER_AGENT_PROFILE: 'test',
    AUTH_MODE: 'mock',
    CUSTOMER_AGENT_API_PORT: '0',
    CUSTOMER_AGENT_BUILD_VERSION: '0.3.0-w2-test',
  });
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
    parent_query_id: null,
    interaction_reason: 'original',
    query_text: '联系电话13800138000，什么时候发货',
    collection_mode: 'synthetic',
    detected_platform: 'qianniu',
    platform: 'qianniu',
    platform_source: 'foreground_process',
    product_context_type: null,
    product_context_ref: null,
    top_k: 3,
    ...overrides,
  };
}

function response() {
  return {
    query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
    hit_status: 'hit',
    release_id: 'rel-synthetic-001',
    source_binding_hash: 'b'.repeat(64),
    telemetry_status: 'recorded',
    candidates: [{
      rank: 1,
      release_id: 'rel-synthetic-001',
      script_id: 'script-synthetic-001',
      script_version: 1,
      content_hash: 'a'.repeat(64),
      title: '合成发货时效',
      category: 'presale',
      answer_text: '这是合成回答。',
      platform_scope: ['qianniu'],
      product_scope_type: 'storewide',
      product_scope_refs: [],
      effective_from: '2026-09-01T00:00:00.000Z',
      effective_to: null,
      intent_taxonomy_version: 'itax_synthetic_v1',
      intent_id: 'intent_synthetic_shipping',
      risk_level: 'low',
      risk_categories: [],
      has_conflict: false,
      placeholder_keys: [],
      internal_reviewer: 'must-not-cross-http',
    }],
  };
}

function appWith(operation?: SearchOperation): FastifyInstance {
  const app = createApiApp(
    config(),
    repository(),
    undefined,
    undefined,
    undefined,
    operation === undefined ? undefined : {
      operation,
      logHash: { version: 'hmac-log-v1', key: 'synthetic-search-route-key-000001' },
      idempotencyHmac: {
        currentVersion: 'hmac-idempotency-v1',
        keys: { 'hmac-idempotency-v1': 'synthetic-idempotency-route-key-0001' },
      },
    },
  );
  openApps.push(app);
  return app;
}

const authHeaders = {
  'x-mock-user': 'usr_synthetic_agent_001',
  'x-mock-role': 'agent',
};

describe('search HTTP route', () => {
  it('redacts before the operation boundary and emits an explicit response whitelist', async () => {
    const execute = vi.fn<SearchOperation['execute']>().mockResolvedValue({
      ok: true,
      response: response() as never,
    });
    const app = appWith({ execute });

    const httpResponse = await app.inject({
      method: 'POST', url: '/v1/search', headers: authHeaders, payload: validRequest(),
    });

    expect(httpResponse.statusCode).toBe(200);
    expect(httpResponse.headers['cache-control']).toBe('no-store');
    const prepared = execute.mock.calls[0]?.[0];
    expect(prepared?.search.normalizedQuery).toBe('联系电话[redacted],什么时候发货');
    expect(prepared?.queryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(prepared)).not.toContain('13800138000');
    expect(httpResponse.body).not.toContain('internal_reviewer');
    expect(httpResponse.json()).toMatchObject({ hit_status: 'hit', candidates: [{ rank: 1 }] });
  });

  it('rejects unauthorized, unsupported platform/native integration and code-point overflow before execution', async () => {
    const execute = vi.fn<SearchOperation['execute']>();
    const app = appWith({ execute });
    const cases = [
      [{}, validRequest(), 401],
      [authHeaders, validRequest({ platform: 'unknown' }), 400],
      [authHeaders, validRequest({ platform_source: 'native_integration' }), 403],
      [authHeaders, validRequest({ platform_source: 'unknown' }), 400],
      [authHeaders, validRequest({ detected_platform: 'douyin' }), 400],
      [authHeaders, validRequest({ collection_mode: 'approved_redacted' }), 403],
      [authHeaders, validRequest({ collection_mode: 'pilot_recorded' }), 403],
      [authHeaders, validRequest({ query_text: '🦊'.repeat(501) }), 400],
    ] as const;
    for (const [headers, payload, statusCode] of cases) {
      const result = await app.inject({ method: 'POST', url: '/v1/search', headers, payload });
      expect(result.statusCode).toBe(statusCode);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps the route fail-closed until the W3 atomic event operation is composed', async () => {
    const result = await appWith().inject({
      method: 'POST', url: '/v1/search', headers: authHeaders, payload: validRequest(),
    });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual({ error: { code: 'OVERLOADED', message: '服务暂不可用' } });
  });

  it.each([
    ['SOURCE_GATE_NOT_READY', 503, 'SOURCE_GATE_NOT_READY'],
    ['VALIDATION', 400, undefined],
    ['FORBIDDEN', 403, undefined],
    ['NOT_FOUND', 404, undefined],
    ['CONFLICT', 409, undefined],
    ['OVERLOADED', 503, undefined],
    ['INTERNAL', 500, undefined],
  ] as const)('maps operation failure %s to the stable HTTP contract', async (code, status, reason) => {
    const app = appWith({ execute: async () => ({ ok: false, code }) });
    const result = await app.inject({
      method: 'POST', url: '/v1/search', headers: authHeaders, payload: validRequest(),
    });
    expect(result.statusCode).toBe(status);
    if (reason) expect(result.json()).toMatchObject({ error: { details: { reason } } });
    expect(result.body).not.toContain('SQL');
    expect(result.body).not.toContain('DATABASE_URL');
  });
});
