import { describe, expect, it, vi } from 'vitest';
import {
  createOpsLoopRepository,
  OPS_LOOP_PRODUCT_SESSION_ID,
  type PreparedInaccuracyReport,
  type PreparedScriptMutation,
  type PreparedSopDelete,
  type PreparedSopImport,
  type PreparedSopPatch,
} from '../src/ops-loop-repository.js';

const coach = Object.freeze({
  user_id: 'usr_synthetic_coach_001',
  role: 'coach' as const,
  auth_mode: 'mock' as const,
});

const owner = Object.freeze({
  user_id: 'usr_synthetic_owner_001',
  role: 'owner' as const,
  auth_mode: 'mock' as const,
});

const agent = Object.freeze({
  user_id: 'usr_synthetic_agent_001',
  role: 'agent' as const,
  auth_mode: 'mock' as const,
});

const hashes = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  hashes: Object.freeze({ 'hmac-idempotency-v1': 'a'.repeat(64) }),
});

function inaccuracyRequest(): PreparedInaccuracyReport {
  return {
    actor: agent,
    queryId: '11111111-1111-1111-1111-111111111111',
    scriptId: 'script-1',
    scriptVersion: 1,
    rank: 1,
    contentHash: 'a'.repeat(64),
    idempotencyKey: 'idem-inacc',
    requestHashes: hashes,
  };
}

function importRequest(): PreparedSopImport {
  return {
    actor: coach,
    nodes: [{ node_id: 'n1', parent_node_id: null, title: '停手', body: '先停手', sort_key: 0 }],
    idempotencyKey: 'idem-import',
    requestHashes: hashes,
  };
}

function scriptRequest(): PreparedScriptMutation {
  return {
    actor: owner,
    scriptId: 'script-1',
    action: 'delete',
    expectedVersion: 1,
    title: null,
    answerText: null,
    effectiveFrom: null,
    effectiveTo: null,
    idempotencyKey: 'idem-script',
    requestHashes: hashes,
  };
}

function patchRequest(): PreparedSopPatch {
  return {
    actor: coach,
    nodeId: 'n1',
    expectedVersion: 1,
    title: '停手',
    body: '先停',
    sortKey: 0,
    idempotencyKey: 'idem-patch',
    requestHashes: hashes,
  };
}

function deleteRequest(): PreparedSopDelete {
  return {
    actor: owner,
    nodeId: 'n1',
    expectedVersion: 1,
    idempotencyKey: 'idem-delete',
    requestHashes: hashes,
  };
}

const sopNodeRow = Object.freeze({
  node_id: 'n1', parent_node_id: null, title: '停手', body: '先停',
  sort_key: 0, version: 2, lifecycle: 'active',
});

const softwareRow = Object.freeze({
  version: '0.3.17',
  platform: 'mac-universal',
  sha256: 'a'.repeat(64),
  download_url: 'https://example.com/app.dmg',
  created_at: '2026-09-21T00:00:00.000Z',
  signed: true,
});

function scriptedPool(
  handler: (sql: string, params: unknown[] | undefined) => unknown | Promise<unknown>,
) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const result = await handler(sql, params);
    return result ?? { rows: [] };
  });
  return {
    pool: { connect: async () => ({ query, release }) },
    query,
    release,
  };
}

