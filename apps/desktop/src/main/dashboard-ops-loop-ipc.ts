import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { dashboardOpsFailure, type DashboardOpsFailure } from '../shared/dashboard-ops-loop';
import { isTrustedMainFrameSender } from './sender-guard';
import {
  dashboardRetrievalMetrics,
  dashboardScriptDelete,
  dashboardScriptPatch,
  dashboardSoftwareCatalog,
  dashboardSopCatalog,
  dashboardSopDelete,
  dashboardSopImport,
  dashboardSopPatch,
  type DashboardOpsSessionClient,
} from './dashboard-ops-loop';

export function registerDashboardOpsLoopIpc(
  session: DashboardOpsSessionClient | null,
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
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
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOP_CATALOG, (event, ...args: unknown[]) =>
    wrap(event, args, 0, () => dashboardSopCatalog(session)));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOP_IMPORT, (event, ...args: unknown[]) =>
    wrap(event, args, 1, () => dashboardSopImport(session, typeof args[0] === 'string' ? args[0] : '')));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOP_PATCH, (event, ...args: unknown[]) =>
    wrap(event, args, 1, () => dashboardSopPatch(session, args[0])));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOP_DELETE, (event, ...args: unknown[]) =>
    wrap(event, args, 1, () => dashboardSopDelete(session, args[0])));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SCRIPT_PATCH, (event, ...args: unknown[]) =>
    wrap(event, args, 1, () => dashboardScriptPatch(session, args[0])));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SCRIPT_DELETE, (event, ...args: unknown[]) =>
    wrap(event, args, 1, () => dashboardScriptDelete(session, args[0])));
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_OPS_SOFTWARE, (event, ...args: unknown[]) =>
    wrap(event, args, 0, () => dashboardSoftwareCatalog(session)));
}
