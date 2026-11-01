import { isQuerySopNavigation, isQuerySopWindowIntent } from '../shared/query-sop-window';
import { SOP_UNAVAILABLE, isQuerySopRevision, isSopExecutionCommand, isSopExecutionCopy, isSopExecutionRename, isSopRenameRequest, isSopReadyRequest, isQuerySopSnapshot, isSopCopyResult, isSopWindowResult,
  isSopDraftIdentity, isSopDraftStart, isSopDraftUpdate, isSopDraftDiscard, isSopDraftResult, isSopShowQueryRequest, isSopShowQueryReady } from '../shared/sop-window';
import { isQueryIdentity, isProductSearchRequest, isProductCopyRequest, isProductInaccuracyRequest, isProductQueryResult, queryFailure, type ProductSearchResult, type ProductCopyResult, type ProductCancelResult, type QueryIdentity, type ProductInaccuracyResult } from '../shared/product-search';
import { announceFailure, isProductAnnounceRequest, isProductAnnounceResult, isProductAnnounceInvalidation, isProductAnnounceContentUpdate, isProductAnnounceUnread, type ProductAnnounceInvalidation, type ProductAnnounceContentUpdate } from '../shared/product-announce';
import { LIBRARY_DOMAINS, isLibraryDomain, type LibraryDomain } from '../shared/library-delta';
import { helpFailure, isProductEscalateRequest, isProductEscalateResult, isProductTerminalRequest, isProductTerminalResult } from '../shared/product-help';
import { catalogFailure, isProductCatalogResult } from '../shared/product-catalog';
import { exactKeys, isProductSessionResult, productFailure, type ProductSessionResult } from '../shared/product-session';
import {
  isProductNoticeDecisionRequest,
  isProductNoticeDecisionResult,
  isProductNoticeResult,
  noticeFailure,
  type ProductNoticeDecisionRequest,
  type ProductNoticeDecisionResult,
  type ProductNoticeResult,
} from '../shared/product-notice';
import { DEFAULT_RETRIEVAL_PREFERENCE, parseRetrievalPreference } from '../shared/retrieval-preference';
import { contextBridge, ipcRenderer } from 'electron';
import { intakeQuery } from './content-intake-query';
import {
  IPC_CHANNELS,
  isCopyTextResult,
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
let subscriptionReported = false;

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
const announceListeners = new Set<(value: ProductAnnounceInvalidation) => void>();
ipcRenderer.on(IPC_CHANNELS.PRODUCT_ANNOUNCE_INVALIDATED, (_event, value: unknown) => {
  if (isProductAnnounceInvalidation(value)) for (const listener of announceListeners) listener(value);
});
const contentUpdatedListeners = new Set<(value: ProductAnnounceContentUpdate) => void>();
ipcRenderer.on(IPC_CHANNELS.PRODUCT_ANNOUNCE_CONTENT_UPDATED, (_event, value: unknown) => {
  if (isProductAnnounceContentUpdate(value)) for (const listener of contentUpdatedListeners) listener(value);
});
const sessionInvoke = async (channel: string): Promise<ProductSessionResult> => {
  try {
    const value: unknown = await ipcRenderer.invoke(channel);
    return isProductSessionResult(value) ? value : productFailure('UNAVAILABLE');
  } catch { return productFailure('UNAVAILABLE'); }
};
const noticeCurrentInvoke = async (): Promise<ProductNoticeResult> => {
  try {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_NOTICE_CURRENT);
    return isProductNoticeResult(value) ? value : noticeFailure('UNAVAILABLE');
  } catch { return noticeFailure('UNAVAILABLE'); }
};
const noticeDecisionInvoke = async (request: ProductNoticeDecisionRequest): Promise<ProductNoticeDecisionResult> => {
  if (!isProductNoticeDecisionRequest(request)) return noticeFailure('VALIDATION');
  try {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_NOTICE_DECISION, request);
    return isProductNoticeDecisionResult(value) ? value : noticeFailure('UNAVAILABLE', 0);
  } catch { return noticeFailure('UNAVAILABLE'); }
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
async function readRetrievalPreference() {
  try {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_RETRIEVAL_PREFERENCE_GET);
    return parseRetrievalPreference(value) ?? DEFAULT_RETRIEVAL_PREFERENCE;
  } catch {
    return DEFAULT_RETRIEVAL_PREFERENCE;
  }
}
const api: CustomerAgentApi = {
  intakeQuery,
  productSearch: {
    search: request => queryInvoke(IPC_CHANNELS.PRODUCT_SEARCH, request) as Promise<ProductSearchResult>,
    copyAdopt: request => queryInvoke(IPC_CHANNELS.PRODUCT_COPY_ADOPT, request) as Promise<ProductCopyResult>,
    cancelSearch: request => queryInvoke(IPC_CHANNELS.PRODUCT_CANCEL_SEARCH, request) as Promise<ProductCancelResult>,
    async reportInaccuracy(request) {
      if (!isProductInaccuracyRequest(request)) return queryFailure('VALIDATION', { sessionEpoch: 0, generation: 0 });
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_INACCURACY_REPORT, request);
        if (!value || typeof value !== 'object') return queryFailure('UNAVAILABLE', request);
        const record = value as ProductInaccuracyResult;
        if (record.ok === false) return record;
        if (record.ok === true && record.sessionEpoch === request.sessionEpoch && record.generation === request.generation) {
          return record;
        }
        return queryFailure('UNAVAILABLE', request);
      } catch {
        return queryFailure('UNAVAILABLE', request);
      }
    },
    async retrievalPreference() {
      return readRetrievalPreference();
    },
    async setRetrievalPreference(next) {
      const parsed = parseRetrievalPreference(next);
      if (!parsed) return readRetrievalPreference();
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_RETRIEVAL_PREFERENCE_SET, parsed);
        return parseRetrievalPreference(value) ?? await readRetrievalPreference();
      } catch {
        return readRetrievalPreference();
      }
    },
  },
  product: {
    sessionStatus: () => sessionInvoke(IPC_CHANNELS.PRODUCT_SESSION_STATUS),
    login: () => sessionInvoke(IPC_CHANNELS.PRODUCT_LOGIN),
    logout: () => sessionInvoke(IPC_CHANNELS.PRODUCT_LOGOUT),
    currentNotice: noticeCurrentInvoke,
    decideNotice: noticeDecisionInvoke,
    onSessionChanged(listener) { sessionListeners.add(listener); return () => { sessionListeners.delete(listener); }; },
  },
  productAnnounce: {
    async refresh(request) {
      if (!isProductAnnounceRequest(request)) return announceFailure('VALIDATION', { sessionEpoch: 0, generation: 0 });
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_ANNOUNCE_REFRESH, request);
        return isProductAnnounceResult(value) && value.sessionEpoch === request.sessionEpoch && value.generation === request.generation
          ? value : announceFailure('UNAVAILABLE', request);
      } catch { return announceFailure('UNAVAILABLE', request); }
    },
    onInvalidated(listener) { announceListeners.add(listener); return () => { announceListeners.delete(listener); }; },
    onContentUpdated(listener) { contentUpdatedListeners.add(listener); return () => { contentUpdatedListeners.delete(listener); }; },
    async unread() {
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_ANNOUNCE_UNREAD);
        return isProductAnnounceUnread(value) ? value : { ok: false as const, signedIn: false as const, unread: false as const, domains: [] as const };
      } catch {
        return { ok: false as const, signedIn: false as const, unread: false as const, domains: [] as const };
      }
    },
    async markRead(domains) {
      const requested = Array.isArray(domains) && domains.length <= 4 && domains.every((domain: unknown) => isLibraryDomain(domain))
        && new Set(domains).size === domains.length
        ? LIBRARY_DOMAINS.filter((domain) => (domains as readonly LibraryDomain[]).includes(domain))
        : [];
      if (requested.length === 0) return;
      try { await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_ANNOUNCE_MARK_READ, requested); } catch { /* best effort */ }
    },
  },
  productHelp: {
    async escalate(request) {
      if (!isProductEscalateRequest(request)) return helpFailure('VALIDATION', { sessionEpoch: 0, generation: 0 });
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_ESCALATE, request);
        return isProductEscalateResult(value) && value.sessionEpoch === request.sessionEpoch && value.generation === request.generation
          ? value : helpFailure('UNAVAILABLE', request);
      } catch { return helpFailure('UNAVAILABLE', request); }
    },
    async recordTerminal(request) {
      if (!isProductTerminalRequest(request)) return helpFailure('VALIDATION', { sessionEpoch: 0, generation: 0 });
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_RECORD_TERMINAL, request);
        return isProductTerminalResult(value) && value.sessionEpoch === request.sessionEpoch && value.generation === request.generation
          ? value : helpFailure('UNAVAILABLE', request);
      } catch { return helpFailure('UNAVAILABLE', request); }
    },
  },
  productCatalog: {
    async list() {
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.PRODUCT_CATALOG);
        return isProductCatalogResult(value) ? value : catalogFailure('UNAVAILABLE');
      } catch { return catalogFailure('UNAVAILABLE'); }
    },
  },
  async copyText(text: string): Promise<CopyTextResult> {
    if (typeof text !== 'string') {
      return { ok: false, message: '复制内容无效' };
    }
    try {
      const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.COPY_TEXT, text);
      return isCopyTextResult(value) ? value : { ok: false, message: '复制失败，请重试' };
    } catch { return { ok: false, message: '复制失败，请重试' }; }
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
  dismiss(restorePreviousApp?: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.DISMISS, restorePreviousApp === true);
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
    // Report once per document, after the receiver exists. Main owns recovery
    // if QueryEntry's profile handshake outlived the initial open command.
    if (!subscriptionReported) {
      subscriptionReported = true;
      void ipcRenderer.invoke(IPC_CHANNELS.QUERY_SUBSCRIBED).catch(() => {
        console.error('Query subscription handshake failed');
      });
    }
    return () => {
      overlayListeners.delete(handler);
    };
  },
  sopWindow: {
    async ready(request) { return isSopReadyRequest(request) && await ipcRenderer.invoke('query-sop:ready', request) === true; },
    async rename(request) {
      if (!isSopRenameRequest(request)) return { ok: false, code: 'INVALID', message: '名称无效' };
      const value: unknown = await ipcRenderer.invoke('query-sop:rename', request);
      return isSopWindowResult(value) ? value : { ok: false, code: 'UNAVAILABLE', message: '名称修改失败' };
    },
    async renameCurrent(request) {
      if (!isSopExecutionRename(request)) return { ok: false, code: 'INVALID', message: '名称无效' };
      try {
        const value: unknown = await ipcRenderer.invoke('query-sop:rename-current', request);
        return isSopWindowResult(value) ? value : { ok: false, code: 'UNAVAILABLE', message: '名称修改失败' };
      } catch { return { ok: false, code: 'UNAVAILABLE', message: '名称修改失败' }; }
    },
    async draftCurrent(request) {
      if (!isSopDraftIdentity(request)) return { ok: false };
      try { const value: unknown = await ipcRenderer.invoke('query-sop:draft-current', request); return isSopDraftResult(value) ? value : { ok: false }; }
      catch { return { ok: false }; }
    },
    async draftStart(request) {
      if (!isSopDraftStart(request)) return { ok: false };
      try { const value: unknown = await ipcRenderer.invoke('query-sop:draft-start', request); return isSopDraftResult(value) ? value : { ok: false }; }
      catch { return { ok: false }; }
    },
    async draftUpdate(request) {
      if (!isSopDraftUpdate(request)) return false;
      try { return await ipcRenderer.invoke('query-sop:draft-update', request) === true; } catch { return false; }
    },
    async draftDiscard(request) {
      if (!isSopDraftDiscard(request)) return false;
      try { return await ipcRenderer.invoke('query-sop:draft-discard', request) === true; } catch { return false; }
    },
    onShowQueryRequest(callback) {
      const listener = (_event: unknown, value: unknown) => { if (isSopShowQueryRequest(value)) callback(value); };
      ipcRenderer.on('sop-window:show-query-request', listener);
      return () => { ipcRenderer.removeListener('sop-window:show-query-request', listener); };
    },
    async showQueryReady(request) {
      if (!isSopShowQueryReady(request)) return false;
      try { return await ipcRenderer.invoke('query-sop:show-query-ready', request) === true; } catch { return false; }
    },
    async endTask(request) {
      if (!isQuerySopRevision(request)) return { ok: false, code: 'INVALID', message: '待办无效' };
      const value: unknown = await ipcRenderer.invoke('query-sop:end-task', request);
      return isSopWindowResult(value) ? value : { ok: false, code: 'UNAVAILABLE', message: '结束待办失败' };
    },
    async windowIntent(request) {
      if (!isQuerySopWindowIntent(request)) return false;
      return (await ipcRenderer.invoke(IPC_CHANNELS.QUERY_SOP_WINDOW, request)) === true;
    },
    async current() {
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.QUERY_SOP_CURRENT);
        return isQuerySopSnapshot(value) ? value : SOP_UNAVAILABLE;
      } catch { return SOP_UNAVAILABLE; }
    },
    async navigate(request) {
      if (!isQuerySopNavigation(request)) return { ok: false, code: 'INVALID', message: '视图操作无效' };
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.QUERY_SOP_NAVIGATE, request);
        return isSopWindowResult(value) ? value : { ok: false, code: 'UNAVAILABLE', message: '视图切换失败，请重试' };
      } catch { return { ok: false, code: 'UNAVAILABLE', message: '视图切换失败，请重试' }; }
    },
    async command(request) {
      if (!isSopExecutionCommand(request)) return { ok: false, code: 'INVALID', message: '流程操作无效' };
      const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.QUERY_SOP_COMMAND, request);
      return isSopWindowResult(value) ? value : { ok: false, code: 'UNAVAILABLE', message: '流程操作失败' };
    },
    async copyCurrent(expected) {
      if (!isSopExecutionCopy(expected)) return { ok: false, message: '复制请求无效' };
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.QUERY_SOP_COPY, expected);
        return isSopCopyResult(value) ? value : { ok: false, message: '复制失败，请重试' };
      } catch { return { ok: false, message: '复制失败，请重试' }; }
    },
    onProjection(callback) {
      const listener = (_event: unknown, value: unknown) => { callback(isQuerySopSnapshot(value) ? value : SOP_UNAVAILABLE); };
      ipcRenderer.on(IPC_CHANNELS.SOP_WINDOW_PROJECTION, listener);
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.SOP_WINDOW_PROJECTION, listener); };
    },
    async open(sceneId) {
      if (typeof sceneId !== 'string' || sceneId.length === 0 || sceneId.length > 64) {
        return { ok: false as const, code: 'INVALID' as const, message: '流程参数无效' };
      }
      try {
        const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.SOP_WINDOW_OPEN, sceneId);
        const parsed = isSopWindowResult(value) ? value : null;
        return parsed ?? { ok: false as const, code: 'UNAVAILABLE' as const, message: '流程没打开' };
      } catch {
        return { ok: false as const, code: 'UNAVAILABLE' as const, message: '流程没打开' };
      }
    },
    async entryAvailable() {
      try {
        return (await ipcRenderer.invoke(IPC_CHANNELS.SOP_WINDOW_ENTRY_AVAILABLE)) === true;
      } catch {
        return false;
      }
    },
    async resumeAvailable() {
      try {
        return (await ipcRenderer.invoke(IPC_CHANNELS.SOP_WINDOW_RESUME_AVAILABLE)) === true;
      } catch {
        return false;
      }
    },
  },
};

contextBridge.exposeInMainWorld('customerAgent', api);
