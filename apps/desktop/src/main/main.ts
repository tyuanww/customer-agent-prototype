import { registerProductSearchIpc } from './product-search-ipc';
import { ProductHttp } from './product-http';
import { ProductSession } from './product-session';
import { createSessionStore } from './product-session-store';
import { createLoginWindow } from './product-login-window';
import { registerProductIpc } from './product-ipc';
import { readProductClientId } from './product-client-id';
import { ProductAnnounce } from './product-announce';
import { registerProductAnnounceIpc } from './product-announce-ipc';
import { openSyntheticHelp } from './product-help-open';
import { registerProductCatalogIpc } from './product-catalog-ipc';
import { resolveProductProfile } from './product-runtime-config';
import { app, Menu, session } from 'electron';
import { OverlayController } from './overlay-controller';
import { isTestHarnessEnabled } from './overlay-test-harness';
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
  let productSession: ProductSession | null = null;
  let productAnnounce: ProductAnnounce | null = null;
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
    void productSession?.shutdown();
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
      () => productSession !== null,
    );
    registerOverlayIpc(() => controller);
    // Development reads loopback origins from the environment; a packaged build
    // reads the same values from its own userData file so an installed client
    // can run the synthetic chain without any environment setup. Both paths are
    // validated to bare loopback origins. A packaged build ignores the
    // environment entirely and fail-closes if the file is missing or invalid,
    // so it cannot be repointed off-host or silently dropped to the S0 fixture.
    const userDataDirectory = app.getPath('userData');
    const productProfile = resolveProductProfile(app.isPackaged, userDataDirectory, process.env);
    const identityOrigin = productProfile?.identityOrigin;
    if (productProfile) {
      productSession = new ProductSession(new ProductHttp(productProfile.apiOrigin),
        createSessionStore(userDataDirectory), createLoginWindow(productProfile.identityOrigin, productProfile.apiOrigin));
      productAnnounce = new ProductAnnounce(productSession, readProductClientId(userDataDirectory));
      await productSession.restore();
    }
    registerProductSearchIpc(productSession, productAnnounce, () => controller?.trustedContents() ?? [],
      contents => controller?.overlayRoleOf(contents) ?? null, () => controller?.rendererDevServerUrl,
      identityOrigin ? { openEntry: () => openSyntheticHelp(identityOrigin) } : undefined);
    registerProductAnnounceIpc(productAnnounce, () => controller?.trustedContents() ?? [],
      contents => controller?.overlayRoleOf(contents) ?? null, () => controller?.rendererDevServerUrl);
    registerProductIpc(productSession, () => controller?.trustedContents() ?? [],
      contents => controller?.overlayRoleOf(contents) ?? null, () => controller?.rendererDevServerUrl);
    registerProductCatalogIpc(() => controller?.trustedContents() ?? [],
      contents => controller?.overlayRoleOf(contents) ?? null, () => controller?.rendererDevServerUrl);
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
