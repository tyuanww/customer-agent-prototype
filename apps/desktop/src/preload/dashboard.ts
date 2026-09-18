import { contextBridge, ipcRenderer } from 'electron';

// Keep this literal aligned with IPC_CHANNELS. Do not import shared modules:
// a second preload entry that shares overlay session helpers would split a
// chunk the Windows sandbox cannot load, and Query stays parked.
const LIST = 'dashboard:wording-list';

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
