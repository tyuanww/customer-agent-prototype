import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { productFailure, type ProductSessionView } from '../shared/product-session';
import { isTrustedMainFrameSender } from './sender-guard';
import type { OverlayRole } from '../shared/overlay-events';
import type { ProductSession } from './product-session';

export function registerProductIpc(session: ProductSession | null, trusted: () => WebContents[], role: (sender: WebContents) => OverlayRole | null, devUrl: () => string | undefined) {
  const disabled: ProductSessionView = { ok: true, enabled: false, signedIn: false, sessionEpoch: 0, userId: null, role: null, authMode: null, expiresAt: null };
  for (const [channel, method] of [
    [IPC_CHANNELS.PRODUCT_SESSION_STATUS, 'status'], [IPC_CHANNELS.PRODUCT_LOGIN, 'login'], [IPC_CHANNELS.PRODUCT_LOGOUT, 'logout'],
  ] as const) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const senderRole = role(event.sender);
      if (!isTrustedMainFrameSender(event, trusted(), devUrl())
        || (senderRole !== 'query' && !(method === 'status' && senderRole === 'fox'))) return productFailure('FORBIDDEN');
      if (args.length) return productFailure('VALIDATION');
      return session ? session[method]() : disabled;
    });
  }
  return session?.subscribe(value => {
    for (const target of trusted()) if (!target.isDestroyed() && role(target) === 'query') target.send(IPC_CHANNELS.PRODUCT_SESSION_CHANGED, value);
  });
}
