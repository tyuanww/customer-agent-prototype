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
import { registerDashboardWordingIpc } from './dashboard-wording-ipc';
import { bundledOfflineProfilePath, resolveProductProfile } from './product-runtime-config';
import { applyPackagedRetrievalDefaults } from './packaged-retrieval-paths';
import { app, Menu, screen, session } from 'electron';
import { OverlayController } from './overlay-controller';
import { isTestHarnessEnabled } from './overlay-test-harness';
import { registerClipboardIpc } from './clipboard-ipc';
import { registerOverlayIpc } from './overlay-ipc';
import { SopWindowController } from './sop-window-controller';
import { registerSopWindowIpc } from './sop-window-ipc';
import { sopWorkAreaForQuery } from '../shared/sop-geometry';
import { applySessionSecurity } from './window-security';
import { installDesktopShell, type DesktopShell } from './desktop-shell';
import { applyApplicationIdentity } from './app-identity';
import { handleDesktopActivate, handleSecondInstance } from './desktop-lifecycle';
import { notifyDashboardOpenFailure } from './dashboard-open-failure';
import { notifyStartupFailure } from './startup-failure-notice';
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

// Packaged userData is ~/Library/Application Support/<app.getName()>. The
// synthetic stack writes synthetic-stack.json under 客服话术浮窗 Demo. Name
// must be set before requestSingleInstanceLock(), which is the first API that
// materializes that path; otherwise a packaged build looks under
// @customer-agent/desktop and fail-closes.
app.setName('客服话术浮窗 Demo');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const shuttingDown = createShutdownFence();
  let controller: OverlayController | null = null;
  let sopController: SopWindowController | null = null;
  let desktopShell: DesktopShell | null = null;
  let controllerReady = false;
  let productSession: ProductSession | null = null;
  let productAnnounce: ProductAnnounce | null = null;
  let pendingSecondInstance = false;

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
    sopController = null;
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
    sopController = new SopWindowController({
      rendererDevServerUrl: () => controller?.rendererDevServerUrl,
      queryBounds: () => controller?.queryWindowBounds() ?? null,
      workArea: () => sopWorkAreaForQuery(
        controller?.queryWindowBounds() ?? null,
        screen.getPrimaryDisplay().workArea,
        (query) => screen.getDisplayMatching(query).workArea,
      ),
      sessionRole: () => {
        const view = productSession?.view();
        return view?.ok && view.signedIn ? view.role : null;
      },
    });
    const next = new OverlayController({
      fence: shuttingDown,
      rendererDevServerUrl,
      ...(testAccelerator ? { accelerator: testAccelerator } : {}),
      onDispose: () => sopController?.destroy(),
      onDashboardShown: () => sopController?.hideRememberingProgress(),
    });
    controller = next;
    registerClipboardIpc(
      () => controller?.trustedContents() ?? [],
      (contents) => controller?.overlayRoleOf(contents) ?? null,
      () => controller?.rendererDevServerUrl,
      () => productSession !== null,
    );
    registerOverlayIpc(() => controller);
    registerSopWindowIpc({
      getOverlay: () => controller,
      getSop: () => sopController,
    });
    // Development reads loopback origins from the environment; a packaged build
    // reads the same values from its own userData file so an installed client
    // can run the synthetic chain without any environment setup. Both paths are
    // validated to bare loopback origins. A packaged build ignores origin
    // environment variables and fail-closes if the file is missing or invalid.
    // Absence is not S0. Explicit `{ "mode": "synthetic-offline" }` starts S0.
    // Retrieval hydrate / BM25 use the known off-repo stack files, not leftover
    // `/v1/search`, and also must not require a developer shell.
    const userDataDirectory = app.getPath('userData');
    const productProfile = resolveProductProfile(
      app.isPackaged,
      userDataDirectory,
      process.env,
      app.isPackaged ? bundledOfflineProfilePath(process.resourcesPath) : undefined,
    );
    const identityOrigin = productProfile?.identityOrigin;
    if (productProfile) {
      applyPackagedRetrievalDefaults(process.env);
      productSession = new ProductSession(new ProductHttp(productProfile.apiOrigin),
        createSessionStore(userDataDirectory), createLoginWindow(productProfile.identityOrigin, productProfile.apiOrigin, () => controller?.rendererDevServerUrl));
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
    registerDashboardWordingIpc(
      () => controller?.dashboardWebContents() ?? null,
      () => controller?.rendererDevServerUrl,
    );
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
      // A packaged build that fails before any window exists has no other
      // visible surface, so the operator would only see the window flash and
      // disappear. The notice uses a native message box, which works without a
      // window and before ready, and offers 重试 where the operator can act.
      // The notice text depends only on the failure class; it never includes
      // the error message, the userData path or any configuration value. This
      // runs before beginShutdown() so it is not skipped by the fence, and the
      // fail-closed quit below is unchanged.
      void notifyStartupFailure(error);
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
