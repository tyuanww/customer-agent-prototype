import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { productFailure, type ProductSessionView } from '../shared/product-session';
import { isProductNoticeDecisionRequest, noticeFailure } from '../shared/product-notice';
import { isTrustedMainFrameSender } from './sender-guard';
import type { OverlayRole } from '../shared/overlay-events';
import type { ProductSession } from './product-session';

export function registerProductIpc(
  session: ProductSession | null,
  trusted: () => WebContents[],
  role: (sender: WebContents) => OverlayRole | null,
  devUrl: () => string | undefined,
  sessionFanout: () => Array<WebContents | null> = () => [],
) {
  const disabled: ProductSessionView = { ok: true, enabled: false, signedIn: false, sessionEpoch: 0, userId: null, role: null, authMode: null, expiresAt: null, displayName: null };
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
  ipcMain.handle(IPC_CHANNELS.PRODUCT_NOTICE_CURRENT, async (event, ...args: unknown[]) => {
    if (!isTrustedMainFrameSender(event, trusted(), devUrl()) || role(event.sender) !== 'query') return noticeFailure('FORBIDDEN');
    if (args.length !== 0) return noticeFailure('VALIDATION');
    return session ? session.currentNotice() : noticeFailure('UNAUTHORIZED');
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCT_NOTICE_DECISION, async (event, ...args: unknown[]) => {
    if (!isTrustedMainFrameSender(event, trusted(), devUrl()) || role(event.sender) !== 'query') return noticeFailure('FORBIDDEN');
    if (args.length !== 1 || !isProductNoticeDecisionRequest(args[0])) return noticeFailure('VALIDATION');
    return session ? session.decideNotice(args[0]) : noticeFailure('UNAUTHORIZED');
  });
  return session?.subscribe(value => {
    const sent = new Set<number>();
    const send = (target: WebContents | null) => {
      if (!target || target.isDestroyed() || sent.has(target.id)) return;
      sent.add(target.id);
      target.send(IPC_CHANNELS.PRODUCT_SESSION_CHANGED, value);
    };
    for (const target of trusted()) {
      if (role(target) === 'query') send(target);
    }
    for (const target of sessionFanout()) send(target);
  });
}
