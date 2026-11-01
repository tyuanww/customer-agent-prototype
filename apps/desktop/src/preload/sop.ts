import { contextBridge, ipcRenderer } from 'electron';
import { isQuerySopWindowIntent } from '../shared/query-sop-window';
import { isSopDraftIdentity, isSopDraftStart, isSopDraftUpdate, isSopDraftDiscard, isSopDraftResult, isSopFloatingSnapshot, isSopExecutionCommand, isSopExecutionCopy, isSopExecutionRename, isSopReadyRequest,
  isSopCopyResult, isSopWindowResult, SOP_UNAVAILABLE, type SopFloatingApi } from '../shared/sop-window';
const api: SopFloatingApi = {
  async current() {
    try { const value: unknown = await ipcRenderer.invoke('sop-floating:current'); return isSopFloatingSnapshot(value) ? value : SOP_UNAVAILABLE; }
    catch { return SOP_UNAVAILABLE; }
  },
  async ready(request) { return isSopReadyRequest(request) && await ipcRenderer.invoke('sop-floating:ready', request) === true; },
  async windowIntent(request) { return isQuerySopWindowIntent(request) && await ipcRenderer.invoke('sop-floating:window', request) === true; },
  async command(request) {
    if (!isSopExecutionCommand(request)) return { ok: false, code: 'INVALID', message: '流程操作无效' };
    const value: unknown = await ipcRenderer.invoke('sop-floating:command', request);
    return isSopWindowResult(value) ? value : { ok: false, code: 'UNAVAILABLE', message: '流程操作失败' };
  },
  async copyCurrent(request) {
    if (!isSopExecutionCopy(request)) return { ok: false, message: '复制请求无效' };
    const value: unknown = await ipcRenderer.invoke('sop-floating:copy', request);
    return isSopCopyResult(value) ? value : { ok: false, message: '复制失败，请重试' };
  },
  async renameCurrent(request) {
    if (!isSopExecutionRename(request)) return { ok: false, code: 'INVALID', message: '名称无效' };
    try {
      const value: unknown = await ipcRenderer.invoke('sop-floating:rename-current', request);
      return isSopWindowResult(value) ? value : { ok: false, code: 'UNAVAILABLE', message: '名称修改失败' };
    } catch { return { ok: false, code: 'UNAVAILABLE', message: '名称修改失败' }; }
  },
  async draftCurrent(request) {
    if (!isSopDraftIdentity(request)) return { ok: false };
    try { const value: unknown = await ipcRenderer.invoke('sop-floating:draft-current', request); return isSopDraftResult(value) ? value : { ok: false }; }
    catch { return { ok: false }; }
  },
  async draftStart(request) {
    if (!isSopDraftStart(request)) return { ok: false };
    try { const value: unknown = await ipcRenderer.invoke('sop-floating:draft-start', request); return isSopDraftResult(value) ? value : { ok: false }; }
    catch { return { ok: false }; }
  },
  async draftUpdate(request) {
    if (!isSopDraftUpdate(request)) return false;
    try { return await ipcRenderer.invoke('sop-floating:draft-update', request) === true; } catch { return false; }
  },
  async draftDiscard(request) {
    if (!isSopDraftDiscard(request)) return false;
    try { return await ipcRenderer.invoke('sop-floating:draft-discard', request) === true; } catch { return false; }
  },
  onProjection(callback) {
    const listener = (_event: unknown, value: unknown) => callback(isSopFloatingSnapshot(value) ? value : SOP_UNAVAILABLE);
    ipcRenderer.on('sop-floating:projection', listener);
    return () => { ipcRenderer.removeListener('sop-floating:projection', listener); };
  },
};
contextBridge.exposeInMainWorld('sopFloating', api);
