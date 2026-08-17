import {
  app,
  BrowserWindow,
  globalShortcut,
  screen,
  systemPreferences,
  type WebContents,
} from 'electron';
import { join } from 'node:path';
import { IPC_CHANNELS } from '../shared/contracts';
import {
  FOX_EDGE_PEEK_TRAVEL_PX,
  FOX_SIZE,
  QUERY_INPUT_HEIGHT,
  QUERY_WIDTH,
  advanceFoxDockDragSession,
  availableOverlayHeight,
  clampRectToWorkArea,
  createFoxDockDragSession,
  defaultFoxRect,
  dockFoxNativeRect,
  finishFoxDockDragSession,
  foxDockDragSessionVisuallyUndocked,
  foxVisualCenterForNativeRect,
  inferFoxRectFromQuery,
  placeQueryAnchoredToFox,
  queryAnchorForFox,
  reconcileFoxDockEdgeForWorkArea,
  resolveSessionQueryAnchor,
  resolveFoxDockAfterDrag,
  sanitizeDragDelta,
  settleQueryDragGesture,
  type FoxDockDragSession,
  type Rect,
} from '../shared/overlay-geometry';
import {
  acceptQueryLayoutSequence,
  applyQueryVerticalResize,
  clampQueryDesiredHeight,
  pickQueryResizeEdgeForHeight,
  effectiveQuerySize,
  fallbackQuerySizeForPhase,
  isQueryContentLayoutPhase,
  queryHandoffCenterFromBounds,
  queryResizeDeltaForKey,
  QUERY_LAYOUT_FALLBACK_MS,
  rejectedQueryLayoutAck,
  resolveQueryResizeEdge,
  shouldIgnoreQueryLayout,
  type QueryLayoutAck,
  type QueryLayoutRequest,
  type QueryResizeEdge,
  type QueryResizeRequest,
} from '../shared/query-layout';
import {
  isOpenPhase,
  reduceOverlay,
  type OverlayEvent,
  type OverlayPhase,
} from '../shared/overlay-machine';
import type {
  FoxDockEdge,
  FoxDragSettleAck,
  FoxPeekIntent,
  FoxVisualTransform,
  HandoffMilestone,
  OverlayCommand,
  OverlayRole,
  QueryAnchor,
  ReportablePhase,
  ResultCount,
} from '../shared/overlay-events';
import { IDENTITY_FOX_VISUAL_TRANSFORM } from '../shared/overlay-events';
import {
  openDashboardUnavailable,
  type OpenDashboardResult,
} from '../shared/dashboard-access';
import { bindGlobalShortcut, DEFAULT_GLOBAL_ACCELERATOR } from '../shared/shortcut';
import { QUERY_CLOSE_DURATION_MS, QUERY_OPEN_DURATION_MS } from '../shared/fox-motion';
import {
  createDashboardBrowserWindow,
  readDashboardWindowSnapshot,
  type DashboardWindowSnapshot,
} from './dashboard-window';
import { GuardedScheduler } from './guarded-scheduler';
import {
  createShutdownFence,
  isInactiveOverlay,
  isUsableWindow,
  type ShutdownFence,
} from './shutdown-fence';
import { lockRendererWindow } from './window-security';
import { createOverlayChromeWindow, type OverlayChromeWindowSize } from './overlay-chrome-window';
import { loadRenderer } from './overlay-renderer-loader';
import { attachTestHarness } from './overlay-test-harness';

const BLUR_GRACE_MS = 240;
const HANDOFF_PREPARE_TIMEOUT_MS = 180;
const HANDOFF_FALLBACK_BUFFER_MS = 100;
const DISPLAY_RECONCILE_DELAY_MS = 100;

export type OverlayControllerOptions = {
  preloadPath?: string;
  accelerator?: string;
  testHarness?: boolean;
  fence?: ShutdownFence;
  rendererDevServerUrl?: string;
};

export class OverlayController {
  phase: OverlayPhase = 'FOX_IDLE';
  shortcutRegistered = false;
  shortcutMessage = '';
  resultCount: ResultCount = 0;
  readonly accelerator: string;
  readonly testHarness: boolean;

  private fox: BrowserWindow | null = null;
  private query: BrowserWindow | null = null;
  private dashboard: BrowserWindow | null = null;
  private foxOrigin = { x: 80, y: 80 };
  private foxDockEdge: FoxDockEdge = 'none';
  private queryDragAnchor: QueryAnchor | null = null;
  private foxPeekIntent: FoxPeekIntent = 'retract';
  private foxPeekEpoch = 0;
  private foxDragSession: FoxDockDragSession | null = null;
  private foxDragGeneration: number | null = null;
  private legacyFoxDragGenerationSequence = 0;
  private foxDragSettleSequence = 0;
  private awaitingFoxDragSettle: FoxDragSettleAck | null = null;
  private displayReconcilePending = false;
  private pendingOpenAfterFoxDrag = false;
  private postFoxDragTimer: ReturnType<typeof setTimeout> | null = null;
  private ignoreBlurUntil = 0;
  private pendingQueryBlur = false;
  private blurRecheckTimer: ReturnType<typeof setTimeout> | null = null;
  private chromeHandoffTimer: ReturnType<typeof setTimeout> | null = null;
  private queryFocusRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private displayReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private displayLifecycleBound = false;
  private chromeHandoffMode: 'preparing-open' | 'opening' | 'closing' | null = null;
  private chromeHandoffSequence = 0;
  private activeChromeHandoffId = 0;
  private chromeHandoffAnchor: 'left' | 'right' = 'left';
  private pendingFoxVisualTransform: FoxVisualTransform = IDENTITY_FOX_VISUAL_TRANSFORM;
  private lastQueryContentHeight: number | null = null;
  private manualQueryHeight: number | null = null;
  private lastQueryLayoutSequence = 0;
  private queryResizeEdge: QueryResizeEdge = 'bottom';
  private queryResizeSession: {
    sessionId: number;
    baseline: Rect;
    edge: QueryResizeEdge;
    finished: boolean;
    lastSequence: number;
    previousManualHeight: number | null;
  } | null = null;
  private queryLayoutFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private dashboardOpening: Promise<OpenDashboardResult> | null = null;
  private disposed = false;
  private readonly fence: ShutdownFence;
  private readonly scheduler = new GuardedScheduler();
  private readonly preloadPath: string;
  readonly rendererDevServerUrl: string | undefined;

