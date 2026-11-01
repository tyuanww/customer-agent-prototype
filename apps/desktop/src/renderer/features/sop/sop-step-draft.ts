import type { QuerySopWindowApi, SopDraft, SopDraftIdentity } from '@shared/sop-window';

type DraftApi = Pick<QuerySopWindowApi, 'draftCurrent' | 'draftStart' | 'draftUpdate' | 'draftDiscard'>;
type DraftWrite = { ok: boolean; sequence: number };

/** Main owns the draft; this instance only sequences requests for one execution host. */
export class SopStepDraft {
  private draft: SopDraft | null = null;
  private sequence = 0;
  private starting: Promise<SopDraft | null> | null = null;

  constructor(private readonly api: DraftApi, private readonly identity: SopDraftIdentity) {}

  available(): boolean {
    return !!this.api.draftCurrent && !!this.api.draftStart && !!this.api.draftUpdate && !!this.api.draftDiscard;
  }

  async current(): Promise<{ ok: true; draft: SopDraft | null } | { ok: false }> {
    if (!this.api.draftCurrent) return { ok: false };
    try {
      const result = await this.api.draftCurrent(this.identity);
      if (!result.ok) return result;
      this.draft = result.draft;
      this.sequence = result.draft?.sequence ?? 0;
      return result;
    } catch { return { ok: false }; }
  }

  async start(revision: number): Promise<SopDraft | null> {
    if (this.draft) return this.draft;
    if (this.starting) return this.starting;
    const start = this.api.draftStart;
    if (!start) return null;
    const pending = (async () => {
      try {
        const result = await start({ ...this.identity, revision });
        if (!result.ok || !result.draft) return null;
        this.draft = result.draft;
        this.sequence = Math.max(this.sequence, result.draft.sequence);
        return result.draft;
      } catch { return null; }
    })();
    this.starting = pending;
    try { return await pending; }
    finally { if (this.starting === pending) this.starting = null; }
  }

  async write(revision: number, value: string): Promise<DraftWrite> {
    const draft = await this.start(revision);
    const update = this.api.draftUpdate;
    if (!draft || !update) return { ok: false, sequence: this.sequence };
    const sequence = ++this.sequence;
    try { return { ok: await update({ ...this.identity, draftId: draft.draftId, sequence, value }), sequence }; }
    catch { return { ok: false, sequence }; }
  }

  latest(sequence: number): boolean { return sequence === this.sequence; }

  forget(): void { this.draft = null; }

  async discard(revision: number): Promise<boolean> {
    const draft = await this.start(revision);
    if (!draft || !this.api.draftDiscard) return false;
    try {
      const discarded = await this.api.draftDiscard({ ...this.identity, draftId: draft.draftId });
      if (discarded) this.draft = null;
      return discarded;
    } catch { return false; }
  }
}
