import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { PackagedProductProfile } from './product-runtime-config';
import { isTrustedMainFrameSender } from './sender-guard';
import { workbenchKind, type WorkbenchModeReply } from '../shared/workbench-mode';
import { projectSopManualImages } from '../shared/sop-model';
import { isSopManualImageProjections } from '../shared/sop-window';
import { SYNTHETIC_SOP_TREES } from '../shared/synthetic-sops';

const CHANNEL = 'dashboard:workbench-mode';
const SOP_IMAGES_CHANNEL = 'dashboard:sop-manual-images';

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
  ipcMain.handle(SOP_IMAGES_CHANNEL, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const contents = dashboard();
    if (args.length !== 0 || workbenchKind(profile) !== 'synthetic-offline'
      || !contents || !isTrustedMainFrameSender(event, [contents], devUrl())) return null;
    const images = projectSopManualImages(SYNTHETIC_SOP_TREES);
    return isSopManualImageProjections(images) ? images : null;
  });
  return { dispose: () => { ipcMain.removeHandler(CHANNEL); ipcMain.removeHandler(SOP_IMAGES_CHANNEL); } };
}
