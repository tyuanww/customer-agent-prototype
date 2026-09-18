import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { dashboardWordingFailure, type DashboardWordingResult } from '../shared/dashboard-wording';
import { isTrustedMainFrameSender } from './sender-guard';
import { listDashboardWording } from './dashboard-wording';

export function registerDashboardWordingIpc(
  dashboardContents: () => WebContents | null,
  devUrl: () => string | undefined,
): void {
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_WORDING_LIST, (event, ...args: unknown[]): DashboardWordingResult => {
    const contents = dashboardContents();
    if (!contents || !isTrustedMainFrameSender(event, [contents], devUrl())) {
      return dashboardWordingFailure('FORBIDDEN');
    }
    if (args.length !== 0) return dashboardWordingFailure('VALIDATION');
    try {
      return listDashboardWording();
    } catch {
      return dashboardWordingFailure('UNAVAILABLE');
    }
  });
}
