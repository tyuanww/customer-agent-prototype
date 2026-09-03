import { describe, expect, it, vi } from 'vitest';
import { createEventRepository } from '../src/event-repository.js';
import type { PreparedSearchOperation } from '../src/search-routes.js';

const NO_HIT_CONTEXT = Object.freeze({
  release_id: 'rel_synthetic_repository_test',
  source_binding_hash: 'b'.repeat(64),
  rank: null,
  script_id: null,
  script_version: null,
  content_hash: null,
  title: null,
  category: null,
  answer_text: null,
  platform_scope: null,
  product_scope_type: null,
  product_scope_refs: null,
  effective_from: null,
  effective_to: null,
  intent_taxonomy_version: null,
  intent_id: null,
  risk_level: null,
  risk_categories: null,
  has_conflict: null,
  placeholder_keys: null,
});

function searchRequest(): PreparedSearchOperation {
  return Object.freeze({
    actor: {
      user_id: 'usr_synthetic_repository_test',
      role: 'agent' as const,
      auth_mode: 'mock' as const,
    },
    queryId: '20000000-0000-4000-8000-000000000001',
    parentQueryId: null,
    interactionReason: 'original',
    collectionMode: 'synthetic',
    detectedPlatform: 'qianniu',
    platformSource: 'manual',
    search: {
      normalizedQuery: '合成查询',
      platform: 'qianniu',
      productContextType: null,
      productContextRef: null,
      topK: 3,
    },
    redactionPolicyVersion: 'redaction-synthetic-v1',
    queryHash: 'a'.repeat(64),
    queryHashKeyVersion: 'hmac-log-v1',
    productContextRefHash: null,
    requestHashes: {
      currentVersion: 'hmac-idempotency-v1',
      hashes: { 'hmac-idempotency-v1': 'c'.repeat(64) },
    },
    sourceDenial: {
      denialKey: `sda_${'d'.repeat(64)}`,
      actorSubjectHash: 'e'.repeat(64),
      hashKeyVersion: 'hmac-log-v1',
      diagnosticId: `diag_${'f'.repeat(32)}`,
    },
  } satisfies PreparedSearchOperation);
}

function scriptedPool(options: Readonly<{
  failAt: 'telemetry' | 'commit';
  rollbackFails?: boolean;
}>) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (sql === 'ROLLBACK') {
      if (options.rollbackFails) throw Object.assign(new Error('synthetic rollback failure'), { code: '08006' });
      return { rows: [] };
    }
    if (sql === 'COMMIT') {
      if (options.failAt === 'commit') {
        throw Object.assign(new Error('synthetic ambiguous commit'), { code: '08006' });
      }
      return { rows: [] };
    }
    if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
    if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
    if (sql.includes('idempotency_claim')) {
      return { rows: [{ action: 'proceed', lease_version: 1 }] };
    }
    if (sql.includes('WITH scoped AS MATERIALIZED')) return { rows: [NO_HIT_CONTEXT] };
    if (sql.includes('INSERT INTO public.query_events')) {
      if (options.failAt === 'telemetry') {
        throw Object.assign(new Error('synthetic telemetry denial'), { code: '42501' });
      }
      return { rows: [] };
    }
    if (sql.includes('idempotency_complete')) return { rows: [] };
    return { rows: [] };
  });
  return {
    pool: { connect: async () => ({ query, release }) },
    query,
    release,
  };
}

describe('EventRepository transaction failure boundaries', () => {
  it('never labels an ambiguous COMMIT transport failure as a zero-write response', async () => {
    const scripted = scriptedPool({ failAt: 'commit' });
    const repository = createEventRepository(scripted.pool as never, 'instance_synthetic_test');

    await expect(repository.executeSearch(searchRequest())).resolves.toEqual({
      ok: false,
      code: 'OVERLOADED',
    });
    expect(scripted.release).toHaveBeenCalledWith(false);
  });

  it('returns collection_disabled only before COMMIT and destroys a client when rollback fails', async () => {
    const safeRollback = scriptedPool({ failAt: 'telemetry' });
    const safeRepository = createEventRepository(safeRollback.pool as never, 'instance_synthetic_test');
    await expect(safeRepository.executeSearch(searchRequest())).resolves.toMatchObject({
      ok: true,
      response: { telemetry_status: 'collection_disabled' },
    });
    expect(safeRollback.release).toHaveBeenCalledWith(false);

    const failedRollback = scriptedPool({ failAt: 'telemetry', rollbackFails: true });
    const failedRepository = createEventRepository(
      failedRollback.pool as never,
      'instance_synthetic_test',
    );
    await expect(failedRepository.executeSearch(searchRequest())).resolves.toMatchObject({
      ok: true,
      response: { telemetry_status: 'collection_disabled' },
    });
    expect(failedRollback.release).toHaveBeenCalledWith(true);
  });
});
