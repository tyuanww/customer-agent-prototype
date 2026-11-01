import type { WebContents } from 'electron';
import { QUERY_OPEN_DURATION_MS } from '../shared/fox-motion';
import { resizeSopFrame, type QuerySopPresentation, type QuerySopWindowIntent } from '../shared/query-sop-window';
import type { Rect } from '../shared/overlay-geometry';
import { SOP_UNAVAILABLE, type QuerySopSnapshot, type SopFloatingSnapshot, type SopReadyRequest, type SopShowQueryReady, type SopShowQueryRequest } from '../shared/sop-window';
import type { OrdinaryQueryPresentation } from './overlay-controller';
import type { SopWindowController } from './sop-window-controller';
import { SopRenameDraftOwner } from './sop-rename-draft-owner';

export type SopHost = 'query' | 'floating';
export type SopNativeSlot = {
  getBounds(): Rect | null;
  getWorkArea(): Rect;
  prepare(): boolean;
  applyBounds(bounds: Rect): boolean;
  show(): boolean;
  restore(): boolean;
  hide(): boolean;
};
export type SopFloatingSurface = SopNativeSlot & { contents(): WebContents | null; destroy(): void };
type Assignment = { host: SopHost; taskId: string; epoch: number };
type Pending = { source: Assignment | null; host: SopHost; taskId: string; collapsed: boolean; mountId: number; finish: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };
type Gesture = { host: SopHost; epoch: number; taskId: string; id: number; edge: Extract<QuerySopWindowIntent, { type: 'resize-start' }>['edge']; base: Rect; area: Rect; sizeRevision: number };
type FloatingRecord = { taskId: string; surface: SopFloatingSurface | null; creation: Promise<SopFloatingSurface> | null; collapsed: boolean; hidden: boolean; expandedBounds: Rect | null;
  observed: { contents: WebContents; navigating: boolean; onNavigation: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void; onGone: () => void; onReady: () => void } | null };
type PendingShowQuery = { request: SopShowQueryRequest; source: Assignment; finish: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };
export type SopPresentationOptions = {
  domain: SopWindowController;
  query: SopNativeSlot & { failClosed(): boolean };
  queryContents(): WebContents | null;
  queryPresentation(): OrdinaryQueryPresentation;
  showOrdinaryQuery(): boolean;
  queryHome(): void;
  createFloating(onLost: () => void): Promise<SopFloatingSurface>;
};

