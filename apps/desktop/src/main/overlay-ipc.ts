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
  canRequestFoxPeek,
  isFoxDragGeneration,
  isFoxDragSettleId,
  isFoxPeekEpoch,
  isFoxVisualTransform,
  isHandoffId,
  isHandoffMilestone,
  isReportablePhase,
  isResultCount,
  type WindowContext,
  type FoxDragSettleAck,
} from '../shared/overlay-events';
import type { OverlayController } from './overlay-controller';
import { isTrustedMainFrameSender, isTrustedSender } from './sender-guard';

export function registerOverlayIpc(getController: () => OverlayController | null): void {
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
      return {
        role: 'query',
        phase: 'FOX_IDLE',
        platform: process.platform,
        shortcut: {
          registered: false,
          accelerator: 'CommandOrControl+Shift+Space',
          message: '窗口上下文不可用',
        },
        testHarness: false,
      };
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
      testHarness: controller.testHarness,
    };
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

  ipcMain.handle(IPC_CHANNELS.DISMISS, (event): void => {
    guard(event)?.dismiss();
  });

  ipcMain.handle(
    IPC_CHANNELS.REPORT_UI_PHASE,
    (event, phase: unknown, resultCount: unknown): void => {
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
        !isResultCount(resultCount)
      ) {
        return;
      }
      controller.reportUiPhase(phase, resultCount);
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
    (event, handoffId: unknown, milestone: unknown): void => {
      const controller = guard(event);
      if (
        !controller ||
        controller.overlayRoleOf(event.sender) !== 'query' ||
        !isHandoffId(handoffId) ||
        !isHandoffMilestone(milestone)
      ) {
        return;
      }
      controller.reportHandoffMilestone(handoffId, milestone);
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
    ): FoxDragSettleAck | null => {
      if (typeof finished !== 'boolean') {
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
        );
      }
      if (role !== 'query') {
        return null;
      }
      return controller.moveBy(dx, dy, finished);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.COMMIT_FOX_DRAG_SETTLE,
    (event, settleId: unknown): void => {
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
      ) {
        return;
      }
      controller.commitFoxDragSettle(settleId);
    },
  );

  ipcMain.handle(IPC_CHANNELS.SET_FOX_PEEK, (event, intent: unknown, epoch: unknown): void => {
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
    if (!canRequestFoxPeek(trusted, role, intent) || !isFoxPeekEpoch(epoch)) {
      return;
    }
    controller.setFoxPeek(intent, epoch);
  });
}
