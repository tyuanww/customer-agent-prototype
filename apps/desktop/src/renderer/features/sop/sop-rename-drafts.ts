import { useSyncExternalStore } from 'react';

export type SopRenameDraft = {
  editId: number;
  revision: number;
  initialName: string | null;
  value: string;
  stage: 'editing' | 'saving';
  error: string;
};

/** A renderer-owned cache. Draft values never leave this window except in an explicit save. */
export class SopRenameDrafts {
  private readonly drafts = new Map<string, SopRenameDraft>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private nextEditId = 0;
  private activeTaskId: string | null = null;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly snapshot = () => this.version;

  get(taskId: string) { return this.drafts.get(taskId); }
  hasAny() { return this.drafts.size > 0; }
  active() { return this.activeTaskId; }
  activate(taskId: string | null) { this.activeTaskId = taskId; }

  start(taskId: string, draft: Omit<SopRenameDraft, 'editId'>) {
    const next = { ...draft, editId: ++this.nextEditId };
    this.drafts.set(taskId, next);
    this.notify();
    return next;
  }

  update(taskId: string, editId: number, update: (draft: SopRenameDraft) => SopRenameDraft | null) {
    const current = this.drafts.get(taskId);
    if (!current || current.editId !== editId) return;
    const next = update(current);
    if (next) this.drafts.set(taskId, next);
    else {
      this.drafts.delete(taskId);
      if (this.activeTaskId === taskId) this.activeTaskId = null;
    }
    this.notify();
  }

  delete(taskId: string) {
    if (this.drafts.delete(taskId)) {
      if (this.activeTaskId === taskId) this.activeTaskId = null;
      this.notify();
    }
  }

  retain(taskIds: ReadonlySet<string>) {
    let changed = false;
    for (const taskId of this.drafts.keys()) {
      if (!taskIds.has(taskId)) {
        this.drafts.delete(taskId);
        if (this.activeTaskId === taskId) this.activeTaskId = null;
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  private notify() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export function useSopRenameDrafts(drafts: SopRenameDrafts) {
  useSyncExternalStore(drafts.subscribe, drafts.snapshot, drafts.snapshot);
  return drafts;
}