/** One task has one executable host; independent floating tasks never share a lease. */
export class SopPresentationOwner {
  private readonly assignments = new Map<string, Assignment>();
  private readonly pending = new Map<string, Pending>();
  private readonly requests = new Map<string, number>();
  private readonly floating = new Map<string, FloatingRecord>();
  private readonly gestures = new Map<string, Gesture>();
  private readonly lastGestures = new Map<string, number>();
  private readonly drafts = new SopRenameDraftOwner();
  private epoch = 0;
  private mountId = 0;
  private sequence = 1;
  private lastFloatingTask: string | null = null;
  private preferredSize = { width: 580, height: 620 };
  private sizeRevision = 0;
  private queryHadSop = false;
  private queryParked = false;
  private queryNeedsSizeSync = false;
  private showQueryRequestId = 0;
  private pendingShowQuery: PendingShowQuery | null = null;
  private disposed = false;
  private transition: QuerySopPresentation['transition'] = null;
  private transitionFrame: Rect | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly options: SopPresentationOptions) {}

  private queryAssignment(): Assignment | null { return [...this.assignments.values()].find(item => item.host === 'query') ?? null; }
  selectedTask(): string | null { return this.queryAssignment()?.taskId ?? (this.lastFloatingTask && this.assignments.has(this.lastFloatingTask) ? this.lastFloatingTask : null); }
  isTaskExecutable(taskId: string): boolean { return !this.disposed && this.assignments.has(taskId) && !!this.options.domain.projection(taskId); }
  draftCurrent(taskId: string) { return this.drafts.current(taskId); }
  draftStart(taskId: string, revision: number) {
    const task = this.options.domain.summaries().find(item => item.taskId === taskId);
    if (!task || task.revision !== revision) return null;
    return this.drafts.start(taskId, task.revision, task.displayName, task.displayName ?? `${task.sceneTitle} #${task.ordinal}`);
  }
  draftUpdate(taskId: string, draftId: number, sequence: number, value: string): boolean { return this.drafts.update(taskId, draftId, sequence, value); }
  draftDiscard(taskId: string, draftId: number): boolean { return this.drafts.discard(taskId, draftId); }
  clearDraft(taskId: string): void { this.drafts.clear(taskId); }

  private slot(host: SopHost, taskId: string): SopNativeSlot | null { return host === 'query' ? this.options.query : this.floating.get(taskId)?.surface ?? null; }
  floatingTaskFor(contents: WebContents): string | null {
    for (const [taskId, record] of this.floating) {
      const candidate = record.surface?.contents();
      if (candidate === contents && !contents.isDestroyed() && !record.observed?.navigating) return taskId;
    }
    return null;
  }
  private observeFloating(record: FloatingRecord): WebContents | null {
    const candidate = record.surface?.contents() ?? null;
    const contents = candidate && !candidate.isDestroyed() ? candidate : null;
    if (contents === record.observed?.contents) return contents;
    const old = record.observed;
    if (old && !old.contents.isDestroyed()) {
      old.contents.removeListener('did-start-navigation', old.onNavigation);
      old.contents.removeListener('render-process-gone', old.onGone);
      old.contents.removeListener('dom-ready', old.onReady);
    }
    record.observed = null;
    if (!contents) return null;
    const clear = () => { if (record.observed?.contents === contents) record.observed.navigating = true; };
    const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) clear(); };
    const onGone = () => clear();
    const onReady = () => {
      if (record.observed?.contents !== contents || !record.observed.navigating) return;
      record.observed.navigating = false;
      this.publish();
    };
    record.observed = { contents, navigating: false, onNavigation, onGone, onReady };
    contents.on('did-start-navigation', onNavigation);
    contents.on('render-process-gone', onGone);
    contents.on('dom-ready', onReady);
    return contents;
  }
  canEditDraft(host: SopHost, taskId: string, epoch: number, floatingTaskId?: string): boolean {
    const active = this.assignments.get(taskId);
    return this.isTaskExecutable(taskId) && active?.host === host && active.epoch === epoch
      && (host !== 'floating' || floatingTaskId === taskId)
      && (host !== 'floating' || !this.floating.get(taskId)?.observed?.navigating);
  }
  canExecute(host: SopHost, taskId: string, epoch: number, floatingTaskId?: string): boolean {
    return this.canEditDraft(host, taskId, epoch, floatingTaskId)
      && (host !== 'query' || !this.queryParked)
      && (host !== 'floating' || !this.floating.get(taskId)?.hidden);
  }
  private pendingForHost(host: SopHost, taskId?: string): Pending | null {
    if (taskId) { const value = this.pending.get(taskId); return value?.host === host ? value : null; }
    return [...this.pending.values()].find(value => value.host === host) ?? null;
  }
  snapshot(host: SopHost, floatingTaskId?: string): QuerySopSnapshot {
    const tasks = this.options.domain.summaries();
    const ordinary = this.options.queryPresentation();
    const taskId = host === 'query' ? this.pendingForHost('query')?.taskId ?? this.queryAssignment()?.taskId ?? null
      : floatingTaskId ?? this.pendingForHost('floating')?.taskId ?? this.lastFloatingTask;
    const moving = taskId ? this.pending.get(taskId) : null;
    const pendingHere = moving?.host === host ? moving : null;
    const active = taskId ? this.assignments.get(taskId) : null;
    const assignedHere = active?.host === host ? active : null;
    const projection = this.options.domain.projection(taskId);
    const base = { kind: 'ready' as const, sequence: this.sequence, copyGeneration: this.options.domain.copyGeneration(), mode: host, viewEpoch: ordinary.viewEpoch,
      transition: host === 'query' ? this.transition ?? (!taskId ? ordinary.transition : null) : null,
      tasks: host === 'query' ? tasks : tasks.filter(task => task.taskId === taskId) };
    if (projection && pendingHere) return { ...base, view: { kind: 'sop', taskId: projection.taskId }, projection, access: { kind: 'preview', mountId: pendingHere.mountId } };
    if (projection && assignedHere) return { ...base, view: { kind: 'sop', taskId: projection.taskId }, projection, access: { kind: 'executable', hostEpoch: assignedHere.epoch } };
    return { ...base, tasks: host === 'query' ? tasks : [], view: host === 'query' ? ordinary.view : { kind: 'query-home' }, projection: null, access: { kind: 'none' } };
  }
  private floatingSnapshot(taskId: string): SopFloatingSnapshot {
    const snapshot = this.snapshot('floating', taskId);
    if (snapshot.kind !== 'ready') return snapshot;
    return { ...snapshot, seenActiveTaskIds: snapshot.projection ? [taskId] : [],
      collapsed: this.pendingForHost('floating', taskId)?.collapsed ?? this.floating.get(taskId)?.collapsed ?? false };
  }
  currentSnapshot(host: 'query'): QuerySopSnapshot;
  currentSnapshot(host: 'floating', taskId?: string): SopFloatingSnapshot;
  currentSnapshot(host: SopHost, taskId?: string): QuerySopSnapshot | SopFloatingSnapshot;
  currentSnapshot(host: SopHost, taskId?: string): QuerySopSnapshot | SopFloatingSnapshot {
    if (host === 'query') {
      const snapshot = this.snapshot('query');
      this.queryHadSop = snapshot.kind === 'ready' && snapshot.view.kind === 'sop';
      return snapshot;
    }
    const actualTask = taskId ?? this.lastFloatingTask;
    const record = actualTask ? this.floating.get(actualTask) : null;
    if (!record || !this.observeFloating(record) || record.observed?.navigating) return SOP_UNAVAILABLE;
    return this.floatingSnapshot(record.taskId);
  }
  publish(): void {
    if (this.disposed) return;
    this.sequence += 1;
    try {
      const query = this.options.queryContents();
      if (query && !query.isDestroyed()) {
        const snapshot = this.snapshot('query');
        query.send('sop-window:projection', snapshot);
        this.queryHadSop = snapshot.kind === 'ready' && snapshot.view.kind === 'sop';
      }
    } catch {
      console.warn('[sop-presentation] Query projection delivery failed');
      const pending = this.pendingForHost('query');
      if (pending) this.cancelPending(pending.taskId);
      const current = this.queryAssignment();
      if (current) this.release(current.taskId);
      if (this.queryHadSop || current || pending) {
        this.queryHadSop = false;
        try { if (!this.options.query.failClosed()) console.warn('[sop-presentation] Query fail-closed failed'); }
        catch { console.warn('[sop-presentation] Query fail-closed failed'); }
      }
    }
    for (const record of this.floating.values()) {
      try {
        const contents = this.observeFloating(record);
        if (contents && !record.observed?.navigating) contents.send('sop-floating:projection', this.floatingSnapshot(record.taskId));
      } catch {
        console.warn('[sop-presentation] Floating projection delivery failed');
        this.failClosedFloating(record);
      }
    }
  }
  private failClosedFloating(record: FloatingRecord): void {
    const { taskId, surface } = record;
    this.cancelShowQuery(taskId);
    this.cancelPending(taskId);
    if (this.assignments.get(taskId)?.host === 'floating') {
      this.assignments.delete(taskId);
      this.gestures.delete(taskId); this.lastGestures.delete(taskId); this.epoch += 1;
    }
    if (surface) {
      try { surface.hide(); } catch { /* The native destroy is the fallback for a failed hide. */ }
      try { surface.destroy(); } catch { console.warn('[sop-presentation] Floating destroy failed'); }
    }
    record.surface = null; record.creation = null; record.hidden = true;
    this.observeFloating(record);
  }
  async showTask(taskId: string): Promise<boolean> {
    if (this.disposed || !this.options.domain.projection(taskId)) return false;
    const assignment = this.assignments.get(taskId);
    if (assignment?.host === 'floating') {
      const record = this.floating.get(taskId);
      if (!record) return false;
      if (record.collapsed && !this.setCollapsed(record, false)) return false;
      this.lastFloatingTask = taskId;
      const shown = record.surface?.show() ?? false;
      if (shown) record.hidden = false;
      return shown;
    }
    if (assignment?.host === 'query') return this.options.query.show();
    const record = this.floating.get(taskId);
    return this.move(taskId, record?.hidden ? 'floating' : 'query');
  }
  private cancelPending(taskId: string): void {
    this.requests.delete(taskId);
    const pending = this.pending.get(taskId);
    if (!pending) return;
    this.pending.delete(taskId);
    clearTimeout(pending.timer);
    try {
      if (pending.host !== pending.source?.host) {
        if (pending.host === 'query') this.options.query.restore(); else this.floating.get(taskId)?.surface?.hide();
      }
    } catch { /* The source keeps its lease and the caller receives failure. */ }
    pending.finish(false);
  }
  private preferredFrame(slot: SopNativeSlot): Rect | null {
    const bounds = slot.getBounds();
    if (!bounds) return null;
    const area = slot.getWorkArea();
    const width = Math.min(this.preferredSize.width, area.width), height = Math.min(this.preferredSize.height, area.height);
    return { x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)), width, height };
  }
  private initialFloatingFrame(taskId: string, surface: SopFloatingSurface): Rect {
    const area = this.assignments.get(taskId)?.host === 'query' ? this.options.query.getWorkArea() : surface.getWorkArea();
    const query = this.options.query.getBounds();
    const width = Math.min(this.preferredSize.width, area.width), height = Math.min(this.preferredSize.height, area.height);
    const occupied = [query, ...[...this.floating.values()].filter(record => record.taskId !== taskId && !record.hidden)
      .map(record => record.surface?.getBounds() ?? null)].filter((bounds): bounds is Rect => bounds !== null);
    const clampX = (x: number) => Math.max(area.x, Math.min(x, area.x + area.width - width));
    const clampY = (y: number) => Math.max(area.y, Math.min(y, area.y + area.height - height));
    const xs = [query ? query.x + query.width + 12 : area.x, ...occupied.flatMap(bounds => [bounds.x + bounds.width + 12, bounds.x - width - 12]), area.x, area.x + area.width - width].map(clampX);
    const ys = [query?.y ?? area.y, ...occupied.flatMap(bounds => [bounds.y + bounds.height + 12, bounds.y - height - 12]), area.y, area.y + area.height - height].map(clampY);
    let best = { x: xs[0], y: ys[0], width, height }, bestOverlap = Number.POSITIVE_INFINITY;
    for (const x of xs) for (const y of ys) {
      const overlap = occupied.reduce((sum, bounds) => sum + Math.max(0, Math.min(x + width, bounds.x + bounds.width) - Math.max(x, bounds.x))
        * Math.max(0, Math.min(y + height, bounds.y + bounds.height) - Math.max(y, bounds.y)), 0);
      if (overlap < bestOverlap) { best = { x, y, width, height }; bestOverlap = overlap; }
      if (bestOverlap === 0) return best;
    }
    return best;
  }
  private async ensureFloating(taskId: string): Promise<SopFloatingSurface> {
    let record = this.floating.get(taskId);
    if (!record) {
      record = { taskId, surface: null, creation: null, observed: null, collapsed: false, hidden: false, expandedBounds: null };
      this.floating.set(taskId, record);
    }
    if (record.surface) return record.surface;
    const owner = record;
    owner.creation ??= this.options.createFloating(() => this.floatingLost(taskId)).then(surface => {
      if (this.disposed || this.floating.get(taskId) !== owner || !this.options.domain.projection(taskId)) {
        surface.destroy();
        throw new Error('SOP task unavailable');
      }
      owner.surface = surface;
      surface.applyBounds(this.initialFloatingFrame(taskId, surface));
      this.observeFloating(owner);
      return surface;
    }).catch(error => { owner.creation = null; throw error; });
    return owner.creation;
  }
  private releaseQueryFor(taskId: string): void {
    const current = this.queryAssignment();
    if (!current || current.taskId === taskId) return;
    this.cancelShowQuery(current.taskId);
    this.cancelPending(current.taskId);
    this.assignments.delete(current.taskId);
    this.gestures.delete(current.taskId);
    this.lastGestures.delete(current.taskId);
    this.epoch += 1;
    this.options.query.restore();
  }
  private async move(taskId: string, host: SopHost, collapsed = false): Promise<boolean> {
    this.finishTransition();
    this.cancelPending(taskId);
    const source = this.assignments.get(taskId) ?? null;
    if (host === 'query') {
      const current = this.queryAssignment();
      if (source?.host === 'floating' && current && current.taskId !== taskId) return false;
      const previous = this.pendingForHost('query');
      if (previous) this.cancelPending(previous.taskId);
      this.releaseQueryFor(taskId);
    }
    const request = ++this.mountId;
    this.requests.set(taskId, request);
    if (host === 'floating') {
      try { await this.ensureFloating(taskId); } catch { return false; }
    }
    if (this.disposed || this.requests.get(taskId) !== request || !this.options.domain.projection(taskId)
      || (source && this.assignments.get(taskId) !== source)) return false;
    const target = this.slot(host, taskId);
    if (!target?.prepare()) return false;
    if (host === 'floating') this.lastFloatingTask = taskId;
    return new Promise<boolean>(finish => {
      const timer = setTimeout(() => {
        if (this.pending.get(taskId)?.mountId !== request) return;
        this.cancelPending(taskId);
        this.publish();
      }, 5000);
      this.pending.set(taskId, { source, host, taskId, collapsed, mountId: request, finish, timer });
      this.publish();
    });
  }
  ready(host: SopHost, request: SopReadyRequest, floatingTaskId?: string): boolean {
    const pending = this.pendingForHost(host, host === 'floating' ? floatingTaskId : undefined);
    if (this.disposed || !pending || pending.mountId !== request.mountId || !this.options.domain.projection(pending.taskId)) return false;
    clearTimeout(pending.timer);
    this.pending.delete(pending.taskId);
    this.requests.delete(pending.taskId);
    const { taskId, source } = pending;
    const target = this.slot(host, taskId);
    const sourceSlot = source ? this.slot(source.host, taskId) : null;
    const sourceBounds = sourceSlot?.getBounds() ?? null;
    this.gestures.delete(taskId); this.lastGestures.delete(taskId);
    const next = { host, taskId, epoch: ++this.epoch };
    this.assignments.set(taskId, next);
    let applied = false;
    try {
      const bounds = target?.getBounds();
      const expandedFrame = target ? this.preferredFrame(target) : null;
      const frame = pending.collapsed && target ? this.bookmarkFrame(taskId, sourceSlot?.getWorkArea() ?? target.getWorkArea()) : expandedFrame;
      if (pending.collapsed && !frame) throw new Error('No bookmark space');
      if (target && bounds && frame) {
        if (host === 'query' && (bounds.width !== frame.width || bounds.height !== frame.height)) {
          this.transition = { stage: 'animating', from: { width: bounds.width, height: bounds.height }, to: { width: frame.width, height: frame.height } };
          this.transitionFrame = frame;
          this.transitionTimer = setTimeout(() => this.finishTransition(), QUERY_OPEN_DURATION_MS * 2);
          applied = target.applyBounds({ ...frame, width: Math.max(bounds.width, frame.width), height: Math.max(bounds.height, frame.height) }) && target.show();
        } else applied = target.applyBounds(frame) && target.show();
      }
      if (!applied) throw new Error('SOP native placement failed');
      if (source && source.host !== host) {
        const released = host === 'floating' ? this.options.query.restore() && this.options.query.hide() : sourceSlot?.hide();
        if (!released) throw new Error('SOP source release failed');
      }
      const record = this.floating.get(taskId);
      if (host === 'floating' && record) { record.expandedBounds = pending.collapsed ? sourceBounds ?? expandedFrame : expandedFrame; record.collapsed = pending.collapsed; record.hidden = false; this.lastFloatingTask = taskId; }
    } catch {
      this.assignments.delete(taskId);
      let restored = false;
      try { restored = !!source && !!sourceSlot && !!sourceBounds && sourceSlot.prepare() && sourceSlot.applyBounds(sourceBounds) && sourceSlot.show(); }
      catch { restored = false; }
      if (restored && source) this.assignments.set(taskId, { ...source, epoch: ++this.epoch });
      this.clearTransition();
      try { if (host === 'query' && source?.host !== 'query') this.options.query.restore(); else if (host === 'floating' && source?.host !== 'floating') target?.hide(); }
      catch { /* No target receives an execution lease after a failed placement. */ }
      this.publish(); pending.finish(false); return false;
    }
    this.publish(); pending.finish(true); return true;
  }
  finishTransition(): boolean {
    if (!this.transition) return false;
    const frame = this.transitionFrame;
    this.clearTransition();
    if (frame) this.options.query.applyBounds(frame);
    this.publish(); return true;
  }
  private clearTransition(): void {
    if (this.transitionTimer) clearTimeout(this.transitionTimer);
    this.transitionTimer = null; this.transition = null; this.transitionFrame = null;
  }
  /** Reserve a visible left-edge cell; never cover another customer's bookmark. */
  private bookmarkFrame(taskId: string, area: Rect): Rect | null {
    const width = Math.min(40, area.width), height = Math.min(96, area.height);
    const occupied = [...this.floating.values()].filter(record => record.taskId !== taskId && record.collapsed && !record.hidden)
      .map(record => record.surface?.getBounds()).filter((bounds): bounds is Rect => !!bounds);
    const x = area.x;
    for (let y = area.y; y + height <= area.y + area.height; y += height + 8) {
      if (occupied.every(bounds => x + width <= bounds.x || bounds.x + bounds.width <= x
        || y + height <= bounds.y || bounds.y + bounds.height <= y)) return { x, y, width, height };
    }
    return null;
  }
  private setCollapsed(record: FloatingRecord, collapsed: boolean): boolean {
    const slot = record.surface;
    if (!slot) return false;
    if (record.collapsed === collapsed) return true;
    if (collapsed && !this.cancelResize(record.taskId)) return false;
    const bounds = slot.getBounds();
    if (!bounds) return false;
    const area = slot.getWorkArea();
    const width = Math.min(this.preferredSize.width, area.width);
    const height = Math.min(this.preferredSize.height, area.height);
    const origin = record.expandedBounds ?? bounds;
    const frame = collapsed ? this.bookmarkFrame(record.taskId, area) : {
      x: Math.max(area.x, Math.min(origin.x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(origin.y, area.y + area.height - height)), width, height,
    };
    if (!frame || !slot.applyBounds(frame)) return false;
    if (collapsed) record.expandedBounds = bounds;
    record.collapsed = collapsed;
    this.publish();
    return true;
  }
  private syncPreferredSize(exceptTask: string): void {
    for (const assignment of this.assignments.values()) {
      if (assignment.taskId === exceptTask || this.gestures.has(assignment.taskId)) continue;
      if (assignment.host === 'query' && this.queryParked) { this.queryNeedsSizeSync = true; continue; }
      if (assignment.host === 'floating' && this.floating.get(assignment.taskId)?.collapsed) continue;
      const slot = this.slot(assignment.host, assignment.taskId);
      const frame = slot && this.preferredFrame(slot);
      if (slot && frame) slot.applyBounds(frame);
    }
  }
  private cancelResize(taskId: string): boolean {
    const gesture = this.gestures.get(taskId);
    if (!gesture) return true;
    this.gestures.delete(taskId);
    const slot = this.slot(gesture.host, taskId);
    if (!slot || !slot.applyBounds(gesture.base)) return false;
    const frame = gesture.sizeRevision !== this.sizeRevision ? this.preferredFrame(slot) : null;
    return frame ? slot.applyBounds(frame) : true;
  }
  private cancelShowQuery(taskId?: string): void {
    const pending = this.pendingShowQuery;
    if (!pending || (taskId && pending.source.taskId !== taskId && pending.request.taskId !== taskId)) return;
    this.pendingShowQuery = null;
    clearTimeout(pending.timer);
    pending.finish(false);
  }
  private requestOrdinaryQuery(taskId: string, epoch: number): Promise<boolean> | boolean {
    if (this.pendingShowQuery || this.pendingForHost('query')) return false;
    const query = this.options.queryContents();
    if (!query || query.isDestroyed()) return false;
    const current = this.queryAssignment();
    if (!current) {
      try { return this.options.showOrdinaryQuery(); } catch { return false; }
    }
    const source = this.assignments.get(taskId);
    if (!source || source.host !== 'floating' || source.epoch !== epoch) return false;
    const request: SopShowQueryRequest = { requestId: ++this.showQueryRequestId, taskId: current.taskId, hostEpoch: current.epoch };
    return new Promise<boolean>(finish => {
      const timer = setTimeout(() => this.cancelShowQuery(), 5000);
      this.pendingShowQuery = { request, source, finish, timer };
      try { query.send('sop-window:show-query-request', request); }
      catch { this.cancelShowQuery(); }
    });
  }
  showQueryReady(ready: SopShowQueryReady): boolean {
    const pending = this.pendingShowQuery;
    if (!pending || ready.requestId !== pending.request.requestId || ready.taskId !== pending.request.taskId
      || ready.hostEpoch !== pending.request.hostEpoch) return false;
    this.pendingShowQuery = null;
    clearTimeout(pending.timer);
    const current = this.queryAssignment();
    if (!ready.accepted || !current || current.taskId !== ready.taskId || current.epoch !== ready.hostEpoch
      || !this.canExecute('floating', pending.source.taskId, pending.source.epoch, pending.source.taskId)) {
      pending.finish(false);
      return false;
    }
    const previousBounds = this.options.query.getBounds();
    const wasParked = this.queryParked;
    try {
      if (!this.options.query.restore() || !this.options.showOrdinaryQuery() || this.queryAssignment() !== current) throw new Error('Query presentation failed');
      this.release(current.taskId);
      this.queryParked = false;
      this.publish();
      pending.finish(true);
      return true;
    } catch {
      if (this.queryAssignment() === current) {
        let restored = false;
        try {
          restored = this.options.query.prepare() && !!previousBounds && this.options.query.applyBounds(previousBounds)
            && (wasParked || this.options.query.show());
        } catch { restored = false; }
        if (!restored) {
          try { if (!this.options.query.failClosed()) console.warn('[sop-presentation] Query fail-closed failed'); }
          catch { console.warn('[sop-presentation] Query fail-closed failed'); }
          this.release(current.taskId);
        }
      }
      pending.finish(false);
      return false;
    }
  }
  async windowIntent(host: SopHost, intent: QuerySopWindowIntent, floatingTaskId?: string): Promise<boolean> {
    if (!this.canExecute(host, intent.taskId, intent.hostEpoch, floatingTaskId)) return false;
    if (intent.type === 'detach') return host === 'query' && this.move(intent.taskId, 'floating');
    if (intent.type === 'attach') return host === 'floating' && this.move(intent.taskId, 'query');
    if (intent.type === 'show-query') return host === 'floating' && this.requestOrdinaryQuery(intent.taskId, intent.hostEpoch);
    if (intent.type === 'hide') {
      if (host === 'query') return this.move(intent.taskId, 'floating', true);
      const record = this.floating.get(intent.taskId);
      return record ? this.setCollapsed(record, true) : false;
    }
    if (intent.type === 'expand') {
      const record = host === 'floating' ? this.floating.get(intent.taskId) : null;
      return record ? this.setCollapsed(record, false) : false;
    }
    const slot = this.slot(host, intent.taskId);
    if (!slot || (host === 'floating' && this.floating.get(intent.taskId)?.collapsed)) return false;
    if (intent.type === 'resize-start') {
      this.finishTransition();
      const base = slot.getBounds();
      if (!base || intent.gesture <= (this.lastGestures.get(intent.taskId) ?? 0)) return false;
      this.lastGestures.set(intent.taskId, intent.gesture);
      this.gestures.set(intent.taskId, { host, epoch: intent.hostEpoch, taskId: intent.taskId, id: intent.gesture, edge: intent.edge, base, area: slot.getWorkArea(), sizeRevision: this.sizeRevision });
      return true;
    }
    const gesture = this.gestures.get(intent.taskId);
    if (!gesture || gesture.id !== intent.gesture || gesture.host !== host || gesture.epoch !== intent.hostEpoch) return false;
    if (intent.type === 'resize-cancel') {
      return this.cancelResize(intent.taskId);
    }
    if (intent.type === 'resize-end') {
      this.gestures.delete(intent.taskId);
      const bounds = slot.getBounds();
      if (bounds) {
        if (bounds.width === gesture.base.width && bounds.height === gesture.base.height && gesture.sizeRevision !== this.sizeRevision) {
          const frame = this.preferredFrame(slot);
          return frame ? slot.applyBounds(frame) : false;
        }
        const area = slot.getWorkArea();
        this.preferredSize = {
          width: bounds.width >= area.width && this.preferredSize.width > area.width ? this.preferredSize.width : bounds.width,
          height: bounds.height >= area.height && this.preferredSize.height > area.height ? this.preferredSize.height : bounds.height,
        };
        this.sizeRevision += 1; this.syncPreferredSize(intent.taskId);
      }
      return bounds !== null;
    }
    return slot.applyBounds(resizeSopFrame(gesture.base, gesture.edge, intent.dx, intent.dy, gesture.area));
  }
  private release(taskId: string): void {
    this.cancelShowQuery(taskId);
    this.cancelPending(taskId);
    if (this.assignments.get(taskId)?.host === 'query') { this.queryParked = false; this.queryNeedsSizeSync = false; }
    this.assignments.delete(taskId);
    this.gestures.delete(taskId); this.lastGestures.delete(taskId); this.epoch += 1;
  }
  hide(host: SopHost, taskId?: string): void {
    this.finishTransition();
    const actual = host === 'query' ? this.queryAssignment()?.taskId ?? this.pendingForHost('query')?.taskId
      : taskId ?? this.lastFloatingTask;
    if (!actual) return;
    const pending = this.pending.get(actual);
    if (pending?.host === host && pending.source?.host !== host) {
      this.cancelPending(actual);
      this.publish();
      return;
    }
    this.release(actual);
    if (host === 'query') { this.options.query.restore(); this.options.query.hide(); }
    else { const record = this.floating.get(actual); if (record) { record.hidden = true; record.surface?.hide(); } }
    this.publish();
  }
  queryDismissed(): void {
    this.clearTransition();
    const pending = this.pendingForHost('query');
    if (pending) this.cancelPending(pending.taskId);
    const current = this.queryAssignment();
    if (current) {
      this.queryParked = true;
      this.cancelShowQuery(current.taskId);
      if (this.gestures.delete(current.taskId)) this.queryNeedsSizeSync = true;
      this.cancelPending(current.taskId);
    }
    this.publish();
  }
  queryShown(): void {
    if (!this.queryParked) return;
    if (this.queryNeedsSizeSync && this.queryAssignment()) {
      const frame = this.preferredFrame(this.options.query);
      if (!frame || !this.options.query.applyBounds(frame)) {
        try { if (!this.options.query.failClosed()) console.warn('[sop-presentation] Query fail-closed failed'); }
        catch { console.warn('[sop-presentation] Query fail-closed failed'); }
        return;
      }
    }
    this.queryNeedsSizeSync = false;
    this.queryParked = false;
    this.publish();
  }
  showQuery(): void {
    this.finishTransition();
    const current = this.queryAssignment();
    if (current) { this.release(current.taskId); this.options.query.restore(); this.publish(); }
  }
  removeTask(taskId: string): void {
    this.clearDraft(taskId);
    const current = this.assignments.get(taskId);
    this.release(taskId);
    const record = this.floating.get(taskId);
    this.floating.delete(taskId);
    if (record?.surface) {
      let hidden = false;
      try { hidden = record.surface.hide(); } catch { hidden = false; }
      if (!hidden) {
        try { record.surface.contents()?.send('sop-floating:projection', SOP_UNAVAILABLE); }
        catch { /* Destroy below is the final fallback when the renderer cannot be cleared. */ }
      }
      try { record.surface.destroy(); }
      catch { console.warn('[sop-presentation] Floating destroy failed after task end'); }
    }
    if (current?.host === 'query') {
      this.clearTransition();
      try { if (!this.options.query.restore()) console.warn('[sop-presentation] Query restore failed after task end'); }
      catch { console.warn('[sop-presentation] Query restore failed after task end'); }
      try { this.options.queryHome(); }
      catch { console.warn('[sop-presentation] Query home failed after task end'); }
    }
    this.publish();
  }
  private floatingLost(taskId: string): void {
    const record = this.floating.get(taskId);
    if (!record) return;
    this.cancelShowQuery(taskId);
    try { if (!this.cancelResize(taskId)) console.warn('[sop-presentation] Floating resize cancel failed'); }
    catch { console.warn('[sop-presentation] Floating resize cancel failed'); }
    record.hidden = true;
    if (record.surface?.contents()) {
      this.cancelPending(taskId);
    } else {
      this.release(taskId);
      record.surface = null; record.creation = null;
      this.observeFloating(record);
    }
    this.publish();
  }
  destroy(): void {
    this.clearTransition();
    this.disposed = true;
    this.cancelShowQuery();
    for (const taskId of this.pending.keys()) this.cancelPending(taskId);
    this.assignments.clear(); this.drafts.clearAll();
    for (const record of this.floating.values()) {
      record.surface?.destroy();
      void record.creation?.then(surface => surface.destroy()).catch(() => {});
    }
    this.floating.clear();
  }
}
