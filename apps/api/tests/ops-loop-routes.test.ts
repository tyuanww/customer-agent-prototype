import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../src/app.js';
import type { OpsLoopRepository } from '../src/ops-loop-repository.js';
import { parseApiRuntimeConfig } from '../src/runtime-config.js';
import { unavailableContentImportRepository } from '../src/content-import-repository.js';
import type { ServiceRepository } from '../src/service-repository.js';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

const coachHeaders = {
  'x-mock-user': 'usr_synthetic_coach_001',
  'x-mock-role': 'coach',
};

const ownerHeaders = {
  'x-mock-user': 'usr_synthetic_owner_001',
  'x-mock-role': 'owner',
};

const agentHeaders = {
  'x-mock-user': 'usr_synthetic_agent_001',
  'x-mock-role': 'agent',
};

const keyRing = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  keys: Object.freeze({
    'hmac-idempotency-v1': 'synthetic-ops-loop-route-idempotency-key-01',
  }),
});

function serviceRepository(): ServiceRepository {
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

function repository(): OpsLoopRepository {
  return {
    recordInaccuracy: vi.fn<OpsLoopRepository['recordInaccuracy']>().mockResolvedValue({
      ok: true,
      response: {
        ok: true,
        query_id: '11111111-1111-1111-1111-111111111111',
        script_id: 'script-1',
      },
    }),
    readSopCatalog: vi.fn<OpsLoopRepository['readSopCatalog']>().mockResolvedValue({
      ok: true,
      response: { product_session_id: 'default', items: [] },
    }),
    importSopCatalog: vi.fn<OpsLoopRepository['importSopCatalog']>().mockResolvedValue({
      ok: true,
      response: { ok: true, product_session_id: 'default', node_count: 1 },
    }),
    patchSopNode: vi.fn<OpsLoopRepository['patchSopNode']>().mockResolvedValue({
      ok: true,
      response: {
        node_id: 'n1', parent_node_id: null, title: '停手', body: '先停',
        sort_key: 0, version: 2, lifecycle: 'active',
      },
    }),
    deleteSopNode: vi.fn<OpsLoopRepository['deleteSopNode']>().mockResolvedValue({
      ok: true,
      response: {
        node_id: 'n1', parent_node_id: null, title: '停手', body: '先停',
        sort_key: 0, version: 3, lifecycle: 'deleted',
      },
    }),
    mutateScript: vi.fn<OpsLoopRepository['mutateScript']>().mockResolvedValue({
      ok: true,
      response: {
        ok: true, script_id: 'script-1', mutation_id: 'smut_1', review_status: 'pending_review',
      },
    }),
    readRetrievalMetrics: vi.fn<OpsLoopRepository['readRetrievalMetrics']>().mockResolvedValue({
      ok: true,
      response: {
        no_hit_rate: 0.1,
        copy_complete_rate: 0.2,
        open_task_count: 1,
        current_release_script_count: 10,
        window: 'current_release',
        release_id: 'rel_1',
      },
    }),
    listSoftwareReleases: vi.fn<OpsLoopRepository['listSoftwareReleases']>().mockResolvedValue({
      ok: true,
      response: { items: [] },
    }),
    currentSoftwareRelease: vi.fn<OpsLoopRepository['currentSoftwareRelease']>().mockResolvedValue({
      ok: false,
      code: 'NOT_FOUND',
    }),
  };
}

const sopBoundary = '----ops-loop';
const sopContentType = `multipart/form-data; boundary=${sopBoundary}`;

function sopMultipart(csv: string, field = 'file'): Buffer {
  return Buffer.concat([
    Buffer.from(`--${sopBoundary}\r\nContent-Disposition: form-data; name="${field}"; filename="sop.csv"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.from(csv),
    Buffer.from(`\r\n--${sopBoundary}--\r\n`),
  ]);
}

function appWith(ops?: OpsLoopRepository): FastifyInstance {
  const app = createApiApp(
    parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_API_PORT: '0',
      CUSTOMER_AGENT_BUILD_VERSION: '0.3.0-ops-loop-test',
    }),
    serviceRepository(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    ops === undefined ? undefined : { repository: ops, idempotencyHmac: keyRing },
  );
  openApps.push(app);
  return app;
}

describe('ops-loop HTTP routes', () => {
  it('records inaccuracy for agent and rejects missing idempotency', async () => {
    const ops = repository();
    const app = appWith(ops);
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/inaccuracy-reports',
      headers: { ...agentHeaders, 'content-type': 'application/json' },
      payload: { query_id: '11111111-1111-1111-1111-111111111111', script_id: 'script-1' },
    });
    expect(missing.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/inaccuracy-reports',
      headers: { ...agentHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-1' },
      payload: { query_id: '11111111-1111-1111-1111-111111111111', script_id: 'script-1' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      ok: true,
      query_id: '11111111-1111-1111-1111-111111111111',
      script_id: 'script-1',
    });
    expect(ops.recordInaccuracy).toHaveBeenCalledOnce();
  });

  it('keeps SOP catalog coach-readable and agent-forbidden', async () => {
    const ops = repository();
    const app = appWith(ops);
    const agent = await app.inject({ method: 'GET', url: '/v1/sop/catalog', headers: agentHeaders });
    expect(agent.statusCode).toBe(403);
    const coach = await app.inject({ method: 'GET', url: '/v1/sop/catalog', headers: coachHeaders });
    expect(coach.statusCode).toBe(200);
    expect(coach.json()).toEqual({ product_session_id: 'default', items: [] });
  });

  it('keeps software catalog and script mutate owner-only', async () => {
    const ops = repository();
    const app = appWith(ops);
    const coachList = await app.inject({
      method: 'GET', url: '/v1/software/releases', headers: coachHeaders,
    });
    expect(coachList.statusCode).toBe(403);
    const ownerList = await app.inject({
      method: 'GET', url: '/v1/software/releases', headers: ownerHeaders,
    });
    expect(ownerList.statusCode).toBe(200);
    expect(ownerList.json()).toEqual({ items: [] });

    const coachPatch = await app.inject({
      method: 'PATCH',
      url: '/v1/content/scripts/script-1',
      headers: { ...coachHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-p' },
      payload: {
        expected_version: 1,
        title: '标题',
        answer_text: '正文',
        effective_from: '2026-09-21T00:00:00.000Z',
      },
    });
    expect(coachPatch.statusCode).toBe(403);

    const ownerPatch = await app.inject({
      method: 'PATCH',
      url: '/v1/content/scripts/script-1',
      headers: { ...ownerHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-p2' },
      payload: {
        expected_version: 1,
        title: '标题',
        answer_text: '正文',
        effective_from: '2026-09-21T00:00:00.000Z',
      },
    });
    expect(ownerPatch.statusCode).toBe(200);
    expect(ownerPatch.json()).toMatchObject({ review_status: 'pending_review' });
  });

  it('returns retrieval metrics for coach and 503 when the repository is not wired', async () => {
    const ops = repository();
    const app = appWith(ops);
    const coach = await app.inject({
      method: 'GET', url: '/v1/metrics/retrieval?window=current_release', headers: coachHeaders,
    });
    expect(coach.statusCode).toBe(200);
    expect(coach.json()).toMatchObject({ window: 'current_release', no_hit_rate: 0.1 });

    const unwired = appWith();
    const missing = await unwired.inject({
      method: 'GET', url: '/v1/metrics/retrieval?window=last_7d', headers: ownerHeaders,
    });
    expect(missing.statusCode).toBe(503);
  });

  it('rejects unauthenticated and non-UUID inaccuracy, then surfaces idempotency conflict', async () => {
    const ops = repository();
    const app = appWith(ops);
    const unsigned = await app.inject({
      method: 'POST',
      url: '/v1/inaccuracy-reports',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-u' },
      payload: { query_id: '11111111-1111-1111-1111-111111111111', script_id: 'script-1' },
    });
    expect(unsigned.statusCode).toBe(401);
    expect(ops.recordInaccuracy).not.toHaveBeenCalled();

    const localId = await app.inject({
      method: 'POST',
      url: '/v1/inaccuracy-reports',
      headers: { ...agentHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-local' },
      payload: { query_id: 'local-query', script_id: 'script-1' },
    });
    expect(localId.statusCode).toBe(400);
    expect(ops.recordInaccuracy).not.toHaveBeenCalled();

    vi.mocked(ops.recordInaccuracy).mockResolvedValueOnce({ ok: false, code: 'CONFLICT' });
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/inaccuracy-reports',
      headers: { ...agentHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-conflict' },
      payload: { query_id: '11111111-1111-1111-1111-111111111111', script_id: 'script-1' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    expect(ops.recordInaccuracy).toHaveBeenCalledOnce();
  });

  it('rejects invalid SOP CSV and agent import, then accepts a coach tree bound to default', async () => {
    const ops = repository();
    const app = appWith(ops);
    const csv = 'node_id,parent_node_id,title,body,sort_key\nn1,,停手,先停手,0\n';
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/sop/import',
      headers: {
        ...coachHeaders,
        'content-type': sopContentType,
        'idempotency-key': 'idem-bad-csv',
      },
      payload: sopMultipart('node_id,title\nn1,停手\n'),
    });
    expect(invalid.statusCode).toBe(400);
    expect(ops.importSopCatalog).not.toHaveBeenCalled();

    const agent = await app.inject({
      method: 'POST',
      url: '/v1/sop/import',
      headers: {
        ...agentHeaders,
        'content-type': sopContentType,
        'idempotency-key': 'idem-agent-import',
      },
      payload: sopMultipart(csv),
    });
    expect(agent.statusCode).toBe(403);
    expect(ops.importSopCatalog).not.toHaveBeenCalled();

    const imported = await app.inject({
      method: 'POST',
      url: '/v1/sop/import',
      headers: {
        ...coachHeaders,
        'content-type': sopContentType,
        'idempotency-key': 'idem-import',
      },
      payload: sopMultipart(csv),
    });
    expect(imported.statusCode).toBe(202);
    expect(imported.json()).toEqual({ ok: true, product_session_id: 'default', node_count: 1 });
    expect(ops.importSopCatalog).toHaveBeenCalledOnce();
    expect(vi.mocked(ops.importSopCatalog).mock.calls[0]?.[0]).toMatchObject({
      nodes: [{ node_id: 'n1', parent_node_id: null, title: '停手', body: '先停手', sort_key: 0 }],
    });
  });

  it('keeps SOP delete and software current owner-only, mapping missing current to NOT_FOUND', async () => {
    const ops = repository();
    const app = appWith(ops);
    const coachDelete = await app.inject({
      method: 'DELETE',
      url: '/v1/sop/nodes/n1',
      headers: { ...coachHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-sd' },
      payload: { expected_version: 1 },
    });
    expect(coachDelete.statusCode).toBe(403);
    expect(ops.deleteSopNode).not.toHaveBeenCalled();

    const ownerDelete = await app.inject({
      method: 'DELETE',
      url: '/v1/sop/nodes/n1',
      headers: { ...ownerHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-sd2' },
      payload: { expected_version: 1 },
    });
    expect(ownerDelete.statusCode).toBe(200);
    expect(ownerDelete.json()).toMatchObject({ node_id: 'n1', lifecycle: 'deleted' });

    const coachCurrent = await app.inject({
      method: 'GET', url: '/v1/software/releases/current', headers: coachHeaders,
    });
    expect(coachCurrent.statusCode).toBe(403);
    expect(ops.currentSoftwareRelease).not.toHaveBeenCalled();

    const ownerCurrent = await app.inject({
      method: 'GET', url: '/v1/software/releases/current', headers: ownerHeaders,
    });
    expect(ownerCurrent.statusCode).toBe(404);
    expect(ownerCurrent.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(JSON.stringify(ownerCurrent.json())).not.toContain('latest.yml');

    const badWindow = await app.inject({
      method: 'GET', url: '/v1/metrics/retrieval?window=all_time', headers: coachHeaders,
    });
    expect(badWindow.statusCode).toBe(400);
    expect(ops.readRetrievalMetrics).not.toHaveBeenCalled();
  });

  it('keeps script delete owner-only and returns pending_review without bypassing dual-review', async () => {
    const ops = repository();
    const app = appWith(ops);
    const coach = await app.inject({
      method: 'DELETE',
      url: '/v1/content/scripts/script-1',
      headers: { ...coachHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-sdel' },
      payload: { expected_version: 1 },
    });
    expect(coach.statusCode).toBe(403);
    expect(ops.mutateScript).not.toHaveBeenCalled();

    const owner = await app.inject({
      method: 'DELETE',
      url: '/v1/content/scripts/script-1',
      headers: { ...ownerHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-sdel2' },
      payload: { expected_version: 1 },
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.json()).toEqual({
      ok: true, script_id: 'script-1', mutation_id: 'smut_1', review_status: 'pending_review',
    });
    expect(vi.mocked(ops.mutateScript).mock.calls[0]?.[0]).toMatchObject({
      action: 'delete', scriptId: 'script-1', expectedVersion: 1,
    });

    const agentPatch = await app.inject({
      method: 'PATCH',
      url: '/v1/sop/nodes/n1',
      headers: { ...agentHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-sp' },
      payload: { expected_version: 1, title: '停手' },
    });
    expect(agentPatch.statusCode).toBe(403);
  });

  it('returns RATE_LIMITED 429 for inaccuracy bursts and OVERLOADED 503 when unwired', async () => {
    const unwired = appWith();
    const missing = await unwired.inject({
      method: 'POST',
      url: '/v1/inaccuracy-reports',
      headers: { ...agentHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-unwired' },
      payload: { query_id: '11111111-1111-1111-1111-111111111111', script_id: 'script-1' },
    });
    expect(missing.statusCode).toBe(503);
    expect(missing.json()).toMatchObject({ error: { code: 'OVERLOADED' } });
    expect(missing.headers['retry-after']).toBe('1');

    const ops = repository();
    const app = appWith(ops);
    const payload = { query_id: '11111111-1111-1111-1111-111111111111', script_id: 'script-1' };
    for (let index = 0; index < 30; index += 1) {
      const allowed = await app.inject({
        method: 'POST',
        url: '/v1/inaccuracy-reports',
        headers: {
          ...agentHeaders,
          'content-type': 'application/json',
          'idempotency-key': `idem-rate-${index}`,
        },
        payload,
      });
      expect(allowed.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/v1/inaccuracy-reports',
      headers: {
        ...agentHeaders,
        'content-type': 'application/json',
        'idempotency-key': 'idem-rate-30',
      },
      payload,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', details: { retry_after_sec: 1 } },
    });
    expect(limited.headers['retry-after']).toBe('1');
    expect(ops.recordInaccuracy).toHaveBeenCalledTimes(30);
  });

  it('maps SOP catalog 401, unwired 503, and coach 429', async () => {
    const ops = repository();
    const app = appWith(ops);
    const unsigned = await app.inject({ method: 'GET', url: '/v1/sop/catalog' });
    expect(unsigned.statusCode).toBe(401);
    expect(unsigned.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    expect(ops.readSopCatalog).not.toHaveBeenCalled();

    const unwired = appWith();
    const missing = await unwired.inject({
      method: 'GET', url: '/v1/sop/catalog', headers: coachHeaders,
    });
    expect(missing.statusCode).toBe(503);
    expect(missing.json()).toMatchObject({ error: { code: 'OVERLOADED' } });

    for (let index = 0; index < 60; index += 1) {
      const allowed = await app.inject({
        method: 'GET', url: '/v1/sop/catalog', headers: coachHeaders,
      });
      expect(allowed.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: 'GET', url: '/v1/sop/catalog', headers: coachHeaders,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(limited.headers['retry-after']).toBe('1');
    expect(ops.readSopCatalog).toHaveBeenCalledTimes(60);
  });

  it('rejects SOP import without name=file, oversize body, or Idempotency-Key', async () => {
    const ops = repository();
    const app = appWith(ops);
    const csv = 'node_id,parent_node_id,title,body,sort_key\nn1,,停手,先停手,0\n';
    const missingKey = await app.inject({
      method: 'POST',
      url: '/v1/sop/import',
      headers: { ...coachHeaders, 'content-type': sopContentType },
      payload: sopMultipart(csv),
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ error: { code: 'VALIDATION' } });

    const wrongField = await app.inject({
      method: 'POST',
      url: '/v1/sop/import',
      headers: {
        ...coachHeaders,
        'content-type': sopContentType,
        'idempotency-key': 'idem-wrong-field',
      },
      payload: sopMultipart(csv, 'csv'),
    });
    expect(wrongField.statusCode).toBe(400);
    expect(wrongField.json()).toMatchObject({ error: { code: 'VALIDATION' } });

    const oversized = await app.inject({
      method: 'POST',
      url: '/v1/sop/import',
      headers: {
        ...coachHeaders,
        'content-type': sopContentType,
        'idempotency-key': 'idem-oversize',
      },
      payload: sopMultipart(`${'n'.repeat(256 * 1024)},,停手,先停手,0\n`),
    });
    expect(oversized.statusCode).toBe(400);
    expect(oversized.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    expect(ops.importSopCatalog).not.toHaveBeenCalled();
  });

  it('patches SOP nodes for coach with expected_version', async () => {
    const ops = repository();
    const app = appWith(ops);
    const patched = await app.inject({
      method: 'PATCH',
      url: '/v1/sop/nodes/n1',
      headers: { ...coachHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-coach-patch' },
      payload: { expected_version: 7, title: '停手', body: '先停' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      node_id: 'n1', version: 2, lifecycle: 'active', title: '停手',
    });
    expect(ops.patchSopNode).toHaveBeenCalledOnce();
    expect(vi.mocked(ops.patchSopNode).mock.calls[0]?.[0]).toMatchObject({
      nodeId: 'n1', expectedVersion: 7, title: '停手', body: '先停',
    });
  });

  it('returns the signed current software release for owner', async () => {
    const ops = repository();
    const current = {
      version: '0.3.17',
      platform: 'mac-universal' as const,
      sha256: 'a'.repeat(64),
      download_url: 'https://example.com/app.dmg',
      created_at: '2026-09-21T00:00:00.000Z',
      signed: true,
    };
    vi.mocked(ops.currentSoftwareRelease).mockResolvedValueOnce({ ok: true, response: current });
    const app = appWith(ops);
    const ownerCurrent = await app.inject({
      method: 'GET', url: '/v1/software/releases/current', headers: ownerHeaders,
    });
    expect(ownerCurrent.statusCode).toBe(200);
    expect(ownerCurrent.json()).toEqual(current);
    expect(JSON.stringify(ownerCurrent.json())).not.toContain('latest.yml');
    expect(ops.currentSoftwareRelease).toHaveBeenCalledOnce();
  });

  it('rejects SOP import without auth, content-type, or a wired repository, and parses a quoted boundary', async () => {
    const ops = repository();
    const app = appWith(ops);
    const csv = 'node_id,parent_node_id,title,body,sort_key\nn1,,停手,先停手,0\n';
    const unsigned = await app.inject({
      method: 'POST',
      url: '/v1/sop/import',
      headers: { 'content-type': sopContentType, 'idempotency-key': 'idem-unauth' },
      payload: sopMultipart(csv),
    });
    expect(unsigned.statusCode).toBe(401);
    expect(ops.importSopCatalog).not.toHaveBeenCalled();

    const missingType = await app.inject({
      method: 'POST',
      url: '/v1/sop/import',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-no-type' },
      payload: sopMultipart(csv),
    });
    expect(missingType.statusCode).toBe(400);
    expect(missingType.json()).toMatchObject({ error: { code: 'VALIDATION' } });

    const quotedToken = '----ops-quoted';
    const quoted = await app.inject({
      method: 'POST',
      url: '/v1/sop/import',
      headers: {
        ...coachHeaders,
        'content-type': `multipart/form-data; boundary="${quotedToken}"`,
        'idempotency-key': 'idem-quoted',
      },
      payload: Buffer.concat([
        Buffer.from(`--${quotedToken}\r\nContent-Disposition: form-data; name="file"; filename="sop.csv"\r\nContent-Type: text/csv\r\n\r\n`),
        Buffer.from(csv),
        Buffer.from(`\r\n--${quotedToken}--\r\n`),
      ]),
    });
    expect(quoted.statusCode).toBe(202);
    expect(quoted.json()).toEqual({ ok: true, product_session_id: 'default', node_count: 1 });
    expect(ops.importSopCatalog).toHaveBeenCalledOnce();

    const unwired = appWith();
    const missing = await unwired.inject({
      method: 'POST',
      url: '/v1/sop/import',
      headers: {
        ...coachHeaders,
        'content-type': sopContentType,
        'idempotency-key': 'idem-import-unwired',
      },
      payload: sopMultipart(csv),
    });
    expect(missing.statusCode).toBe(503);
    expect(missing.json()).toMatchObject({ error: { code: 'OVERLOADED' } });
  });

  it('forwards inaccuracy optionals, rejects SOP patch without a key or id, and keeps retrieval signed-in', async () => {
    const ops = repository();
    const app = appWith(ops);
    const recorded = await app.inject({
      method: 'POST',
      url: '/v1/inaccuracy-reports',
      headers: { ...agentHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-opt' },
      payload: {
        query_id: '11111111-1111-1111-1111-111111111111',
        script_id: 'script-1',
        script_version: 3,
        rank: 2,
        content_hash: 'b'.repeat(64),
      },
    });
    expect(recorded.statusCode).toBe(200);
    expect(vi.mocked(ops.recordInaccuracy).mock.calls[0]?.[0]).toMatchObject({
      scriptVersion: 3, rank: 2, contentHash: 'b'.repeat(64),
    });

    const missingKey = await app.inject({
      method: 'PATCH',
      url: '/v1/sop/nodes/n1',
      headers: { ...coachHeaders, 'content-type': 'application/json' },
      payload: { expected_version: 1, title: '停手' },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(ops.patchSopNode).not.toHaveBeenCalled();

    const invalidBody = await app.inject({
      method: 'PATCH',
      url: '/v1/sop/nodes/n1',
      headers: { ...coachHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-body' },
      payload: { title: '停手' },
    });
    expect(invalidBody.statusCode).toBe(400);
    expect(ops.patchSopNode).not.toHaveBeenCalled();

    const unsigned = await app.inject({ method: 'GET', url: '/v1/metrics/retrieval?window=last_7d' });
    expect(unsigned.statusCode).toBe(401);
    const agent = await app.inject({
      method: 'GET', url: '/v1/metrics/retrieval?window=last_7d', headers: agentHeaders,
    });
    expect(agent.statusCode).toBe(403);
    expect(ops.readRetrievalMetrics).not.toHaveBeenCalled();
  });
});
