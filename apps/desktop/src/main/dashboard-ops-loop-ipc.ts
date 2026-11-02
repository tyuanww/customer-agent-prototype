import { ipcMain, shell, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { dashboardOpsFailure, type DashboardOpsFailure } from '../shared/dashboard-ops-loop';
import { isTrustedMainFrameSender } from './sender-guard';
import {
  dashboardQuestionRates,
  dashboardRetrievalMetrics,
  dashboardScriptDelete,
  dashboardSoftwareCatalog,
  dashboardSoftwareOpenDownload,
  type DashboardOpsSessionClient,
} from './dashboard-ops-loop';

export function registerDashboardOpsLoopIpc(
  session: DashboardOpsSessionClient | null,
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
  openExternal: (url: string) => Promise<void> = async (url) => {
    await shell.openExternal(url);
  },
): void {
  const guard = (event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0]): boolean => {
    const contents = dashboardContents();
    return !!contents && isTrustedMainFrameSender(event, [contents], devUrl());
  };

  const wrap = async (
    event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0],
    args: unknown[],
    expected: number,
    work: () => Promise<unknown>,
  ): Promise<unknown | DashboardOpsFailure> => {
    if (!guard(event)) return dashboardOpsFailure('FORBIDDEN');
    if (args.length !== expected) return dashboardOpsFailure('VALIDATION');
    try {
      return await work();
    } catch {
      return dashboardOpsFailure('UNAVAILABLE');
    }
  };

  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_RETRIEVAL, (event, ...args: unknown[]) =>
    wrap(event, args, 1, () => {
      const window = args[0];
      if (window !== 'current_release' && window !== 'last_7d') {
        return Promise.resolve(dashboardOpsFailure('VALIDATION'));
      }
      return dashboardRetrievalMetrics(session, window);
    }));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_QUESTION_RATES, (event, ...args: unknown[]) =>
    wrap(event, args, 2, () => {
      const start = args[0];
      const end = args[1];
      if (typeof start !== 'string' || typeof end !== 'string') return Promise.resolve(dashboardOpsFailure('VALIDATION'));
      const startAt = new Date(start);
      const endAt = new Date(end);
      if (Number.isNaN(startAt.valueOf()) || Number.isNaN(endAt.valueOf()) || startAt > endAt) {
        return Promise.resolve(dashboardOpsFailure('VALIDATION'));
      }
      const shopRateWindowMs = 366 * 24 * 60 * 60 * 1000;
      if (endAt.getTime() - startAt.getTime() >= shopRateWindowMs) {
        return Promise.resolve(dashboardOpsFailure('VALIDATION'));
      }
      return dashboardQuestionRates(session, start, end);
    }));
  // Legacy unscoped SOP operations stay closed until the versioned graph contract is consumed.
  for (const [channel, argumentCount] of [
    [IPC_CHANNELS.DASHBOARD_OPS_SOP_CATALOG, 0],
    [IPC_CHANNELS.DASHBOARD_OPS_SOP_IMPORT, 1],
    [IPC_CHANNELS.DASHBOARD_OPS_SOP_PATCH, 1],
    [IPC_CHANNELS.DASHBOARD_OPS_SOP_DELETE, 1],
  ] as const) {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      wrap(event, args, argumentCount, () => Promise.resolve(dashboardOpsFailure('UNAVAILABLE'))));
  }
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SCRIPT_DELETE, (event, ...args: unknown[]) =>
    wrap(event, args, 1, () => dashboardScriptDelete(session, args[0])));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOFTWARE, (event, ...args: unknown[]) =>
    wrap(event, args, 0, () => dashboardSoftwareCatalog(session)));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOFTWARE_OPEN, (event, ...args: unknown[]) =>
    wrap(event, args, 0, () => dashboardSoftwareOpenDownload(session, openExternal)));
}
