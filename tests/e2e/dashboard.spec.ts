import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page, _electron as electron } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainEntry = path.join(repoRoot, 'out/main/index.js');
const screenshotDir = path.join(repoRoot, '.gstack/qa-reports/screenshots');

type DemoHarness = {
  expand: () => void;
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
  } | null;
  isDashboardTrusted: () => boolean;
};

type DesktopShellHarness = {
  trayAvailable: () => boolean;
  applicationMenuLabels: () => string[];
};

async function launchApp(): Promise<ElectronApplication> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-agent-demo-e2e-'));
  try {
    const app = await electron.launch({
      cwd: repoRoot,
      args: [`--user-data-dir=${userDataDir}`, mainEntry, '--demo-e2e'],
      env: {
        ...process.env,
        DEMO_E2E: '1',
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
    if (found) {
      return found;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
  }
  throw new Error(`missing ${role} window`);
}

async function setDashboardSize(
  app: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=dashboard'),
      );
      if (!win) throw new Error('dashboard window missing');
      win.setSize(size.width, size.height);
      win.center();
    },
    { width, height },
  );
}

async function readDashboardLayout(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-testid="dashboard-shell"]');
    const main = document.querySelector<HTMLElement>('.dashboard-main');
    const content = document.querySelector<HTMLElement>('[data-testid="dashboard-content"]');
    const topbar = document.querySelector<HTMLElement>('.dashboard-topbar');
    if (!shell || !main || !content || !topbar) throw new Error('dashboard layout missing');
    const shellRect = shell.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const topbarRect = topbar.getBoundingClientRect();
    const descendantEntries = Array.from(content.querySelectorAll<HTMLElement>('*'))
      .filter((node) => getComputedStyle(node).position !== 'fixed')
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0.5 && rect.height > 0.5);
    const descendantRects = descendantEntries.map(({ rect }) => rect);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      shellOverflow: shell.scrollWidth - shell.clientWidth,
      mainOverflow: main.scrollWidth - main.clientWidth,
      contentOverflow: content.scrollWidth - content.clientWidth,
      contentChromeWidth: content.offsetWidth - content.clientWidth,
      descendantLeftOverflow: Math.max(
        0,
        ...descendantRects.map((rect) => contentRect.left - rect.left),
      ),
      descendantRightOverflow: Math.max(
        0,
        ...descendantRects.map((rect) => rect.right - contentRect.right),
      ),
      rightOverflowNodes: descendantEntries
        .map(({ node, rect }) => ({
          element: `${node.tagName.toLowerCase()}.${node.className || ''}`,
          testId: node.dataset.testid ?? '',
          overflow: rect.right - contentRect.right,
        }))
        .filter((item) => item.overflow > 1)
        .sort((left, right) => right.overflow - left.overflow)
        .slice(0, 5),
      contentScrollable: content.scrollHeight > content.clientHeight,
      contentScrollTop: content.scrollTop,
      shellRect: { left: shellRect.left, right: shellRect.right, width: shellRect.width },
      topbarRect: { top: topbarRect.top, bottom: topbarRect.bottom },
    };
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await readDashboardLayout(page);
  expect(layout.documentOverflow).toBeLessThanOrEqual(1);
  expect(layout.bodyOverflow).toBeLessThanOrEqual(1);
  expect(layout.shellOverflow).toBeLessThanOrEqual(1);
  expect(layout.mainOverflow).toBeLessThanOrEqual(1);
  // Chromium may include the reserved vertical scrollbar gutter in scrollWidth.
  // It is not horizontal content overflow as long as it is no wider than the
  // element chrome and no descendant crosses the content border box.
  expect(layout.contentOverflow).toBeLessThanOrEqual(
    Math.max(layout.contentChromeWidth + 2, 20),
  );
  expect(layout.descendantLeftOverflow).toBeLessThanOrEqual(1);
  expect(
    layout.descendantRightOverflow,
    `right overflow nodes: ${JSON.stringify(layout.rightOverflowNodes)}`,
  ).toBeLessThanOrEqual(1);
  expect(layout.shellRect.left).toBeGreaterThanOrEqual(0);
  expect(layout.shellRect.right).toBeLessThanOrEqual(layout.viewport.width + 1);
}

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test('opens a singleton mock dashboard from safe desktop entries', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');

    await fox.evaluate(async () => {
      await window.customerAgent?.openDashboard();
    });
    await fox.waitForTimeout(300);
    expect(app.windows().some((page) => page.url().includes('role=dashboard'))).toBe(false);

    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('open-dashboard')).toBeVisible();
    await query.getByTestId('open-dashboard').click();

    const dashboard = await waitForRole(app, 'dashboard');
    await expect(dashboard.getByTestId('dashboard-shell')).toBeVisible();
    await expect(dashboard.getByTestId('module-overview')).toBeVisible();
    await expect(dashboard.getByTestId('dashboard-env-badges')).toHaveText('演示数据');
    await expect(dashboard.getByTestId('dashboard-disclaimer')).toContainText(
      '话术正文与 VOC 明细均为合成镜像',
    );
    await expect(dashboard.getByTestId('dashboard-disclaimer')).toContainText('无后端');
    await dashboard.getByText('演示环境').click();
    await expect(dashboard.getByTestId('dashboard-boundary-details')).toContainText('MOCK AUTH');
    await expect(dashboard.getByTestId('dashboard-boundary-details')).toContainText('NO BACKEND');
    await dashboard.getByText('演示环境').click();
    await expect(dashboard.getByTestId('dashboard-boundary-details')).not.toHaveAttribute('open', '');

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

    const defaultChartTops = await dashboard.locator('.overview-chart-grid > .dash-chart-card').evaluateAll(
      (nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
    );
    expect(defaultChartTops).toHaveLength(2);
    expect(Math.abs(defaultChartTops[0] - defaultChartTops[1])).toBeLessThanOrEqual(1);

    await setDashboardSize(app, 980, 680);
    await expect(dashboard.getByTestId('nav-overview')).toBeVisible();
    await expectNoHorizontalOverflow(dashboard);
    expect((await readDashboardLayout(dashboard)).contentScrollable).toBe(true);
    const compactChartTops = await dashboard.locator('.overview-chart-grid > .dash-chart-card').evaluateAll(
      (nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
    );
    expect(compactChartTops[1] - compactChartTops[0]).toBeGreaterThan(100);

    await dashboard.getByTestId('overview-trend-metric-noHitRate').click();
    await expect(dashboard.getByTestId('overview-trend-feedback')).toContainText('8.4%');
    await dashboard.getByTestId('overview-trend-point-0').click();
    await expect(dashboard.getByTestId('overview-trend-feedback')).toContainText('12.8%');
    await dashboard.getByTestId('overview-structure-risk_escalated').click();
    await expect(dashboard.getByTestId('overview-structure-feedback')).toContainText('必须人工处理');
    const content = dashboard.getByTestId('dashboard-content');
    await content.evaluate((node) => { node.scrollTop = 0; });
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-overview-980-top.png') });

    const topbarTop = await dashboard.locator('.dashboard-topbar').evaluate(
      (node) => node.getBoundingClientRect().top,
    );
    await content.hover({ position: { x: 24, y: 180 } });
    await dashboard.mouse.wheel(0, 900);
    await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBeGreaterThan(250);
    expect(await dashboard.locator('.dashboard-topbar').evaluate(
      (node) => node.getBoundingClientRect().top,
    )).toBe(topbarTop);
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-overview-980-middle.png') });
    await dashboard.mouse.wheel(0, -4000);
    await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(1);

    const nonDragSurface = dashboard.locator('#manager-decisions-title');
    const dragBox = await nonDragSurface.boundingBox();
    if (!dragBox) throw new Error('dashboard content surface missing');
    const dragX = dragBox.x + dragBox.width / 2;
    const dragStartY = dragBox.y + dragBox.height / 2;
    const scrollBeforeDrag = await content.evaluate((node) => node.scrollTop);
    await dashboard.mouse.move(dragX, dragStartY);
    await dashboard.mouse.down();
    await dashboard.mouse.move(dragX, Math.max(12, dragStartY - 180), { steps: 8 });
    await dashboard.mouse.up();
    expect(await content.evaluate((node) => node.scrollTop)).toBe(scrollBeforeDrag);
    await expect(content).not.toHaveAttribute('data-drag-scrolling');
    await dashboard.evaluate(() => window.getSelection()?.removeAllRanges());
    await content.evaluate((node) => { node.scrollTop = 0; });

    const defaultNavWidth = await dashboard.locator('.dashboard-nav').evaluate(
      (node) => node.getBoundingClientRect().width,
    );
    const defaultMainWidth = await dashboard.locator('.dashboard-main').evaluate(
      (node) => node.getBoundingClientRect().width,
    );
    const navResizer = dashboard.getByTestId('dashboard-nav-resizer');
    await expect(navResizer).toHaveAttribute('role', 'separator');
    await expect(navResizer).toHaveAttribute('aria-orientation', 'vertical');
    const resizerBox = await navResizer.boundingBox();
    if (!resizerBox) throw new Error('dashboard navigation resizer missing');
    await dashboard.mouse.move(resizerBox.x + (resizerBox.width / 2), resizerBox.y + 180);
    await dashboard.mouse.down();
    await dashboard.mouse.move(320, resizerBox.y + 180, { steps: 8 });
    await dashboard.mouse.up();
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBeGreaterThanOrEqual(316);
    const expandedNavWidth = await dashboard.locator('.dashboard-nav').evaluate(
      (node) => node.getBoundingClientRect().width,
    );
    const expandedMainWidth = await dashboard.locator('.dashboard-main').evaluate(
      (node) => node.getBoundingClientRect().width,
    );
    expect(expandedNavWidth).toBeGreaterThan(defaultNavWidth);
    expect(expandedMainWidth).toBeLessThan(defaultMainWidth);
    await expect(navResizer).toHaveAttribute('aria-valuenow', String(Math.round(expandedNavWidth)));
    const expandedIconRects = await dashboard.locator('.dashboard-nav-icon').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      }),
    );
    const expandedLogoRect = await dashboard.getByTestId('dashboard-brand-logo').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    const navToggle = dashboard.getByTestId('dashboard-nav-toggle');
    const closePanelIcon = navToggle.locator('.dashboard-nav-toggle-icon__state.is-close');
    const openPanelIcon = navToggle.locator('.dashboard-nav-toggle-icon__state.is-open');
    await expect(navToggle.locator('.dashboard-nav-toggle-icon__state')).toHaveCount(2);
    await expect(closePanelIcon).toHaveCSS('opacity', '1');
    await expect(openPanelIcon).toHaveCSS('opacity', '0');
    await expect(dashboard.getByTestId('nav-workorder-trash')).toBeDisabled();
    await expect(dashboard.getByTestId('nav-workorder-trash')).toHaveAccessibleName(
      '工单垃圾桶，二期待实施',
    );
    await navToggle.click();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-collapsed',
      'true',
    );
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(72);
    await expect(closePanelIcon).toHaveCSS('opacity', '0');
    await expect(openPanelIcon).toHaveCSS('opacity', '1');
    await expect(navResizer).toBeHidden();
    expect(await dashboard.locator('.dashboard-main').evaluate(
      (node) => node.getBoundingClientRect().width,
    )).toBeGreaterThan(expandedMainWidth);
    expect(expandedNavWidth).toBeGreaterThan(defaultNavWidth);
    const collapsedIconRects = await dashboard.locator('.dashboard-nav-icon').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      }),
    );
    const collapsedLogoRect = await dashboard.getByTestId('dashboard-brand-logo').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    expect(collapsedIconRects).toHaveLength(expandedIconRects.length);
    collapsedIconRects.forEach((rect, index) => {
      expect(Math.abs(rect.x - expandedIconRects[index].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(rect.y - expandedIconRects[index].y)).toBeLessThanOrEqual(1);
    });
    expect(Math.abs(collapsedLogoRect.x - expandedLogoRect.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsedLogoRect.y - expandedLogoRect.y)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(dashboard);
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-nav-collapsed.png') });
    await dashboard.getByTestId('nav-overview').hover();
    await expect(dashboard.getByTestId('dashboard-nav-tooltip')).toHaveText('管理概览');
    await expect(dashboard.getByTestId('dashboard-nav-tooltip')).toHaveClass(/is-visible/);
    await dashboard.getByTestId('nav-overview').focus();
    await dashboard.keyboard.press('Escape');
    await expect(dashboard.getByTestId('dashboard-nav-tooltip')).toHaveCount(0);
    const collapsedToggle = dashboard.getByTestId('dashboard-nav-toggle');
    await expect(collapsedToggle).toHaveAttribute('data-variant', 'expand-overlay');
    await dashboard.locator('.dashboard-main').hover({ position: { x: 300, y: 300 } });
    await expect.poll(() => collapsedToggle.evaluate((node) => getComputedStyle(node).opacity)).toBe('0');
    await expect(collapsedToggle).toHaveCSS('pointer-events', 'none');
    await dashboard.getByTestId('dashboard-brand').hover();
    await expect.poll(() => collapsedToggle.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    await expect(collapsedToggle).toHaveCSS('pointer-events', 'auto');
    await expect.poll(() => collapsedToggle.evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(40);
    const overlayRect = await collapsedToggle.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect(Math.abs(overlayRect.x - collapsedLogoRect.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayRect.y - collapsedLogoRect.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayRect.width - 40)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayRect.height - 40)).toBeLessThanOrEqual(1);
    await collapsedToggle.click();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-collapsed',
      'false',
    );
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(Math.round(expandedNavWidth));
    await expect(closePanelIcon).toHaveCSS('opacity', '1');
    await expect(openPanelIcon).toHaveCSS('opacity', '0');
    await expect(navResizer).toBeVisible();
    await dashboard.getByTestId('dashboard-nav-toggle').click();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-collapsed',
      'true',
    );
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(72);
    const keyboardToggle = dashboard.getByTestId('dashboard-nav-toggle');
    await dashboard.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // Establish keyboard input modality before focusing the overlay control;
    // Electron/macOS does not always include buttons in native Tab traversal.
    await dashboard.keyboard.press('Tab');
    await keyboardToggle.focus();
    await expect(keyboardToggle).toBeFocused();
    await expect.poll(() => keyboardToggle.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    expect(await keyboardToggle.evaluate((node) => parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThanOrEqual(2);
    await keyboardToggle.press('Enter');
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-collapsed',
      'false',
    );
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(Math.round(expandedNavWidth));
    await expectNoHorizontalOverflow(dashboard);

    const themeSwitcher = dashboard.getByTestId('dashboard-theme-switcher');
    await expect(themeSwitcher).toBeVisible();
    await dashboard.getByTestId('dashboard-theme-dark').click();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-theme', 'dark');
    await dashboard.waitForTimeout(180);
    const darkCanvas = await dashboard.locator('html').evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-overview-dark.png') });
    await dashboard.getByTestId('dashboard-theme-light').click();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-theme', 'light');
    const lightCanvas = await dashboard.locator('html').evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    expect(lightCanvas).not.toBe(darkCanvas);
    await dashboard.emulateMedia({ colorScheme: 'dark' });
    await dashboard.getByTestId('dashboard-theme-system').click();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-theme', 'dark');
    await dashboard.emulateMedia({ colorScheme: 'light' });
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-theme', 'light');

    const moduleIds = [
      'overview',
      'workorders',
      'ledger',
      'review',
      'wording',
      'iteration',
      'content',
      'announce',
      'architecture',
    ] as const;
    for (const moduleId of moduleIds) {
      await dashboard.getByTestId(`nav-${moduleId}`).click();
      await expect(dashboard.getByTestId(`module-${moduleId}`)).toBeVisible();
    }
    await dashboard.getByTestId('nav-review').click();
    await dashboard.getByTestId('review-dimension-sent').click();
    await expect(dashboard.getByTestId('review-dimension-panel')).toContainText('是否实际发送给客户');
    await expect(dashboard.getByTestId('review-inference-boundary')).toContainText('不能推断已发送');
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-review.png') });
    await dashboard.getByTestId('nav-overview').click();
    await expect(dashboard.getByTestId('module-overview')).toBeVisible();
    await dashboard.keyboard.press('ArrowDown');
    await expect(dashboard.getByTestId('nav-workorders')).toBeFocused();
    await expect(dashboard.getByTestId('module-workorders')).toBeVisible();

    const isolation = await dashboard.evaluate(() => ({
      customerAgent: typeof window.customerAgent,
      requireType: typeof (window as unknown as { require?: unknown }).require,
      processType: typeof (window as unknown as { process?: unknown }).process,
    }));
    expect(isolation).toEqual({
      customerAgent: 'undefined',
      requireType: 'undefined',
      processType: 'undefined',
    });

    const snapshot = await app.evaluate(() => {
      const demo = (globalThis as { __demoTest?: DemoHarness }).__demoTest;
      if (!demo) {
        throw new Error('DEMO_E2E harness missing');
      }
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
    });
    expect(snapshot.window?.minWidth).toBeGreaterThanOrEqual(980);
    expect(snapshot.window?.minHeight).toBeGreaterThanOrEqual(680);
    expect(snapshot.window?.width).toBeGreaterThanOrEqual(980);
    expect(snapshot.window?.height).toBeGreaterThanOrEqual(680);

    await expect.poll(async () =>
      app.evaluate(({ BrowserWindow }) => {
        const foxWin = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().includes('role=fox'),
        );
        const queryWin = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().includes('role=query'),
        );
        return {
          foxVisible: Boolean(foxWin?.isVisible()),
          queryVisible: Boolean(queryWin?.isVisible()),
        };
      }),
    ).toEqual({ foxVisible: true, queryVisible: false });

    await dashboard.getByTestId('nav-overview').click();
    await dashboard.getByTestId('nav-overview').focus();
    await expect(dashboard.getByTestId('nav-overview')).toHaveClass(/is-active/);
    await expect(dashboard.getByTestId('nav-architecture')).not.toHaveClass(/is-active/);
    await setDashboardSize(app, 1180, 760);
    await expectNoHorizontalOverflow(dashboard);
    await dashboard.waitForTimeout(180);
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-overview.png') });
    await dashboard.getByTestId('nav-workorders').click();
    await expect(dashboard.getByTestId('voc-period-ticket-count')).toHaveText('2,400');
    await dashboard.getByTestId('voc-grain-month').click();
    await expect(dashboard.getByTestId('voc-period-filter')).toHaveValue('month-2026-08');
    await expect(dashboard.getByTestId('voc-period-ticket-count')).toHaveText('820');
    await dashboard.getByTestId('voc-grain-day').click();
    await expect(dashboard.getByTestId('voc-period-filter')).toHaveValue('day-2026-08-13');
    await expect(dashboard.getByTestId('voc-period-ticket-count')).toHaveText('122');
    await dashboard.getByTestId('voc-reset').click();
    await expect(dashboard.getByTestId('voc-period-filter')).toHaveValue('year-2026');
    await dashboard.getByTestId('voc-severity-risk').click();
    await expect(dashboard.getByTestId('voc-filter-status')).toContainText('148 条合成聚合');
    await dashboard.getByTestId('voc-heat-foreign-matter-0').click();
    await expect(dashboard.getByTestId('voc-product-filter')).toHaveValue('面膜');
    await expect(dashboard.getByTestId('voc-detail')).toContainText('人工升级');
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-voc.png') });
    await dashboard.getByTestId('nav-wording').click();
    await dashboard.getByTestId('wording-domain-presale').click();
    await expect(dashboard.getByTestId('wording-source-readiness')).toContainText('UPSTREAM_AUTHORING');
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-wording.png') });
    await dashboard.getByTestId('nav-ledger').click();
    await expect(dashboard.getByTestId('module-ledger')).toBeVisible();
    await expect(dashboard.getByTestId('ledger-table')).toContainText('已复制 · 未发生发送');
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-ledger.png') });
    await dashboard.getByTestId('nav-content').click();
    await expect(dashboard.getByTestId('publish-action')).toBeDisabled();
    await dashboard.getByTestId('nav-announce').click();
    await dashboard.getByRole('button', { name: '夜间增量公告（合成）' }).click();
    const announceRow = dashboard.getByRole('button', { name: '夜间增量公告（合成）' }).locator('..').locator('..');
    const announceFacetsBefore = await announceRow.textContent();
    await dashboard.getByTestId('announce-push-action').click();
    await expect(dashboard.getByTestId('announce-push-status')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(dashboard.getByTestId('announce-push-status')).toHaveAttribute(
      'data-state',
      'success',
    );
    await expect(dashboard.getByTestId('announce-push-status')).toContainText('未发送');
    expect(await announceRow.textContent()).toBe(announceFacetsBefore);
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-announce-simulation.png') });
    await dashboard.getByTestId('nav-architecture').click();
    await expect(dashboard.getByTestId('architecture-map')).toBeVisible();
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-architecture.png') });

    await setDashboardSize(app, 1440, 900);
    await dashboard.getByTestId('nav-overview').click();
    await dashboard.getByTestId('nav-overview').focus();
    await expect(dashboard.getByTestId('nav-overview')).toHaveClass(/is-active/);
    await expect(dashboard.getByTestId('nav-architecture')).not.toHaveClass(/is-active/);
    await expectNoHorizontalOverflow(dashboard);
    await dashboard.waitForTimeout(180);
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-overview-1440.png') });

    await query.evaluate(async () => {
      await window.customerAgent?.openDashboard();
    });
    expect(app.windows().filter((page) => page.url().includes('role=dashboard'))).toHaveLength(1);

    await app.evaluate(() => {
      const demo = (globalThis as { __demoTest?: DemoHarness }).__demoTest;
      demo?.closeDashboard();
    });
    await expect
      .poll(() => app.windows().some((page) => page.url().includes('role=dashboard')))
      .toBe(false);
    await expect(fox.getByTestId('fox-button')).toBeVisible();

    await app.evaluate(() => {
      const demo = (globalThis as { __demoTest?: DemoHarness }).__demoTest;
      return demo?.openDashboard();
    });
    const reopened = await waitForRole(app, 'dashboard');
    await expect(reopened.getByTestId('dashboard-shell')).toBeVisible();
    await expect(fox.getByTestId('fox-button')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('opens and restores the Dashboard from a macOS-style Dock activation', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');
    expect(app.windows().some((page) => page.url().includes('role=dashboard'))).toBe(false);

    await fox.getByTestId('fox-button').click();
    await expect(query.getByTestId('question-input')).toBeFocused();
    await app.evaluate(({ app }) => {
      app.emit('activate', {} as Electron.Event, true);
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
    // app.emit('activate') exercises the production handler but is not a real
    // macOS Dock click, so WindowServer may keep Codex/the test runner frontmost.
    // Visibility, restoration and singleton semantics are deterministic here;
    // physical focus delivery stays in the manual Dock acceptance check.

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
      // Synthetic app.emit('activate') does not establish a real macOS Dock /
      // WindowServer session, so native minimize() is a no-op in headless E2E.
      // Hide the existing window and simulate only the isMinimized contract;
      // openDashboard still runs its real restore/show/singleton path.
      dashboardWin.hide();
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
      Boolean(BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('role=dashboard'),
      )?.isVisible()),
    )).toBe(false);
    await app.evaluate(({ app }) => {
      app.emit('activate', {} as Electron.Event, true);
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