  constructor(options: OverlayControllerOptions = {}) {
    this.preloadPath = options.preloadPath ?? join(__dirname, '../preload/index.cjs');
    this.accelerator = options.accelerator ?? DEFAULT_GLOBAL_ACCELERATOR;
    this.testHarness = options.testHarness ?? isTestHarnessEnabled();
    this.fence = options.fence ?? createShutdownFence();
    this.rendererDevServerUrl = options.rendererDevServerUrl;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  private isInactive(): boolean {
    return isInactiveOverlay(this.disposed, this.fence);
  }

  private live(win: BrowserWindow | null): win is BrowserWindow {
    return isUsableWindow(win, this.disposed, this.fence);
  }

  private isWindowVisible(win: BrowserWindow | null): win is BrowserWindow {
    return this.live(win) && win.isVisible();
  }

  getWindows(): BrowserWindow[] {
    return [this.fox, this.query].filter((win): win is BrowserWindow => Boolean(win && !win.isDestroyed()));
  }

  trustedContents(): WebContents[] {
    return this.getWindows().map((win) => win.webContents);
  }

  overlayRoleOf(contents: WebContents): OverlayRole | null {
    if (this.fox && !this.fox.isDestroyed() && this.fox.webContents.id === contents.id) {
      return 'fox';
    }
    if (this.query && !this.query.isDestroyed() && this.query.webContents.id === contents.id) {
      return 'query';
    }
    return null;
  }

  async start(): Promise<void> {
    if (this.isInactive()) {
      return;
    }
    this.fox = this.createChromeWindow({
      width: FOX_SIZE,
      height: FOX_SIZE,
      title: '客服话术浮窗 · Demo',
    });
    this.query = this.createChromeWindow({
      width: QUERY_WIDTH,
      height: QUERY_INPUT_HEIGHT,
      title: '客服话术查询 · Demo',
      backgroundThrottling: false,
      macPanel: false,
    });
    // Regular Dock / Cmd+Tab is the product requirement. Electron only allows
    // skipTransformProcessType when the process is already a UIElementApplication,
    // so this Demo keeps Query on the current Space instead of transforming type.

    this.bindWindowLifecycle(this.fox);
    this.bindWindowLifecycle(this.query);
    this.bindFoxNativeBoundsReadback(this.fox);
    this.query.on('blur', () => this.handleQueryBlur());
    this.query.on('focus', () => {
      this.clearPendingQueryBlur();
      this.clearQueryFocusRetry();
      if (isOpenPhase(this.phase) && this.live(this.query)) {
        this.query.webContents.focus();
      }
    });

    const loadStates = await Promise.all([
      loadRenderer(this.fox, 'fox', this.rendererDevServerUrl, () => this.isInactive()),
      loadRenderer(this.query, 'query', this.rendererDevServerUrl, () => this.isInactive()),
    ]);
    if (
      loadStates.includes('cancelled') ||
      this.isInactive() ||
      !this.live(this.fox) ||
      !this.live(this.query)
    ) {
      return;
    }

    const workArea = screen.getPrimaryDisplay().workArea;
    const placed = defaultFoxRect(workArea);
    this.foxOrigin = { x: placed.x, y: placed.y };
    this.fox.setBounds(placed);
    this.resetFoxPeekLifecycle('none');
    this.fox.showInactive();
    this.bindDisplayLifecycle();

    this.registerShortcut();
    this.broadcastShortcutStatus();

    if (this.testHarness) {
      attachTestHarness(this);
    }
  }

  openSearch(visualTransform: FoxVisualTransform = IDENTITY_FOX_VISUAL_TRANSFORM): void {
    if (this.isInactive()) {
      return;
    }
    if (isOpenPhase(this.phase)) {
      this.activateExisting();
      return;
    }
    // A global shortcut can arrive while the pointer still owns a dock-drag
    // transaction. Finish the native settle first so the shared-element handoff
    // starts from the same visual frame the renderer is still displaying.
    if (
      this.foxDragSession
      || this.foxDragGeneration !== null
      || this.awaitingFoxDragSettle !== null
    ) {
      this.pendingOpenAfterFoxDrag = true;
      this.pendingFoxVisualTransform = visualTransform;
      return;
    }
    this.advanceFoxPeekEpoch();
    const idleFox = this.fox;
    if (this.isWindowVisible(idleFox)) {
      this.syncFoxOriginFromNativeBounds(idleFox);
    }
    this.pendingFoxVisualTransform = visualTransform;
    this.applyEvent({ type: 'OPEN' });
  }

  dismiss(): void {
    if (this.isInactive()) {
      return;
    }
    this.finishOrClearQueryDrag();
    this.applyEvent({ type: 'DISMISS' });
  }

  toggle(): void {
    if (this.isInactive()) {
      return;
    }
    if (isOpenPhase(this.phase)) {
      this.dismiss();
      return;
    }
    this.openSearch();
  }

  activateExisting(): void {
    if (this.isInactive()) {
      return;
    }
    if (isOpenPhase(this.phase)) {
      this.armBlurGrace();
      if (this.isWindowVisible(this.query)) {
        this.focusQueryWindow();
        this.scheduleQueryFocusRetry();
        if (this.live(this.fox)) {
          this.fox.hide();
        }
      }
      if (this.chromeHandoffMode !== null) {
        return;
      }
      this.sendToQuery({
        type: 'activate-search',
        anchor: this.sessionQueryAnchor(),
        animate: false,
      });
      return;
    }
    this.openSearch();
  }

  async openDashboard(): Promise<OpenDashboardResult> {
    if (this.isInactive()) {
      return openDashboardUnavailable();
    }
    if (this.dashboardOpening) {
      return this.dashboardOpening;
    }
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      return this.revealDashboardWindow(this.dashboard);
    }

    const win = createDashboardBrowserWindow();
    lockRendererWindow(win);
    this.dashboard = win;
    win.on('closed', () => {
      if (this.dashboard === win) {
        this.dashboard = null;
      }
    });
    const opening = (async (): Promise<OpenDashboardResult> => {
      let loadState: 'loaded' | 'cancelled';
      try {
        loadState = await loadRenderer(
          win,
          'dashboard',
          this.rendererDevServerUrl,
          () => this.isInactive(),
        );
      } catch (error) {
        console.error('Failed to load Dashboard renderer', error);
        this.abandonDashboardWindow(win);
        return openDashboardUnavailable();
      }
      if (loadState === 'cancelled' || this.isInactive() || win.isDestroyed()) {
        this.abandonDashboardWindow(win);
        return openDashboardUnavailable();
      }
      return this.revealDashboardWindow(win);
    })();
    this.dashboardOpening = opening;
    try {
      return await opening;
    } finally {
      if (this.dashboardOpening === opening) {
        this.dashboardOpening = null;
      }
    }
  }

  private revealDashboardWindow(win: BrowserWindow): OpenDashboardResult {
    if (this.isInactive() || win.isDestroyed()) {
      this.abandonDashboardWindow(win);
      return openDashboardUnavailable();
    }
    try {
      if (win.isMinimized()) {
        win.restore();
      }
      if (this.isInactive() || win.isDestroyed()) {
        this.abandonDashboardWindow(win);
        return openDashboardUnavailable();
      }
      win.show();
      win.focus();
      if (this.isInactive() || win.isDestroyed()) {
        this.abandonDashboardWindow(win);
        return openDashboardUnavailable();
      }
    } catch (error) {
      console.error('Failed to reveal Dashboard window', error);
      this.abandonDashboardWindow(win);
      return openDashboardUnavailable();
    }
    this.dismiss();
    return { ok: true };
  }

