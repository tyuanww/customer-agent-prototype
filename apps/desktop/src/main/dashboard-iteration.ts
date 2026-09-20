import { randomUUID } from 'node:crypto';
import {
  dashboardIterationFailure,
  isDashboardIterationCloseRequest,
  isDashboardIterationStartRequest,
  iterationListFromContract,
  iterationTaskFromContract,
  ITERATION_COPY,
  type DashboardIterationFailure,
  type DashboardIterationListResult,
  type DashboardIterationTask,
  type DashboardIterationTaskResult,
} from '../shared/dashboard-iteration';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';

export type DashboardIterationSessionClient = Pick<ProductSession, 'view' | 'request'>;

function asFailure(error: unknown): DashboardIterationFailure {
  if (!(error instanceof ProductHttpError)) return dashboardIterationFailure('UNAVAILABLE');
  if (error.code === 'SOURCE_GATE_NOT_READY' || error.code === 'CLIPBOARD_FAILED') {
    return dashboardIterationFailure('UNAVAILABLE');
  }
  if (error.code === 'GONE') return dashboardIterationFailure('GONE', ITERATION_COPY.missing);
  if (error.code === 'CONFLICT') return dashboardIterationFailure('CONFLICT', ITERATION_COPY.conflict);
  if (error.code === 'UNAVAILABLE' || error.code === 'OVERLOADED') {
    return dashboardIterationFailure(error.code, ITERATION_COPY.unavailable);
  }
  return dashboardIterationFailure(error.code);
}

async function withCoachSession<T>(
  session: DashboardIterationSessionClient | null,
  work: (client: DashboardIterationSessionClient, epoch: number) => Promise<T | DashboardIterationFailure>,
): Promise<T | DashboardIterationFailure> {
  if (!session) return dashboardIterationFailure('UNAVAILABLE', ITERATION_COPY.noProduct);
  const view = session.view();
  if (!view.enabled) return dashboardIterationFailure('UNAVAILABLE', ITERATION_COPY.noProduct);
  if (!view.signedIn || view.role === null) {
    return dashboardIterationFailure('UNAUTHORIZED', ITERATION_COPY.noSession);
  }
  if (view.role !== 'coach' && view.role !== 'owner') {
    return dashboardIterationFailure('FORBIDDEN', ITERATION_COPY.agent);
  }
  try {
    return await work(session, view.sessionEpoch);
  } catch (error) {
    return asFailure(error);
  }
}

export async function dashboardIterationList(
  session: DashboardIterationSessionClient | null,
): Promise<DashboardIterationListResult> {
  return withCoachSession(session, async (client, epoch) => {
    const items: DashboardIterationTask[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const path = cursor === null
        ? '/v1/metrics/iteration-tasks?limit=50'
        : `/v1/metrics/iteration-tasks?limit=50&cursor=${encodeURIComponent(cursor)}`;
      const result = await client.request(epoch, path);
      const parsed = iterationListFromContract(result.value);
      if (!parsed) return dashboardIterationFailure('UNAVAILABLE');
      items.push(...parsed.items);
      if (parsed.nextCursor === null) {
        return Object.freeze({ ok: true as const, items: Object.freeze(items), nextCursor: null });
      }
      cursor = parsed.nextCursor;
    }
    return Object.freeze({ ok: true as const, items: Object.freeze(items), nextCursor: null });
  });
}

export async function dashboardIterationStart(
  session: DashboardIterationSessionClient | null,
  payload: unknown,
): Promise<DashboardIterationTaskResult> {
  if (!isDashboardIterationStartRequest(payload)) return dashboardIterationFailure('VALIDATION');
  return withCoachSession(session, async (client, epoch) => {
    const result = await client.request(
      epoch,
      `/v1/events/iteration-tasks/${encodeURIComponent(payload.taskId)}/start`,
      {
        body: { expected_version: payload.expectedVersion },
        headers: { 'idempotency-key': randomUUID() },
      },
    );
    const task = iterationTaskFromContract(result.value);
    if (!task) return dashboardIterationFailure('UNAVAILABLE');
    return Object.freeze({ ok: true, task });
  });
}

export async function dashboardIterationClose(
  session: DashboardIterationSessionClient | null,
  payload: unknown,
): Promise<DashboardIterationTaskResult> {
  if (!isDashboardIterationCloseRequest(payload)) return dashboardIterationFailure('VALIDATION');
  return withCoachSession(session, async (client, epoch) => {
    const result = await client.request(
      epoch,
      `/v1/events/iteration-tasks/${encodeURIComponent(payload.taskId)}/close`,
      {
        body: {
          expected_version: payload.expectedVersion,
          status: payload.status,
          resolution_note: payload.resolutionNote,
        },
        headers: { 'idempotency-key': randomUUID() },
      },
    );
    const task = iterationTaskFromContract(result.value);
    if (!task) return dashboardIterationFailure('UNAVAILABLE');
    return Object.freeze({ ok: true, task });
  });
}
