import { clipboard, ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { exactKeys } from '../shared/product-session';
import { isQueryIdentity, isProductCopyRequest, isProductSearchRequest, queryFailure } from '../shared/product-search';
import { isTrustedMainFrameSender } from './sender-guard';
import type { OverlayRole } from '../shared/overlay-events';
import type { ProductSession } from './product-session';
import { ProductSearch } from './product-search';
export function registerProductSearchIpc(session: ProductSession | null, trusted: () => WebContents[], role: (sender: WebContents) => OverlayRole | null, devUrl: () => string | undefined) {
  const search = session ? new ProductSearch(session, text => clipboard.writeText(text)) : null;
  const seen = new WeakSet<WebContents>();
  for (const [channel, method] of [[IPC_CHANNELS.PRODUCT_SEARCH, 'search'], [IPC_CHANNELS.PRODUCT_CANCEL_SEARCH, 'cancel'], [IPC_CHANNELS.PRODUCT_COPY_ADOPT, 'copy']] as const) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const value = args[0]; const identity = isQueryIdentity(value) ? value : { sessionEpoch: 0, generation: 0 };
      if (!isTrustedMainFrameSender(event, trusted(), devUrl()) || role(event.sender) !== 'query') return queryFailure('FORBIDDEN', identity);
      if (args.length !== 1) return queryFailure('VALIDATION', identity);
      if (!search) return queryFailure('UNAUTHORIZED', identity);
      if (!seen.has(event.sender)) { seen.add(event.sender); const id = event.sender.id; event.sender.once('destroyed', () => search.forget(id)); }
      if (method === 'search' && isProductSearchRequest(value)) return search.search(event.sender.id, value);
      if (method === 'copy' && isProductCopyRequest(value)) return search.copy(event.sender.id, value);
      if (method === 'cancel' && exactKeys(value, ['sessionEpoch', 'generation']) && isQueryIdentity(value)) return search.cancel(event.sender.id, value);
      return queryFailure('VALIDATION', identity);
    });
  }
}
