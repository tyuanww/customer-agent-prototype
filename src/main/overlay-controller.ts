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
  FOX_DRAG_SAFE_OVERFLOW_PX,
  FOX_EDGE_PEEK_TRAVEL_PX,
  FOX_SIZE,
  QUERY_INPUT_HEIGHT,
  QUERY_WIDTH,
  clampRectToWorkArea,
  defaultFoxRect,
  dockFoxNativeRect,
  foxDockEdgeForRect,
  foxDragBaseRect,
  overlaySizeForPhase,
  placeQueryAnchoredToFox,
  queryAnchorForFox,
  sanitizeDragDelta,
  type Rect,
} from '../shared/overlay-geometry';
import {
  isOpenPhase,
  reduceOverlay,
  type OverlayEvent,
  type OverlayPhase,
} from '../shared/overlay-machine';
import type {
  FoxDockEdge,
  FoxPeekIntent,
  FoxVisualTransform,
  HandoffMilestone,
  OverlayCommand,
  OverlayRole,
  RendererRole,
  ReportablePhase,
  ResultCount,
} from '../shared/overlay-events';
import { IDENTITY_FOX_VISUAL_TRANSFORM } from '../shared/overlay-events';
import { bindGlobalShortcut, DEFAULT_GLOBAL_ACCELERATOR } from '../shared/shortcut';
import { QUERY_CLOSE_DURATION_MS, QUERY_OPEN_DURATION_MS } from '../shared/fox-motion';
import {
  createDashboardBrowserWindow,
  readDashboardWindowSnapshot,
  type DashboardWindowSnapshot,
} from './dashboard-window';
import { lockRendererWindow } from './window-security';

const BLUR_GRACE_MS = 240;
const HANDOFF_PREPARE_TIMEOUT_MS = 180;
const HANDOFF_FALLBACK_BUFFER_MS = 100;

