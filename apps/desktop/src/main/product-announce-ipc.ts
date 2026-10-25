import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { announceFailure, isProductAnnounceRequest } from '../shared/product-announce';
import { isTrustedMainFrameSender } from './sender-guard';
import type { OverlayRole } from '../shared/overlay-events';
import { LIBRARY_DOMAINS, isLibraryDomain, type LibraryDomain } from '../shared/library-delta';
import type { ProductAnnounce } from './product-announce';

const NO_UNREAD = Object.freeze({ ok: false as const, signedIn: false as const, unread: false as const, domains: [] as const });

function parseDomains(args: unknown[]): readonly LibraryDomain[] {
  if (args.length !== 1 || !Array.isArray(args[0]) || args[0].length > 4) return [];
  const seen = new Set<string>();
  for (const item of args[0]) {
    if (!isLibraryDomain(item) || seen.has(item)) return [];
    seen.add(item);
  }
  return LIBRARY_DOMAINS.filter((domain) => seen.has(domain));
}

export function registerProductAnnounceIpc(
  announce: ProductAnnounce | null,
  trusted: () => WebContents[],
  role: (sender: WebContents) => OverlayRole | null,
  devUrl: () => string | undefined,
) {  ipcMain.handle(IPC_CHANNELS.PRODUCT_ANNOUNCE_REFRESH, async (event, ...args: unknown[]) => {
    const value = args[0];
    const identity = isProductAnnounceRequest(value) ? value : { sessionEpoch: 0, generation: 0 };
    if (!isTrustedMainFrameSender(event, trusted(), devUrl()) || role(event.sender) !== 'query') return announceFailure('FORBIDDEN', identity);
    if (args.length !== 1 || !isProductAnnounceRequest(value)) return announceFailure('VALIDATION', identity);
    if (!announce) return announceFailure('UNAUTHORIZED', identity);
    return announce.refresh(value);
  });
  // Fox may read the unread projection but never refresh announce and never mark read.
  ipcMain.handle(IPC_CHANNELS.PRODUCT_ANNOUNCE_UNREAD, (event, ...args: unknown[]) => {
    const senderRole = role(event.sender);
    if (!isTrustedMainFrameSender(event, trusted(), devUrl()) || (senderRole !== 'fox' && senderRole !== 'query')) return NO_UNREAD;
    if (args.length !== 0 || !announce) return NO_UNREAD;
    return announce.unread();
  });
  // markRead never accepts a userId; main uses session.view().userId only.
  ipcMain.handle(IPC_CHANNELS.PRODUCT_ANNOUNCE_MARK_READ, (event, ...args: unknown[]) => {
    if (!isTrustedMainFrameSender(event, trusted(), devUrl()) || role(event.sender) !== 'query') return;
    const domains = parseDomains(args);
    if (domains.length === 0 || !announce) return;
    announce.markRead(domains);
  });
  const unregisterInvalidated = announce?.onInvalidated(value => {
    for (const target of trusted()) if (!target.isDestroyed() && role(target) === 'query') target.send(IPC_CHANNELS.PRODUCT_ANNOUNCE_INVALIDATED, value);
  });
  const unregisterContentUpdated = announce?.onContentUpdated(value => {
    for (const target of trusted()) {
      if (target.isDestroyed()) continue;
      const senderRole = role(target);
      if (senderRole === 'fox' || senderRole === 'query') target.send(IPC_CHANNELS.PRODUCT_ANNOUNCE_CONTENT_UPDATED, value);
    }
  });
  return () => { unregisterInvalidated?.(); unregisterContentUpdated?.(); };
}
