import { SopUnifiedRuntime } from './sop-unified-runtime';
import type { SopUnifiedCommand } from '../shared/sop-unified';
import type { SopQueryRuntime } from './sop-query-runtime';
import type { SopQueryCommand } from '../shared/sop-query';
import { BrowserWindow, clipboard, nativeImage, type WebContents } from 'electron';
import { join } from 'node:path';
import { resolveClipboardWrite } from '../shared/clipboard-write';
import {
  writeSopClipboard,
  type SopClipboardPayload,
} from '../shared/sop-pipeline';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { SCREEN_MARGIN, clampRectToWorkArea, sanitizeDragDelta, type Rect, type Size } from '../shared/overlay-geometry';
import { ALLERGY_SOP_SCENE_ID } from '../shared/sop-entry';
import {
  SOP_COPY_FEEDBACK_MS,
  SOP_BOOKMARK_EDGE_DISTANCE,
  SOP_LAYOUT_TIMEOUT_MS,
  SOP_MIN_HEIGHT,
  SOP_MIN_WIDTH,
  SOP_OPEN_HEIGHT,
  SOP_WIDTH,
  applySopDrag,
  applySopHeight,
  placeSopLeftCenter,
  placeSopNearQuery,
  sopLayoutNeedsProjection,
  sopOpeningSize,
} from '../shared/sop-geometry';
import { resizeRectFromEdge, type WindowResizeDirection } from '../shared/window-resize-geometry';
import {
  advanceSopNext,
  canCopySopNode,
  chooseSopEdge,
  currentSopNode,
  projectSop,
  startSopProgress,
  validateSopTree,
  type SopProgress,
  type SopPublishSet,
  type SopTree,
  type SopViewerRole,
} from '../shared/sop-model';
import { ALLERGY_SOP_TREE } from '../shared/synthetic-sops';
import {
  SOP_OPEN_FAILURE_MESSAGE,
  rejectedSopLayoutAck,
  sopWindowFailure,
  type SopCopyResult,
  type SopLayoutAck,
  type SopLayoutRequest,
  type SopProjection,
  type SopBookmarkIntent,
  type SopResizeRequest,
  type SopShellState,
  type SopWindowErrorCode,
  type SopWindowChrome,
  type SopWindowResult,
} from '../shared/sop-window';
import { GuardedScheduler } from './guarded-scheduler';
import { createOverlayChromeWindow } from './overlay-chrome-window';
import { loadRenderer } from './overlay-renderer-loader';
import { lockRendererWindow } from './window-security';

export type SopWindowControllerOptions = {
  preloadPath?: string;
  legacyEnabled?: boolean;
  rendererDevServerUrl?: () => string | undefined;
  queryBounds: () => Rect | null;
  workArea: (reference?: Rect) => Rect;
  sessionRole: () => SopViewerRole;
  publishedScriptIds?: () => SopPublishSet;
  writeClipboard?: (text: string) => void;
  instance?: {
    place: (bounds: Rect, workArea: Rect, query: Rect | null) => Rect;
    placeBookmark: (workArea: Rect, size?: Size) => Rect | null;
    onClosed: () => void;
    onProjectionChanged: () => void;
  };
};

/** INT-DESKTOP calls this with bytes already resolved by Main. Electron receives
 * text and image in one write, so a failed image conversion cannot leave text
 * behind as an apparent successful copy. */
export function writeSopClipboardNative(payload: SopClipboardPayload): void {
  writeSopClipboard(
    { write: (data) => clipboard.write(data as Parameters<typeof clipboard.write>[0]) },
    (bytes) => {
      const image = nativeImage.createFromBuffer(Buffer.from(bytes), { scaleFactor: 1 });
      return image.isEmpty() ? null : image;
    },
    payload,
  );
}

