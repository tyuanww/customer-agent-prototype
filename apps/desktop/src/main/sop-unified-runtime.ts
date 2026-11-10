import { ContractValidationError } from '@customer-agent/contracts/sop-resource-disable';
import { randomBytes, randomUUID } from 'node:crypto';
import { SOP_COPY_FEEDBACK_MS } from '../shared/sop-geometry';
import { SopTaskGraph, sopEntryKey, sopMediaKey } from '../shared/sop-task-graph';
import type { SopMedia, SopSchemas, SopUnifiedCommand, SopUnifiedNode, SopUnifiedProjection } from '../shared/sop-unified';
import { ProductHttpError } from './product-http';
import { SopUnifiedPort, type SopSelection } from './sop-unified-port';
import { IntakeUsageError, type IntakeQualification } from './content-intake-usage';

type QueryIntent = Extract<SopUnifiedCommand, { kind: 'query' }>;
type Active = {
  query: QueryIntent;
  principalId: string;
  graph: SopTaskGraph;
  selection: SopSelection;
  continuationId: string;
  entitlement: SopSchemas['IntakeEntitlement'];
  opening: SopSchemas['IntakeSopActionCheck'] | null;
  releaseId: string;
  contextGeneration: number;
  contentDeadline: number;
  mediaContext: 'query-preview' | 'live-continuation';
  queryRequest: Readonly<SopSchemas['MenokinSopQuerySopQueryRequest']>;
};
type PendingQuery = {
  intent: QueryIntent;
  request: Readonly<SopSchemas['MenokinSopQuerySopQueryRequest']>;
  qualification: IntakeQualification;
};
type Handle = { kind: 'confirm' | 'choose' | 'copy' | 'next' | 'media'; id: string };
type ImageLoad =
  | { state: 'loading' | 'unavailable' }
  | { state: 'ready'; image: string; wall: number; monotonic: number };
type MediaWork = {
  nodeId: string;
  controller: AbortController;
  queue: SopMedia[];
};
const MEDIA_CONCURRENCY = 2;
const TERMINAL_REASONS = new Set([
  'SOP_RELEASE_CHANGED', 'SOP_SNAPSHOT_INVALID', 'SOP_GRAPH_INVALID', 'SOP_DEPENDENCY_INVALID', 'APPROVAL_REVOKED',
]);

/** Owns one pinned flow, all progress, request fencing and short display authority.
 * A failed action never advances. Unknown open/close keeps its original private ID. */
