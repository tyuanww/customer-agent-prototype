import {
  BrowserWindow,
  globalShortcut,
  screen,
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
  acceptedQueryLayoutAck,
  applyQueryVerticalResize,
  clampQueryDesiredHeight,
  pickQueryResizeEdgeForHeight,
  effectiveQuerySize,
  fallbackQuerySizeForPhase,
  isQueryContentLayoutPhase,
  queryLayoutAckCommand,
  queryResizeDeltaForKey,
  rejectedQueryLayoutAck,
  resolveQueryResizeEdge,
  type QueryLayoutAck,
  type QueryLayoutRequest,
  type QueryResizeEdge,
  type QueryResizeRequest,
} from '../shared/query-layout';
import {
  applyOverlayEvent,
  createInitialOverlayState,
  overlaySnapshot,
  type NativeEffect,
  type OverlayEvent,
  type OverlayPhase,
  type OverlayState,
} from '../shared/overlay-machine';
import {
  IDENTITY_FOX_VISUAL_TRANSFORM,
  foxDragSettledCommand,
  foxEdgeCommand,
  type FoxDockEdge,
  type FoxDragSettleAck,
  type FoxPeekIntent,
  type FoxVisualTransform,
  type HandoffMilestone,
  type OverlayCommand,
  type OverlayRendererEvent,
  type OverlayRole,
  type QueryAnchor,
  type ReportablePhase,
  type ResultCount,
} from '../shared/overlay-events';
import {
  type OverlayReportIdentity,
} from '../shared/overlay-report';
import {
  openDashboardUnavailable,
  type OpenDashboardResult,
} from '../shared/dashboard-access';
import { bindGlobalShortcut, DEFAULT_GLOBAL_ACCELERATOR } from '../shared/shortcut';
import {
  createDashboardBrowserWindow,
  readDashboardWindowSnapshot,
  type DashboardWindowSnapshot,
} from './dashboard-window';
import { readRunningLine } from './read-running-identity';
import type { RunningPoint } from '../shared/running-identity';
import { GuardedScheduler } from './guarded-scheduler';
import {
  createShutdownFence,
  isInactiveOverlay,
  isUsableWindow,
  type ShutdownFence,
} from './shutdown-fence';
import { lockRendererWindow } from './window-security';
import { createOverlayChromeWindow, type OverlayChromeWindowSize } from './overlay-chrome-window';
import { OverlayPlatform } from './overlay-platform';
import { loadRenderer } from './overlay-renderer-loader';
import { attachTestHarness, isTestHarnessEnabled } from './overlay-test-harness';

const BLUR_GRACE_MS = 240;
const DISPLAY_RECONCILE_DELAY_MS = 100;
const MAX_COMMAND_OBSERVATIONS = 256;

export type OverlayWorkPort = {
  cancelQuery(identity: Pick<OverlayReportIdentity, 'sessionEpoch' | 'generation'>): void;
  cancelCopy(identity: Pick<OverlayReportIdentity, 'sessionEpoch' | 'generation'>): void;
  clearContent(): void;
};

type FoxDragTransaction = {
  geometry: FoxDockDragSession;
  sessionEpoch: number;
  windowGeneration: number;
  generation: number;
};

type OverlayReportOrigin = Pick<
  OverlayReportIdentity,
  'sessionEpoch' | 'generation' | 'windowGeneration'
>;

export type OverlayControllerOptions = {
  dashboardEnabled?: boolean;
  preloadPath?: string;
  accelerator?: string;
  testHarness?: boolean;
  fence?: ShutdownFence;
  rendererDevServerUrl?: string;
  onDispose?: () => void;
  onDashboardShown?: () => void;
  runningPoint?: RunningPoint;
  overlayWork?: OverlayWorkPort;
};

export class OverlayController {
  shortcutRegistered = false;
  shortcutMessage = '';
  readonly accelerator: string;
  readonly testHarness: boolean;

  private overlayState: OverlayState = createInitialOverlayState({
    sessionEpoch: 1,
    generation: 1,
    windowGeneration: 1,
    releaseId: 'rel_overlay_unbound',
  });
  private readonly timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly commandFrameStartedAt = new Map<string, number>();
  private readonly commandCallbackDurations: number[] = [];
  private coldCallbackMs: number | null = null;
  private droppedCommandObservations = 0;
  private staleRendererReports = 0;
  private lastStaleRendererReport: string | null = null;
  private effectExecutionDepth = 0;
  private snapshotDirty = false;
  private fox: BrowserWindow | null = null;
  private query: BrowserWindow | null = null;
  private dashboard: BrowserWindow | null = null;
  private foxOrigin = { x: 80, y: 80 };
  private foxDragTransaction: FoxDragTransaction | null = null;
  private legacyFoxDragGenerationSequence = 0;
  private foxDragSettleSequence = 0;
  private displayReconcilePending = false;
  private postFoxDragTimer: ReturnType<typeof setTimeout> | null = null;
  private ignoreBlurUntil = 0;
  private pendingQueryBlur = false;
  private blurRecheckTimer: ReturnType<typeof setTimeout> | null = null;
  private blurRecheckIdentity: OverlayReportOrigin | null = null;
  private queryFocusRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private displayReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private displayLifecycleBound = false;
  private dashboardOpening: Promise<OpenDashboardResult> | null = null;

  private disposed = false;
  private readonly fence: ShutdownFence;
  private readonly scheduler = new GuardedScheduler();
  private readonly platform = new OverlayPlatform(this.scheduler);
  private readonly preloadPath: string;
  private readonly onDispose?: () => void;
  private readonly onDashboardShown?: () => void;
  readonly dashboardEnabled: boolean;
  readonly rendererDevServerUrl: string | undefined;
  private readonly runningLine: string;
  private readonly overlayWork: OverlayWorkPort;

  get phase(): OverlayPhase {
    return this.overlayState.phase === 'parked' || this.overlayState.phase === 'closed'
      ? 'FOX_IDLE'
      : this.overlayState.contentPhase;
  }

  get resultCount(): ResultCount {
    return this.overlayState.resultCount;
  }

