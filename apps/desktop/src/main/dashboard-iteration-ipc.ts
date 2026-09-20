import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import {
  dashboardIterationFailure,
  type DashboardIterationListResult,
  type DashboardIterationTaskResult,
} from '../shared/dashboard-iteration';
import { isTrustedMainFrameSender } from './sender-guard';
import {
  dashboardIterationClose,
  dashboardIterationList,
  dashboardIterationStart,
  type DashboardIterationSessionClient,
} from './dashboard-iteration';

export function registerDashboardIterationIpc(
  session: DashboardIterationSessionClient | null,
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
): void {
  const guard = (event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0]): boolean => {
    const contents = dashboardContents();
    return !!contents && isTrustedMainFrameSender(event, [contents], devUrl());
  };

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
        return await dashboardIterationStart(session, args[0]);
      } catch {
        return dashboardIterationFailure('UNAVAILABLE');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_ITERATION_CLOSE,
    async (event, ...args: unknown[]): Promise<DashboardIterationTaskResult> => {
      if (!guard(event)) return dashboardIterationFailure('FORBIDDEN');
      if (args.length !== 1) return dashboardIterationFailure('VALIDATION');
      try {
        return await dashboardIterationClose(session, args[0]);
      } catch {
        return dashboardIterationFailure('UNAVAILABLE');
      }
    },
  );
}
