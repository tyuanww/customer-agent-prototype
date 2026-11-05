import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  canOpenDashboard,
  isOpenDashboardResult,
  openDashboardUnavailable,
  type OpenDashboardResult,
} from '../shared/dashboard-access';
import {
  canReportQueryLayout,
  canReportUiPhase,
  canResizeQueryHeight,
} from '../shared/query-ipc-access';
import { IPC_CHANNELS } from '../shared/contracts';
import {
  isQueryLayoutRequest,
  isQueryResizeRequest,
  rejectedQueryLayoutAck,
  type QueryLayoutAck,
} from '../shared/query-layout';
import {
  OVERLAY_EVENT_CHANNEL,
  canRequestFoxPeek,
  isFoxDragGeneration,
  isFoxDragSettleId,
  isFoxPeekEpoch,
  isFoxVisualTransform,
  isHandoffId,
  isHandoffMilestone,
  isOverlayRendererEvent,
  isReportablePhase,
  isResultCount,
  type WindowContext,
  type FoxDragSettleAck,
} from '../shared/overlay-events';
import { isOverlayReportIdentity } from '../shared/overlay-report';
import { createInitialOverlayState, overlaySnapshot } from '../shared/overlay-machine';
import type { OverlayController } from './overlay-controller';
import { isTrustedMainFrameSender, isTrustedSender } from './sender-guard';