  private abandonDashboardWindow(win: BrowserWindow): void {
    if (this.dashboard === win) {
      this.dashboard = null;
    }
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }

  closeDashboard(): void {
    if (this.isInactive()) {
      return;
    }
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      this.dashboard.close();
    }
  }

  dashboardSnapshot(): DashboardWindowSnapshot | null {
    if (!this.dashboard || this.dashboard.isDestroyed()) {
      return null;
    }
    return readDashboardWindowSnapshot(this.dashboard);
  }

  isDashboardTrusted(): boolean {
    if (!this.dashboard || this.dashboard.isDestroyed()) {
      return false;
    }
    return this.trustedContents().some((contents) => contents.id === this.dashboard?.webContents.id);
  }

  reportUiPhase(phase: ReportablePhase, resultCount: ResultCount): void {
    if (this.isInactive() || !isOpenPhase(this.phase)) {
      return;
    }
    this.phase = phase;
    this.resultCount = resultCount;
    if (phase === 'SEARCH_INPUT') {
      this.clearQueryHeightOverride();
      this.syncWindows({ activate: false });
      return;
    }
    if (phase === 'COPIED') {
      this.settleQueryResizeSession(true);
      this.clearQueryLayoutFallback();
      return;
    }
    if (!isQueryContentLayoutPhase(phase)) {
      this.settleQueryResizeSession(true);
    }
    this.scheduleQueryLayoutFallback();
  }

  reportQueryLayout(request: QueryLayoutRequest): QueryLayoutAck {
    if (this.isInactive()) {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    if (
      shouldIgnoreQueryLayout(this.chromeHandoffMode, this.phase) ||
      !isOpenPhase(this.phase) ||
      !isQueryContentLayoutPhase(this.phase) ||
      request.sessionId !== this.activeChromeHandoffId ||
      !acceptQueryLayoutSequence(this.lastQueryLayoutSequence, request.sequence)
    ) {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    if (request.phase !== this.phase || request.resultCount !== this.resultCount) {
      this.applyFallbackQueryHeight();
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }

    const workArea = this.currentWorkArea();
    const natural = clampQueryDesiredHeight(
      request.desiredHeight,
      this.availableQueryHeight(workArea),
    );
    this.lastQueryLayoutSequence = request.sequence;
    this.lastQueryContentHeight = natural;
    this.clearQueryLayoutFallback();
    const resizing = this.queryResizeSession !== null && !this.queryResizeSession.finished;
    const applied = this.manualQueryHeight ?? this.currentQueryHeight();
    if (!resizing && this.manualQueryHeight === null) {
      this.applyQueryHeight(natural, this.queryResizeEdgeForCurrent(workArea), true);
      return this.acceptedLayoutAck(request.sessionId, request.sequence);
    }
    return this.acceptedLayoutAck(request.sessionId, request.sequence, applied);
  }

  resizeQueryHeight(request: QueryResizeRequest): QueryLayoutAck {
    if (this.isInactive()) {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    if (
      request.sessionId !== this.activeChromeHandoffId ||
      !acceptQueryLayoutSequence(this.lastQueryLayoutSequence, request.sequence)
    ) {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }

    if (request.type === 'end' || request.type === 'cancel') {
      const session = this.queryResizeSession;
      if (
        !session ||
        session.finished ||
        session.sessionId !== request.sessionId ||
        !acceptQueryLayoutSequence(session.lastSequence, request.sequence)
      ) {
        return this.rejectedLayoutAck(request.sessionId, request.sequence);
      }
      session.lastSequence = request.sequence;
      this.lastQueryLayoutSequence = request.sequence;
      session.finished = true;
      this.queryResizeSession = null;
      if (request.type === 'cancel') {
        this.applyQueryHeight(session.baseline.height, session.edge);
        this.manualQueryHeight = session.previousManualHeight;
      } else {
        this.manualQueryHeight = this.currentQueryHeight();
      }
      return this.acceptedLayoutAck(request.sessionId, request.sequence);
    }

    if (
      shouldIgnoreQueryLayout(this.chromeHandoffMode, this.phase) ||
      !isOpenPhase(this.phase) ||
      !isQueryContentLayoutPhase(this.phase)
    ) {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }

    if (request.type === 'begin') {
      if (this.queryResizeSession && !this.queryResizeSession.finished) {
        return this.rejectedLayoutAck(request.sessionId, request.sequence);
      }
      const query = this.query;
      if (!this.live(query)) {
        return this.rejectedLayoutAck(request.sessionId, request.sequence);
      }
      const bounds = query.getBounds();
      const edge = this.queryResizeEdgeForCurrent(this.currentWorkArea());
      this.lastQueryLayoutSequence = request.sequence;
      this.queryResizeSession = {
        sessionId: request.sessionId,
        baseline: bounds,
        edge,
        finished: false,
        lastSequence: request.sequence,
        previousManualHeight: this.manualQueryHeight,
      };
      return this.acceptedLayoutAck(request.sessionId, request.sequence, bounds.height, edge);
    }

    if (request.type === 'keyboard') {
      if (this.queryResizeSession && !this.queryResizeSession.finished) {
        return this.rejectedLayoutAck(request.sessionId, request.sequence);
      }
      this.lastQueryLayoutSequence = request.sequence;
      const workArea = this.currentWorkArea();
      const delta = queryResizeDeltaForKey(request.key, request.shiftKey);
      const currentHeight = this.currentQueryHeight();
      const natural = this.lastQueryContentHeight ?? fallbackQuerySizeForPhase(
        this.phase,
        this.resultCount,
        workArea,
      ).height;
      const nextHeight =
        delta === 'natural'
          ? natural
          : delta === 'max'
            ? this.availableQueryHeight(workArea)
            : currentHeight + delta;
      this.manualQueryHeight = this.applyQueryHeight(
        nextHeight,
        this.queryResizeEdgeForCurrent(workArea),
      );
      return this.acceptedLayoutAck(request.sessionId, request.sequence);
    }

    const session = this.queryResizeSession;
    if (
      !session ||
      session.finished ||
      session.sessionId !== request.sessionId ||
      !acceptQueryLayoutSequence(session.lastSequence, request.sequence)
    ) {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    session.lastSequence = request.sequence;
    this.lastQueryLayoutSequence = request.sequence;

    if (request.type === 'update') {
      const signed = session.edge === 'top' ? -request.deltaY : request.deltaY;
      const nextHeight = session.baseline.height + signed;
      this.applyQueryHeight(nextHeight, session.edge);
      return this.acceptedLayoutAck(request.sessionId, request.sequence, this.currentQueryHeight(), session.edge);
    }

    return this.rejectedLayoutAck(request.sessionId, request.sequence);
  }

  reportHandoffMilestone(handoffId: number, milestone: HandoffMilestone): void {
    if (this.isInactive() || handoffId !== this.activeChromeHandoffId) {
      return;
    }
    if (milestone === 'open-armed' && this.chromeHandoffMode === 'preparing-open') {
      this.startPreparedOpen(handoffId, true);
      return;
    }
    if (milestone === 'open-finished' && this.chromeHandoffMode === 'opening') {
      this.finishOpeningHandoff(handoffId);
      return;
    }
    if (milestone === 'close-finished' && this.chromeHandoffMode === 'closing') {
      this.finishClosingHandoff(handoffId);
    }
  }

  moveBy(
    dx: unknown,
    dy: unknown,
    finished = false,
    generation?: number,
  ): FoxDragSettleAck | null {
    if (this.isInactive()) {
      return null;
    }
    const delta = sanitizeDragDelta(dx, dy);
    if (!delta) {
      if (finished) {
        this.finishOrClearQueryDrag();
      }
      return null;
    }
    const target = this.isWindowVisible(this.query) ? this.query : this.fox;
    if (!target || target.isDestroyed()) {
      return null;
    }
    let foxGeneration: number | null = null;
    if (target === this.fox) {
      foxGeneration = generation ?? this.legacyFoxDragGeneration(finished);
      if (foxGeneration === null) {
        return null;
      }
      if (!finished) {
        if (this.foxDragGeneration === null) {
          this.foxDragGeneration = foxGeneration;
          // A real move from a newer renderer generation supersedes any final
          // frame that the previous generation never committed. Clear this
          // unconditionally because a renderer reload may restart generation
          // numbering at 1 while Main's settleId remains monotonic.
          this.awaitingFoxDragSettle = null;
        } else if (this.foxDragGeneration !== foxGeneration) {
          return null;
        }
      } else if (this.foxDragGeneration !== foxGeneration) {
        // A finished message without the matching native session is stale or
        // out of order. Never manufacture a settle ACK for it.
        return null;
      }
    }
    const nativeBounds = target.getBounds();
    const sessionWorkArea = this.testHarness
      ? screen.getDisplayNearestPoint({
          x: Math.round(nativeBounds.x + nativeBounds.width / 2),
          y: Math.round(nativeBounds.y + nativeBounds.height / 2),
        }).workArea
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    if (target === this.fox && !finished) {
      if (
        !this.foxDragSession
        && (this.foxDockEdge === 'left' || this.foxDockEdge === 'right')
      ) {
        this.foxDragSession = createFoxDockDragSession(
          this.foxDockEdge,
          this.foxPeekIntent === 'peek',
          nativeBounds,
        );
      }
      if (this.foxDragSession) {
        const stepped = advanceFoxDockDragSession(
          this.foxDragSession,
          delta.dx,
          delta.dy,
          sessionWorkArea,
        );
        this.foxDragSession = stepped.session;
        target.setBounds(stepped.nativeRect);
        this.clearQueryDragGesture();
        this.foxOrigin = { x: stepped.nativeRect.x, y: stepped.nativeRect.y };
        if (
          foxDockDragSessionVisuallyUndocked(stepped.session)
          && this.foxDockEdge !== 'none'
        ) {
          this.foxDockEdge = 'none';
          this.resetFoxPeekLifecycle('none');
        }
        return null;
      }
    }
    const bounds = nativeBounds;
    const candidate = { ...bounds, x: bounds.x + delta.dx, y: bounds.y + delta.dy };
    // During a real drag the pointer is the only reliable way to cross a display seam:
    // clamping an incremental rectangle to its old display would otherwise trap it there.
    const targetDisplay = this.testHarness
      ? screen.getDisplayNearestPoint({
          x: Math.round(candidate.x + candidate.width / 2),
          y: Math.round(candidate.y + candidate.height / 2),
        })
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const workArea = targetDisplay.workArea;
    const next = clampRectToWorkArea(
      candidate,
      workArea,
      target === this.fox ? 0 : undefined,
    );
    target.setBounds(next);
    if (target === this.fox) {
      this.clearQueryDragGesture();
      this.foxOrigin = { x: next.x, y: next.y };
    } else if (this.phase !== 'FOX_IDLE' && this.chromeHandoffMode !== 'closing' && this.chromeHandoffMode !== 'preparing-open') {
      if (this.queryDragAnchor === null) {
        this.queryDragAnchor = this.currentQueryAnchor();
      }
      const inferredFox = inferFoxRectFromQuery(next, workArea, this.queryDragAnchor);
      this.foxOrigin = { x: inferredFox.x, y: inferredFox.y };
    } else {
      this.clearQueryDragGesture();
    }
    if (finished) {
      if (target === this.fox) {
        const session = this.foxDragSession;
        this.foxDragSession = null;
        const settledGeneration = this.foxDragGeneration;
        this.foxDragGeneration = null;
        if (settledGeneration === null) {
          return null;
        }
        const inferredFox = {
          x: this.foxOrigin.x,
          y: this.foxOrigin.y,
          width: FOX_SIZE,
          height: FOX_SIZE,
        };
        const foxWorkArea = screen.getDisplayMatching(inferredFox).workArea;
        const settled = session
          ? finishFoxDockDragSession(session, foxWorkArea)
          : {
              rect: dockFoxNativeRect(
                inferredFox,
                foxWorkArea,
                resolveFoxDockAfterDrag(inferredFox, foxWorkArea),
              ),
              edge: resolveFoxDockAfterDrag(inferredFox, foxWorkArea),
            };
        this.foxDockEdge = settled.edge;
        this.fox.setBounds(settled.rect);
        this.foxOrigin = { x: settled.rect.x, y: settled.rect.y };
        const epoch = this.resetFoxPeekLifecycle(settled.edge);
        const settle: FoxDragSettleAck = {
          edge: settled.edge,
          epoch,
          generation: settledGeneration,
          settleId: ++this.foxDragSettleSequence,
        };
        this.awaitingFoxDragSettle = settle;
        this.sendToFox({ type: 'fox-drag-settled', ...settle });
        this.clearQueryDragGesture();
        this.schedulePostFoxDragWork();
        return settle;
      } else {
        this.settlePinnedQueryDrag(next, workArea);
      }
    }
    return null;
  }

  commitFoxDragSettle(settleId: number): void {
    if (this.isInactive()) {
      return;
    }
    const awaiting = this.awaitingFoxDragSettle;
    if (!awaiting || awaiting.settleId !== settleId) {
      return;
    }
    this.awaitingFoxDragSettle = null;
    if (this.foxDragSession || this.foxDragGeneration !== null) {
      return;
    }
    if (!this.pendingOpenAfterFoxDrag) {
      return;
    }
    const visualTransform = this.pendingFoxVisualTransform;
    this.pendingOpenAfterFoxDrag = false;
    // Main owns this transition: clearing the final settle fence and starting
    // the Query handoff happen in the same event-loop turn.
    this.openSearch(visualTransform);
  }

  setFoxPeek(intent: FoxPeekIntent, epoch: number): void {
    const fox = this.fox;
    if (
      this.isInactive() ||
      !this.live(fox) ||
      !fox.isVisible() ||
      this.phase !== 'FOX_IDLE' ||
      this.foxDockEdge === 'none' ||
      epoch !== this.foxPeekEpoch
    ) {
      return;
    }
    // Peek/retract is a renderer-only crop. Read the frame that WindowServer
    // accepted, but never try to move the native window in response to hover.
    // This avoids a Stage Manager loop where x=0 is repeatedly requested and
    // macOS repeatedly seats the background overlay at its active-stage edge.
    this.syncFoxOriginFromNativeBounds(fox);
    if (intent === this.foxPeekIntent) {
      return;
    }
    this.foxPeekIntent = intent;
  }

  beginNativeContextMenu(win: BrowserWindow): () => void {
    if (win !== this.query) {
      return () => undefined;
    }
    // A native edit/context menu can temporarily blur the frameless query window.
    // Keep it open until Electron reports that the menu has closed, then restore
    // the normal short grace period used by other trusted desktop transitions.
    this.ignoreBlurUntil = Number.POSITIVE_INFINITY;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.armBlurGrace();
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearQueryDragGesture();
    this.unbindDisplayLifecycle();
    this.clearPendingQueryBlur();
    this.clearQueryFocusRetry();
    this.cancelChromeHandoff();
    this.clearQueryLayoutFallback();
    this.displayReconcilePending = false;
    this.pendingOpenAfterFoxDrag = false;
    this.foxDragSession = null;
    this.foxDragGeneration = null;
    this.awaitingFoxDragSettle = null;
    this.scheduler.clear(this.postFoxDragTimer);
    this.postFoxDragTimer = null;
    this.queryResizeSession = null;
    this.scheduler.dispose();
    globalShortcut.unregisterAll();
  }

  private applyEvent(event: OverlayEvent): void {
    if (this.isInactive()) {
      return;
    }
    const next = reduceOverlay(this.phase, event);
    if (next === this.phase && event.type !== 'OPEN') {
      if (event.type === 'TOGGLE' || event.type === 'DISMISS') {
        return;
      }
    }
    this.phase = next;
    if (next === 'FOX_IDLE' || next === 'SEARCH_INPUT') {
      this.resultCount = 0;
      this.clearQueryHeightOverride();
    }
    this.syncWindows({ activate: next === 'SEARCH_INPUT' && event.type !== 'DISMISS' });
  }

  private syncWindows(options: { activate?: boolean } = {}): void {
    const fox = this.fox;
    const query = this.query;
    if (!this.live(fox) || !this.live(query)) {
      return;
    }

    if (this.phase === 'FOX_IDLE') {
      this.finishOrClearQueryDrag();
      this.clearPendingQueryBlur();
      const workArea = this.currentWorkArea();
      const foxRect = clampRectToWorkArea(
        {
          x: this.foxOrigin.x,
          y: this.foxOrigin.y,
          width: FOX_SIZE,
          height: FOX_SIZE,
        },
        workArea,
        0,
      );
      this.armBlurGrace();
      const shouldAnimate =
        this.isWindowVisible(query) &&
        this.chromeHandoffMode !== 'preparing-open' &&
        !this.prefersReducedMotion();
      this.cancelChromeHandoff();
      const handoffId = this.nextChromeHandoffId();
      this.chromeHandoffAnchor = this.sessionQueryAnchor(queryAnchorForFox(foxRect, workArea));
      this.chromeHandoffMode = shouldAnimate ? 'closing' : null;
      const queryBounds = query.getBounds();
      const foxVisualCenter = this.currentFoxVisualCenter({ includePeek: false });
      const handoffCenter = queryHandoffCenterFromBounds(foxVisualCenter, queryBounds);
      this.sendToQuery({
        type: 'collapse',
        handoffId,
        anchor: this.chromeHandoffAnchor,
        dockEdge: this.foxDockEdge,
        animate: shouldAnimate,
        handoffCenterX: handoffCenter.x,
        handoffCenterY: handoffCenter.y,
      });
      this.resetFoxPeekLifecycle(this.foxDockEdge);
      if (!shouldAnimate) {
        this.finishClosingHandoff(handoffId);
        return;
      }
      this.chromeHandoffTimer = this.scheduler.schedule(() => {
        this.chromeHandoffTimer = null;
        this.finishClosingHandoff(handoffId);
      }, QUERY_CLOSE_DURATION_MS + HANDOFF_FALLBACK_BUFFER_MS);
      return;
    }

    const workArea = this.currentWorkArea();
    const size = this.currentQuerySize(workArea);
    const fullFoxRect: Rect = {
      x: this.foxOrigin.x,
      y: this.foxOrigin.y,
      width: FOX_SIZE,
      height: FOX_SIZE,
    };
    const placed = placeQueryAnchoredToFox(
      fullFoxRect,
      size,
      workArea,
      this.foxDockEdge,
      this.queryDragAnchor ?? undefined,
    );
    if (options.activate) {
      this.clearPendingQueryBlur();
    }
    this.armBlurGrace();
    query.setBounds(placed);
    const acceptedQueryBounds = query.getBounds();
    if (options.activate) {
      this.cancelChromeHandoff();
      const handoffId = this.nextChromeHandoffId();
      const anchor = this.sessionQueryAnchor(queryAnchorForFox(fullFoxRect, workArea));
      const foxVisualCenter = this.currentFoxVisualCenter();
      this.chromeHandoffMode = 'preparing-open';
      this.chromeHandoffAnchor = anchor;
      this.sendToQuery({
        type: 'prepare-search',
        handoffId,
        anchor,
        handoffCenterX: foxVisualCenter.x - acceptedQueryBounds.x,
        handoffCenterY: foxVisualCenter.y - acceptedQueryBounds.y,
        foxVisualTransform: this.pendingFoxVisualTransform,
      });
      this.pendingFoxVisualTransform = IDENTITY_FOX_VISUAL_TRANSFORM;
      this.chromeHandoffTimer = this.scheduler.schedule(() => {
        this.chromeHandoffTimer = null;
        this.startPreparedOpen(handoffId, false);
      }, HANDOFF_PREPARE_TIMEOUT_MS);
      return;
    }
    if (this.chromeHandoffMode === null && this.isWindowVisible(fox)) {
      fox.hide();
    }
  }

  private startPreparedOpen(handoffId: number, rendererArmed: boolean): void {
    const fox = this.fox;
    const query = this.query;
    if (
      this.isInactive() ||
      handoffId !== this.activeChromeHandoffId ||
      this.chromeHandoffMode !== 'preparing-open' ||
      !isOpenPhase(this.phase) ||
      !this.live(fox) ||
      !this.live(query)
    ) {
      return;
    }
    this.clearChromeHandoffTimer();
    // Electron 39/macOS can reapply the native cascade position when a hidden
    // transparent BrowserWindow is shown for the first time. Preserve the
    // prepared frame and restore it immediately after show so the proxy fox and
    // the native fox share one screen-space center during the handoff.
    const preparedBounds = query.getBounds();
    query.webContents.invalidate();
    query.show();
    query.setBounds(preparedBounds);
    fox.hide();
    // Hide the previously focused fox before the final focus handoff. On macOS
    // WindowServer can process a later fox.hide() as an app deactivation and
    // revoke focus that was just assigned to Query.
    this.focusQueryWindow();
    this.scheduleQueryFocusRetry();
    const animate = rendererArmed && !this.prefersReducedMotion();
    this.chromeHandoffMode = 'opening';
    this.sendToQuery({
      type: 'activate-search',
      handoffId,
      anchor: this.chromeHandoffAnchor,
      animate,
    });
    if (!animate) {
      this.finishOpeningHandoff(handoffId);
      return;
    }
    this.chromeHandoffTimer = this.scheduler.schedule(() => {
      this.chromeHandoffTimer = null;
      this.finishOpeningHandoff(handoffId);
    }, QUERY_OPEN_DURATION_MS + HANDOFF_FALLBACK_BUFFER_MS);
  }

  private finishOpeningHandoff(handoffId: number): void {
    if (
      this.isInactive() ||
      handoffId !== this.activeChromeHandoffId ||
      (this.chromeHandoffMode !== 'opening' && this.chromeHandoffMode !== 'preparing-open')
    ) {
      return;
    }
    this.clearChromeHandoffTimer();
    this.chromeHandoffMode = null;
    if (this.live(this.fox)) {
      this.fox.hide();
    }
    if (process.platform === 'darwin' && this.live(this.query)) {
      this.query.invalidateShadow();
    }
  }

  private finishClosingHandoff(handoffId: number): void {
    if (
      this.isInactive() ||
      handoffId !== this.activeChromeHandoffId ||
      (this.chromeHandoffMode !== 'closing' && this.phase !== 'FOX_IDLE')
    ) {
      return;
    }
    const fox = this.fox;
    const query = this.query;
    if (!this.live(fox) || !this.live(query)) {
      this.clearQueryDragGesture();
      return;
    }
    this.clearChromeHandoffTimer();
    this.chromeHandoffMode = null;
    this.clearQueryDragGesture();
    const workArea = this.currentWorkArea();
    const foxRect = clampRectToWorkArea(
      { x: this.foxOrigin.x, y: this.foxOrigin.y, width: FOX_SIZE, height: FOX_SIZE },
      workArea,
      0,
    );
    const currentBounds = fox.getBounds();
    if (
      currentBounds.x !== foxRect.x ||
      currentBounds.y !== foxRect.y ||
      currentBounds.width !== foxRect.width ||
      currentBounds.height !== foxRect.height
    ) {
      fox.setBounds(foxRect);
    }
    // Reuse the last accepted native frame when remapping the Fox. If macOS
    // applies another stage boundary after show, the move/moved readback below
    // adopts that frame without issuing a compensating setBounds call.
    fox.showInactive();
    this.syncFoxOriginFromNativeBounds(fox);
    if (process.platform === 'darwin') {
      query.invalidateShadow();
    }
    query.hide();
  }

  private focusQueryWindow(): void {
    const query = this.query;
    if (!this.live(query)) {
      return;
    }
    try {
      app.focus(process.platform === 'darwin' ? { steal: true } : undefined);
    } catch {
      // Some Linux window managers do not support explicit application focus.
    }
    query.focus();
    query.webContents.focus();
  }

  private scheduleQueryFocusRetry(): void {
    this.clearQueryFocusRetry();
    // Mapping a hidden macOS panel and assigning native focus are separate
    // WindowServer operations. Reconcile once after two compositor frames;
    // renderer rAF focus alone cannot route physical keyboard events.
    this.queryFocusRetryTimer = this.scheduler.schedule(() => {
      this.queryFocusRetryTimer = null;
      if (isOpenPhase(this.phase) && this.isWindowVisible(this.query)) {
        this.focusQueryWindow();
      }
    }, 34);
  }

  private clearQueryFocusRetry(): void {
    this.scheduler.clear(this.queryFocusRetryTimer);
    this.queryFocusRetryTimer = null;
  }

  private bindDisplayLifecycle(): void {
    if (this.displayLifecycleBound) {
      return;
    }
    this.displayLifecycleBound = true;
    screen.on('display-added', this.scheduleDisplayReconcile);
    screen.on('display-removed', this.scheduleDisplayReconcile);
    screen.on('display-metrics-changed', this.scheduleDisplayReconcile);
  }

  private unbindDisplayLifecycle(): void {
    if (!this.displayLifecycleBound) {
      return;
    }
    this.displayLifecycleBound = false;
    screen.removeListener('display-added', this.scheduleDisplayReconcile);
    screen.removeListener('display-removed', this.scheduleDisplayReconcile);
    screen.removeListener('display-metrics-changed', this.scheduleDisplayReconcile);
    this.scheduler.clear(this.displayReconcileTimer);
    this.displayReconcileTimer = null;
  }

  private readonly scheduleDisplayReconcile = (): void => {
    if (this.isInactive()) {
      return;
    }
    this.scheduler.clear(this.displayReconcileTimer);
    this.displayReconcileTimer = this.scheduler.schedule(() => {
      this.displayReconcileTimer = null;
      this.reconcileDisplayTopology();
    }, DISPLAY_RECONCILE_DELAY_MS);
  };

  private reconcileDisplayTopology(): void {
    const fox = this.fox;
    const query = this.query;
    if (!this.live(fox) || !this.live(query) || this.isInactive()) {
      return;
    }
    // Let the shared-element transaction finish before changing either native
    // frame. Otherwise an unplugged display could interrupt a prepared handoff.
    if (this.chromeHandoffMode !== null) {
      this.scheduleDisplayReconcile();
      return;
    }

    // Display topology is authoritative, but interrupting an in-flight dock
    // drag would split Main's native frame from the renderer's crop offset.
    // Defer one reconcile until the finished drag acknowledgement is produced.
    if (this.foxDragSession || this.foxDragGeneration !== null) {
      this.displayReconcilePending = true;
      return;
    }

    this.finishOrClearQueryDrag();

    const point = {
      x: Math.round(this.foxOrigin.x + FOX_SIZE / 2),
      y: Math.round(this.foxOrigin.y + FOX_SIZE / 2),
    };
    const workArea = screen.getDisplayNearestPoint(point).workArea;
    this.foxDockEdge = reconcileFoxDockEdgeForWorkArea(
      point.x,
      workArea,
      this.foxDockEdge,
    );
    const clampedFox = clampRectToWorkArea(
      {
        x: this.foxOrigin.x,
        y: this.foxOrigin.y,
        width: FOX_SIZE,
        height: FOX_SIZE,
      },
      workArea,
    );
    if (this.foxDockEdge === 'left') {
      clampedFox.x = workArea.x;
    } else if (this.foxDockEdge === 'right') {
      clampedFox.x = workArea.x + workArea.width - FOX_SIZE;
    }
    this.foxOrigin = { x: clampedFox.x, y: clampedFox.y };
    this.foxPeekIntent = 'retract';
    this.sendToFox({
      type: 'sync-fox-edge',
      edge: this.foxDockEdge,
      epoch: this.advanceFoxPeekEpoch(),
    });

    if (this.phase === 'FOX_IDLE') {
      fox.setBounds(dockFoxNativeRect(clampedFox, workArea, this.foxDockEdge));
      return;
    }

    const size = this.currentQuerySize(workArea);
    const anchor = this.sessionQueryAnchor(queryAnchorForFox(clampedFox, workArea));
    query.setBounds(
      placeQueryAnchoredToFox(
        clampedFox,
        size,
        workArea,
        this.foxDockEdge,
        this.queryDragAnchor ?? undefined,
      ),
    );
    this.sendToQuery({ type: 'sync-query-anchor', anchor });
  }

  private currentQuerySize(workArea: Rect) {
    return effectiveQuerySize({
      phase: this.phase,
      resultCount: this.resultCount,
      workArea,
      measuredHeight: this.lastQueryContentHeight,
      manualHeight: this.manualQueryHeight,
    });
  }

  private currentQueryHeight(): number {
    if (this.live(this.query)) {
      return this.query.getBounds().height;
    }
    return this.currentQuerySize(this.currentWorkArea()).height;
  }

  private availableQueryHeight(workArea: Rect): number {
    return availableOverlayHeight(workArea);
  }

  private queryResizeEdgeForCurrent(workArea: Rect): QueryResizeEdge {
    if (this.live(this.query)) {
      this.queryResizeEdge = resolveQueryResizeEdge(this.query.getBounds(), workArea);
    }
    return this.queryResizeEdge;
  }

  private applyQueryHeight(
    nextHeight: number,
    edge: QueryResizeEdge,
    allowFlip = false,
  ): number {
    const query = this.query;
    if (!this.live(query)) {
      return nextHeight;
    }
    const workArea = this.currentWorkArea();
    const current = query.getBounds();
    const chosen = allowFlip
      ? pickQueryResizeEdgeForHeight(current, nextHeight, workArea, edge)
      : edge;
    const next = applyQueryVerticalResize(current, nextHeight, chosen, workArea);
    this.queryResizeEdge = chosen;
    query.setBounds(next);
    return next.height;
  }

  private clearQueryHeightOverride(): void {
    this.lastQueryContentHeight = null;
    this.manualQueryHeight = null;
    this.queryResizeSession = null;
    this.queryResizeEdge = 'bottom';
    this.clearQueryLayoutFallback();
  }

  private scheduleQueryLayoutFallback(): void {
    this.clearQueryLayoutFallback();
    this.queryLayoutFallbackTimer = this.scheduler.schedule(() => {
      this.queryLayoutFallbackTimer = null;
      if (this.isInactive()) {
        return;
      }
      this.applyFallbackQueryHeight();
      if (this.activeChromeHandoffId <= 0) {
        return;
      }
      this.lastQueryLayoutSequence += 1;
      this.sendToQuery({
        type: 'query-layout-ack',
        sessionId: this.activeChromeHandoffId,
        sequence: this.lastQueryLayoutSequence,
        phase: this.phase === 'FOX_IDLE' ? 'SEARCH_INPUT' : this.phase,
        resultCount: this.resultCount,
        height: this.currentQueryHeight(),
        resizeEdge: this.queryResizeEdge,
      });
    }, QUERY_LAYOUT_FALLBACK_MS);
  }

  private clearQueryLayoutFallback(): void {
    this.scheduler.clear(this.queryLayoutFallbackTimer);
    this.queryLayoutFallbackTimer = null;
  }

  private settleQueryResizeSession(commit: boolean): void {
    const session = this.queryResizeSession;
    if (!session || session.finished) {
      return;
    }
    session.finished = true;
    this.queryResizeSession = null;
    if (commit) {
      this.manualQueryHeight = this.currentQueryHeight();
      return;
    }
    this.applyQueryHeight(session.baseline.height, session.edge);
    this.manualQueryHeight = session.previousManualHeight;
  }

  private reportablePhase(): ReportablePhase {
    return this.phase === 'FOX_IDLE' ? 'SEARCH_INPUT' : this.phase;
  }

  private acceptedLayoutAck(
    sessionId: number,
    sequence: number,
    height = this.currentQueryHeight(),
    resizeEdge = this.queryResizeEdge,
  ): QueryLayoutAck {
    return {
      ok: true,
      sessionId,
      sequence,
      phase: this.reportablePhase(),
      resultCount: this.resultCount,
      height,
      resizeEdge,
    };
  }

  private rejectedLayoutAck(sessionId: number, sequence: number): QueryLayoutAck {
    return rejectedQueryLayoutAck(
      sessionId,
      sequence,
      this.currentQueryHeight(),
      this.queryResizeEdge,
      this.reportablePhase(),
      this.resultCount,
    );
  }

  queryLayoutDebugState(): {
    handoffId: number;
    lastSequence: number;
    phase: OverlayPhase;
    resultCount: ResultCount;
    resizeSession: { sessionId: number; finished: boolean; lastSequence: number } | null;
  } {
    return {
      handoffId: this.activeChromeHandoffId,
      lastSequence: this.lastQueryLayoutSequence,
      phase: this.phase,
      resultCount: this.resultCount,
      resizeSession: this.queryResizeSession
        ? {
            sessionId: this.queryResizeSession.sessionId,
            finished: this.queryResizeSession.finished,
            lastSequence: this.queryResizeSession.lastSequence,
          }
        : null,
    };
  }

  private applyFallbackQueryHeight(): void {
    if (this.manualQueryHeight !== null || this.queryResizeSession) {
      return;
    }
    const workArea = this.currentWorkArea();
    const fallback = fallbackQuerySizeForPhase(this.phase, this.resultCount, workArea);
    this.applyQueryHeight(fallback.height, this.queryResizeEdgeForCurrent(workArea), true);
  }

  private currentWorkArea(): Rect {
    const point = {
      x: Math.round(this.foxOrigin.x + FOX_SIZE / 2),
      y: Math.round(this.foxOrigin.y + FOX_SIZE / 2),
    };
    return screen.getDisplayNearestPoint(point).workArea;
  }

  private currentFoxVisualCenter(
    options: { includePeek?: boolean } = {},
  ): { x: number; y: number } {
    const fullFoxRect = {
      x: this.foxOrigin.x,
      y: this.foxOrigin.y,
      width: FOX_SIZE,
      height: FOX_SIZE,
    };
    const peekOffset =
      options.includePeek !== false && this.foxPeekIntent === 'peek'
        ? FOX_EDGE_PEEK_TRAVEL_PX
        : 0;
    return foxVisualCenterForNativeRect(fullFoxRect, this.foxDockEdge, peekOffset);
  }

  private registerShortcut(): void {
    const result = bindGlobalShortcut(
      (accelerator) =>
        globalShortcut.register(accelerator, () => {
          this.toggle();
        }),
      this.accelerator,
      process.platform,
    );
    this.shortcutRegistered = result.ok;
    this.shortcutMessage = result.ok ? '' : result.message;
  }

  private broadcastShortcutStatus(): void {
    const command: OverlayCommand = {
      type: 'shortcut-status',
      registered: this.shortcutRegistered,
      accelerator: this.accelerator,
      message: this.shortcutMessage,
    };
    for (const win of this.getWindows()) {
      if (this.live(win) && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.OVERLAY_COMMAND, command);
      }
    }
  }

  private sendToFox(command: OverlayCommand): void {
    if (this.live(this.fox) && !this.fox.webContents.isDestroyed()) {
      this.fox.webContents.send(IPC_CHANNELS.OVERLAY_COMMAND, command);
    }
  }

  private advanceFoxPeekEpoch(): number {
    this.foxPeekEpoch += 1;
    return this.foxPeekEpoch;
  }

  private resetFoxPeekLifecycle(edge: FoxDockEdge): number {
    this.foxPeekIntent = 'retract';
    const epoch = this.advanceFoxPeekEpoch();
    this.sendToFox({ type: 'fox-edge', edge, epoch });
    return epoch;
  }

  private schedulePostFoxDragWork(): void {
    if (this.postFoxDragTimer !== null || this.isInactive()) {
      return;
    }
    this.postFoxDragTimer = this.scheduler.schedule(() => {
      this.postFoxDragTimer = null;
      if (this.isInactive() || this.foxDragSession || this.foxDragGeneration !== null) {
        return;
      }
      if (this.displayReconcilePending) {
        this.displayReconcilePending = false;
        this.reconcileDisplayTopology();
      }
    }, 0);
  }

  private sendToQuery(command: OverlayCommand): void {
    if (this.live(this.query) && !this.query.webContents.isDestroyed()) {
      this.query.webContents.send(IPC_CHANNELS.OVERLAY_COMMAND, command);
    }
  }

  private legacyFoxDragGeneration(finished: boolean): number | null {
    if (!this.testHarness) {
      return null;
    }
    if (this.foxDragGeneration !== null) {
      return this.foxDragGeneration;
    }
    if (finished) {
      return null;
    }
    this.legacyFoxDragGenerationSequence += 1;
    return this.legacyFoxDragGenerationSequence;
  }

  private armBlurGrace(): void {
    this.ignoreBlurUntil = Date.now() + BLUR_GRACE_MS;
    this.schedulePendingBlurRecheck();
  }

  private handleQueryBlur(): void {
    if (this.isInactive() || this.phase === 'FOX_IDLE' || !this.isWindowVisible(this.query)) {
      this.clearPendingQueryBlur();
      return;
    }
    this.pendingQueryBlur = true;
    this.schedulePendingBlurRecheck();
  }

  private schedulePendingBlurRecheck(): void {
    this.scheduler.clear(this.blurRecheckTimer);
    this.blurRecheckTimer = null;
    if (this.isInactive() || !this.pendingQueryBlur) {
      return;
    }
    const remaining = this.ignoreBlurUntil - Date.now();
    if (!Number.isFinite(remaining)) {
      return;
    }
    if (remaining > 0) {
      this.blurRecheckTimer = this.scheduler.schedule(() => {
        this.blurRecheckTimer = null;
        this.schedulePendingBlurRecheck();
      }, remaining + 8);
      return;
    }
    this.pendingQueryBlur = false;
    if (this.phase !== 'FOX_IDLE' && this.isWindowVisible(this.query)) {
      this.dismiss();
    }
  }

  private clearPendingQueryBlur(): void {
    this.pendingQueryBlur = false;
    this.scheduler.clear(this.blurRecheckTimer);
    this.blurRecheckTimer = null;
  }

  private cancelChromeHandoff(): void {
    this.clearChromeHandoffTimer();
    this.clearQueryFocusRetry();
    this.chromeHandoffMode = null;
    this.activeChromeHandoffId = 0;
  }

  private clearChromeHandoffTimer(): void {
    this.scheduler.clear(this.chromeHandoffTimer);
    this.chromeHandoffTimer = null;
  }

  private nextChromeHandoffId(): number {
    this.chromeHandoffSequence += 1;
    this.activeChromeHandoffId = this.chromeHandoffSequence;
    this.lastQueryLayoutSequence = 0;
    return this.activeChromeHandoffId;
  }

  private prefersReducedMotion(): boolean {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return false;
    }
    try {
      return systemPreferences.getAnimationSettings().prefersReducedMotion;
    } catch {
      return false;
    }
  }

  private currentQueryAnchor(): QueryAnchor {
    const workArea = this.currentWorkArea();
    return queryAnchorForFox(
      { x: this.foxOrigin.x, width: FOX_SIZE },
      workArea,
    );
  }

  private sessionQueryAnchor(computed: QueryAnchor = this.currentQueryAnchor()): QueryAnchor {
    return resolveSessionQueryAnchor(this.queryDragAnchor, computed);
  }

  private clearQueryDragGesture(): void {
    this.queryDragAnchor = null;
  }

  private finishOrClearQueryDrag(): void {
    if (this.queryDragAnchor === null) {
      return;
    }
    const query = this.query;
    if (!this.live(query)) {
      this.clearQueryDragGesture();
      return;
    }
    this.settlePinnedQueryDrag(query.getBounds(), this.currentWorkArea());
  }

  private settlePinnedQueryDrag(queryRect: Rect, workArea: Rect): void {
    if (this.queryDragAnchor === null) {
      return;
    }
    const settled = settleQueryDragGesture(queryRect, workArea, this.queryDragAnchor);
    this.foxOrigin = { x: settled.fox.x, y: settled.fox.y };
    this.foxDockEdge = settled.dockEdge;
    this.resetFoxPeekLifecycle(settled.dockEdge);
  }

  private syncFoxOriginFromNativeBounds(fox: BrowserWindow): Rect | null {
    if (!this.live(fox) || fox !== this.fox) {
      return null;
    }
    const bounds = fox.getBounds();
    this.foxOrigin = { x: bounds.x, y: bounds.y };
    return bounds;
  }

  private bindFoxNativeBoundsReadback(fox: BrowserWindow): void {
    const sync = (): void => {
      this.syncFoxOriginFromNativeBounds(fox);
    };
    // `move` covers programmatic/native adjustments across platforms, while
    // macOS also emits `moved` after WindowServer completes a seat change.
    fox.on('move', sync);
    fox.on('moved', sync);
  }

  private bindWindowLifecycle(win: BrowserWindow): void {
    lockRendererWindow(win);
    win.on('close', (event) => {
      if (this.isInactive() || process.env.CUSTOMER_AGENT_ALLOW_QUIT === '1') {
        return;
      }
      event.preventDefault();
      if (win === this.query) {
        this.dismiss();
      }
    });
  }

  private createChromeWindow(size: OverlayChromeWindowSize): BrowserWindow {
    return createOverlayChromeWindow(this.preloadPath, size);
  }
}

export function isTestHarnessEnabled(): boolean {
  return process.env.DEMO_E2E === '1' || process.argv.includes('--demo-e2e');
}
