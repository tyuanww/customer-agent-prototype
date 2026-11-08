import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../src/app.js';
import { createSopQueryOperation, type SopQueryOperation } from '../src/sop-query-operation.js';
import type { SopQueryResponse } from '../src/sop-query-model.js';
import { MENOKIN_SOP_QUERY_CONTRACT_SET_ID } from '../src/sop-query-model.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { unavailableContentImportRepository } from '../src/content-import-repository.js';
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
    contentImport: unavailableContentImportRepository(),
    close: async () => undefined,
  };
}

function config() {
  return parseApiRuntimeConfig({
    CUSTOMER_AGENT_PROFILE: 'test',
    AUTH_MODE: 'mock',
    CUSTOMER_AGENT_API_PORT: '0',
    CUSTOMER_AGENT_BUILD_VERSION: '0.3.43-sop-query-test',
  });
}

const authHeaders = {
  'x-mock-user': 'usr_synthetic_agent_001',
  'x-mock-role': 'agent',
};
const headers = {
  ...authHeaders,
  'x-intake-contract-set': MENOKIN_SOP_QUERY_CONTRACT_SET_ID,
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    sop_group: '过敏流程SOP',
    shop_id: 'menokin_shop_001',
    product_context: null,
    query_text: '顾客使用后出现过敏怎么办',
    context_generation: 'gen-001',
    request_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f',
    ...overrides,
  };
}

function readyResponse(overrides: Record<string, unknown> = {}): SopQueryResponse {
  return {
    status: 'ready',
    request_id: request().request_id,
    release_id: 'release-sop-001',
    lease_expires_at: '2026-11-08T12:00:00.000Z',
    result: {
      entry_node_id: 'menokin:allergy:1',
      nodes: [{
        node_id: 'menokin:allergy:1',
        scenario_id: 'allergy',
        sequence: 1,
        kind: 'instruction',
        terminal: false,
        source_ref: 'sheet:过敏流程SOP!A2',
      }],
      branches: [],
      messages: [{
        message_id: 'msg-allergy-1',
        node_id: 'menokin:allergy:1',
        title: '先停手并确认',
        body: '请先停手，并确认具体反应。',
        risk_level: 'high',
        copy_allowed: true,
      }],
      media_refs: [],
    },
    reasons: [],
    ...overrides,
  } as SopQueryResponse;
}

function appWith(operation?: SopQueryOperation): FastifyInstance {
  const app = createApiApp({
    config: config(),
    repository: repository(),
    ...(operation === undefined ? {} : { sopQueryDependencies: { operation } }),
  });
  openApps.push(app);
  return app;
}