export class SopWindowController {
  private window: BrowserWindow | null = null;
  private queryRuntime: SopQueryRuntime | SopUnifiedRuntime | null = null;
  private unsubscribeRuntime: (() => void) | null = null;
  private readonly legacyEnabled: boolean;
  private tree: SopTree | null = null;
  private progress: SopProgress | null = null;
  private shellState: SopShellState = 'opening';
  private failCode: SopWindowErrorCode | null = null;
  private failMessage: string | null = null;
  private copied = false;
  private opening: Promise<SopWindowResult> | null = null;
  private sessionId = 0;
  private lastLayoutSequence = 0;
  private lastResizeSequence = 0;
  private firstContentPlacement = false;
  private manualSize: Size | null = null;
  private resizing: { baseline: Rect; area: Rect; direction: WindowResizeDirection } | null = null;
  private parkedFrom: Rect | null = null;
  private dockArmed = false;
  private disposed = false;
  private readonly scheduler = new GuardedScheduler();
  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly preloadPath: string;
  private readonly rendererDevServerUrl?: () => string | undefined;
  private readonly queryBounds: () => Rect | null;
  private readonly workArea: SopWindowControllerOptions['workArea'];
  private readonly sessionRole: () => SopViewerRole;
  private readonly publishedScriptIds: () => SopPublishSet;
  private readonly writeClipboard: (text: string) => void;
  private readonly instance: SopWindowControllerOptions['instance'];

  constructor(options: SopWindowControllerOptions) {
    this.legacyEnabled = options.legacyEnabled ?? true;
    this.preloadPath = options.preloadPath ?? join(__dirname, '../preload/sop.cjs');
    this.rendererDevServerUrl = options.rendererDevServerUrl;
    this.queryBounds = options.queryBounds;
    this.workArea = options.workArea;
    this.sessionRole = options.sessionRole;
    this.publishedScriptIds = options.publishedScriptIds ?? (() => 'fixture');
    this.writeClipboard = options.writeClipboard ?? ((text) => clipboard.writeText(text));
    this.instance = options.instance;
  }

  isSopContents(contents: WebContents): boolean {
    return Boolean(
      this.window
      && !this.window.isDestroyed()
      && this.window.webContents.id === contents.id,
    );
  }

  sopContents(): WebContents | null {
    if (!this.window || this.window.isDestroyed()) {
      return null;
    }
    return this.window.webContents;
  }

  setQueryRuntime(runtime: SopQueryRuntime | SopUnifiedRuntime): void {
    this.queryRuntime = runtime;
    this.unsubscribeRuntime = runtime.subscribe(() => {
      this.pushProjection();
      this.instance?.onProjectionChanged();
    });
  }

  hasInstance(): boolean {
    return this.queryRuntime instanceof SopUnifiedRuntime && this.queryRuntime.hasInstance();
  }

  instanceMenuLabel(): string | null {
    const runtime = this.queryRuntime;
    if (!(runtime instanceof SopUnifiedRuntime) || !runtime.canResumeInstance()) return null;
    return runtime.instanceName() ?? '恢复 SOP 流程';
  }

  bounds(visibleOnly = false): Rect | null {
    const win = this.liveWindow();
    return win && (!visibleOnly || win.isVisible()) ? win.getBounds() : null;
  }

  reconcileBookmark(): void {
    const win = this.liveWindow();
    if (!win?.isVisible() || !this.parkedFrom) return;
    const area = this.workArea(this.parkedFrom);
    if (!this.fitBookmark(win, area, win.getBounds())) win.hide();
  }

  resumeInstance(): void {
    if (this.instanceMenuLabel()) this.revealExisting();
  }

  async unifiedCommand(command: SopUnifiedCommand): Promise<SopWindowResult> {
    if (!(this.queryRuntime instanceof SopUnifiedRuntime)) return sopWindowFailure('UNAVAILABLE', '流程尚未开放');
    if (command.kind === 'clear' && this.instance) return this.endFlow();
    const result = await this.queryRuntime.command(command);
    return result.ok ? { ok: true } : sopWindowFailure('FAILED', '操作未完成，请查看流程提示');
  }

  async queryCommand(command: SopQueryCommand): Promise<SopWindowResult> {
    if (!this.queryRuntime || this.instance) return sopWindowFailure('UNAVAILABLE', '流程尚未开放');
    const result = await this.queryRuntime.command(command);
    return result.ok ? { ok: true } : sopWindowFailure('FAILED', '操作未完成，请查看流程提示');
  }

