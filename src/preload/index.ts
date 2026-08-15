import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type CopyTextResult,
  type CustomerAgentApi,
  type PlatformInfo,
} from '../shared/contracts';
import {
  isFoxPeekIntent,
  isFoxPeekEpoch,
  isFoxVisualTransform,
  isHandoffId,
  isHandoffMilestone,
  isOverlayCommand,
  isReportablePhase,
  isResultCount,
  type OverlayCommand,
  type WindowContext,
} from '../shared/overlay-events';

const overlayListeners = new Set<(command: OverlayCommand) => void>();

ipcRenderer.on(IPC_CHANNELS.OVERLAY_COMMAND, (_event, payload: unknown) => {
  if (!isOverlayCommand(payload)) {
    return;
  }
  for (const listener of overlayListeners) {
    listener(payload);
  }
});

const api: CustomerAgentApi = {
  copyText(text: string): Promise<CopyTextResult> {
    if (typeof text !== 'string') {
      return Promise.resolve({ ok: false, message: '复制内容无效' });
    }
    return ipcRenderer.invoke(IPC_CHANNELS.COPY_TEXT, text);
  },
  getPlatform(): Promise<PlatformInfo> {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PLATFORM);
  },
  getWindowContext(): Promise<WindowContext> {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_WINDOW_CONTEXT);
  },
  openSearch(visualTransform): Promise<void> {
    if (visualTransform !== undefined && !isFoxVisualTransform(visualTransform)) {
      return Promise.resolve();
    }
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_SEARCH, visualTransform);
  },
  openDashboard(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_DASHBOARD);
  },
  dismiss(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.DISMISS);
  },
  reportUiPhase(phase, resultCount = 0): Promise<void> {
    if (!isReportablePhase(phase) || !isResultCount(resultCount)) {
      return Promise.resolve();
    }
    return ipcRenderer.invoke(IPC_CHANNELS.REPORT_UI_PHASE, phase, resultCount);
  },
  reportHandoffMilestone(handoffId, milestone): Promise<void> {
    if (!isHandoffId(handoffId) || !isHandoffMilestone(milestone)) {
      return Promise.resolve();
    }
    return ipcRenderer.invoke(IPC_CHANNELS.REPORT_HANDOFF_MILESTONE, handoffId, milestone);
  },
  moveFoxBy(deltaX: number, deltaY: number, finished = false): Promise<void> {
    if (
      typeof deltaX !== 'number' ||
      typeof deltaY !== 'number' ||
      typeof finished !== 'boolean'
    ) {
      return Promise.resolve();
    }
    return ipcRenderer.invoke(IPC_CHANNELS.MOVE_FOX_BY, deltaX, deltaY, finished);
  },
  setFoxPeek(intent, epoch): Promise<void> {
    if (!isFoxPeekIntent(intent) || !isFoxPeekEpoch(epoch)) {
      return Promise.resolve();
    }
    return ipcRenderer.invoke(IPC_CHANNELS.SET_FOX_PEEK, intent, epoch);
  },
  onOverlayCommand(handler) {
    overlayListeners.add(handler);
    return () => {
      overlayListeners.delete(handler);
    };
  },
};

contextBridge.exposeInMainWorld('customerAgent', api);
