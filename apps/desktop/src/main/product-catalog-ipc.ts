import { ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { catalogFailure, productCatalogEntries, type ProductCatalogResult } from '../shared/product-catalog';
import { isTrustedMainFrameSender } from './sender-guard';
import type { OverlayRole } from '../shared/overlay-events';

/**
 * Serves the synthetic product catalog to the query renderer.
 *
 * The catalog is a compile-time constant with no session or customer data, but
 * the channel still enforces the same sender/role gates as the other product
 * capabilities: only the trusted query window may read it, and Fox/Dashboard
 * are refused. Nothing here reads the network or the filesystem.
 */
export function registerProductCatalogIpc(
  trusted: () => WebContents[],
  role: (sender: WebContents) => OverlayRole | null,
  devUrl: () => string | undefined,
): void {
  ipcMain.handle(IPC_CHANNELS.PRODUCT_CATALOG, (event, ...args: unknown[]): ProductCatalogResult => {
    if (!isTrustedMainFrameSender(event, trusted(), devUrl()) || role(event.sender) !== 'query') {
      return catalogFailure('FORBIDDEN');
    }
    if (args.length !== 0) return catalogFailure('VALIDATION');
    return { ok: true, entries: productCatalogEntries() };
  });
}