  entryAvailable(): boolean {
    if (this.queryRuntime) return true;
    if (!this.legacyEnabled) return false;
    try {
      const tree = this.loadTree();
      validateSopTree(tree);
      return true;
    } catch {
      return false;
    }
  }

  resumeAvailable(): boolean {
    return this.liveWindow() !== null && (this.progress !== null || this.queryRuntime !== null);
  }

  async open(sceneId: string): Promise<SopWindowResult> {
    if (this.disposed) {
      return sopWindowFailure('UNAVAILABLE', SOP_OPEN_FAILURE_MESSAGE);
    }
    if (this.queryRuntime) return sceneId === 'sop-query' ? this.openQuery() : sopWindowFailure('INVALID', '请选择流程');
    if (!this.legacyEnabled) return sopWindowFailure('UNAVAILABLE', '流程尚未开放');
    if (sceneId !== ALLERGY_SOP_SCENE_ID) {
      return sopWindowFailure('INVALID', '当前切片不能切换流程');
    }
    if (this.opening) {
      return this.opening;
    }
    if (this.liveWindow() && this.progress?.sceneId === sceneId) {
      if (this.shellState === 'failed' && this.failCode === 'SOP_LOAD_FAILED') {
        this.opening = this.createOrReload(sceneId);
        try {
          return await this.opening;
        } finally {
          this.opening = null;
        }
      }
      this.revealExisting();
      return { ok: true };
    }
    if (this.liveWindow() && this.progress && this.progress.sceneId !== sceneId) {
      return sopWindowFailure('INVALID', '当前切片不能切换流程');
    }
    this.opening = this.createOrReload(sceneId);
    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }

  close(): void {
    this.hideRememberingProgress();
  }

  hideRememberingProgress(): void {
    const win = this.liveWindow();
    if (!win) {
      return;
    }
    this.cancelResize(win);
    this.dockArmed = false;
    this.firstContentPlacement = false;
    win.hide();
    win.webContents.setBackgroundThrottling(false);
    const runtime = this.queryRuntime;
    if (this.instance && runtime instanceof SopUnifiedRuntime) {
      const projection = runtime.projection();
      const candidateWithoutProgress = projection.entry === 'candidate' && !runtime.hasInstance();
      if ((projection.state === 'ended' || candidateWithoutProgress) && !win.isDestroyed()) win.destroy();
    }
  }

  async endFlow(): Promise<SopWindowResult> {
    if (this.queryRuntime instanceof SopUnifiedRuntime) {
      if (!(await this.queryRuntime.finish()).ok) {
        return sopWindowFailure('FAILED', '结束结果尚未确认，请按原请求确认。');
      }
    } else this.queryRuntime?.invalidate();
    this.clearLayoutTimer();
    this.scheduler.clear(this.copyTimer);
    this.copyTimer = null;
    this.copied = false;
    this.progress = null;
    this.tree = null;
    this.shellState = 'opening';
    this.failCode = null;
    this.failMessage = null;
    const win = this.window;
    this.window = null;
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
    return { ok: true };
  }

  async restart(): Promise<SopWindowResult> {
    if (this.queryRuntime instanceof SopUnifiedRuntime) {
      const result = await this.queryRuntime.restart();
      return result.ok ? { ok: true } : sopWindowFailure('FAILED', '流程未重新开始，请查看提示');
    }
    if (this.queryRuntime) { await this.queryRuntime.open(this.sessionId); return { ok: true }; }
    if (this.disposed) {
      return sopWindowFailure('UNAVAILABLE', SOP_OPEN_FAILURE_MESSAGE);
    }
    this.resetProgress();
    if (this.shellState === 'failed' && this.failCode === 'SOP_LOAD_FAILED') {
      return this.open(ALLERGY_SOP_SCENE_ID);
    }
    this.shellState = 'ready';
    this.failCode = null;
    this.failMessage = null;
    this.copied = false;
    this.pushProjection();
    return { ok: true };
  }

