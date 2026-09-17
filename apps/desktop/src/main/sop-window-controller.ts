import { BrowserWindow, clipboard, type WebContents } from 'electron';
import { join } from 'node:path';
import { resolveClipboardWrite } from '../shared/clipboard-write';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { sanitizeDragDelta, type Rect } from '../shared/overlay-geometry';
import { ALLERGY_SOP_SCENE_ID } from '../shared/sop-entry';
import {
  SOP_COPY_FEEDBACK_MS,
  SOP_LAYOUT_TIMEOUT_MS,
  SOP_OPEN_HEIGHT,
  SOP_WIDTH,
  applySopDrag,
  applySopHeight,
  placeSopNearQuery,
  sopLayoutNeedsProjection,
  sopOpeningSize,
} from '../shared/sop-geometry';
import {
  advanceSopNext,
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
  type SopShellState,
  type SopWindowErrorCode,
  type SopWindowResult,
} from '../shared/sop-window';
import { GuardedScheduler } from './guarded-scheduler';
import { createOverlayChromeWindow } from './overlay-chrome-window';
import { loadRenderer } from './overlay-renderer-loader';
import { lockRendererWindow } from './window-security';

export type SopWindowControllerOptions = {
  preloadPath?: string;
  rendererDevServerUrl?: () => string | undefined;
  queryBounds: () => Rect | null;
  workArea: () => Rect;
  sessionRole: () => SopViewerRole;
  publishedScriptIds?: () => SopPublishSet;
  writeClipboard?: (text: string) => void;
};

export class SopWindowController {
  private window: BrowserWindow | null = null;
  private tree: SopTree | null = null;
  private progress: SopProgress | null = null;
  private shellState: SopShellState = 'opening';
  private failCode: SopWindowErrorCode | null = null;
  private failMessage: string | null = null;
  private copied = false;
  private opening: Promise<SopWindowResult> | null = null;
  private sessionId = 0;
  private lastLayoutSequence = 0;
  private disposed = false;
  private readonly scheduler = new GuardedScheduler();
  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly preloadPath: string;
  private readonly rendererDevServerUrl?: () => string | undefined;
  private readonly queryBounds: () => Rect | null;
  private readonly workArea: () => Rect;
  private readonly sessionRole: () => SopViewerRole;
  private readonly publishedScriptIds: () => SopPublishSet;
  private readonly writeClipboard: (text: string) => void;

  constructor(options: SopWindowControllerOptions) {
    this.preloadPath = options.preloadPath ?? join(__dirname, '../preload/sop.cjs');
    this.rendererDevServerUrl = options.rendererDevServerUrl;
    this.queryBounds = options.queryBounds;
    this.workArea = options.workArea;
    this.sessionRole = options.sessionRole;
    this.publishedScriptIds = options.publishedScriptIds ?? (() => 'fixture');
    this.writeClipboard = options.writeClipboard ?? ((text) => clipboard.writeText(text));
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

  entryAvailable(): boolean {
    try {
      const tree = this.loadTree();
      validateSopTree(tree);
      return true;
    } catch {
      return false;
    }
  }

  resumeAvailable(): boolean {
    return this.liveWindow() !== null && this.progress !== null;
  }

  async open(sceneId: string): Promise<SopWindowResult> {
    if (this.disposed) {
      return sopWindowFailure('UNAVAILABLE', SOP_OPEN_FAILURE_MESSAGE);
    }
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
    win.hide();
    win.webContents.setBackgroundThrottling(false);
  }

  endFlow(): void {
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
  }

  async restart(): Promise<SopWindowResult> {
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
    if (!win) {
      return;
    }
    const delta = sanitizeDragDelta(dx, dy);
    if (!delta) {
      return;
    }
    if (finished !== undefined && typeof finished !== 'boolean') {
      return;
    }
    win.setBounds(applySopDrag(win.getBounds(), delta.dx, delta.dy, this.workArea()));
  }

  reportLayout(request: SopLayoutRequest): SopLayoutAck {
    const win = this.liveWindow();
    if (!win || request.sessionId !== this.sessionId || request.sequence <= this.lastLayoutSequence) {
      return rejectedSopLayoutAck(request.sessionId, request.sequence, SOP_OPEN_HEIGHT);
    }
    this.lastLayoutSequence = request.sequence;
    this.clearLayoutTimer();
    const current = win.getBounds();
    const next = applySopHeight(current, request.desiredHeight, this.workArea());
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
    return {
      ok: true,
      sessionId: request.sessionId,
      sequence: request.sequence,
      height: next.height,
    };
  }

  copyCurrent(): SopCopyResult {
    if (!this.tree || !this.progress || this.shellState !== 'ready') {
      return { ok: false, message: '没有可复制的话术内容' };
    }
    const node = currentSopNode(this.tree, this.progress);
    if (node?.kind !== 'copyable') {
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

    const existing = this.liveWindow();
    if (existing) {
      this.placeWindow(existing, sopOpeningSize());
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
    this.placeWindow(win, sopOpeningSize());
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
    this.placeWindow(win, { width: SOP_WIDTH, height: win.getBounds().height });
    if (!win.isVisible()) {
      win.show();
    }
    win.moveTop();
    win.focus();
  }

  private placeWindow(win: BrowserWindow, size: { width: number; height: number }): void {
    win.setBounds(placeSopNearQuery(this.queryBounds(), this.workArea(), size));
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
      this.placeWindow(win, sopOpeningSize());
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
