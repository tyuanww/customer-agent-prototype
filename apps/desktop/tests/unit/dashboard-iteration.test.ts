import { describe, expect, it } from 'vitest';
import { PRODUCT_ERRORS } from '../../src/shared/product-session';
import {
  ITERATION_COPY,
  dashboardIterationFailure,
  isDashboardIterationCloseRequest,
  isDashboardIterationFailure,
  isDashboardIterationListResult,
  isDashboardIterationStartRequest,
  isDashboardIterationTask,
  isDashboardIterationTaskResult,
  iterationListFromContract,
  iterationTaskFromContract,
} from '../../src/shared/dashboard-iteration';

const contractTask = {
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
  created_at: '2026-09-20T03:14:15.000Z',
  updated_at: '2026-09-20T03:14:15.000Z',
  resolved_at: null,
};

describe('dashboard iteration contract mapping', () => {
  it('maps an empty OpenAPI page and a single task without inventing rows', () => {
    expect(iterationListFromContract({ items: [], next_cursor: null })).toEqual({
      ok: true,
      items: [],
      nextCursor: null,
    });
    expect(iterationTaskFromContract(contractTask)).toMatchObject({
      taskId: 'itask-01J4PF9TQX7G',
      suspectedCause: 'content_gap',
      status: 'open',
      version: 1,
    });
    expect(iterationListFromContract({ items: [{ ...contractTask, extra: true }], next_cursor: null })).not.toBeNull();
  });

  it('rejects ticket-shaped payloads and extra IPC keys', () => {
    expect(iterationTaskFromContract({ ...contractTask, ticket_id: 't-1' })).not.toBeNull();
    expect(iterationTaskFromContract({ ticket_id: 't-1', ...contractTask, task_id: '' })).toBeNull();
    expect(isDashboardIterationListResult({ ok: true, items: [], nextCursor: null, extra: true })).toBe(false);
    expect(isDashboardIterationStartRequest({ taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1 })).toBe(true);
    expect(isDashboardIterationStartRequest({ taskId: 'itask-01J4PF9TQX7G', expectedVersion: 1, extra: true })).toBe(false);
    expect(isDashboardIterationCloseRequest({
      taskId: 'itask-01J4PF9TQX7G',
      expectedVersion: 2,
      status: 'resolved',
      resolutionNote: '已核对',
    })).toBe(true);
    expect(dashboardIterationFailure('UNAVAILABLE').message).toBe(ITERATION_COPY.unavailable);
    expect(dashboardIterationFailure('OVERLOADED').message).toBe(ITERATION_COPY.unavailable);
    expect(dashboardIterationFailure('FORBIDDEN').message).toBe(PRODUCT_ERRORS.FORBIDDEN);
  });

  it('rejects invalid IPC task, list, start, and close shapes', () => {
    const mapped = iterationTaskFromContract(contractTask);
    expect(isDashboardIterationTask(mapped)).toBe(true);
    expect(isDashboardIterationTask({ ...mapped, extra: true })).toBe(false);
    expect(isDashboardIterationTask({ ...mapped, taskId: '' })).toBe(false);
    expect(isDashboardIterationTask({ ...mapped, taskId: 'x'.repeat(129) })).toBe(false);
    expect(isDashboardIterationTask({ ...mapped, version: 0 })).toBe(false);
    expect(isDashboardIterationTask({ ...mapped, sampleQueryIds: ['q-1', 'q-1'] })).toBe(false);
    expect(isDashboardIterationTask({ ...mapped, assigneeRole: '' })).toBe(false);
    expect(isDashboardIterationFailure({
      ok: false, code: 'GONE', message: ITERATION_COPY.missing,
    })).toBe(true);
    expect(isDashboardIterationFailure({
      ok: false, code: 'GONE', message: ITERATION_COPY.missing, extra: true,
    })).toBe(false);
    expect(isDashboardIterationTaskResult({ ok: true, task: mapped })).toBe(true);
    expect(isDashboardIterationTaskResult({ ok: true, task: mapped, extra: true })).toBe(false);
    expect(isDashboardIterationStartRequest({ taskId: 'itask-01J4PF9TQX7G', expectedVersion: 0 })).toBe(false);
    expect(isDashboardIterationCloseRequest({
      taskId: 'itask-01J4PF9TQX7G',
      expectedVersion: 2,
      status: 'open',
      resolutionNote: '已核对',
    })).toBe(false);
    expect(isDashboardIterationCloseRequest({
      taskId: 'itask-01J4PF9TQX7G',
      expectedVersion: 2,
      status: 'resolved',
      resolutionNote: '',
    })).toBe(false);
    expect(isDashboardIterationCloseRequest({
      taskId: 'itask-01J4PF9TQX7G',
      expectedVersion: 2,
      status: 'wont_fix',
      resolutionNote: '已核对',
      extra: true,
    })).toBe(false);
  });

  it('drops unusable contract pages and keeps a valid next_cursor', () => {
    expect(iterationListFromContract({ items: [contractTask], next_cursor: 'abc' })).toEqual({
      ok: true,
      items: [iterationTaskFromContract(contractTask)],
      nextCursor: 'abc',
    });
    expect(iterationListFromContract(null)).toBeNull();
    expect(iterationListFromContract({ items: 'nope', next_cursor: null })).toBeNull();
    expect(iterationListFromContract({ items: [contractTask], next_cursor: '' })).toBeNull();
    expect(iterationListFromContract({
      items: [{ ...contractTask, sample_query_ids: ['q-1', 'q-1'] }],
      next_cursor: null,
    })).toBeNull();
    expect(iterationTaskFromContract(null)).toBeNull();
    expect(iterationTaskFromContract([])).toBeNull();
    expect(iterationTaskFromContract({ ...contractTask, sample_query_ids: [1] })).toBeNull();
    expect(iterationTaskFromContract({ ...contractTask, suspected_cause: 'ticket' })).toBeNull();
  });
});

