import { isSopUnifiedCommand } from '../shared/sop-unified';
import { isSopQueryCommand } from '../shared/sop-query';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { SOP_OPEN_FAILURE_MESSAGE, isSopBookmarkIntent, isSopLayoutRequest, rejectedSopLayoutAck, sopWindowFailure, type SopCopyResult, type SopLayoutAck, type SopResizeRequest, type SopWindowResult } from '../shared/sop-window';
import { canControlSopWindow, canQueryOpenSop, canQueryReadSopEntry } from '../shared/sop-ipc-access';
import { isWindowResizeDirection } from '../shared/window-resize-geometry';
import { isTrustedMainFrameSender } from './sender-guard';
import type { OverlayController } from './overlay-controller';
import type { SopWindowController } from './sop-window-controller';

export type SopWindowIpcHost = {
  getOverlay: () => OverlayController | null;
  getSop: () => Pick<SopWindowController, 'open' | 'entryAvailable' | 'resumeAvailable'> | null;
  getSopForContents: (contents: WebContents) => SopWindowController | null;
};

function isSopResizeRequest(value: unknown): value is SopResizeRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (![request.sessionId, request.sequence].every(
    field => typeof field === 'number' && Number.isSafeInteger(field) && field > 0,
  )) return false;
  const base = ['type', 'sessionId', 'sequence'];
  const hasKeys = (keys: string[]) => Object.keys(request).length === keys.length
    && keys.every(key => Object.hasOwn(request, key));
  switch (request.type) {
    case 'begin':
      return hasKeys([...base, 'direction']) && isWindowResizeDirection(request.direction);
    case 'update':
    case 'end':
      return hasKeys([...base, 'deltaX', 'deltaY'])
        && [request.deltaX, request.deltaY].every(delta => typeof delta === 'number' && Math.abs(delta) <= 16_384);
    case 'cancel':
      return hasKeys(base);
    default:
      return false;
  }
}

function queryGuard(event: IpcMainInvokeEvent, host: SopWindowIpcHost): OverlayController | null {
  const overlay = host.getOverlay();
  if (!overlay) {
    return null;
  }
  const trusted = isTrustedMainFrameSender(
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
  const sop = host.getSopForContents(event.sender);
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
  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_UNIFIED_COMMAND, async (event, ...args: unknown[]): Promise<SopWindowResult> => {
    const sop = sopGuard(event, host);
    if (!sop || args.length !== 1 || !isSopUnifiedCommand(args[0])) return sopWindowFailure('INVALID', '流程参数无效');
    return sop.unifiedCommand(args[0]);
  });
  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_QUERY_COMMAND, async (event, ...args: unknown[]): Promise<SopWindowResult> => {
    const sop = sopGuard(event, host);
    if (!sop || args.length !== 1 || !isSopQueryCommand(args[0])) return sopWindowFailure('INVALID', '流程参数无效');
    return sop.queryCommand(args[0]);
  });
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

  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_RESUME_AVAILABLE, (event): boolean => {
    if (!queryGuard(event, host) || !canQueryReadSopEntry({
      trusted: true,
      role: host.getOverlay()?.overlayRoleOf(event.sender) ?? null,
    })) {
      return false;
    }
    return host.getSop()?.resumeAvailable() === true;
  });

  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_CLOSE, (event): void => {
    sopGuard(event, host)?.close();
  });

  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_END_FLOW, async (event): Promise<void> => {
    await sopGuard(event, host)?.endFlow();
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

  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_RESIZE, (event, ...args: unknown[]): void => {
    const sop = sopGuard(event, host);
    if (sop && args.length === 1 && isSopResizeRequest(args[0])) sop.resize(args[0]);
  });
  ipcMain.handle(IPC_CHANNELS.SOP_WINDOW_BOOKMARK, (event, ...args: unknown[]): SopWindowResult => {
    const sop = sopGuard(event, host);
    if (!sop || args.length !== 1 || !isSopBookmarkIntent(args[0])) return sopWindowFailure('INVALID', '流程窗口不可用');
    return sop.bookmark(args[0]);
  });

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
      return { ok: false, message: '复制失败，请重试' };
    }
    return sop.copyCurrent();
  });
}
