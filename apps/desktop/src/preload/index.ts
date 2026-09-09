import { isQueryIdentity, isProductSearchRequest, isProductCopyRequest, isProductQueryResult, queryFailure, type ProductSearchResult, type ProductCopyResult, type ProductCancelResult, type QueryIdentity } from '../shared/product-search';
import { exactKeys, isProductSessionResult, productFailure, type ProductSessionResult } from '../shared/product-session';
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  isOpenDashboardResult,
  openDashboardUnavailable,
  type CopyTextResult,
  type CustomerAgentApi,
  type OpenDashboardResult,
} from '../shared/contracts';
import {
  isFoxDragSettleAck,
  isFoxDragGeneration,
  isFoxDragSettleId,
  isFoxPeekIntent,
  isFoxPeekEpoch,
  isFoxVisualTransform,
  isHandoffId,
  isHandoffMilestone,
  isOverlayCommand,
  isReportablePhase,
  isResultCount,
  type OverlayCommand,
  type WindowContext,
} from '../shared/overlay-events';
import {
  isQueryLayoutRequest,
  isQueryResizeRequest,
  rejectedQueryLayoutAck,
} from '../shared/query-layout';

const overlayListeners = new Set<(command: OverlayCommand) => void>();

ipcRenderer.on(IPC_CHANNELS.OVERLAY_COMMAND, (_event, payload: unknown) => {
  if (!isOverlayCommand(payload)) {
    return;
  }
  for (const listener of overlayListeners) {
    listener(payload);
  }
});

