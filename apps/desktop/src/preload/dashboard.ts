import { contextBridge, ipcRenderer } from 'electron';

// Keep these literals aligned with IPC_CHANNELS. Do not import shared modules:
// a second preload entry that shares overlay session helpers would split a
// chunk the Windows sandbox cannot load, and Query stays parked.
const LIST = 'dashboard:wording-list';
const CONTENT_SESSION = 'dashboard:content-session';
const CONTENT_IMPORT = 'dashboard:content-import';
const CONTENT_PUBLISH = 'dashboard:content-publish';

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
    && Object.keys(record).length === 4
    && (record.releaseId === null || typeof record.releaseId === 'string')
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

contextBridge.exposeInMainWorld('dashboardContent', {
  async session() {
    try {
      const value: unknown = await ipcRenderer.invoke(CONTENT_SESSION);
      return isContentSession(value) ? value : unavailable;
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
