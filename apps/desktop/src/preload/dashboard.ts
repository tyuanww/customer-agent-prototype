import type { IntakeCatalogApi, IntakeCatalogCommand } from '../shared/content-intake-catalog';
import type { IntakePermissionApi, IntakePermissionCommand } from '../shared/content-intake-permissions';
import { isPageUseSnapshot, type PageUseApi, type PageUseSnapshot } from '../shared/page-use';
import type { SeatAccountApi, SeatAccountIntent } from '../shared/seat-account-intent';
import type { IntakeManagementApi, IntakeManagementCommand } from '../shared/content-intake-management';
import type { DeskCommand, DeskKnowledgeApi } from '../shared/desk-knowledge';
import { contextBridge, ipcRenderer } from 'electron';

// Keep these literals aligned with IPC_CHANNELS. Do not import shared modules:
// a second preload entry that shares overlay session helpers would split a
// chunk the Windows sandbox cannot load, and Query stays parked.
const LIST = 'dashboard:wording-list';
const CONTENT_SESSION = 'dashboard:content-session';
const CONTENT_PARSE = 'dashboard:content-parse';
const CONTENT_PUBLISH = 'dashboard:content-publish';
const CONTENT_ROLLBACK_PREVIOUS = 'dashboard:content-rollback-previous';
const CONTENT_CANCEL_IN_FLIGHT = 'dashboard:content-cancel-in-flight';
const ITERATION_LIST = 'dashboard:iteration-list';
const ITERATION_START = 'dashboard:iteration-start';
const ITERATION_CLOSE = 'dashboard:iteration-close';
const INACCURACY_OUTCOMES = 'dashboard:inaccuracy-outcomes';
const OPS_RETRIEVAL = 'dashboard:ops-retrieval';
const OPS_SOP_CATALOG = 'dashboard:ops-sop-catalog';
const OPS_SOP_IMPORT = 'dashboard:ops-sop-import';
const OPS_SOP_PATCH = 'dashboard:ops-sop-patch';
const OPS_SOP_DELETE = 'dashboard:ops-sop-delete';
const OPS_SCRIPT_DELETE = 'dashboard:ops-script-delete';
const OPS_SOFTWARE = 'dashboard:ops-software';
const OPS_SOFTWARE_OPEN = 'dashboard:ops-software-open';
const PRODUCT_SESSION_CHANGED = 'product:session-changed';
const PAGE_USE_CURRENT = 'dashboard:page-use-current';
const PAGE_USE_CHANGED = 'dashboard:page-use-changed';

const CONTENT_FAILURE_CODES = [
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
] as const;

function exactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function isWordingList(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).length === 2
      && (record.code === 'FORBIDDEN' || record.code === 'VALIDATION' || record.code === 'UNAVAILABLE');
  }
  return record.ok === true
    && Object.keys(record).length === 6
    && (record.releaseId === null || typeof record.releaseId === 'string')
    && (record.catalogRefreshedAt === null || typeof record.catalogRefreshedAt === 'string')
    && typeof record.matchesLease === 'boolean'
    && Number.isSafeInteger(record.total)
    && (record.total as number) >= 0
    && Array.isArray(record.entries)
    && record.entries.length === record.total;
}

function isContentFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['ok', 'code', 'message'])
    && record.ok === false
    && typeof record.code === 'string'
    && (CONTENT_FAILURE_CODES as readonly string[]).includes(record.code)
    && typeof record.message === 'string'
    && record.message.length > 0
    && record.message.length <= 200;
}

function isContentSession(value: unknown): boolean {
  if (isContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || !exactKeys(record, ['ok', 'enabled', 'signedIn', 'role', 'displayName', 'job'])) return false;
  if (typeof record.enabled !== 'boolean' || typeof record.signedIn !== 'boolean' || !isContentJob(record.job)) return false;
  if (record.displayName !== null && (typeof record.displayName !== 'string'
    || record.displayName.length < 1 || record.displayName.length > 64)) return false;
  if (record.signedIn) {
    return record.enabled === true
      && (record.role === 'agent' || record.role === 'coach' || record.role === 'owner')
      && typeof record.displayName === 'string';
  }
  return record.role === null && record.displayName === null && record.job === null;
}

