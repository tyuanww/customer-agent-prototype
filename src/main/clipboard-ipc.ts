import { clipboard, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { resolveClipboardWrite } from '../shared/clipboard-write';
import {
  IPC_CHANNELS,
  type CopyTextResult,
} from '../shared/contracts';
import type { OverlayRole } from '../shared/overlay-events';
import { canCopyText } from '../shared/query-ipc-access';
import { isTrustedSender } from './sender-guard';

export function registerClipboardIpc(
  getTrusted: () => WebContents[],
  getRole: (contents: WebContents) => OverlayRole | null,
  getDevServerUrl: () => string | undefined,
): void {
  const guard = (event: IpcMainInvokeEvent): boolean => {
    return isTrustedSender(event, getTrusted(), getDevServerUrl());
  };

  ipcMain.handle(
    IPC_CHANNELS.COPY_TEXT,
    async (event, text: unknown): Promise<CopyTextResult> => {
      const trusted = guard(event);
      const role = getRole(event.sender);
      if (!canCopyText({ trusted, role })) {
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
}
