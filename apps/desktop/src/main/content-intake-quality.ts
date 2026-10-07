import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';

type C = components['schemas'];
type Key = C['IntakeCandidateKey'];
type Phase = C['IntakeQualitySubmission']['phase'];
type Receipt = C['IntakeQualityReceipt'];
type Pending = { action: Receipt['action']; body: C['IntakeQualityCommand'] | C['IntakeQualitySubmission'] };
export type IntakeQualityView = { status: C['IntakeQualityStatus']; phase: Phase; samples: C['IntakeQualitySample'][] };
const PAGE_BYTES = 8 * 1024 * 1024;
const TOTAL_BYTES = 32 * 1024 * 1024;
const sameKey = (a: Key, b: Key) => a.candidateId === b.candidateId && a.version === b.version && a.digest === b.digest;
const reject = (code: 'VALIDATION' | 'STALE' | 'CONFLICT', reason?: string): never => { throw new ProductHttpError(code, reason); };

/** Main owns the selected immutable key, complete sample view, human draft and
 * original mutation body. No automatic pass, sampler or identity comes from UI.
 * A receipt is historical: only refresh() obtains a current view. Unknown writes
 * block a new write/selection until recover() or retry() resolves the original ID.
 * All state is memory-only and cleared on logout/relogin/disposal; callers must
 * surface unresolved operations before closing. This port grants no UI authority.
 */
