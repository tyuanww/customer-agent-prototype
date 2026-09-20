import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createIterationTaskRepository } from '../src/iteration-task-repository.js';
import type { PreparedIterationTaskClose, PreparedIterationTaskStart } from '../src/iteration-task-repository.js';

const actor = Object.freeze({
  user_id: 'usr_synthetic_coach_001',
  role: 'coach' as const,
  auth_mode: 'mock' as const,
});

const hashes = Object.freeze({
  currentVersion: 'hmac-idempotency-v1',
  hashes: Object.freeze({ 'hmac-idempotency-v1': 'a'.repeat(64) }),
});

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    task_id: 'itask-01J4PF9TQX7G',
    signal_id: 'sig-no-hit-shipping',
    cluster_key: 'no_hit:shipping',
    sample_query_ids: ['q-syn-001'],
    suspected_cause: 'content_gap',
    suggested_script_ids: ['script-synthetic-001'],
    status: 'open',
    assignee_role: 'coach',
    resolution: null,
    resolution_note: null,
    version: 1,
    created_at: new Date('2026-09-20T03:14:15.000Z'),
    updated_at: new Date('2026-09-20T03:14:15.000Z'),
    resolved_at: null,
    ...overrides,
  };
}

function startRequest(): PreparedIterationTaskStart {
  return {
    actor,
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 1,
    idempotencyKey: 'idem-start-001',
    requestHashes: hashes,
  };
}

function closeRequest(): PreparedIterationTaskClose {
  return {
    actor,
    taskId: 'itask-01J4PF9TQX7G',
    expectedVersion: 2,
    status: 'resolved',
    resolutionNote: '已核对有效期过滤',
    idempotencyKey: 'idem-close-001',
    requestHashes: hashes,
  };
}

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