export class SopUnifiedRuntime {
  private value: SopUnifiedProjection = { projectionVersion: 'sop-unified-v11', sessionId: 1, shops: [], notice: '选择店铺和流程后查询。', busy: false, copied: false, state: 'idle', node: null, title: '' };
  private active: Active | null = null;
  private pendingQuery: PendingQuery | null = null;
  private handles = new Map<string, Handle>();
  private actionKeys = new Map<string, string>();
  private shops = new Map<string, string>();
  private images = new Map<string, ImageLoad>();
  private mediaWork: MediaWork | null = null;
  private failedDisplays = new Set<string>();
  private listeners = new Set<() => void>();
  private operation: AbortController | null = null;
  private generation = 0;
  private contextGeneration = 0;
  private deadline = 0;
  private wallDeadline = 0;
  private observeAt = 0;
  private imageExpiry: ReturnType<typeof setTimeout> | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private observation: ReturnType<typeof setTimeout> | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;
  private terminalClose: Promise<void> = Promise.resolve();
  private disposed = false;
  private epoch: number;
  private readonly unsubscribers: (() => void)[];
  constructor(private readonly port: SopUnifiedPort, private readonly writeClipboard: (text: string) => void,
    private readonly qualify?: (signal: AbortSignal) => Promise<IntakeQualification>) {
    this.epoch = port.session.view().sessionEpoch;
    this.unsubscribers = [port.session.subscribe(() => {
      const view = port.session.view();
      if (!view.signedIn || view.sessionEpoch !== this.epoch) {
        this.epoch = view.sessionEpoch; this.shops.clear(); this.value.shops = [];
        this.pause('登录状态需要确认，请重新登录后继续。');
      }
    }), port.session.onExplicitLogout(() => this.end('流程已结束。'))];
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  projection(): SopUnifiedProjection {
    if (this.active && Date.now() >= this.active.contentDeadline) this.end('流程有效期已结束，请重新查询。');
    if (this.value.state === 'ready' && [...this.images.entries()].some(([key, image]) => image.state === 'ready' && this.image(key) === null)) this.render();
    if (this.value.state === 'ready' && !this.live()) this.pause('流程需要重新确认，请点击继续。');
    return structuredClone(this.value);
  }
  private emit() { for (const listener of this.listeners) listener(); }
  private clearTimers(clearCopy = true) {
    if (this.expiry) clearTimeout(this.expiry);
    if (this.observation) clearTimeout(this.observation);
    if (clearCopy && this.copyTimer) clearTimeout(this.copyTimer);
    if (this.imageExpiry) clearTimeout(this.imageExpiry);
    this.expiry = this.observation = this.imageExpiry = null;
    if (clearCopy) this.copyTimer = null;
  }
  private concealed(state: Exclude<SopUnifiedProjection['state'], 'ready'>, notice: string) {
    this.stopMedia(); this.resetHandles(); this.images.clear(); this.clearTimers();
    this.value = { ...this.value, state, notice, node: null, title: '', copied: false, busy: false };
    this.emit();
  }
  private pause(notice: string) {
    this.generation++; this.operation?.abort(); this.operation = null;
    this.concealed(this.active ? 'paused' : 'idle', notice);
  }
  private end(notice: string) {
    const active = this.active;
    if (active) {
      // Offline terminal cleanup discards the handle under the continuation end contract.
      this.terminalClose = this.port.close(active.continuationId, AbortSignal.timeout(5000)).catch(() => {
        console.info('[desktop] SOP continuation close unconfirmed');
      });
    }
    this.generation++; this.operation?.abort(); this.operation = null;
    this.active = null; this.pendingQuery = null; this.closing = false; this.failedDisplays.clear();
    this.concealed('ended', notice);
  }
  /** Window destruction is an explicit finish. Offline close cannot prove remote cleanup. */
  invalidate() { this.end('流程已结束。'); }
  async open(sessionId: number) {
    this.value.sessionId = sessionId;
    if (this.active) return;
    await this.run(async signal => {
      const shops = await this.port.shops(signal);
      signal.throwIfAborted();
      this.shops.clear();
      this.value.shops = shops.map(id => {
        const key = randomUUID(); this.shops.set(key, id); return { key, label: id };
      });
      this.concealed('idle', '选择店铺和流程后查询。');
    });
  }
  private async run(work: (signal: AbortSignal) => Promise<void | boolean>): Promise<{ ok: boolean }> {
    if (this.operation || this.disposed) return { ok: false };
    const operation = new AbortController(), generation = this.generation;
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = null;
    this.operation = operation; this.value.busy = true; this.value.copied = false; this.emit();
    const signal = operation.signal;
    try {
      const result = await work(signal);
      signal.throwIfAborted();
      if (generation !== this.generation) return { ok: false };
      return { ok: result !== false };
    } catch (error) {
      if (generation === this.generation) {
        if (error instanceof ProductHttpError && TERMINAL_REASONS.has(error.reason ?? '')) {
          this.end('流程已失效，请结束后重新查询。');
        } else {
          const selectionUnavailable = (error instanceof Error && error.message === 'SOP_SELECTION_REQUIRED')
            || (error instanceof IntakeUsageError && ['STALE', 'EXPIRED', 'VALIDATION'].includes(error.code));
          const blocked = error instanceof ContractValidationError
            || (error instanceof Error && ['SOP_GRAPH_INVALID', 'SOP_DEPENDENCY_INVALID', 'SOP_ENTITLEMENT_BINDING', 'SOP_SELECTION_REQUIRED'].includes(error.message))
            || selectionUnavailable
            || (error instanceof ProductHttpError && error.code === 'FORBIDDEN');
          const retryQuery = this.port.contractVersion === 'v12' && this.pendingQuery !== null;
          this.concealed(this.closing ? 'closing' : this.active || retryQuery ? 'paused' : blocked ? 'blocked' : 'failed', this.closing
            ? '结束结果尚未确认，请按原请求确认。'
            : selectionUnavailable
              ? '请先在查询窗口确认当前店铺、商品与场景条件，再重新查询流程。'
            : '流程暂不能继续，请确认登录和权限后重试。');
        }
      }
      return { ok: false };
    } finally {
      if (this.operation === operation) this.operation = null;
      if (generation === this.generation) { this.value.busy = false; this.emit(); }
    }
  }
  private live(): boolean {
    return !!this.active && this.port.session.view().signedIn && performance.now() < this.deadline && Date.now() < this.wallDeadline;
  }
  private acceptEntitlement(active: Active, entitlement: SopSchemas['IntakeEntitlement'], expectedGeneration: number) {
    const { sourceId } = active.graph.result.flow.header.key;
    if (entitlement.releaseId !== active.releaseId || entitlement.contextGeneration !== expectedGeneration
      || entitlement.shopId !== active.selection.shopId
      || !entitlement.scopes.some(scope => scope.sourceId === sourceId && (scope.shopId === null || scope.shopId === active.selection.shopId))
      || entitlement.scopes.some(scope => scope.shopId !== null && scope.shopId !== active.selection.shopId)
      || Date.parse(entitlement.validUntil) <= Date.now() || Date.parse(entitlement.validUntil) > Date.now() + 300_000) throw new Error('SOP_ENTITLEMENT_BINDING');
    active.entitlement = entitlement; active.contextGeneration = expectedGeneration;
  }
  private acceptReceipt(active: Active, receipt: SopSchemas['IntakeSopContinuationReceipt'], generation: number) {
    if (receipt.continuationId !== active.continuationId) throw new Error('SOP_CONTINUATION_BINDING');
    this.acceptEntitlement(active, receipt.entitlement, generation);
    this.shops.set(active.query.shopKey, active.selection.shopId);
    this.value.shops = [{ key: active.query.shopKey, label: active.selection.shopId }];
  }
  private action(active: Active, action: SopSchemas['IntakeSopActionCheck']['action'], edgeId: string | null = null, entry: SopSchemas['IntakeSopEntryRef'] | null = null): SopSchemas['IntakeSopActionCheck'] {
    return { entitlementId: active.entitlement.entitlementId, releaseId: active.releaseId,
      contextGeneration: active.contextGeneration, key: active.graph.result.flow.header.key,
      graphDigest: active.graph.result.graph_digest, nodeId: active.graph.current().id,
      continuationId: active.continuationId, action, edgeId, entry,
      queryRequestId: action === 'open' ? active.queryRequest.request_id : null };
  }
  private async authorize(active: Active, action: SopSchemas['IntakeSopActionCheck']['action'], signal: AbortSignal, edgeId: string | null = null, entry: SopSchemas['IntakeSopEntryRef'] | null = null) {
    if (this.port.session.view().role === 'agent' && active.graph.result.flow.header.audience === 'coach') throw new Error('SOP_AUDIENCE_DENIED');
    const started = performance.now(), wall = Date.now();
    const receipt = await this.port.check(active.opening ?? this.action(active, action, edgeId, entry), signal);
    signal.throwIfAborted();
    if (active !== this.active) throw new Error('SOP_STALE');
    if (active.opening) {
      if (!receipt) throw new Error('SOP_OPEN_RECEIPT_REQUIRED');
      this.acceptReceipt(active, receipt, active.contextGeneration); active.opening = null;
    }
    if (performance.now() - started >= 5000) throw new Error('SOP_ACTION_TIMEOUT');
    this.wallDeadline = Math.min(Date.parse(active.entitlement.validUntil), active.contentDeadline, wall + 30_000);
    this.observeAt = started + 20_000;
    this.deadline = started + Math.max(0, this.wallDeadline - wall);
    if (!this.live()) throw new Error('SOP_EXPIRED');
  }
  private resetHandles() {
    this.handles.clear();
    this.actionKeys.clear();
  }
  private setImage(key: string, image: ImageLoad) {
    const identity = JSON.stringify(['media', key]);
    const previous = this.actionKeys.get(identity);
    if (previous) this.handles.delete(previous);
    this.actionKeys.delete(identity);
    this.images.set(key, image);
  }
  private stopMedia() {
    this.mediaWork?.controller.abort();
    this.mediaWork = null;
  }
  private startMedia(active: Active, retry: 'missing' | 'all' | { key: string } = 'missing') {
    this.stopMedia();
    const retryKey = typeof retry === 'object' ? retry.key : null;
    const work: MediaWork = { nodeId: active.graph.current().id, controller: new AbortController(), queue: [] };
    for (const media of active.graph.media()) {
      const key = sopMediaKey(media), image = this.images.get(key);
      if (this.image(key) !== null && !this.failedDisplays.has(key)) continue;
      if (image?.state === 'unavailable' && retry !== 'all' && retryKey !== key) continue;
      if (retry === 'all' || retryKey === key) this.failedDisplays.delete(key);
      this.setImage(key, { state: 'loading' });
      work.queue.push(media);
    }
    if (!work.queue.length) return;
    work.queue.sort((a, b) => Number(b.binding.required) - Number(a.binding.required));
    this.mediaWork = work;
    const entitlement = active.entitlement;
    const context = active.mediaContext;
    const current = () => this.mediaWork === work && this.active === active
      && active.graph.current().id === work.nodeId && !work.controller.signal.aborted;
    const worker = async () => {
      while (current() && work.queue.length) {
        const media = work.queue.shift();
        if (!media) return;
        const key = sopMediaKey(media);
        try {
          const verified = await this.port.media({ media, entitlement, continuationId: active.continuationId,
            context: context === 'query-preview'
              ? { kind: 'query-preview', expiresAt: media.expires_at }
              : { kind: 'live-continuation' },
          }, work.controller.signal);
          if (!current()) return;
          if (!this.live()) { this.pause('流程需要重新确认，请点击继续。'); return; }
          this.setImage(key, { state: 'ready', image: verified.image, wall: verified.displayUntil,
            monotonic: verified.monotonicDeadline });
        } catch (error) {
          if (!current()) return;
          if (error instanceof ProductHttpError) {
            if (TERMINAL_REASONS.has(error.reason ?? '')) {
              this.end('流程已失效，请结束后重新查询。'); return;
            }
            if (['FORBIDDEN', 'UNAUTHORIZED', 'UNAVAILABLE', 'STALE', 'CONSENT_REQUIRED'].includes(error.code)) {
              this.pause('图片读取时无法确认当前权限，请重新确认后继续。'); return;
            }
          }
          const unavailable = error instanceof ProductHttpError || error instanceof ContractValidationError
            || (error instanceof Error && ['SOP_MEDIA_EXPIRED', 'SOP_MEDIA_BINDING', 'SOP_MEDIA_UNAVAILABLE'].includes(error.message));
          if (!unavailable) throw error;
          this.setImage(key, { state: 'unavailable' });
        }
        if (current()) this.render();
      }
    };
    void Promise.all(Array.from({ length: Math.min(MEDIA_CONCURRENCY, work.queue.length) }, worker))
      .catch(() => {
        if (current()) {
          console.info('[desktop] SOP media projection interrupted');
          this.pause('图片展示暂时中断，请重新确认后继续。');
        }
      })
      .finally(() => { if (this.mediaWork === work) this.mediaWork = null; });
  }
  private image(key: string): string | null {
    const image = this.images.get(key);
    return image?.state === 'ready' && Date.now() < image.wall && performance.now() < image.monotonic ? image.image : null;
  }
  private mediaReady(active: Active): boolean {
    return active.graph.media().every(media => !media.binding.required || (this.image(sopMediaKey(media)) !== null && !this.failedDisplays.has(sopMediaKey(media))));
  }
  private handle(kind: Handle['kind'], id: string): string {
    const identity = JSON.stringify([kind, id]);
    const existing = this.actionKeys.get(identity);
    if (existing) return existing;
    const key = randomUUID();
    this.actionKeys.set(identity, key);
    this.handles.set(key, { kind, id });
    return key;
  }
  private render() {
    const active = this.active;
    if (!active || !this.live()) { this.pause('流程需要重新确认，请点击继续。'); return; }
    this.clearTimers(false);
    for (const [key, image] of this.images) {
      if (image.state === 'ready' && this.image(key) === null) this.setImage(key, { state: 'unavailable' });
    }
    const graph = active.graph, task = graph.current(), mediaReady = this.mediaReady(active);
    const next = graph.edges().find(edge => edge.action.kind === 'next');
    const node: SopUnifiedNode = {
      kind: task.body.kind, title: task.body.title, stage: task.body.stageLabel, instruction: task.body.instruction,
      requirements: graph.requirements().map(item => ({ key: this.handle('confirm', item.id), label: item.label, ordinal: item.ordinal, confirmed: graph.confirmed(item.id) })),
      scripts: task.body.scripts.map(script => {
        const key = sopEntryKey(script.entry), entry = graph.entries.get(key)!, permission = graph.permissions.get(key)!;
        return { key: this.handle('copy', key), title: entry.title, body: entry.answerText, relation: script.relation,
          condition: script.condition, risk: permission.risk_level, canCopy: permission.copy_allowed && mediaReady };
      }),
      knowledge: task.body.knowledge.map(item => ({ title: item.title, body: item.body, resource: item.resourceBinding?.resourceId ?? null, owner: item.resourceBinding?.ownerKind ?? null })),
      media: graph.media().map((item): SopUnifiedNode['media'][number] => {
        const mediaKey = sopMediaKey(item);
        const image = this.failedDisplays.has(mediaKey) ? null : this.image(mediaKey);
        const owner: SopUnifiedNode['media'][number]['owner'] = item.binding.entry ? 'entry' : item.binding.graphTarget!.kind;
        const display = {
          key: this.handle('media', mediaKey),
          alt: item.binding.alt,
          owner,
          required: item.binding.required,
        };
        return image !== null ? { ...display, state: 'ready', image } : {
          ...display,
          state: this.images.get(mediaKey)?.state === 'loading' ? 'loading' : 'unavailable',
          image: null,
        };
      }),
      choices: graph.edges().flatMap(edge => edge.action.kind === 'choice' ? [{ key: this.handle('choose', edge.id),
        label: edge.action.label, criterion: edge.action.criterion, unableToDetermine: edge.action.unableToDetermine, ordinal: edge.action.ordinal }] : []).sort((a, b) => a.ordinal - b.ordinal),
      canAdvance: task.body.kind !== 'terminal' && graph.complete() && mediaReady, nextKey: next ? this.handle('next', next.id) : '',
    };
    this.value = { ...this.value, state: 'ready', title: graph.result.flow.header.title, node,
      notice: mediaReady ? '' : '本步必需图片尚未齐备，读取完成后才能继续。' };
    const remaining = Math.max(0, Math.min(this.deadline - performance.now(), this.wallDeadline - Date.now()));
    this.expiry = setTimeout(() => {
      if (Date.now() >= active.contentDeadline) this.end('流程有效期已结束，请重新查询。');
      else this.pause('流程需要重新确认，请点击继续。');
    }, remaining);
    this.observation = setTimeout(() => { void this.command({ kind: 'refresh' }); }, Math.max(0, Math.min(this.observeAt - performance.now(), remaining)));
    const imageRemaining = Math.min(...[...this.images.values()].filter(image => image.state === 'ready').map(image => Math.min(
      image.wall - Date.now(), image.monotonic - performance.now(),
    )).filter(duration => duration > 0));
    if (Number.isFinite(imageRemaining)) this.imageExpiry = setTimeout(() => this.render(), Math.ceil(imageRemaining));
    this.emit();
  }
  async command(command: SopUnifiedCommand): Promise<{ ok: boolean }> {
    if (command.kind === 'clear') return this.finish();
    if (command.kind === 'query') return this.query(command);
    const pendingQuery = this.pendingQuery;
    if (command.kind === 'refresh' && pendingQuery && !this.active) {
      return this.run(signal => this.consumeQuery(pendingQuery, signal));
    }
    const active = this.active;
    if (!active || this.closing) return { ok: false };
    const actor = this.port.session.view();
    if (!actor.signedIn || actor.userId !== active.principalId) { this.pause('请用打开流程的账号重新登录。'); return { ok: false }; }
    if (Date.now() >= active.contentDeadline) { this.end('流程有效期已结束，请重新查询。'); return { ok: false }; }
    if (command.kind === 'refresh') return this.run(async signal => {
      if (!this.port.session.view().signedIn) throw new Error('SOP_SIGN_IN_REQUIRED');
      if (!active.opening) {
        const generation = ++this.contextGeneration;
        const receipt = await this.port.renew(active.continuationId, generation, signal);
        signal.throwIfAborted();
        this.acceptReceipt(active, receipt, generation);
      }
      this.stopMedia(); this.resetHandles();
      active.mediaContext = 'live-continuation';
      await this.authorize(active, 'observe', signal);
      this.startMedia(active, 'all'); this.render();
    });
    const handle = this.handles.get(command.key);
    if (command.kind === 'media-failed') {
      if (handle?.kind !== 'media' || this.value.state !== 'ready' || this.image(handle.id) === null) return { ok: false };
      this.failedDisplays.add(handle.id); this.setImage(handle.id, { state: 'unavailable' }); this.render(); return { ok: true };
    }
    if (!handle || handle.kind !== command.kind || this.value.state !== 'ready' || !this.live()) return { ok: false };
    if ((handle.kind === 'copy' || handle.kind === 'next' || handle.kind === 'choose') && !this.mediaReady(active)) return { ok: false };
    if ((handle.kind === 'next' || handle.kind === 'choose') && !active.graph.complete()) return { ok: false };
    return this.run(async signal => {
      if (handle.kind === 'confirm' || handle.kind === 'media') {
        await this.authorize(active, 'observe', signal);
        if (handle.kind === 'confirm') active.graph.confirm(handle.id);
        if (handle.kind === 'media') active.mediaContext = 'live-continuation';
        if (handle.kind === 'media') this.startMedia(active, { key: handle.id });
        this.render(); return;
      }
      const script = active.graph.current().body.scripts.find(item => sopEntryKey(item.entry) === handle.id);
      if (handle.kind === 'copy' && (!script || !active.graph.permissions.get(handle.id)?.copy_allowed)) throw new Error('SOP_COPY_DENIED');
      if (handle.kind !== 'copy' && !active.graph.complete()) throw new Error('SOP_CONFIRM_REQUIRED');
      await this.authorize(active, handle.kind, signal, handle.kind === 'copy' ? null : handle.id, script?.entry ?? null);
      if (!this.mediaReady(active)) { this.render(); return false; }
      if (handle.kind === 'copy') {
        if (!this.live()) throw new Error('SOP_EXPIRED');
        this.writeClipboard(active.graph.entries.get(handle.id)!.answerText);
        this.render(); this.value.copied = true;
        this.copyTimer = setTimeout(() => { this.value.copied = false; this.emit(); }, SOP_COPY_FEEDBACK_MS);
        this.emit();
      } else {
        if (!active.graph.advance(handle.id)) throw new Error('SOP_EDGE_INVALID');
        this.stopMedia(); this.images.clear(); this.failedDisplays.clear(); this.resetHandles();
        this.startMedia(active); this.render();
      }
    });
  }
  private async query(command: QueryIntent): Promise<{ ok: boolean }> {
    if (this.active && !(await this.finish()).ok) return { ok: false };
    const shopId = this.shops.get(command.shopKey);
    if (!shopId) return { ok: false };
    return this.run(async signal => {
      this.concealed('loading', '正在查询流程。'); this.value.busy = true;
      this.pendingQuery = null;
      let qualification: IntakeQualification;
      if (this.port.contractVersion === 'v12') {
        if (!this.qualify) throw new Error('SOP_SELECTION_REQUIRED');
        qualification = await this.qualify(signal);
        if (!qualification.isCurrent() || qualification.selection.shopId !== shopId) throw new Error('SOP_SELECTION_REQUIRED');
      } else {
        const selection = { shopId, productIds: [], scenarioIds: [] };
        const entitlement = await this.port.issue(selection, ++this.contextGeneration, signal);
        qualification = { selection, entitlement, isCurrent: () => !signal.aborted && Date.now() < Date.parse(entitlement.validUntil) };
      }
      signal.throwIfAborted();
      const request = { shop_id: shopId, sop_group: command.group, query_text: command.text,
        context_generation: randomUUID(), request_id: randomUUID(), entitlement_id: qualification.entitlement.entitlementId };
      this.pendingQuery = { intent: structuredClone(command), request, qualification };
      return this.consumeQuery(this.pendingQuery, signal);
    });
  }
  private async consumeQuery(pending: PendingQuery, signal: AbortSignal) {
    const response = await this.port.query(pending.request, signal);
    signal.throwIfAborted();
    if (pending !== this.pendingQuery || !pending.qualification.isCurrent()) {
      this.pendingQuery = null;
      throw new Error('SOP_SELECTION_REQUIRED');
    }
    if (response.status !== 'ready') {
      this.pendingQuery = null;
      this.concealed(response.status, response.status === 'no_match' ? '没有找到匹配流程。'
        : response.status === 'stale' ? '流程已失效，请重新查询。' : '当前流程不能安全提供，请联系管理员核对。'); return;
    }
    const actor = this.port.session.view(), role = actor.role;
    if (!role || !actor.userId) throw new Error('SOP_SIGN_IN_REQUIRED');
    const graph = new SopTaskGraph(response.result, role);
    if (Date.parse(response.lease_expires_at) <= Date.now()) throw new Error('SOP_LEASE_EXPIRED');
    const contentDeadline = Math.min(
      graph.result.flow.header.effectiveTo === null ? Infinity : Date.parse(graph.result.flow.header.effectiveTo),
      ...response.result.entries.map(row => row.entry.effectiveTo === null ? Infinity : Date.parse(row.entry.effectiveTo)));
    if (Date.parse(graph.result.flow.header.effectiveFrom) > Date.now() || response.result.entries.some(row => Date.parse(row.entry.effectiveFrom) > Date.now()) || contentDeadline <= Date.now()) throw new Error('SOP_CONTENT_EXPIRED');
    const { selection, entitlement } = pending.qualification;
    const generation = entitlement.contextGeneration;
    this.contextGeneration = Math.max(this.contextGeneration, generation);
    const active: Active = { query: pending.intent, principalId: actor.userId, graph, selection, continuationId: `sct_${randomBytes(32).toString('hex')}`,
      entitlement, opening: null, releaseId: response.release_id, contextGeneration: generation, contentDeadline, mediaContext: 'query-preview',
      queryRequest: pending.request };
    this.acceptEntitlement(active, entitlement, generation);
    active.opening = this.action(active, 'open'); this.active = active; this.pendingQuery = null;
    await this.authorize(active, 'open', signal);
    if (!pending.qualification.isCurrent()) { this.end('查询条件已变化，请重新查询。'); return false; }
    this.startMedia(active); this.render();
  }
  async restart(): Promise<{ ok: boolean }> {
    const query = this.active?.query;
    if (!query || !(await this.finish()).ok) return { ok: false };
    return this.query(query);
  }
  async finish(): Promise<{ ok: boolean }> {
    this.pendingQuery = null;
    if (this.operation) { this.pause('正在结束流程。'); }
    const active = this.active;
    if (!active) { this.concealed('idle', '选择店铺和流程后查询。'); return { ok: true }; }
    this.closing = true; this.concealed('paused', '正在结束流程。');
    return this.run(async signal => {
      await this.port.close(active.continuationId, signal);
      signal.throwIfAborted();
      if (active !== this.active) throw new Error('SOP_STALE');
      this.active = null; this.closing = false; this.failedDisplays.clear();
      this.concealed('idle', '选择店铺和流程后查询。');
    });
  }
  dispose() {
    this.end('流程已结束。'); this.disposed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.listeners.clear();
    return this.terminalClose;
  }
}