const JOB_RIGHTS: Readonly<Record<string, readonly [boolean, boolean, boolean, boolean, boolean]>> = {
  客服总监: [true, true, true, true, true],
  客服经理: [true, true, true, true, true],
  客服主管: [true, false, true, true, true],
  客服组长: [true, false, true, true, true],
  AI赋能工程师: [true, true, true, true, true],
  普通客服: [false, false, false, true, true],
  客服坐席: [false, false, false, true, true],
};

function isContentJob(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as Record<string, unknown>;
  const rights = job.rights;
  if (!rights || typeof rights !== 'object' || Array.isArray(rights)) return false;
  const row = rights as Record<string, unknown>;
  if (!exactKeys(row, ['publish', 'grant', 'uploadSop', 'search', 'readCatalog'])) return false;
  const flags = [row.publish, row.grant, row.uploadSop, row.search, row.readCatalog];
  if (!flags.every((flag) => typeof flag === 'boolean')) return false;
  const actions = job.actions;
  if (!actions || typeof actions !== 'object' || Array.isArray(actions)) return false;
  if (!exactKeys(actions, ['query', 'import', 'publish', 'rollback'])) return false;
  const bits = actions as Record<string, unknown>;
  if (![bits.query, bits.import, bits.publish, bits.rollback].every((flag) => typeof flag === 'boolean')) return false;
  if (job.permission !== null && (typeof job.permission !== 'string'
    || !['unknown', 'pending', 'ready', 'denied', 'expired', 'revoked'].includes(job.permission))) return false;
  const noticeFor = job.permission === 'expired'
    ? '资料资格过期了，请稍后重试。'
    : job.permission === 'pending'
      ? '资料尚未发布，暂时没有可查询内容。发布后重新登录即可。'
      : job.permission === 'ready' || job.permission === 'unknown' || job.permission === null
        ? null
        : '没有权限，请找人开通。';
  if (job.notice !== noticeFor) return false;
  if (job.status === 'unresolved') {
    return exactKeys(job, ['status', 'reason', 'label', 'rights', 'permission', 'notice', 'actions'])
      && (job.reason === 'blank' || job.reason === 'unknown' || job.reason === 'duplicate' || job.reason === 'missing')
      && job.label === '职务未识别'
      && flags.every((flag) => flag === false)
      && bits.query === false && bits.import === false && bits.publish === false && bits.rollback === false;
  }
  if (job.status !== 'resolved' || !exactKeys(job, ['status', 'title', 'role', 'label', 'rights', 'permission', 'notice', 'actions'])) return false;
  if (typeof job.title !== 'string' || job.label !== job.title) return false;
  const expected = JOB_RIGHTS[job.title];
  return expected !== undefined
    && flags[0] === bits.publish
    && flags[1] === expected[1]
    && flags[2] === expected[2]
    && flags[3] === bits.query
    && flags[4] === (expected[4] && bits.query);
}

function isContentPublish(value: unknown): boolean {
  if (isContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['ok', 'releaseId', 'releaseSeq', 'publisherDisplayName', 'summary'])
    && record.ok === true
    && typeof record.releaseId === 'string'
    && record.releaseId.length > 0
    && record.releaseId.length <= 128
    && Number.isSafeInteger(record.releaseSeq)
    && (record.releaseSeq as number) >= 1
    && (record.publisherDisplayName === null
      || (typeof record.publisherDisplayName === 'string'
        && record.publisherDisplayName.length > 0
        && record.publisherDisplayName.length <= 64))
    && (record.summary === null
      || (typeof record.summary === 'string' && record.summary.length > 0 && record.summary.length <= 500));
}

