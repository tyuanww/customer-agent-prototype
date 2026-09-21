import { contextBridge, ipcRenderer } from 'electron';

// Keep these literals aligned with IPC_CHANNELS. Do not import shared modules:
// a second preload entry that shares overlay session helpers would split a
// chunk the Windows sandbox cannot load, and Query stays parked.
const LIST = 'dashboard:wording-list';
const CONTENT_SESSION = 'dashboard:content-session';
const CONTENT_PARSE = 'dashboard:content-parse';
const CONTENT_IMPORT = 'dashboard:content-import';
const CONTENT_PUBLISH = 'dashboard:content-publish';
const ITERATION_LIST = 'dashboard:iteration-list';
const ITERATION_START = 'dashboard:iteration-start';
const ITERATION_CLOSE = 'dashboard:iteration-close';
const OPS_RETRIEVAL = 'dashboard:ops-retrieval';
const OPS_SOP_CATALOG = 'dashboard:ops-sop-catalog';
const OPS_SOP_IMPORT = 'dashboard:ops-sop-import';
const OPS_SOP_PATCH = 'dashboard:ops-sop-patch';
const OPS_SOP_DELETE = 'dashboard:ops-sop-delete';
const OPS_SCRIPT_PATCH = 'dashboard:ops-script-patch';
const OPS_SCRIPT_DELETE = 'dashboard:ops-script-delete';
const OPS_SOFTWARE = 'dashboard:ops-software';

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
    && Object.keys(record).length === 5
    && (record.releaseId === null || typeof record.releaseId === 'string')
    && (record.catalogRefreshedAt === null || typeof record.catalogRefreshedAt === 'string')
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
  if (record.ok !== true || !exactKeys(record, ['ok', 'enabled', 'signedIn', 'role'])) return false;
  if (typeof record.enabled !== 'boolean' || typeof record.signedIn !== 'boolean') return false;
  if (record.signedIn) {
    return record.enabled === true
      && (record.role === 'agent' || record.role === 'coach' || record.role === 'owner');
  }
  return record.role === null;
}

function isContentImport(value: unknown): boolean {
  if (isContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['ok', 'importBatchId'])
    && record.ok === true
    && typeof record.importBatchId === 'string'
    && record.importBatchId.length > 0
    && record.importBatchId.length <= 128;
}

function isContentPublish(value: unknown): boolean {
  if (isContentFailure(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ['ok', 'releaseId', 'releaseSeq'])
    && record.ok === true
    && typeof record.releaseId === 'string'
    && record.releaseId.length > 0
    && record.releaseId.length <= 128
    && Number.isSafeInteger(record.releaseSeq)
    && (record.releaseSeq as number) >= 1;
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
  if (record.ok !== true || !exactKeys(record, ['ok', 'items', 'nextCursor'])) return false;
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
  async importDraft(request: unknown) {
    try {
      const value: unknown = await ipcRenderer.invoke(CONTENT_IMPORT, request);
      return isContentImport(value) ? value : unavailable;
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
  scriptPatch(request: unknown) {
    return invokeOps(OPS_SCRIPT_PATCH, request);
  },
  scriptDelete(request: unknown) {
    return invokeOps(OPS_SCRIPT_DELETE, request);
  },
  softwareCatalog() {
    return invokeOps(OPS_SOFTWARE);
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
});
