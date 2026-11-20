import { screen, type WebContents } from 'electron';
import { placeSopBesideWindows, placeSopBookmark } from '../shared/sop-geometry';
import { sopWindowFailure, type SopWindowResult } from '../shared/sop-window';
import type { OpenSopCandidate } from './sop-candidate-search';
import type { SopWindowController, SopWindowControllerOptions } from './sop-window-controller';
import type { SopCandidateOpening } from './sop-unified-runtime';
import type { SopUnifiedSession } from './sop-unified-port';

type CreateWindow = (instance: NonNullable<SopWindowControllerOptions['instance']>, candidate?: SopCandidateOpening) => SopWindowController;

export class SopInstanceWindows {
  private readonly windows = new Map<SopWindowController, () => void>();
  private readonly resumeListeners = new Set<() => void>();
  private readonly unsubscribeLogout: () => void;
  private draft: SopWindowController | null = null;

  constructor(private readonly session: Pick<SopUnifiedSession, 'view' | 'onExplicitLogout'>,
    private readonly createWindow: CreateWindow) {
    this.unsubscribeLogout = session.onExplicitLogout(() => this.clear());
    screen.on('display-removed', this.reconcileBookmarks);
    screen.on('display-metrics-changed', this.reconcileBookmarks);
  }

  async open(sceneId: string): Promise<SopWindowResult> {
    if (sceneId !== 'sop-query') return sopWindowFailure('INVALID', '请选择流程');
    if (this.draft && !this.draft.hasInstance()) return this.draft.open(sceneId);
    const window = this.registerWindow();
    this.draft = window;
    return window.open(sceneId);
  }

  async openCandidate(candidate: SopCandidateOpening): ReturnType<OpenSopCandidate> {
    const window = this.registerWindow(candidate);
    const result = await window.open('sop-query');
    if (result.ok && window.hasInstance()) return 'opened';
    this.remove(window);
    return result.ok ? 'unavailable' : 'retry';
  }

  private registerWindow(candidate?: SopCandidateOpening) {
    const window = this.createWindow({
      place: (bounds, workArea, query) => placeSopBesideWindows(bounds,
        [...this.windows.keys()].flatMap(other => {
          const current = other === window ? null : other.bounds();
          return current ? [current] : [];
        }), query, workArea),
      placeBookmark: (workArea, size) => placeSopBookmark(workArea, [...this.windows.keys()].flatMap(other => {
        const current = other === window ? null : other.bounds(true);
        return current ? [current] : [];
      }), size),
      onClosed: () => this.remove(window),
      onProjectionChanged: this.notifyResumeEntries,
    }, candidate);
    this.windows.set(window, () => {
      if (this.windows.has(window)) window.resumeInstance();
    });
    return window;
  }

  fromContents(contents: WebContents): SopWindowController | null {
    for (const window of this.windows.keys()) {
      if (window.isSopContents(contents)) return window;
    }
    return null;
  }

  entryAvailable(): boolean {
    return true;
  }

  resumeAvailable(): boolean {
    return [...this.windows.keys()].some(window => window.instanceMenuLabel() !== null);
  }

  resumeEntries(): { label: string; resume: () => void }[] {
    if (!this.session.view().signedIn) return [];
    return [...this.windows].flatMap(([window, resume]) => {
      const label = window.instanceMenuLabel();
      return label ? [{ label, resume }] : [];
    });
  }

  subscribeResumeEntries(listener: () => void): () => void {
    this.resumeListeners.add(listener);
    return () => { this.resumeListeners.delete(listener); };
  }

  hide(): void {
    for (const window of this.windows.keys()) window.hideRememberingProgress();
  }

  destroy(): void {
    screen.removeListener('display-removed', this.reconcileBookmarks);
    screen.removeListener('display-metrics-changed', this.reconcileBookmarks);
    this.unsubscribeLogout();
    this.clear();
    this.resumeListeners.clear();
  }

  private readonly reconcileBookmarks = (): void => {
    for (const window of this.windows.keys()) window.reconcileBookmark();
  };

  private readonly notifyResumeEntries = (): void => {
    for (const listener of this.resumeListeners) listener();
  };

  private remove(window: SopWindowController): void {
    if (!this.windows.delete(window)) return;
    if (this.draft === window) this.draft = null;
    this.notifyResumeEntries();
    window.destroy();
  }

  private clear(): void {
    for (const window of this.windows.keys()) this.remove(window);
  }
}