const ITERATION_CAUSES = ['content_gap', 'ranking', 'stale', 'mixed'] as const;
const ITERATION_STATUSES = ['open', 'in_progress', 'resolved', 'wont_fix'] as const;
const ITERATION_TASK_KEYS = [
  'assigneeRole', 'clusterKey', 'createdAt', 'resolution', 'resolutionNote', 'resolvedAt',
  'sampleQueryIds', 'signalId', 'status', 'suggestedScriptIds', 'suspectedCause', 'taskId',
  'updatedAt', 'version',
] as const;

function isIsoTimestamp(value: unknown): boolean {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

function isIdList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 50) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length < 1 || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function isIterationTask(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ITERATION_TASK_KEYS)) return false;
  if (typeof record.taskId !== 'string' || record.taskId.length < 1 || record.taskId.length > 128) return false;
  if (typeof record.signalId !== 'string' || record.signalId.length < 1 || record.signalId.length > 128) return false;
  if (typeof record.clusterKey !== 'string' || record.clusterKey.length < 1 || record.clusterKey.length > 512) {
    return false;
  }
  if (!isIdList(record.sampleQueryIds) || !isIdList(record.suggestedScriptIds)) return false;
  if (!(ITERATION_CAUSES as readonly string[]).includes(record.suspectedCause as string)) return false;
  if (!(ITERATION_STATUSES as readonly string[]).includes(record.status as string)) return false;
  if (!(record.assigneeRole === null
    || (typeof record.assigneeRole === 'string' && record.assigneeRole.length >= 1
      && record.assigneeRole.length <= 128))) {
    return false;
  }
  if (!(record.resolution === null || record.resolution === 'resolved' || record.resolution === 'wont_fix')) {
    return false;
  }
  if (!(record.resolutionNote === null
    || (typeof record.resolutionNote === 'string' && record.resolutionNote.length >= 1
      && record.resolutionNote.length <= 2000))) {
    return false;
  }
  if (!Number.isSafeInteger(record.version) || (record.version as number) < 1) return false;
  if (!isIsoTimestamp(record.createdAt) || !isIsoTimestamp(record.updatedAt)) return false;
  return record.resolvedAt === null || isIsoTimestamp(record.resolvedAt);
}

function isIterationList(value: unknown): boolean {
  if (isContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || !exactKeys(record, ['ok', 'items', 'nextCursor', 'truncated'])) return false;
  if (typeof record.truncated !== 'boolean') return false;
  if (!(record.nextCursor === null || (typeof record.nextCursor === 'string' && record.nextCursor.length >= 1))) {
    return false;
  }
  return Array.isArray(record.items) && record.items.every(isIterationTask);
}

function isIterationTaskResult(value: unknown): boolean {
  if (isContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.ok === true && exactKeys(record, ['ok', 'task']) && isIterationTask(record.task);
}

const unavailable = { ok: false as const, code: 'UNAVAILABLE' as const, message: '服务暂不可用，请重试' };

function isOutcomeCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
}

function isOutcomeItem(value: unknown): value is { scriptId: string } {
  if (!isRecord(value)) return false;
  if (typeof value.scriptId !== 'string' || value.scriptId.length < 1 || value.scriptId.length > 128) return false;
  if (typeof value.resolvedAt !== 'string' || !Number.isFinite(Date.parse(value.resolvedAt))) return false;
  if (value.windowDays !== 7) return false;
  if (value.ready === false) return value.beforeCount === null && value.afterCount === null;
  return value.ready === true && isOutcomeCount(value.beforeCount) && isOutcomeCount(value.afterCount);
}

function asOutcomeList(value: unknown) {
  if (isContentFailure(value)) return value;
  if (!isRecord(value) || value.ok !== true || !exactKeys(value, ['ok', 'items', 'truncated']) || !Array.isArray(value.items)) {
    return unavailable;
  }
  if (typeof value.truncated !== 'boolean') return unavailable;
  const items = value.items.slice(0, 200);
  const truncated = value.truncated === true || value.items.length > 200;
  if (!items.every(isOutcomeItem)) return unavailable;
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.scriptId)) return unavailable;
    seen.add(item.scriptId);
  }
  return { ok: true as const, items, truncated };
}

