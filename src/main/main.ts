import { app, Menu, session } from 'electron';
import { isTestHarnessEnabled, OverlayController } from './overlay-controller';
import { registerClipboardIpc } from './clipboard-ipc';
import { registerOverlayIpc } from './overlay-ipc';
import { applySessionSecurity } from './window-security';
import { installDesktopShell, type DesktopShell } from './desktop-shell';
import { applyApplicationIdentity } from './app-identity';
import { handleDesktopActivate, handleSecondInstance } from './desktop-lifecycle';
import { notifyDashboardOpenFailure } from './dashboard-open-failure';
import { createShutdownFence } from './shutdown-fence';
import { resolveRendererDevServerUrl } from '../shared/renderer-url';

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:* ws://localhost:* http://localhost:*",
].join('; ');

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ');

function applyContentSecurityPolicy(devServerUrl?: string): void {
  const policy = devServerUrl ? DEV_CSP : PROD_CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const shuttingDown = createShutdownFence();
  let controller: OverlayController | null = null;
  let desktopShell: DesktopShell | null = null;
  let controllerReady = false;
  let pendingSecondInstance = false;

  app.setName('客服话术浮窗 Demo');

  const handleActivate = (): void => {
    // The Dock icon represents the full application surface. Keep the global
    // shortcut and fox click dedicated to quick query, and use Dock activation
    // for the manager-facing Dashboard as macOS users expect from a normal app.
    // `activate` is the one user-initiated path where stealing focus is
    // appropriate: a synthetic event in Electron tests does not itself make the
    // process active, while a real Dock click normally does.
    handleDesktopActivate(
      {
        isShuttingDown: () => shuttingDown.isShuttingDown(),
        isControllerReady: () => controllerReady,
        getController: () => controller,
      },
      {
        focusApp: process.platform === 'darwin'
          ? () => {
              app.focus({ steal: true });
            }
          : undefined,
        onFailure: (reason) => {
          if (!shuttingDown.isShuttingDown()) {
            void notifyDashboardOpenFailure(reason);
          }
        },
      },
    );
  };

  const beginShutdown = (): void => {
    shuttingDown.begin();
    controllerReady = false;
    app.removeListener('activate', handleActivate);
    const outgoing = controller;
    controller = null;
    desktopShell?.destroy();
    desktopShell = null;
    outgoing?.dispose();
  };

  app.on('second-instance', () => {
    handleSecondInstance(
      {
        isShuttingDown: () => shuttingDown.isShuttingDown(),
        isControllerReady: () => controllerReady,
        getController: () => controller,
      },
      {
        setPending: (pending) => {
          pendingSecondInstance = pending;
        },
      },
    );
  });

  void app.whenReady().then(async () => {
    const identity = await applyApplicationIdentity(shuttingDown);
    if (shuttingDown.isShuttingDown()) {
      return;
    }
    const rendererDevServerUrl = resolveRendererDevServerUrl(
      app.isPackaged,
      process.env.ELECTRON_RENDERER_URL,
    );
    applyContentSecurityPolicy(rendererDevServerUrl);
    applySessionSecurity(session.defaultSession);

    const testAccelerator = isTestHarnessEnabled()
      ? process.env.DEMO_E2E_ACCELERATOR
      : undefined;
    const next = new OverlayController({
      fence: shuttingDown,
      rendererDevServerUrl,
      ...(testAccelerator ? { accelerator: testAccelerator } : {}),
    });
    controller = next;
    registerClipboardIpc(
      () => controller?.trustedContents() ?? [],
      (contents) => controller?.overlayRoleOf(contents) ?? null,
      () => controller?.rendererDevServerUrl,
    );
    registerOverlayIpc(() => controller);
    await next.start();
    if (shuttingDown.isShuttingDown() || next.isDisposed()) {
      if (controller === next) {
        controller = null;
      }
      next.dispose();
      return;
    }
    desktopShell = installDesktopShell({
      controller: next,
      quit: () => {
        app.quit();
      },
    });
    if (isTestHarnessEnabled()) {
      Object.defineProperty(globalThis, '__demoDesktopShellTest', {
        value: {
          trayAvailable: () => desktopShell?.trayAvailable ?? false,
          applicationMenuLabels: () =>
            Menu.getApplicationMenu()?.getMenuItemById('customer-agent-menu')?.submenu?.items.map(
              (item) => item.label,
            ) ?? [],
          applicationMenuRoles: () =>
            Menu.getApplicationMenu()?.items.map((item) => item.role ?? item.label) ?? [],
          identity: () => identity,
          dockVisible: () => (process.platform === 'darwin' ? app.dock?.isVisible() ?? false : null),
          dockIconEmpty: () => identity.dockIconEmpty,
        },
        configurable: true,
        enumerable: false,
        writable: false,
      });
    }
    controllerReady = true;
    // Register only after both overlay renderers and the desktop shell are
    // ready. macOS can emit an initial `activate` while the app is launching;
    // not listening during that interval avoids mistaking startup for a Dock
    // click without swallowing a legitimate click immediately after ready.
    app.on('activate', handleActivate);
    if (pendingSecondInstance) {
      pendingSecondInstance = false;
      next.activateExisting();
    }
  }).catch((error: unknown) => {
    console.error('[bootstrap] 主进程启动失败，已安全退出。', error);
    if (!shuttingDown.isShuttingDown()) {
      beginShutdown();
      app.quit();
    }
  });

  app.on('before-quit', beginShutdown);
  app.on('will-quit', beginShutdown);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
