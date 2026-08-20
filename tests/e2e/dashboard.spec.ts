import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page, _electron as electron } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainEntry = path.join(repoRoot, 'out/main/index.js');
let launchSequence = 0;

type DemoHarness = {
  openDashboard: () => Promise<void>;
  closeDashboard: () => void;
  dashboardSnapshot: () => {
    visible: boolean;
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
    resizable: boolean;
    maximizable: boolean;
    alwaysOnTop: boolean;
    skipTaskbar: boolean;
    transparent: boolean;
    hasPreload: boolean;
    closable: boolean;
    title: string;
    titleBarStyle: 'default' | 'hiddenInset';
    integratedChrome: boolean;
  } | null;
  isDashboardTrusted: () => boolean;
};

type DesktopShellHarness = {
  trayAvailable: () => boolean;
  applicationMenuLabels: () => string[];
};

async function launchApp(): Promise<ElectronApplication> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-agent-demo-e2e-'));
  const shortcutKey = String.fromCharCode(90 - (launchSequence % 26));
  launchSequence += 1;
  try {
    const app = await electron.launch({
      cwd: repoRoot,
      args: [`--user-data-dir=${userDataDir}`, mainEntry, '--demo-e2e'],
      env: {
        ...process.env,
        DEMO_E2E: '1',
        DEMO_E2E_ACCELERATOR: `CommandOrControl+Alt+Shift+${shortcutKey}`,
      },
      timeout: 60_000,
    });
    app.process().once('exit', () => {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    });
    return app;
  } catch (error) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function waitForRole(
  app: ElectronApplication,
  role: 'fox' | 'query' | 'dashboard',
): Promise<Page> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const found = app.windows().find((page) => page.url().includes(`role=${role}`));
    if (found) return found;
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
  }
  throw new Error(`missing ${role} window`);
}

async function dashboardWindowState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const dashboards = BrowserWindow.getAllWindows().filter((win) =>
      win.webContents.getURL().includes('role=dashboard'),
    );
    return {
      count: dashboards.length,
      id: dashboards[0]?.webContents.id ?? null,
      visible: dashboards[0]?.isVisible() ?? false,
    };
  });
}

async function expectDashboardWithoutHorizontalOverflow(
  app: ElectronApplication,
  dashboard: Page,
  width: number,
  height: number,
) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const dashboardWin = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('role=dashboard'),
    );
    if (!dashboardWin) throw new Error('dashboard window missing');
    dashboardWin.setContentSize(size.width, size.height);
  }, { width, height });

  await expect.poll(() => dashboard.evaluate(() => window.innerWidth)).toBe(width);
  const layout = await dashboard.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const entries = [
      ['shell', document.querySelector('[data-testid="dashboard-shell"]')],
      ['main', document.querySelector('.dashboard-main')],
      ['content', document.querySelector('.dashboard-content')],
      ['module', document.querySelector('[data-testid="module-overview"]')],
    ] as const;
    return {
      documentOverflow: document.documentElement.scrollWidth - viewportWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      overflowingRegions: entries.flatMap(([name, element]) => {
        if (!(element instanceof HTMLElement)) return [`${name}:missing`];
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > viewportWidth + 1 ? [name] : [];
      }),
    };
  });
  expect(layout).toEqual({
    documentOverflow: 0,
    bodyOverflow: 0,
    overflowingRegions: [],
  });
}

