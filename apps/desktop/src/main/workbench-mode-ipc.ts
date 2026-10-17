import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { PackagedProductProfile } from './product-runtime-config';
import { isTrustedMainFrameSender } from './sender-guard';
import { workbenchKind, type WorkbenchModeReply } from '../shared/workbench-mode';

const CHANNEL = 'dashboard:workbench-mode';

export function registerWorkbenchModeIpc(
  profile: PackagedProductProfile | null,
  dashboard: () => WebContents | null,
  devUrl: () => string | undefined,
): { dispose(): void } {
  const handle = (event: IpcMainInvokeEvent): WorkbenchModeReply => {
    const contents = dashboard();
    if (!contents || !isTrustedMainFrameSender(event, [contents], devUrl())) return { ok: false, code: 'FORBIDDEN' };
    return { ok: true, kind: workbenchKind(profile) };
  };
  ipcMain.handle(CHANNEL, handle);
  return { dispose: () => { ipcMain.removeHandler(CHANNEL); } };
}