export function registerOverlayIpc(getController: () => OverlayController | null): void {
  const unavailableContext = (): WindowContext => {
    const state = createInitialOverlayState({
      sessionEpoch: 1,
      generation: 1,
      windowGeneration: 1,
      releaseId: 'rel_overlay_unbound',
    });
    return {
      role: 'query',
      phase: 'FOX_IDLE',
      platform: process.platform,
      shortcut: {
        registered: false,
        accelerator: 'CommandOrControl+Shift+Space',
        message: '窗口上下文不可用',
      },
      snapshot: overlaySnapshot(state),
      testHarness: false,
    };
  };
  const guard = (event: IpcMainInvokeEvent): OverlayController | null => {
    const controller = getController();
    if (!controller) {
      return null;
    }
    if (
      !isTrustedSender(
        event,
        controller.trustedContents(),
        controller.rendererDevServerUrl,
      )
    ) {
      return null;
    }
    return controller;
  };

  ipcMain.handle(IPC_CHANNELS.GET_WINDOW_CONTEXT, (event): WindowContext => {
    const controller = guard(event);
    if (!controller) {
      return unavailableContext();
    }
    return {
      role: controller.overlayRoleOf(event.sender) ?? 'query',
      phase: controller.phase,
      platform: process.platform,
      shortcut: {
        registered: controller.shortcutRegistered,
        accelerator: controller.accelerator,
        message: controller.shortcutMessage,
      },
      snapshot: controller.getOverlaySnapshot(),
      testHarness: controller.testHarness,
    };
  });

  ipcMain.handle(OVERLAY_EVENT_CHANNEL, (event, payload: unknown) => {
    const controller = getController();
    if (
      !controller
      || !isTrustedMainFrameSender(
        event,
        controller.trustedContents(),
        controller.rendererDevServerUrl,
      )
      || !isOverlayRendererEvent(payload)
    ) {
      return null;
    }
    const role = controller.overlayRoleOf(event.sender);
    if (!role) {
      return null;
    }
    if (
      (payload.type === 'session-changed' || payload.type === 'release-changed'
        || payload.type === 'focus-changed')
      && role !== 'query'
    ) {
      return null;
    }
    if (payload.type === 'frame-observed' && payload.target !== role) {
      return null;
    }
    return controller.reportRendererEvent(payload);
  });

  ipcMain.handle(IPC_CHANNELS.QUERY_SUBSCRIBED, (event): void => {
    const controller = guard(event);
    if (!controller || controller.overlayRoleOf(event.sender) !== 'query' ||
        !isTrustedMainFrameSender(event, controller.trustedContents(), controller.rendererDevServerUrl)) return;
    controller.querySubscribed();
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_SEARCH, (event, visualTransform: unknown): void => {
    const controller = guard(event);
    if (!controller) {
      return;
    }
    if (visualTransform !== undefined) {
      if (
        controller.overlayRoleOf(event.sender) !== 'fox' ||
        !isFoxVisualTransform(visualTransform)
      ) {
        return;
      }
      controller.openSearch(visualTransform);
      return;
    }
    controller.openSearch();
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_DASHBOARD, async (event): Promise<OpenDashboardResult> => {
    const controller = getController();
    if (!controller) {
      return openDashboardUnavailable();
    }
    const trusted = isTrustedSender(
      event,
      controller.trustedContents(),
      controller.rendererDevServerUrl,
    );
    const role = controller.overlayRoleOf(event.sender);
    if (!canOpenDashboard({ trusted, role })) {
      return openDashboardUnavailable();
    }
    try {
      const result = await controller.openDashboard();
      if (isOpenDashboardResult(result)) {
        if (!result.ok) {
          console.error('[dashboard] IPC 打开工作台失败。', result.message);
        }
        return result;
      }
      console.error('[dashboard] IPC 打开工作台失败。', result);
      return openDashboardUnavailable();
    } catch (error: unknown) {
      console.error('[dashboard] IPC 打开工作台失败。', error);
      return openDashboardUnavailable();
    }
  });

  ipcMain.handle(IPC_CHANNELS.DISMISS, (event, restorePreviousApp?: unknown): void => {
    guard(event)?.dismiss(restorePreviousApp === true);
  });

  ipcMain.handle(
    IPC_CHANNELS.REPORT_UI_PHASE,
    (event, phase: unknown, resultCount: unknown, identity: unknown): void => {
      const controller = getController();
      if (!controller) {
        return;
      }
      const trusted = isTrustedSender(
        event,
        controller.trustedContents(),
        controller.rendererDevServerUrl,
      );
      const role = controller.overlayRoleOf(event.sender);
      if (
        !canReportUiPhase({ trusted, role }) ||
        !isReportablePhase(phase) ||
        !isResultCount(resultCount) ||
        !isOverlayReportIdentity(identity)
      ) {
        return;
      }
      controller.reportUiPhase(phase, resultCount, identity);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORT_QUERY_LAYOUT,
    (event, payload: unknown): QueryLayoutAck => {
      const controller = getController();
      if (!controller) {
        return rejectedQueryLayoutAck(0, 0);
      }
      const trusted = isTrustedMainFrameSender(
        event,
        controller.trustedContents(),
        controller.rendererDevServerUrl,
      );
      const role = controller.overlayRoleOf(event.sender);
      if (!canReportQueryLayout({ trusted, role }) || !isQueryLayoutRequest(payload)) {
        return rejectedQueryLayoutAck(
          isQueryLayoutRequest(payload) ? payload.sessionId : 0,
          isQueryLayoutRequest(payload) ? payload.sequence : 0,
        );
      }
      return controller.reportQueryLayout(payload);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RESIZE_QUERY_HEIGHT,
    (event, payload: unknown): QueryLayoutAck => {
      const controller = getController();
      if (!controller) {
        return rejectedQueryLayoutAck(0, 0);
      }
      const trusted = isTrustedMainFrameSender(
        event,
        controller.trustedContents(),
        controller.rendererDevServerUrl,
      );
      const role = controller.overlayRoleOf(event.sender);
      if (!canResizeQueryHeight({ trusted, role }) || !isQueryResizeRequest(payload)) {
        return rejectedQueryLayoutAck(
          isQueryResizeRequest(payload) ? payload.sessionId : 0,
          isQueryResizeRequest(payload) ? payload.sequence : 0,
        );
      }
      return controller.resizeQueryHeight(payload);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORT_HANDOFF_MILESTONE,
    (event, handoffId: unknown, milestone: unknown, identity: unknown): void => {
      const controller = guard(event);
      if (
        !controller ||
        controller.overlayRoleOf(event.sender) !== 'query' ||
        !isHandoffId(handoffId) ||
        !isHandoffMilestone(milestone) ||
        !isOverlayReportIdentity(identity)
      ) {
        return;
      }
      controller.reportHandoffMilestone(handoffId, milestone, identity);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MOVE_FOX_BY,
    (
      event,
      dx: unknown,
      dy: unknown,
      finished: unknown,
      generation: unknown,
      identity: unknown,
    ): FoxDragSettleAck | null => {
      if (typeof finished !== 'boolean' || !isOverlayReportIdentity(identity)) {
        return null;
      }
      const controller = guard(event);
      if (!controller) {
        return null;
      }
      const role = controller.overlayRoleOf(event.sender);
      if (role === 'fox') {
        if (!isFoxDragGeneration(generation) && !controller.testHarness) {
          return null;
        }
        return controller.moveBy(
          dx,
          dy,
          finished,
          isFoxDragGeneration(generation) ? generation : undefined,
          identity,
        );
      }
      if (role !== 'query') {
        return null;
      }
      return controller.moveBy(dx, dy, finished, undefined, identity);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.COMMIT_FOX_DRAG_SETTLE,
    (event, settleId: unknown, identity: unknown): void => {
      const controller = getController();
      if (!controller) {
        return;
      }
      const trusted = isTrustedMainFrameSender(
        event,
        controller.trustedContents(),
        controller.rendererDevServerUrl,
      );
      if (
        !trusted
        || controller.overlayRoleOf(event.sender) !== 'fox'
        || !isFoxDragSettleId(settleId)
        || !isOverlayReportIdentity(identity)
      ) {
        return;
      }
      controller.commitFoxDragSettle(settleId, identity);
    },
  );

  ipcMain.handle(IPC_CHANNELS.SET_FOX_PEEK, (
    event,
    intent: unknown,
    epoch: unknown,
    identity: unknown,
  ): void => {
    const controller = getController();
    if (!controller) {
      return;
    }
    const trusted = isTrustedSender(
      event,
      controller.trustedContents(),
      controller.rendererDevServerUrl,
    );
    const role = controller.overlayRoleOf(event.sender);
    if (
      !canRequestFoxPeek(trusted, role, intent)
      || !isFoxPeekEpoch(epoch)
      || !isOverlayReportIdentity(identity)
    ) {
      return;
    }
    controller.setFoxPeek(intent, epoch, identity);
  });
}
