import { clipboard, ipcMain, type WebContents } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { exactKeys } from '../shared/product-session';
import { isQueryIdentity, isProductCopyRequest, isProductSearchRequest, queryFailure } from '../shared/product-search';
import { DEFAULT_RETRIEVAL_PREFERENCE, parseRetrievalPreference } from '../shared/retrieval-preference';
import { isTrustedMainFrameSender } from './sender-guard';
import type { OverlayRole } from '../shared/overlay-events';
import type { ProductSession } from './product-session';
import { ProductSearch, type SearchHelp } from './product-search';
import type { AnnounceGate } from '../shared/product-announce';
import { isProductEscalateRequest, isProductTerminalRequest } from '../shared/product-help';
import { loadRetrievalPreferenceStore } from './retrieval-preference-store';
import { loadRetrievalPipeline } from './retrieval-pipeline';

const preferenceStore = loadRetrievalPreferenceStore(
  process.env.CUSTOMER_AGENT_RETRIEVAL_PREFERENCE
    ?? join(homedir(), '.customer-agent-synthetic-stack', 'retrieval-preference.json'),
);

export function registerProductSearchIpc(session: ProductSession | null, announce: AnnounceGate | null, trusted: () => WebContents[], role: (sender: WebContents) => OverlayRole | null, devUrl: () => string | undefined, help?: SearchHelp) {
  const search = session && announce
    ? new ProductSearch(session, text => clipboard.writeText(text), announce, help, undefined, undefined, undefined, loadRetrievalPipeline(), preferenceStore)
    : null;
  const seen = new WeakSet<WebContents>();
  const guard = async (event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0], args: unknown[], dispatch: (id: number, value: unknown) => unknown) => {
    const value = args[0]; const identity = isQueryIdentity(value) ? value : { sessionEpoch: 0, generation: 0 };
    if (!isTrustedMainFrameSender(event, trusted(), devUrl()) || role(event.sender) !== 'query') return queryFailure('FORBIDDEN', identity);
    if (args.length !== 1) return queryFailure('VALIDATION', identity);
    if (!search) return queryFailure('UNAUTHORIZED', identity);
    if (!seen.has(event.sender)) { seen.add(event.sender); const id = event.sender.id; event.sender.once('destroyed', () => search.forget(id)); }
    return dispatch(event.sender.id, value);
  };
  for (const [channel, method] of [[IPC_CHANNELS.PRODUCT_SEARCH, 'search'], [IPC_CHANNELS.PRODUCT_CANCEL_SEARCH, 'cancel'], [IPC_CHANNELS.PRODUCT_COPY_ADOPT, 'copy']] as const) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => guard(event, args, (id, value) => {
      if (method === 'search' && isProductSearchRequest(value)) return search!.search(id, value);
      if (method === 'copy' && isProductCopyRequest(value)) return search!.copy(id, value);
      if (method === 'cancel' && exactKeys(value, ['sessionEpoch', 'generation']) && isQueryIdentity(value)) return search!.cancel(id, value);
      return queryFailure('VALIDATION', isQueryIdentity(value) ? value : { sessionEpoch: 0, generation: 0 });
    }));
  }
  ipcMain.handle(IPC_CHANNELS.PRODUCT_ESCALATE, (event, ...args: unknown[]) => guard(event, args, (id, value) =>
    isProductEscalateRequest(value) ? search!.escalate(id, value) : queryFailure('VALIDATION', isQueryIdentity(value) ? value : { sessionEpoch: 0, generation: 0 })));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_RECORD_TERMINAL, (event, ...args: unknown[]) => guard(event, args, (id, value) =>
    isProductTerminalRequest(value) ? search!.recordTerminal(id, value) : queryFailure('VALIDATION', isQueryIdentity(value) ? value : { sessionEpoch: 0, generation: 0 })));
  const preferenceGuard = (event: Parameters<Parameters<typeof ipcMain.handle>[1]>[0]) =>
    isTrustedMainFrameSender(event, trusted(), devUrl()) && role(event.sender) === 'query';
  ipcMain.handle(IPC_CHANNELS.PRODUCT_RETRIEVAL_PREFERENCE_GET, (event) => {
    if (!preferenceGuard(event)) return DEFAULT_RETRIEVAL_PREFERENCE;
    return preferenceStore.read();
  });
  ipcMain.handle(IPC_CHANNELS.PRODUCT_RETRIEVAL_PREFERENCE_SET, (event, ...args: unknown[]) => {
    if (!preferenceGuard(event)) return DEFAULT_RETRIEVAL_PREFERENCE;
    if (args.length !== 1) return preferenceStore.read();
    const parsed = parseRetrievalPreference(args[0]);
    if (!parsed) return preferenceStore.read();
    return preferenceStore.write(parsed);
  });
}
