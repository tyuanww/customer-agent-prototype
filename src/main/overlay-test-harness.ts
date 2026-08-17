import { BrowserWindow, screen } from 'electron';
import type { OpenDashboardResult } from '../shared/dashboard-access';
import type { OverlayPhase } from '../shared/overlay-machine';
import type { QueryResizeRequest } from '../shared/query-layout';
import type { ReportablePhase, ResultCount } from '../shared/overlay-events';

export type OverlayTestHarnessHost = {
  phase: OverlayPhase;
  shortcutRegistered: boolean;
  openSearch(): void;
  dismiss(): void;
  toggle(): void;
  getWindows(): BrowserWindow[];
  moveBy(dx: number, dy: number, finished: boolean): void;
  openDashboard(): Promise<OpenDashboardResult> | OpenDashboardResult;
  closeDashboard(): void;
  dashboardSnapshot(): unknown;
  isDashboardTrusted(): boolean;
  queryLayoutDebugState(): unknown;
  resizeQueryHeight(request: QueryResizeRequest): unknown;
  reportUiPhase(phase: ReportablePhase, resultCount: ResultCount): void;
};

export function attachTestHarness(controller: OverlayTestHarnessHost): void {
  const harness = {
    expand: () => {
      controller.openSearch();
    },
    dismiss: () => {
      controller.dismiss();
    },
    toggle: () => {
      controller.toggle();
    },
    blurQuery: () => {
      const query = controller
        .getWindows()
        .find((win) => win.webContents.getURL().includes('role=query'));
      query?.emit('blur');
    },
    getPhase: () => controller.phase,
    shortcutRegistered: () => controller.shortcutRegistered,
    dockFox: (edge: 'left' | 'right') => {
      const fox = controller
        .getWindows()
        .find((win) => win.webContents.getURL().includes('role=fox'));
      if (!fox) {
        return;
      }
      const workArea = screen.getDisplayMatching(fox.getBounds()).workArea;
      const targetX = edge === 'left'
        ? workArea.x
        : workArea.x + workArea.width - fox.getBounds().width;
      const walk = (distance: number): void => {
        let remaining = distance;
        while (Math.abs(remaining) > 240) {
          const step = Math.sign(remaining) * 240;
          controller.moveBy(step, 0, false);
          remaining -= step;
        }
        if (remaining !== 0) {
          controller.moveBy(remaining, 0, false);
        }
      };
      walk(targetX - fox.getBounds().x);
      controller.moveBy(0, 0, true);
      const leftover = targetX - fox.getBounds().x;
      if (leftover !== 0) {
        walk(leftover);
        controller.moveBy(0, 0, true);
      }
    },
    openDashboard: () => controller.openDashboard(),
    closeDashboard: () => {
      controller.closeDashboard();
    },
    dashboardSnapshot: () => controller.dashboardSnapshot(),
    isDashboardTrusted: () => controller.isDashboardTrusted(),
    queryHeight: () => {
      const query = controller
        .getWindows()
        .find((win) => win.webContents.getURL().includes('role=query'));
      return query?.getBounds().height ?? null;
    },
    closeFocusedSurface: () => {
      const focused = BrowserWindow.getFocusedWindow();
      if (!focused || focused.isDestroyed()) {
        return;
      }
      focused.close();
    },
    queryLayoutDebug: () => controller.queryLayoutDebugState(),
    resizeQueryHeight: (request: QueryResizeRequest) => controller.resizeQueryHeight(request),
    reportUiPhase: (phase: ReportablePhase, resultCount: ResultCount) => {
      controller.reportUiPhase(phase, resultCount);
    },
  };
  Object.defineProperty(globalThis, '__demoTest', {
    value: harness,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}
