import { clipboard, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { resolveClipboardWrite } from '../shared/clipboard-write';
import {
  IPC_CHANNELS,
  type CopyTextResult,
  type PlatformInfo,
} from '../shared/contracts';
import { isTrustedSender } from './sender-guard';

export function registerClipboardIpc(getTrusted: () => WebContents[]): void {
  const guard = (event: IpcMainInvokeEvent): boolean => {
    return isTrustedSender(event, getTrusted());
  };

  ipcMain.handle(
    IPC_CHANNELS.COPY_TEXT,
    async (event, text: unknown): Promise<CopyTextResult> => {
      if (!guard(event)) {
        return { ok: false, message: '复制通道不可用，请在桌面 Demo 中重试' };
      }

      const resolved = resolveClipboardWrite(text);
      if (!resolved.ok) {
        return resolved;
      }

      try {
        clipboard.writeText(resolved.payload);
        return { ok: true };
      } catch {
        return { ok: false, message: '复制失败，请重试' };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.GET_PLATFORM, (event): PlatformInfo => {
    if (!guard(event)) {
      return { platform: process.platform };
    }
    return { platform: process.platform };
  });
}
