import { BrowserWindow, screen } from 'electron';
import type { OpenDashboardResult } from '../shared/dashboard-access';
import type { OverlayPhase, OverlaySnapshotProjection } from '../shared/overlay-machine';
import type { QueryResizeRequest } from '../shared/query-layout';
import type {
  FoxDragSettleAck,
  ReportablePhase,
  ResultCount,
} from '../shared/overlay-events';
import type { OverlayReportIdentity } from '../shared/overlay-report';

export function isTestHarnessEnabled(): boolean {
  return process.env.DEMO_E2E === '1' || process.argv.includes('--demo-e2e');
}

export type OverlayTestHarnessHost = {
  phase: OverlayPhase;
  shortcutRegistered: boolean;
  openSearch(): void;
  dismiss(): void;
  toggle(): void;
  getWindows(): BrowserWindow[];
  moveBy(dx: number, dy: number, finished: boolean): FoxDragSettleAck | null;
  commitFoxDragSettle(settleId: number): void;
  openDashboard(): Promise<OpenDashboardResult> | OpenDashboardResult;
  closeDashboard(): void;
  dashboardSnapshot(): unknown;
  isDashboardTrusted(): boolean;
  queryLayoutDebugState(): unknown;
  resizeQueryHeight(request: QueryResizeRequest): unknown;
  reportUiPhase(
    phase: ReportablePhase,
    resultCount: ResultCount,
    identity: OverlayReportIdentity,
  ): void;
  getOverlaySnapshot(): OverlaySnapshotProjection;
};

export function attachTestHarness(controller: OverlayTestHarnessHost): void {
  const foxSetBoundsCalls: Array<{
    bounds: Parameters<BrowserWindow['setBounds']>[0];
    animate: boolean;
  }> = [];
  let recordFoxSetBounds = false;
  const fox = controller
    .getWindows()
    .find((win) => win.webContents.getURL().includes('role=fox'));
  if (fox) {
    // Native move events do not reveal whether JavaScript or WindowServer
    // initiated a re-seat. Wrapping only the E2E Fox instance gives tests that
    // provenance without changing the production bounds policy.
    const originalSetBounds = fox.setBounds.bind(fox);
    fox.setBounds = ((bounds, animate) => {
      if (recordFoxSetBounds) {
        foxSetBoundsCalls.push({ bounds: { ...bounds }, animate: animate ?? false });
      }
      originalSetBounds(bounds, animate);
    }) as BrowserWindow['setBounds'];
  }
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
      query?.blur();
    },
    getPhase: () => controller.phase,
    shortcutRegistered: () => controller.shortcutRegistered,
    beginFoxSetBoundsTrace: () => {
      foxSetBoundsCalls.length = 0;
      recordFoxSetBounds = true;
    },
    endFoxSetBoundsTrace: () => {
      recordFoxSetBounds = false;
      return foxSetBoundsCalls.map((call) => ({
        bounds: { ...call.bounds },
        animate: call.animate,
      }));
    },
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
      const firstSettle = controller.moveBy(0, 0, true);
      if (firstSettle) {
        controller.commitFoxDragSettle(firstSettle.settleId);
      }
      const leftover = targetX - fox.getBounds().x;
      if (leftover !== 0) {
        walk(leftover);
        const finalSettle = controller.moveBy(0, 0, true);
        if (finalSettle) {
          controller.commitFoxDragSettle(finalSettle.settleId);
        }
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
    resizeQueryHeight: (request: QueryResizeRequest) => {
      const snapshot = controller.getOverlaySnapshot();
      return controller.resizeQueryHeight({
        ...request,
        identity: {
          sessionEpoch: snapshot.contract.sessionEpoch,
          generation: snapshot.contract.generation,
          windowGeneration: snapshot.windowGeneration,
          contentRevision: snapshot.contentRevision,
        },
      });
    },
    reportUiPhase: (phase: ReportablePhase, resultCount: ResultCount) => {
      const snapshot = controller.getOverlaySnapshot();
      controller.reportUiPhase(phase, resultCount, {
        sessionEpoch: snapshot.contract.sessionEpoch,
        generation: snapshot.contract.generation,
        windowGeneration: snapshot.windowGeneration,
        contentRevision: snapshot.contentRevision + 1,
      });
    },
  };
  Object.defineProperty(globalThis, '__demoTest', {
    value: harness,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}