test('opens one isolated Dashboard from trusted desktop entries', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');

    await fox.evaluate(async () => {
      await window.customerAgent?.openDashboard();
    });
    expect(await dashboardWindowState(app)).toEqual({ count: 0, id: null, visible: false });

    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('open-dashboard')).toBeVisible();
    await query.getByTestId('open-dashboard').evaluate((button: HTMLButtonElement) => {
      button.click();
    });

    const dashboard = await waitForRole(app, 'dashboard');
    await expect(dashboard.getByTestId('dashboard-shell')).toBeVisible();
    await expect(dashboard.getByTestId('module-overview')).toBeVisible();
    await expect(dashboard.getByTestId('dashboard-env-badges')).toHaveText('演示数据');
    await expect(dashboard.getByTestId('dashboard-disclaimer')).toHaveText('无后端 · 不保存');
    await expect(dashboard.getByTestId('dashboard-boundary-disclaimer')).toContainText(
      '话术正文与 VOC 明细均为合成镜像',
    );
    for (const [width, height] of [[980, 680], [1180, 760], [1440, 820]] as const) {
      await expectDashboardWithoutHorizontalOverflow(app, dashboard, width, height);
    }

    const desktopEntries = await app.evaluate(() => {
      const shell = (globalThis as { __demoDesktopShellTest?: DesktopShellHarness })
        .__demoDesktopShellTest;
      if (!shell) throw new Error('desktop shell test harness missing');
      return {
        trayAvailable: shell.trayAvailable(),
        applicationMenuLabels: shell.applicationMenuLabels(),
      };
    });
    expect(desktopEntries).toEqual({
      trayAvailable: true,
      applicationMenuLabels: ['打开话术查询', '打开运营工作台'],
    });

    expect(await dashboard.evaluate(() => ({
      customerAgent: typeof window.customerAgent,
      requireType: typeof (window as unknown as { require?: unknown }).require,
      processType: typeof (window as unknown as { process?: unknown }).process,
    }))).toEqual({
      customerAgent: 'undefined',
      requireType: 'undefined',
      processType: 'undefined',
    });

    const snapshot = await app.evaluate(() => {
      const demo = (globalThis as { __demoTest?: DemoHarness }).__demoTest;
      if (!demo) throw new Error('DEMO_E2E harness missing');
      return {
        window: demo.dashboardSnapshot(),
        trusted: demo.isDashboardTrusted(),
      };
    });
    expect(snapshot.trusted).toBe(false);
    expect(snapshot.window).toMatchObject({
      visible: true,
      resizable: true,
      maximizable: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      transparent: false,
      hasPreload: false,
      closable: true,
      title: '客服运营工作台 · 演示数据',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      integratedChrome: process.platform === 'darwin',
    });
    expect(snapshot.window?.width ?? 0).toBeGreaterThanOrEqual(snapshot.window?.minWidth ?? 1);
    expect(snapshot.window?.height ?? 0).toBeGreaterThanOrEqual(snapshot.window?.minHeight ?? 1);

    const first = await dashboardWindowState(app);
    await query.evaluate(async () => {
      await window.customerAgent?.openDashboard();
    });
    expect(await dashboardWindowState(app)).toEqual(first);

    await app.evaluate(() => {
      const demo = (globalThis as { __demoTest?: DemoHarness }).__demoTest;
      if (!demo) throw new Error('DEMO_E2E harness missing');
      demo.closeDashboard();
    });
    await expect.poll(() => dashboardWindowState(app)).toEqual({ count: 0, id: null, visible: false });
    await expect(fox.getByTestId('fox-button')).toBeVisible();

    await app.evaluate(() => {
      const demo = (globalThis as { __demoTest?: DemoHarness }).__demoTest;
      if (!demo) throw new Error('DEMO_E2E harness missing');
      return demo.openDashboard();
    });
    const reopened = await waitForRole(app, 'dashboard');
    await expect(reopened.getByTestId('dashboard-shell')).toBeVisible();
    expect((await dashboardWindowState(app)).count).toBe(1);
  } finally {
    await app.close();
  }
});

test('opens and restores the Dashboard from a macOS-style Dock activation', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');
    expect(await dashboardWindowState(app)).toEqual({ count: 0, id: null, visible: false });

    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('question-input')).toBeFocused();
    await app.evaluate(({ app: electronApp }) => {
      electronApp.emit('activate', {} as Electron.Event, true);
    });
    const dashboard = await waitForRole(app, 'dashboard');
    await expect(dashboard.getByTestId('dashboard-shell')).toBeVisible();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const dashboardWin = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('role=dashboard'),
      );
      const queryWin = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('role=query'),
      );
      return {
        dashboardVisible: Boolean(dashboardWin?.isVisible()),
        queryVisible: Boolean(queryWin?.isVisible()),
      };
    })).toEqual({ dashboardVisible: true, queryVisible: false });

    await app.evaluate(({ BrowserWindow }) => {
      const dashboardWin = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('role=dashboard'),
      );
      if (!dashboardWin) throw new Error('dashboard window missing');
      const originalIsMinimized = dashboardWin.isMinimized.bind(dashboardWin);
      const originalRestore = dashboardWin.restore.bind(dashboardWin);
      const probe = { simulatedMinimized: true, restoreCalls: 0 };
      Object.defineProperty(globalThis, '__demoDashboardRestoreProbe', {
        value: probe,
        configurable: true,
      });
      Object.defineProperty(dashboardWin, 'isMinimized', {
        configurable: true,
        value: () => probe.simulatedMinimized || originalIsMinimized(),
      });
      Object.defineProperty(dashboardWin, 'restore', {
        configurable: true,
        value: () => {
          probe.restoreCalls += 1;
          probe.simulatedMinimized = false;
          originalRestore();
        },
      });
      dashboardWin.hide();
    });
    await expect.poll(() => dashboardWindowState(app)).toMatchObject({ count: 1, visible: false });

    await app.evaluate(({ app: electronApp }) => {
      electronApp.emit('activate', {} as Electron.Event, true);
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const dashboards = BrowserWindow.getAllWindows().filter((win) =>
        win.webContents.getURL().includes('role=dashboard'),
      );
      const probe = (globalThis as {
        __demoDashboardRestoreProbe?: { restoreCalls: number };
      }).__demoDashboardRestoreProbe;
      return {
        count: dashboards.length,
        minimized: dashboards[0]?.isMinimized() ?? true,
        visible: dashboards[0]?.isVisible() ?? false,
        restoreCalls: probe?.restoreCalls ?? 0,
      };
    })).toEqual({ count: 1, minimized: false, visible: true, restoreCalls: 1 });
  } finally {
    await app.close();
  }
});