describe('ops-loop repository', () => {
  it('denies agent SOP/metrics and coach software/script before opening a client', async () => {
    const connect = vi.fn(async () => {
      throw new Error('SELECT secret FROM ops_loop.sop_nodes');
    });
    const repository = createOpsLoopRepository({ connect } as never, 'api_ops_loop_test');
    expect(await repository.readSopCatalog(agent)).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await repository.importSopCatalog({ ...importRequest(), actor: agent }))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await repository.deleteSopNode({
      actor: coach, nodeId: 'n1', expectedVersion: 1, idempotencyKey: 'idem-d', requestHashes: hashes,
    })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await repository.mutateScript({ ...scriptRequest(), actor: coach }))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await repository.listSoftwareReleases(coach)).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await repository.currentSoftwareRelease(coach)).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await repository.readRetrievalMetrics(agent, 'current_release'))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('maps idempotency conflict, replay, and connect overload without leaking SQL', async () => {
    const sink = vi.fn();
    const overloaded = { connect: async () => { throw new Error('SELECT secret token=driver'); } };
    expect(await createOpsLoopRepository(overloaded as never, 'api_ops_loop_test', sink)
      .recordInaccuracy(inaccuracyRequest())).toEqual({ ok: false, code: 'OVERLOADED' });
    expect(sink).not.toHaveBeenCalled();

    const conflict = scriptedPool((sql) => {
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'conflict' }] };
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(conflict.pool as never).recordInaccuracy(inaccuracyRequest()))
      .toEqual({ ok: false, code: 'CONFLICT' });
    expect(conflict.release).toHaveBeenCalledWith(false);
    expect(JSON.stringify(conflict.query.mock.calls)).not.toContain('record_inaccuracy_report');

    const replayBody = {
      ok: true,
      query_id: '11111111-1111-1111-1111-111111111111',
      script_id: 'script-1',
    };
    const replay = scriptedPool((sql) => {
      if (sql.includes('idempotency_lookup')) {
        return { rows: [{ action: 'replay', response_body: replayBody }] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(replay.pool as never).recordInaccuracy(inaccuracyRequest()))
      .toEqual({ ok: true, response: replayBody });
    expect(JSON.stringify(replay.query.mock.calls)).not.toContain('record_inaccuracy_report');
  });

  it('binds SOP catalog to default product_session_id and maps missing current software', async () => {
    const catalog = scriptedPool((sql, params) => {
      expect(sql).toContain('ops_loop.read_sop_catalog');
      expect(params).toEqual([OPS_LOOP_PRODUCT_SESSION_ID, 'owner']);
      return {
        rows: [{
          node_id: 'n1', parent_node_id: null, title: '停手', body: '先停手',
          sort_key: 0, version: 1, lifecycle: 'active',
        }],
      };
    });
    expect(await createOpsLoopRepository(catalog.pool as never).readSopCatalog(owner)).toEqual({
      ok: true,
      response: {
        product_session_id: 'default',
        items: [{
          node_id: 'n1', parent_node_id: null, title: '停手', body: '先停手',
          sort_key: 0, version: 1, lifecycle: 'active',
        }],
      },
    });
    expect(OPS_LOOP_PRODUCT_SESSION_ID).toBe('default');

    const imported = scriptedPool((sql, params) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
      if (sql.includes('import_sop_catalog')) {
        expect(params?.[0]).toBe('default');
        return { rows: [{ ok: true, product_session_id: 'default', node_count: 1 }] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(imported.pool as never).importSopCatalog(importRequest()))
      .toMatchObject({ ok: true, response: { product_session_id: 'default', node_count: 1 } });

    const missing = scriptedPool((sql) => {
      if (sql.includes('current_software_release')) {
        throw Object.assign(new Error('missing'), { code: 'ZA002', detail: 'NOT_FOUND' });
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(missing.pool as never).currentSoftwareRelease(owner))
      .toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(JSON.stringify(missing.query.mock.calls)).not.toContain('latest.yml');

    const empty = scriptedPool(() => ({ rows: [] }));
    expect(await createOpsLoopRepository(empty.pool as never).currentSoftwareRelease(owner))
      .toEqual({ ok: false, code: 'INTERNAL' });
  });

  it('executes proceed patch, delete, mutate, retrieval, and list against client.query', async () => {
    const patched = scriptedPool((sql, params) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
      if (sql.includes('patch_sop_node')) {
        expect(params).toEqual(['n1', 1, '停手', '先停', 0, 'coach']);
        return { rows: [sopNodeRow] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(patched.pool as never).patchSopNode(patchRequest()))
      .toEqual({ ok: true, response: { ...sopNodeRow, parent_node_id: null } });

    const deleted = scriptedPool((sql, params) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
      if (sql.includes('delete_sop_node')) {
        expect(params).toEqual(['n1', 1, 'owner']);
        return { rows: [{ ...sopNodeRow, version: 3, lifecycle: 'deleted' }] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(deleted.pool as never).deleteSopNode(deleteRequest()))
      .toMatchObject({ ok: true, response: { node_id: 'n1', lifecycle: 'deleted', version: 3 } });

    const mutated = scriptedPool((sql, params) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
      if (sql.includes('mutate_script')) {
        expect(params?.[1]).toBe('delete');
        expect(params?.[8]).toBe('owner');
        return { rows: [{ ok: true, script_id: 'script-1', mutation_id: 'smut_1', review_status: 'approved' }] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(mutated.pool as never).mutateScript(scriptRequest()))
      .toEqual({
        ok: true,
        response: {
          ok: true, script_id: 'script-1', mutation_id: 'smut_1', review_status: 'pending_review',
        },
      });

    const retrieval = scriptedPool((sql, params) => {
      expect(sql).toContain('read_retrieval_metrics');
      expect(params).toEqual(['last_7d', 'owner']);
      return {
        rows: [{
          no_hit_rate: 0.2, copy_complete_rate: 0.4, open_task_count: 2,
          current_release_script_count: 9, metric_window: 'last_7d', release_id: null,
        }],
      };
    });
    expect(await createOpsLoopRepository(retrieval.pool as never).readRetrievalMetrics(owner, 'last_7d'))
      .toEqual({
        ok: true,
        response: {
          no_hit_rate: 0.2, copy_complete_rate: 0.4, open_task_count: 2,
          current_release_script_count: 9, window: 'last_7d', release_id: null,
        },
      });

    const listed = scriptedPool((sql, params) => {
      expect(sql).toContain('list_software_releases');
      expect(params).toEqual(['owner']);
      return { rows: [softwareRow] };
    });
    expect(await createOpsLoopRepository(listed.pool as never).listSoftwareReleases(owner)).toEqual({
      ok: true,
      response: { items: [{ ...softwareRow, signed: true }] },
    });
    expect(JSON.stringify(listed.query.mock.calls)).not.toContain('latest.yml');
  });

  it('replays claimed SOP patches, conflicts claimed deletes, and fail-closes corrupt replay', async () => {
    const replayBody = {
      node_id: 'n1', parent_node_id: null, title: '停手', body: '先停',
      sort_key: 0, version: 2, lifecycle: 'active',
    };
    const replay = scriptedPool((sql) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) {
        return { rows: [{ action: 'replay', response_body: replayBody }] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(replay.pool as never).patchSopNode(patchRequest()))
      .toEqual({ ok: true, response: replayBody });
    expect(JSON.stringify(replay.query.mock.calls)).not.toContain('patch_sop_node');

    const conflict = scriptedPool((sql) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'conflict' }] };
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(conflict.pool as never).deleteSopNode(deleteRequest()))
      .toEqual({ ok: false, code: 'CONFLICT' });
    expect(conflict.release).toHaveBeenCalledWith(false);
    expect(JSON.stringify(conflict.query.mock.calls)).not.toContain('delete_sop_node');

    const corrupt = scriptedPool((sql) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) {
        return { rows: [{ action: 'replay', response_body: { ok: true } }] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(corrupt.pool as never).mutateScript(scriptRequest()))
      .toEqual({ ok: false, code: 'INTERNAL' });
    expect(JSON.stringify(corrupt.query.mock.calls)).not.toContain('mutate_script');
  });

  it('records inaccuracy on proceed, fail-closes rotated hashes, and maps read/timestamp faults', async () => {
    const recorded = scriptedPool((sql, params) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
      if (sql.includes('record_inaccuracy_report')) {
        expect(params).toEqual([
          '11111111-1111-1111-1111-111111111111',
          'script-1',
          1,
          1,
          'a'.repeat(64),
          agent.user_id,
          agent.role,
        ]);
        return { rows: [{ ok: true, query_id: params?.[0], script_id: params?.[1] }] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(recorded.pool as never).recordInaccuracy(inaccuracyRequest()))
      .toEqual({
        ok: true,
        response: {
          ok: true,
          query_id: '11111111-1111-1111-1111-111111111111',
          script_id: 'script-1',
        },
      });

    const rotated = scriptedPool((sql) => {
      if (sql.includes('idempotency_request_hash_version')) {
        return { rows: [{ version: 'hmac-idempotency-v0' }] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(rotated.pool as never).recordInaccuracy(inaccuracyRequest()))
      .toEqual({ ok: false, code: 'INTERNAL' });
    expect(JSON.stringify(rotated.query.mock.calls)).not.toContain('record_inaccuracy_report');

    const noLease = scriptedPool((sql) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed' }] };
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(noLease.pool as never).recordInaccuracy(inaccuracyRequest()))
      .toEqual({ ok: false, code: 'INTERNAL' });
    expect(JSON.stringify(noLease.query.mock.calls)).not.toContain('record_inaccuracy_report');

    const brokenRollback = scriptedPool((sql) => {
      if (sql === 'ROLLBACK') throw new Error('rollback failed');
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'conflict' }] };
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(brokenRollback.pool as never).recordInaccuracy(inaccuracyRequest()))
      .toEqual({ ok: false, code: 'CONFLICT' });
    expect(brokenRollback.release).toHaveBeenCalledWith(true);

    const overloadedRead = { connect: async () => { throw new Error('too many clients'); } };
    expect(await createOpsLoopRepository(overloadedRead as never).readSopCatalog(owner))
      .toEqual({ ok: false, code: 'OVERLOADED' });

    const patchedScript = scriptedPool((sql, params) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 2 }] };
      if (sql.includes('mutate_script')) {
        expect(params?.[1]).toBe('patch');
        expect(params?.[3]).toBe('标题');
        return { rows: [{ ok: true, script_id: 'script-1', mutation_id: 'smut_p', review_status: 'approved' }] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(patchedScript.pool as never).mutateScript({
      ...scriptRequest(),
      action: 'patch',
      title: '标题',
      answerText: '正文',
      effectiveFrom: '2026-09-21T00:00:00.000Z',
    })).toEqual({
      ok: true,
      response: {
        ok: true, script_id: 'script-1', mutation_id: 'smut_p', review_status: 'pending_review',
      },
    });

    const sink = vi.fn(() => {
      throw new Error('sink down');
    });
    const badStamp = scriptedPool((sql) => {
      if (sql.includes('current_software_release')) {
        return { rows: [{ ...softwareRow, created_at: 'not-a-timestamp' }] };
      }
      return { rows: [] };
    });
    expect(await createOpsLoopRepository(badStamp.pool as never, 'api_ops_loop_test', sink)
      .currentSoftwareRelease(owner)).toEqual({ ok: false, code: 'INTERNAL' });
    expect(sink).toHaveBeenCalledWith({ code: 'OPS_LOOP_FAILED' });

    const current = scriptedPool((sql, params) => {
      expect(sql).toContain('current_software_release');
      expect(params).toEqual(['owner']);
      return { rows: [softwareRow] };
    });
    expect(await createOpsLoopRepository(current.pool as never).currentSoftwareRelease(owner))
      .toEqual({ ok: true, response: { ...softwareRow, signed: true } });
  });
});
