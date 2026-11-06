import { describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../../src/app.js';
import type { ContentReleaseService } from '../../src/content-release-service.js';
import type { ServiceRepository } from '../../src/service-repository.js';
import { parseApiRuntimeConfig } from '../../src/runtime-config.js';
import { unavailableContentImportRepository } from '../../src/content-import-repository.js';

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

function config() {
  return parseApiRuntimeConfig({
    CUSTOMER_AGENT_PROFILE: 'test',
    AUTH_MODE: 'mock',
    CUSTOMER_AGENT_API_PORT: '0',
    CUSTOMER_AGENT_BUILD_VERSION: '0.3.0-int-api-test',
  });
}

describe('INT-API composition lifecycle', () => {
  it('refreshes the query runtime after a committed release and closes it with the app', async () => {
    const afterReleaseMutation = vi.fn(async () => true);
    const close = vi.fn(async () => undefined);
    const response = {
      release_id: 'rel_synthetic_publish_1',
      release_seq: 1,
      announcement_id: 'ann_synthetic_publish_1',
      source_binding_hash: 'a'.repeat(64),
    };
    const contentRelease: ContentReleaseService = {
      publish: async () => ({ ok: true, response }),
      rollback: async () => ({ ok: true, response: { ...response, rollback_of_release_id: 'rel_previous' } }),
      rollbackPrevious: async () => ({ ok: true, response: { ...response, rollback_of_release_id: 'rel_previous' } }),
      close: async () => undefined,
    };
    const app = createApiApp({
      config: config(),
      repository: repository(),
      contentReleaseDependencies: { service: contentRelease },
      queryRuntime: { afterReleaseMutation, readiness: () => 'ok', close },
    });

    const result = await app.inject({
      method: 'POST',
      url: '/v1/content/publish',
      headers: {
        'x-mock-user': 'usr_synthetic_owner',
        'x-mock-role': 'owner',
        'idempotency-key': 'publish-synthetic-001',
      },
      payload: {
        import_batch_id: '00000000-0000-4000-8000-000000000001',
        title: '合成发布',
        summary: '合成发布摘要',
      },
    });

    expect(result.statusCode).toBe(200);
    expect(afterReleaseMutation).toHaveBeenCalledOnce();
    await app.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps readiness closed while the query runtime has no active release', async () => {
    const app = createApiApp({
      config: config(),
      repository: {
        ...repository(),
        readiness: async () => ({
          database: 'ok',
          schema: 'ok',
          auth: 'ok',
          storage: 'ok',
          content: 'ok',
        }),
      },
      queryRuntime: {
        afterReleaseMutation: async () => false,
        readiness: () => 'not_ready',
        close: async () => undefined,
      },
    });

    const result = await app.inject({ method: 'GET', url: '/ready' });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toMatchObject({
      status: 'not_ready',
      checks: { content: 'not_ready' },
    });
    await app.close();
  });

  it('reports query runtime shutdown failures without skipping other resource closes', async () => {
    const close = vi.fn(async () => {
      throw new Error('synthetic runtime close failure');
    });
    const repositoryClose = vi.fn(async () => undefined);
    const app = createApiApp({
      config: config(),
      repository: { ...repository(), close: repositoryClose },
      queryRuntime: {
        afterReleaseMutation: async () => true,
        readiness: () => 'ok',
        close,
      },
    });

    await expect(app.close()).rejects.toThrow('API resource shutdown failed');
    expect(close).toHaveBeenCalledOnce();
    expect(repositoryClose).toHaveBeenCalledOnce();
  });
});