const sessionListeners = new Set<(value: ProductSessionResult) => void>();
ipcRenderer.on(IPC_CHANNELS.PRODUCT_SESSION_CHANGED, (_event, value: unknown) => {
  if (isProductSessionResult(value)) for (const listener of sessionListeners) listener(value);
});
const sessionInvoke = async (channel: string): Promise<ProductSessionResult> => {
  try {
    const value: unknown = await ipcRenderer.invoke(channel);
    return isProductSessionResult(value) ? value : productFailure('UNAVAILABLE');
  } catch { return productFailure('UNAVAILABLE'); }
};
async function queryInvoke(channel: string, request: QueryIdentity) {
  if (!isQueryIdentity(request)) return queryFailure('VALIDATION', { sessionEpoch: 0, generation: 0 });
  const valid = channel === IPC_CHANNELS.PRODUCT_SEARCH ? isProductSearchRequest(request)
    : channel === IPC_CHANNELS.PRODUCT_COPY_ADOPT ? isProductCopyRequest(request) : exactKeys(request, ['sessionEpoch', 'generation']);
  if (!valid) return queryFailure('VALIDATION', request);
  try {
    const value: unknown = await ipcRenderer.invoke(channel, request);
    if (!isProductQueryResult(value) || value.sessionEpoch !== request.sessionEpoch || value.generation !== request.generation) return queryFailure('UNAVAILABLE', request);
    if (!value.ok) return value;
    const matches = channel === IPC_CHANNELS.PRODUCT_SEARCH ? 'queryId' in value : channel === IPC_CHANNELS.PRODUCT_COPY_ADOPT ? 'copied' in value : 'cancelled' in value;
    return matches ? value : queryFailure('UNAVAILABLE', request);
  } catch { return queryFailure('UNAVAILABLE', request); }
}
const api: CustomerAgentApi = {
  productSearch: {
    search: request => queryInvoke(IPC_CHANNELS.PRODUCT_SEARCH, request) as Promise<ProductSearchResult>,
    copyAdopt: request => queryInvoke(IPC_CHANNELS.PRODUCT_COPY_ADOPT, request) as Promise<ProductCopyResult>,
    cancelSearch: request => queryInvoke(IPC_CHANNELS.PRODUCT_CANCEL_SEARCH, request) as Promise<ProductCancelResult>,
  },
  product: {
    sessionStatus: () => sessionInvoke(IPC_CHANNELS.PRODUCT_SESSION_STATUS),
    login: () => sessionInvoke(IPC_CHANNELS.PRODUCT_LOGIN),
    logout: () => sessionInvoke(IPC_CHANNELS.PRODUCT_LOGOUT),
    onSessionChanged(listener) { sessionListeners.add(listener); return () => { sessionListeners.delete(listener); }; },
  },
  copyText(text: string): Promise<CopyTextResult> {
    if (typeof text !== 'string') {
      return Promise.resolve({ ok: false, message: '复制内容无效' });
    }
    return ipcRenderer.invoke(IPC_CHANNELS.COPY_TEXT, text);
  },
  getWindowContext(): Promise<WindowContext> {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_WINDOW_CONTEXT);
  },
  openSearch(visualTransform): Promise<void> {
    if (visualTransform !== undefined && !isFoxVisualTransform(visualTransform)) {
      return Promise.resolve();
    }
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_SEARCH, visualTransform);
  },
  openDashboard(): Promise<OpenDashboardResult> {
    return ipcRenderer
      .invoke(IPC_CHANNELS.OPEN_DASHBOARD)
      .then((value: unknown) => (isOpenDashboardResult(value) ? value : openDashboardUnavailable()));
  },
  dismiss(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.DISMISS);
  },
  reportUiPhase(phase, resultCount = 0): Promise<void> {
    if (!isReportablePhase(phase) || !isResultCount(resultCount)) {
      return Promise.resolve();
    }
    return ipcRenderer.invoke(IPC_CHANNELS.REPORT_UI_PHASE, phase, resultCount);
  },
  reportHandoffMilestone(handoffId, milestone): Promise<void> {
    if (!isHandoffId(handoffId) || !isHandoffMilestone(milestone)) {
      return Promise.resolve();
    }
    return ipcRenderer.invoke(IPC_CHANNELS.REPORT_HANDOFF_MILESTONE, handoffId, milestone);
  },
  reportQueryLayout(request) {
    if (!isQueryLayoutRequest(request)) {
      return Promise.resolve(rejectedQueryLayoutAck(0, 0));
    }
    return ipcRenderer.invoke(IPC_CHANNELS.REPORT_QUERY_LAYOUT, request);
  },
  resizeQueryHeight(request) {
    if (!isQueryResizeRequest(request)) {
      return Promise.resolve(rejectedQueryLayoutAck(0, 0));
    }
    return ipcRenderer.invoke(IPC_CHANNELS.RESIZE_QUERY_HEIGHT, request);
  },
  moveFoxBy(deltaX: number, deltaY: number, finished = false, generation?: number) {
    if (
      typeof deltaX !== 'number' ||
      typeof deltaY !== 'number' ||
      typeof finished !== 'boolean' ||
      (generation !== undefined && !isFoxDragGeneration(generation))
    ) {
      return Promise.resolve(null);
    }
    return ipcRenderer
      .invoke(IPC_CHANNELS.MOVE_FOX_BY, deltaX, deltaY, finished, generation)
      .then((value: unknown) => (isFoxDragSettleAck(value) ? value : null));
  },
  commitFoxDragSettle(settleId: number): Promise<void> {
    if (!isFoxDragSettleId(settleId)) {
      return Promise.resolve();
    }
    return ipcRenderer.invoke(IPC_CHANNELS.COMMIT_FOX_DRAG_SETTLE, settleId);
  },
  setFoxPeek(intent, epoch): Promise<void> {
    if (!isFoxPeekIntent(intent) || !isFoxPeekEpoch(epoch)) {
      return Promise.resolve();
    }
    return ipcRenderer.invoke(IPC_CHANNELS.SET_FOX_PEEK, intent, epoch);
  },
  onOverlayCommand(handler) {
    overlayListeners.add(handler);
    return () => {
      overlayListeners.delete(handler);
    };
  },
};

contextBridge.exposeInMainWorld('customerAgent', api);
