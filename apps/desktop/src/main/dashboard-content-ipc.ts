import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import {
  dashboardContentFailure,
  type DashboardContentPublishResult,
  type DashboardContentRollbackResult,
  type DashboardContentSessionResult,
} from '../shared/dashboard-content';
import { isTrustedMainFrameSender } from './sender-guard';
import {
  dashboardContentParseUpload,
  dashboardContentPublish,
  dashboardContentRollbackPrevious,
  dashboardContentCancelInFlight,
  dashboardContentSession,
  type DashboardContentAfterPublish,
  type DashboardContentSessionClient,
} from './dashboard-content';

export function registerDashboardContentIpc(
  session: DashboardContentSessionClient | null,
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
  afterPublish?: DashboardContentAfterPublish,
): void {
  const guard = (event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0]): boolean => {
    const contents = dashboardContents();
    return !!contents && isTrustedMainFrameSender(event, [contents], devUrl());
  };

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_CONTENT_SESSION,
    (event, ...args: unknown[]): DashboardContentSessionResult => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 0) return dashboardContentFailure('VALIDATION');
      try {
        return dashboardContentSession(session);
      } catch {
        return dashboardContentFailure('UNAVAILABLE');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_CONTENT_PARSE,
    (event, ...args: unknown[]) => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 1) return dashboardContentFailure('VALIDATION');
      try {
        return dashboardContentParseUpload(args[0]);
      } catch {
        return dashboardContentFailure('UNAVAILABLE');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_CONTENT_PUBLISH,
    async (event, ...args: unknown[]): Promise<DashboardContentPublishResult> => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 1) return dashboardContentFailure('VALIDATION');
      try {
        return await dashboardContentPublish(session, args[0], afterPublish);
      } catch {
        return dashboardContentFailure('UNAVAILABLE');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_CONTENT_ROLLBACK_PREVIOUS,
    async (event, ...args: unknown[]): Promise<DashboardContentRollbackResult> => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 0) return dashboardContentFailure('VALIDATION');
      try {
        return await dashboardContentRollbackPrevious(session);
      } catch {
        return dashboardContentFailure('UNAVAILABLE');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DASHBOARD_CONTENT_CANCEL_IN_FLIGHT,
    async (event, ...args: unknown[]) => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 0) return dashboardContentFailure('VALIDATION');
      try {
        return await dashboardContentCancelInFlight(session);
      } catch {
        return dashboardContentFailure('UNAVAILABLE');
      }
    },
  );
}