export type OverlayControllerOptions = {
  preloadPath?: string;
  accelerator?: string;
  testHarness?: boolean;
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
  private foxPeekIntent: FoxPeekIntent = 'retract';
  private foxPeekEpoch = 0;
  private ignoreBlurUntil = 0;
  private pendingQueryBlur = false;
  private blurRecheckTimer: ReturnType<typeof setTimeout> | null = null;
  private chromeHandoffTimer: ReturnType<typeof setTimeout> | null = null;
  private queryFocusRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private chromeHandoffMode: 'preparing-open' | 'opening' | 'closing' | null = null;
  private chromeHandoffSequence = 0;
  private activeChromeHandoffId = 0;
  private chromeHandoffAnchor: 'left' | 'right' = 'left';
  private pendingFoxVisualTransform: FoxVisualTransform = IDENTITY_FOX_VISUAL_TRANSFORM;
  private quitting = false;
  private readonly preloadPath: string;

  constructor(options: OverlayControllerOptions = {}) {
    this.preloadPath = options.preloadPath ?? join(__dirname, '../preload/index.cjs');
    this.accelerator = options.accelerator ?? DEFAULT_GLOBAL_ACCELERATOR;
    this.testHarness = options.testHarness ?? isTestHarnessEnabled();
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

    this.bindWindowLifecycle(this.fox);
    this.bindWindowLifecycle(this.query);
    this.query.on('blur', () => this.handleQueryBlur());
    this.query.on('focus', () => {
      this.clearPendingQueryBlur();
      this.clearQueryFocusRetry();
      if (isOpenPhase(this.phase) && this.query && !this.query.isDestroyed()) {
        this.query.webContents.focus();
      }
    });

    await Promise.all([
      loadRenderer(this.fox, 'fox'),
      loadRenderer(this.query, 'query'),
    ]);

    const workArea = screen.getPrimaryDisplay().workArea;
    const placed = defaultFoxRect(workArea);
    this.foxOrigin = { x: placed.x, y: placed.y };
    this.fox.setBounds(placed);
    this.resetFoxPeekLifecycle('none');
    this.fox.showInactive();

    this.registerShortcut();
    this.broadcastShortcutStatus();

    if (this.testHarness) {
      attachTestHarness(this);
    }
  }

  openSearch(visualTransform: FoxVisualTransform = IDENTITY_FOX_VISUAL_TRANSFORM): void {
    if (isOpenPhase(this.phase)) {
      this.activateExisting();
      return;
    }
    this.advanceFoxPeekEpoch();
    if (
      this.foxDockEdge === 'none' &&
      this.fox &&
      !this.fox.isDestroyed() &&
      this.fox.isVisible()
    ) {
      const bounds = this.fox.getBounds();
      this.foxOrigin = { x: bounds.x, y: bounds.y };
    }
    this.pendingFoxVisualTransform = visualTransform;
    this.applyEvent({ type: 'OPEN' });
  }

  dismiss(): void {
    this.applyEvent({ type: 'DISMISS' });
  }

  toggle(): void {
    if (isOpenPhase(this.phase)) {
      this.dismiss();
      return;
    }
    this.openSearch();
  }

  activateExisting(): void {
    if (isOpenPhase(this.phase)) {
      this.armBlurGrace();
      if (this.query?.isVisible()) {
        this.focusQueryWindow();
        this.scheduleQueryFocusRetry();
        this.fox?.hide();
      }
      if (this.chromeHandoffMode !== null) {
        return;
      }
      this.sendToQuery({
        type: 'activate-search',
        anchor: this.currentQueryAnchor(),
        animate: false,
      });
      return;
    }
    this.openSearch();
  }

  async openDashboard(): Promise<void> {
    this.dismiss();
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      if (this.dashboard.isMinimized()) {
        this.dashboard.restore();
      }
      this.dashboard.show();
      this.dashboard.focus();
      return;
    }

    const win = createDashboardBrowserWindow();
    lockRendererWindow(win);
    this.dashboard = win;
    win.on('closed', () => {
      if (this.dashboard === win) {
        this.dashboard = null;
      }
    });
    await loadRenderer(win, 'dashboard');
    if (win.isDestroyed()) {
      return;
    }
    win.show();
    win.focus();
  }

  closeDashboard(): void {
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
    if (!isOpenPhase(this.phase)) {
      return;
    }
    this.phase = phase;
    this.resultCount = resultCount;
    this.syncWindows({ activate: false });
  }

  reportHandoffMilestone(handoffId: number, milestone: HandoffMilestone): void {
    if (handoffId !== this.activeChromeHandoffId) {
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

  moveBy(dx: unknown, dy: unknown, finished = false): void {
    const delta = sanitizeDragDelta(dx, dy);
    if (!delta) {
      return;
    }
    const target = this.query?.isVisible() ? this.query : this.fox;
    if (!target || target.isDestroyed()) {
      return;
    }
    const nativeBounds = target.getBounds();
    const bounds = target === this.fox && this.foxDockEdge !== 'none'
      ? foxDragBaseRect(
          {
            x: this.foxOrigin.x,
            y: this.foxOrigin.y,
            width: FOX_SIZE,
            height: FOX_SIZE,
          },
          this.currentWorkArea(),
          this.foxDockEdge,
        )
      : nativeBounds;
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
      target === this.fox ? -FOX_DRAG_SAFE_OVERFLOW_PX : undefined,
    );
    target.setBounds(next);
    if (target === this.fox) {
      this.foxOrigin = { x: next.x, y: next.y };
    } else {
      const anchor = this.currentQueryAnchor();
      const inferredFox = clampRectToWorkArea(
        {
          x: anchor === 'right' ? next.x + next.width - FOX_SIZE : next.x,
          y: next.y,
          width: FOX_SIZE,
          height: FOX_SIZE,
        },
        workArea,
      );
      this.foxOrigin = { x: inferredFox.x, y: inferredFox.y };
    }
    if (target === this.fox && !finished) {
      this.foxDockEdge = 'none';
      this.resetFoxPeekLifecycle('none');
    }
    if (finished && target === this.fox) {
      const edge = foxDockEdgeForRect(next, workArea);
      this.foxDockEdge = edge;
      const docked = dockFoxNativeRect(next, workArea, edge);
      this.fox.setBounds(docked);
      this.foxOrigin = { x: next.x, y: next.y };
      this.resetFoxPeekLifecycle(edge);
    }
  }

  setFoxPeek(intent: FoxPeekIntent, epoch: number): void {
    const fox = this.fox;
    if (
      !fox ||
      fox.isDestroyed() ||
      !fox.isVisible() ||
      this.phase !== 'FOX_IDLE' ||
      this.foxDockEdge === 'none' ||
      epoch !== this.foxPeekEpoch
    ) {
      return;
    }
    const workArea = this.currentWorkArea();
    const fullFoxRect = clampRectToWorkArea(
      {
        x: this.foxOrigin.x,
        y: this.foxOrigin.y,
        width: FOX_SIZE,
        height: FOX_SIZE,
      },
      workArea,
    );
    const desiredBounds = dockFoxNativeRect(fullFoxRect, workArea, this.foxDockEdge);
    const currentBounds = fox.getBounds();
    const boundsAlreadyMatch =
      currentBounds.x === desiredBounds.x &&
      currentBounds.y === desiredBounds.y &&
      currentBounds.width === desiredBounds.width &&
      currentBounds.height === desiredBounds.height;
    // WindowServer can occasionally leave a transparent panel at the previous
    // peek width even though both processes already say "retract". Treat the
    // native bounds as the source of truth so a repeated intent repairs that
    // desynchronisation instead of becoming a permanent 80px edge handle.
    if (intent === this.foxPeekIntent && boundsAlreadyMatch) {
      return;
    }
    if (!boundsAlreadyMatch) {
      fox.setBounds(desiredBounds);
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

  unregisterShortcut(): void {
    this.quitting = true;
    this.clearPendingQueryBlur();
    this.clearQueryFocusRetry();
    this.cancelChromeHandoff();
    globalShortcut.unregisterAll();
  }

  private applyEvent(event: OverlayEvent): void {
    const next = reduceOverlay(this.phase, event);
    if (next === this.phase && event.type !== 'OPEN') {
      if (event.type === 'TOGGLE' || event.type === 'DISMISS') {
        return;
      }
    }
    this.phase = next;
    if (next === 'FOX_IDLE' || next === 'SEARCH_INPUT') {
      this.resultCount = 0;
    }
    this.syncWindows({ activate: next === 'SEARCH_INPUT' && event.type !== 'DISMISS' });
  }

  private syncWindows(options: { activate?: boolean } = {}): void {
    const fox = this.fox;
    const query = this.query;
    if (!fox || !query || fox.isDestroyed() || query.isDestroyed()) {
      return;
    }

    if (this.phase === 'FOX_IDLE') {
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
      );
      this.armBlurGrace();
      const shouldAnimate =
        query.isVisible() &&
        this.chromeHandoffMode !== 'preparing-open' &&
        !this.prefersReducedMotion();
      this.cancelChromeHandoff();
      const handoffId = this.nextChromeHandoffId();
      this.chromeHandoffAnchor = queryAnchorForFox(foxRect, workArea);
      this.chromeHandoffMode = shouldAnimate ? 'closing' : null;
      this.sendToQuery({
        type: 'collapse',
        handoffId,
        anchor: this.chromeHandoffAnchor,
        dockEdge: this.foxDockEdge,
        animate: shouldAnimate,
      });
      const dockedFoxRect = dockFoxNativeRect(foxRect, workArea, this.foxDockEdge);
      fox.setBounds(dockedFoxRect);
      this.resetFoxPeekLifecycle(this.foxDockEdge);
      if (!shouldAnimate) {
        this.finishClosingHandoff(handoffId);
        return;
      }
      this.chromeHandoffTimer = setTimeout(() => {
        this.finishClosingHandoff(handoffId);
      }, QUERY_CLOSE_DURATION_MS + HANDOFF_FALLBACK_BUFFER_MS);
      return;
    }

    const size = overlaySizeForPhase(this.phase, this.resultCount);
    const workArea = this.currentWorkArea();
    const fullFoxRect: Rect = {
      x: this.foxOrigin.x,
      y: this.foxOrigin.y,
      width: FOX_SIZE,
      height: FOX_SIZE,
    };
    const placed = placeQueryAnchoredToFox(fullFoxRect, size, workArea, this.foxDockEdge);
    if (options.activate) {
      this.clearPendingQueryBlur();
    }
    this.armBlurGrace();
    query.setBounds(placed);
    if (options.activate) {
      this.cancelChromeHandoff();
      const handoffId = this.nextChromeHandoffId();
      const anchor = queryAnchorForFox(fullFoxRect, workArea);
      const foxVisualCenter = this.currentFoxVisualCenter(workArea);
      this.chromeHandoffMode = 'preparing-open';
      this.chromeHandoffAnchor = anchor;
      this.sendToQuery({
        type: 'prepare-search',
        handoffId,
        anchor,
        handoffCenterX: foxVisualCenter.x - placed.x,
        handoffCenterY: foxVisualCenter.y - placed.y,
        foxVisualTransform: this.pendingFoxVisualTransform,
      });
      this.pendingFoxVisualTransform = IDENTITY_FOX_VISUAL_TRANSFORM;
      this.chromeHandoffTimer = setTimeout(() => {
        this.startPreparedOpen(handoffId, false);
      }, HANDOFF_PREPARE_TIMEOUT_MS);
      return;
    }
    if (this.chromeHandoffMode === null && fox.isVisible()) {
      fox.hide();
    }
  }

  private startPreparedOpen(handoffId: number, rendererArmed: boolean): void {
    const fox = this.fox;
    const query = this.query;
    if (
      handoffId !== this.activeChromeHandoffId ||
      this.chromeHandoffMode !== 'preparing-open' ||
      !isOpenPhase(this.phase) ||
      !fox ||
      !query ||
      fox.isDestroyed() ||
      query.isDestroyed()
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
    this.chromeHandoffTimer = setTimeout(() => {
      this.finishOpeningHandoff(handoffId);
    }, QUERY_OPEN_DURATION_MS + HANDOFF_FALLBACK_BUFFER_MS);
  }

  private finishOpeningHandoff(handoffId: number): void {
    if (
      handoffId !== this.activeChromeHandoffId ||
      (this.chromeHandoffMode !== 'opening' && this.chromeHandoffMode !== 'preparing-open')
    ) {
      return;
    }
    this.clearChromeHandoffTimer();
    this.chromeHandoffMode = null;
    this.fox?.hide();
    if (process.platform === 'darwin' && this.query && !this.query.isDestroyed()) {
      this.query.invalidateShadow();
    }
  }

  private finishClosingHandoff(handoffId: number): void {
    if (
      handoffId !== this.activeChromeHandoffId ||
      (this.chromeHandoffMode !== 'closing' && this.phase !== 'FOX_IDLE')
    ) {
      return;
    }
    const fox = this.fox;
    const query = this.query;
    if (!fox || !query || fox.isDestroyed() || query.isDestroyed()) {
      return;
    }
    this.clearChromeHandoffTimer();
    this.chromeHandoffMode = null;
    const workArea = this.currentWorkArea();
    const foxRect = clampRectToWorkArea(
      { x: this.foxOrigin.x, y: this.foxOrigin.y, width: FOX_SIZE, height: FOX_SIZE },
      workArea,
    );
    const dockedFoxRect = dockFoxNativeRect(foxRect, workArea, this.foxDockEdge);
    // Show first, then restore the stable in-work-area frame because macOS can
    // reapply a native cascade position while mapping a hidden panel.
    fox.showInactive();
    fox.setBounds(dockedFoxRect);
    if (process.platform === 'darwin') {
      query.invalidateShadow();
    }
    query.hide();
  }

  private focusQueryWindow(): void {
    const query = this.query;
    if (!query || query.isDestroyed()) {
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
    this.queryFocusRetryTimer = setTimeout(() => {
      this.queryFocusRetryTimer = null;
      if (isOpenPhase(this.phase) && this.query?.isVisible()) {
        this.focusQueryWindow();
      }
    }, 34);
  }

  private clearQueryFocusRetry(): void {
    if (this.queryFocusRetryTimer !== null) {
      clearTimeout(this.queryFocusRetryTimer);
      this.queryFocusRetryTimer = null;
    }
  }

  private currentWorkArea(): Rect {
    const point = {
      x: Math.round(this.foxOrigin.x + FOX_SIZE / 2),
      y: Math.round(this.foxOrigin.y + FOX_SIZE / 2),
    };
    return screen.getDisplayNearestPoint(point).workArea;
  }

  private currentFoxVisualCenter(workArea: Rect): { x: number; y: number } {
    const fullFoxRect = clampRectToWorkArea(
      {
        x: this.foxOrigin.x,
        y: this.foxOrigin.y,
        width: FOX_SIZE,
        height: FOX_SIZE,
      },
      workArea,
      0,
    );
    const peekOffset = this.foxPeekIntent === 'peek' ? FOX_EDGE_PEEK_TRAVEL_PX : 0;
    if (this.foxDockEdge === 'left') {
      return {
        x: workArea.x + peekOffset,
        y: fullFoxRect.y + FOX_SIZE / 2,
      };
    }
    if (this.foxDockEdge === 'right') {
      return {
        x: workArea.x + workArea.width - peekOffset,
        y: fullFoxRect.y + FOX_SIZE / 2,
      };
    }
    return {
      x: fullFoxRect.x + FOX_SIZE / 2,
      y: fullFoxRect.y + FOX_SIZE / 2,
    };
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
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.OVERLAY_COMMAND, command);
      }
    }
  }

  private sendToFox(command: OverlayCommand): void {
    if (this.fox && !this.fox.isDestroyed()) {
      this.fox.webContents.send(IPC_CHANNELS.OVERLAY_COMMAND, command);
    }
  }

  private advanceFoxPeekEpoch(): number {
    this.foxPeekEpoch += 1;
    return this.foxPeekEpoch;
  }

  private resetFoxPeekLifecycle(edge: FoxDockEdge): void {
    this.foxPeekIntent = 'retract';
    this.sendToFox({ type: 'fox-edge', edge, epoch: this.advanceFoxPeekEpoch() });
  }

  private sendToQuery(command: OverlayCommand): void {
    if (this.query && !this.query.isDestroyed()) {
      this.query.webContents.send(IPC_CHANNELS.OVERLAY_COMMAND, command);
    }
  }

  private armBlurGrace(): void {
    this.ignoreBlurUntil = Date.now() + BLUR_GRACE_MS;
    this.schedulePendingBlurRecheck();
  }

  private handleQueryBlur(): void {
    if (this.phase === 'FOX_IDLE' || !this.query?.isVisible()) {
      this.clearPendingQueryBlur();
      return;
    }
    this.pendingQueryBlur = true;
    this.schedulePendingBlurRecheck();
  }

  private schedulePendingBlurRecheck(): void {
    if (this.blurRecheckTimer !== null) {
      clearTimeout(this.blurRecheckTimer);
      this.blurRecheckTimer = null;
    }
    if (!this.pendingQueryBlur) {
      return;
    }
    const remaining = this.ignoreBlurUntil - Date.now();
    if (!Number.isFinite(remaining)) {
      return;
    }
    if (remaining > 0) {
      this.blurRecheckTimer = setTimeout(() => {
        this.blurRecheckTimer = null;
        this.schedulePendingBlurRecheck();
      }, remaining + 8);
      return;
    }
    this.pendingQueryBlur = false;
    if (this.phase !== 'FOX_IDLE' && this.query?.isVisible()) {
      this.dismiss();
    }
  }

  private clearPendingQueryBlur(): void {
    this.pendingQueryBlur = false;
    if (this.blurRecheckTimer !== null) {
      clearTimeout(this.blurRecheckTimer);
      this.blurRecheckTimer = null;
    }
  }

  private cancelChromeHandoff(): void {
    this.clearChromeHandoffTimer();
    this.clearQueryFocusRetry();
    this.chromeHandoffMode = null;
    this.activeChromeHandoffId = 0;
  }

  private clearChromeHandoffTimer(): void {
    if (this.chromeHandoffTimer !== null) {
      clearTimeout(this.chromeHandoffTimer);
      this.chromeHandoffTimer = null;
    }
  }

  private nextChromeHandoffId(): number {
    this.chromeHandoffSequence += 1;
    this.activeChromeHandoffId = this.chromeHandoffSequence;
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

  private currentQueryAnchor(): 'left' | 'right' {
    const workArea = this.currentWorkArea();
    return queryAnchorForFox(
      { x: this.foxOrigin.x, width: FOX_SIZE },
      workArea,
    );
  }

  private bindWindowLifecycle(win: BrowserWindow): void {
    lockRendererWindow(win);
    win.on('close', (event) => {
      if (this.quitting || process.env.CUSTOMER_AGENT_ALLOW_QUIT === '1') {
        return;
      }
      event.preventDefault();
      if (win === this.query) {
        this.dismiss();
      }
    });
  }

  private createChromeWindow(size: {
    width: number;
    height: number;
    title: string;
    backgroundThrottling?: boolean;
    macPanel?: boolean;
  }): BrowserWindow {
    const win = new BrowserWindow({
      width: size.width,
      height: size.height,
      title: size.title,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      // Both overlay surfaces draw their own CSS shadow. A second native shadow
      // gives transparent-window animations another cached layer to invalidate.
      hasShadow: false,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      autoHideMenuBar: true,
      roundedCorners: true,
      ...(process.platform === 'darwin'
        ? {
            ...(size.macPanel === false ? {} : { type: 'panel' as const }),
            hiddenInMissionControl: true,
          }
        : {}),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: size.backgroundThrottling ?? true,
      },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setMenuBarVisibility(false);
    return win;
  }
}

export function isTestHarnessEnabled(): boolean {
  return process.env.DEMO_E2E === '1' || process.argv.includes('--demo-e2e');
}

async function loadRenderer(win: BrowserWindow, role: RendererRole): Promise<void> {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    url.searchParams.set('role', role);
    await win.loadURL(url.toString());
    return;
  }
  await win.loadFile(join(__dirname, '../renderer/index.html'), {
    query: { role },
  });
}

function attachTestHarness(controller: OverlayController): void {
  const harness = {
    expand: () => {
      controller.openSearch();
    },
    dismiss: () => {
      controller.dismiss();
    },
    toggle: () => {
      controller.toggle();
    },
    blurQuery: () => {
      const query = controller
        .getWindows()
        .find((win) => win.webContents.getURL().includes('role=query'));
      query?.emit('blur');
    },
    getPhase: () => controller.phase,
    shortcutRegistered: () => controller.shortcutRegistered,
    dockFox: (edge: 'left' | 'right') => {
      const fox = controller
        .getWindows()
        .find((win) => win.webContents.getURL().includes('role=fox'));
      if (!fox) {
        return;
      }
      const bounds = fox.getBounds();
      const workArea = screen.getDisplayMatching(bounds).workArea;
      const targetX = edge === 'left' ? workArea.x : workArea.x + workArea.width - bounds.width;
      let remaining = targetX - bounds.x;
      while (Math.abs(remaining) > 240) {
        const step = Math.sign(remaining) * 240;
        controller.moveBy(step, 0, false);
        remaining -= step;
      }
      controller.moveBy(remaining, 0, false);
      controller.moveBy(0, 0, true);
    },
    openDashboard: () => controller.openDashboard(),
    closeDashboard: () => {
      controller.closeDashboard();
    },
    dashboardSnapshot: () => controller.dashboardSnapshot(),
    isDashboardTrusted: () => controller.isDashboardTrusted(),
  };
  Object.defineProperty(globalThis, '__demoTest', {
    value: harness,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}
