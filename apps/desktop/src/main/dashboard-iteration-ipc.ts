import { app, ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import {
  dashboardIterationFailure,
  isDashboardIterationCloseRequest,
  isDashboardIterationStartRequest,
  type DashboardIterationFailure,
  type DashboardIterationListResult,
  type DashboardIterationTaskResult,
} from '../shared/dashboard-iteration';
import { isTrustedMainFrameSender } from './sender-guard';
import {
  dashboardInaccuracyOutcomes,
  dashboardIterationClose,
  dashboardIterationList,
  dashboardIterationStart,
  type DashboardIterationSessionClient,
} from './dashboard-iteration';
import type { InaccuracyOutcomeList } from '../shared/inaccuracy-outcome';
import {
  DashboardControlPlaneError,
  bindDashboardOperationSession,
  dashboardControlPlaneForSession,
  type DashboardDomainOutcome,
} from './dashboard-control-plane';

function userDataDirectory(): string | null {
  try {
    return app?.getPath('userData') ?? null;
  } catch {
    return null;
  }
}

function controlFailure(error: unknown): DashboardIterationFailure {
  if (!(error instanceof DashboardControlPlaneError)) return dashboardIterationFailure('UNAVAILABLE');
  if (error.code === 'FORBIDDEN') return dashboardIterationFailure('FORBIDDEN', error.message);
  if (error.code === 'VALIDATION') return dashboardIterationFailure('VALIDATION', error.message);
  if (error.code === 'CONFLICT') return dashboardIterationFailure('CONFLICT', error.message);
  if (error.code === 'UNAUTHORIZED') return dashboardIterationFailure('UNAUTHORIZED', '请先登录。');
  if (error.code === 'STALE') return dashboardIterationFailure('UNAVAILABLE', '会话已变化，请重新读取。');
  return dashboardIterationFailure('UNAVAILABLE');
}

function iterationOutcome<T extends DashboardIterationTaskResult>(
  result: T,
): DashboardDomainOutcome<T> {
  if (result.ok) {
    return { kind: 'committed', result, resultRef: result.task.taskId };
  }
  if (result.code === 'UNAVAILABLE') return { kind: 'unknown', result };
  return { kind: 'failed', result, failureCode: result.code };
}

export function registerDashboardIterationIpc(
  session: DashboardIterationSessionClient | null,
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
): void {
  const plane = session
    ? dashboardControlPlaneForSession(session, userDataDirectory())
    : null;
  const guard = (event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0]): boolean => {
    const contents = dashboardContents();
    return !!contents && isTrustedMainFrameSender(event, [contents], devUrl());
  };

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_INACCURACY_OUTCOMES,
    async (event, ...args: unknown[]): Promise<InaccuracyOutcomeList | DashboardIterationFailure> => {
      if (!guard(event)) return dashboardIterationFailure('FORBIDDEN');
      if (args.length !== 0) return dashboardIterationFailure('VALIDATION');
      try {
        return await dashboardInaccuracyOutcomes(session);
      } catch {
        return dashboardIterationFailure('UNAVAILABLE');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_ITERATION_LIST,
    async (event, ...args: unknown[]): Promise<DashboardIterationListResult> => {
      if (!guard(event)) return dashboardIterationFailure('FORBIDDEN');
      if (args.length !== 0) return dashboardIterationFailure('VALIDATION');
      try {
        return await dashboardIterationList(session);
      } catch {
        return dashboardIterationFailure('UNAVAILABLE');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_ITERATION_START,
    async (event, ...args: unknown[]): Promise<DashboardIterationTaskResult> => {
      if (!guard(event)) return dashboardIterationFailure('FORBIDDEN');
      if (args.length !== 1) return dashboardIterationFailure('VALIDATION');
      try {
        if (!plane) return dashboardIterationStart(session, args[0]);
        if (!isDashboardIterationStartRequest(args[0])) {
          return dashboardIterationStart(session, args[0]);
        }
        const request = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
          ? args[0] as Record<string, unknown>
          : null;
        const run = await plane.submit({
          domain: 'ops-loop',
          command: 'content-manage',
          expectedVersion: typeof request?.expectedVersion === 'number' ? request.expectedVersion : 0,
          intent: args[0],
          execute: async (operation) => {
            const result = await dashboardIterationStart(
              bindDashboardOperationSession(session!, operation),
              args[0],
            );
            return operation.signal.aborted
              ? { kind: 'cancelled', result }
              : iterationOutcome(result);
          },
        });
        return run.result ?? dashboardIterationFailure('UNAVAILABLE', '操作已完成，请刷新查看。');
      } catch (error) {
        return controlFailure(error);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_ITERATION_CLOSE,
    async (event, ...args: unknown[]): Promise<DashboardIterationTaskResult> => {
      if (!guard(event)) return dashboardIterationFailure('FORBIDDEN');
      if (args.length !== 1) return dashboardIterationFailure('VALIDATION');
      try {
        if (!plane) return dashboardIterationClose(session, args[0]);
        if (!isDashboardIterationCloseRequest(args[0])) {
          return dashboardIterationClose(session, args[0]);
        }
        const request = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
          ? args[0] as Record<string, unknown>
          : null;
        const run = await plane.submit({
          domain: 'ops-loop',
          command: 'content-manage',
          expectedVersion: typeof request?.expectedVersion === 'number' ? request.expectedVersion : 0,
          intent: args[0],
          execute: async (operation) => {
            const result = await dashboardIterationClose(
              bindDashboardOperationSession(session!, operation),
              args[0],
            );
            return operation.signal.aborted
              ? { kind: 'cancelled', result }
              : iterationOutcome(result);
          },
        });
        return run.result ?? dashboardIterationFailure('UNAVAILABLE', '操作已完成，请刷新查看。');
      } catch (error) {
        return controlFailure(error);
      }
    },
  );
}
