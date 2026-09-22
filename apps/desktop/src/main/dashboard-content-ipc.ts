import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import {
  dashboardContentFailure,
  type DashboardContentImportResult,
  type DashboardContentPublishResult,
  type DashboardContentSessionResult,
} from '../shared/dashboard-content';
import { isTrustedMainFrameSender } from './sender-guard';
import {
  dashboardContentImport,
  dashboardContentParseUpload,
  completeSignedInReview,
  dashboardContentPublish,
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
    IPC_CHANNELS.DASHBOARD_CONTENT_IMPORT,
    async (event, ...args: unknown[]): Promise<DashboardContentImportResult> => {
      if (!guard(event)) return dashboardContentFailure('FORBIDDEN');
      if (args.length !== 1) return dashboardContentFailure('VALIDATION');
      try {
        return await dashboardContentImport(session, args[0]);
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
        const parkedReview = session
          ? (importBatchId: string) => completeSignedInReview(
            session,
            session.view().sessionEpoch,
            importBatchId,
          )
          : undefined;
        return await dashboardContentPublish(session, args[0], afterPublish, parkedReview);
      } catch {
        return dashboardContentFailure('UNAVAILABLE');
      }
    },
  );
}