contextBridge.exposeInMainWorld('dashboardWording', {
  async list() {
    try {
      const value: unknown = await ipcRenderer.invoke(LIST);
      return isWordingList(value) ? value : { ok: false, code: 'UNAVAILABLE' };
    } catch {
      return { ok: false, code: 'UNAVAILABLE' };
    }
  },
});

function isContentParse(value: unknown): boolean {
  if (isContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.ok === true) {
    return typeof record.sourceName === 'string'
      && typeof record.csvText === 'string'
      && Array.isArray(record.rows);
  }
  return record.ok === false && typeof record.code === 'string' && typeof record.message === 'string';
}

function isContentRollback(value: unknown): boolean {
  if (isContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['ok', 'releaseId', 'releaseSeq', 'rollbackOfReleaseId', 'publisherDisplayName'])
    && record.ok === true
    && typeof record.releaseId === 'string'
    && record.releaseId.length > 0
    && record.releaseId.length <= 128
    && Number.isSafeInteger(record.releaseSeq)
    && (record.releaseSeq as number) >= 1
    && typeof record.rollbackOfReleaseId === 'string'
    && record.rollbackOfReleaseId.length > 0
    && record.rollbackOfReleaseId.length <= 128
    && (record.publisherDisplayName === null
      || (typeof record.publisherDisplayName === 'string'
        && record.publisherDisplayName.length > 0
        && record.publisherDisplayName.length <= 64));
}

contextBridge.exposeInMainWorld('dashboardContent', {
  async session() {
    try {
      const value: unknown = await ipcRenderer.invoke(CONTENT_SESSION);
      return isContentSession(value) ? value : unavailable;
    } catch {
      return unavailable;
    }
  },
  async parseUpload(request: unknown) {
    try {
      const value: unknown = await ipcRenderer.invoke(CONTENT_PARSE, request);
      return isContentParse(value) ? value : unavailable;
    } catch {
      return unavailable;
    }
  },
  async publishDraft(request: unknown) {
    try {
      const value: unknown = await ipcRenderer.invoke(CONTENT_PUBLISH, request);
      return isContentPublish(value) ? value : unavailable;
    } catch {
      return unavailable;
    }
  },
  async rollbackPrevious() {
    try {
      const value: unknown = await ipcRenderer.invoke(CONTENT_ROLLBACK_PREVIOUS);
      return isContentRollback(value) ? value : unavailable;
    } catch {
      return unavailable;
    }
  },
  async cancelInFlight() {
    try {
      const value: unknown = await ipcRenderer.invoke(CONTENT_CANCEL_IN_FLIGHT);
      if (isContentFailure(value)) return value;
      if (value && typeof value === 'object' && (value as { ok?: unknown }).ok === true) {
        return { ok: true as const };
      }
      return unavailable;
    } catch {
      return unavailable;
    }
  },
  onSessionChanged(listener: () => void) {
    sessionChangedListeners.add(listener);
    return () => { sessionChangedListeners.delete(listener); };
  },
});

async function invokeOps(channel: string, ...args: unknown[]) {
  try {
    const value: unknown = await ipcRenderer.invoke(channel, ...args);
    if (isContentFailure(value)) return value;
    return value ?? unavailable;
  } catch {
    return unavailable;
  }
}

