import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  OPERATION_TRANSITIONS,
  classifyOperationReuse,
  parseOperationEnvelope,
  parseOperationStatus,
  type OperationCommand,
  type OperationEnvelope,
  type OperationId,
  type OperationReceipt,
  type OperationState,
  type OperationStatus,
} from '../../../../packages/unified-contracts/src/index.ts';

export const DASHBOARD_OPERATION_DOMAINS = [
  'release',
  'permissions',
  'accounts',
  'materials',
  'rollback',
  'ops-loop',
] as const;

export type DashboardOperationDomain = (typeof DASHBOARD_OPERATION_DOMAINS)[number];
export type DashboardControlPlaneErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'STALE'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'UNAVAILABLE';

export type DashboardSessionView = Readonly<{
  ok: boolean;
  enabled: boolean;
  signedIn: boolean;
  sessionEpoch: number;
  userId: string | null;
  role: string | null;
}>;

export type DashboardControlPlaneSession = Readonly<{
  view(): DashboardSessionView;
  request(
    epoch: number,
    path: string,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<{ value: unknown }>>;
  subscribe?(listener: () => void): () => void;
}>;

export type DashboardAccessView = Readonly<{
  sessionEpoch: number;
  accessRevision: number;
  expiresAt: string;
  grants: 'open' | 'closed';
  accounts: 'open' | 'closed';
  denyReason: string | null;
}>;

export type DashboardAccessPort = Readonly<{
  read(): Promise<DashboardAccessView>;
}>;

export type DashboardOperationView = Readonly<{
  domain: DashboardOperationDomain;
  operationId: OperationId;
  command: OperationCommand;
  state: OperationState;
  updatedAt: string;
  recoveryDeadline: string;
  canCancel: boolean;
  canRecover: boolean;
  releaseInvalidationPending: boolean;
}>;

export type DashboardDomainOutcome<R> =
  | Readonly<{
      kind: 'committed';
      result?: R;
      resultRef: string;
      releaseId?: string;
    }>
  | Readonly<{ kind: 'failed'; result?: R; failureCode: string }>
  | Readonly<{ kind: 'cancelled'; result?: R }>
  | Readonly<{ kind: 'unknown'; result?: R; domainRef?: string }>
  | Readonly<{ kind: 'expired'; result?: R }>;

export type DashboardRecoveryOutcome =
  | Readonly<{ kind: 'committed'; resultRef: string; releaseId?: string }>
  | Readonly<{ kind: 'failed'; failureCode: string }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unknown' }>
  | Readonly<{ kind: 'not-found' }>;

export type DashboardOperationContext = Readonly<{
  operationId: OperationId;
  signal: AbortSignal;
  beginCommit(): void;
  noteDomainRef(reference: string): Promise<void>;
}>;

export type DashboardOperationRecoveryContext = Readonly<{
  operationId: OperationId;
  command: OperationCommand;
  domain: DashboardOperationDomain;
  domainRef: string | null;
  recoveryDeadline: string;
  session: DashboardControlPlaneSession;
}>;

export function bindDashboardOperationSession<T extends DashboardControlPlaneSession>(
  session: T,
  operation: DashboardOperationContext,
): Pick<T, 'view' | 'request'> {
  return Object.freeze({
    view: () => session.view(),
    async request(epoch, path, options = {}) {
      operation.signal.throwIfAborted();
      operation.beginCommit();
      return session.request(epoch, path, {
        ...options,
        signal: operation.signal,
      });
    },
  }) as Pick<T, 'view' | 'request'>;
}

export type DashboardOperationSubmit<R> = Readonly<{
  domain: DashboardOperationDomain;
  operationId?: OperationId;
  command: OperationCommand;
  expectedVersion?: number;
  scope?: unknown;
  intent: unknown;
  recoveryDeadline?: string;
  authorize?: (access: DashboardAccessView) => boolean;
  onReleaseInvalidation?: (value: DashboardReleaseInvalidation) => Promise<unknown>;
  onCancel?: () => Promise<void>;
  execute(context: DashboardOperationContext): Promise<DashboardDomainOutcome<R>>;
}>;

export type DashboardOperationRun<R> = Readonly<{
  view: DashboardOperationView;
  result: R | undefined;
  reused: boolean;
}>;

export type DashboardReleaseInvalidation = Readonly<{
  operationId: OperationId;
  domain: DashboardOperationDomain;
  sessionEpoch: number;
  releaseId: string;
}>;

export type DashboardStoredOperation = Readonly<{
  envelope: OperationEnvelope;
  status: OperationStatus;
  domain: DashboardOperationDomain;
  domainRef: string | null;
  invalidation: 'none' | 'pending' | 'emitted';
  releaseId: string | null;
}>;

export type DashboardOperationStore = Readonly<{
  read(): Promise<readonly DashboardStoredOperation[]>;
  write(records: readonly DashboardStoredOperation[]): Promise<void>;
}>;

export type DashboardControlPlaneOptions = Readonly<{
  session: DashboardControlPlaneSession;
  store: DashboardOperationStore;
  access?: DashboardAccessPort;
  releaseInvalidation?: (value: DashboardReleaseInvalidation) => Promise<unknown>;
  now?: () => number;
  createOperationId?: () => string;
}>;

type ActiveOperation = {
  readonly controller: AbortController;
  commitStarted: boolean;
};

type RecoveryHandler = (
  context: DashboardOperationRecoveryContext,
) => Promise<DashboardRecoveryOutcome>;

type ReceiptInput =
  | Readonly<{ kind: 'committed'; resultRef: string; committedAt?: string }>
  | Readonly<{ kind: 'failed'; failureCode: string; failedAt?: string }>
  | Readonly<{ kind: 'cancelled'; cancelledAt?: string }>
  | Readonly<{ kind: 'expired'; expiredAt?: string }>;

const STORE_VERSION = 1;
const DAY_MS = 86_400_000;
const CANCELLATION_WINDOW_MS = 300_000;
const TERMINAL = new Set<OperationState>(['committed', 'failed', 'cancelled', 'expired']);
const DOMAINS = new Set<string>(DASHBOARD_OPERATION_DOMAINS);
const SHARED_PLANES = new WeakMap<object, DashboardControlPlane>();
const RELEASE_INVALIDATION_LISTENERS = new Set<
  (value: DashboardReleaseInvalidation) => void
>();

function queueKey(domain: DashboardOperationDomain): string {
  return domain === 'release' || domain === 'rollback' ? 'release-write' : domain;
}

export function subscribeDashboardReleaseInvalidation(
  listener: (value: DashboardReleaseInvalidation) => void,
): () => void {
  RELEASE_INVALIDATION_LISTENERS.add(listener);
  return () => { RELEASE_INVALIDATION_LISTENERS.delete(listener); };
}

function emitDashboardReleaseInvalidation(value: DashboardReleaseInvalidation): void {
  for (const listener of RELEASE_INVALIDATION_LISTENERS) {
    try {
      listener(value);
    } catch {
      // Consumers own their recovery; one failed projection cannot undo a commit.
    }
  }
}

export class DashboardControlPlaneError extends Error {
  constructor(
    readonly code: DashboardControlPlaneErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DashboardControlPlaneError';
  }
}

export class DashboardOperationStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DashboardOperationStoreError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function iso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function cloneRecord(value: DashboardStoredOperation): DashboardStoredOperation {
  return structuredClone(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DashboardControlPlaneError('VALIDATION', '操作请求包含无效数字。');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const item = record(value);
  if (!item) throw new DashboardControlPlaneError('VALIDATION', '操作请求无法序列化。');
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function defaultRecoveryDeadline(now: number): string {
  return new Date(now + DAY_MS - 1_000).toISOString();
}

function parseAccess(value: unknown, sessionEpoch: number): DashboardAccessView {
  const item = record(value);
  if (!item || Object.keys(item).length !== 6) {
    throw new DashboardControlPlaneError('UNAVAILABLE', '权限版本暂时不可用。');
  }
  if ((item.state !== 'open' && item.state !== 'closed')
    || !Number.isSafeInteger(item.accessRevision)
    || (item.accessRevision as number) < 1
    || !iso(item.expiresAt)
    || (item.grants !== 'open' && item.grants !== 'closed')
    || (item.accounts !== 'open' && item.accounts !== 'closed')
    || (item.denyReason !== null && typeof item.denyReason !== 'string')) {
    throw new DashboardControlPlaneError('UNAVAILABLE', '权限版本暂时不可用。');
  }
  return Object.freeze({
    sessionEpoch,
    accessRevision: item.accessRevision as number,
    expiresAt: item.expiresAt,
    grants: item.grants,
    accounts: item.accounts,
    denyReason: item.denyReason,
  });
}

export function createDashboardAccessPort(
  session: DashboardControlPlaneSession,
): DashboardAccessPort {
  return {
    async read() {
      const before = session.view();
      if (!before.signedIn || !before.userId) {
        throw new DashboardControlPlaneError('UNAUTHORIZED', '请先登录。');
      }
      try {
        const response = await session.request(before.sessionEpoch, '/v1/access/settings', {
          method: 'GET',
          maxResponseBytes: 16_384,
        });
        const after = session.view();
        if (!after.signedIn || after.userId !== before.userId
          || after.sessionEpoch !== before.sessionEpoch) {
          throw new DashboardControlPlaneError('STALE', '会话已变化，请重新读取。');
        }
        return parseAccess(response.value, before.sessionEpoch);
      } catch (error) {
        if (error instanceof DashboardControlPlaneError) throw error;
        const code = record(error)?.code;
        if (code === 'UNAUTHORIZED') {
          throw new DashboardControlPlaneError('UNAUTHORIZED', '请先登录。');
        }
        if (code === 'STALE') {
          throw new DashboardControlPlaneError('STALE', '会话已变化，请重新读取。');
        }
        throw new DashboardControlPlaneError('UNAVAILABLE', '权限版本暂时不可用。');
      }
    },
  };
}

function parseStoredOperation(value: unknown): DashboardStoredOperation {
  const item = record(value);
  if (!item || Object.keys(item).length !== 6) {
    throw new DashboardOperationStoreError('DASHBOARD_OPERATION_STORE_INVALID');
  }
  let envelope: OperationEnvelope;
  let status: OperationStatus;
  try {
    envelope = parseOperationEnvelope(item.envelope);
    status = parseOperationStatus(item.status);
  } catch (error) {
    throw new DashboardOperationStoreError('DASHBOARD_OPERATION_STORE_INVALID', { cause: error });
  }
  if (envelope.operationId !== status.operationId
    || envelope.actor.userId !== status.userId
    || envelope.actor.sessionEpoch !== status.sessionEpoch
    || envelope.command !== status.command
    || envelope.recoveryDeadline !== status.recoveryDeadline
    || typeof item.domain !== 'string'
    || !DOMAINS.has(item.domain)
    || (item.domainRef !== null
      && (typeof item.domainRef !== 'string'
        || item.domainRef.length === 0
        || item.domainRef.length > 512))
    || !['none', 'pending', 'emitted'].includes(item.invalidation as string)
    || (item.releaseId !== null
      && (typeof item.releaseId !== 'string'
        || item.releaseId.length === 0
        || item.releaseId.length > 128))
    || (item.invalidation === 'none' && item.releaseId !== null)
    || (item.invalidation !== 'none'
      && (item.releaseId === null || status.state !== 'committed'))) {
    throw new DashboardOperationStoreError('DASHBOARD_OPERATION_STORE_INVALID');
  }
  return Object.freeze({
    envelope,
    status,
    domain: item.domain as DashboardOperationDomain,
    domainRef: item.domainRef,
    invalidation: item.invalidation as DashboardStoredOperation['invalidation'],
    releaseId: item.releaseId as string | null,
  });
}

export class MemoryDashboardOperationStore implements DashboardOperationStore {
  private records: DashboardStoredOperation[] = [];

  async read(): Promise<readonly DashboardStoredOperation[]> {
    return this.records.map(cloneRecord);
  }

  async write(records: readonly DashboardStoredOperation[]): Promise<void> {
    this.records = records.map(cloneRecord);
  }
}

export class FileDashboardOperationStore implements DashboardOperationStore {
  constructor(private readonly path: string) {}

  async read(): Promise<readonly DashboardStoredOperation[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if (record(error)?.code === 'ENOENT') return [];
      throw new DashboardOperationStoreError('DASHBOARD_OPERATION_STORE_UNREADABLE', { cause: error });
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new DashboardOperationStoreError('DASHBOARD_OPERATION_STORE_INVALID', { cause: error });
    }
    const item = record(value);
    if (!item || item.version !== STORE_VERSION || !Array.isArray(item.records)) {
      throw new DashboardOperationStoreError('DASHBOARD_OPERATION_STORE_INVALID');
    }
    return item.records.map(parseStoredOperation);
  }

  async write(records: readonly DashboardStoredOperation[]): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'w', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({
          version: STORE_VERSION,
          records,
        })}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
      const mode = (await stat(this.path)).mode & 0o777;
      if (mode !== 0o600) await chmod(this.path, 0o600);
      if (process.platform !== 'win32') {
        const directoryHandle = await open(directory, 'r');
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new DashboardOperationStoreError('DASHBOARD_OPERATION_STORE_WRITE_FAILED', { cause: error });
    }
  }
}

