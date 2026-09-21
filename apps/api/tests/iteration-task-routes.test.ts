import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../src/app.js';
import type { IterationTaskRepository } from '../src/iteration-task-repository.js';
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
    'hmac-idempotency-v1': 'synthetic-iteration-route-idempotency-key-01',
  }),
});

const openTask = Object.freeze({
  task_id: 'itask-01J4PF9TQX7G',
  signal_id: 'sig-no-hit-shipping',
  cluster_key: 'no_hit:shipping',
  sample_query_ids: ['q-syn-001'],
  suspected_cause: 'content_gap' as const,
  suggested_script_ids: ['script-synthetic-001'],
  status: 'open' as const,
  assignee_role: 'coach',
  resolution: null,
  resolution_note: null,
  version: 1,
  created_at: '2026-09-20T03:14:15.000Z',
  updated_at: '2026-09-20T03:14:15.000Z',
  resolved_at: null,
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

function iterationRepository(): IterationTaskRepository {
  return {
    list: vi.fn<IterationTaskRepository['list']>().mockResolvedValue({
      ok: true,
      response: { items: [], next_cursor: null },
    }),
    start: vi.fn<IterationTaskRepository['start']>().mockResolvedValue({
      ok: true,
      response: { ...openTask, status: 'in_progress', version: 2 },
    }),
    close: vi.fn<IterationTaskRepository['close']>().mockResolvedValue({
      ok: true,
      response: {
        ...openTask,
        status: 'resolved',
        resolution: 'resolved',
        resolution_note: '已核对有效期过滤',
        version: 3,
        resolved_at: '2026-09-20T04:00:00.000Z',
      },
    }),
  };
}

function appWith(repository?: IterationTaskRepository): FastifyInstance {
  const app = createApiApp(
    parseApiRuntimeConfig({
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      CUSTOMER_AGENT_API_PORT: '0',
      CUSTOMER_AGENT_BUILD_VERSION: '0.3.0-iteration-test',
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
    repository === undefined ? undefined : { repository, idempotencyHmac: keyRing },
  );
  openApps.push(app);
  return app;
}

describe('iteration task HTTP routes', () => {
  it('returns an empty list for coach and owner without inventing rows', async () => {
    const repository = iterationRepository();
    const app = appWith(repository);

    const coach = await app.inject({
      method: 'GET', url: '/v1/metrics/iteration-tasks', headers: coachHeaders,
    });
    expect(coach.statusCode).toBe(200);
    expect(coach.headers['cache-control']).toBe('no-store');
    expect(coach.json()).toEqual({ items: [], next_cursor: null });

    const owner = await app.inject({
      method: 'GET', url: '/v1/metrics/iteration-tasks', headers: ownerHeaders,
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.json()).toEqual({ items: [], next_cursor: null });
    expect(repository.list).toHaveBeenCalledTimes(2);
  });

  it('rejects agent with 403 and missing auth with 401 before repository access', async () => {
    const repository = iterationRepository();
    const app = appWith(repository);

    const agentList = await app.inject({
      method: 'GET', url: '/v1/metrics/iteration-tasks', headers: agentHeaders,
    });
    expect(agentList.statusCode).toBe(403);
    expect(agentList.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const missing = await app.inject({ method: 'GET', url: '/v1/metrics/iteration-tasks' });
    expect(missing.statusCode).toBe(401);

    const agentStart = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
      headers: { ...agentHeaders, 'idempotency-key': 'idem-agent-start' },
      payload: { expected_version: 1 },
    });
    expect(agentStart.statusCode).toBe(403);

    const agentClose = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/close',
      headers: { ...agentHeaders, 'idempotency-key': 'idem-agent-close' },
      payload: { expected_version: 2, status: 'resolved', resolution_note: '已核对' },
    });
    expect(agentClose.statusCode).toBe(403);

    const startUnauth = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
      headers: { 'idempotency-key': 'idem-no-auth' },
      payload: { expected_version: 1 },
    });
    expect(startUnauth.statusCode).toBe(401);

    const closeUnauth = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/close',
      payload: { expected_version: 2, status: 'resolved', resolution_note: '已核对' },
    });
    expect(closeUnauth.statusCode).toBe(401);

    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.start).not.toHaveBeenCalled();
    expect(repository.close).not.toHaveBeenCalled();
    expect(JSON.stringify(agentList.json())).not.toContain('ticket');
  });

  it('fails closed to 503 OVERLOADED when the iteration dependency is missing', async () => {
    const app = appWith();
    const list = await app.inject({
      method: 'GET', url: '/v1/metrics/iteration-tasks', headers: coachHeaders,
    });
    expect(list.statusCode).toBe(503);
    expect(list.json()).toEqual({ error: { code: 'OVERLOADED', message: '服务暂不可用' } });

    const start = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-missing-dep' },
      payload: { expected_version: 1 },
    });
    expect(start.statusCode).toBe(503);

    const closed = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/close',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-missing-close' },
      payload: { expected_version: 2, status: 'wont_fix', resolution_note: '样本不足' },
    });
    expect(closed.statusCode).toBe(503);
  });

  it('validates list filters and does not invent inaccuracy-report or ticket routes', async () => {
    const repository = iterationRepository();
    const app = appWith(repository);
    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/metrics/iteration-tasks?status=ticket&limit=0',
      headers: coachHeaders,
    });
    expect(invalid.statusCode).toBe(400);

    const inaccuracy = await app.inject({
      method: 'POST',
      url: '/v1/inaccuracy-reports',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-invented' },
      payload: { query_id: '4d690ef7-a98d-4a56-a9c4-92ae4c52168f', script_id: 'script-1' },
    });
    expect(inaccuracy.statusCode).toBe(503);
    const tickets = await app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: coachHeaders,
    });
    expect(tickets.statusCode).toBe(404);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('starts and closes through the frozen event paths with an idempotency digest', async () => {
    const repository = iterationRepository();
    const app = appWith(repository);

    const missingKey = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
      headers: coachHeaders,
      payload: { expected_version: 1 },
    });
    expect(missingKey.statusCode).toBe(400);

    const started = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-start-001' },
      payload: { expected_version: 1 },
    });
    expect(started.statusCode).toBe(200);
    expect(started.headers['cache-control']).toBe('no-store');
    expect(started.json()).toMatchObject({
      task_id: 'itask-01J4PF9TQX7G',
      status: 'in_progress',
      version: 2,
    });
    const preparedStart = vi.mocked(repository.start).mock.calls[0]?.[0];
    expect(preparedStart?.requestHashes.hashes['hmac-idempotency-v1']).toMatch(/^[0-9a-f]{64}$/);
    expect(preparedStart?.expectedVersion).toBe(1);
    expect(preparedStart?.actor.role).toBe('coach');

    const closed = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/close',
      headers: { ...ownerHeaders, 'idempotency-key': 'idem-close-001' },
      payload: {
        expected_version: 2,
        status: 'resolved',
        resolution_note: '已核对有效期过滤',
      },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({
      status: 'resolved',
      resolution: 'resolved',
      version: 3,
    });
    expect(JSON.stringify(closed.json())).not.toContain('answer_text');
  });

  it('maps repository conflict and not-found to the frozen envelopes', async () => {
    const repository = iterationRepository();
    vi.mocked(repository.start).mockResolvedValueOnce({ ok: false, code: 'CONFLICT' });
    vi.mocked(repository.close).mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const app = appWith(repository);

    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-conflict' },
      payload: { expected_version: 1 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'CONFLICT' } });

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-missing/close',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-missing' },
      payload: {
        expected_version: 2,
        status: 'wont_fix',
        resolution_note: '样本不足',
      },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(missing.body).not.toContain('SQL');
  });

  it('forwards list filters, paginates items, and rate-limits without inventing ticket fields', async () => {
    const repository = iterationRepository();
    vi.mocked(repository.list).mockResolvedValue({
      ok: true,
      response: { items: [openTask], next_cursor: 'next-page' },
    });
    const app = appWith(repository);
    const cursor = Buffer.from('2026-09-20T03:14:15.000Z|itask-01J4PF9TQX7G', 'utf8').toString('base64url');
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/metrics/iteration-tasks?status=open&signal_id=sig-no-hit-shipping&assignee_role=coach&limit=10&cursor=${cursor}`,
      headers: coachHeaders,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ items: [openTask], next_cursor: 'next-page' });
    expect(JSON.stringify(listed.json())).not.toContain('ticket');
    expect(repository.list).toHaveBeenCalledWith({
      limit: 10,
      status: 'open',
      signalId: 'sig-no-hit-shipping',
      assigneeRole: 'coach',
      cursorCreatedAt: '2026-09-20T03:14:15.000Z',
      cursorTaskId: 'itask-01J4PF9TQX7G',
    }, expect.objectContaining({
      role: 'coach',
      user_id: 'usr_synthetic_coach_001',
    }));

    const limited = appWith(iterationRepository());
    let lastStatus = 200;
    for (let index = 0; index < 61; index += 1) {
      lastStatus = (await limited.inject({
        method: 'GET', url: '/v1/metrics/iteration-tasks', headers: coachHeaders,
      })).statusCode;
    }
    expect(lastStatus).toBe(429);
    const limitedBody = await limited.inject({
      method: 'GET', url: '/v1/metrics/iteration-tasks', headers: coachHeaders,
    });
    expect(limitedBody.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', details: { retry_after_sec: 1 } },
    });
    expect(limitedBody.headers['retry-after']).toBe('1');

    const startLimited = appWith(iterationRepository());
    let startStatus = 200;
    for (let index = 0; index < 21; index += 1) {
      startStatus = (await startLimited.inject({
        method: 'POST',
        url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
        headers: { ...coachHeaders, 'idempotency-key': `idem-rate-${index}` },
        payload: { expected_version: 1 },
      })).statusCode;
    }
    expect(startStatus).toBe(429);
  });

  it('rejects invalid list cursors/bodies and maps repository OVERLOADED/INTERNAL', async () => {
    const repository = iterationRepository();
    const app = appWith(repository);
    const badCursor = Buffer.from('not-a-date|itask-01J4PF9TQX7G', 'utf8').toString('base64url');
    const cases = [
      `/v1/metrics/iteration-tasks?cursor=${badCursor}`,
      '/v1/metrics/iteration-tasks?cursor=abc',
      '/v1/metrics/iteration-tasks?signal_id=',
      `/v1/metrics/iteration-tasks?assignee_role=${'c'.repeat(129)}`,
      '/v1/metrics/iteration-tasks?limit=201',
      '/v1/metrics/iteration-tasks?status=open&status=resolved',
      '/v1/metrics/iteration-tasks?cursor=',
    ];
    for (const url of cases) {
      expect((await app.inject({ method: 'GET', url, headers: coachHeaders })).statusCode).toBe(400);
    }
    expect(repository.list).not.toHaveBeenCalled();

    const missingCloseKey = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/close',
      headers: coachHeaders,
      payload: { expected_version: 2, status: 'resolved', resolution_note: '已核对' },
    });
    expect(missingCloseKey.statusCode).toBe(400);

    const emptyKey = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
      headers: { ...coachHeaders, 'idempotency-key': '   ' },
      payload: { expected_version: 1 },
    });
    expect(emptyKey.statusCode).toBe(400);

    const longKey = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/close',
      headers: { ...coachHeaders, 'idempotency-key': 'k'.repeat(256) },
      payload: { expected_version: 2, status: 'resolved', resolution_note: '已核对' },
    });
    expect(longKey.statusCode).toBe(400);

    const invalidStart = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-bad-start' },
      payload: { expected_version: 0 },
    });
    expect(invalidStart.statusCode).toBe(400);

    const invalidClose = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/close',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-bad-close' },
      payload: { expected_version: 2, status: 'open', resolution_note: '已核对' },
    });
    expect(invalidClose.statusCode).toBe(400);

    const extraField = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-extra-start' },
      payload: { expected_version: 1, extra: true },
    });
    expect(extraField.statusCode).toBe(400);
    expect(repository.start).not.toHaveBeenCalled();
    expect(repository.close).not.toHaveBeenCalled();

    vi.mocked(repository.list).mockResolvedValueOnce({ ok: false, code: 'OVERLOADED' });
    vi.mocked(repository.start).mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
    vi.mocked(repository.close).mockResolvedValueOnce({
      ok: true,
      response: {
        ...openTask,
        status: 'wont_fix',
        resolution: 'wont_fix',
        resolution_note: '样本不足',
        version: 3,
        resolved_at: '2026-09-20T04:00:00.000Z',
      },
    });
    const overloaded = await app.inject({
      method: 'GET', url: '/v1/metrics/iteration-tasks', headers: ownerHeaders,
    });
    expect(overloaded.statusCode).toBe(503);
    const internal = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/start',
      headers: { ...coachHeaders, 'idempotency-key': 'idem-internal' },
      payload: { expected_version: 1 },
    });
    expect(internal.statusCode).toBe(500);
    expect(internal.body).not.toContain('SQL');
    const wontFix = await app.inject({
      method: 'POST',
      url: '/v1/events/iteration-tasks/itask-01J4PF9TQX7G/close',
      headers: { ...ownerHeaders, 'idempotency-key': 'idem-wont-fix' },
      payload: { expected_version: 2, status: 'wont_fix', resolution_note: '样本不足' },
    });
    expect(wontFix.statusCode).toBe(200);
    expect(wontFix.json()).toMatchObject({ status: 'wont_fix', resolution: 'wont_fix' });
    expect(JSON.stringify(wontFix.json())).not.toContain('answer_text');
  });
});