export class ContentIntakeQuality {
  private key: Key | null = null;
  private loaded: IntakeQualityView | null = null;
  private draft = new Map<string, C['IntakeQualityCheck']>();
  private pending: Pending | null = null;
  private active: AbortController | null = null;
  private disposed = false;
  private epoch: number;
  private readonly unsubscribe: () => void;
  constructor(private readonly session: Pick<ProductSession, 'view' | 'subscribe' | 'request'>) {
    this.epoch = session.view().sessionEpoch;
    this.unsubscribe = session.subscribe(() => {
      const view = session.view();
      if (!view.signedIn || view.sessionEpoch !== this.epoch) {
        this.epoch = view.sessionEpoch; this.reset();
      }
    });
  }
  private reset() {
    this.active?.abort(); this.active = null; this.key = null; this.pending = null; this.clearView();
  }
  private clearView() { this.loaded = null; this.draft.clear(); }
  private assertSession() {
    if (this.disposed) return reject('STALE');
    const view = this.session.view();
    if (!view.signedIn) throw new ProductHttpError('UNAUTHORIZED');
    if (view.sessionEpoch !== this.epoch) { this.reset(); this.epoch = view.sessionEpoch; return reject('STALE'); }
  }
  /** Only a Main-owned candidate response may supply this key. */
  select(raw: unknown) {
    this.assertSession();
    if (this.pending || this.active) return reject('CONFLICT');
    const key = parseContractSchema('IntakeCandidateKey', raw);
    this.key = structuredClone(key); this.clearView();
  }
  current(): IntakeQualityView | null { this.assertSession(); return structuredClone(this.loaded); }
  unresolved(): { operationId: string; action: Receipt['action'] } | null {
    this.assertSession();
    return this.pending ? { operationId: this.pending.body.operationId, action: this.pending.action } : null;
  }
  private address(key: Key) { return `/v1/intake/candidates/${encodeURIComponent(key.candidateId)}/versions/${key.version}/quality`; }
  private async run<T>(work: (request: (path: string, body?: unknown, budget?: number) => Promise<unknown>, key: Key, assertActive: () => void) => Promise<T>, keepCorrectableDraft = false) {
    this.assertSession();
    if (this.active) return reject('CONFLICT');
    if (!this.key) return reject('STALE');
    const key = this.key, epoch = this.epoch, controller = new AbortController();
    this.active = controller;
    const assertActive = () => {
      this.assertSession();
      if (controller.signal.aborted || this.active !== controller || this.epoch !== epoch || this.key !== key) return reject('STALE');
    };
    try {
      const value = await work(async (path, body, budget = 65_536) => {
        assertActive();
        const result = await this.session.request(epoch, path, { ...(body !== undefined ? { body } : {}),
          signal: controller.signal, maxResponseBytes: budget });
        assertActive(); return result.value;
      }, key, assertActive);
      assertActive(); return value;
    } catch (error) {
      // A first, definitive input rejection did not commit. Keep the human work
      // so an oversized reason can be shortened; the next POST reauthorizes it.
      // Unknown writes and authority/material failures never keep an editable view.
      if (this.active === controller && !(keepCorrectableDraft && error instanceof ProductHttpError && error.code === 'VALIDATION')) this.clearView();
      if (controller.signal.aborted || this.active !== controller) return reject('STALE');
      if (error instanceof ProductHttpError) throw error;
      throw new ProductHttpError('UNAVAILABLE');
    } finally { if (this.active === controller) this.active = null; }
  }
  /** Reauthorize, assemble bounded whole pages, then recheck the view. Nothing is
   * exposed on partial, duplicate, cross-key/phase/manifest or changing reads. */
  async refresh(phase: Phase): Promise<IntakeQualityView> {
    if (phase !== 'initial' && phase !== 'expanded') return reject('VALIDATION');
    return this.run(async (request, key, assertActive) => {
      this.clearView();
      const url = this.address(key), query = new URLSearchParams({ digest: key.digest });
      const readStatus = async () => {
        const status = parseContractSchema('IntakeQualityStatus', await request(`${url}?${query}`));
        if (!sameKey(status.key, key)) return reject('STALE');
        return status;
      };
      const status = await readStatus();
      const samples: C['IntakeQualitySample'][] = [], ids = new Set<string>(), cursors = new Set<string>();
      let cursor: string | null = null, bytes = 0, pages = 0;
      do {
        if (++pages > 500 || bytes >= TOTAL_BYTES) return reject('VALIDATION', 'FILE_LIMIT');
        const q: URLSearchParams = new URLSearchParams({ digest: key.digest, viewHash: status.viewHash, phase, limit: '100', ...(cursor ? { cursor } : {}) });
        const page = parseContractSchema('IntakeQualitySamplePage', await request(`${url}/samples?${q}`, undefined, Math.min(PAGE_BYTES, TOTAL_BYTES - bytes)));
        bytes += Buffer.byteLength(JSON.stringify(page));
        if (bytes > TOTAL_BYTES) return reject('VALIDATION', 'FILE_LIMIT');
        if (!sameKey(page.key, key) || page.phase !== phase || page.viewHash !== status.viewHash
          || page.selectionManifestHash !== status.plan.selectionManifestHash) return reject('STALE');
        for (const sample of page.items) {
          if (ids.has(sample.scriptId) || sample.entry.operation !== 'upsert'
            || (sample.check && (sample.check.scriptId !== sample.scriptId || sample.check.contentHash !== sample.contentHash))) return reject('STALE');
          ids.add(sample.scriptId); samples.push(sample);
        }
        if (samples.length > status.plan[phase === 'initial' ? 'initialCount' : 'expandedCount']) return reject('STALE');
        cursor = page.nextCursor;
        if (cursor && (!page.items.length || cursors.has(cursor))) return reject('STALE');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      if (samples.length !== status.plan[phase === 'initial' ? 'initialCount' : 'expandedCount'] || (await readStatus()).viewHash !== status.viewHash) return reject('STALE');
      assertActive(); this.loaded = structuredClone({ status, phase, samples });
      return structuredClone(this.loaded);
    });
  }
  /** The human supplies only a selected ID, defect flag and reason. Hashes and
   * inherited checks come from the assembled server view and cannot be edited. */
  setCheck(scriptId: string, defect: boolean, reason: string) {
    this.assertSession();
    if (this.pending || this.active) return reject('CONFLICT');
    const sample = this.loaded?.samples.find(s => s.scriptId === scriptId);
    if (!sample) return reject('STALE');
    if (sample.check) return reject('CONFLICT');
    const check = parseContractSchema('IntakeQualityCheck', { scriptId, contentHash: sample.contentHash, defect, reason });
    this.draft.set(scriptId, check);
  }
  async freeze() {
    this.assertSession();
    if (!this.key) return reject('STALE');
    return this.write({ action: 'quality-freeze', body: { operationId: randomUUID(), key: structuredClone(this.key) } });
  }
  async submit() {
    this.assertSession();
    const view = this.loaded;
    if (!view || !this.key || view.status.state !== (view.phase === 'initial' ? 'initial_required' : 'expansion_required')) return reject('STALE');
    const checks = view.samples.map(s => {
      const check = s.check ?? this.draft.get(s.scriptId);
      if (!check) return reject('VALIDATION');
      return check;
    });
    const body = parseContractSchema('IntakeQualitySubmission', { operationId: randomUUID(), key: this.key, phase: view.phase, checks });
    if (Buffer.byteLength(JSON.stringify(body)) > PAGE_BYTES) return reject('VALIDATION', 'FILE_LIMIT');
    return this.write({ action: 'quality-check', body: structuredClone(body) });
  }
  private async write(command: Pending) {
    if (this.pending || this.active) return reject('CONFLICT');
    this.pending = command;
    return this.transmit(true);
  }
  private accept(raw: unknown, operation: Pending) {
    const receipt = parseContractSchema('IntakeQualityReceipt', raw);
    const phase = 'phase' in operation.body ? operation.body.phase : null;
    if (receipt.operationId !== operation.body.operationId || receipt.action !== operation.action
      || !sameKey(receipt.key, operation.body.key) || receipt.phase !== phase) return reject('STALE');
    this.pending = null; this.clearView(); return receipt;
  }
  /** Retry the exact original body, never generate a replacement operation ID. */
  retry(): Promise<Receipt> { return this.transmit(false); }
  private async transmit(firstAttempt: boolean): Promise<Receipt> {
    this.assertSession();
    const operation = this.pending;
    if (!operation) return reject('STALE');
    return this.run(async (request, key, assertActive) => {
      let raw: unknown;
      try { raw = await request(`${this.address(key)}/${operation.action === 'quality-freeze' ? 'freeze' : 'checks'}`, operation.body); }
      catch (error) {
        // Definitive rejection permits correction. Transport/unknown-commit and
        // malformed success preserve the original operation for recovery.
        if (firstAttempt && error instanceof ProductHttpError && error.reason !== 'COMMIT_UNKNOWN'
          && ['VALIDATION', 'FORBIDDEN', 'UNAUTHORIZED', 'CONFLICT', 'GONE'].includes(error.code) && this.pending === operation) this.pending = null;
        throw error;
      }
      assertActive(); return this.accept(raw, operation);
    }, firstAttempt);
  }
  /** A missing receipt remains unresolved; it is not evidence that POST failed. */
  async recover(): Promise<Receipt> {
    this.assertSession();
    const operation = this.pending;
    if (!operation) return reject('STALE');
    return this.run(async (request, _key, assertActive) => {
      const raw = await request(`/v1/intake/quality/operations/${encodeURIComponent(operation.body.operationId)}?action=${operation.action}`);
      assertActive(); return this.accept(raw, operation);
    });
  }
  cancelRead() { if (!this.pending) { this.active?.abort(); this.clearView(); } }
  dispose() { this.disposed = true; this.unsubscribe(); this.reset(); }
}
