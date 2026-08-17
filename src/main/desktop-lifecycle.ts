import type { OpenDashboardResult } from '../shared/dashboard-access';

export type DesktopLifecycleController = {
  openDashboard(): Promise<OpenDashboardResult> | OpenDashboardResult;
  activateExisting(): void;
};

export type DesktopLifecycleHost = {
  isShuttingDown(): boolean;
  isControllerReady(): boolean;
  getController(): DesktopLifecycleController | null;
};

export type SecondInstanceAction = 'activate' | 'defer' | 'ignore';

export function shouldHandleDesktopActivate(host: DesktopLifecycleHost): boolean {
  return !host.isShuttingDown() && host.isControllerReady() && host.getController() != null;
}

export function resolveSecondInstanceAction(
  host: Pick<DesktopLifecycleHost, 'isShuttingDown' | 'isControllerReady'>,
): SecondInstanceAction {
  if (host.isShuttingDown()) {
    return 'ignore';
  }
  if (!host.isControllerReady()) {
    return 'defer';
  }
  return 'activate';
}

export function handleDesktopActivate(
  host: DesktopLifecycleHost,
  options: {
    focusApp?: () => void;
    onFailure?: (reason: unknown) => void;
  } = {},
): void {
  if (!shouldHandleDesktopActivate(host)) {
    return;
  }
  const controller = host.getController();
  if (!controller) {
    return;
  }
  options.focusApp?.();
  void Promise.resolve(controller.openDashboard()).then((result) => {
    if (!result || result.ok !== true) {
      options.onFailure?.(result);
    }
  }).catch((error: unknown) => {
    options.onFailure?.(error);
  });
}

export function handleSecondInstance(
  host: DesktopLifecycleHost,
  options: { setPending: (pending: boolean) => void },
): SecondInstanceAction {
  const action = resolveSecondInstanceAction(host);
  if (action === 'ignore') {
    options.setPending(false);
    return action;
  }
  if (action === 'defer') {
    options.setPending(true);
    return action;
  }
  host.getController()?.activateExisting();
  return action;
}