export class DashboardControlPlane {
  private readonly now: () => number;
  private readonly createOperationId: () => string;
  private readonly access: DashboardAccessPort;
  private releaseInvalidation?: (value: DashboardReleaseInvalidation) => Promise<unknown>;
  private readonly records = new Map<OperationId, DashboardStoredOperation>();
  private readonly active = new Map<OperationId, ActiveOperation>();
  private readonly executions = new Map<OperationId, Promise<DashboardOperationRun<unknown>>>();
  private readonly results = new Map<OperationId, unknown>();
  private readonly recoveryHandlers = new Map<DashboardOperationDomain, RecoveryHandler>();
  private readonly operationReleaseInvalidation = new Map<
    OperationId,
    (value: DashboardReleaseInvalidation) => Promise<unknown>
  >();
  private readonly operationCancel = new Map<OperationId, () => Promise<void>>();
  private readonly domainTails = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private readonly stopSession: (() => void) | null;
  private storeTail: Promise<void> = Promise.resolve();
  private loading: Promise<void> | null = null;

  constructor(private readonly options: DashboardControlPlaneOptions) {
    this.now = options.now ?? Date.now;
    this.createOperationId = options.createOperationId ?? randomUUID;
    this.access = options.access ?? createDashboardAccessPort(options.session);
    this.releaseInvalidation = options.releaseInvalidation;
    this.stopSession = options.session.subscribe?.(() => {
      this.emit();
    }) ?? null;
  }

