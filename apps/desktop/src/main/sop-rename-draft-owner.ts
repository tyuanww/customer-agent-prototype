import type { SopDraft } from '../shared/sop-window';

/** Session-only step-title drafts. IPC owns authorization; no draft is persisted. */
export class SopRenameDraftOwner {
  private readonly drafts = new Map<string, SopDraft>();
  private nextDraftId = 0;

  current(taskId: string): SopDraft | null {
    const draft = this.drafts.get(taskId);
    return draft ? { ...draft } : null;
  }

  start(taskId: string, revision: number, initialName: string | null, defaultValue = initialName ?? ''): SopDraft {
    const existing = this.current(taskId);
    if (existing) return existing;
    const draft: SopDraft = { draftId: ++this.nextDraftId, revision, initialName, value: defaultValue, sequence: 0 };
    this.drafts.set(taskId, draft);
    return { ...draft };
  }

  update(taskId: string, draftId: number, sequence: number, value: string): boolean {
    const draft = this.drafts.get(taskId);
    if (!draft || draft.draftId !== draftId || sequence <= draft.sequence) return false;
    this.drafts.set(taskId, { ...draft, sequence, value });
    return true;
  }

  discard(taskId: string, draftId: number): boolean {
    if (this.drafts.get(taskId)?.draftId !== draftId) return false;
    this.drafts.delete(taskId);
    return true;
  }

  clear(taskId: string): void { this.drafts.delete(taskId); }
  clearAll(): void { this.drafts.clear(); }
}
