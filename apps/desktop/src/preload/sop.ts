import { contextBridge, ipcRenderer } from 'electron';
import {
  isSopLayoutAck,
  isSopLayoutRequest,
  isSopProjection,
  isSopWindowResult,
  rejectedSopLayoutAck,
  type SopCopyResult,
  type SopProjection,
  type SopWindowApi,
} from '../shared/sop-window';

// Keep these literals aligned with IPC_CHANNELS. Do not import ipc-channels.ts:
// a second preload entry would split a shared chunk that sandboxed overlay
// preloads cannot load, and Query stays parked (Windows smoke).
const CLOSE = 'sop-window:close';
const END_FLOW = 'sop-window:end-flow';
const RESTART = 'sop-window:restart';
const CHOOSE_EDGE = 'sop-window:choose-edge';
const NEXT_STEP = 'sop-window:next-step';
const MOVE_BY = 'sop-window:move-by';
const REPORT_LAYOUT = 'sop-window:report-layout';
const COPY_CURRENT = 'sop-window:copy-current';
const PROJECTION = 'sop-window:projection';

const projectionListeners = new Set<(projection: SopProjection) => void>();

ipcRenderer.on(PROJECTION, (_event, payload: unknown) => {
  if (!isSopProjection(payload)) {
    return;
  }
  for (const listener of projectionListeners) {
    listener(payload);
  }
});

const unavailable = { ok: false as const, code: 'UNAVAILABLE' as const, message: '过敏流程通道不可用' };

const api: SopWindowApi = {
  async close() {
    try {
      await ipcRenderer.invoke(CLOSE);
    } catch {
      // Window is already closing.
    }
  },
  async endFlow() {
    try {
      await ipcRenderer.invoke(END_FLOW);
    } catch {
      // Window is already closing.
    }
  },
  async restart() {
    try {
      await ipcRenderer.invoke(RESTART);
    } catch {
      // Renderer only needs the next projection.
    }
  },
  async chooseEdge(edgeId) {
    if (typeof edgeId !== 'string') {
      return { ok: false, code: 'INVALID', message: '当前步骤不能继续' };
    }
    try {
      const value: unknown = await ipcRenderer.invoke(CHOOSE_EDGE, edgeId);
      return isSopWindowResult(value) ? value : unavailable;
    } catch {
      return unavailable;
    }
  },
  async nextStep() {
    try {
      const value: unknown = await ipcRenderer.invoke(NEXT_STEP);
      return isSopWindowResult(value) ? value : unavailable;
    } catch {
      return unavailable;
    }
  },
  async moveBy(dx, dy, finished = false) {
    if (
      typeof dx !== 'number'
      || typeof dy !== 'number'
      || typeof finished !== 'boolean'
    ) {
      return;
    }
    try {
      await ipcRenderer.invoke(MOVE_BY, dx, dy, finished);
    } catch {
      // Drag can race with hide.
    }
  },
  async reportLayout(request) {
    if (!isSopLayoutRequest(request)) {
      return rejectedSopLayoutAck(0, 0);
    }
    try {
      const value: unknown = await ipcRenderer.invoke(REPORT_LAYOUT, request);
      return isSopLayoutAck(value) ? value : rejectedSopLayoutAck(request.sessionId, request.sequence);
    } catch {
      return rejectedSopLayoutAck(request.sessionId, request.sequence);
    }
  },
  async copyCurrent() {
    try {
      const value: unknown = await ipcRenderer.invoke(COPY_CURRENT);
      if (!value || typeof value !== 'object') {
        return { ok: false, message: '复制失败，请重试' };
      }
      const record = value as SopCopyResult;
      if (record.ok === true) {
        return { ok: true };
      }
      return {
        ok: false,
        message: typeof record.message === 'string' ? record.message : '复制失败，请重试',
      };
    } catch {
      return { ok: false, message: '复制失败，请重试' };
    }
  },
  onProjection(cb) {
    projectionListeners.add(cb);
    return () => {
      projectionListeners.delete(cb);
    };
  },
};

contextBridge.exposeInMainWorld('sopWindow', api);