describe('SOP query candidate transport', () => {
  it('binds the request identity after the read port returns a status result', async () => {
    const expected = readyResponse() as Extract<SopQueryResponse, { status: 'ready' }>;
    const { request_id: _ignored, ...readResult } = expected;
    const read = vi.fn().mockResolvedValue(readResult);
    const operation = createSopQueryOperation({ read });
    const result = await operation.execute({
      actor: { user_id: 'usr_synthetic_agent_001', role: 'agent', auth_mode: 'mock' },
      request: request(),
    });
    expect(result).toEqual(expected);
    expect(read).toHaveBeenCalledOnce();
  });

  it('does not register the candidate route without an explicit operation', async () => {
    const response = await appWith().inject({
      method: 'POST', url: '/v1/sop/query', headers, payload: request(),
    });
    expect(response.statusCode).toBe(404);
  });

  it('requires the full contract set ID and never accepts the business alias', async () => {
    const execute = vi.fn<SopQueryOperation['execute']>().mockResolvedValue(readyResponse());
    const app = appWith({ execute });
    const response = await app.inject({
      method: 'POST', url: '/v1/sop/query', headers: { ...authHeaders, 'x-intake-contract-set': 'menokin-sop-query-v1' }, payload: request(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'CONTRACT_UPGRADE_REQUIRED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the authenticated actor and one complete request to the operation', async () => {
    const execute = vi.fn<SopQueryOperation['execute']>().mockResolvedValue(readyResponse());
    const app = appWith({ execute });
    const response = await app.inject({ method: 'POST', url: '/v1/sop/query', headers, payload: request() });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-intake-contract-set']).toBe(MENOKIN_SOP_QUERY_CONTRACT_SET_ID);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      actor: { user_id: 'usr_synthetic_agent_001', role: 'agent' },
      request: request(),
    });
  });

  it('rejects unauthenticated requests and forbidden body identity fields before execution', async () => {
    const execute = vi.fn<SopQueryOperation['execute']>().mockResolvedValue(readyResponse());
    const app = appWith({ execute });
    const unauthorized = await app.inject({
      method: 'POST', url: '/v1/sop/query', headers: { 'x-intake-contract-set': MENOKIN_SOP_QUERY_CONTRACT_SET_ID }, payload: request(),
    });
    const bodyIdentity = await app.inject({
      method: 'POST', url: '/v1/sop/query', headers, payload: request({ userId: 'wrong-user' }),
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(bodyIdentity.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts all four public statuses as a complete response union', async () => {
    const responses: SopQueryResponse[] = [
      readyResponse(),
      { status: 'blocked', request_id: request().request_id, release_id: null, lease_expires_at: null, result: null, reasons: [{ code: 'GRAPH_UNRESOLVED' }] },
      { status: 'stale', request_id: request().request_id, release_id: 'release-sop-old', lease_expires_at: null, result: null, reasons: [{ code: 'STALE_RELEASE' }] },
      { status: 'no_match', request_id: request().request_id, release_id: 'release-sop-001', lease_expires_at: '2026-11-08T12:00:00.000Z', result: { nodes: [], branches: [], messages: [], media_refs: [] }, reasons: [] },
    ];
    for (const responseValue of responses) {
      const execute = vi.fn<SopQueryOperation['execute']>().mockResolvedValue(responseValue);
      const app = appWith({ execute });
      const response = await app.inject({ method: 'POST', url: '/v1/sop/query', headers, payload: request() });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(responseValue);
      await app.close();
      openApps.splice(openApps.indexOf(app), 1);
    }
  });

  it('maps operation failures to the contract HTTP statuses', async () => {
    const cases = [
      ['SCOPE_DENIED', 403],
      ['IDEMPOTENCY_CONFLICT', 409],
      ['SOP_BLOCKED', 422],
      ['SOP_STALE', 409],
      ['SOP_UNAVAILABLE', 503],
    ] as const;
    for (const [code, statusCode] of cases) {
      const execute = vi.fn<SopQueryOperation['execute']>().mockResolvedValue({ ok: false, code });
      const app = appWith({ execute });
      const response = await app.inject({ method: 'POST', url: '/v1/sop/query', headers, payload: request() });
      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toMatchObject({ code });
      await app.close();
      openApps.splice(openApps.indexOf(app), 1);
    }
  });

  it('rejects malformed request bodies and keeps the operation boundary clean', async () => {
    const execute = vi.fn<SopQueryOperation['execute']>().mockResolvedValue(readyResponse());
    const app = appWith({ execute });
    const cases = [
      request({ sop_group: '未知 SOP' }),
      request({ shop_id: 'shop with spaces' }),
      request({ query_text: '   ' }),
      request({ context_generation: '' }),
      request({ request_id: 'not-a-uuid' }),
      request({ product_context: { type: 'sku' } }),
      request({ token: 'client-token' }),
    ];
    for (const payload of cases) {
      const response = await app.inject({ method: 'POST', url: '/v1/sop/query', headers, payload });
      expect(response.statusCode).toBe(400);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed for unknown operation errors and invalid operation responses', async () => {
    const throws = appWith({ execute: async () => { throw new Error('DATABASE_URL secret'); } });
    const failed = await throws.inject({ method: 'POST', url: '/v1/sop/query', headers, payload: request() });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('DATABASE_URL');
    const invalid = appWith({ execute: async () => ({ status: 'ready', request_id: request().request_id }) as never });
    const invalidResponse = await invalid.inject({ method: 'POST', url: '/v1/sop/query', headers, payload: request() });
    expect(invalidResponse.statusCode).toBe(503);
  });

  it('keeps legacy search independent and fail closed when its operation is absent', async () => {
    const response = await appWith().inject({
      method: 'POST', url: '/v1/search', headers: authHeaders,
      payload: { query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f', parent_query_id: null, interaction_reason: 'original', query_text: '发货', collection_mode: 'synthetic', detected_platform: 'qianniu', platform: 'qianniu', platform_source: 'foreground_process', product_context_type: null, product_context_ref: null, top_k: 1 },
    });
    expect(response.statusCode).toBe(503);
  });
});
