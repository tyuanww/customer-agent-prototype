import { registerContentIntakeCatalogIpc } from './content-intake-catalog-ipc';
import { registerContentIntakePermissionsIpc } from './content-intake-permissions-ipc';
import { registerSeatAccountIpc } from './seat-account-ipc';
import { registerContentIntakeManagementIpc } from './content-intake-management-ipc';
import { registerDeskKnowledgeIpc } from './desk-knowledge-ipc';
import { registerWorkbenchModeIpc } from './workbench-mode-ipc';
import { registerContentIntakeQueryIpc } from './content-intake-query-ipc';
import { registerProductSearchIpc } from './product-search-ipc';
import { ProductHttp } from './product-http';
import { ProductSession } from './product-session';
import { createSessionStore } from './product-session-store';
import { createLoginWindow, followAllowedLoginRedirects } from './product-login-window';
import { registerProductIpc } from './product-ipc';
import { readProductClientId } from './product-client-id';
import { ProductAnnounce } from './product-announce';
import { registerProductAnnounceIpc } from './product-announce-ipc';
import { createLastSeenStore } from './product-last-seen';
import { openSyntheticHelp } from './product-help-open';
import { registerProductCatalogIpc } from './product-catalog-ipc';
import { registerDashboardWordingIpc } from './dashboard-wording-ipc';
import { registerDashboardContentIpc } from './dashboard-content-ipc';
import { registerDashboardIterationIpc } from './dashboard-iteration-ipc';
import { serverUsageRows } from '../shared/usage-feed';
import { bindRemoteUsage, bindUsageFeed, registerUsageLogIpc, setUsageMount } from './usage-log-ipc';
import { createUsageJournal } from './usage-journal';
import { registerSopWorkbookIpc } from './sop-workbook-ipc';
import { registerDashboardOpsLoopIpc } from './dashboard-ops-loop-ipc';
import { bundledOfflineProfilePath, resolveProductProfile } from './product-runtime-config';
import { runningPointFromResolvedSession } from '../shared/running-identity';
import { persistHydrateFromEnv } from './hydrate-catalog.ts';
import { applyPackagedRetrievalDefaults } from './packaged-retrieval-paths';
import { scheduleRetrievalEmbeddingsFromEnv } from './retrieval-embeddings-store.ts';
import { join } from 'node:path';
import { app, Menu, screen, session, shell } from 'electron';
import {
  applyChromiumLoopbackProxyBypass,
  applySessionLoopbackProxyBypass,
  ensureNoProxyLoopback,
} from './loopback-proxy';
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