  chooseEdge(edgeId: string): SopWindowResult {
    if (!this.tree || !this.progress || this.shellState !== 'ready') {
      return sopWindowFailure('INVALID', '当前步骤不能继续');
    }
    const next = chooseSopEdge(this.tree, this.progress, edgeId);
    if (!next) {
      return sopWindowFailure('INVALID', '当前步骤不能继续');
    }
    this.progress = next;
    this.copied = false;
    this.pushProjection();
    return { ok: true };
  }

  nextStep(): SopWindowResult {
    if (!this.tree || !this.progress || this.shellState !== 'ready') {
      return sopWindowFailure('INVALID', '当前步骤不能继续');
    }
    const next = advanceSopNext(this.tree, this.progress);
    if (!next) {
      return sopWindowFailure('INVALID', '当前步骤不能继续');
    }
    this.progress = next;
    this.copied = false;
    this.pushProjection();
    return { ok: true };
  }

  moveBy(dx: unknown, dy: unknown, finished?: unknown): void {
    const win = this.liveWindow();
    if (!win || this.resizing || this.parkedFrom) {
      return;
    }
    const delta = sanitizeDragDelta(dx, dy);
    if (!delta) {
      return;
    }
    if (finished !== undefined && typeof finished !== 'boolean') {
      return;
    }
    const area = this.workArea();
    const next = applySopDrag(win.getBounds(), delta.dx, delta.dy, area);
    this.firstContentPlacement = false;
    win.setBounds(next);
    this.dockArmed = finished === true && next.x <= area.x + SOP_BOOKMARK_EDGE_DISTANCE;
  }

  bookmark(intent: SopBookmarkIntent): SopWindowResult {
    const win = this.liveWindow();
    if (!win?.isVisible() || !this.instance || !(this.queryRuntime instanceof SopUnifiedRuntime)) {
      return sopWindowFailure('UNAVAILABLE', '当前流程不可贴边');
    }
    if (intent === 'restore' || intent === 'restore-hover') {
      if (this.parkedFrom) this.restoreBookmark(win, intent === 'restore');
      return { ok: true };
    }
    if (this.parkedFrom || (intent === 'park-after-edge-drag' && !this.dockArmed)) return { ok: true };
    const projection = this.queryRuntime.projection();
    const name = projection.instanceName;
    if (!name || projection.busy || this.resizing || !this.instanceMenuLabel()) {
      return sopWindowFailure('UNAVAILABLE', '当前流程不可贴边');
    }
    const current = win.getBounds();
    if (!this.fitBookmark(win, this.workArea(current))) {
      return sopWindowFailure('UNAVAILABLE', '当前屏幕没有可用的贴边位置');
    }
    this.firstContentPlacement = false;
    this.dockArmed = false;
    this.parkedFrom = current;
    this.showChrome(win, { kind: 'parked', name });
    return { ok: true };
  }

  resize(request: SopResizeRequest): void {
    const win = this.liveWindow();
    if (!win?.isVisible() || this.parkedFrom || request.sessionId !== this.sessionId) return;
    if (request.type === 'begin') {
      if (request.sequence <= this.lastResizeSequence) return;
      this.cancelResize(win);
      this.firstContentPlacement = false;
      this.dockArmed = false;
      this.lastResizeSequence = request.sequence;
      const workArea = this.workArea(win.getBounds());
      const base = clampRectToWorkArea(win.getBounds(), workArea);
      const area = {
        x: workArea.x + SCREEN_MARGIN, y: workArea.y + SCREEN_MARGIN,
        width: Math.max(1, workArea.width - 2 * SCREEN_MARGIN),
        height: Math.max(1, workArea.height - 2 * SCREEN_MARGIN),
      };
      this.resizing = { baseline: base, area, direction: request.direction };
      return;
    }
    if (!this.resizing || request.sequence !== this.lastResizeSequence) return;
    if (request.type === 'cancel') {
      this.cancelResize(win);
      return;
    }
    const { baseline, area, direction } = this.resizing;
    const next = resizeRectFromEdge({
      baseline, bounds: area, direction, deltaX: request.deltaX, deltaY: request.deltaY,
      minSize: { width: SOP_MIN_WIDTH, height: SOP_MIN_HEIGHT }, maxSize: area,
    });
    const current = win.getBounds();
    if (sopLayoutNeedsProjection('ready', current, next)) win.setBounds(next);
    if (request.type === 'end') {
      this.resizing = null;
      const actual = win.getBounds();
      if (actual.width !== baseline.width || actual.height !== baseline.height) {
        this.manualSize = { width: actual.width, height: actual.height };
      }
    }
  }