contextBridge.exposeInMainWorld('dashboardOps', {
  retrieval(window: unknown) {
    return invokeOps(OPS_RETRIEVAL, window);
  },
  sopCatalog() {
    return invokeOps(OPS_SOP_CATALOG);
  },
  sopImport(csvText: unknown) {
    return invokeOps(OPS_SOP_IMPORT, typeof csvText === 'string' ? csvText : '');
  },
  sopPatch(request: unknown) {
    return invokeOps(OPS_SOP_PATCH, request);
  },
  sopDelete(request: unknown) {
    return invokeOps(OPS_SOP_DELETE, request);
  },
  scriptDelete(request: unknown) {
    return invokeOps(OPS_SCRIPT_DELETE, request);
  },
  softwareCatalog() {
    return invokeOps(OPS_SOFTWARE);
  },
  softwareOpenDownload() {
    return invokeOps(OPS_SOFTWARE_OPEN);
  },
});

const sessionChangedListeners = new Set<() => void>();
ipcRenderer.on(PRODUCT_SESSION_CHANGED, () => {
  for (const listener of sessionChangedListeners) listener();
});

const SOP_WORKBOOK_OPEN = 'dashboard:sop-workbook-open';
const USAGE_LIST = 'dashboard:usage-list';
const USAGE_PREVIEW = 'dashboard:usage-preview';
const USAGE_EXPORT = 'dashboard:usage-export';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asSopOpen(value: unknown) {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return { ok: false as const, code: 'UNAVAILABLE', message: '请稍后再试。' };
  if (!value.ok && typeof value.code === 'string' && typeof value.message === 'string') return value;
  if (value.ok && value.published === false && typeof value.fileName === 'string' && Array.isArray(value.sheets) && Array.isArray(value.issues)) return value;
  return { ok: false as const, code: 'UNAVAILABLE', message: '请稍后再试。' };
}

function asUsageList(value: unknown) {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return { ok: false as const, code: 'UNAVAILABLE', message: '请稍后再试。' };
  if (!value.ok && typeof value.code === 'string' && typeof value.message === 'string') return value;
  if (value.ok && Array.isArray(value.rows) && (value.nextCursor === null || typeof value.nextCursor === 'string') && typeof value.canExport === 'boolean') return value;
  return { ok: false as const, code: 'UNAVAILABLE', message: '请稍后再试。' };
}

function asUsagePreview(value: unknown) {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return { ok: false as const, code: 'UNAVAILABLE', message: '请稍后再试。' };
  if (!value.ok && typeof value.code === 'string' && typeof value.message === 'string') return value;
  if (value.ok && [value.exportable, value.redacted, value.withoutConsent].every((count) => typeof count === 'number' && Number.isFinite(count))) return value;
  return { ok: false as const, code: 'UNAVAILABLE', message: '请稍后再试。' };
}

function asUsageExport(value: unknown) {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return { ok: false as const, code: 'UNAVAILABLE', message: '请稍后再试。' };
  if (!value.ok && typeof value.code === 'string' && typeof value.message === 'string') return value;
  if (value.ok && typeof value.written === 'number') return value;
  return { ok: false as const, code: 'UNAVAILABLE', message: '请稍后再试。' };
}

contextBridge.exposeInMainWorld('dashboardSopWorkbook', {
  async open() {
    try {
      return asSopOpen(await ipcRenderer.invoke(SOP_WORKBOOK_OPEN));
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '请稍后再试。' };
    }
  },
});

contextBridge.exposeInMainWorld('dashboardUsageLog', {
  async list(filter: unknown) {
    try {
      return asUsageList(await ipcRenderer.invoke(USAGE_LIST, filter));
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '请稍后再试。' };
    }
  },
  async previewExport() {
    try {
      return asUsagePreview(await ipcRenderer.invoke(USAGE_PREVIEW));
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '请稍后再试。' };
    }
  },
  async export() {
    try {
      return asUsageExport(await ipcRenderer.invoke(USAGE_EXPORT));
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '请稍后再试。' };
    }
  },
});