// Packaged userData is Electron's per-OS directory under app.getName(). The
// synthetic stack writes synthetic-stack.json under 客服话术浮窗 Demo. Name
// must be set before requestSingleInstanceLock(), which is the first API that
// materializes that path; otherwise a packaged build looks under
// @customer-agent/desktop and fail-closes.
app.setName('客服话术浮窗 Demo');
ensureNoProxyLoopback();
applyChromiumLoopbackProxyBypass(app.commandLine);
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
  let intakeManagement: ReturnType<typeof registerContentIntakeManagementIpc> | null = null;
  let deskKnowledge: ReturnType<typeof registerDeskKnowledgeIpc> | null = null;
  let intakePermissions: ReturnType<typeof registerContentIntakePermissionsIpc> | null = null;
  let seatAccounts: ReturnType<typeof registerSeatAccountIpc> | null = null;
  let disposeIntakeCatalog: (() => void) | null = null;
  let disposeIntakeQuery: (() => void) | null = null;
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
    intakeManagement?.dispose(); intakeManagement = null;
    deskKnowledge?.dispose(); deskKnowledge = null;
    intakePermissions?.dispose(); intakePermissions = null;
    seatAccounts?.dispose(); seatAccounts = null;
    disposeIntakeCatalog?.(); disposeIntakeCatalog = null;
    disposeIntakeQuery?.(); disposeIntakeQuery = null;
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
    try {
      await applySessionLoopbackProxyBypass(session.defaultSession);
    } catch {
      // Tests and hosts without session.setProxy still reach loopback via Node fetch.
    }

    const userDataDirectory = app.getPath('userData');
    const productProfile = resolveProductProfile(
      app.isPackaged,
      userDataDirectory,
      process.env,
      app.isPackaged ? bundledOfflineProfilePath(process.resourcesPath) : undefined,
    );
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
      dashboardEnabled: true,
      fence: shuttingDown,
      rendererDevServerUrl,
      runningPoint: runningPointFromResolvedSession(productProfile, app.isPackaged),
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
    const identityOrigin = productProfile?.identityOrigin;
    if (productProfile) {
      applyPackagedRetrievalDefaults(process.env, { apiOrigin: productProfile.apiOrigin });
      productSession = new ProductSession(new ProductHttp(productProfile.apiOrigin),
        createSessionStore(userDataDirectory, productProfile.apiOrigin), createLoginWindow(
          productProfile.identityOrigin,
          productProfile.apiOrigin,
          () => controller?.rendererDevServerUrl,
          {
            openExternal: isTestHarnessEnabled()
              ? followAllowedLoginRedirects(productProfile.identityOrigin, productProfile.apiOrigin)
              : (url) => shell.openExternal(url),
          },
        ));
      productSession.enableRemoteJobObservation();
      productAnnounce = new ProductAnnounce(
        productSession,
        readProductClientId(userDataDirectory),
        Date.now,
        persistHydrateFromEnv,
        (_releaseId, items) => { scheduleRetrievalEmbeddingsFromEnv(items); },
        createLastSeenStore(userDataDirectory, productProfile.apiOrigin),
      );
      await productSession.restore();
    }
    registerProductIpc(productSession, () => controller?.trustedContents() ?? [],
      contents => controller?.overlayRoleOf(contents) ?? null, () => controller?.rendererDevServerUrl,
      () => [controller?.dashboardWebContents() ?? null]);
    const hangzhouWorkbench = productProfile?.apiOrigin.startsWith('https://') === true;
    const workbenchSession = productProfile?.contentIntake === 'faq-v2' || hangzhouWorkbench ? productSession : null;
    disposeIntakeCatalog = registerContentIntakeCatalogIpc(workbenchSession,
      () => controller?.dashboardWebContents() ?? null, () => controller?.rendererDevServerUrl);
    intakePermissions = registerContentIntakePermissionsIpc(workbenchSession,
      () => controller?.dashboardWebContents() ?? null, () => controller?.rendererDevServerUrl);
    seatAccounts = registerSeatAccountIpc(
      () => controller?.dashboardWebContents() ?? null,
      () => controller?.rendererDevServerUrl,
      () => productProfile?.contentIntake === 'faq-v2' || hangzhouWorkbench,
      () => {
        const job = workbenchSession?.view().job ?? null;
        return job?.status === 'resolved' && job.rights.grant === true;
      });
    intakeManagement = registerContentIntakeManagementIpc(workbenchSession,
      () => controller?.dashboardWebContents() ?? null, () => controller?.rendererDevServerUrl, productProfile ?? null);
    registerWorkbenchModeIpc(productProfile ?? null,
      () => controller?.dashboardWebContents() ?? null, () => controller?.rendererDevServerUrl);
    deskKnowledge = registerDeskKnowledgeIpc(workbenchSession,
      () => controller?.dashboardWebContents() ?? null, () => controller?.rendererDevServerUrl, userDataDirectory);
    disposeIntakeQuery = registerContentIntakeQueryIpc(workbenchSession,
      () => controller?.trustedContents() ?? [], contents => controller?.overlayRoleOf(contents) ?? null,
      () => controller?.rendererDevServerUrl);
    // The shared Fox still reads unread in FAQ mode. A null service supplies the
    // existing unavailable projection without creating legacy I/O or missing IPC.
    registerProductAnnounceIpc(productAnnounce, () => controller?.trustedContents() ?? [],
      contents => controller?.overlayRoleOf(contents) ?? null, () => controller?.rendererDevServerUrl);
    const usageJournal = createUsageJournal(join(userDataDirectory, 'usage-journal.json'));
    bindUsageFeed((actorId) => usageJournal.read(actorId));
    if (productSession) {
      const session = productSession;
      bindRemoteUsage(async () => {
        const view = session.view();
        if (!view.signedIn) throw Object.assign(new Error('signed out'), { code: 'UNAUTHORIZED' });
        const result = await session.request(view.sessionEpoch, '/v1/events/usage');
        return serverUsageRows(result.value);
      });
      const applyUsage = () => {
        const view = session.view();
        setUsageMount(view.signedIn && view.userId
          ? { kind: 'signed-in', actorId: view.userId }
          : { kind: 'signed-out' });
      };
      session.subscribe(applyUsage);
      applyUsage();
    }
    registerUsageLogIpc(
      () => controller?.dashboardWebContents() ?? null,
      () => controller?.rendererDevServerUrl,
    );
    registerSopWorkbookIpc(
      () => controller?.dashboardWebContents() ?? null,
      () => controller?.rendererDevServerUrl,
    );
    registerProductSearchIpc(productSession, productAnnounce, () => controller?.trustedContents() ?? [],
      contents => controller?.overlayRoleOf(contents) ?? null, () => controller?.rendererDevServerUrl,
      identityOrigin ? { openEntry: () => openSyntheticHelp(identityOrigin) } : undefined,
      usageJournal);
    registerProductCatalogIpc(() => controller?.trustedContents() ?? [],
      contents => controller?.overlayRoleOf(contents) ?? null, () => controller?.rendererDevServerUrl);
    registerDashboardWordingIpc(
      () => controller?.dashboardWebContents() ?? null,
      () => controller?.rendererDevServerUrl,
      () => productAnnounce?.snapshotCatalog() ?? null,
    );
    registerDashboardContentIpc(
      productSession,
      () => controller?.dashboardWebContents() ?? null,
      () => controller?.rendererDevServerUrl,
      async (sessionEpoch) => {
        const announce = productAnnounce;
        if (!announce) return null;
        await announce.refresh({ sessionEpoch, generation: 0 });
        return announce.currentDomainCounts();
      },
    );
    registerDashboardIterationIpc(
      productSession,
      () => controller?.dashboardWebContents() ?? null,
      () => controller?.rendererDevServerUrl,
    );
    registerDashboardOpsLoopIpc(
      productSession,
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

  app.on('before-quit', event => {
    if (intakePermissions && !intakePermissions.allowClose()) { event.preventDefault(); return; }
    if (intakeManagement && !intakeManagement.allowClose()) { event.preventDefault(); return; }
    beginShutdown();
  });
  app.on('will-quit', beginShutdown);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