  constructor(options: OverlayControllerOptions = {}) {
    this.runningLine = readRunningLine(options.runningPoint ?? 'unknown');
    this.dashboardEnabled = options.dashboardEnabled !== false;
    this.preloadPath = options.preloadPath ?? join(__dirname, '../preload/index.cjs');
    this.accelerator = options.accelerator ?? DEFAULT_GLOBAL_ACCELERATOR;
    this.testHarness = options.testHarness ?? isTestHarnessEnabled();
    this.fence = options.fence ?? createShutdownFence();
    this.rendererDevServerUrl = options.rendererDevServerUrl;
    this.onDispose = options.onDispose;
    this.onDashboardShown = options.onDashboardShown;
    this.overlayWork = options.overlayWork ?? {
      cancelQuery: (identity) => {
        this.sendToQuery({ type: 'cancel-query', ...identity });
      },
      cancelCopy: (identity) => {
        this.sendToQuery({ type: 'cancel-copy', ...identity });
      },
      clearContent: () => {
        this.sendToQuery({ type: 'clear-content' });
      },
    };
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

  queryWindowBounds(): Rect | null {
    if (!this.query || this.query.isDestroyed()) {
      return null;
    }
    return this.query.getBounds();
  }

  getOverlaySnapshot() {
    return overlaySnapshot(this.overlayState);
  }

  private overlayEventGuard() {
    return {
      sessionEpoch: this.overlayState.sessionEpoch,
      generation: this.overlayState.generation,
      windowGeneration: this.overlayState.windowGeneration,
    };
  }

  private currentReportOrigin(): OverlayReportOrigin {
    return {
      sessionEpoch: this.overlayState.sessionEpoch,
      generation: this.overlayState.generation,
      windowGeneration: this.overlayState.windowGeneration,
    };
  }

  private currentReportIdentity(): OverlayReportIdentity {
    return {
      ...this.currentReportOrigin(),
      contentRevision: this.overlayState.contentRevision,
    };
  }

  private matchesReportOrigin(identity: OverlayReportOrigin): boolean {
    return this.overlayState.sessionEpoch === identity.sessionEpoch
      && this.overlayState.generation === identity.generation
      && this.overlayState.windowGeneration === identity.windowGeneration;
  }

  private matchesReportIdentity(identity: OverlayReportIdentity): boolean {
    return this.matchesReportOrigin(identity)
      && this.overlayState.contentRevision === identity.contentRevision;
  }

  private dispatchOverlayEvent(event: OverlayEvent) {
    if (this.isInactive()) {
      return null;
    }
    const transition = applyOverlayEvent(this.overlayState, event);
    if (transition.decision === 'rejected') {
      return transition;
    }
    const previous = this.overlayState;
    this.overlayState = transition.state;
    this.reconcileControllerOwnership(previous, transition.state);
    if (transition.decision === 'applied') {
      this.snapshotDirty = true;
      this.executeNativeEffects(transition.effects);
    }
    return transition;
  }

  private reconcileControllerOwnership(previous: OverlayState, next: OverlayState): void {
    const lifecycleChanged = previous.sessionEpoch !== next.sessionEpoch
      || previous.windowGeneration !== next.windowGeneration
      || previous.generation !== next.generation
      || next.phase === 'closed';
    const observationIdentityChanged = lifecycleChanged
      || previous.contentRevision !== next.contentRevision;
    if (!observationIdentityChanged) {
      return;
    }
    if (lifecycleChanged) {
      this.foxDragTransaction = null;
      this.ignoreBlurUntil = 0;
      this.clearPendingQueryBlur();
      this.clearQueryFocusRetry();
      this.scheduler.clear(this.postFoxDragTimer);
      this.postFoxDragTimer = null;
      this.clearTimeoutHandles();
      this.displayReconcilePending = false;
    }
    this.clearCommandObservations();
  }

  private clearCommandObservations(): void {
    this.droppedCommandObservations += this.commandFrameStartedAt.size;
    this.commandFrameStartedAt.clear();
  }

  private clearTimeoutHandles(): void {
    for (const handle of this.timeoutHandles.values()) {
      this.scheduler.clear(handle);
    }
    this.timeoutHandles.clear();
  }

  private timeoutKey(timer: NativeEffect & { type: 'SCHEDULE_TIMEOUT' }): string {
    return `${timer.timer}:${timer.handoffId}`;
  }

  private clearTimeoutEffect(
    timer: Extract<NativeEffect, { type: 'CANCEL_TIMEOUT' }>,
  ): void {
    if (timer.handoffId !== undefined) {
      const key = `${timer.timer}:${timer.handoffId}`;
      const handle = this.timeoutHandles.get(key);
      if (handle !== undefined) {
        this.scheduler.clear(handle);
        this.timeoutHandles.delete(key);
      }
      return;
    }
    for (const [key, handle] of this.timeoutHandles) {
      if (key.startsWith(`${timer.timer}:`)) {
        this.scheduler.clear(handle);
        this.timeoutHandles.delete(key);
      }
    }
  }

  private executeNativeEffects(effects: readonly NativeEffect[]): void {
    this.effectExecutionDepth += 1;
    try {
      for (const effect of effects) {
        switch (effect.type) {
        case 'SEND_RENDERER_COMMAND': {
          if (effect.target === 'query') {
            if (effect.commandId !== undefined && effect.command.type !== 'prepare-search') {
              this.startCommandObservation(
                'handoff',
                effect.commandId,
                this.currentReportIdentity(),
              );
            }
            this.sendToQuery(effect.command);
          } else {
            this.sendToFox(effect.command);
          }
          break;
        }
        case 'SET_WINDOW_BOUNDS': {
          if (effect.windowGeneration !== this.overlayState.windowGeneration) {
            break;
          }
          const target = effect.target === 'fox' ? this.fox : this.query;
          if (this.live(target)) {
            target.setBounds(effect.bounds);
            if (effect.target === 'fox') {
              this.foxOrigin = { x: effect.bounds.x, y: effect.bounds.y };
            }
          }
          break;
        }
        case 'SHOW_WINDOW': {
          if (effect.windowGeneration !== this.overlayState.windowGeneration) {
            break;
          }
          if (effect.target === 'query' && this.live(this.query)) {
            const prepared = this.query.getBounds();
            this.setQueryFocusable(true);
            this.query.webContents.invalidate();
            this.query.show();
            this.query.setBounds(prepared);
          } else if (effect.target === 'fox' && this.live(this.fox)) {
            this.fox.showInactive();
          }
          break;
        }
        case 'HIDE_WINDOW': {
          if (effect.windowGeneration !== this.overlayState.windowGeneration) {
            break;
          }
          const target = effect.target === 'fox' ? this.fox : this.query;
          if (this.live(target) && target.isVisible()) {
            target.hide();
          }
          break;
        }
        case 'FOCUS_WINDOW': {
          if (
            effect.windowGeneration !== this.overlayState.windowGeneration
            || effect.sessionEpoch !== this.overlayState.sessionEpoch
          ) {
            break;
          }
          if (effect.target === 'query') {
            this.focusQueryWindow();
            this.scheduleQueryFocusRetry();
          } else if (this.live(this.fox)) {
            this.fox.focus();
          }
          break;
        }
        case 'RESTORE_PREVIOUS_APP': {
          if (
            effect.windowGeneration !== this.overlayState.windowGeneration
            || effect.sessionEpoch !== this.overlayState.sessionEpoch
          ) {
            break;
          }
          const fox = this.fox;
          if (this.live(fox)) {
            this.yieldOrKeepPalette(fox);
          }
          break;
        }
        case 'SET_FOCUSABLE':
          if (effect.target === 'fox') {
            this.setFoxFocusable(effect.focusable);
          } else {
            this.setQueryFocusable(effect.focusable);
          }
          break;
        case 'SCHEDULE_TIMEOUT': {
          this.clearTimeoutEffect({ type: 'CANCEL_TIMEOUT', timer: effect.timer, handoffId: effect.handoffId });
          const handle = this.scheduler.schedule(() => {
            this.timeoutHandles.delete(this.timeoutKey(effect));
            if (this.isInactive()) {
              return;
            }
            if (effect.timer === 'handoff') {
              this.dispatchOverlayEvent({
                type: 'HANDOFF_TIMEOUT',
                ...effect.guard,
                handoffId: effect.handoffId,
              });
            } else if (effect.timer === 'layout') {
              this.dispatchOverlayEvent({
                type: 'LAYOUT_TIMEOUT',
                ...effect.guard,
                handoffId: effect.handoffId,
                sequence: effect.sequence,
                contentRevision: effect.guard.contentRevision,
              });
            } else if (effect.timer === 'drag-settle') {
              this.dispatchOverlayEvent({
                type: 'FOX_DRAG_TIMEOUT',
                ...effect.guard,
                dragGeneration: effect.dragGeneration,
              });
            }
          }, effect.delayMs);
          if (handle !== null) {
            this.timeoutHandles.set(this.timeoutKey(effect), handle);
          }
          break;
        }
        case 'CANCEL_TIMEOUT':
          this.clearTimeoutEffect(effect);
          break;
        case 'CANCEL_QUERY':
          this.overlayWork.cancelQuery({
            sessionEpoch: effect.sessionEpoch,
            generation: effect.generation,
          });
          break;
        case 'CANCEL_COPY':
          this.overlayWork.cancelCopy({
            sessionEpoch: effect.sessionEpoch,
            generation: effect.generation,
          });
          break;
        case 'CLEAR_CONTENT':
          this.overlayWork.clearContent();
          break;
        case 'APPLY_QUERY_LAYOUT': {
          const workArea = this.currentWorkArea();
          const natural = clampQueryDesiredHeight(
            effect.desiredHeight,
            this.availableQueryHeight(workArea),
          );
          if (this.overlayState.layout.resize === null) {
            const result = this.applyQueryHeight(
              natural,
              this.overlayState.layout.resizeEdge,
              true,
            );
            this.commitNativeLayout(
              result.height,
              result.edge,
              this.overlayState.layout.sequence,
            );
          }
          break;
        }
        case 'APPLY_QUERY_LAYOUT_FALLBACK': {
          if (
            this.overlayState.handoff.id !== effect.handoffId
            || this.overlayState.layout.sequence !== effect.sequence
          ) {
            break;
          }
          this.applyFallbackQueryHeight();
          if (
            this.overlayState.handoff.id === effect.handoffId
            && this.overlayState.layout.sequence === effect.sequence
            && this.overlayState.layout.ackSequence === effect.sequence
          ) {
            this.sendToQuery(queryLayoutAckCommand(
              effect.handoffId,
              effect.sequence,
              this.overlayState.contentPhase,
              this.overlayState.resultCount,
              this.currentQueryHeight(),
              this.overlayState.layout.resizeEdge,
            ));
          }
          break;
        }
        case 'APPLY_RESIZE': {
          const result = this.applyQueryHeight(effect.height, effect.edge);
          this.commitNativeLayout(
            result.height,
            result.edge,
            this.overlayState.layout.sequence,
          );
          break;
        }
        case 'REFRESH_QUERY_SHADOW':
          if (this.live(this.query)) {
            this.platform.refreshTransparentShadow(this.query);
          }
          break;
        case 'FOX_DRAG_SETTLED':
          this.startCommandObservation(
            'settle',
            effect.ack.settleId,
            this.currentReportIdentity(),
          );
          this.sendToFox(foxDragSettledCommand(effect.ack));
          break;
        case 'SYNC_FOX_EDGE':
          this.sendToFox(foxEdgeCommand(effect.edge, effect.peekEpoch));
          break;
        }
      }
    } finally {
      this.effectExecutionDepth -= 1;
      if (this.effectExecutionDepth === 0 && this.snapshotDirty) {
        this.snapshotDirty = false;
        this.publishOverlaySnapshot();
      }
    }
  }

  private publishOverlaySnapshot(): void {
    const command: OverlayCommand = {
      type: 'overlay-snapshot',
      snapshot: overlaySnapshot(this.overlayState),
    };
    this.sendToFox(command);
    this.sendToQuery(command);
  }

  private commitNativeLayout(height: number, edge: QueryResizeEdge, sequence: number): void {
    if (sequence <= 0 || this.overlayState.phase !== 'active') {
      return;
    }
    const transition = applyOverlayEvent(this.overlayState, {
      type: 'QUERY_LAYOUT_ACK',
      ...this.overlayEventGuard(),
      handoffId: this.overlayState.handoff.id,
      sequence,
      height,
      resizeEdge: edge,
      contentPhase: this.overlayState.contentPhase,
      resultCount: this.overlayState.resultCount,
      contentRevision: this.overlayState.contentRevision,
    });
    this.commitAppliedTransition(transition);
  }

  private commitAppliedTransition(
    transition: ReturnType<typeof applyOverlayEvent>,
  ): boolean {
    if (transition.decision !== 'applied') {
      return false;
    }
    const previous = this.overlayState;
    this.overlayState = transition.state;
    this.reconcileControllerOwnership(previous, transition.state);
    this.snapshotDirty = true;
    this.executeNativeEffects(transition.effects);
    return true;
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
    // Query must remain a regular macOS window so IME and physical keyboard
    // focus work while the app keeps its regular Dock / Cmd+Tab identity.

    this.bindWindowLifecycle(this.fox);
    this.bindWindowLifecycle(this.query);
    this.bindFoxNativeBoundsReadback(this.fox);
    this.bindQueryKeyboardGuard(this.query);
    this.setQueryFocusable(false);
    this.query.on('blur', () => this.handleQueryBlur());
    this.query.on('focus', () => {
      this.clearPendingQueryBlur();
      this.clearQueryFocusRetry();
      if (!this.queryAcceptsKeyboard() || !this.live(this.query)) {
        this.resignQueryKeyboard({
          hide: this.overlayState.phase === 'parked'
            && this.overlayState.handoff.mode !== 'closing',
        });
        return;
      }
      this.query.webContents.focus();
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
    this.setFoxFocusable(false);
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
    this.clearFoxYieldShow();
    if (this.overlayState.phase === 'opening' || this.overlayState.phase === 'active') {
      this.activateExisting();
      return;
    }
    this.advanceFoxPeekEpoch();
    const idleFox = this.fox;
    if (this.isWindowVisible(idleFox)) {
      this.syncFoxOriginFromNativeBounds(idleFox);
    }
    const workArea = this.currentWorkArea();
    const size = this.currentQuerySize(workArea);
    const foxBounds = this.live(idleFox) ? idleFox.getBounds() : {
      x: this.foxOrigin.x,
      y: this.foxOrigin.y,
      width: FOX_SIZE,
      height: FOX_SIZE,
    };
    const queryBounds = placeQueryAnchoredToFox(
      foxBounds,
      size,
      workArea,
      this.overlayState.fox.edge,
      this.overlayState.drag.queryAnchor ?? undefined,
    );
    const foxVisualCenter = this.currentFoxVisualCenter();
    this.dispatchOverlayEvent({
      type: 'OPEN_REQUESTED',
      ...this.overlayEventGuard(),
      anchor: this.sessionQueryAnchor(queryAnchorForFox(foxBounds, workArea)),
      dockEdge: this.overlayState.fox.edge,
      queryBounds,
      foxBounds,
      handoffCenterX: foxVisualCenter.x - queryBounds.x,
      handoffCenterY: foxVisualCenter.y - queryBounds.y,
      foxVisualTransform: visualTransform,
      animate: !this.prefersReducedMotion(),
    });
  }

  querySubscribed(): void {
    if (!this.isInactive() && this.overlayState.phase === 'opening') {
      this.dispatchOverlayEvent({
        type: 'QUERY_SUBSCRIBED',
        ...this.overlayEventGuard(),
      });
    }
  }

  dismiss(restorePreviousApp = false): void {
    if (this.isInactive()) {
      return;
    }
    this.finishOrClearQueryDrag();
    if (this.overlayState.phase !== 'opening' && this.overlayState.phase !== 'active') {
      return;
    }
    const queryBounds = this.live(this.query) ? this.query.getBounds() : null;
    const foxVisualCenter = this.currentFoxVisualCenter({ includePeek: false });
    const animate = Boolean(
      queryBounds
      && this.isWindowVisible(this.query)
      && this.overlayState.handoff.mode === 'none'
      && !this.prefersReducedMotion(),
    );
    this.dispatchOverlayEvent({
      type: 'DISMISS_REQUESTED',
      ...this.overlayEventGuard(),
      restorePreviousApp: restorePreviousApp === true,
      animate,
      handoffCenterX: queryBounds ? foxVisualCenter.x - queryBounds.x : 44,
      handoffCenterY: queryBounds ? foxVisualCenter.y - queryBounds.y : 44,
    });
  }

  toggle(): void {
    if (this.isInactive()) {
      return;
    }
    if (this.overlayState.phase === 'opening' || this.overlayState.phase === 'active') {
      this.dismiss(true);
      return;
    }
    this.openSearch();
  }

  activateExisting(): void {
    if (this.isInactive()) {
      return;
    }
    if (this.overlayState.phase === 'opening' || this.overlayState.phase === 'active') {
      this.armBlurGrace();
      if (this.overlayState.handoff.mode !== 'none') {
        if (this.isWindowVisible(this.query)) {
          this.focusQueryWindow();
          this.scheduleQueryFocusRetry();
          if (this.live(this.fox)) {
            this.fox.hide();
          }
        }
        return;
      }
      this.dispatchOverlayEvent({
        type: 'QUERY_REACTIVATED',
        ...this.overlayEventGuard(),
        anchor: this.sessionQueryAnchor(),
      });
      return;
    }
    this.openSearch();
  }

  async openDashboard(): Promise<OpenDashboardResult> {
    if (!this.dashboardEnabled || this.isInactive()) {
      return openDashboardUnavailable();
    }
    if (this.dashboardOpening) {
      return this.dashboardOpening;
    }
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      return this.revealDashboardWindow(this.dashboard);
    }

    const win = createDashboardBrowserWindow(this.runningLine);
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
    this.onDashboardShown?.();
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

  dashboardWebContents(): WebContents | null {
    if (!this.dashboard || this.dashboard.isDestroyed()) {
      return null;
    }
    return this.dashboard.webContents;
  }

  isDashboardTrusted(): boolean {
    if (!this.dashboard || this.dashboard.isDestroyed()) {
      return false;
    }
    return this.trustedContents().some((contents) => contents.id === this.dashboard?.webContents.id);
  }

  reportRendererEvent(event: OverlayRendererEvent) {
    if (this.isInactive()) {
      return null;
    }
    if (!this.matchesReportOrigin({
      sessionEpoch: event.sessionEpoch,
      generation: event.generation,
      windowGeneration: event.windowGeneration,
    })) {
      this.staleRendererReports += 1;
      this.lastStaleRendererReport = event.type === 'frame-observed'
        ? `${event.type}:${event.commandType}:${event.commandId}:identity`
        : event.type;
      return null;
    }
    if (event.type === 'frame-observed') {
      const observed = this.recordRendererFrame(
        event.commandType,
        event.commandId,
        {
          sessionEpoch: event.sessionEpoch,
          generation: event.generation,
          windowGeneration: event.windowGeneration,
          contentRevision: event.contentRevision,
        },
      );
      if (!observed) {
        this.staleRendererReports += 1;
        this.lastStaleRendererReport = `frame-observed:${event.commandType}:${event.commandId}`;
      }
      return observed ? overlaySnapshot(this.overlayState) : null;
    }
    const identity = {
      sessionEpoch: event.sessionEpoch,
      generation: event.generation,
      windowGeneration: event.windowGeneration,
    };
    const transition = event.type === 'session-changed'
      ? this.dispatchOverlayEvent({
          type: 'SESSION_CHANGED',
          ...identity,
          sessionEpoch: event.nextSessionEpoch,
          releaseId: event.releaseId || 'rel_overlay_unbound',
        })
      : event.type === 'release-changed'
        ? this.dispatchOverlayEvent({
            type: 'RELEASE_CHANGED',
            ...identity,
            releaseId: event.releaseId,
            releaseRevision: event.releaseRevision,
          })
        : event.type === 'focus-changed'
          ? this.dispatchOverlayEvent({
              type: event.focused ? 'QUERY_FOCUSED' : 'QUERY_BLURRED',
              ...identity,
            })
          : this.dispatchOverlayEvent({
              type: 'WINDOW_RECREATED',
              ...identity,
              windowGeneration: event.nextWindowGeneration,
            });
    return transition?.decision === 'applied'
      ? overlaySnapshot(this.overlayState)
      : null;
  }

  reportUiPhase(
    phase: ReportablePhase,
    resultCount: ResultCount,
    identity: OverlayReportIdentity,
  ): void {
    if (this.isInactive()) {
      return;
    }
    if (!this.matchesReportOrigin(identity)) {
      this.staleRendererReports += 1;
      this.lastStaleRendererReport = `content-changed:${phase}`;
      return;
    }
    const transition = this.dispatchOverlayEvent({
      type: 'CONTENT_CHANGED',
      sessionEpoch: identity.sessionEpoch,
      generation: identity.generation,
      windowGeneration: identity.windowGeneration,
      contentRevision: identity.contentRevision,
      contentPhase: phase,
      resultCount,
    });
    if (transition?.decision !== 'applied') {
      this.staleRendererReports += 1;
      this.lastStaleRendererReport = `content-changed:${phase}`;
    }
  }

  reportQueryLayout(request: QueryLayoutRequest): QueryLayoutAck {
    if (this.isInactive()) {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    if (!this.matchesReportIdentity(request.identity)) {
      this.staleRendererReports += 1;
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    if (
      !isQueryContentLayoutPhase(this.overlayState.contentPhase)
      || request.phase !== this.overlayState.contentPhase
      || request.resultCount !== this.resultCount
    ) {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    const transition = applyOverlayEvent(this.overlayState, {
      type: 'LAYOUT_REQUESTED',
      sessionEpoch: request.identity.sessionEpoch,
      generation: request.identity.generation,
      windowGeneration: request.identity.windowGeneration,
      contentRevision: request.identity.contentRevision,
      handoffId: request.sessionId,
      sequence: request.sequence,
      desiredHeight: request.desiredHeight,
      contentPhase: request.phase,
      resultCount: request.resultCount,
    });
    if (transition.decision !== 'applied') {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    this.startCommandObservation('layout', request.sequence, request.identity);
    this.commitAppliedTransition(transition);
    return this.acceptedLayoutAck(request.sessionId, request.sequence);
  }

  resizeQueryHeight(request: QueryResizeRequest): QueryLayoutAck {
    if (this.isInactive()) {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    if (!this.matchesReportIdentity(request.identity)) {
      this.staleRendererReports += 1;
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    if (request.type === 'end' || request.type === 'cancel') {
      const transition = applyOverlayEvent(this.overlayState, {
        type: 'RESIZE_END',
        sessionEpoch: request.identity.sessionEpoch,
        generation: request.identity.generation,
        windowGeneration: request.identity.windowGeneration,
        contentRevision: request.identity.contentRevision,
        handoffId: request.sessionId,
        sequence: request.sequence,
        height: this.currentQueryHeight(),
        commit: request.type === 'end',
      });
      if (transition.decision !== 'applied') {
        return this.rejectedLayoutAck(request.sessionId, request.sequence);
      }
      this.startCommandObservation('layout', request.sequence, request.identity);
      this.commitAppliedTransition(transition);
      return this.acceptedLayoutAck(request.sessionId, request.sequence);
    }

    if (request.type === 'begin') {
      const query = this.query;
      if (!this.live(query)) {
        return this.rejectedLayoutAck(request.sessionId, request.sequence);
      }
      const bounds = query.getBounds();
      const edge = this.queryResizeEdgeForCurrent(this.currentWorkArea());
      const transition = applyOverlayEvent(this.overlayState, {
        type: 'RESIZE_BEGIN',
        sessionEpoch: request.identity.sessionEpoch,
        generation: request.identity.generation,
        windowGeneration: request.identity.windowGeneration,
        contentRevision: request.identity.contentRevision,
        handoffId: request.sessionId,
        sequence: request.sequence,
        baselineHeight: bounds.height,
        edge,
      });
      if (transition.decision !== 'applied') {
        return this.rejectedLayoutAck(request.sessionId, request.sequence);
      }
      this.startCommandObservation('layout', request.sequence, request.identity);
      this.commitAppliedTransition(transition);
      return this.acceptedLayoutAck(request.sessionId, request.sequence, bounds.height, edge);
    }

    if (request.type === 'keyboard') {
      const workArea = this.currentWorkArea();
      const delta = queryResizeDeltaForKey(request.key, request.shiftKey);
      const currentHeight = this.currentQueryHeight();
      const natural = this.overlayState.layout.desiredHeight ?? fallbackQuerySizeForPhase(
        this.overlayState.contentPhase,
        this.resultCount,
        workArea,
      ).height;
      const nextHeight =
        delta === 'natural'
          ? natural
          : delta === 'max'
            ? this.availableQueryHeight(workArea)
            : currentHeight + delta;
      const transition = applyOverlayEvent(this.overlayState, {
        type: 'RESIZE_KEYBOARD',
        sessionEpoch: request.identity.sessionEpoch,
        generation: request.identity.generation,
        windowGeneration: request.identity.windowGeneration,
        contentRevision: request.identity.contentRevision,
        handoffId: request.sessionId,
        sequence: request.sequence,
        height: nextHeight,
        edge: this.queryResizeEdgeForCurrent(workArea),
      });
      if (transition.decision !== 'applied') {
        return this.rejectedLayoutAck(request.sessionId, request.sequence);
      }
      this.startCommandObservation('layout', request.sequence, request.identity);
      this.commitAppliedTransition(transition);
      return this.acceptedLayoutAck(request.sessionId, request.sequence);
    }

    if (request.type !== 'update') {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    const edge = this.overlayState.layout.resize?.edge ?? this.queryResizeEdgeForCurrent(this.currentWorkArea());
    const baseline = this.overlayState.layout.resize?.baselineHeight ?? this.currentQueryHeight();
    const signed = edge === 'top' ? -request.deltaY : request.deltaY;
    const transition = applyOverlayEvent(this.overlayState, {
      type: 'RESIZE_UPDATE',
      sessionEpoch: request.identity.sessionEpoch,
      generation: request.identity.generation,
      windowGeneration: request.identity.windowGeneration,
      contentRevision: request.identity.contentRevision,
      handoffId: request.sessionId,
      sequence: request.sequence,
      height: baseline + signed,
      edge,
    });
    if (transition.decision !== 'applied') {
      return this.rejectedLayoutAck(request.sessionId, request.sequence);
    }
    this.startCommandObservation('layout', request.sequence, request.identity);
    this.commitAppliedTransition(transition);
    return this.acceptedLayoutAck(request.sessionId, request.sequence, this.currentQueryHeight(), edge);
  }

  reportHandoffMilestone(
    handoffId: number,
    milestone: HandoffMilestone,
    identity: OverlayReportIdentity,
  ): void {
    if (this.isInactive()) {
      return;
    }
    if (!this.matchesReportOrigin(identity)) {
      this.staleRendererReports += 1;
      this.lastStaleRendererReport = `handoff:${milestone}:${handoffId}`;
      return;
    }
    const type = milestone === 'open-armed'
      ? 'HANDOFF_ARMED'
      : milestone === 'open-finished'
        ? 'HANDOFF_OPENED'
        : 'HANDOFF_CLOSED';
    this.dispatchOverlayEvent({
      type,
      sessionEpoch: identity.sessionEpoch,
      generation: identity.generation,
      windowGeneration: identity.windowGeneration,
      handoffId,
    } as OverlayEvent);
  }

  private commandObservationKey(
    commandType: 'handoff' | 'layout' | 'settle',
    commandId: number,
    identity: OverlayReportIdentity,
  ): string {
    return [
      identity.sessionEpoch,
      identity.generation,
      identity.windowGeneration,
      identity.contentRevision,
      commandType,
      commandId,
    ].join(':');
  }

  private startCommandObservation(
    commandType: 'handoff' | 'layout' | 'settle',
    commandId: number,
    identity: OverlayReportIdentity,
  ): void {
    const key = this.commandObservationKey(commandType, commandId, identity);
    const startedAt = performance.now();
    if (this.commandFrameStartedAt.has(key)) {
      this.droppedCommandObservations += 1;
    }
    if (this.commandFrameStartedAt.size >= MAX_COMMAND_OBSERVATIONS) {
      const oldest = this.commandFrameStartedAt.keys().next().value;
      if (oldest !== undefined) {
        this.commandFrameStartedAt.delete(oldest);
        this.droppedCommandObservations += 1;
      }
    }
    this.commandFrameStartedAt.set(key, startedAt);
  }

  private recordRendererFrame(
    commandType: 'handoff' | 'layout' | 'settle',
    commandId: number,
    identity: OverlayReportIdentity,
  ): boolean {
    const key = this.commandObservationKey(commandType, commandId, identity);
    const startedAt = this.commandFrameStartedAt.get(key);
    if (startedAt === undefined) {
      return false;
    }
    this.commandFrameStartedAt.delete(key);
    const completedAt = performance.now();
    const duration = Math.max(0, completedAt - startedAt);
    this.coldCallbackMs ??= duration;
    this.commandCallbackDurations.push(duration);
    if (this.commandCallbackDurations.length > 4_096) {
      this.commandCallbackDurations.splice(
        0,
        this.commandCallbackDurations.length - 4_096,
      );
    }
    return true;
  }

  moveBy(
    dx: unknown,
    dy: unknown,
    finished = false,
    generation?: number,
    identity?: OverlayReportIdentity,
  ): FoxDragSettleAck | null {
    if (this.isInactive()) {
      return null;
    }
    if (identity && !this.matchesReportOrigin(identity)) {
      this.staleRendererReports += 1;
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
      if (this.overlayState.drag.settle?.generation === foxGeneration) {
        return null;
      }
      const activeGeneration = this.overlayState.drag.session?.generation;
      if (
        (finished && activeGeneration !== foxGeneration)
        || (!finished && activeGeneration !== undefined && activeGeneration !== foxGeneration)
      ) {
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
        !this.foxDragTransaction
        && (this.overlayState.fox.edge === 'left' || this.overlayState.fox.edge === 'right')
      ) {
        this.foxDragTransaction = {
          geometry: createFoxDockDragSession(
            this.overlayState.fox.edge,
            this.overlayState.fox.peekIntent === 'peek',
            nativeBounds,
          ),
          generation: foxGeneration ?? 1,
          sessionEpoch: this.overlayState.sessionEpoch,
          windowGeneration: this.overlayState.windowGeneration,
        };
      }
      if (
        this.foxDragTransaction
        && (
          this.foxDragTransaction.generation !== foxGeneration
          || this.foxDragTransaction.sessionEpoch !== this.overlayState.sessionEpoch
          || this.foxDragTransaction.windowGeneration !== this.overlayState.windowGeneration
        )
      ) {
        this.foxDragTransaction = null;
      }
      if (this.foxDragTransaction) {
        const stepped = advanceFoxDockDragSession(
          this.foxDragTransaction.geometry,
          delta.dx,
          delta.dy,
          sessionWorkArea,
        );
        this.foxDragTransaction = {
          ...this.foxDragTransaction,
          geometry: stepped.session,
        };
        const transition = this.dispatchOverlayEvent({
          type: 'FOX_DRAG_MOVED',
          ...this.overlayEventGuard(),
          dragGeneration: foxGeneration ?? 1,
          target: 'fox',
          dx: delta.dx,
          dy: delta.dy,
          nextBounds: stepped.nativeRect,
          displayId: screen.getDisplayMatching(stepped.nativeRect).id,
        });
        if (transition?.decision !== 'applied') {
          this.foxDragTransaction = null;
          return null;
        }
        if (
          foxDockDragSessionVisuallyUndocked(stepped.session)
          && this.overlayState.fox.edge !== 'none'
        ) {
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
    if (finished) {
      if (target === this.fox) {
        const transaction = this.foxDragTransaction;
        this.foxDragTransaction = null;
        const settledGeneration = this.overlayState.drag.session?.generation ?? null;
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
        const settled = transaction
          ? finishFoxDockDragSession(transaction.geometry, foxWorkArea)
          : {
              rect: dockFoxNativeRect(
                inferredFox,
                foxWorkArea,
                resolveFoxDockAfterDrag(inferredFox, foxWorkArea),
              ),
              edge: resolveFoxDockAfterDrag(inferredFox, foxWorkArea),
            };
        this.foxOrigin = { x: settled.rect.x, y: settled.rect.y };
        const settleId = ++this.foxDragSettleSequence;
        const transition = this.dispatchOverlayEvent({
          type: 'FOX_DRAG_ENDED',
          ...this.overlayEventGuard(),
          dragGeneration: settledGeneration,
          target: 'fox',
          settledBounds: settled.rect,
          edge: settled.edge,
          settleId,
          displayId: screen.getDisplayMatching(settled.rect).id,
        });
        if (transition?.decision !== 'applied') {
          return null;
        }
        this.schedulePostFoxDragWork();
        const active = this.overlayState.drag.settle;
        return active?.id === settleId
          ? {
              edge: active.edge,
              epoch: this.overlayState.fox.peekEpoch,
              generation: active.generation,
              settleId: active.id,
            }
          : null;
      } else {
        const anchor = this.currentQueryAnchor();
        const moved = this.dispatchOverlayEvent({
          type: 'FOX_DRAG_MOVED',
          ...this.overlayEventGuard(),
          dragGeneration: Math.max(1, this.overlayState.drag.generation),
          target: 'query',
          dx: delta.dx,
          dy: delta.dy,
          nextBounds: next,
          displayId: targetDisplay.id,
          queryAnchor: anchor,
        });
        if (moved?.decision !== 'applied') {
          return null;
        }
        const ended = this.dispatchOverlayEvent({
          type: 'FOX_DRAG_ENDED',
          ...this.overlayEventGuard(),
          dragGeneration: Math.max(1, this.overlayState.drag.generation),
          target: 'query',
          settledBounds: next,
          edge: resolveFoxDockAfterDrag(
            inferFoxRectFromQuery(next, workArea, anchor),
            workArea,
          ),
          settleId: ++this.foxDragSettleSequence,
          displayId: targetDisplay.id,
        });
        if (ended?.decision !== 'applied') {
          return null;
        }
        this.settlePinnedQueryDrag(next, workArea);
      }
    } else {
      const transition = this.dispatchOverlayEvent({
        type: 'FOX_DRAG_MOVED',
        ...this.overlayEventGuard(),
        dragGeneration: foxGeneration ?? Math.max(1, this.overlayState.drag.generation),
        target: target === this.fox ? 'fox' : 'query',
        dx: delta.dx,
        dy: delta.dy,
        nextBounds: next,
        displayId: targetDisplay.id,
        queryAnchor: target === this.query
          ? this.overlayState.drag.queryAnchor ?? this.currentQueryAnchor()
          : undefined,
      });
      if (transition?.decision !== 'applied') {
        return null;
      }
      if (target === this.fox) {
        this.foxOrigin = { x: next.x, y: next.y };
      } else {
        const anchor = this.overlayState.drag.queryAnchor ?? this.currentQueryAnchor();
        const inferredFox = inferFoxRectFromQuery(next, workArea, anchor);
        this.foxOrigin = { x: inferredFox.x, y: inferredFox.y };
      }
    }
    return null;
  }

  commitFoxDragSettle(settleId: number, identity?: OverlayReportIdentity): void {
    if (this.isInactive()) {
      return;
    }
    if (identity && !this.matchesReportOrigin(identity)) {
      this.staleRendererReports += 1;
      return;
    }
    const settle = this.overlayState.drag.settle;
    if (!settle || settle.id !== settleId) {
      return;
    }
    this.dispatchOverlayEvent({
      type: 'FOX_DRAG_SETTLE_COMMITTED',
      ...this.overlayEventGuard(),
      dragGeneration: settle.generation,
      settleId,
    });
  }

  setFoxPeek(
    intent: FoxPeekIntent,
    epoch: number,
    identity?: OverlayReportIdentity,
  ): void {
    const fox = this.fox;
    if (
      this.isInactive() ||
      !this.live(fox) ||
      !fox.isVisible() ||
      this.overlayState.phase !== 'parked' ||
      this.overlayState.fox.edge === 'none' ||
      epoch !== this.overlayState.fox.peekEpoch
    ) {
      return;
    }
    if (identity && !this.matchesReportOrigin(identity)) {
      this.staleRendererReports += 1;
      return;
    }
    // Peek/retract is a renderer-only crop. Read the frame that WindowServer
    // accepted, but never try to move the native window in response to hover.
    // This avoids a Stage Manager loop where x=0 is repeatedly requested and
    // macOS repeatedly seats the background overlay at its active-stage edge.
    this.syncFoxOriginFromNativeBounds(fox);
    if (intent === this.overlayState.fox.peekIntent) {
      return;
    }
    this.dispatchOverlayEvent({
      type: 'FOX_PEEK_CHANGED',
      ...this.overlayEventGuard(),
      intent,
      peekEpoch: epoch,
    });
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
    this.clearFoxYieldShow();
    this.displayReconcilePending = false;
    this.foxDragTransaction = null;
    this.scheduler.clear(this.postFoxDragTimer);
    this.postFoxDragTimer = null;
    for (const handle of this.timeoutHandles.values()) {
      this.scheduler.clear(handle);
    }
    this.timeoutHandles.clear();
    this.scheduler.dispose();
    globalShortcut.unregisterAll();
    this.onDispose?.();
  }

  private yieldOrKeepPalette(fox: BrowserWindow): void {
    const yieldFocus = this.overlayState.focusIntent === 'previous-app';
    this.setFoxFocusable(false);
    // Idle fox must not become the key window, or Grok Build / 千牛 keep
    // looking focused while keystrokes go nowhere until the user clicks.
    if (!yieldFocus || this.otherChromeWindowsVisible()) {
      this.resignPaletteActivation(fox);
      this.dispatchOverlayEvent({
        type: 'FOCUS_RESTORED',
        ...this.overlayEventGuard(),
      });
      return;
    }
    const yielded = this.platform.yieldPreviousApp(fox, {
      canShow: () => (
        this.overlayState.phase === 'parked'
        && this.overlayState.handoff.mode === 'none'
        && this.live(fox)
      ),
      onShown: (shown) => {
        this.syncFoxOriginFromNativeBounds(shown);
      },
    });
    if (!yielded) {
      this.resignPaletteActivation(fox);
    }
    this.dispatchOverlayEvent({
      type: 'FOCUS_RESTORED',
      ...this.overlayEventGuard(),
    });
  }

  private otherChromeWindowsVisible(): boolean {
    return BrowserWindow.getAllWindows().some((win) => {
      if (win.isDestroyed() || !win.isVisible()) {
        return false;
      }
      if (win === this.fox || win === this.query) {
        return false;
      }
      return !this.isDevToolsWindow(win);
    });
  }

  private isDevToolsWindow(win: BrowserWindow): boolean {
    const contents = win.webContents;
    if (!contents || contents.isDestroyed()) {
      return false;
    }
    const type = typeof contents.getType === 'function' ? contents.getType() : '';
    if (type === 'remote') {
      return true;
    }
    const url = typeof contents.getURL === 'function' ? contents.getURL() : '';
    return url.startsWith('devtools:');
  }

  private setFoxFocusable(focusable: boolean): void {
    const fox = this.fox;
    if (!this.live(fox) || typeof fox.setFocusable !== 'function') {
      return;
    }
    fox.setFocusable(focusable);
  }

  private clearFoxYieldShow(): void {
    this.platform.cancelYield();
  }

  private queryAcceptsKeyboard(): boolean {
    return (
      (this.overlayState.phase === 'opening' || this.overlayState.phase === 'active')
      && this.overlayState.handoff.mode !== 'closing'
      && this.isWindowVisible(this.query)
    );
  }

  private setQueryFocusable(focusable: boolean): void {
    const query = this.query;
    if (!this.live(query) || typeof query.setFocusable !== 'function') {
      return;
    }
    query.setFocusable(focusable);
  }

  private bindQueryKeyboardGuard(query: BrowserWindow): void {
    if (typeof query.webContents.on !== 'function') {
      return;
    }
    query.webContents.on('before-input-event', (event) => {
      if (!this.queryAcceptsKeyboard()) {
        event.preventDefault();
      }
    });
  }

  private resignQueryKeyboard(options: { hide: boolean }): void {
    const query = this.query;
    if (!this.live(query)) {
      return;
    }
    if (typeof query.blur === 'function') {
      query.blur();
    }
    if (options.hide && query.isVisible()) {
      query.hide();
    }
    this.setQueryFocusable(false);
  }

  private resignPaletteActivation(fox: BrowserWindow): void {
    if (!this.live(fox)) {
      return;
    }
    this.platform.restorePalette(fox);
  }

  private focusQueryWindow(): void {
    const query = this.query;
    if (!this.live(query)) {
      return;
    }
    this.platform.focusQuery(query);
  }

  private scheduleQueryFocusRetry(): void {
    this.clearQueryFocusRetry();
    // Mapping a hidden macOS regular window and assigning native focus are separate
    // WindowServer operations. Reconcile once after two compositor frames;
    // renderer rAF focus alone cannot route physical keyboard events.
    this.queryFocusRetryTimer = this.scheduler.schedule(() => {
      this.queryFocusRetryTimer = null;
      if (
        (this.overlayState.phase === 'opening' || this.overlayState.phase === 'active')
        && this.isWindowVisible(this.query)
      ) {
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
    if (this.overlayState.handoff.mode !== 'none') {
      this.scheduleDisplayReconcile();
      return;
    }

    // Display topology is authoritative, but interrupting an in-flight dock
    // drag would split Main's native frame from the renderer's crop offset.
    // Defer one reconcile until the finished drag acknowledgement is produced.
    if (this.foxDragTransaction || this.overlayState.drag.session || this.overlayState.drag.settle) {
      this.displayReconcilePending = true;
      return;
    }

    this.finishOrClearQueryDrag();

    const point = {
      x: Math.round(this.foxOrigin.x + FOX_SIZE / 2),
      y: Math.round(this.foxOrigin.y + FOX_SIZE / 2),
    };
    const workArea = screen.getDisplayNearestPoint(point).workArea;
    const edge = reconcileFoxDockEdgeForWorkArea(
      point.x,
      workArea,
      this.overlayState.fox.edge,
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
    if (edge === 'left') {
      clampedFox.x = workArea.x;
    } else if (edge === 'right') {
      clampedFox.x = workArea.x + workArea.width - FOX_SIZE;
    }
    this.foxOrigin = { x: clampedFox.x, y: clampedFox.y };
    const foxBounds = dockFoxNativeRect(clampedFox, workArea, edge);
    const queryBounds = this.overlayState.phase === 'parked'
      ? undefined
      : placeQueryAnchoredToFox(
          clampedFox,
          this.currentQuerySize(workArea),
          workArea,
          edge,
          this.overlayState.drag.queryAnchor ?? undefined,
        );
    const queryAnchor = queryBounds
      ? queryAnchorForFox(clampedFox, workArea)
      : undefined;
    this.dispatchOverlayEvent({
      type: 'DISPLAY_CHANGED',
      ...this.overlayEventGuard(),
      displayId: screen.getDisplayNearestPoint(point).id,
      edge,
      foxBounds,
      queryBounds,
      queryAnchor,
    });
  }

  private currentQuerySize(workArea: Rect) {
    return effectiveQuerySize({
      phase: this.overlayState.contentPhase,
      resultCount: this.resultCount,
      workArea,
      measuredHeight: this.overlayState.layout.desiredHeight,
      manualHeight: this.overlayState.layout.appliedHeight,
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
    return this.live(this.query)
      ? resolveQueryResizeEdge(this.query.getBounds(), workArea)
      : this.overlayState.layout.resizeEdge;
  }

  private applyQueryHeight(
    nextHeight: number,
    edge: QueryResizeEdge,
    allowFlip = false,
  ): { height: number; edge: QueryResizeEdge } {
    const query = this.query;
    if (!this.live(query)) {
      return { height: nextHeight, edge };
    }
    const workArea = this.currentWorkArea();
    const current = query.getBounds();
    const chosen = allowFlip
      ? pickQueryResizeEdgeForHeight(current, nextHeight, workArea, edge)
      : edge;
    const next = applyQueryVerticalResize(current, nextHeight, chosen, workArea);
    query.setBounds(next);
    return { height: next.height, edge: chosen };
  }

  private reportablePhase(): ReportablePhase {
    return this.overlayState.contentPhase;
  }

  private acceptedLayoutAck(
    sessionId: number,
    sequence: number,
    height = this.currentQueryHeight(),
    resizeEdge = this.overlayState.layout.resizeEdge,
  ): QueryLayoutAck {
    return acceptedQueryLayoutAck(
      sessionId,
      sequence,
      height,
      resizeEdge,
      this.reportablePhase(),
      this.resultCount,
    );
  }

  private rejectedLayoutAck(sessionId: number, sequence: number): QueryLayoutAck {
    return rejectedQueryLayoutAck(
      sessionId,
      sequence,
      this.currentQueryHeight(),
      this.overlayState.layout.resizeEdge,
      this.reportablePhase(),
      this.resultCount,
    );
  }

  queryLayoutDebugState(): {
    handoffId: number;
    lastSequence: number;
    phase: OverlayPhase;
    lifecycle: OverlayState['phase'];
    handoffMode: OverlayState['handoff']['mode'];
    resultCount: ResultCount;
    resizeSession: { sessionId: number; finished: boolean; lastSequence: number } | null;
    performance: ReturnType<OverlayController['performanceSnapshot']>;
  } {
    const resize = this.overlayState.layout.resize;
    return {
      handoffId: this.overlayState.handoff.id,
      lastSequence: this.overlayState.layout.sequence,
      phase: this.phase,
      lifecycle: this.overlayState.phase,
      handoffMode: this.overlayState.handoff.mode,
      resultCount: this.resultCount,
      resizeSession: resize
        ? {
            sessionId: resize.handoffId,
            finished: false,
            lastSequence: resize.lastSequence,
          }
        : null,
      performance: this.performanceSnapshot(),
    };
  }

  performanceSnapshot(): {
    count: number;
    pending: number;
    pendingKeys: string[];
    p50: number | null;
    p95: number | null;
    p99: number | null;
    coldMs: number | null;
    coldSemantics: 'first-completed-observation';
    errors: number;
    droppedObservations: number;
    staleReports: number;
    lastStaleReport: string | null;
    signal: 'renderer-callback';
    paintObserved: false;
  } {
    const sorted = [...this.commandCallbackDurations].sort((a, b) => a - b);
    const percentile = (p: number): number | null => {
      if (sorted.length === 0) return null;
      const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
      return sorted[Math.max(0, index)] ?? null;
    };
    return {
      count: sorted.length,
      pending: this.commandFrameStartedAt.size,
      pendingKeys: [...this.commandFrameStartedAt.keys()].slice(0, 16),
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      coldMs: this.coldCallbackMs,
      coldSemantics: 'first-completed-observation',
      errors: this.droppedCommandObservations + this.staleRendererReports,
      droppedObservations: this.droppedCommandObservations,
      staleReports: this.staleRendererReports,
      lastStaleReport: this.lastStaleRendererReport,
      signal: 'renderer-callback',
      paintObserved: false,
    };
  }

  private applyFallbackQueryHeight(): void {
    if (this.overlayState.layout.appliedHeight !== null || this.overlayState.layout.resize) {
      return;
    }
    const workArea = this.currentWorkArea();
    const fallback = fallbackQuerySizeForPhase(
      this.overlayState.contentPhase,
      this.resultCount,
      workArea,
    );
    const result = this.applyQueryHeight(
      fallback.height,
      this.queryResizeEdgeForCurrent(workArea),
      true,
    );
    this.commitNativeLayout(
      result.height,
      result.edge,
      this.overlayState.layout.sequence,
    );
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
      options.includePeek !== false && this.overlayState.fox.peekIntent === 'peek'
        ? FOX_EDGE_PEEK_TRAVEL_PX
        : 0;
    return foxVisualCenterForNativeRect(fullFoxRect, this.overlayState.fox.edge, peekOffset);
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
    this.dispatchOverlayEvent({
      type: 'SHORTCUT_STATUS_CHANGED',
      ...this.overlayEventGuard(),
      registered: this.shortcutRegistered,
      accelerator: this.accelerator,
      message: this.shortcutMessage,
    });
  }

  private sendToFox(command: OverlayCommand): void {
    if (this.live(this.fox) && !this.fox.webContents.isDestroyed()) {
      this.fox.webContents.send(IPC_CHANNELS.OVERLAY_COMMAND, command);
    }
  }

  private advanceFoxPeekEpoch(): number {
    const peekEpoch = this.overlayState.fox.peekEpoch + 1;
    this.dispatchOverlayEvent({
      type: 'FOX_EDGE_SYNCED',
      ...this.overlayEventGuard(),
      edge: this.overlayState.fox.edge,
      peekEpoch,
    });
    return peekEpoch;
  }

  private resetFoxPeekLifecycle(edge: FoxDockEdge): number {
    const epoch = this.advanceFoxPeekEpoch();
    if (edge !== this.overlayState.fox.edge) {
      this.dispatchOverlayEvent({
        type: 'FOX_EDGE_SYNCED',
        ...this.overlayEventGuard(),
        edge,
        peekEpoch: epoch + 1,
      });
      return epoch + 1;
    }
    return epoch;
  }

  private schedulePostFoxDragWork(): void {
    if (this.postFoxDragTimer !== null || this.isInactive()) {
      return;
    }
    this.postFoxDragTimer = this.scheduler.schedule(() => {
      this.postFoxDragTimer = null;
      if (
        this.isInactive()
        || this.foxDragTransaction
        || this.overlayState.drag.session
        || this.overlayState.drag.settle
      ) {
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
    const active = this.overlayState.drag.session?.generation;
    if (active !== undefined) return active;
    if (finished) {
      return null;
    }
    this.legacyFoxDragGenerationSequence += 1;
    return this.legacyFoxDragGenerationSequence;
  }

  private armBlurGrace(): void {
    this.ignoreBlurUntil = Date.now() + BLUR_GRACE_MS;
    this.blurRecheckIdentity = this.currentReportOrigin();
    this.schedulePendingBlurRecheck();
  }

  private handleQueryBlur(): void {
    if (
      this.isInactive()
      || this.overlayState.phase !== 'active'
      || !this.isWindowVisible(this.query)
    ) {
      this.clearPendingQueryBlur();
      return;
    }
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && focused !== this.query && focused !== this.fox) {
      this.clearPendingQueryBlur();
      return;
    }
    this.blurRecheckIdentity = this.currentReportOrigin();
    this.pendingQueryBlur = true;
    this.schedulePendingBlurRecheck();
  }

  private schedulePendingBlurRecheck(): void {
    this.scheduler.clear(this.blurRecheckTimer);
    this.blurRecheckTimer = null;
    if (
      this.isInactive()
      || !this.pendingQueryBlur
      || !this.blurRecheckIdentity
      || !this.matchesReportOrigin(this.blurRecheckIdentity)
    ) {
      this.clearPendingQueryBlur();
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
    this.blurRecheckIdentity = null;
    if (
      (this.overlayState.phase === 'opening' || this.overlayState.phase === 'active')
      && this.isWindowVisible(this.query)
    ) {
      this.dismiss(true);
    }
  }

  private clearPendingQueryBlur(): void {
    this.pendingQueryBlur = false;
    this.blurRecheckIdentity = null;
    this.scheduler.clear(this.blurRecheckTimer);
    this.blurRecheckTimer = null;
  }

  private prefersReducedMotion(): boolean {
    return this.platform.prefersReducedMotion();
  }

  private currentQueryAnchor(): QueryAnchor {
    const workArea = this.currentWorkArea();
    return queryAnchorForFox(
      { x: this.foxOrigin.x, width: FOX_SIZE },
      workArea,
    );
  }

  private sessionQueryAnchor(computed: QueryAnchor = this.currentQueryAnchor()): QueryAnchor {
    return resolveSessionQueryAnchor(this.overlayState.drag.queryAnchor, computed);
  }

  private clearQueryDragGesture(): void {
    if (this.overlayState.drag.queryAnchor !== null) {
      this.dispatchOverlayEvent({
        type: 'QUERY_DRAG_CLEARED',
        ...this.overlayEventGuard(),
      });
    }
  }

  private finishOrClearQueryDrag(): void {
    if (this.overlayState.drag.queryAnchor === null) {
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
    const queryAnchor = this.overlayState.drag.queryAnchor;
    if (queryAnchor === null) {
      return;
    }
    const settled = settleQueryDragGesture(queryRect, workArea, queryAnchor);
    this.foxOrigin = { x: settled.fox.x, y: settled.fox.y };
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
        this.dismiss(true);
      }
    });
  }

  private createChromeWindow(size: OverlayChromeWindowSize): BrowserWindow {
    return createOverlayChromeWindow(this.preloadPath, size);
  }
}
