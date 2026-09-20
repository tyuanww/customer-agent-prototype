import { exactKeys, PRODUCT_ERRORS, type ProductErrorCode } from './product-session';

/** Frozen OpenAPI IterationTask.task_id is minLength 1 / maxLength 128 with no charset. */
export const ITERATION_TASK_ID = /^[\s\S]{1,128}$/;

export const ITERATION_COPY = Object.freeze({
  unavailable: '服务暂不可用',
  empty: '当前没有待办',
  noProduct: '当前没有产品会话，无法加载待办',
  noSession: '请先登录后再查看待办',
  agent: '坐席不能查看或处理话术优化待办',
  conflict: '待办已更新，请刷新后再处理',
  missing: '指定待办不存在',
});

const ITERATION_FAILURE_CODES = [
  'UNAUTHORIZED',
  'VALIDATION',
  'FORBIDDEN',
  'GONE',
  'CONFLICT',
  'UNAVAILABLE',
  'OVERLOADED',
  'RATE_LIMITED',
  'CANCELLED',
  'STALE',
] as const satisfies readonly ProductErrorCode[];

export type DashboardIterationFailureCode = (typeof ITERATION_FAILURE_CODES)[number];

export type DashboardIterationStatus = 'open' | 'in_progress' | 'resolved' | 'wont_fix';
export type DashboardIterationCause = 'content_gap' | 'ranking' | 'stale' | 'mixed';
export type DashboardIterationResolution = 'resolved' | 'wont_fix';

export type DashboardIterationTask = Readonly<{
  taskId: string;
  signalId: string;
  clusterKey: string;
  sampleQueryIds: readonly string[];
  suspectedCause: DashboardIterationCause;
  suggestedScriptIds: readonly string[];
  status: DashboardIterationStatus;
  assigneeRole: string | null;
  resolution: DashboardIterationResolution | null;
  resolutionNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}>;

export type DashboardIterationFailure = Readonly<{
  ok: false;
  code: DashboardIterationFailureCode;
  message: string;
}>;

export type DashboardIterationListView = Readonly<{
  ok: true;
  items: readonly DashboardIterationTask[];
  nextCursor: string | null;
}>;

export type DashboardIterationTaskView = Readonly<{
  ok: true;
  task: DashboardIterationTask;
}>;

export type DashboardIterationListResult = DashboardIterationListView | DashboardIterationFailure;
export type DashboardIterationTaskResult = DashboardIterationTaskView | DashboardIterationFailure;

export type DashboardIterationStartRequest = Readonly<{
  taskId: string;
  expectedVersion: number;
}>;

export type DashboardIterationCloseRequest = Readonly<{
  taskId: string;
  expectedVersion: number;
  status: DashboardIterationResolution;
  resolutionNote: string;
}>;

export type DashboardIterationApi = {
  list(): Promise<DashboardIterationListResult>;
  start(request: DashboardIterationStartRequest): Promise<DashboardIterationTaskResult>;
  close(request: DashboardIterationCloseRequest): Promise<DashboardIterationTaskResult>;
};

const TASK_KEYS = [
  'assigneeRole',
  'clusterKey',
  'createdAt',
  'resolution',
  'resolutionNote',
  'resolvedAt',
  'sampleQueryIds',
  'signalId',
  'status',
  'suggestedScriptIds',
  'suspectedCause',
  'taskId',
  'updatedAt',
  'version',
] as const;

export function dashboardIterationFailure(
  code: DashboardIterationFailureCode,
  message?: string,
): DashboardIterationFailure {
  return Object.freeze({
    ok: false,
    code,
    message: message ?? (code === 'UNAVAILABLE' || code === 'OVERLOADED'
      ? ITERATION_COPY.unavailable
      : PRODUCT_ERRORS[code]),
  });
}

