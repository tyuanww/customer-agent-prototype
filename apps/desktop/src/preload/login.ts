import { contextBridge, ipcRenderer } from 'electron';
import { isLoginWindowCommandResult, type LoginWindowApi } from '../shared/login-window';

// Keep these literals aligned with IPC_CHANNELS. Do not import ipc-channels.ts:
// a second preload entry would split a shared chunk that sandboxed overlay
// preloads cannot load, and Query stays parked (Windows smoke).
const CHOOSE_FEISHU = 'login-window:choose-feishu';
const SUBMIT_ACCOUNT = 'login-window:submit-account';
const CANCEL = 'login-window:cancel';

const api: LoginWindowApi = {
  async chooseFeishu() {
    try {
      const value: unknown = await ipcRenderer.invoke(CHOOSE_FEISHU);
      return isLoginWindowCommandResult(value) ? value : { ok: false, code: 'UNAVAILABLE' };
    } catch {
      return { ok: false, code: 'UNAVAILABLE' };
    }
  },
  async submitAccount(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') return { ok: false, code: 'INVALID' };
    try {
      const value: unknown = await ipcRenderer.invoke(SUBMIT_ACCOUNT, { username, password });
      return isLoginWindowCommandResult(value) ? value : { ok: false, code: 'UNAVAILABLE' };
    } catch {
      return { ok: false, code: 'UNAVAILABLE' };
    }
  },
  async cancel() {
    try { await ipcRenderer.invoke(CANCEL); }
    catch { /* Window is already closing. */ }
  },
};

contextBridge.exposeInMainWorld('loginWindow', api);