contextBridge.exposeInMainWorld('dashboardIteration', {
  async list() {
    try {
      const value: unknown = await ipcRenderer.invoke(ITERATION_LIST);
      return isIterationList(value) ? value : unavailable;
    } catch {
      return unavailable;
    }
  },
  async start(request: unknown) {
    try {
      const value: unknown = await ipcRenderer.invoke(ITERATION_START, request);
      return isIterationTaskResult(value) ? value : unavailable;
    } catch {
      return unavailable;
    }
  },
  async close(request: unknown) {
    try {
      const value: unknown = await ipcRenderer.invoke(ITERATION_CLOSE, request);
      return isIterationTaskResult(value) ? value : unavailable;
    } catch {
      return unavailable;
    }
  },
  async outcomes() {
    try {
      const value: unknown = await ipcRenderer.invoke(INACCURACY_OUTCOMES);
      return asOutcomeList(value);
    } catch {
      return unavailable;
    }
  },
});

// Deliberately no runtime shared import: keep this sandbox preload self-contained.
// Main validates exact command payloads before any state or native side effect.
contextBridge.exposeInMainWorld('dashboardIntake', {
  mode: () => ipcRenderer.invoke('dashboard:intake-mode'),
  shellLine: () => ipcRenderer.invoke('dashboard:intake-shell-line'),
  current: () => ipcRenderer.invoke('dashboard:intake-current'),
  command: (command: IntakeManagementCommand) => ipcRenderer.invoke('dashboard:intake-command', command),
  onInvalidated: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('dashboard:intake-invalidated', handler);
    return () => { ipcRenderer.removeListener('dashboard:intake-invalidated', handler); };
  },
} satisfies IntakeManagementApi);

contextBridge.exposeInMainWorld('dashboardWorkbench', {
  mode: () => ipcRenderer.invoke('dashboard:workbench-mode'),
});

contextBridge.exposeInMainWorld('dashboardDesk', {
  current: () => ipcRenderer.invoke('dashboard:desk-current'),
  command: (command: DeskCommand) => ipcRenderer.invoke('dashboard:desk-command', command),
} satisfies DeskKnowledgeApi);

const SIGNED_OUT: PageUseSnapshot = { phase: 'signed-out' };

contextBridge.exposeInMainWorld('dashboardPageUse', {
  current: async () => {
    const value: unknown = await ipcRenderer.invoke(PAGE_USE_CURRENT);
    return isPageUseSnapshot(value) ? value : SIGNED_OUT;
  },
  onChanged: (listener: (snapshot: PageUseSnapshot) => void) => {
    const handler = (_event: unknown, snapshot: unknown) => {
      if (isPageUseSnapshot(snapshot)) listener(snapshot);
    };
    ipcRenderer.on(PAGE_USE_CHANGED, handler);
    return () => { ipcRenderer.removeListener(PAGE_USE_CHANGED, handler); };
  },
} satisfies PageUseApi);

contextBridge.exposeInMainWorld('dashboardPermissions', {
  current: () => ipcRenderer.invoke('dashboard:permissions-current'),
  command: (command: IntakePermissionCommand) => ipcRenderer.invoke('dashboard:permissions-command', command),
  onInvalidated: (listener: () => void) => {
    const handler = () => listener(); ipcRenderer.on('dashboard:permissions-invalidated', handler);
    return () => { ipcRenderer.removeListener('dashboard:permissions-invalidated', handler); };
  },
} satisfies IntakePermissionApi);

contextBridge.exposeInMainWorld('dashboardSeats', {
  command: (intent: SeatAccountIntent) => ipcRenderer.invoke('dashboard:seats-command', intent),
} satisfies SeatAccountApi);

contextBridge.exposeInMainWorld('dashboardIntakeCatalog', {
  current: () => ipcRenderer.invoke('dashboard:intake-catalog-current'),
  command: (command: IntakeCatalogCommand) => ipcRenderer.invoke('dashboard:intake-catalog-command', command),
  onInvalidated: (listener: () => void) => {
    const handler = () => listener(); ipcRenderer.on('dashboard:intake-catalog-invalidated', handler);
    return () => { ipcRenderer.removeListener('dashboard:intake-catalog-invalidated', handler); };
  },
} satisfies IntakeCatalogApi);