  ready(): Promise<void> {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  currentSync(): readonly DashboardOperationView[] {
    const view = this.options.session.view();
    if (!view.signedIn || !view.userId) return [];
    return [...this.records.values()]
      .filter((entry) => entry.status.userId === view.userId)
      .sort((left, right) => Date.parse(right.status.updatedAt) - Date.parse(left.status.updatedAt))
      .slice(0, 40)
      .map((entry) => this.project(entry));
  }

  async current(): Promise<readonly DashboardOperationView[]> {
    await this.ready();
    await this.retryPendingReleaseInvalidations().catch(() => undefined);
    return this.currentSync();
  }

  registerRecovery(domain: DashboardOperationDomain, handler: RecoveryHandler): void {
    this.recoveryHandlers.set(domain, handler);
  }

  setReleaseInvalidation(
    handler: ((value: DashboardReleaseInvalidation) => Promise<unknown>) | undefined,
  ): void {
    this.releaseInvalidation = handler;
  }

  async submit<R>(input: DashboardOperationSubmit<R>): Promise<DashboardOperationRun<R>> {
    await this.ready();
    const view = this.requireSession();
    const permission = await this.access.read();
    if (permission.sessionEpoch !== view.sessionEpoch) {
      throw new DashboardControlPlaneError('STALE', '会话已变化，请重新读取。');
    }
    if (Date.parse(permission.expiresAt) <= this.now()) {
      throw new DashboardControlPlaneError('FORBIDDEN', '权限已到期，请重新读取。');
    }
    if (input.authorize && !input.authorize(permission)) {
      throw new DashboardControlPlaneError('FORBIDDEN', '当前身份不能执行此操作。');
    }
    const now = this.now();
    const requestHash = hash({
      domain: input.domain,
      command: input.command,
      expectedVersion: input.expectedVersion ?? 0,
      scope: input.scope ?? null,
      intent: input.intent,
    });
    const idempotencyKey = hash({
      userId: view.userId,
      sessionEpoch: view.sessionEpoch,
      domain: input.domain,
      command: input.command,
      requestHash,
    });
    const byKey = [...this.records.values()]
      .filter((entry) => (
        entry.envelope.idempotencyKey === idempotencyKey
        && entry.envelope.actor.userId === view.userId
        && entry.envelope.requestHash === requestHash
        && entry.envelope.command === input.command
      ))
      .sort((left, right) => Date.parse(right.status.updatedAt) - Date.parse(left.status.updatedAt))[0];
    const existing = input.operationId
      ? this.records.get(input.operationId)
      : undefined;
    const currentEpochCandidate = byKey
      && byKey.status.state !== 'cancelled'
      && byKey.status.state !== 'failed'
      && byKey.status.state !== 'expired'
      ? byKey
      : undefined;
    if (!existing && !currentEpochCandidate) {
      const priorEpochCandidate = [...this.records.values()].find((entry) => (
        entry.envelope.actor.userId === view.userId
        && entry.domain === input.domain
        && entry.envelope.command === input.command
        && entry.envelope.requestHash === requestHash
        && entry.envelope.actor.sessionEpoch !== view.sessionEpoch
        && !TERMINAL.has(entry.status.state)
      ));
      if (priorEpochCandidate) {
        throw new DashboardControlPlaneError('STALE', '请先确认上一会话的原操作结果。');
      }
    }
    const candidate = existing ?? currentEpochCandidate;
    const operationId = (candidate?.status.operationId
      ?? input.operationId
      ?? this.createOperationId()) as OperationId;
    const recoveryDeadline = input.recoveryDeadline
      ?? candidate?.status.recoveryDeadline
      ?? defaultRecoveryDeadline(now);
    let envelope: OperationEnvelope;
    try {
      envelope = parseOperationEnvelope({
        operationId,
        actor: {
          userId: view.userId,
          sessionEpoch: view.sessionEpoch,
        },
        command: input.command,
        requestHash,
        idempotencyKey,
        expectedVersion: input.expectedVersion ?? 0,
        accessRevision: permission.accessRevision,
        cancellation: candidate?.envelope.cancellation ?? {
          mode: 'before-commit',
          deadline: new Date(now + CANCELLATION_WINDOW_MS).toISOString(),
        },
        createdAt: candidate?.envelope.createdAt ?? new Date(now).toISOString(),
        recoveryDeadline,
      });
    } catch (error) {
      throw new DashboardControlPlaneError('VALIDATION', error instanceof Error ? error.message : '操作输入无效。');
    }

    if (candidate) {
      const reuse = classifyOperationReuse(candidate.envelope, envelope);
      if (reuse === 'conflict') {
        throw new DashboardControlPlaneError('CONFLICT', '操作标识与请求不一致。');
      }
      if (reuse === 'stale-session') {
        throw new DashboardControlPlaneError('STALE', '会话已变化，请重新操作。');
      }
      if (reuse === 'replay') {
        const execution = this.executions.get(operationId);
        if (execution) return await execution as DashboardOperationRun<R>;
        return {
          view: this.project(candidate),
          result: this.results.get(operationId) as R | undefined,
          reused: true,
        };
      }
    }

    const status = this.makeStatus({
      operationId,
      userId: view.userId,
      sessionEpoch: view.sessionEpoch,
      command: input.command,
      state: 'accepted',
      updatedAt: new Date(now).toISOString(),
      recoveryDeadline,
      receipt: null,
    });
    const record: DashboardStoredOperation = {
      envelope,
      status,
      domain: input.domain,
      domainRef: null,
      invalidation: 'none',
      releaseId: null,
    };
    this.records.set(operationId, record);
    await this.persist();
    this.emit();

    const execution = this.execute(input, record) as Promise<DashboardOperationRun<unknown>>;
    if (input.onReleaseInvalidation) {
      this.operationReleaseInvalidation.set(operationId, input.onReleaseInvalidation);
    }
    if (input.onCancel) this.operationCancel.set(operationId, input.onCancel);
    this.executions.set(operationId, execution);
    try {
      return await execution as DashboardOperationRun<R>;
    } finally {
      this.executions.delete(operationId);
      this.operationCancel.delete(operationId);
    }
  }

  async cancel(domain: DashboardOperationDomain): Promise<DashboardOperationView | null> {
    await this.ready();
    const view = this.options.session.view();
    const candidates = [...this.records.values()]
      .filter((entry) => entry.domain === domain
        && entry.status.userId === view.userId
        && (entry.status.state === 'accepted' || entry.status.state === 'running'))
      .sort((left, right) => Date.parse(right.status.updatedAt) - Date.parse(left.status.updatedAt));
    const candidate = candidates.find((entry) => entry.status.state === 'accepted') ?? candidates[0];
    if (!candidate) return null;
    const active = this.active.get(candidate.status.operationId);
    if (candidate.status.state === 'accepted') {
      const cancelled = await this.transition(candidate, 'cancelled', { kind: 'cancelled' });
      active?.controller.abort();
      return this.project(cancelled);
    }
    if (active?.commitStarted) return this.project(candidate);
    active?.controller.abort();
    await this.operationCancel.get(candidate.status.operationId)?.().catch(() => undefined);
    return this.project(candidate);
  }

  async recover(domain: DashboardOperationDomain): Promise<DashboardOperationView | null> {
    await this.ready();
    await this.retryPendingReleaseInvalidations();
    const view = this.options.session.view();
    if (!view.signedIn || !view.userId) {
      throw new DashboardControlPlaneError('UNAUTHORIZED', '请先登录。');
    }
    const pendingInvalidation = [...this.records.values()]
      .filter((entry) => entry.domain === domain
        && entry.status.userId === view.userId
        && entry.status.state === 'committed'
        && entry.invalidation === 'pending')
      .sort((left, right) => Date.parse(right.status.updatedAt) - Date.parse(left.status.updatedAt))[0];
    if (pendingInvalidation) return this.project(pendingInvalidation);
    const candidate = [...this.records.values()]
      .filter((entry) => entry.domain === domain
        && entry.status.userId === view.userId
        && entry.status.state === 'unknown')
      .sort((left, right) => Date.parse(right.status.updatedAt) - Date.parse(left.status.updatedAt))[0];
    if (!candidate) return null;
    const handler = this.recoveryHandlers.get(domain);
    if (!handler) return this.project(candidate);
    let outcome: DashboardRecoveryOutcome;
    try {
      outcome = await handler({
        operationId: candidate.status.operationId,
        command: candidate.status.command,
        domain,
        domainRef: candidate.domainRef,
        recoveryDeadline: candidate.status.recoveryDeadline,
        session: this.options.session,
      });
    } catch {
      outcome = { kind: 'unknown' };
    }
    if (outcome.kind === 'unknown' || outcome.kind === 'not-found') {
      if (outcome.kind === 'not-found' && this.now() >= Date.parse(candidate.status.recoveryDeadline)) {
        return this.project(await this.transition(candidate, 'expired', { kind: 'expired' }));
      }
      return this.project(candidate);
    }
    if (outcome.kind === 'committed') {
      const next = await this.transition(candidate, 'committed', {
        kind: 'committed',
        resultRef: outcome.resultRef,
      }, outcome.releaseId);
      await this.tryReleaseInvalidation(next);
      return this.project(this.records.get(next.status.operationId) ?? next);
    }
    if (outcome.kind === 'failed') {
      return this.project(await this.transition(candidate, 'failed', {
        kind: 'failed',
        failureCode: outcome.failureCode,
      }));
    }
    return this.project(await this.transition(candidate, 'cancelled', { kind: 'cancelled' }));
  }

  async retryReleaseInvalidation(operationId: string): Promise<DashboardOperationView | null> {
    await this.ready();
    const record = this.records.get(operationId as OperationId);
    if (!record) return null;
    await this.tryReleaseInvalidation(record);
    return this.project(this.records.get(record.status.operationId) ?? record);
  }

  replaceResult(operationId: string, result: unknown): void {
    this.results.set(operationId as OperationId, result);
  }

  dispose(): void {
    this.stopSession?.();
    for (const active of this.active.values()) active.controller.abort();
    this.listeners.clear();
  }

  private async execute<R>(
    input: DashboardOperationSubmit<R>,
    initial: DashboardStoredOperation,
  ): Promise<DashboardOperationRun<R>> {
    const key = queueKey(input.domain);
    const previous = this.domainTails.get(key) ?? Promise.resolve();
    let releaseTail!: () => void;
    const tail = new Promise<void>((resolve) => { releaseTail = resolve; });
    const queuedTail = previous.then(() => tail);
    this.domainTails.set(key, queuedTail);
    try {
      await previous.catch(() => undefined);
      let current = this.records.get(initial.status.operationId) ?? initial;
      if (current.status.state === 'cancelled') {
        return { view: this.project(current), result: undefined, reused: false };
      }
      const controller = new AbortController();
      let commitStarted = false;
      const active: ActiveOperation = {
        controller,
        commitStarted: false,
      };
      this.active.set(current.status.operationId, active);
      try {
        current = await this.transition(current, 'running');
      } catch (error) {
        this.active.delete(current.status.operationId);
        throw error;
      }
      const execution = Promise.resolve().then(() => input.execute({
        operationId: current.status.operationId,
        signal: controller.signal,
        beginCommit: () => {
          commitStarted = true;
          const active = this.active.get(current.status.operationId);
          if (active) active.commitStarted = true;
        },
        noteDomainRef: async (reference: string) => {
          const live = this.records.get(current.status.operationId);
          if (!live || !reference) return;
          this.records.set(live.status.operationId, { ...live, domainRef: reference });
          await this.persist();
        },
      }));
      let outcome: DashboardDomainOutcome<R>;
      try {
        outcome = await execution;
      } catch {
        outcome = controller.signal.aborted && !commitStarted
          ? { kind: 'cancelled' }
          : { kind: 'unknown' };
      } finally {
        this.active.delete(current.status.operationId);
      }
      if (controller.signal.aborted && outcome.kind === 'failed' && !commitStarted) {
        outcome = { kind: 'cancelled' };
      }
      if (outcome.result !== undefined) {
        this.results.set(current.status.operationId, outcome.result);
      }
      if (outcome.kind === 'committed') {
        current = await this.transition(current, 'committed', {
          kind: 'committed',
          resultRef: outcome.resultRef,
        }, outcome.releaseId);
        await this.tryReleaseInvalidation(current);
      } else if (outcome.kind === 'failed') {
        if (controller.signal.aborted && !commitStarted) {
          current = await this.transition(current, 'cancelled', { kind: 'cancelled' });
        } else {
          current = await this.transition(current, 'failed', {
            kind: 'failed',
            failureCode: outcome.failureCode,
          });
        }
      } else if (outcome.kind === 'cancelled') {
        current = await this.transition(current, 'cancelled', { kind: 'cancelled' });
      } else if (outcome.kind === 'expired') {
        current = await this.transition(current, 'expired', { kind: 'expired' });
      } else {
        if (outcome.domainRef) {
          current = { ...current, domainRef: outcome.domainRef };
        }
        current = await this.transition(current, 'unknown');
      }
      return {
        view: this.project(this.records.get(current.status.operationId) ?? current),
        result: outcome.result,
        reused: false,
      };
    } finally {
      releaseTail();
      if (this.domainTails.get(key) === queuedTail) this.domainTails.delete(key);
    }
  }

  private async load(): Promise<void> {
    let records: readonly DashboardStoredOperation[];
    try {
      records = await this.options.store.read();
    } catch (error) {
      if (error instanceof DashboardOperationStoreError) throw error;
      throw new DashboardOperationStoreError('DASHBOARD_OPERATION_STORE_UNREADABLE', { cause: error });
    }
    let reconciled = false;
    for (const operation of records) {
      if (this.records.has(operation.status.operationId)) continue;
      if ((operation.status.state === 'accepted' || operation.status.state === 'running')
        && !this.active.has(operation.status.operationId)) {
        const recoveredAt = Math.min(
          this.now(),
          Date.parse(operation.status.recoveryDeadline),
        );
        const unknown = this.makeStatus({
          operationId: operation.status.operationId,
          userId: operation.status.userId,
          sessionEpoch: operation.status.sessionEpoch,
          command: operation.status.command,
          state: 'unknown',
          updatedAt: new Date(recoveredAt).toISOString(),
          recoveryDeadline: operation.status.recoveryDeadline,
          receipt: null,
        });
        this.records.set(unknown.operationId, { ...operation, status: unknown });
        reconciled = true;
      } else {
        this.records.set(operation.status.operationId, operation);
      }
    }
    if (reconciled) await this.persist();
  }

  private requireSession(): Readonly<{
    userId: string;
    sessionEpoch: number;
  }> {
    const view = this.options.session.view();
    if (!view.ok || !view.enabled || !view.signedIn || !view.userId) {
      throw new DashboardControlPlaneError('UNAUTHORIZED', '请先登录。');
    }
    return {
      userId: view.userId,
      sessionEpoch: view.sessionEpoch,
    };
  }

  private makeStatus(input: {
    operationId: OperationId;
    userId: string;
    sessionEpoch: number;
    command: OperationCommand;
    state: OperationState;
    updatedAt: string;
    recoveryDeadline: string;
    receipt: OperationStatus['receipt'];
  }): OperationStatus {
    try {
      return parseOperationStatus(input);
    } catch (error) {
      throw new DashboardControlPlaneError('VALIDATION', error instanceof Error ? error.message : '操作状态无效。');
    }
  }

  private async transition(
    operation: DashboardStoredOperation,
    next: OperationState,
    receipt?: ReceiptInput | null,
    releaseId?: string,
  ): Promise<DashboardStoredOperation> {
    if (!OPERATION_TRANSITIONS[operation.status.state].includes(next as never)) {
      throw new DashboardControlPlaneError('CONFLICT', '操作状态不能后退或重写。');
    }
    const updatedAt = next === 'expired'
      ? operation.status.recoveryDeadline
      : new Date(this.now()).toISOString();
    const stampedReceipt: OperationReceipt | null = receipt === undefined || receipt === null
      ? null
      : receipt.kind === 'committed'
        ? { kind: 'committed', resultRef: receipt.resultRef, committedAt: receipt.committedAt ?? updatedAt }
        : receipt.kind === 'failed'
          ? { kind: 'failed', failureCode: receipt.failureCode, failedAt: receipt.failedAt ?? updatedAt }
          : receipt.kind === 'cancelled'
            ? { kind: 'cancelled', cancelledAt: receipt.cancelledAt ?? updatedAt }
            : { kind: 'expired', expiredAt: receipt.expiredAt ?? updatedAt };
    const status = this.makeStatus({
      operationId: operation.status.operationId,
      userId: operation.status.userId,
      sessionEpoch: operation.status.sessionEpoch,
      command: operation.status.command,
      state: next,
      updatedAt,
      recoveryDeadline: operation.status.recoveryDeadline,
      receipt: stampedReceipt ?? null,
    });
    const nextRecord: DashboardStoredOperation = {
      ...operation,
      status,
      releaseId: releaseId ?? operation.releaseId,
      invalidation: releaseId
        ? 'pending'
        : operation.invalidation,
    };
    this.records.set(status.operationId, nextRecord);
    await this.persist();
    this.emit();
    return nextRecord;
  }

  private async tryReleaseInvalidation(operation: DashboardStoredOperation): Promise<void> {
    if (!operation.releaseId || operation.invalidation !== 'pending') return;
    const handler = this.operationReleaseInvalidation.get(operation.status.operationId)
      ?? this.releaseInvalidation;
    if (handler) {
      try {
        await handler({
          operationId: operation.status.operationId,
          domain: operation.domain,
          sessionEpoch: operation.status.sessionEpoch,
          releaseId: operation.releaseId,
        });
      } catch {
        return;
      }
    }
    emitDashboardReleaseInvalidation({
      operationId: operation.status.operationId,
      domain: operation.domain,
      sessionEpoch: operation.status.sessionEpoch,
      releaseId: operation.releaseId,
    });
    const current = this.records.get(operation.status.operationId);
    if (!current) return;
    this.records.set(current.status.operationId, { ...current, invalidation: 'emitted' });
    this.operationReleaseInvalidation.delete(current.status.operationId);
    await this.persist();
    this.emit();
  }

  private async retryPendingReleaseInvalidations(): Promise<void> {
    for (const operation of this.records.values()) {
      if (operation.invalidation === 'pending') await this.tryReleaseInvalidation(operation);
    }
  }

  private async persist(): Promise<void> {
    const snapshot = [...this.records.values()];
    this.storeTail = this.storeTail.then(() => this.options.store.write(snapshot));
    await this.storeTail;
  }

  private project(operation: DashboardStoredOperation): DashboardOperationView {
    return Object.freeze({
      domain: operation.domain,
      operationId: operation.status.operationId,
      command: operation.status.command,
      state: operation.status.state,
      updatedAt: operation.status.updatedAt,
      recoveryDeadline: operation.status.recoveryDeadline,
      canCancel: operation.status.state === 'accepted'
        || (operation.status.state === 'running'
          && this.active.get(operation.status.operationId)?.commitStarted !== true),
      canRecover: operation.status.state === 'unknown',
      releaseInvalidationPending: operation.invalidation === 'pending',
    });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function isDashboardOperationTerminal(state: OperationState): boolean {
  return TERMINAL.has(state);
}

export function sharedDashboardControlPlane(
  key: object,
  create: () => DashboardControlPlane,
): DashboardControlPlane {
  const existing = SHARED_PLANES.get(key);
  if (existing) return existing;
  const created = create();
  SHARED_PLANES.set(key, created);
  return created;
}

export function dashboardControlPlaneForSession(
  session: object,
  userDataDirectory: string | null,
): DashboardControlPlane {
  return sharedDashboardControlPlane(session, () => new DashboardControlPlane({
    session: session as DashboardControlPlaneSession,
    store: userDataDirectory
      ? new FileDashboardOperationStore(join(userDataDirectory, 'dashboard-operations.json'))
      : new MemoryDashboardOperationStore(),
  }));
}