  private cancelResize(win: BrowserWindow): void {
    if (!this.resizing) return;
    const { baseline } = this.resizing;
    this.resizing = null;
    win.setBounds(clampRectToWorkArea(baseline, this.workArea(baseline)));
  }

  reportLayout(request: SopLayoutRequest): SopLayoutAck {
    const win = this.liveWindow();
    if (!win || this.parkedFrom || request.sessionId !== this.sessionId || request.sequence <= this.lastLayoutSequence) {
      return rejectedSopLayoutAck(request.sessionId, request.sequence, SOP_OPEN_HEIGHT);
    }
    this.lastLayoutSequence = request.sequence;
    this.clearLayoutTimer();
    const current = win.getBounds();
    const workArea = this.workArea(current);
    let next = this.manualSize || this.resizing
      ? current
      : applySopHeight(current, request.desiredHeight, workArea);
    if (this.firstContentPlacement && request.contentReady) {
      this.firstContentPlacement = false;
      next = this.windowPlacement({ width: next.width, height: next.height }, workArea);
    }
    const shouldProject = sopLayoutNeedsProjection(this.shellState, current, next);
    if (sopLayoutNeedsProjection('ready', current, next)) {
      win.setBounds(next);
    }
    this.shellState = 'ready';
    this.failCode = null;
    this.failMessage = null;
    if (shouldProject) {
      this.pushProjection();
    }
    const actual = win.getBounds();
    return {
      ok: true,
      sessionId: request.sessionId,
      sequence: request.sequence,
      width: actual.width,
      height: actual.height,
    };
  }

  copyCurrent(): SopCopyResult {
    if (!this.tree || !this.progress || this.shellState !== 'ready') {
      return { ok: false, message: '没有可复制的话术内容' };
    }
    const node = currentSopNode(this.tree, this.progress);
    if (!node || !canCopySopNode(node, this.publishedScriptIds())) {
      if (node?.kind === 'copyable') {
        return { ok: false, message: '当前话术尚未发布，不能复制' };
      }
      return { ok: false, message: '没有可复制的话术内容' };
    }
    const resolved = resolveClipboardWrite(node.answerText);
    if (!resolved.ok) {
      return resolved;
    }
    try {
      this.writeClipboard(resolved.payload);
      this.copied = true;
      this.scheduler.clear(this.copyTimer);
      this.copyTimer = this.scheduler.schedule(() => {
        this.copyTimer = null;
        this.copied = false;
        this.pushProjection();
      }, SOP_COPY_FEEDBACK_MS);
      this.pushProjection();
      return { ok: true };
    } catch {
      return { ok: false, message: '复制失败，请重试' };
    }
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = null;
    this.queryRuntime?.dispose();
    this.clearLayoutTimer();
    this.scheduler.clear(this.copyTimer);
    this.copyTimer = null;
    this.scheduler.dispose();
    const win = this.window;
    this.window = null;
    this.progress = null;
    this.tree = null;
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  }

  private async openQuery(): Promise<SopWindowResult> {
    if (this.opening) return this.opening;
    this.opening = (async () => {
      if (this.liveWindow()) {
        this.revealExisting();
        await this.queryRuntime!.open(this.sessionId);
        return { ok: true } as const;
      }
      this.sessionId++; this.lastLayoutSequence = 0; this.lastResizeSequence = 0; this.manualSize = null;
      this.firstContentPlacement = Boolean(this.instance);
      const win = createOverlayChromeWindow(this.preloadPath, { width: SOP_WIDTH, height: SOP_OPEN_HEIGHT, title: 'SOP 合成流程', backgroundThrottling: false });
      lockRendererWindow(win); this.window = win;
      win.on('closed', () => {
        if (this.window === win) {
          this.window = null;
          if (!this.instance) this.queryRuntime?.invalidate();
        }
        this.instance?.onClosed();
      });
      win.setBounds(this.windowPlacement(sopOpeningSize()));
      try {
        const loaded = await loadRenderer(win, 'sop', this.rendererDevServerUrl?.(), () => this.disposed);
        if (loaded !== 'loaded' || this.disposed || win.isDestroyed()) return this.failLoad(win);
        this.pushProjection(); win.showInactive();
        await this.queryRuntime!.open(this.sessionId);
        return { ok: true } as const;
      } catch { return this.failLoad(win); }
    })();
    try { return await this.opening; } finally { this.opening = null; }
  }

