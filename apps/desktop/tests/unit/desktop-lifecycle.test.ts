import { describe, expect, it, vi } from 'vitest';
import {
  handleDesktopActivate,
  handleSecondInstance,
  resolveSecondInstanceAction,
  shouldHandleDesktopActivate,
  type DesktopLifecycleHost,
} from '../../src/main/desktop-lifecycle';
import { OPEN_DASHBOARD_FAILURE_MESSAGE } from '../../src/shared/dashboard-access';

function createHost(options: {
  shuttingDown?: boolean;
  ready?: boolean;
} = {}): DesktopLifecycleHost & {
  openDashboard: ReturnType<typeof vi.fn>;
  activateExisting: ReturnType<typeof vi.fn>;
} {
  const openDashboard = vi.fn().mockResolvedValue({ ok: true });
  const activateExisting = vi.fn();
  return {
    openDashboard,
    activateExisting,
    isShuttingDown: () => options.shuttingDown === true,
    isControllerReady: () => options.ready !== false,
    getController: () => ({ openDashboard, activateExisting }),
  };
}

describe('desktop lifecycle activate and second-instance', () => {
  it('does not open a dashboard or activate overlay after shutdown', async () => {
    const host = createHost({ shuttingDown: true, ready: true });
    const focusApp = vi.fn();
    const setPending = vi.fn();
    const onFailure = vi.fn();

    expect(shouldHandleDesktopActivate(host)).toBe(false);
    handleDesktopActivate(host, { focusApp, onFailure });
    expect(focusApp).not.toHaveBeenCalled();
    expect(host.openDashboard).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();

    expect(resolveSecondInstanceAction(host)).toBe('ignore');
    expect(handleSecondInstance(host, { setPending })).toBe('ignore');
    expect(setPending).toHaveBeenCalledWith(false);
    expect(host.activateExisting).not.toHaveBeenCalled();
  });

  it('defers second-instance until ready and does not create overlay work', () => {
    const host = createHost({ shuttingDown: false, ready: false });
    const setPending = vi.fn();

    expect(shouldHandleDesktopActivate(host)).toBe(false);
    handleDesktopActivate(host, { focusApp: vi.fn() });
    expect(host.openDashboard).not.toHaveBeenCalled();

    expect(handleSecondInstance(host, { setPending })).toBe('defer');
    expect(setPending).toHaveBeenCalledWith(true);
    expect(host.activateExisting).not.toHaveBeenCalled();
  });

  it('opens the dashboard on a ready activate and surfaces a typed failure', async () => {
    const host = createHost({ ready: true });
    host.openDashboard.mockResolvedValueOnce({
      ok: false,
      message: OPEN_DASHBOARD_FAILURE_MESSAGE,
    });
    const onFailure = vi.fn();
    const focusApp = vi.fn();

    handleDesktopActivate(host, { focusApp, onFailure });
    expect(focusApp).toHaveBeenCalledOnce();
    expect(host.openDashboard).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledWith({
        ok: false,
        message: OPEN_DASHBOARD_FAILURE_MESSAGE,
      });
    });
  });

  it('surfaces a rejected dashboard open from a ready activate', async () => {
    const host = createHost({ ready: true });
    const error = new Error('dashboard renderer failed');
    host.openDashboard.mockRejectedValueOnce(error);
    const onFailure = vi.fn();

    handleDesktopActivate(host, { onFailure });

    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledOnce();
    });
    expect(onFailure).toHaveBeenCalledWith(error);
  });

  it('activates the existing overlay for a ready second instance', () => {
    const host = createHost({ ready: true });
    const setPending = vi.fn();
    expect(handleSecondInstance(host, { setPending })).toBe('activate');
    expect(host.activateExisting).toHaveBeenCalledOnce();
    expect(setPending).not.toHaveBeenCalled();
  });
});