describe('iteration task repository', () => {
  it('lists empty, filtered, and cursor pages without inventing ticket rows', async () => {
    const server = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/server.ts'),
      'utf8',
    );
    expect(server).toContain('createIterationTaskRepository(runtimePool)');

    const empty = scriptedPool((sql, params) => {
      expect(sql).toContain('FROM public.iteration_tasks');
      expect(sql).not.toContain('WHERE');
      expect(params).toEqual([51]);
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(empty.pool as never, 'api_iteration_test').list({
      limit: 50,
    }, actor)).toEqual({ ok: true, response: { items: [], next_cursor: null } });
    expect(empty.release).toHaveBeenCalledWith();

    const newer = taskRow({
      task_id: 'itask-newer',
      created_at: new Date('2026-09-21T00:00:00.000Z'),
      assignee_role: '   ',
      version: '2',
    });
    const older = taskRow({
      task_id: 'itask-older',
      created_at: new Date('2026-09-19T00:00:00.000Z'),
      resolved_at: new Date('2026-09-20T04:00:00.000Z'),
      status: 'resolved',
      resolution: 'resolved',
      resolution_note: '已核对',
    });
    let listSql = '';
    let listParams: unknown[] | undefined;
    const paged = scriptedPool((sql, params) => {
      listSql = sql;
      listParams = params;
      return { rows: [newer, older] };
    });
    const listed = await createIterationTaskRepository(paged.pool as never).list({
      status: 'open',
      signalId: 'sig-no-hit-shipping',
      assigneeRole: 'coach',
      cursorCreatedAt: '2026-09-22T00:00:00.000Z',
      cursorTaskId: 'itask-cursor',
      limit: 1,
    }, actor);
    expect(listSql).toContain('status = $1');
    expect(listSql).toContain('signal_id = $2');
    expect(listSql).toContain('assignee_role = $3');
    expect(listSql).toContain('(created_at, task_id) <');
    expect(listParams).toEqual([
      'open',
      'sig-no-hit-shipping',
      'coach',
      '2026-09-22T00:00:00.000Z',
      'itask-cursor',
      2,
    ]);
    expect(listed).toMatchObject({
      ok: true,
      response: {
        items: [{
          task_id: 'itask-newer',
          assignee_role: null,
          version: 2,
        }],
        next_cursor: Buffer.from('2026-09-21T00:00:00.000Z|itask-newer', 'utf8').toString('base64url'),
      },
    });
    expect(JSON.stringify(listed)).not.toContain('ticket');
  });

  it('maps connect and row-shape failures without leaking SQL or driver text', async () => {
    const sink = vi.fn();
    expect(await createIterationTaskRepository({ connect: async () => null } as never).list(
      { limit: 50 },
      { user_id: 'usr_synthetic_agent_001', role: 'agent', auth_mode: 'mock' },
    )).toEqual({ ok: false, code: 'FORBIDDEN' });

    const overloaded = { connect: async () => { throw new Error('SELECT secret FROM iteration_tasks'); } };
    expect(await createIterationTaskRepository(overloaded as never, 'api_iteration_test', sink).list({
      limit: 50,
    }, actor)).toEqual({ ok: false, code: 'OVERLOADED' });
    expect(sink).not.toHaveBeenCalled();

    const coded = scriptedPool(() => {
      throw Object.assign(new Error('SELECT secret token=driver'), { code: 'XX000' });
    });
    expect(await createIterationTaskRepository(coded.pool as never, 'api_iteration_test', sink).list({
      limit: 10,
    }, actor)).toEqual({ ok: false, code: 'INTERNAL' });
    expect(sink).toHaveBeenCalledWith({ code: 'ITERATION_TASK_FAILED', databaseCode: 'XX000' });
    expect(JSON.stringify(sink.mock.calls)).not.toContain('secret');

    const transport = scriptedPool(() => {
      throw Object.assign(new Error('SELECT secret token=driver'), { code: '08006' });
    });
    expect(await createIterationTaskRepository(transport.pool as never, 'api_iteration_test', sink).list({
      limit: 10,
    }, actor)).toEqual({ ok: false, code: 'OVERLOADED' });
    expect(transport.release).toHaveBeenCalledWith();
    expect(sink).toHaveBeenCalledTimes(1);

    const brokenSink = vi.fn(() => {
      throw new Error('sink down');
    });
    const malformed = scriptedPool(() => ({
      rows: [taskRow({ sample_query_ids: 'not-an-array', created_at: 'not-a-date' })],
    }));
    expect(await createIterationTaskRepository(
      malformed.pool as never,
      'api_iteration_test',
      brokenSink,
    ).list({ limit: 10 }, actor)).toEqual({ ok: false, code: 'INTERNAL' });
    expect(brokenSink).toHaveBeenCalledWith({ code: 'ITERATION_TASK_FAILED' });
    expect(JSON.stringify(brokenSink.mock.calls)).not.toContain('not-an-array');

    const tooMany = scriptedPool(() => ({
      rows: [taskRow({
        sample_query_ids: Array.from({ length: 51 }, (_, index) => `q-${index}`),
      })],
    }));
    expect(await createIterationTaskRepository(tooMany.pool as never).list({ limit: 10 }, actor)).toEqual({
      ok: false,
      code: 'INTERNAL',
    });

    const nonString = scriptedPool(() => ({
      rows: [taskRow({ suggested_script_ids: [1] })],
    }));
    expect(await createIterationTaskRepository(nonString.pool as never).list({ limit: 10 }, actor)).toEqual({
      ok: false,
      code: 'INTERNAL',
    });
  });

  it('starts and closes through idempotency proceed, replay, conflict, and SQL errors', async () => {
    const startedRow = taskRow({ status: 'in_progress', version: 2 });
    const proceed = scriptedPool((sql) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
      if (sql.includes('start_iteration_task')) return { rows: [startedRow] };
      if (sql.includes('close_iteration_task')) {
        return { rows: [taskRow({
          status: 'resolved',
          resolution: 'resolved',
          resolution_note: '已核对有效期过滤',
          version: 3,
          resolved_at: new Date('2026-09-20T04:00:00.000Z'),
        })] };
      }
      return { rows: [] };
    });
    const repository = createIterationTaskRepository(proceed.pool as never, 'api_iteration_test');
    expect(await repository.start(startRequest())).toMatchObject({
      ok: true,
      response: { task_id: 'itask-01J4PF9TQX7G', status: 'in_progress', version: 2 },
    });
    expect(proceed.query).toHaveBeenCalledWith(
      expect.stringContaining('start_iteration_task'),
      ['itask-01J4PF9TQX7G', 1, actor.user_id, 'coach'],
    );
    expect(await repository.close(closeRequest())).toMatchObject({
      ok: true,
      response: { status: 'resolved', resolution: 'resolved', version: 3 },
    });
    expect(JSON.stringify(proceed.query.mock.calls)).not.toContain('answer_text');

    const replayBody = {
      task_id: 'itask-01J4PF9TQX7G',
      signal_id: 'sig-no-hit-shipping',
      cluster_key: 'no_hit:shipping',
      sample_query_ids: ['q-syn-001'],
      suspected_cause: 'content_gap',
      suggested_script_ids: ['script-synthetic-001'],
      status: 'in_progress',
      assignee_role: 'coach',
      resolution: null,
      resolution_note: null,
      version: 2,
      created_at: '2026-09-20T03:14:15.000Z',
      updated_at: '2026-09-20T03:20:00.000Z',
      resolved_at: null,
    };
    const replay = scriptedPool((sql) => {
      if (sql.includes('idempotency_lookup')) {
        return { rows: [{ action: 'replay', response_body: replayBody }] };
      }
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(replay.pool as never).start(startRequest())).toMatchObject({
      ok: true,
      response: { status: 'in_progress', version: 2 },
    });
    expect(JSON.stringify(replay.query.mock.calls)).not.toContain('start_iteration_task');

    const corrupt = scriptedPool((sql) => {
      if (sql.includes('idempotency_lookup')) {
        return { rows: [{ action: 'replay', response_body: { ticket_id: 't-1' } }] };
      }
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(corrupt.pool as never).start(startRequest())).toEqual({
      ok: false,
      code: 'INTERNAL',
    });

    const conflict = scriptedPool((sql) => {
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'conflict' }] };
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(conflict.pool as never).start(startRequest())).toEqual({
      ok: false,
      code: 'CONFLICT',
    });
    expect(conflict.release).toHaveBeenCalledWith(false);

    const missingHash = scriptedPool((sql) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: 'hmac-unknown' }] };
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(missingHash.pool as never).start(startRequest())).toEqual({
      ok: false,
      code: 'INTERNAL',
    });

    const claimReplay = scriptedPool((sql) => {
      if (sql.includes('idempotency_request_hash_version')) return { rows: [{ version: null }] };
      if (sql.includes('idempotency_lookup')) return { rows: [{ action: 'miss' }] };
      if (sql.includes('idempotency_claim')) {
        return { rows: [{ action: 'replay', response_body: replayBody }] };
      }
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(claimReplay.pool as never).start(startRequest())).toMatchObject({
      ok: true,
      response: { status: 'in_progress' },
    });

    const claimConflict = scriptedPool((sql) => {
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'conflict' }] };
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(claimConflict.pool as never).start(startRequest())).toEqual({
      ok: false,
      code: 'CONFLICT',
    });

    const claimMiss = scriptedPool((sql) => {
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'miss' }] };
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(claimMiss.pool as never).start(startRequest())).toEqual({
      ok: false,
      code: 'INTERNAL',
    });

    const emptyRow = scriptedPool((sql) => {
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
      if (sql.includes('start_iteration_task')) return { rows: [] };
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(emptyRow.pool as never).start(startRequest())).toEqual({
      ok: false,
      code: 'INTERNAL',
    });

    const notFound = scriptedPool((sql) => {
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
      if (sql.includes('start_iteration_task')) {
        throw Object.assign(new Error('missing'), { code: 'ZA002', detail: 'NOT_FOUND' });
      }
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(notFound.pool as never).start(startRequest())).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    const pgConflict = scriptedPool((sql) => {
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
      if (sql.includes('close_iteration_task')) {
        throw Object.assign(new Error('cas'), { code: 'ZA003', detail: 'CONFLICT' });
      }
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(pgConflict.pool as never).close(closeRequest())).toEqual({
      ok: false,
      code: 'CONFLICT',
    });

    const brokenRollback = scriptedPool((sql) => {
      if (sql === 'ROLLBACK') throw new Error('rollback failed');
      if (sql.includes('idempotency_claim')) return { rows: [{ action: 'proceed', lease_version: 1 }] };
      if (sql.includes('start_iteration_task')) {
        throw Object.assign(new Error('cas'), { code: 'ZA003' });
      }
      return { rows: [] };
    });
    expect(await createIterationTaskRepository(brokenRollback.pool as never).start(startRequest())).toEqual({
      ok: false,
      code: 'CONFLICT',
    });
    expect(brokenRollback.release).toHaveBeenCalledWith(true);

    const connectFail = { connect: async () => { throw new Error('exhausted'); } };
    expect(await createIterationTaskRepository(connectFail as never).start(startRequest())).toEqual({
      ok: false,
      code: 'OVERLOADED',
    });
    expect(await createIterationTaskRepository(connectFail as never).close(closeRequest())).toEqual({
      ok: false,
      code: 'OVERLOADED',
    });
  });
});
