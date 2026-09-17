import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { SOP_OPEN_FAILURE_MESSAGE, isSopLayoutRequest, rejectedSopLayoutAck, sopWindowFailure, type SopCopyResult, type SopLayoutAck, type SopWindowResult } from '../shared/sop-window';
import { canControlSopWindow, canQueryOpenSop, canQueryReadSopEntry } from '../shared/sop-ipc-access';
import { isTrustedMainFrameSender, isTrustedSender } from './sender-guard';
import type { OverlayController } from './overlay-controller';
import type { SopWindowController } from './sop-window-controller';

export type SopWindowIpcHost = {
  getOverlay: () => OverlayController | null;
  getSop: () => SopWindowController | null;
};

function queryGuard(event: IpcMainInvokeEvent, host: SopWindowIpcHost): OverlayController | null {
  const overlay = host.getOverlay();
  if (!overlay) {
    return null;
  }
  const trusted = isTrustedSender(
    event,
    overlay.trustedContents(),
    overlay.rendererDevServerUrl,
  );
  const role = overlay.overlayRoleOf(event.sender);
  if (!canQueryOpenSop({ trusted, role })) {
    return null;
  }
  return overlay;
}

function sopGuard(event: IpcMainInvokeEvent, host: SopWindowIpcHost): SopWindowController | null {
  const overlay = host.getOverlay();
  const sop = host.getSop();
  if (!overlay || !sop) {
    return null;
  }
  const contents = sop.sopContents();
  if (!contents) {
    return null;
  }
  const trusted = isTrustedMainFrameSender(
    event,
    [contents],
    overlay.rendererDevServerUrl,
  );
  if (!canControlSopWindow({ trustedSop: trusted && sop.isSopContents(event.sender) })) {
    return null;
  }
  return sop;
}

export function registerSopWindowIpc(host: SopWindowIpcHost): void {
  ipcMain.handle(
    IPC_CHANNELS.SOP_WINDOW_OPEN,
    async (event, sceneId: unknown): Promise<SopWindowResult> => {
      if (!queryGuard(event, host)) {
        return sopWindowFailure('UNAVAILABLE', SOP_OPEN_FAILURE_MESSAGE);
      }
      const sop = host.getSop();
      if (!sop) {
        return sopWindowFailure('UNAVAILABLE', SOP_OPEN_FAILURE_MESSAGE);
      }
      if (typeof sceneId !== 'string' || sceneId.length === 0 || sceneId.length > 64) {
        return sopWindowFailure('INVALID', '流程参数无效');
      }
      try {
        return await sop.open(sceneId);
      } catch {
        return sopWindowFailure('FAILED', SOP_OPEN_FAILURE_MESSAGE);
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_ENTRY_AVAILABLE, (event): boolean => {
    if (!queryGuard(event, host) || !canQueryReadSopEntry({
      trusted: true,
      role: host.getOverlay()?.overlayRoleOf(event.sender) ?? null,
    })) {
      return false;
    }
    return host.getSop()?.entryAvailable() === true;
  });

  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_CLOSE, (event): void => {
    sopGuard(event, host)?.close();
  });

  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_END_FLOW, (event): void => {
    sopGuard(event, host)?.endFlow();
  });

  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_RESTART, async (event): Promise<SopWindowResult> => {
    const sop = sopGuard(event, host);
    if (!sop) {
      return sopWindowFailure('UNAVAILABLE', SOP_OPEN_FAILURE_MESSAGE);
    }
    return sop.restart();
  });

  ipcMain.handle(
    IPC_CHANNELS.SOP_WINDOW_CHOOSE_EDGE,
    (event, edgeId: unknown): SopWindowResult => {
      const sop = sopGuard(event, host);
      if (!sop) {
        return sopWindowFailure('UNAVAILABLE', SOP_OPEN_FAILURE_MESSAGE);
      }
      if (typeof edgeId !== 'string' || edgeId.length === 0 || edgeId.length > 64) {
        return sopWindowFailure('INVALID', '当前步骤不能继续');
      }
      return sop.chooseEdge(edgeId);
    },
  );

  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_NEXT_STEP, (event): SopWindowResult => {
    const sop = sopGuard(event, host);
    if (!sop) {
      return sopWindowFailure('UNAVAILABLE', SOP_OPEN_FAILURE_MESSAGE);
    }
    return sop.nextStep();
  });

  ipcMain.handle(
    IPC_CHANNELS.SOP_WINDOW_MOVE_BY,
    (event, dx: unknown, dy: unknown, finished?: unknown): void => {
      sopGuard(event, host)?.moveBy(dx, dy, finished);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.SOP_WINDOW_REPORT_LAYOUT,
    (event, payload: unknown): SopLayoutAck => {
      const sop = sopGuard(event, host);
      if (!sop || !isSopLayoutRequest(payload)) {
        return rejectedSopLayoutAck(
          isSopLayoutRequest(payload) ? payload.sessionId : 0,
          isSopLayoutRequest(payload) ? payload.sequence : 0,
        );
      }
      return sop.reportLayout(payload);
    },
  );

  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_COPY_CURRENT, (event): SopCopyResult => {
    const sop = sopGuard(event, host);
    if (!sop) {
      return { ok: false, message: '复制通道不可用，请在桌面 Demo 中重试' };
    }
    return sop.copyCurrent();
  });
}
