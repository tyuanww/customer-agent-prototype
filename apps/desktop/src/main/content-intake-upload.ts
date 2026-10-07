import { createHash, randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { INTAKE_REPORT_MAX_BYTES, INTAKE_UPLOAD_MAX_BYTES, isIntakeUploadCommand, type IntakeUploadCommand, type IntakeUploadPhase, type IntakeUploadView } from '../shared/content-intake-upload';
import type { IntakeAccess } from './content-intake-access';
import { ProductHttpError } from './product-http';
import type { ProductSession } from './product-session';

type C = components['schemas'];
type Session = Pick<ProductSession, 'view' | 'subscribe' | 'request'>;
type Workbook = { name: string; bytes: Buffer };
type Principal = C['IntakePrincipalPage']['items'][number] & { selection: string };
type Pending = { kind: 'upload'; operationId: string; file: Workbook } | { kind: 'receive'; body: C['IntakeReceive'] };
type Request = (path: string, options?: Parameters<Session['request']>[2]) => Promise<unknown>;
export type IntakeNativeFiles = {
  chooseWorkbook(signal: AbortSignal): Promise<Workbook | null>;
  saveReport(bytes: Buffer, signal: AbortSignal): Promise<boolean>;
};
// 100 issues × (512 message + 64 code + 64 sheet) × up to 6 JSON-escape bytes, plus metadata.
const JOB_BYTES = 512 * 1024;
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const reject = (code: 'STALE' | 'CONFLICT' | 'FORBIDDEN' | 'VALIDATION'): never => { throw new ProductHttpError(code); };
const sameContext = (a: C['IntakeManagementContext'], b: C['IntakeManagementContext']) =>
  a.sourceId === b.sourceId && a.sourceVersion === b.sourceVersion && a.baseReleaseId === b.baseReleaseId
  && a.principalId === b.principalId && a.factsVersion === b.factsVersion;
const parsing = (job: C['IntakeParseJob'] | null) => job?.state === 'reading' || job?.state === 'parsing';

/** Owns a whole native upload draft and original uncertain writes, all in memory.
 * Source/principal handles are UI choices, never identity assertions. stop aborts
 * local waiting only; a transmitted write remains recoverable with the same ID.
 * Access loss hides material; logout/epoch change/disposal destroys it. */
export class ContentIntakeUpload {
  private epoch: number;
  private disposed = false;
  private unsubscribe: () => void;
  private active: AbortController | null = null;
  private sources = new Map<string, string>();
  private sourceId: string | null = null;
  private file: Workbook | null = null;
  private context: C['IntakeManagementContext'] | null = null;
  private principals: Principal[] = [];
  private preparer: string | null = null;
  private editors: string[] = [];
  private confirmed = false;
  private object: C['IntakeObject'] | null = null;
  private pending: Pending | null = null;
  private job: C['IntakeParseJob'] | null = null;
  private phase: IntakeUploadPhase = 'idle';
  private notice: string | null = null;
  private revision = 0;
  constructor(private readonly session: Session, private readonly native: IntakeNativeFiles) {
    this.epoch = session.view().sessionEpoch;
    this.unsubscribe = session.subscribe(() => {
      const current = session.view();
      if (!current.signedIn || current.sessionEpoch !== this.epoch) {
        this.epoch = current.sessionEpoch; this.invalidate(true);
      }
    });
  }
  private allowed(access: IntakeAccess | null) {
    if (!access || !this.session.view().signedIn || Date.now() >= Date.parse(access.validUntil)) return [];
    return access.sources.filter(s => s.contentIntakeMode === 'v2-preview'
      && access.capabilities.some(c => c.scope.sourceId === s.scope.sourceId && c.actions.includes('import')
        && Date.now() < Date.parse(c.validUntil) && Object.entries(s.scope).every(([k, v]) => Reflect.get(c.scope, k) === v)));
  }
  private declarationClear() { this.principals = []; this.preparer = null; this.editors = []; this.confirmed = false; this.context = null; }
  private clearDraft() {
    this.file = null; this.object = null; this.pending = null; this.job = null;
    this.declarationClear(); this.notice = null; this.revision++;
  }
  invalidate(reset: boolean) {
    this.active?.abort(); this.active = null;
    if (reset) { this.clearDraft(); this.sources.clear(); this.sourceId = null; this.phase = 'idle'; }
    else this.phase = this.pending ? 'unknown' : this.phase;
  }
  closeRisk(): 'pending' | 'editing' | null {
    if (this.active || this.pending || parsing(this.job)) return 'pending';
    return this.file && this.job?.state !== 'validated' ? 'editing' : null;
  }
  private canManage(access: IntakeAccess | null) {
    return !!access && Date.now() < Date.parse(access.validUntil) && access.capabilities.some(c => c.scope.sourceId === this.sourceId
      && c.actions.includes('content-manage') && Date.now() < Date.parse(c.validUntil));
  }
  private declarationLive() {
    return !!this.context && Date.now() < Date.parse(this.context.validUntil);
  }
  view(access: IntakeAccess | null): IntakeUploadView {
    const allowed = this.allowed(access);
    for (const s of allowed) if (!this.sources.has(s.scope.sourceId)) this.sources.set(s.scope.sourceId, randomUUID());
    const authorized = allowed.some(s => s.scope.sourceId === this.sourceId), busy = this.active !== null;
    const readable = authorized && !this.disposed && this.session.view().sessionEpoch === this.epoch;
    const declarations = readable && this.declarationLive();
    const ready = readable && !busy && !this.pending;
    const deadlines = [access?.validUntil, this.context?.validUntil].filter((s): s is string => !!s);
    return structuredClone({ draftRevision: this.revision, phase: this.phase, busy, authorized: allowed.length > 0,
      validUntil: readable && deadlines.length ? new Date(Math.min(...deadlines.map(Date.parse))).toISOString() : null,
      sources: allowed.map(s => ({ selection: this.sources.get(s.scope.sourceId)!, label: `${s.scope.sourceId} · ${s.scope.shopId ?? s.scope.brandId}` })),
      sourceSelection: readable ? this.sources.get(this.sourceId!) ?? null : null,
      file: readable && this.file ? { name: this.file.name, bytes: this.file.bytes.length } : null,
      principals: declarations ? this.principals.map(({ selection, displayLabel, enabled }) => ({ selection, displayLabel, enabled })) : [],
      preparerSelection: declarations ? this.preparer : null, editorSelections: declarations ? this.editors : [],
      confirmed: !!declarations && this.confirmed, pending: this.pending?.kind ?? null,
      job: readable && this.job ? { state: this.job.state, issues: this.job.issues, totalIssues: this.job.totalIssues,
        excludedSheetCount: this.job.excludedSheetCount, excludedMediaCount: this.job.excludedMediaCount } : null,
      canChoose: ready && !parsing(this.job), canSubmit: ready && !!this.file && !this.job && !!declarations,
      canRetry: !busy && !!this.pending && !this.disposed && this.session.view().signedIn && this.session.view().sessionEpoch === this.epoch,
      // Completed parsing is immutable; reopening its candidate is an explicit
      // intent, so refreshing an old upload cannot compete with another selection.
      canRefresh: ready && !!this.file && this.job?.state !== 'validated',
      canStop: busy, canSaveReport: ready && !!this.job?.reportObjectId,
      canOpen: ready && this.canManage(access) && this.job?.state === 'validated', notice: this.notice });
  }
  private sourcePath() { return `/v1/intake/sources/${encodeURIComponent(this.sourceId!)}`; }
  private async readContext(request: Request) {
    const context = parseContractSchema('IntakeManagementContext', await request(`${this.sourcePath()}/management-context`));
    if (context.sourceId !== this.sourceId || Date.now() >= Date.parse(context.validUntil)) return reject('STALE');
    return context;
  }
  private async loadDeclaration(request: Request, context: C['IntakeManagementContext']) {
    const rows: Principal[] = [], ids = new Set<string>(), cursors = new Set<string>();
    let cursor: string | null = null, bytes = 0, pages = 0;
    do {
      if (++pages > 50) return reject('VALIDATION');
      const query = new URLSearchParams({ sourceId: this.sourceId!, purpose: 'contributor', limit: '100', ...(cursor ? { cursor } : {}) });
      const raw = await request(`/v1/intake/principals?${query}`, { maxResponseBytes: 262_144 });
      bytes += Buffer.byteLength(JSON.stringify(raw));
      if (bytes > 8 * 1024 * 1024) return reject('VALIDATION');
      const page = parseContractSchema('IntakePrincipalPage', raw);
      // Contributor facts describe historical participants, not this caller's
      // permission deadline. Disabled/expired targets remain declarable; only
      // the authenticated management context and access govern this operation.
      for (const p of page.items) {
        if (ids.has(p.principalId)) return reject('STALE');
        ids.add(p.principalId); rows.push({ ...p, selection: randomUUID() });
      }
      cursor = page.nextCursor;
      // Filtered empty pages are legal; repeated cursors are not.
      if (cursor && cursors.has(cursor)) return reject('STALE');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const after = await this.readContext(request);
    if (!sameContext(context, after)) return reject('STALE');
    const self = rows.find(p => p.principalId === context.principalId && p.factsVersion === context.factsVersion);
    if (!self) return reject('STALE');
    this.context = after; this.principals = rows; this.preparer = self.selection; this.editors = [];
    this.confirmed = false; this.revision++; this.phase = 'confirming';
  }
  private async freshDeclaration(request: Request) {
    const current = await this.readContext(request);
    if (!this.context || !sameContext(this.context, current) || !this.declarationLive()) {
      this.declarationClear(); await this.loadDeclaration(request, current);
      this.notice = '来源、发布基线或人员资格已更新，请重新确认整理者和全部改稿人。'; return false;
    }
    this.context = current; return true;
  }
  private async transmit(request: Request, retry: boolean) {
    const pending = this.pending!;
    try {
      if (pending.kind === 'upload') {
        this.phase = 'uploading';
        const form = new FormData(); form.append('operationId', pending.operationId);
        form.append('file', new Blob([new Uint8Array(pending.file.bytes)], { type: MIME }), 'faq.xlsx');
        const object = parseContractSchema('IntakeObject', await request(`${this.sourcePath()}/objects`, { form, timeoutMs: 30_000 }));
        if (object.sourceId !== this.sourceId || object.bytes !== pending.file.bytes.length
          || object.sha256 !== createHash('sha256').update(pending.file.bytes).digest('hex')) return reject('STALE');
        this.object = object;
      } else {
        this.phase = 'receiving';
        const job = parseContractSchema('IntakeParseJob', await request(`${this.sourcePath()}/candidates`, { body: pending.body, maxResponseBytes: JOB_BYTES }));
        this.acceptJob(job);
      }
      this.pending = null;
    } catch (error) {
      // An uncertain replay must keep its identity even if current permission or
      // material now rejects it. Only a first definitive input rejection is safe
      // to edit. In particular an upload can commit before its final auth check.
      if (this.pending === pending && !retry && error instanceof ProductHttpError && error.reason !== 'COMMIT_UNKNOWN'
        && (error.code === 'VALIDATION' || error.code === 'CONFLICT')) {
        this.pending = null; this.confirmed = false; this.phase = 'confirming';
        this.notice = '未接受本次输入，请刷新确认信息，或整批修正后重新选择文件。';
      }
      throw error;
    }
  }
  private async receive(request: Request) {
    if (!await this.freshDeclaration(request)) return;
    if (!this.confirmed || !this.object || !this.context) return reject('STALE');
    const preparer = this.principals.find(p => p.selection === this.preparer)!;
    this.pending = { kind: 'receive', body: parseContractSchema('IntakeReceive', {
      operationId: randomUUID(), objectId: this.object.objectId, sourceVersion: this.context.sourceVersion, baseReleaseId: this.context.baseReleaseId,
      contributorDeclaration: { preparerPrincipalId: preparer.principalId,
        editorPrincipalIds: this.editors.map(h => this.principals.find(p => p.selection === h)!.principalId), confirmed: true }, expectedPriorKey: null,
    }) };
    await this.transmit(request, false);
  }
  private acceptJob(job: C['IntakeParseJob']) {
    if (this.job && (job.jobId !== this.job.jobId || job.generation < this.job.generation
      || (!parsing(this.job) && JSON.stringify(job) !== JSON.stringify(this.job)))) return reject('STALE');
    if (job.state === 'validated' && (!job.candidateId || job.candidateVersion === null)) return reject('STALE');
    this.job = job; this.phase = parsing(job) ? 'parsing' : job.state === 'validated' ? 'validated' : 'failed';
    this.notice = job.state === 'failed' ? '校验未通过，请下载完整报告，整批修正后重新选择文件。'
      : job.state === 'cancelled' ? '服务端解析已结束，请重新选择文件。' : null;
  }
  private async openCandidate(request: Request) {
    const job = this.job;
    if (!job || job.state !== 'validated') return null;
    const c = parseContractSchema('IntakeCandidate', await request(`/v1/intake/candidates/${encodeURIComponent(job.candidateId!)}/versions/${job.candidateVersion}`));
    if (c.sourceId !== this.sourceId || c.key.candidateId !== job.candidateId || c.key.version !== job.candidateVersion) return reject('STALE');
    return structuredClone(c);
  }
  async command(command: IntakeUploadCommand, access: IntakeAccess | null, signal?: AbortSignal): Promise<C['IntakeCandidate'] | null> {
    if (!isIntakeUploadCommand(command)) return reject('VALIDATION');
    const session = this.session.view();
    if (this.disposed || !session.signedIn || session.sessionEpoch !== this.epoch) return reject('STALE');
    if (command.action === 'upload-stop') {
      this.active?.abort(); this.active = null;
      this.phase = this.pending ? 'unknown' : 'stopped';
      this.notice = this.pending ? '已停止本机等待，服务端结果未知；请恢复原操作。' : '已停止本机等待，未取消服务端解析。'; return null;
    }
    if (this.active) return reject('CONFLICT');
    if (this.pending && command.action !== 'upload-retry') return reject('CONFLICT');
    if (command.action === 'upload-reset') {
      if (parsing(this.job)) return reject('CONFLICT');
      this.clearDraft(); this.phase = this.sourceId ? 'selected' : 'idle'; return null;
    }
    const allowed = this.allowed(access);
    if (command.action === 'upload-source') {
      if (parsing(this.job)) return reject('CONFLICT');
      const source = allowed.find(s => this.sources.get(s.scope.sourceId) === command.selection);
      if (!source) return reject('FORBIDDEN');
      this.clearDraft(); this.sourceId = source.scope.sourceId; this.phase = 'selected'; return null;
    }
    if (!allowed.some(s => s.scope.sourceId === this.sourceId)) return reject('FORBIDDEN');
    const controller = new AbortController(); this.active = controller;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const assertActive = () => {
      const current = this.session.view();
      if (this.disposed || controller.signal.aborted || this.active !== controller || current.sessionEpoch !== session.sessionEpoch || !current.signedIn) return reject('STALE');
      if (!this.allowed(access).some(s => s.scope.sourceId === this.sourceId)) return reject('FORBIDDEN');
    };
    const request: Request = async (path, options = {}) => {
      assertActive();
      try {
        const r = await this.session.request(session.sessionEpoch, path, { maxResponseBytes: 65_536, ...options, signal: controller.signal });
        assertActive(); return r.value;
      } catch (error) { assertActive(); throw error; }
    };
    try {
      assertActive(); this.notice = null;
      if (command.action === 'upload-choose') {
        if (parsing(this.job)) return reject('CONFLICT');
        const previous = this.phase; this.phase = 'choosing';
        const picked = await this.native.chooseWorkbook(controller.signal); assertActive();
        if (!picked) { this.phase = previous; return null; }
        if (!Buffer.isBuffer(picked.bytes) || picked.bytes.length < 4 || picked.bytes.length > INTAKE_UPLOAD_MAX_BYTES
          || picked.bytes.readUInt32LE(0) !== 0x04034b50 || !/\.xlsx$/i.test(picked.name)
          || /[\\/]/.test(picked.name) || [...picked.name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || picked.name.length > 255) return reject('VALIDATION');
        this.clearDraft(); this.file = { name: picked.name, bytes: Buffer.from(picked.bytes) }; this.phase = 'confirming';
        await this.loadDeclaration(request, await this.readContext(request));
      } else if (command.action === 'upload-submit') {
        if (!this.file || this.job || !this.context) return reject('STALE');
        if (!await this.freshDeclaration(request)) return null;
        if (!this.principals.some(p => p.selection === command.preparerSelection)
          || command.editorSelections.some(h => !this.principals.some(p => p.selection === h))) return reject('VALIDATION');
        this.preparer = command.preparerSelection; this.editors = [...command.editorSelections]; this.confirmed = true;
        if (!this.object) { this.pending = { kind: 'upload', operationId: randomUUID(), file: this.file }; await this.transmit(request, false); }
        await this.receive(request);
      } else if (command.action === 'upload-retry') {
        if (!this.pending) return reject('CONFLICT');
        const kind = this.pending.kind; await this.transmit(request, true);
        if (kind === 'upload') await this.receive(request);
      } else if (command.action === 'upload-refresh') {
        if (!this.file) return reject('STALE');
        if (!this.job) { this.declarationClear(); await this.loadDeclaration(request, await this.readContext(request)); }
        else this.acceptJob(parseContractSchema('IntakeParseJob', await request(`/v1/intake/parse-jobs/${encodeURIComponent(this.job.jobId)}`, { maxResponseBytes: JOB_BYTES })));
      } else if (command.action === 'upload-save-report') {
        if (!this.job?.reportObjectId) return reject('STALE');
        const raw = await request(`/v1/intake/parse-jobs/${encodeURIComponent(this.job.jobId)}/report`, { responseType: 'xlsx', maxResponseBytes: INTAKE_REPORT_MAX_BYTES, timeoutMs: 30_000 });
        if (!Buffer.isBuffer(raw) || raw.length < 4 || raw.length > INTAKE_REPORT_MAX_BYTES || raw.readUInt32LE(0) !== 0x04034b50) return reject('VALIDATION');
        assertActive(); const saved = await this.native.saveReport(raw, controller.signal); assertActive();
        this.notice = saved ? '完整校验报告已保存。' : '已取消保存报告。';
      } else if (command.action !== 'upload-open') return reject('VALIDATION');
      else if (!this.canManage(access)) return reject('FORBIDDEN');
      assertActive();
      return this.canManage(access) && ['upload-refresh', 'upload-open', 'upload-submit', 'upload-retry'].includes(command.action) ? await this.openCandidate(request) : null;
    } catch (error) {
      if (this.active === controller) {
        this.phase = this.pending ? 'unknown' : this.job ? this.phase : 'stopped';
        this.notice = this.pending ? '服务端结果未知；请恢复原操作，勿重复创建。' : this.notice ?? '操作未完成，请刷新或重新选择文件。';
      }
      if (error instanceof ProductHttpError) throw error;
      throw new ProductHttpError('UNAVAILABLE');
    } finally { signal?.removeEventListener('abort', abort); if (this.active === controller) this.active = null; }
  }
  dispose() { this.disposed = true; this.unsubscribe(); this.invalidate(true); }
}
