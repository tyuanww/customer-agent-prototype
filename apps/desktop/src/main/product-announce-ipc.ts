import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { announceFailure, isProductAnnounceRequest } from '../shared/product-announce';
import { isTrustedMainFrameSender } from './sender-guard';
import type { OverlayRole } from '../shared/overlay-events';
import type { ProductAnnounce } from './product-announce';

export function registerProductAnnounceIpc(announce: ProductAnnounce | null, trusted: () => WebContents[], role: (sender: WebContents) => OverlayRole | null, devUrl: () => string | undefined) {
  ipcMain.handle(IPC_CHANNELS.PRODUCT_ANNOUNCE_REFRESH, async (event, ...args: unknown[]) => {
    const value = args[0];
    const identity = isProductAnnounceRequest(value) ? value : { sessionEpoch: 0, generation: 0 };
    if (!isTrustedMainFrameSender(event, trusted(), devUrl()) || role(event.sender) !== 'query') return announceFailure('FORBIDDEN', identity);
    if (args.length !== 1 || !isProductAnnounceRequest(value)) return announceFailure('VALIDATION', identity);
    if (!announce) return announceFailure('UNAUTHORIZED', identity);
    return announce.refresh(value);
  });
  return announce?.onInvalidated(value => {
    for (const target of trusted()) if (!target.isDestroyed() && role(target) === 'query') target.send(IPC_CHANNELS.PRODUCT_ANNOUNCE_INVALIDATED, value);
  });
}
