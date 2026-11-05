import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiApp } from '../src/app.js';
import { createAccessEvaluator, type AccessSnapshot } from '../src/access/evaluator.js';
import type { ProductAuthService } from '../src/auth-service.js';
import { unavailableContentImportRepository } from '../src/content-import-repository.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import type {
  ServicePolicyFlags,
  ServiceReadinessChecks,
  ServiceRepository,
} from '../src/service-repository.js';

const CHECKS: ServiceReadinessChecks = {
  database: 'not_ready',
  schema: 'not_ready',
  auth: 'ok',
  storage: 'not_ready',
  content: 'not_ready',
};
const FLAGS: ServicePolicyFlags = {
  rewrite: false,
  auto_send: false,
  autofill_adapter: false,
  llm_ranker: false,
  metrics_experimental_kpi: false,
};

function repository(): ServiceRepository {
  return {
    readiness: vi.fn(async () => CHECKS),
    readPolicyFlags: vi.fn(async () => FLAGS),
    searchCandidates: vi.fn(async () => ({ ok: false as const, code: 'SOURCE_GATE_NOT_READY' as const })),
    executeSearch: vi.fn(async () => ({ ok: false as const, code: 'OVERLOADED' as const })),
    recordAdoption: vi.fn(async () => ({ ok: false as const, code: 'OVERLOADED' as const })),
    recordEscalation: vi.fn(async () => ({ ok: false as const, code: 'OVERLOADED' as const })),
    contentImport: unavailableContentImportRepository(),
    close: vi.fn(async () => undefined),
  };
}

const auth: ProductAuthService = {
  kind: 'product',
  async authenticate(credentials) {
    return credentials.authorization === 'Bearer test-token'
      ? { user_id: 'access-user', role: 'owner', auth_mode: 'mock' }
      : null;
  },
  readiness: () => 'ok',
  close: () => undefined,
  createLogin: vi.fn(),
  callback: vi.fn(),
  exchange: vi.fn(),
  issueBoundSession: vi.fn(),
  logout: vi.fn(),
};

const snapshot: AccessSnapshot = {
  present: true,
  principalId: 'principal-a',
  tenantId: 'tenant-a',
  appId: 'app-a',
  factsVersion: 1,
  revocationGeneration: 0,
  policyVersion: 1,
  storeSetVersion: 1,
  facts: {
    enabled: true,
    checkedAt: '2026-11-05T10:00:00Z',
    validUntil: '2026-11-05T10:04:00Z',
  },
  roles: ['director'],
  roleActions: ['query'],
  mayAllocate: false,
  accountsManage: { allowed: false, validUntil: null },
  allowedSources: [{
    scope: {
      kind: 'source',
      tenantId: 'tenant-a',
      appId: 'app-a',
      brandId: 'brand-a',
      domain: 'product',
      sourceId: 'source-a',
    } as AccessSnapshot['allowedSources'][number]['scope'],
    action: 'query',
    validUntil: '2026-11-05T10:03:00Z',
  }],
  allocationSources: [],
  evidence: {
    revokedGrant: false,
    expiredGrant: false,
    sourceOutsideSet: false,
    storeSetChanged: false,
  },
  revisionSeed: 'composition-read-v1',
  resolvedAt: '2026-11-05T10:00:00Z',
};

describe('API access composition', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('runs protected routes through the injected evaluator before their handler', async () => {
    const evaluator = createAccessEvaluator(async (_userId, actions) => ({
      ...snapshot,
      allowedSources: actions?.includes('query') ? snapshot.allowedSources : [],
    }));
    app = createApiApp({
      config: parseApiRuntimeConfig({
        CUSTOMER_AGENT_PROFILE: 'test',
        AUTH_MODE: 'mock',
        AUTH_SESSION_MODE: 'product',
        CUSTOMER_AGENT_API_PORT: '0',
        CUSTOMER_AGENT_BUILD_VERSION: '0.3.0-access-composition',
      }),
      repository: repository(),
      authService: auth,
      accessEvaluator: evaluator,
    });
    await app.ready();
    const headers = { authorization: 'Bearer test-token' };

    const denied = await app.inject({ method: 'POST', url: '/v1/content/publish', headers });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain('source-a');

    const admitted = await app.inject({
      method: 'POST',
      url: '/v1/search',
      headers,
      payload: {
        query_id: '11111111-1111-1111-1111-111111111111',
        parent_query_id: null,
        interaction_reason: 'original',
        query_text: '合成问题',
        collection_mode: 'synthetic',
        detected_platform: 'qianniu',
        platform: 'qianniu',
        platform_source: 'foreground_process',
        product_context_type: null,
        product_context_ref: null,
        top_k: 3,
      },
    });
    expect(admitted.statusCode).toBe(503);

    const projection = await app.inject({ method: 'GET', url: '/v1/access/query', headers });
    expect(projection.statusCode).toBe(200);
    expect(projection.json()).toMatchObject({
      state: 'allowed',
      scopes: [{ scope: { sourceId: 'source-a' } }],
    });
  });
});