  private async createOrReload(sceneId: string): Promise<SopWindowResult> {
    let tree: SopTree;
    try {
      tree = this.loadTree();
      validateSopTree(tree);
    } catch {
      return sopWindowFailure('SOP_FIXTURE_MISSING', '过敏流程样例不可用');
    }
    if (sceneId !== tree.sceneId) {
      return sopWindowFailure('INVALID', '当前切片不能切换流程');
    }
    this.tree = tree;
    this.progress = this.progress?.sceneId === sceneId ? this.progress : startSopProgress(tree);
    this.copied = false;
    const retryLoad = this.failCode === 'SOP_LOAD_FAILED';
    this.shellState = 'opening';
    this.failCode = null;
    this.failMessage = null;
    this.sessionId += 1;
    this.lastLayoutSequence = 0;
    this.lastResizeSequence = 0;

    const existing = this.liveWindow();
    if (existing) {
      existing.setBounds(this.windowPlacement(sopOpeningSize()));
      if (retryLoad) {
        try {
          const loaded = await loadRenderer(
            existing,
            'sop',
            this.rendererDevServerUrl?.(),
            () => this.disposed,
          );
          if (loaded !== 'loaded' || this.disposed || existing.isDestroyed()) {
            return this.failLoad(existing);
          }
        } catch {
          return this.failLoad(existing);
        }
      }
      this.pushProjection();
      this.armLayoutTimeout();
      this.revealExisting();
      return { ok: true };
    }

    const win = createOverlayChromeWindow(this.preloadPath, {
      width: SOP_WIDTH,
      height: SOP_OPEN_HEIGHT,
      title: '过敏售后流程 · Demo',
      backgroundThrottling: false,
    });
    lockRendererWindow(win);
    this.window = win;
    win.on('closed', () => {
      if (this.window === win) {
        this.window = null;
      }
    });
    win.setBounds(this.windowPlacement(sopOpeningSize()));
    try {
      const loaded = await loadRenderer(
        win,
        'sop',
        this.rendererDevServerUrl?.(),
        () => this.disposed,
      );
      if (loaded !== 'loaded' || this.disposed || win.isDestroyed()) {
        return this.failLoad(win);
      }
    } catch {
      return this.failLoad(win);
    }
    this.pushProjection();
    this.armLayoutTimeout();
    // First open must not steal Query IME. Re-open uses revealExisting().
    win.showInactive();
    return { ok: true };
  }

  private revealExisting(): void {
    const win = this.liveWindow();
    if (!win) {
      return;
    }
    this.firstContentPlacement = false;
    if (this.parkedFrom) {
      this.restoreBookmark(win, true);
      return;
    }
    if (this.manualSize) {
      const current = win.getBounds();
      win.setBounds(clampRectToWorkArea({ ...current, ...this.manualSize }, this.workArea(current)));
    } else if (!this.instance) {
      win.setBounds(this.windowPlacement({ width: SOP_WIDTH, height: win.getBounds().height }));
    }
    if (!win.isVisible()) {
      win.show();
    }
    win.moveTop();
    win.focus();
  }

  private fitBookmark(win: BrowserWindow, area: Rect, size?: Size): boolean {
    const previous = win.getBounds();
    for (let attempt = 0; attempt < 2; attempt++) {
      const slot = this.instance?.placeBookmark(area, size);
      if (!slot) break;
      win.setBounds(slot);
      const actual = win.getBounds();
      if (!sopLayoutNeedsProjection('ready', actual, slot)) return true;
      size = actual;
    }
    win.setBounds(previous);
    return false;
  }