function isFailureCode(value: unknown): value is DashboardIterationFailureCode {
  return typeof value === 'string'
    && (ITERATION_FAILURE_CODES as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is DashboardIterationStatus {
  return value === 'open' || value === 'in_progress' || value === 'resolved' || value === 'wont_fix';
}

function isCause(value: unknown): value is DashboardIterationCause {
  return value === 'content_gap' || value === 'ranking' || value === 'stale' || value === 'mixed';
}

function isResolution(value: unknown): value is DashboardIterationResolution {
  return value === 'resolved' || value === 'wont_fix';
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

function isIdList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > 50) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length < 1 || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function isTaskId(value: unknown): value is string {
  return typeof value === 'string' && ITERATION_TASK_ID.test(value);
}

export function isDashboardIterationFailure(value: unknown): value is DashboardIterationFailure {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['ok', 'code', 'message'])
    && record.ok === false
    && isFailureCode(record.code)
    && typeof record.message === 'string'
    && record.message.length > 0
    && record.message.length <= 200;
}

export function isDashboardIterationTask(value: unknown): value is DashboardIterationTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, TASK_KEYS)) return false;
  if (!isTaskId(record.taskId) || typeof record.signalId !== 'string' || record.signalId.length < 1
    || record.signalId.length > 128 || typeof record.clusterKey !== 'string'
    || record.clusterKey.length < 1 || record.clusterKey.length > 512) {
    return false;
  }
  if (!isIdList(record.sampleQueryIds) || !isCause(record.suspectedCause)
    || !isIdList(record.suggestedScriptIds) || !isStatus(record.status)) {
    return false;
  }
  if (!(record.assigneeRole === null
    || (typeof record.assigneeRole === 'string' && record.assigneeRole.length >= 1
      && record.assigneeRole.length <= 128))) {
    return false;
  }
  if (!(record.resolution === null || isResolution(record.resolution))) return false;
  if (!(record.resolutionNote === null
    || (typeof record.resolutionNote === 'string' && record.resolutionNote.length >= 1
      && record.resolutionNote.length <= 2000))) {
    return false;
  }
  if (!Number.isSafeInteger(record.version) || (record.version as number) < 1) return false;
  if (!isIsoTimestamp(record.createdAt) || !isIsoTimestamp(record.updatedAt)) return false;
  if (!(record.resolvedAt === null || isIsoTimestamp(record.resolvedAt))) return false;
  return true;
}

export function isDashboardIterationListResult(value: unknown): value is DashboardIterationListResult {
  if (isDashboardIterationFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || !exactKeys(record, ['ok', 'items', 'nextCursor'])) return false;
  if (!(record.nextCursor === null
    || (typeof record.nextCursor === 'string' && record.nextCursor.length >= 1))) {
    return false;
  }
  return Array.isArray(record.items) && record.items.every(isDashboardIterationTask);
}

export function isDashboardIterationTaskResult(value: unknown): value is DashboardIterationTaskResult {
  if (isDashboardIterationFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.ok === true
    && exactKeys(record, ['ok', 'task'])
    && isDashboardIterationTask(record.task);
}

export function isDashboardIterationStartRequest(value: unknown): value is DashboardIterationStartRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['taskId', 'expectedVersion'])
    && isTaskId(record.taskId)
    && Number.isSafeInteger(record.expectedVersion)
    && (record.expectedVersion as number) >= 1;
}

export function isDashboardIterationCloseRequest(value: unknown): value is DashboardIterationCloseRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['expectedVersion', 'resolutionNote', 'status', 'taskId'])
    && isTaskId(record.taskId)
    && Number.isSafeInteger(record.expectedVersion)
    && (record.expectedVersion as number) >= 1
    && isResolution(record.status)
    && typeof record.resolutionNote === 'string'
    && record.resolutionNote.length >= 1
    && record.resolutionNote.length <= 2000;
}

function asIdList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length < 1 || seen.has(entry)) return null;
    seen.add(entry);
    items.push(entry);
  }
  return items;
}

/** Map a frozen OpenAPI IterationTask object into the desktop IPC shape. */
export function iterationTaskFromContract(value: unknown): DashboardIterationTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sampleQueryIds = asIdList(record.sample_query_ids);
  const suggestedScriptIds = asIdList(record.suggested_script_ids);
  if (sampleQueryIds === null || suggestedScriptIds === null) return null;
  const mapped = {
    taskId: record.task_id,
    signalId: record.signal_id,
    clusterKey: record.cluster_key,
    sampleQueryIds,
    suspectedCause: record.suspected_cause,
    suggestedScriptIds,
    status: record.status,
    assigneeRole: record.assignee_role ?? null,
    resolution: record.resolution ?? null,
    resolutionNote: record.resolution_note ?? null,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    resolvedAt: record.resolved_at ?? null,
  };
  return isDashboardIterationTask(mapped) ? mapped : null;
}

export function iterationListFromContract(value: unknown): DashboardIterationListView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items)) return null;
  if (!(record.next_cursor === null
    || (typeof record.next_cursor === 'string' && record.next_cursor.length >= 1))) {
    return null;
  }
  const items: DashboardIterationTask[] = [];
  for (const item of record.items) {
    const mapped = iterationTaskFromContract(item);
    if (!mapped) return null;
    items.push(mapped);
  }
  return Object.freeze({ ok: true, items: Object.freeze(items), nextCursor: record.next_cursor });
}
