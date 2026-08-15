import { app, Menu, session } from 'electron';
import { isTestHarnessEnabled, OverlayController } from './overlay-controller';
import { registerClipboardIpc } from './clipboard-ipc';
import { registerOverlayIpc } from './overlay-ipc';
import { applySessionSecurity } from './window-security';
import { installDesktopShell, type DesktopShell } from './desktop-shell';

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

function isDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL);
}

function applyContentSecurityPolicy(): void {
  const policy = isDev() ? DEV_CSP : PROD_CSP;
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
  let controller: OverlayController | null = null;
  let desktopShell: DesktopShell | null = null;
  let controllerReady = false;
  let pendingSecondInstance = false;

  app.setName('客服话术浮窗 Demo');

  app.on('second-instance', () => {
    if (!controllerReady) {
      pendingSecondInstance = true;
      return;
    }
    controller?.activateExisting();
  });

  app.whenReady().then(async () => {
    applyContentSecurityPolicy();
    applySessionSecurity(session.defaultSession);

    controller = new OverlayController();
    registerClipboardIpc(() => controller?.trustedContents() ?? []);
    registerOverlayIpc(() => controller);
    await controller.start();
    desktopShell = installDesktopShell({
      controller,
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
    app.on('activate', () => {
      if (!controller || !controllerReady) {
        return;
      }
      // The Dock icon represents the full application surface. Keep the global
      // shortcut and fox click dedicated to quick query, and use Dock activation
      // for the manager-facing Dashboard as macOS users expect from a normal app.
      // `activate` is the one user-initiated path where stealing focus is
      // appropriate: a synthetic event in Electron tests does not itself make the
      // process active, while a real Dock click normally does.
      if (process.platform === 'darwin') {
        app.focus({ steal: true });
      }
      void controller.openDashboard();
    });
    if (pendingSecondInstance) {
      pendingSecondInstance = false;
      controller.activateExisting();
    }
  });

  app.on('before-quit', () => {
    desktopShell?.destroy();
    desktopShell = null;
    controller?.unregisterShortcut();
  });

  app.on('will-quit', () => {
    desktopShell?.destroy();
    desktopShell = null;
    controller?.unregisterShortcut();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