  private restoreBookmark(win: BrowserWindow, focus: boolean): void {
    this.clearBookmark(win);
    if (!win.isVisible()) win.showInactive();
    if (focus) {
      win.moveTop();
      win.focus();
    }
  }

  private clearBookmark(win: BrowserWindow): void {
    if (!this.parkedFrom) return;
    const bounds = this.parkedFrom;
    this.parkedFrom = null;
    const area = this.workArea(win.getBounds());
    win.setBounds(clampRectToWorkArea(bounds, area));
    this.showChrome(win, { kind: 'expanded' });
  }

  private showChrome(win: BrowserWindow, chrome: SopWindowChrome): void {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC_CHANNELS.SOP_WINDOW_CHROME, chrome);
  }

  private windowPlacement(size: Size, workArea = this.workArea()): Rect {
    const query = this.queryBounds();
    const bounds = this.instance
      ? placeSopLeftCenter(workArea, size)
      : placeSopNearQuery(query, workArea, size);
    return this.instance ? this.instance.place(bounds, workArea, query) : bounds;
  }

  private armLayoutTimeout(): void {
    this.clearLayoutTimer();
    const sessionId = this.sessionId;
    this.layoutTimer = this.scheduler.schedule(() => {
      this.layoutTimer = null;
      if (this.disposed || sessionId !== this.sessionId || this.shellState === 'ready') {
        return;
      }
      this.shellState = 'failed';
      this.failCode = 'SOP_LAYOUT_TIMEOUT';
      this.failMessage = '过敏流程窗口未能贴合内容';
      this.pushProjection();
    }, SOP_LAYOUT_TIMEOUT_MS);
  }

  private clearLayoutTimer(): void {
    this.scheduler.clear(this.layoutTimer);
    this.layoutTimer = null;
  }

  private resetProgress(): void {
    if (this.tree) {
      this.progress = startSopProgress(this.tree);
    }
    this.copied = false;
  }

  private failLoad(win: BrowserWindow): SopWindowResult {
    this.shellState = 'failed';
    this.failCode = 'SOP_LOAD_FAILED';
    this.failMessage = SOP_OPEN_FAILURE_MESSAGE;
    if (!win.isDestroyed()) {
      win.setBounds(this.windowPlacement(sopOpeningSize()));
      win.showInactive();
    }
    return sopWindowFailure('SOP_LOAD_FAILED', SOP_OPEN_FAILURE_MESSAGE);
  }

  private liveWindow(): BrowserWindow | null {
    if (!this.window || this.window.isDestroyed() || this.disposed) {
      return null;
    }
    return this.window;
  }

  private loadTree(): SopTree {
    return this.tree ?? ALLERGY_SOP_TREE;
  }

  private pushProjection(): void {
    const win = this.liveWindow();
    if (win && this.queryRuntime && !win.webContents.isDestroyed()) {
      const projection = this.queryRuntime.projection();
      if (win.isDestroyed() || win.webContents.isDestroyed()) return;
      if (this.parkedFrom && (projection.projectionVersion !== 'sop-unified-v11' || !projection.instanceName)) {
        win.hide();
        this.clearBookmark(win);
      }
      if (this.instance && projection.state === 'ended' && !win.isVisible()) {
        win.destroy();
        return;
      }
      win.webContents.send(IPC_CHANNELS.SOP_WINDOW_PROJECTION, projection);
      return;
    }
    if (!win || !this.tree || !this.progress || win.webContents.isDestroyed()) {
      return;
    }
    const projection: SopProjection = projectSop({
      tree: this.tree,
      progress: this.progress,
      role: this.sessionRole(),
      published: this.publishedScriptIds(),
      shellState: this.shellState,
      copied: this.copied,
      failCode: this.failCode,
      failMessage: this.failMessage,
      sessionId: Math.max(1, this.sessionId),
    });
    win.webContents.send(IPC_CHANNELS.SOP_WINDOW_PROJECTION, projection);
  }
}
