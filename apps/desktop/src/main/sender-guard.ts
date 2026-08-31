import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { isAllowedRendererUrl } from '../shared/renderer-url';

export function isTrustedSender(
  event: IpcMainInvokeEvent,
  contents: readonly WebContents[],
  devServerUrl?: string,
): boolean {
  const sender = event.sender;
  if (sender.isDestroyed()) {
    return false;
  }

  const matched = contents.some((item) => !item.isDestroyed() && item.id === sender.id);
  if (!matched) {
    return false;
  }

  const frame = event.senderFrame;
  if (frame?.parent) {
    return false;
  }

  return isAllowedRendererUrl(sender.getURL(), devServerUrl);
}

export function isTrustedMainFrameSender(
  event: IpcMainInvokeEvent,
  contents: readonly WebContents[],
  devServerUrl?: string,
): boolean {
  if (!isTrustedSender(event, contents, devServerUrl)) {
    return false;
  }
  const frame = event.senderFrame;
  if (!frame) {
    return false;
  }
  const mainFrame = event.sender.mainFrame;
  return frame === mainFrame;
}
