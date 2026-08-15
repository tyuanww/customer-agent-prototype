import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { canOpenDashboard } from '../shared/dashboard-access';
import { canReportUiPhase } from '../shared/query-ipc-access';
import { IPC_CHANNELS } from '../shared/contracts';
import {
  canRequestFoxPeek,
  isFoxPeekEpoch,
  isFoxVisualTransform,
  isHandoffId,
  isHandoffMilestone,
  isReportablePhase,
  isResultCount,
  type WindowContext,
} from '../shared/overlay-events';
import type { OverlayController } from './overlay-controller';
import { isTrustedSender } from './sender-guard';

export function registerOverlayIpc(getController: () => OverlayController | null): void {
  const guard = (event: IpcMainInvokeEvent): OverlayController | null => {
    const controller = getController();
    if (!controller) {
      return null;
    }
    if (!isTrustedSender(event, controller.trustedContents())) {
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

  ipcMain.handle(IPC_CHANNELS.OPEN_DASHBOARD, (event): void => {
    const controller = getController();
    if (!controller) {
      return;
    }
    const trusted = isTrustedSender(event, controller.trustedContents());
    const role = controller.overlayRoleOf(event.sender);
    if (!canOpenDashboard({ trusted, role })) {
      return;
    }
    void controller.openDashboard();
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
      const trusted = isTrustedSender(event, controller.trustedContents());
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
    (event, dx: unknown, dy: unknown, finished: unknown): void => {
      if (typeof finished !== 'boolean') {
        return;
      }
      guard(event)?.moveBy(dx, dy, finished);
    },
  );

  ipcMain.handle(IPC_CHANNELS.SET_FOX_PEEK, (event, intent: unknown, epoch: unknown): void => {
    const controller = getController();
    if (!controller) {
      return;
    }
    const trusted = isTrustedSender(event, controller.trustedContents());
    const role = controller.overlayRoleOf(event.sender);
    if (!canRequestFoxPeek(trusted, role, intent) || !isFoxPeekEpoch(epoch)) {
      return;
    }
    controller.setFoxPeek(intent, epoch);
  });
}
