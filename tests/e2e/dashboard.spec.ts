import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page, _electron as electron } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainEntry = path.join(repoRoot, 'out/main/index.js');
const screenshotDir = path.join(repoRoot, '.gstack/qa-reports/screenshots');
let launchSequence = 0;

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

function parseCssColor(value: string): [number, number, number, number] | null {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

function compositeOver(source: [number, number, number, number], backdrop: [number, number, number, number]): [number, number, number] {
  const alpha = source[3];
  return [
    source[0] * alpha + backdrop[0] * (1 - alpha),
    source[1] * alpha + backdrop[1] * (1 - alpha),
    source[2] * alpha + backdrop[2] * (1 - alpha),
  ];
}

function averageRgbDelta(left: [number, number, number], right: [number, number, number]) {
  return (
    Math.abs(left[0] - right[0])
    + Math.abs(left[1] - right[1])
    + Math.abs(left[2] - right[2])
  ) / 3;
}

async function expectSidebarMainContrast(page: Page) {
  const colors = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-testid="dashboard-shell"]');
    const nav = document.querySelector<HTMLElement>('.dashboard-nav');
    const main = document.querySelector<HTMLElement>('.dashboard-main');
    if (!shell || !nav || !main) throw new Error('material fixtures missing');
    const parse = (value: string): [number, number, number, number] => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return [0, 0, 0, 1];
      const parts = match[1].split(',').map((part) => Number(part.trim()));
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    const canvas = parse(getComputedStyle(shell).backgroundColor);
    const sidebar = parse(getComputedStyle(nav).backgroundColor);
    const content = parse(getComputedStyle(main).backgroundColor);
    const filter = getComputedStyle(nav).backdropFilter || getComputedStyle(nav).getPropertyValue('-webkit-backdrop-filter');
    return {
      canvas,
      sidebar,
      content,
      mainFilter: getComputedStyle(main).backdropFilter || getComputedStyle(main).getPropertyValue('-webkit-backdrop-filter'),
      sidebarFilter: filter,
    };
  });
  expect(colors.content[3]).toBe(1);
  expect(colors.mainFilter === '' || colors.mainFilter === 'none').toBe(true);
  const visualSidebar = compositeOver(colors.sidebar, colors.canvas);
  const visualMain: [number, number, number] = [colors.content[0], colors.content[1], colors.content[2]];
  expect(averageRgbDelta(visualSidebar, visualMain)).toBeGreaterThanOrEqual(9);
}

function expectUsedColor(actual: string, expected: string) {
  const left = parseCssColor(actual);
  const right = parseCssColor(expected);
  expect(left, `unparsable actual color: ${actual}`).not.toBeNull();
  expect(right, `unparsable expected color: ${expected}`).not.toBeNull();
  expect(left![0], `color mismatch ${actual} vs ${expected}`).toBe(right![0]);
  expect(left![1], `color mismatch ${actual} vs ${expected}`).toBe(right![1]);
  expect(left![2], `color mismatch ${actual} vs ${expected}`).toBe(right![2]);
  expect(Math.abs(left![3] - right![3])).toBeLessThanOrEqual(0.01);
}

async function usedTokenValue(
  page: Page,
  token: string,
  property: 'color' | 'backgroundColor' = 'color',
): Promise<string> {
  return page.evaluate(({ tokenName, cssProperty }) => {
    const shell = document.querySelector('[data-testid="dashboard-shell"]');
    if (!shell) throw new Error('dashboard shell missing');
    const probe = document.createElement('span');
    probe.style[cssProperty] = `var(${tokenName})`;
    shell.append(probe);
    const value = getComputedStyle(probe)[cssProperty];
    probe.remove();
    return value;
  }, { tokenName: token, cssProperty: property });
}

async function readBackdropFilterHits(page: Page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll<HTMLElement>('*')].flatMap((node) => {
      const style = getComputedStyle(node);
      const filter = style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
      if (!filter || filter === 'none') return [];
      return [{
        className: typeof node.className === 'string' ? node.className : '',
        filter,
        allowed: node.matches('.dashboard-nav, .dashboard-nav-tooltip, .dashboard-theme-popover'),
      }];
    });
  });
}

async function readCollapseGeometry(page: Page) {
  return page.evaluate(() => {
    const logo = document.querySelector('[data-testid="dashboard-brand-logo"]');
    const collapse = document.querySelector('[data-testid="dashboard-nav-toggle"]');
    const nav = document.querySelector('.dashboard-nav');
    const main = document.querySelector('.dashboard-main');
    const shell = document.querySelector('[data-testid="dashboard-shell"]');
    if (!logo || !nav || !main || !shell) throw new Error('collapse geometry missing');
    const logoRect = logo.getBoundingClientRect();
    const collapseRect = collapse?.getBoundingClientRect();
    return {
      phase: shell.getAttribute('data-nav-phase'),
      logo: { x: logoRect.x, y: logoRect.y },
      icons: [...document.querySelectorAll('.dashboard-nav-icon')].map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      }),
      collapse: collapse && collapseRect
        ? {
          x: collapseRect.x,
          y: collapseRect.y,
          right: collapseRect.right,
          opacity: Number(getComputedStyle(collapse).opacity),
        }
        : null,
      navRight: nav.getBoundingClientRect().right,
      mainLeft: main.getBoundingClientRect().left,
    };
  });
}

async function readStructureBoundary(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-testid="dashboard-shell"]');
    const nav = document.querySelector<HTMLElement>('.dashboard-nav');
    const main = document.querySelector<HTMLElement>('.dashboard-main');
    const topbar = document.querySelector<HTMLElement>('.dashboard-topbar');
    const island = document.querySelector<HTMLElement>('[data-testid="dashboard-titlebar-control-island"]');
    const resizer = document.querySelector<HTMLElement>('[data-testid="dashboard-nav-resizer"]');
    if (!shell || !nav || !main || !topbar || !island) throw new Error('structure boundary fixtures missing');
    const navBox = nav.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    const topbarBox = topbar.getBoundingClientRect();
    const islandBox = island.getBoundingClientRect();
    const toggle = document.querySelector<HTMLElement>('[data-testid="dashboard-nav-toggle"]');
    const toggleBox = toggle?.getBoundingClientRect();
    const islandStyle = getComputedStyle(island);
    const navAfter = getComputedStyle(nav, '::after');
    const parseAlpha = (color: string) => {
      const match = color.match(/rgba?\(([^)]+)\)/);
      if (!match) return color === 'transparent' ? 0 : 1;
      const parts = match[1].split(',').map((part) => Number(part.trim()));
      return parts.length >= 4 ? parts[3] : 1;
    };
    const afterRightPx = Number.parseFloat(navAfter.right) || 0;
    const afterWidthPx = Number.parseFloat(navAfter.width) || 0;
    const visualDividerX = navBox.right - afterRightPx - (afterWidthPx / 2);
    const midY = navBox.top + Math.min(navBox.height / 2, 240);
    const resizerHit = document.elementFromPoint(navBox.right, midY);
    return {
      phase: shell.getAttribute('data-nav-phase'),
      resizing: shell.getAttribute('data-nav-resizing'),
      lastExpandedWidth: Number(shell.getAttribute('data-last-expanded-width')),
      navWidth: Math.round(navBox.width),
      navRight: navBox.right,
      mainLeft: mainBox.left,
      topbarLeft: topbarBox.left,
      dividerX: visualDividerX,
      toggleRight: toggleBox?.right ?? 0,
      islandRight: islandBox.right,
      islandBackground: islandStyle.backgroundColor,
      islandBackgroundAlpha: parseAlpha(islandStyle.backgroundColor),
      islandBorderRight: islandStyle.borderRightWidth,
      islandFilter: islandStyle.backdropFilter || islandStyle.getPropertyValue('-webkit-backdrop-filter'),
      navAfterContent: navAfter.content,
      navAfterDisplay: navAfter.display,
      navAfterWidth: navAfter.width,
      navAfterRight: navAfter.right,
      navAfterTop: navAfter.top,
      navAfterBottom: navAfter.bottom,
      navAfterHeight: navAfter.height,
      navAfterAlpha: parseAlpha(navAfter.backgroundColor),
      structureBoundary: getComputedStyle(shell).getPropertyValue('--dash-structure-boundary').trim(),
      resizerHidden: resizer?.hasAttribute('hidden') ?? true,
      resizerHit: Boolean(
        resizer
        && resizerHit
        && (resizerHit === resizer || resizer.contains(resizerHit)),
      ),
    };
  });
}

async function expectContinuousStructureBoundary(page: Page, expectedWidth: number) {
  const geometry = await readStructureBoundary(page);
  expect(Math.abs(geometry.navRight - geometry.mainLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.mainLeft - geometry.topbarLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.navWidth - expectedWidth)).toBeLessThanOrEqual(1);
  expect(geometry.islandBackgroundAlpha).toBeLessThanOrEqual(0.02);
  expect(parseFloat(geometry.islandBorderRight || '0')).toBe(0);
  expect(geometry.islandFilter === 'none' || geometry.islandFilter === '').toBe(true);
  expect(geometry.navAfterContent).not.toBe('none');
  expect(geometry.navAfterContent.length).toBeGreaterThan(0);
  expect(geometry.navAfterDisplay).not.toBe('none');
  expect(Math.abs(Number.parseFloat(geometry.navAfterWidth || '0') - 1)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(Number.parseFloat(geometry.navAfterRight || '0'))).toBeLessThanOrEqual(0.5);
  expect(parseFloat(geometry.navAfterTop || '0')).toBe(0);
  expect(geometry.navAfterBottom === '0px' || Number.parseFloat(geometry.navAfterBottom || '0') === 0).toBe(true);
  expect(Number.parseFloat(geometry.navAfterHeight || '0')).toBeGreaterThan(600);
  expect(geometry.navAfterAlpha).toBeGreaterThan(0);
  expect(Math.abs(geometry.dividerX - geometry.mainLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.dividerX - geometry.topbarLeft)).toBeLessThanOrEqual(1);
  if (process.platform === 'darwin') {
    expect(Math.abs(geometry.islandRight - 120)).toBeLessThanOrEqual(2);
    expect(geometry.toggleRight).toBeLessThanOrEqual(MACOS_TOGGLE_RIGHT_MAX + 1);
    if (Math.abs(expectedWidth - COLLAPSED_SURFACE) <= 1) {
      expect(Math.abs(geometry.navRight - COLLAPSED_SURFACE)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.dividerX - COLLAPSED_SURFACE)).toBeLessThanOrEqual(1.5);
      expect(COLLAPSED_SURFACE - geometry.toggleRight).toBeGreaterThanOrEqual(7);
    }
  }
  return geometry;
}

const AUTO_EXPAND_THRESHOLD = 208;
const AUTO_EXPAND_DRAG_MARGIN = 16;
const COLLAPSED_SURFACE = process.platform === 'darwin' ? 120 : 72;
const ICON_ANCHOR_OFFSET = process.platform === 'darwin' ? 60 : 36;
const MACOS_TOGGLE_RIGHT_MAX = 112;
const STRUCTURE_MOTION_MS = 190;
const NORMAL_RAF_GAP_MS = 24;
const STALL_RAF_GAP_MS = 48;

async function readRailIconCenters(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.dashboard-nav');
    const logo = document.querySelector('[data-testid="dashboard-brand-logo"]');
    if (!nav || !logo) throw new Error('rail center fixtures missing');
    const navLeft = nav.getBoundingClientRect().left;
    const logoRect = logo.getBoundingClientRect();
    return {
      navLeft,
      icons: [...document.querySelectorAll('.dashboard-nav-icon')].map((node) => {
        const rect = node.getBoundingClientRect();
        return rect.x + rect.width / 2;
      }),
      brand: logoRect.x + logoRect.width / 2,
    };
  });
}

function expectRailIconsCentered(centers: { navLeft: number; icons: number[]; brand: number }) {
  centers.icons.forEach((center) => {
    expect(Math.abs(center - (centers.navLeft + ICON_ANCHOR_OFFSET))).toBeLessThanOrEqual(1);
  });
  expect(Math.abs(centers.brand - (centers.navLeft + ICON_ANCHOR_OFFSET))).toBeLessThanOrEqual(1);
}

function expectSharedStructureEdges(frame: {
  navRight: number;
  mainLeft: number;
  topbarLeft: number;
  dividerX?: number;
}) {
  expect(Math.abs(frame.navRight - frame.mainLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.mainLeft - frame.topbarLeft)).toBeLessThanOrEqual(1);
  if (frame.dividerX != null) {
    expect(Math.abs(frame.dividerX - frame.mainLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.dividerX - frame.topbarLeft)).toBeLessThanOrEqual(1);
  }
}

function expectContinuousWidthSamples(
  frames: Array<{ width: number; phase?: string | null }>,
  options: { direction: 'down' | 'up'; start: number; end: number; forbidPlateau?: number },
) {
  const widths = frames.map((frame) => Math.round(frame.width * 10) / 10);
  const unique = [...new Set(widths.map((width) => Math.round(width)))];
  expect(unique.length, `expected 3+ distinct widths, got ${unique.join(',')}`).toBeGreaterThanOrEqual(3);
  for (let index = 1; index < widths.length; index += 1) {
    if (options.direction === 'down') {
      expect(widths[index]).toBeLessThanOrEqual(widths[index - 1] + 0.6);
    } else {
      expect(widths[index]).toBeGreaterThanOrEqual(widths[index - 1] - 0.6);
    }
  }
  if (options.direction === 'down') {
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(options.end - 1);
    expect(Math.max(...widths)).toBeLessThanOrEqual(options.start + 1);
  } else {
    expect(Math.max(...widths)).toBeLessThanOrEqual(options.end + 1);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(options.start - 1);
  }
  if (options.forbidPlateau != null) {
    const plateau = frames.filter((frame) => Math.abs(frame.width - options.forbidPlateau!) <= 0.6);
    expect(plateau.length).toBeLessThanOrEqual(2);
  }
}

type StructureFrame = {
  timestamp: number;
  phase: string | null;
  width: number;
  navRight: number;
  mainLeft: number;
  topbarLeft: number;
  dividerX: number;
  labelOpacity: number;
  brandOpacity: number;
  navAfterHeight: string;
  navAfterWidth: string;
  navAfterRight: string;
  navAfterContent: string;
  navAfterDisplay: string;
};

function expectCollectedPseudoFields(frame: {
  navAfterHeight: string;
  navAfterWidth: string;
  navAfterRight: string;
  navAfterContent: string;
  navAfterDisplay: string;
}) {
  expect(Number.parseFloat(frame.navAfterHeight || '0')).toBeGreaterThan(600);
  expect(Math.abs(Number.parseFloat(frame.navAfterWidth || '0') - 1)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(Number.parseFloat(frame.navAfterRight || '0'))).toBeLessThanOrEqual(0.5);
  expect(frame.navAfterContent).not.toBe('none');
  expect(frame.navAfterContent.length).toBeGreaterThan(0);
  expect(frame.navAfterDisplay).not.toBe('none');
}

async function sampleToggleTransition(
  page: Page,
  action: 'collapse' | 'expand',
): Promise<StructureFrame[]> {
  return page.evaluate(({ nextAction }) => {
    const shell = document.querySelector<HTMLElement>('[data-testid="dashboard-shell"]');
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="dashboard-nav-toggle"]');
    const nav = document.querySelector<HTMLElement>('.dashboard-nav');
    const main = document.querySelector<HTMLElement>('.dashboard-main');
    const topbar = document.querySelector<HTMLElement>('.dashboard-topbar');
    const label = document.querySelector<HTMLElement>('.dashboard-nav-label');
    const brand = document.querySelector<HTMLElement>('.dashboard-brand-copy');
    if (!shell || !toggle || !nav || !main || !topbar) {
      throw new Error('toggle transition fixtures missing');
    }
    const terminal = nextAction === 'collapse' ? 'collapsed' : 'expanded';
    const sample = (): StructureFrame => {
      const navBox = nav.getBoundingClientRect();
      const after = getComputedStyle(nav, '::after');
      const afterRightPx = Number.parseFloat(after.right) || 0;
      const afterWidthPx = Number.parseFloat(after.width) || 0;
      return {
        timestamp: performance.now(),
        phase: shell.getAttribute('data-nav-phase'),
        width: navBox.width,
        navRight: navBox.right,
        mainLeft: main.getBoundingClientRect().left,
        topbarLeft: topbar.getBoundingClientRect().left,
        dividerX: navBox.right - afterRightPx - (afterWidthPx / 2),
        labelOpacity: label ? Number(getComputedStyle(label).opacity) : 0,
        brandOpacity: brand ? Number(getComputedStyle(brand).opacity) : 0,
        navAfterHeight: after.height,
        navAfterWidth: after.width,
        navAfterRight: after.right,
        navAfterContent: after.content,
        navAfterDisplay: after.display,
      };
    };
    const frames: StructureFrame[] = [];
    toggle.click();
    return new Promise<StructureFrame[]>((resolve) => {
      const take = () => {
        const frame = sample();
        frames.push(frame);
        if (frame.phase === terminal || frames.length >= 24) {
          resolve(frames);
          return;
        }
        requestAnimationFrame(take);
      };
      requestAnimationFrame(take);
    });
  }, { nextAction: action });
}

async function collapsedExpandDragTargetX(page: Page): Promise<number> {
  const shellBox = await page.getByTestId('dashboard-shell').boundingBox();
  if (!shellBox) throw new Error('dashboard shell missing for expand drag');
  return shellBox.x + AUTO_EXPAND_THRESHOLD + AUTO_EXPAND_DRAG_MARGIN;
}

async function prepareCollapsedResizerDrag(page: Page, options?: { minInnerWidth?: number }) {
  const navResizer = page.getByTestId('dashboard-nav-resizer');
  if (options?.minInnerWidth != null) {
    await expect.poll(() => page.evaluate(() => window.innerWidth))
      .toBeGreaterThanOrEqual(options.minInnerWidth);
  }
  await page.evaluate(() => window.focus());
  const box = await navResizer.boundingBox();
  if (!box) throw new Error('collapsed resizer missing before drag');
  await navResizer.hover({
    position: {
      x: box.width / 2,
      y: Math.min(180, box.height / 2),
    },
  });
  await expect.poll(async () => {
    const latest = await navResizer.boundingBox();
    if (!latest) return false;
    return page.evaluate(({ x, y }) => {
      const handle = document.querySelector('[data-testid="dashboard-nav-resizer"]');
      const hit = document.elementFromPoint(x, y);
      return Boolean(handle && hit && (hit === handle || handle.contains(hit)));
    }, {
      x: latest.x + (latest.width / 2),
      y: latest.y + Math.min(180, latest.height / 2),
    });
  }).toBe(true);
  return box;
}

async function expectCollapsedPreviewRollback(
  page: Page,
  triggerRollback: () => Promise<void> | void,
) {
  const navResizer = page.getByTestId('dashboard-nav-resizer');
  const start = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-testid="dashboard-shell"]');
    const nav = document.querySelector<HTMLElement>('.dashboard-nav');
    const preview = shell?.style.getPropertyValue('--dash-nav-preview-width') ?? '';
    const parsedPreview = Number.parseFloat(preview);
    return {
      width: nav?.getBoundingClientRect().width ?? 0,
      preview,
      previewWidth: Number.isFinite(parsedPreview) ? parsedPreview : null,
    };
  });
  const expectsMotion = start.width - COLLAPSED_SURFACE >= 12;

  if (expectsMotion) {
    // Recorder must be armed before the trigger: a post-event local rAF
    // budget races the 190ms grid-template-columns transition and can miss
    // transitionrun plus the first intermediate widths.
    await startResizeFrameRecorder(page, 'collapsed-preview-rollback');
    await triggerRollback();
    await awaitRecordedStructureSettle(page, COLLAPSED_SURFACE, 'collapsed');
    const recording = await stopResizeFrameRecorder(page);
    expectRecordedResizePath(recording, {
      kind: 'rollback',
      direction: 'down',
      start: start.width,
      end: COLLAPSED_SURFACE,
      rawPreview: start.previewWidth ?? start.width,
      finalPhase: 'collapsed',
    });
  } else {
    await triggerRollback();
  }

  await expect(page.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-phase', 'collapsed');
  await expect(page.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-resizing', 'false');
  await expect.poll(() => page.locator('.dashboard-nav').evaluate(
    (node) => Math.round(node.getBoundingClientRect().width),
  )).toBe(COLLAPSED_SURFACE);
  await expectContinuousStructureBoundary(page, COLLAPSED_SURFACE);
  await expect.poll(() => page.getByTestId('dashboard-shell').evaluate(
    (node) => node.style.getPropertyValue('--dash-nav-preview-width'),
  )).toBe('');
  await expect(navResizer).toHaveAttribute('aria-valuenow', String(COLLAPSED_SURFACE));
  const aria = await navResizer.evaluate((node) => ({
    now: Number(node.getAttribute('aria-valuenow')),
    min: Number(node.getAttribute('aria-valuemin')),
    max: Number(node.getAttribute('aria-valuemax')),
  }));
  expect(Number.isFinite(aria.min)).toBe(true);
  expect(Number.isFinite(aria.now)).toBe(true);
  expect(Number.isFinite(aria.max)).toBe(true);
  expect(aria.min).toBeLessThanOrEqual(aria.now);
  expect(aria.now).toBeLessThanOrEqual(aria.max);
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
    await expect(dashboard.getByTestId('dashboard-disclaimer')).toHaveText('无后端 · 不保存');
    await expect(dashboard.getByTestId('dashboard-boundary-disclaimer')).toContainText(
      '话术正文与 VOC 明细均为合成镜像',
    );
    await dashboard.getByText('演示环境').click();
    await expect(dashboard.getByTestId('dashboard-boundary-details')).toContainText('MOCK AUTH');
    await expect(dashboard.getByTestId('dashboard-boundary-details')).toContainText('NO BACKEND');
    await expect(dashboard.getByTestId('dashboard-boundary-details')).toContainText(
      '话术正文与 VOC 明细均为合成镜像',
    );
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
    await expect.poll(() => dashboard.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(980);
    await expect(dashboard.getByTestId('nav-overview')).toBeVisible();
    await expectNoHorizontalOverflow(dashboard);
    expect((await readDashboardLayout(dashboard)).contentScrollable).toBe(true);
    const compactChartTops = await dashboard.locator('.overview-chart-grid > .dash-chart-card').evaluateAll(
      (nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
    );
    expect(compactChartTops[1] - compactChartTops[0]).toBeGreaterThan(100);
    await setDashboardSize(app, 1180, 760);
    await expect.poll(() => dashboard.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1170);
    await expectNoHorizontalOverflow(dashboard);
    await setDashboardSize(app, 1440, 820);
    await expect.poll(() => dashboard.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1430);
    await expectNoHorizontalOverflow(dashboard);
    await setDashboardSize(app, 980, 680);
    await expect.poll(() => dashboard.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(980);
    await expectNoHorizontalOverflow(dashboard);

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
    const sidebarMaterial = await dashboard.locator('.dashboard-nav').evaluate((node) => {
      const style = getComputedStyle(node);
      return style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
    });
    expect(sidebarMaterial).toContain('blur(20px)');
    const topbarMaterial = await dashboard.locator('.dashboard-topbar').evaluate((node) => {
      const style = getComputedStyle(node);
      return style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
    });
    expect(topbarMaterial === '' || topbarMaterial === 'none').toBe(true);
    const mainMaterial = await dashboard.locator('.dashboard-main').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        filter: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
        color: style.backgroundColor,
      };
    });
    expect(mainMaterial.filter === '' || mainMaterial.filter === 'none').toBe(true);
    const mainRgba = mainMaterial.color.match(/rgba?\(([^)]+)\)/)?.[1]?.split(',').map((part) => Number(part.trim())) ?? [];
    expect(mainRgba[3] === undefined || mainRgba[3] === 1).toBe(true);
    const blurHits = await readBackdropFilterHits(dashboard);
    expect(blurHits.filter((item) => !item.allowed)).toEqual([]);
    expect(blurHits.some((item) => item.className.includes('dashboard-nav') && item.filter.includes('blur(20px)'))).toBe(true);
    const contentMaterial = await dashboard.getByTestId('dashboard-content').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        filter: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
        color: style.color,
        opacity: style.opacity,
      };
    });
    expect(contentMaterial.filter === '' || contentMaterial.filter === 'none').toBe(true);
    expect(Number(contentMaterial.opacity)).toBe(1);
    const resolvedTheme = await dashboard.getByTestId('dashboard-shell').getAttribute('data-theme');
    if (resolvedTheme === 'dark') {
      expect(mainRgba[0] ?? 255).toBeLessThan(40);
      expect(mainRgba.slice(0, 3)).toEqual([28, 27, 32]);
    } else {
      expect(mainRgba.slice(0, 3)).toEqual([255, 255, 255]);
    }
    await expectSidebarMainContrast(dashboard);
    const contentInk = contentMaterial.color.match(/rgba?\(([^)]+)\)/)?.[1]?.split(',').map((part) =>
      Number(part.trim()),
    ) ?? [];
    if (resolvedTheme === 'dark') {
      expect(contentInk[0] ?? 0).toBeGreaterThan(180);
    } else {
      expect(contentInk[0] ?? 255).toBeLessThan(80);
    }
    const glassFallback = await dashboard.evaluate(() => {
      return [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) => {
            const text = rule.cssText;
            return text.includes('prefers-reduced-transparency')
              && text.includes('backdrop-filter: none');
          });
        } catch {
          return false;
        }
      });
    });
    expect(glassFallback).toBe(true);
    const overviewNav = dashboard.getByTestId('nav-overview');
    const navIconMetrics = await overviewNav.evaluate((button) => {
      const icon = button.querySelector<HTMLElement>('.dashboard-nav-icon');
      const svg = icon?.querySelector('svg');
      const label = button.querySelector<HTMLElement>('.dashboard-nav-label');
      if (!icon || !svg || !label) throw new Error('nav icon/label missing');
      const iconBox = icon.getBoundingClientRect();
      const svgBox = svg.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      return {
        iconWidth: iconBox.width,
        iconHeight: iconBox.height,
        svgWidth: svgBox.width,
        svgHeight: svgBox.height,
        gap: labelBox.left - iconBox.right,
        viewBox: svg.getAttribute('viewBox'),
        slotWidth: getComputedStyle(button).gridTemplateColumns.split(' ')[0],
      };
    });
    expect(navIconMetrics.iconWidth).toBeCloseTo(20, 0);
    expect(navIconMetrics.iconHeight).toBeCloseTo(20, 0);
    expect(navIconMetrics.svgWidth).toBeCloseTo(20, 0);
    expect(navIconMetrics.svgHeight).toBeCloseTo(20, 0);
    expect(Math.abs(navIconMetrics.gap - 14)).toBeLessThanOrEqual(1);
    expect(navIconMetrics.viewBox).toBe('0 0 24 24');
    const activeNavChrome = await overviewNav.evaluate((node) => {
      const style = getComputedStyle(node);
      const before = getComputedStyle(node, '::before');
      return {
        borderLeftWidth: style.borderLeftWidth,
        beforeBackground: before.backgroundColor,
      };
    });
    expect(activeNavChrome.borderLeftWidth).toBe('0px');
    expect(activeNavChrome.beforeBackground).not.toBe('rgba(0, 0, 0, 0)');
    const selectedToken = await usedTokenValue(dashboard, '--dash-chrome-selected', 'backgroundColor');
    const hoverToken = await usedTokenValue(dashboard, '--dash-chrome-hover', 'backgroundColor');
    const inkToken = await usedTokenValue(dashboard, '--dash-ink');
    expectUsedColor(activeNavChrome.beforeBackground, selectedToken);
    expectUsedColor(await overviewNav.evaluate((node) => getComputedStyle(node).color), inkToken);
    const navResizer = dashboard.getByTestId('dashboard-nav-resizer');
    await expect(navResizer).toHaveAttribute('role', 'separator');
    await expect(navResizer).toHaveAttribute('aria-orientation', 'vertical');
    const resizerBox = await navResizer.boundingBox();
    if (!resizerBox) throw new Error('dashboard navigation resizer missing');
    await dashboard.mouse.move(resizerBox.x + (resizerBox.width / 2), resizerBox.y + 180);
    await dashboard.mouse.down();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-resizing', 'true');
    const resizingSidebarMaterial = await dashboard.locator('.dashboard-nav').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        filter: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
        color: style.backgroundColor,
      };
    });
    expect(
      resizingSidebarMaterial.filter === '' || resizingSidebarMaterial.filter === 'none',
    ).toBe(true);
    const resizingSidebarRgba = resizingSidebarMaterial.color
      .match(/rgba?\(([^)]+)\)/)?.[1]
      ?.split(',')
      .map((part) => Number(part.trim())) ?? [];
    expect(resizingSidebarRgba[3] === undefined || resizingSidebarRgba[3] === 1).toBe(true);
    await expect.poll(() => dashboard.locator('.dashboard-topbar').evaluate(
      (node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'),
    )).toBe('no-drag');
    await dashboard.mouse.move(320, resizerBox.y + 180, { steps: 8 });
    await dashboard.mouse.up();
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate((node) => {
      const style = getComputedStyle(node);
      return style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
    })).toContain('blur(20px)');
    await expect.poll(() => dashboard.locator('.dashboard-topbar').evaluate(
      (node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'),
    )).toBe('no-drag');
    await expect.poll(() => dashboard.getByTestId('dashboard-topbar-drag-surface').evaluate(
      (node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'),
    )).toBe('drag');
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
    const collapseToggle = dashboard.getByTestId('dashboard-nav-toggle');
    await expect(collapseToggle).toBeVisible();
    await expect(dashboard.getByTestId('dashboard-brand-logo').locator('button')).toHaveCount(0);
    expect(await collapseToggle.evaluate((node) => getComputedStyle(node, '::before').backgroundColor))
      .toBe('rgba(0, 0, 0, 0)');
    await collapseToggle.hover();
    await expect.poll(() => collapseToggle.evaluate(
      (node) => getComputedStyle(node, '::before').backgroundColor,
    )).not.toBe('rgba(0, 0, 0, 0)');
    const workordersNav = dashboard.getByTestId('nav-workorders');
    const workordersIcon = workordersNav.locator('.dashboard-nav-icon');
    const beforeHoverButtonRect = await workordersNav.boundingBox();
    const beforeHoverIconRect = await workordersIcon.boundingBox();
    await workordersNav.hover();
    await expect.poll(() => workordersNav.evaluate((node) => {
      const before = getComputedStyle(node, '::before');
      return {
        background: before.backgroundColor,
        top: before.top,
        right: before.right,
        bottom: before.bottom,
        left: before.left,
        radius: before.borderRadius,
      };
    })).not.toMatchObject({ background: 'rgba(0, 0, 0, 0)' });
    const hoverBox = await workordersNav.evaluate((node) => {
      const before = getComputedStyle(node, '::before');
      return {
        background: before.backgroundColor,
        radius: before.borderRadius,
        top: before.top,
        right: before.right,
        bottom: before.bottom,
        left: before.left,
      };
    });
    expectUsedColor(hoverBox.background, hoverToken);
    expect(hoverBox.top).toBe('0px');
    expect(hoverBox.right).toBe('0px');
    expect(hoverBox.bottom).toBe('0px');
    expect(hoverBox.left).toBe('0px');
    expect(parseFloat(hoverBox.radius)).toBeGreaterThan(0);
    const afterHoverButtonRect = await workordersNav.boundingBox();
    const afterHoverIconRect = await workordersIcon.boundingBox();
    expect(afterHoverButtonRect).toEqual(beforeHoverButtonRect);
    expect(afterHoverIconRect).toEqual(beforeHoverIconRect);
    await dashboard.locator('.dashboard-main').hover({ position: { x: 48, y: 48 } });
    await expect(dashboard.getByTestId('nav-workorder-trash')).toBeDisabled();
    await expect(dashboard.getByTestId('nav-workorder-trash')).toHaveAccessibleName(
      '工单垃圾桶，二期待实施',
    );
    const disabledInk = await usedTokenValue(dashboard, '--dash-disabled-ink');
    const disabledSurface = await usedTokenValue(dashboard, '--dash-disabled-bg', 'backgroundColor');
    const trashChrome = await dashboard.getByTestId('nav-workorder-trash').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        color: style.color,
        surface: getComputedStyle(node, '::before').backgroundColor,
      };
    });
    expectUsedColor(trashChrome.color, disabledInk);
    expectUsedColor(trashChrome.surface, disabledSurface);

    const beforeCollapse = await readCollapseGeometry(dashboard);
    const midCollapse = await dashboard.evaluate(() => {
      const shell = document.querySelector('[data-testid="dashboard-shell"]');
      const collapse = document.querySelector<HTMLButtonElement>('[data-testid="dashboard-nav-toggle"]');
      const logo = document.querySelector('[data-testid="dashboard-brand-logo"]');
      const nav = document.querySelector('.dashboard-nav');
      const main = document.querySelector('.dashboard-main');
      const topbar = document.querySelector('.dashboard-topbar');
      if (!shell || !collapse || !logo || !nav || !main || !topbar) {
        throw new Error('collapse mid-frame missing');
      }
      const sample = () => {
        const buttonRect = collapse.getBoundingClientRect();
        const logoRect = logo.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        return {
          phase: shell.getAttribute('data-nav-phase'),
          logo: { x: logoRect.x, y: logoRect.y },
          logoCenter: logoRect.x + logoRect.width / 2,
          icons: [...document.querySelectorAll('.dashboard-nav-icon')].map((node) => {
            const rect = node.getBoundingClientRect();
            return { x: rect.x, y: rect.y, center: rect.x + rect.width / 2 };
          }),
          collapse: {
            x: buttonRect.x,
            y: buttonRect.y,
            right: buttonRect.right,
            opacity: Number(getComputedStyle(collapse).opacity),
          },
          topbarPadding: Number.parseFloat(getComputedStyle(topbar).paddingLeft),
          navLeft: navRect.left,
          navRight: navRect.right,
          mainLeft: main.getBoundingClientRect().left,
          topbarLeft: topbar.getBoundingClientRect().left,
        };
      };
      collapse.click();
      return new Promise<ReturnType<typeof sample>>((resolve) => {
        const take = () => {
          const mid = sample();
          if (mid.phase === 'collapsing' || mid.phase === 'collapsed') {
            resolve(mid);
            return;
          }
          requestAnimationFrame(take);
        };
        take();
      });
    });
    expect(['collapsing', 'collapsed']).toContain(midCollapse.phase);
    expectSharedStructureEdges(midCollapse);
    expect(Math.abs(midCollapse.logo.x - beforeCollapse.logo.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(midCollapse.logo.y - beforeCollapse.logo.y)).toBeLessThanOrEqual(1);
    expect(midCollapse.icons).toHaveLength(beforeCollapse.icons.length);
    midCollapse.icons.forEach((rect, index) => {
      expect(Math.abs(rect.x - beforeCollapse.icons[index].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(rect.y - beforeCollapse.icons[index].y)).toBeLessThanOrEqual(1);
      expect(Math.abs(rect.center - (midCollapse.navLeft + ICON_ANCHOR_OFFSET))).toBeLessThanOrEqual(1);
    });
    expect(Math.abs(midCollapse.logoCenter - (midCollapse.navLeft + ICON_ANCHOR_OFFSET))).toBeLessThanOrEqual(1);
    if (midCollapse.phase === 'collapsing') {
      expect(midCollapse.topbarPadding).toBeGreaterThanOrEqual(19);
      expect(midCollapse.topbarPadding).toBeLessThanOrEqual(21);
      expect(midCollapse.collapse.opacity).toBe(1);
      if (process.platform === 'darwin') {
        expect(Math.abs(midCollapse.collapse.x - 72)).toBeLessThanOrEqual(2);
        expect(Math.abs(midCollapse.collapse.y - 4)).toBeLessThanOrEqual(2);
      } else {
        expect(midCollapse.collapse.right + 12).toBeLessThanOrEqual(midCollapse.mainLeft + 1);
      }
    }
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-phase',
      'collapsed',
    );
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-collapsed',
      'true',
    );
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(COLLAPSED_SURFACE);
    await expect(collapseToggle).toBeVisible();
    await expect(navResizer).toBeVisible();
    await expect(navResizer).toHaveAttribute('tabindex', '0');
    const collapsedBoundary = await expectContinuousStructureBoundary(dashboard, COLLAPSED_SURFACE);
    expect(collapsedBoundary.resizerHidden).toBe(false);
    expect(collapsedBoundary.resizerHit).toBe(true);
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
    const railIconCenters = await readRailIconCenters(dashboard);
    expectRailIconsCentered(railIconCenters);
    const collapsedNavInsets = await dashboard.getByTestId('nav-overview').evaluate((node) => {
      const nav = node.closest('.dashboard-nav');
      if (!nav) throw new Error('collapsed nav missing');
      const navRect = nav.getBoundingClientRect();
      const buttonRect = node.getBoundingClientRect();
      return {
        left: buttonRect.left - navRect.left,
        right: navRect.right - buttonRect.right,
      };
    });
    expect(Math.abs(collapsedNavInsets.left - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsedNavInsets.right - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsedLogoRect.x - expandedLogoRect.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsedLogoRect.y - expandedLogoRect.y)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(dashboard);
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-nav-collapsed.png') });
    const collapsedOverview = dashboard.getByTestId('nav-overview');
    await expect(collapsedOverview).toBeVisible();
    const overviewBox = await collapsedOverview.boundingBox();
    if (!overviewBox) throw new Error('collapsed overview nav missing');
    const overviewHitPoint = {
      x: overviewBox.x + (overviewBox.width / 2),
      y: overviewBox.y + (overviewBox.height / 2),
    };
    const overviewHit = await dashboard.evaluate(({ x, y }) => {
      const target = document.querySelector<HTMLElement>('[data-testid="nav-overview"]');
      const hit = document.elementFromPoint(x, y);
      const style = target ? getComputedStyle(target) : null;
      const rect = target?.getBoundingClientRect();
      return {
        visible: Boolean(
          target
          && style
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number(style.opacity) > 0
          && (rect?.width ?? 0) > 0
          && (rect?.height ?? 0) > 0
        ),
        hitTestId: hit instanceof HTMLElement
          ? hit.closest('[data-testid]')?.getAttribute('data-testid') ?? hit.dataset.testid ?? hit.tagName
          : null,
        hitIsOverview: Boolean(target && hit && (hit === target || target.contains(hit))),
        pointInBox: Boolean(
          rect
          && x >= rect.left
          && x <= rect.right
          && y >= rect.top
          && y <= rect.bottom
        ),
      };
    }, overviewHitPoint);
    expect(overviewHit.visible).toBe(true);
    expect(overviewHit.pointInBox).toBe(true);
    expect(overviewHit.hitIsOverview, `collapsed overview hover hit ${overviewHit.hitTestId}`).toBe(true);
    const mainBoxBeforeTooltip = await dashboard.locator('.dashboard-main').boundingBox();
    expect(mainBoxBeforeTooltip, 'dashboard main missing before tooltip hover').toBeTruthy();
    await dashboard.mouse.move(
      mainBoxBeforeTooltip!.x + mainBoxBeforeTooltip!.width - 24,
      mainBoxBeforeTooltip!.y + mainBoxBeforeTooltip!.height - 24,
    );
    await expect(dashboard.getByTestId('dashboard-nav-tooltip')).toHaveCount(0);
    await collapsedOverview.hover();
    const hoveredHit = await dashboard.evaluate(({ x, y }) => {
      const target = document.querySelector<HTMLElement>('[data-testid="nav-overview"]');
      const hit = document.elementFromPoint(x, y);
      return {
        hitTestId: hit instanceof HTMLElement
          ? hit.closest('[data-testid]')?.getAttribute('data-testid') ?? hit.dataset.testid ?? hit.tagName
          : null,
        hitIsOverview: Boolean(target && hit && (hit === target || target.contains(hit))),
      };
    }, overviewHitPoint);
    expect(hoveredHit.hitIsOverview, `real hover hit ${hoveredHit.hitTestId}`).toBe(true);
    await expect(collapsedOverview).toHaveAttribute('aria-describedby', 'dashboard-nav-tooltip');
    const tooltip = dashboard.getByTestId('dashboard-nav-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveClass(/is-visible/);
    await expect(tooltip).toHaveText('管理概览');
    const tooltipBox = await tooltip.boundingBox();
    expect(tooltipBox, 'tooltip bounding box missing after real hover').toBeTruthy();
    expect(tooltipBox!.width).toBeGreaterThan(0);
    expect(tooltipBox!.height).toBeGreaterThan(0);
    await dashboard.getByTestId('nav-overview').focus();
    await dashboard.keyboard.press('Escape');
    await expect(dashboard.getByTestId('dashboard-nav-tooltip')).toHaveCount(0);
    const collapsedToggle = dashboard.getByTestId('dashboard-nav-toggle');
    await expect(collapsedToggle).toBeVisible();
    await expect(collapsedToggle).toHaveAttribute('aria-expanded', 'false');
    await dashboard.locator('.dashboard-main').hover({ position: { x: 300, y: 300 } });
    await expect.poll(() => collapsedToggle.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    await expect(collapsedToggle).toHaveCSS('pointer-events', 'auto');
    await expect.poll(() => collapsedToggle.evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(40);
    const overlayRect = await collapsedToggle.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect(Math.abs(overlayRect.width - 40)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayRect.height - 40)).toBeLessThanOrEqual(1);
    if (process.platform === 'darwin') {
      expect(Math.abs(overlayRect.x - 72)).toBeLessThanOrEqual(2);
      expect(Math.abs(overlayRect.y - 4)).toBeLessThanOrEqual(2);
    } else {
      expect(overlayRect.x + overlayRect.width + 12).toBeLessThanOrEqual(collapsedLogoRect.x + 80);
    }
    const hitGeometry = await dashboard.evaluate(() => {
      const toggle = document.querySelector<HTMLElement>('[data-testid="dashboard-nav-toggle"]');
      const island = document.querySelector<HTMLElement>('[data-testid="dashboard-titlebar-control-island"]');
      if (!toggle || !island) throw new Error('collapsed toggle island missing');
      const toggleBox = toggle.getBoundingClientRect();
      const islandBox = island.getBoundingClientRect();
      const centerX = toggleBox.x + toggleBox.width / 2;
      const centerY = toggleBox.y + toggleBox.height / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      const dragRects = [...document.querySelectorAll<HTMLElement>('*')]
        .filter((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region') === 'drag')
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });
      const intersects = (a: DOMRect | { x: number; y: number; width: number; height: number }, b: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      return {
        hitTestId: hit instanceof HTMLElement ? hit.dataset.testid ?? hit.tagName : null,
        hitIsToggle: Boolean(hit && (hit === toggle || toggle.contains(hit))),
        islandContainsToggle:
          toggleBox.x >= islandBox.x - 1
          && toggleBox.y >= islandBox.y - 1
          && toggleBox.right <= islandBox.right + 1
          && toggleBox.bottom <= islandBox.bottom + 1,
        dragIntersectsToggle: dragRects.some((rect) => intersects(toggleBox, rect)),
      };
    });
    expect(hitGeometry.hitIsToggle).toBe(true);
    expect(hitGeometry.islandContainsToggle).toBe(true);
    expect(hitGeometry.dragIntersectsToggle).toBe(false);
    // Playwright/CDP click is not an OS hit-test. This loop still exercises the
    // same renderer button; real macOS mouse acceptance remains a manual check.
    for (let index = 0; index < 20; index += 1) {
      const phase = await dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase');
      if (phase === 'collapsed') {
        await collapsedToggle.click({ force: false });
        await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-phase', 'expanded');
        await dashboard.getByTestId('dashboard-nav-toggle').click({ force: false });
        await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-phase', 'collapsed');
      }
    }
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-phase', 'collapsed');
    const expandFrames = await sampleToggleTransition(dashboard, 'expand');
    expect(['expanding', 'expanded']).toContain(expandFrames[0]?.phase === 'collapsed' ? expandFrames[1]?.phase : expandFrames[0]?.phase);
    expectContinuousWidthSamples(expandFrames, {
      direction: 'up',
      start: COLLAPSED_SURFACE,
      end: expandedNavWidth,
    });
    expandFrames.forEach((frame) => {
      expectSharedStructureEdges(frame);
      expectCollectedPseudoFields(frame);
      if (frame.phase !== 'expanded') {
        expect(frame.labelOpacity).toBeLessThanOrEqual(0.05);
        expect(frame.brandOpacity).toBeLessThanOrEqual(0.05);
      }
    });
    const midExpand = expandFrames[Math.max(0, expandFrames.findIndex((frame) => frame.phase === 'expanding'))] ?? expandFrames[0];
    expect(['expanding', 'expanded']).toContain(midExpand.phase);
    const expandCenters = await readRailIconCenters(dashboard);
    expectRailIconsCentered(expandCenters);
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-phase',
      'expanded',
    );
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(Math.round(expandedNavWidth));
    await expect(dashboard.getByTestId('dashboard-nav-toggle')).toBeVisible();
    await expect(navResizer).toBeVisible();
    const collapseFrames = await sampleToggleTransition(dashboard, 'collapse');
    expectContinuousWidthSamples(collapseFrames, {
      direction: 'down',
      start: expandedNavWidth,
      end: COLLAPSED_SURFACE,
      forbidPlateau: 216,
    });
    collapseFrames.forEach((frame) => {
      expectSharedStructureEdges(frame);
      expectCollectedPseudoFields(frame);
      if (frame.phase !== 'expanded') {
        expect(frame.labelOpacity).toBeLessThanOrEqual(0.05);
        expect(frame.brandOpacity).toBeLessThanOrEqual(0.05);
      }
    });
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-phase',
      'collapsed',
    );
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(COLLAPSED_SURFACE);
    await expectContinuousStructureBoundary(dashboard, COLLAPSED_SURFACE);

    const collapsedResizerBox = await navResizer.boundingBox();
    if (!collapsedResizerBox) throw new Error('collapsed navigation resizer missing');
    const collapsedHit = await dashboard.evaluate(({ x, y }) => {
      const resizer = document.querySelector('[data-testid="dashboard-nav-resizer"]');
      const hit = document.elementFromPoint(x, y);
      return {
        hitIsResizer: Boolean(resizer && hit && (hit === resizer || resizer.contains(hit))),
        testId: hit instanceof HTMLElement ? hit.dataset.testid ?? hit.tagName : null,
      };
    }, {
      x: collapsedResizerBox.x + (collapsedResizerBox.width / 2),
      y: collapsedResizerBox.y + Math.min(180, collapsedResizerBox.height / 2),
    });
    expect(collapsedHit.hitIsResizer).toBe(true);

    const windowBeforeCollapsedDrag = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=dashboard'),
      );
      return win?.getBounds() ?? null;
    });
    await dashboard.mouse.move(
      collapsedResizerBox.x + (collapsedResizerBox.width / 2),
      collapsedResizerBox.y + Math.min(180, collapsedResizerBox.height / 2),
    );
    await dashboard.mouse.down();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-resizing', 'true');
    await expect.poll(() => dashboard.locator('.dashboard-topbar').evaluate(
      (node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'),
    )).toBe('no-drag');
    await expect.poll(() => dashboard.getByTestId('dashboard-topbar-drag-surface').evaluate(
      (node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'),
    )).toBe('no-drag');
    await dashboard.mouse.move(
      collapsedResizerBox.x + 90,
      collapsedResizerBox.y + Math.min(180, collapsedResizerBox.height / 2),
      { steps: 8 },
    );
    const previewWidth = await dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    );
    expect(previewWidth).toBeGreaterThan(COLLAPSED_SURFACE);
    expect(previewWidth).toBeLessThan(208);
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-phase', 'collapsed');
    const previewBoundary = await readStructureBoundary(dashboard);
    expectSharedStructureEdges(previewBoundary);
    expectRailIconsCentered(await readRailIconCenters(dashboard));
    const windowDuringCollapsedDrag = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=dashboard'),
      );
      return win?.getBounds() ?? null;
    });
    expect(windowDuringCollapsedDrag?.x).toBe(windowBeforeCollapsedDrag?.x);
    expect(windowDuringCollapsedDrag?.y).toBe(windowBeforeCollapsedDrag?.y);
    await expectCollapsedPreviewRollback(dashboard, async () => {
      await dashboard.mouse.up();
    });
    await expect.poll(() => dashboard.getByTestId('dashboard-topbar-drag-surface').evaluate(
      (node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'),
    )).toBe('drag');

    const cancelResizerBox = await navResizer.boundingBox();
    if (!cancelResizerBox) throw new Error('collapsed resizer missing before cancel');
    await dashboard.mouse.move(
      cancelResizerBox.x + (cancelResizerBox.width / 2),
      cancelResizerBox.y + Math.min(180, cancelResizerBox.height / 2),
    );
    await dashboard.mouse.down();
    await dashboard.mouse.move(
      cancelResizerBox.x + 80,
      cancelResizerBox.y + Math.min(180, cancelResizerBox.height / 2),
      { steps: 4 },
    );
    await expectCollapsedPreviewRollback(dashboard, async () => {
      await dashboard.evaluate(() => {
        const resizer = document.querySelector('[data-testid="dashboard-nav-resizer"]');
        if (!(resizer instanceof HTMLElement)) throw new Error('resizer missing');
        const pointerId = [0, 1, 2].find((id) => resizer.hasPointerCapture?.(id)) ?? 1;
        resizer.dispatchEvent(new PointerEvent('pointercancel', {
          bubbles: true,
          cancelable: true,
          pointerId,
          buttons: 0,
          clientX: 160,
          clientY: 200,
        }));
      });
    });
    await dashboard.mouse.up();

    const lostCaptureBox = await navResizer.boundingBox();
    if (!lostCaptureBox) throw new Error('collapsed resizer missing before lostcapture');
    await dashboard.mouse.move(
      lostCaptureBox.x + (lostCaptureBox.width / 2),
      lostCaptureBox.y + Math.min(180, lostCaptureBox.height / 2),
    );
    await dashboard.mouse.down();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-resizing', 'true');
    await dashboard.mouse.move(
      lostCaptureBox.x + 70,
      lostCaptureBox.y + Math.min(180, lostCaptureBox.height / 2),
      { steps: 3 },
    );
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBeGreaterThan(COLLAPSED_SURFACE);
    const lostCapturePreview = await dashboard.getByTestId('dashboard-shell').evaluate(
      (node) => node.style.getPropertyValue('--dash-nav-preview-width'),
    );
    expect(lostCapturePreview).not.toBe('');
    await expectCollapsedPreviewRollback(dashboard, async () => {
      const releasedWithoutBlur = await dashboard.evaluate(() => {
        const resizer = document.querySelector('[data-testid="dashboard-nav-resizer"]');
        if (!(resizer instanceof HTMLElement)) throw new Error('resizer missing');
        const pointerId = [0, 1, 2].find((id) => resizer.hasPointerCapture?.(id));
        if (pointerId == null) throw new Error('collapsed preview has no pointer capture');
        resizer.releasePointerCapture(pointerId);
        return {
          pointerId,
          documentHasFocus: document.hasFocus(),
        };
      });
      expect(releasedWithoutBlur.documentHasFocus).toBe(true);
    });
    await dashboard.mouse.up();

    const blurBox = await navResizer.boundingBox();
    if (!blurBox) throw new Error('collapsed resizer missing before blur');
    await dashboard.mouse.move(
      blurBox.x + (blurBox.width / 2),
      blurBox.y + Math.min(180, blurBox.height / 2),
    );
    await dashboard.mouse.down();
    await dashboard.mouse.move(
      blurBox.x + 64,
      blurBox.y + Math.min(180, blurBox.height / 2),
      { steps: 3 },
    );
    await expectCollapsedPreviewRollback(dashboard, async () => {
      await dashboard.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
      });
    });
    await dashboard.evaluate(() => window.focus());
    await dashboard.mouse.up();

    const buttonsZeroBox = await navResizer.boundingBox();
    if (!buttonsZeroBox) throw new Error('collapsed resizer missing before buttons=0');
    await dashboard.mouse.move(
      buttonsZeroBox.x + (buttonsZeroBox.width / 2),
      buttonsZeroBox.y + Math.min(180, buttonsZeroBox.height / 2),
    );
    await dashboard.mouse.down();
    await expectCollapsedPreviewRollback(dashboard, async () => {
      await dashboard.evaluate(() => {
        const resizer = document.querySelector('[data-testid="dashboard-nav-resizer"]');
        if (!(resizer instanceof HTMLElement)) throw new Error('resizer missing');
        const pointerId = [0, 1, 2].find((id) => resizer.hasPointerCapture?.(id)) ?? 1;
        resizer.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          pointerId,
          buttons: 0,
          clientX: 260,
          clientY: 200,
        }));
      });
    });
    await dashboard.mouse.up();

    const expandDragBox = await prepareCollapsedResizerDrag(dashboard);
    await dashboard.mouse.down();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-resizing', 'true');
    await dashboard.mouse.move(
      await collapsedExpandDragTargetX(dashboard),
      expandDragBox.y + Math.min(180, expandDragBox.height / 2),
      { steps: 10 },
    );
    await expect.poll(() => dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase'))
      .not.toBe('collapsed');
    const phaseBeforeUp = await dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase');
    expect(['expanding', 'expanded']).toContain(phaseBeforeUp);
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-resizing', 'false');
    await dashboard.mouse.up();
    await expect.poll(() => dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase'))
      .toBe('expanded');
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(Math.round(expandedNavWidth));
    await expectContinuousStructureBoundary(dashboard, Math.round(expandedNavWidth));

    await dashboard.getByTestId('dashboard-nav-toggle').click();
    const reverseStartPhase = await dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase');
    expect(['collapsing', 'collapsed']).toContain(reverseStartPhase);
    if (reverseStartPhase === 'collapsing') {
      await dashboard.getByTestId('dashboard-nav-toggle').click();
      const reversePhase = await dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase');
      expect(['expanding', 'expanded']).toContain(reversePhase);
      if (reversePhase === 'expanding') {
        const reverseCancel = await dashboard.evaluate(() => {
          const shell = document.querySelector('[data-testid="dashboard-shell"]');
          const nav = document.querySelector('.dashboard-nav');
          if (!(shell instanceof HTMLElement) || !nav) {
            throw new Error('rapid reverse fixtures missing');
          }
          shell.dispatchEvent(new TransitionEvent('transitioncancel', {
            bubbles: true,
            propertyName: 'grid-template-columns',
          }));
          return {
            phase: shell.getAttribute('data-nav-phase'),
            width: nav.getBoundingClientRect().width,
          };
        });
        if (reverseCancel.width < Math.round(expandedNavWidth) - 1) {
          expect(reverseCancel.phase).toBe('expanding');
        }
      }
    } else {
      await dashboard.getByTestId('dashboard-nav-toggle').click();
    }
    await expect.poll(() => dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase'))
      .toBe('expanded');
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(Math.round(expandedNavWidth));

    await dashboard.getByTestId('dashboard-nav-toggle').click();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-phase', 'collapsed');
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(COLLAPSED_SURFACE);

    for (const size of [
      { width: 980, height: 680 },
      { width: 1180, height: 760 },
      { width: 1440, height: 900 },
    ]) {
      await setDashboardSize(app, size.width, size.height);
      await expect.poll(() => dashboard.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(size.width - 40);
      await expectContinuousStructureBoundary(dashboard, COLLAPSED_SURFACE);
      const sizedResizer = await navResizer.boundingBox();
      if (!sizedResizer) throw new Error(`collapsed resizer missing at ${size.width}`);
      const sizedHit = await dashboard.evaluate(({ x, y }) => {
        const handle = document.querySelector('[data-testid="dashboard-nav-resizer"]');
        const hit = document.elementFromPoint(x, y);
        return Boolean(handle && hit && (hit === handle || handle.contains(hit)));
      }, {
        x: sizedResizer.x + (sizedResizer.width / 2),
        y: sizedResizer.y + Math.min(180, sizedResizer.height / 2),
      });
      expect(sizedHit).toBe(true);
    }
    await setDashboardSize(app, 1180, 760);
    await expect.poll(() => dashboard.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1170);

    await dashboard.getByTestId('dashboard-nav-toggle').click();
    await expect.poll(() => dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase'))
      .toBe('expanded');
    await dashboard.getByTestId('dashboard-nav-toggle').click();
    await expect.poll(() => dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase'))
      .toMatch(/collapsing|collapsed/);
    await dashboard.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => dashboard.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    )).toBe(true);
    await expect.poll(() => dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase'))
      .toBe('collapsed');
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(COLLAPSED_SURFACE);

    const reducedBox = await prepareCollapsedResizerDrag(dashboard, { minInnerWidth: 1170 });
    await dashboard.mouse.down();
    try {
      await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-resizing', 'true');
    } catch (error) {
      throw new Error(
        `reduced-motion collapsed→drag gesture did not start (data-nav-resizing!=true): ${String(error)}`,
      );
    }
    await dashboard.mouse.move(
      await collapsedExpandDragTargetX(dashboard),
      reducedBox.y + Math.min(180, reducedBox.height / 2),
      { steps: 6 },
    );
    try {
      await expect.poll(() => dashboard.getByTestId('dashboard-shell').getAttribute('data-nav-phase'))
        .toBe('expanded');
    } catch (error) {
      const snapshot = await dashboard.getByTestId('dashboard-shell').evaluate((node) => ({
        phase: node.getAttribute('data-nav-phase'),
        resizing: node.getAttribute('data-nav-resizing'),
        preview: node.style.getPropertyValue('--dash-nav-preview-width'),
        matchMedia: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      }));
      throw new Error(
        `reduced-motion collapsed→drag started but product did not expand: ${JSON.stringify(snapshot)} ${String(error)}`,
      );
    }
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-resizing', 'false');
    await dashboard.mouse.up();
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(Math.round(expandedNavWidth));
    await dashboard.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => dashboard.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    )).toBe(false);
    await dashboard.getByTestId('dashboard-nav-toggle').click();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-phase', 'collapsed');
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(COLLAPSED_SURFACE);

    const keyboardToggle = dashboard.getByTestId('dashboard-nav-toggle');
    await dashboard.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await dashboard.keyboard.press('Tab');
    await keyboardToggle.focus();
    await expect(keyboardToggle).toBeFocused();
    await expect.poll(() => keyboardToggle.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    expect(await keyboardToggle.evaluate((node) => parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThanOrEqual(2);
    await keyboardToggle.press('Enter');
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-phase',
      'expanded',
    );
    await keyboardToggle.press(' ');
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-phase',
      'collapsed',
    );
    await keyboardToggle.press('Enter');
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-nav-phase',
      'expanded',
    );
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(Math.round(expandedNavWidth));
    await expectNoHorizontalOverflow(dashboard);

    const titlebarHandle = await navResizer.boundingBox();
    if (!titlebarHandle) throw new Error('dashboard navigation resizer missing before titlebar probe');
    const windowBeforeTitlebarDrag = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=dashboard'),
      );
      return win?.getBounds() ?? null;
    });
    await dashboard.mouse.move(titlebarHandle.x + (titlebarHandle.width / 2), 20);
    await dashboard.mouse.down();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-resizing', 'true');
    await dashboard.mouse.move(titlebarHandle.x + (titlebarHandle.width / 2) + 24, 20, { steps: 4 });
    const windowDuringTitlebarDrag = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=dashboard'),
      );
      return win?.getBounds() ?? null;
    });
    await dashboard.mouse.up();
    expect(windowDuringTitlebarDrag?.x).toBe(windowBeforeTitlebarDrag?.x);
    expect(windowDuringTitlebarDrag?.y).toBe(windowBeforeTitlebarDrag?.y);
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-resizing', 'false');
    await expect.poll(() => dashboard.locator('.dashboard-topbar').evaluate(
      (node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'),
    )).toBe('no-drag');
    await expect.poll(() => dashboard.getByTestId('dashboard-topbar-drag-surface').evaluate(
      (node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'),
    )).toBe('drag');

    const themeTrigger = dashboard.getByTestId('dashboard-theme-trigger');
    await expect(themeTrigger).toBeVisible();
    await expect(themeTrigger).toHaveAttribute('aria-haspopup', 'menu');
    await themeTrigger.click();
    const themeMenu = dashboard.getByTestId('dashboard-theme-menu');
    await expect(themeMenu).toBeVisible();
    const menuPlacement = await themeMenu.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(menuPlacement.width).toBeGreaterThan(0);
    expect(menuPlacement.height).toBeGreaterThan(0);
    expect(menuPlacement.left).toBeGreaterThanOrEqual(-1);
    expect(menuPlacement.top).toBeGreaterThanOrEqual(-1);
    expect(menuPlacement.right).toBeLessThanOrEqual(menuPlacement.viewportWidth + 1);
    expect(menuPlacement.bottom).toBeLessThanOrEqual(menuPlacement.viewportHeight + 1);
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-theme-menu.png') });
    await dashboard.getByTestId('dashboard-theme-dark').click();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-theme', 'dark');
    const brandFox = dashboard.locator('.dashboard-brand-fox');
    await expect(brandFox).toHaveAttribute('data-active-variant', 'white-headset');
    await expect(brandFox.locator('img')).toHaveCount(1);
    await expect(brandFox.locator('.is-purple-headset')).toHaveCount(0);
    await expect(brandFox.locator('.is-white-headset')).toHaveCSS('opacity', '1');
    await expect.poll(() => brandFox.locator('.is-white-headset').evaluate((node) => ({
      complete: (node as HTMLImageElement).complete,
      naturalWidth: (node as HTMLImageElement).naturalWidth,
      naturalHeight: (node as HTMLImageElement).naturalHeight,
    }))).toEqual({
      complete: true,
      naturalWidth: 1254,
      naturalHeight: 1254,
    });
    const darkBrandAsset = await brandFox.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const active = node.querySelector<HTMLImageElement>('.dashboard-brand-fox-image');
      if (!active) throw new Error('Dashboard brand image missing');
      return {
        width: rect.width,
        height: rect.height,
        imageCount: node.querySelectorAll('img').length,
        activeClass: active.className,
        activeOpacity: getComputedStyle(active).opacity,
        activeComplete: active.complete,
        activeNaturalWidth: active.naturalWidth,
        activeNaturalHeight: active.naturalHeight,
      };
    });
    expect(darkBrandAsset).toEqual({
      width: 40,
      height: 40,
      imageCount: 1,
      activeClass: 'dashboard-brand-fox-image is-white-headset',
      activeOpacity: '1',
      activeComplete: true,
      activeNaturalWidth: 1254,
      activeNaturalHeight: 1254,
    });
    await expectSidebarMainContrast(dashboard);
    await expect(themeMenu).toHaveCount(0);
    await expect.poll(async () => {
      const current = await dashboard.getByTestId('nav-overview').evaluate((node) => getComputedStyle(node).color);
      const ink = await usedTokenValue(dashboard, '--dash-ink');
      const left = parseCssColor(current);
      const right = parseCssColor(ink);
      return Boolean(left && right && Math.abs(left[0] - right[0]) <= 2);
    }).toBe(true);
    const darkCanvas = await dashboard.locator('html').evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    const darkStyles = await dashboard.evaluate(() => {
      const shell = document.querySelector('[data-testid="dashboard-shell"]');
      const nav = document.querySelector('[data-testid="nav-overview"]');
      const trash = document.querySelector('[data-testid="nav-workorder-trash"]');
      const probe = document.createElement('span');
      if (!shell || !nav || !trash) throw new Error('theme contrast fixtures missing');
      const used = (token: string, property: 'color' | 'backgroundColor') => {
        probe.style.color = '';
        probe.style.backgroundColor = '';
        probe.style[property] = `var(${token})`;
        shell.append(probe);
        return getComputedStyle(probe)[property];
      };
      const result = {
        colorScheme: getComputedStyle(shell).colorScheme,
        buttonScheme: getComputedStyle(nav).colorScheme,
        trashScheme: getComputedStyle(trash).colorScheme,
        activeColor: getComputedStyle(nav).color,
        activeSurface: getComputedStyle(nav, '::before').backgroundColor,
        disabledColor: getComputedStyle(trash).color,
        disabledSurface: getComputedStyle(trash, '::before').backgroundColor,
        ink: used('--dash-ink', 'color'),
        selected: used('--dash-chrome-selected', 'backgroundColor'),
        disabledInk: used('--dash-disabled-ink', 'color'),
        disabledBg: used('--dash-disabled-bg', 'backgroundColor'),
        navClass: nav.className,
        navInkVar: getComputedStyle(nav).getPropertyValue('--dash-ink').trim(),
        shellInkVar: getComputedStyle(shell).getPropertyValue('--dash-ink').trim(),
        htmlTheme: document.documentElement.dataset.dashboardTheme ?? '',
        shellTheme: shell.getAttribute('data-theme') ?? '',
      };
      probe.remove();
      return result;
    });
    expect(darkStyles.colorScheme).toContain('dark');
    expect(darkStyles.buttonScheme).toContain('dark');
    expect(darkStyles.trashScheme).toContain('dark');
    expectUsedColor(darkStyles.activeColor, darkStyles.ink);
    expectUsedColor(darkStyles.activeSurface, darkStyles.selected);
    expectUsedColor(darkStyles.disabledColor, darkStyles.disabledInk);
    expectUsedColor(darkStyles.disabledSurface, darkStyles.disabledBg);
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-overview-dark.png') });
    await themeTrigger.click();
    await dashboard.getByTestId('dashboard-theme-light').click();
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute('data-theme', 'light');
    await expect(brandFox).toHaveAttribute('data-active-variant', 'purple-headset');
    await expect(brandFox.locator('img')).toHaveCount(1);
    await expect(brandFox.locator('.is-purple-headset')).toHaveCSS('opacity', '1');
    await expect(brandFox.locator('.is-white-headset')).toHaveCount(0);
    await expect.poll(async () => {
      const current = await dashboard.getByTestId('nav-overview').evaluate((node) => getComputedStyle(node).color);
      const ink = await usedTokenValue(dashboard, '--dash-ink');
      const left = parseCssColor(current);
      const right = parseCssColor(ink);
      return Boolean(left && right && Math.abs(left[0] - right[0]) <= 2);
    }).toBe(true);
    await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-overview-light.png') });
    const lightCanvas = await dashboard.locator('html').evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    expect(lightCanvas).not.toBe(darkCanvas);
    const lightStyles = await dashboard.evaluate(() => {
      const shell = document.querySelector('[data-testid="dashboard-shell"]');
      const nav = document.querySelector('[data-testid="nav-overview"]');
      const trash = document.querySelector('[data-testid="nav-workorder-trash"]');
      const probe = document.createElement('span');
      if (!shell || !nav || !trash) throw new Error('theme contrast fixtures missing');
      const used = (token: string, property: 'color' | 'backgroundColor') => {
        probe.style.color = '';
        probe.style.backgroundColor = '';
        probe.style[property] = `var(${token})`;
        shell.append(probe);
        return getComputedStyle(probe)[property];
      };
      const result = {
        colorScheme: getComputedStyle(shell).colorScheme,
        buttonScheme: getComputedStyle(nav).colorScheme,
        activeColor: getComputedStyle(nav).color,
        activeSurface: getComputedStyle(nav, '::before').backgroundColor,
        disabledColor: getComputedStyle(trash).color,
        disabledSurface: getComputedStyle(trash, '::before').backgroundColor,
        ink: used('--dash-ink', 'color'),
        selected: used('--dash-chrome-selected', 'backgroundColor'),
        disabledInk: used('--dash-disabled-ink', 'color'),
        disabledBg: used('--dash-disabled-bg', 'backgroundColor'),
      };
      probe.remove();
      return result;
    });
    expect(lightStyles.colorScheme).toContain('light');
    expect(lightStyles.buttonScheme).toContain('light');
    expectUsedColor(lightStyles.activeColor, lightStyles.ink);
    expectUsedColor(lightStyles.activeSurface, lightStyles.selected);
    expectUsedColor(lightStyles.disabledColor, lightStyles.disabledInk);
    expectUsedColor(lightStyles.disabledSurface, lightStyles.disabledBg);
    expect(lightStyles.activeColor).not.toBe(darkStyles.activeColor);
    expect(lightStyles.activeSurface).not.toBe(darkStyles.activeSurface);
    await dashboard.emulateMedia({ colorScheme: 'dark' });
    await themeTrigger.click();
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
      title: '客服运营工作台 · 演示数据',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      integratedChrome: process.platform === 'darwin',
    });
    await expect(dashboard.getByTestId('dashboard-brand')).toContainText('客服运营工作台');
    await expect(dashboard.getByTestId('dashboard-shell')).toHaveAttribute(
      'data-dashboard-chrome',
      process.platform === 'darwin' ? 'integrated' : 'native',
    );
    if (process.platform === 'darwin') {
      const chromeRegions = await dashboard.evaluate(() => {
        const read = (selector: string) => {
          const node = document.querySelector(selector);
          if (!node) return null;
          return getComputedStyle(node).getPropertyValue('-webkit-app-region');
        };
        return {
          nav: read('.dashboard-nav'),
          titlebarStrip: read('[data-testid="dashboard-titlebar-drag-strip"]'),
          island: read('[data-testid="dashboard-titlebar-control-island"]'),
          brand: read('[data-testid="dashboard-brand"]'),
          topbar: read('.dashboard-topbar'),
          topbarDrag: read('[data-testid="dashboard-topbar-drag-surface"]'),
          toggle: read('[data-testid="dashboard-nav-toggle"]'),
          overview: read('[data-testid="nav-overview"]'),
          resizer: read('[data-testid="dashboard-nav-resizer"]'),
          theme: read('[data-testid="dashboard-theme-trigger"]'),
        };
      });
      expect(chromeRegions).toEqual({
        nav: 'none',
        titlebarStrip: 'drag',
        island: 'no-drag',
        brand: 'no-drag',
        topbar: 'no-drag',
        topbarDrag: 'drag',
        toggle: 'no-drag',
        overview: 'no-drag',
        resizer: 'no-drag',
        theme: 'no-drag',
      });
      const chromeGeometry = await dashboard.evaluate(() => {
        const box = (selector: string) => {
          const node = document.querySelector<HTMLElement>(selector);
          if (!node) throw new Error(`${selector} missing`);
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top };
        };
        const nav = box('.dashboard-nav');
        const iconCenters = [...document.querySelectorAll('.dashboard-nav-icon')].map((node) => {
          const rect = node.getBoundingClientRect();
          return rect.x + rect.width / 2;
        });
        const brand = box('[data-testid="dashboard-brand"]');
        const logo = box('[data-testid="dashboard-brand-logo"]');
        const brandCopy = box('.dashboard-brand-copy');
        const collapse = box('[data-testid="dashboard-nav-toggle"]');
        const island = box('[data-testid="dashboard-titlebar-control-island"]');
        const context = box('.dashboard-page-context');
        return {
          strip: box('[data-testid="dashboard-titlebar-drag-strip"]'),
          island,
          topbar: box('.dashboard-topbar'),
          brand,
          logo,
          brandCopy,
          collapse,
          context,
          navLeft: nav.x,
          iconCenters,
          logoCenter: logo.x + logo.width / 2,
          contextCenterY: context.y + context.height / 2,
          logoOverlapsTitlebar: logo.y < 48,
        };
      });
      expect(Math.abs(chromeGeometry.strip.height - 48)).toBeLessThanOrEqual(1);
      expect(Math.abs(chromeGeometry.topbar.height - 48)).toBeLessThanOrEqual(1);
      expect(Math.abs(chromeGeometry.topbar.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(chromeGeometry.strip.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(chromeGeometry.collapse.x - 72)).toBeLessThanOrEqual(2);
      expect(Math.abs(chromeGeometry.collapse.y - 4)).toBeLessThanOrEqual(2);
      expect(Math.abs(chromeGeometry.collapse.width - 40)).toBeLessThanOrEqual(1);
      expect(Math.abs(chromeGeometry.collapse.height - 40)).toBeLessThanOrEqual(1);
      expect(chromeGeometry.island.x).toBeLessThanOrEqual(chromeGeometry.collapse.x + 1);
      expect(chromeGeometry.island.x + chromeGeometry.island.width)
        .toBeGreaterThanOrEqual(chromeGeometry.collapse.x + chromeGeometry.collapse.width - 1);
      expect(chromeGeometry.island.height).toBeGreaterThanOrEqual(48 - 1);
      expect(Math.abs(chromeGeometry.contextCenterY - 24)).toBeLessThanOrEqual(3);
      expect(chromeGeometry.brand.top).toBeGreaterThanOrEqual(48);
      expect(chromeGeometry.logoOverlapsTitlebar).toBe(false);
      const railCenter = chromeGeometry.navLeft + ICON_ANCHOR_OFFSET;
      expect(Math.abs(chromeGeometry.logoCenter - railCenter)).toBeLessThanOrEqual(1);
      expect(Math.abs(chromeGeometry.brandCopy.x - (chromeGeometry.logo.x + chromeGeometry.logo.width) - 16))
        .toBeLessThanOrEqual(1);
      chromeGeometry.iconCenters.forEach((center) => {
        expect(Math.abs(center - railCenter)).toBeLessThanOrEqual(1);
      });
      await dashboard.screenshot({ path: path.join(screenshotDir, 'dashboard-macos-chrome.png') });
    }
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

type RafResizeFrame = {
  timestamp: number;
  width: number;
  preview: string;
  previewWidth: number | null;
  phase: string | null;
  resizing: boolean;
  labelOpacity: number;
  brandOpacity: number;
  sidebarBackdrop: string;
  sidebarBlurPx: number;
  mainBackdrop: string;
  dividerX: number;
  navRight: number;
  mainLeft: number;
  topbarLeft: number;
  navLeft: number;
  iconCenter: number;
  ariaNow: number;
  ariaMin: number;
  ariaMax: number;
  navAfterHeight: string;
  navAfterWidth: string;
  navAfterRight: string;
  navAfterContent: string;
  navAfterDisplay: string;
};

type StructureTransitionStamp = {
  type: 'transitionrun' | 'transitionend' | 'transitioncancel';
  timestamp: number;
  propertyName: string;
  phase: string | null;
  path: string;
  width: number;
};

type StructurePathKind = 'rollback' | 'auto-transition' | 'reverse-cancel';

type StructurePathRecording = {
  frames: RafResizeFrame[];
  transitions: StructureTransitionStamp[];
  path: string;
  maxRafGap: number;
  rafGaps: number[];
};

type StructureRecorderHost = {
  __dashFrames?: RafResizeFrame[];
  __dashTransitions?: StructureTransitionStamp[];
  __dashRaf?: number;
  __dashPath?: string;
  __dashTransitionCleanup?: () => void;
};

async function startResizeFrameRecorder(page: Page, pathName = 'path'): Promise<void> {
  await page.evaluate((nextPath) => {
    const host = window as unknown as StructureRecorderHost;
    host.__dashTransitionCleanup?.();
    if (host.__dashRaf != null) window.cancelAnimationFrame(host.__dashRaf);
    host.__dashFrames = [];
    host.__dashTransitions = [];
    host.__dashPath = nextPath;
    const parseBlur = (value: string) => {
      if (!value || value === 'none') return 0;
      const match = value.match(/blur\(([\d.]+)px\)/);
      return match ? Number(match[1]) : Number.NaN;
    };
    const onTransition = (event: TransitionEvent) => {
      const shell = document.querySelector<HTMLElement>('[data-testid="dashboard-shell"]');
      if (!shell || event.target !== shell || event.propertyName !== 'grid-template-columns') return;
      if (event.type !== 'transitionrun' && event.type !== 'transitionend' && event.type !== 'transitioncancel') {
        return;
      }
      const nav = document.querySelector<HTMLElement>('.dashboard-nav');
      host.__dashTransitions?.push({
        type: event.type,
        timestamp: performance.now(),
        propertyName: event.propertyName,
        phase: shell.getAttribute('data-nav-phase'),
        path: host.__dashPath ?? nextPath,
        width: nav?.getBoundingClientRect().width ?? 0,
      });
    };
    const shell = document.querySelector<HTMLElement>('[data-testid="dashboard-shell"]');
    if (shell) {
      shell.addEventListener('transitionrun', onTransition);
      shell.addEventListener('transitionend', onTransition);
      shell.addEventListener('transitioncancel', onTransition);
      host.__dashTransitionCleanup = () => {
        shell.removeEventListener('transitionrun', onTransition);
        shell.removeEventListener('transitionend', onTransition);
        shell.removeEventListener('transitioncancel', onTransition);
      };
    }
    const take = () => {
      const timestamp = performance.now();
      const liveShell = document.querySelector<HTMLElement>('[data-testid="dashboard-shell"]');
      const nav = document.querySelector<HTMLElement>('.dashboard-nav');
      const main = document.querySelector<HTMLElement>('.dashboard-main');
      const topbar = document.querySelector<HTMLElement>('.dashboard-topbar');
      const icon = document.querySelector<HTMLElement>('.dashboard-nav-icon');
      const resizer = document.querySelector<HTMLElement>('[data-testid="dashboard-nav-resizer"]');
      const label = document.querySelector<HTMLElement>('.dashboard-nav-label');
      const brand = document.querySelector<HTMLElement>('.dashboard-brand-copy');
      if (liveShell && nav && main && topbar) {
        const navBox = nav.getBoundingClientRect();
        const after = getComputedStyle(nav, '::after');
        const afterRightPx = Number.parseFloat(after.right) || 0;
        const afterWidthPx = Number.parseFloat(after.width) || 0;
        const iconBox = icon?.getBoundingClientRect();
        const preview = liveShell.style.getPropertyValue('--dash-nav-preview-width');
        const parsedPreview = Number.parseFloat(preview);
        const sidebarBackdrop = getComputedStyle(nav).backdropFilter
          || getComputedStyle(nav).getPropertyValue('-webkit-backdrop-filter');
        const mainBackdrop = getComputedStyle(main).backdropFilter
          || getComputedStyle(main).getPropertyValue('-webkit-backdrop-filter');
        host.__dashFrames?.push({
          timestamp,
          width: navBox.width,
          preview,
          previewWidth: Number.isFinite(parsedPreview) ? parsedPreview : null,
          phase: liveShell.getAttribute('data-nav-phase'),
          resizing: liveShell.getAttribute('data-nav-resizing') === 'true',
          labelOpacity: label ? Number(getComputedStyle(label).opacity) : 0,
          brandOpacity: brand ? Number(getComputedStyle(brand).opacity) : 0,
          sidebarBackdrop,
          sidebarBlurPx: parseBlur(sidebarBackdrop),
          mainBackdrop,
          dividerX: navBox.right - afterRightPx - (afterWidthPx / 2),
          navRight: navBox.right,
          mainLeft: main.getBoundingClientRect().left,
          topbarLeft: topbar.getBoundingClientRect().left,
          navLeft: navBox.left,
          iconCenter: iconBox ? iconBox.left + (iconBox.width / 2) : navBox.left,
          ariaNow: Number(resizer?.getAttribute('aria-valuenow') ?? 0),
          ariaMin: Number(resizer?.getAttribute('aria-valuemin') ?? 0),
          ariaMax: Number(resizer?.getAttribute('aria-valuemax') ?? 0),
          navAfterHeight: after.height,
          navAfterWidth: after.width,
          navAfterRight: after.right,
          navAfterContent: after.content,
          navAfterDisplay: after.display,
        });
      }
      host.__dashRaf = window.requestAnimationFrame(take);
    };
    take();
  }, pathName);
}

async function awaitRecordedStructureSettle(
  page: Page,
  endWidth: number,
  expectedFinalPhase: 'collapsed' | 'expanded',
): Promise<void> {
  await expect.poll(() => page.evaluate((input) => {
    const host = window as unknown as StructureRecorderHost;
    const events = host.__dashTransitions ?? [];
    const frames = host.__dashFrames ?? [];
    // Cancel is not a settle. The recorded path must see the target
    // grid-template-columns transitionend before we stop the rAF recorder.
    const lastEnd = [...events].reverse().find((event) => (
      event.type === 'transitionend'
      && event.propertyName === 'grid-template-columns'
      && Math.abs(event.width - input.target) <= 2
    ));
    if (!lastEnd) return false;

    const afterEnd = frames.filter((frame) => frame.timestamp > lastEnd.timestamp);
    const firstCompleteRaf = afterEnd.find((frame) => frame.timestamp - lastEnd.timestamp >= 8);
    if (!firstCompleteRaf || firstCompleteRaf.preview !== '') return false;

    const extraAfterPreviewClear = afterEnd.filter((frame) => (
      frame.timestamp > firstCompleteRaf.timestamp
    ));
    if (extraAfterPreviewClear.length === 0) return false;

    const shell = document.querySelector<HTMLElement>('[data-testid="dashboard-shell"]');
    const nav = document.querySelector<HTMLElement>('.dashboard-nav');
    const resizer = document.querySelector<HTMLElement>('[data-testid="dashboard-nav-resizer"]');
    if (!shell || !nav) return false;

    const livePhase = shell.getAttribute('data-nav-phase');
    const liveWidth = nav.getBoundingClientRect().width;
    const livePreview = shell.style.getPropertyValue('--dash-nav-preview-width');
    const liveAria = Number(resizer?.getAttribute('aria-valuenow') ?? Number.NaN);
    if (livePhase !== input.expectedFinalPhase) return false;
    if (livePreview !== '') return false;
    if (Math.abs(liveWidth - input.target) > 2) return false;
    if (!Number.isFinite(liveAria) || Math.abs(liveAria - input.target) > 1) return false;

    const terminal = extraAfterPreviewClear[extraAfterPreviewClear.length - 1];
    if (terminal.phase !== input.expectedFinalPhase) return false;
    if (terminal.preview !== '') return false;
    if (Math.abs(terminal.width - input.target) > 2) return false;
    if (Math.abs(terminal.ariaNow - input.target) > 1) return false;

    if (extraAfterPreviewClear.length >= 2) {
      const previous = extraAfterPreviewClear[extraAfterPreviewClear.length - 2];
      if (previous.phase !== terminal.phase) return false;
      if (previous.preview !== '') return false;
      if (Math.abs(previous.width - terminal.width) > 2) return false;
      if (Math.abs(previous.ariaNow - terminal.ariaNow) > 1) return false;
    }

    return true;
  }, { target: endWidth, expectedFinalPhase })).toBe(true);
}

async function stopResizeFrameRecorder(page: Page): Promise<StructurePathRecording> {
  const recording = await page.evaluate(() => {
    const host = window as unknown as StructureRecorderHost;
    if (host.__dashRaf != null) window.cancelAnimationFrame(host.__dashRaf);
    host.__dashTransitionCleanup?.();
    const frames = host.__dashFrames ?? [];
    const recording = {
      frames,
      transitions: host.__dashTransitions ?? [],
      path: host.__dashPath ?? '',
    };
    host.__dashFrames = [];
    host.__dashTransitions = [];
    host.__dashRaf = undefined;
    host.__dashPath = undefined;
    host.__dashTransitionCleanup = undefined;
    return recording;
  });
  const rafGaps = recording.frames.slice(1).map((frame, index) => (
    Math.max(0, frame.timestamp - recording.frames[index].timestamp)
  ));
  return {
    ...recording,
    rafGaps,
    maxRafGap: rafGaps.length > 0 ? Math.max(...rafGaps) : 0,
  };
}

function framesFromRawStart(frames: RafResizeFrame[], start: number): RafResizeFrame[] {
  const index = frames.findIndex((frame) => Math.abs(frame.width - start) <= 1.5);
  expect(index, `raw start ${start} missing in ${frames.map((frame) => Math.round(frame.width)).join(',')}`).toBeGreaterThanOrEqual(0);
  return frames.slice(index);
}

function rafMetricsFromFrames(frames: RafResizeFrame[]): { rafGaps: number[]; maxRafGap: number } {
  const rafGaps = frames.slice(1).map((frame, index) => (
    Math.max(0, frame.timestamp - frames[index].timestamp)
  ));
  return {
    rafGaps,
    maxRafGap: rafGaps.length > 0 ? Math.max(...rafGaps) : 0,
  };
}

function formatTransitionEvidence(events: StructureTransitionStamp[]): string {
  if (events.length === 0) return '(none)';
  return events.map((event, index) => (
    `${index}:${event.type}@${event.timestamp.toFixed(1)} w=${event.width.toFixed(1)} phase=${event.phase ?? 'null'}`
  )).join(' → ');
}

function expectReverseCancelTransitionSequence(
  events: StructureTransitionStamp[],
  path: string,
): StructureTransitionStamp {
  const evidence = formatTransitionEvidence(events);
  // CSS Transitions: reversing a running transition cancels it, then a new
  // transition is created to the reversed target. The recorded
  // grid-template-columns contract is exactly:
  // transitionrun → transitioncancel → transitionrun → transitionend
  // with no trailing run/cancel after the settling end.
  console.log(`[${path}] reverse-cancel observed transitions: ${evidence}`);

  expect(events.length, `${path} reverse-cancel recorded no structure transitions (${evidence})`).toBeGreaterThanOrEqual(4);

  const firstRun = events.findIndex((event) => event.type === 'transitionrun');
  expect(firstRun, `${path} missing first transitionrun (${evidence})`).toBeGreaterThanOrEqual(0);

  const cancel = events.findIndex((event, index) => (
    index > firstRun && event.type === 'transitioncancel'
  ));
  expect(cancel, `${path} missing transitioncancel after first transitionrun (${evidence})`).toBeGreaterThan(firstRun);

  const secondRun = events.findIndex((event, index) => (
    index > cancel && event.type === 'transitionrun'
  ));
  expect(secondRun, `${path} missing second transitionrun after transitioncancel (${evidence})`).toBeGreaterThan(cancel);

  const finalEnd = events.findIndex((event, index) => (
    index > secondRun && event.type === 'transitionend'
  ));
  expect(finalEnd, `${path} missing final transitionend after second transitionrun (${evidence})`).toBeGreaterThan(secondRun);

  const core = events.slice(firstRun, finalEnd + 1).map((event) => event.type);
  expect(
    core,
    `${path} reverse-cancel must be run→cancel→run→end with no extra structure events (${evidence})`,
  ).toEqual(['transitionrun', 'transitioncancel', 'transitionrun', 'transitionend']);

  expect(events[cancel].timestamp).toBeGreaterThanOrEqual(events[firstRun].timestamp);
  expect(events[secondRun].timestamp).toBeGreaterThanOrEqual(events[cancel].timestamp);
  expect(events[finalEnd].timestamp).toBeGreaterThanOrEqual(events[secondRun].timestamp);

  const trailing = events.slice(finalEnd + 1).filter((event) => (
    event.type === 'transitioncancel' || event.type === 'transitionrun'
  ));
  expect(
    trailing,
    `${path} final transitionend must not be followed by trailing transitioncancel/transitionrun (${evidence})`,
  ).toEqual([]);

  return events[finalEnd];
}

function expectRecordedResizePath(
  recording: StructurePathRecording,
  options: {
    kind: StructurePathKind;
    direction?: 'down' | 'up';
    start: number;
    end: number;
    rawPreview?: number;
    finalPhase: 'collapsed' | 'expanded';
    transientPhase?: 'collapsing' | 'expanding';
  },
) {
  const reverse = options.kind === 'reverse-cancel';
  const frames = framesFromRawStart(recording.frames, options.start);
  const { rafGaps, maxRafGap } = rafMetricsFromFrames(frames);
  expect(frames.length).toBeGreaterThan(3);
  expect(Math.abs(frames[0].width - options.start)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(frames[frames.length - 1].width - options.end)).toBeLessThanOrEqual(1.5);
  if (options.direction && !reverse) {
    expectContinuousWidthSamples(frames, {
      direction: options.direction,
      start: options.start,
      end: options.end,
    });
  }
  const rawTarget = options.rawPreview ?? options.start;
  const commitIndex = frames.findIndex((frame) => (
    Math.abs(frame.width - rawTarget) <= 1.5
    && frame.preview !== ''
    && frame.previewWidth != null
  ));
  expect(
    commitIndex,
    `${recording.path} missing a committed raw preview paint frame near ${rawTarget}`,
  ).toBeGreaterThanOrEqual(0);

  recording.transitions.forEach((event) => {
    expect(event.path).toBe(recording.path);
    expect(event.propertyName).toBe('grid-template-columns');
  });
  expect(recording.transitions.length, `${recording.path} recorded no structure transitions`).toBeGreaterThan(0);
  for (let index = 1; index < recording.transitions.length; index += 1) {
    expect(recording.transitions[index].timestamp)
      .toBeGreaterThanOrEqual(recording.transitions[index - 1].timestamp);
  }

  const runs = recording.transitions.filter((event) => event.type === 'transitionrun');
  const ends = recording.transitions.filter((event) => event.type === 'transitionend');
  const cancels = recording.transitions.filter((event) => event.type === 'transitioncancel');
  const endsAtTarget = ends.filter((event) => Math.abs(event.width - options.end) <= 2);
  let stabilizeEvent: StructureTransitionStamp;

  if (reverse) {
    stabilizeEvent = expectReverseCancelTransitionSequence(recording.transitions, recording.path);
    expect(
      Math.abs(stabilizeEvent.width - options.end),
      `${recording.path} final transitionend width ${stabilizeEvent.width.toFixed(1)} must settle near ${options.end}`,
    ).toBeLessThanOrEqual(2);
  } else {
    expect(cancels, `${recording.path} ${options.kind} cannot treat transitioncancel as success`).toEqual([]);
    expect(runs[0], `${recording.path} ${options.kind} must observe transitionrun`).toBeTruthy();
    expect(ends[0], `${recording.path} ${options.kind} must observe transitionend after transitionrun`).toBeTruthy();
    const settlingEnd = endsAtTarget[endsAtTarget.length - 1] ?? ends[ends.length - 1];
    const runBeforeSettle = [...runs].reverse().find((event) => event.timestamp <= settlingEnd.timestamp) ?? runs[0];
    expect(runBeforeSettle, `${recording.path} ${options.kind} missing transitionrun before settle`).toBeTruthy();
    expect(settlingEnd.timestamp).toBeGreaterThan(runBeforeSettle.timestamp);
    expect(settlingEnd.timestamp - runBeforeSettle.timestamp).toBeGreaterThanOrEqual(140);
    expect(settlingEnd.timestamp - runBeforeSettle.timestamp).toBeLessThanOrEqual(280);
    stabilizeEvent = settlingEnd;
  }

  const stabilizeAt = stabilizeEvent.timestamp;
  const lastBeforeStabilize = [...frames]
    .reverse()
    .find((frame) => frame.timestamp <= stabilizeAt);
  expect(lastBeforeStabilize, `${recording.path} missing sample before last relevant ${stabilizeEvent.type}`).toBeTruthy();
  expect(
    lastBeforeStabilize!.preview,
    `${recording.path} last sample before ${stabilizeEvent.type} must still hold preview`,
  ).not.toBe('');
  const afterStabilize = frames.filter((frame) => frame.timestamp > stabilizeAt);
  expect(
    afterStabilize.length,
    `${recording.path} missing first rAF after structure stabilize`,
  ).toBeGreaterThanOrEqual(1);
  const firstFreshRaf = afterStabilize.find((frame) => frame.timestamp - stabilizeAt >= 8)
    ?? afterStabilize[0];
  expect(
    firstFreshRaf.preview,
    `${recording.path} first rAF tick after stabilize must clear preview (dt=${(firstFreshRaf.timestamp - stabilizeAt).toFixed(1)}ms)`,
  ).toBe('');
  afterStabilize
    .filter((frame) => frame.timestamp >= firstFreshRaf.timestamp)
    .forEach((frame) => {
      expect(frame.preview, `${recording.path} preview survived stabilize`).toBe('');
    });
  const settleWindow = frames.filter((frame) => (
    frame.timestamp >= frames[commitIndex].timestamp && frame.timestamp <= stabilizeAt
  ));
  expect(settleWindow.length, `${recording.path} empty  settle window`).toBeGreaterThanOrEqual(1);
  settleWindow.forEach((frame) => {
    expect(
      frame.preview,
      `${recording.path} preview must stay non-empty until structure stabilize (phase=${frame.phase} width=${frame.width.toFixed(1)})`,
    ).not.toBe('');
  });
  expect(frames[frames.length - 1].preview).toBe('');

  const sidebarBlurs = frames.map((frame) => frame.sidebarBlurPx);
  expect(sidebarBlurs.every((blur) => Number.isFinite(blur))).toBe(true);
  frames.forEach((frame) => {
    const suppressesSidebarBlur = frame.resizing
      || frame.phase === 'collapsing'
      || frame.phase === 'expanding';
    expect(
      frame.sidebarBlurPx,
      `${recording.path} phase=${frame.phase} resizing=${frame.resizing} blur=${frame.sidebarBackdrop}`,
    ).toBe(suppressesSidebarBlur ? 0 : 20);
    expect(frame.mainBackdrop === '' || frame.mainBackdrop === 'none').toBe(true);
    expectCollectedPseudoFields(frame);
    expectSharedStructureEdges(frame);
    expect(Math.abs(frame.iconCenter - (frame.navLeft + ICON_ANCHOR_OFFSET))).toBeLessThanOrEqual(1);
    expect(frame.ariaMin).toBeLessThanOrEqual(frame.ariaNow);
    expect(frame.ariaNow).toBeLessThanOrEqual(frame.ariaMax);
    const visual = Math.round(frame.width);
    const previewNow = frame.previewWidth == null ? null : Math.round(frame.previewWidth);
    const expandedVisual = frame.phase === 'expanded' || frame.phase === 'expanding';
    const matchesVisual = Math.abs(frame.ariaNow - visual) <= 1;
    const matchesPreview = previewNow != null && Math.abs(frame.ariaNow - previewNow) <= 1;
    if (expandedVisual && visual < 216) {
      const committedRail = visual <= 192
        && (matchesVisual || frame.ariaNow === COLLAPSED_SURFACE || matchesPreview);
      const committedExpand = previewNow != null && previewNow >= 216 && matchesPreview;
      expect(
        frame.ariaNow === 216 || committedRail || committedExpand,
        `${recording.path} expanded visual ${visual} must publish now=216 (got ${frame.ariaNow}, preview ${frame.preview}, phase ${frame.phase})`,
      ).toBe(true);
    } else {
      expect(
        matchesVisual || matchesPreview,
        `${recording.path} aria ${frame.ariaNow} vs visual ${visual} preview ${frame.preview} phase ${frame.phase}`,
      ).toBe(true);
    }
    if (frame.phase !== 'expanded') {
      expect(frame.labelOpacity).toBeLessThanOrEqual(0.05);
      expect(frame.brandOpacity).toBeLessThanOrEqual(0.05);
    }
  });

  expect(frames[frames.length - 1].phase).toBe(options.finalPhase);
  if (options.kind === 'auto-transition') {
    expect(options.transientPhase, `${recording.path} auto-transition needs a transient phase`).toBeTruthy();
    expect(
      frames.some((frame) => frame.phase === options.transientPhase),
      `${recording.path} auto-transition never entered ${options.transientPhase}`,
    ).toBe(true);
  }
  if (options.kind === 'rollback') {
    const forbidden = options.finalPhase === 'collapsed'
      ? ['expanding', 'expanded']
      : ['collapsing', 'collapsed'];
    const leaked = frames.filter((frame) => forbidden.includes(frame.phase ?? ''));
    expect(leaked, `${recording.path} rollback leaked ${forbidden.join('/')}`).toEqual([]);
  }

  const observedLo = Math.min(...frames.map((frame) => frame.width));
  const observedHi = Math.max(...frames.map((frame) => frame.width));
  const span = reverse ? observedHi - observedLo : Math.abs(options.end - options.start);
  const lo = reverse ? observedLo : Math.min(options.start, options.end);
  const hi = reverse ? observedHi : Math.max(options.start, options.end);
  const midLow = lo + 2;
  const midHigh = hi - 2;
  if (span > 8) {
    const intermediates = frames.filter((frame) => frame.width > midLow && frame.width < midHigh);
    expect(
      intermediates.length,
      `${recording.path} needs at least 2 intermediate widths, got ${frames.map((frame) => Math.round(frame.width)).join(',')}`,
    ).toBeGreaterThanOrEqual(2);
  }

  const stalls: Array<{ from: number; to: number; dt: number; jump: number }> = [];
  const frameWidths = frames.map((frame) => frame.width.toFixed(1)).join(',');
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    const dt = Math.max(0, current.timestamp - previous.timestamp);
    const jump = Math.abs(current.width - previous.width);
    const coversFullSpan = span > 8 && (
      (Math.abs(previous.width - lo) <= 1.5 && Math.abs(current.width - hi) <= 1.5)
      || (Math.abs(previous.width - hi) <= 1.5 && Math.abs(current.width - lo) <= 1.5)
    );
    expect(
      coversFullSpan,
      `${recording.path} one frame covered the full structure span ${previous.width.toFixed(1)}→${current.width.toFixed(1)} over ${dt.toFixed(1)}ms (populationMaxRafGap=${maxRafGap.toFixed(1)}ms, frames=${frameWidths})`,
    ).toBe(false);
    const velocityBound = ((span || jump) / STRUCTURE_MOTION_MS) * Math.max(dt, 8) * 4.5 + 2;
    if (dt >= STALL_RAF_GAP_MS) {
      stalls.push({ from: previous.width, to: current.width, dt, jump });
      expect(
        jump,
        `${recording.path} classified stall ${dt.toFixed(1)}ms ${previous.width.toFixed(1)}→${current.width.toFixed(1)} exceeded dt velocity bound ${velocityBound.toFixed(1)} (populationMaxRafGap=${maxRafGap.toFixed(1)}ms)`,
      ).toBeLessThanOrEqual(Math.max(velocityBound, 8));
    } else {
      const normalDt = dt < NORMAL_RAF_GAP_MS ? Math.max(dt, 16) : dt;
      const normalBound = ((span || 1) / STRUCTURE_MOTION_MS) * normalDt * 4.5 + 2;
      expect(
        jump,
        `${recording.path} jump ${previous.width.toFixed(1)}→${current.width.toFixed(1)} over ${dt.toFixed(1)}ms (populationMaxRafGap=${maxRafGap.toFixed(1)}ms, bound=${normalBound.toFixed(1)}, frames=${frameWidths})`,
      ).toBeLessThanOrEqual(Math.max(normalBound, 8));
    }
  }
  expect(maxRafGap).toBeGreaterThanOrEqual(0);
  const stallGapCount = rafGaps.filter((gap) => gap >= STALL_RAF_GAP_MS).length;
  expect(
    stalls.length,
    `${recording.path} stall frames and rAF gaps must use the same framesFromRawStart population (stalls=${stalls.length}, stallGaps=${stallGapCount}, populationMaxRafGap=${maxRafGap.toFixed(1)}ms)`,
  ).toBe(stallGapCount);
}

// CDP / Playwright mouse is not a WindowServer hit test. These paths prove
// renderer geometry and the typed pointer state machine, not native traffic-light
// or titlebar drag delivery.
test('records real mouse sidebar paths without first-frame snap or settle reverse', async () => {
  const app = await launchApp();
  try {
    await waitForRole(app, 'fox');
    await expect.poll(() => app.evaluate(() => Boolean(
      (globalThis as { __demoTest?: DemoHarness }).__demoTest,
    ))).toBe(true);
    await app.evaluate(() => {
      const demo = (globalThis as { __demoTest?: DemoHarness }).__demoTest;
      if (!demo) throw new Error('DEMO_E2E harness missing');
      return demo.openDashboard();
    });
    const dashboard = await waitForRole(app, 'dashboard');
    await setDashboardSize(app, 1180, 760);
    await expect(dashboard.getByTestId('dashboard-shell')).toBeVisible();
    const shell = dashboard.getByTestId('dashboard-shell');
    const navResizer = dashboard.getByTestId('dashboard-nav-resizer');

    const dragToWidth = async (width: number, steps = 10) => {
      const shellBox = await shell.boundingBox();
      if (!shellBox) throw new Error('shell missing for width drag');
      let box = await prepareCollapsedResizerDrag(dashboard);
      const aim = (handle: { x: number; y: number; width: number; height: number }) => ({
        x: handle.x + (handle.width / 2),
        y: handle.y + Math.min(180, handle.height / 2),
      });
      await dashboard.mouse.move(aim(box).x, aim(box).y);
      await dashboard.mouse.down();
      if (await shell.getAttribute('data-nav-resizing') !== 'true') {
        await dashboard.mouse.up();
        box = await prepareCollapsedResizerDrag(dashboard);
        await dashboard.mouse.move(aim(box).x, aim(box).y);
        await dashboard.mouse.down();
      }
      await expect(shell).toHaveAttribute('data-nav-resizing', 'true');
      await dashboard.mouse.move(
        shellBox.x + width,
        aim(box).y,
        { steps },
      );
      return box;
    };

    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(248);
    await startResizeFrameRecorder(dashboard, 'expanded-auto-collapse');
    await dragToWidth(192, 12);
    await expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(COLLAPSED_SURFACE);
    await dashboard.mouse.up();
    await expect.poll(() => shell.evaluate(
      (node) => node.style.getPropertyValue('--dash-nav-preview-width'),
    )).toBe('');
    await awaitRecordedStructureSettle(dashboard, COLLAPSED_SURFACE, 'collapsed');
    const auto192 = await stopResizeFrameRecorder(dashboard);
    expectRecordedResizePath(auto192, {
      kind: 'auto-transition',
      direction: 'down',
      start: 192,
      end: COLLAPSED_SURFACE,
      rawPreview: 192,
      transientPhase: 'collapsing',
      finalPhase: 'collapsed',
    });
    expect(auto192.frames.some((frame) => (
      frame.phase === 'collapsing' && Math.abs(frame.width - 192) <= 1.5
    ))).toBe(true);

    await expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    if (process.platform === 'darwin') {
      const downOnly = await prepareCollapsedResizerDrag(dashboard);
      await dashboard.mouse.move(
        downOnly.x + (downOnly.width / 2),
        downOnly.y + Math.min(180, downOnly.height / 2),
      );
      await dashboard.mouse.down();
      await expect(shell).toHaveAttribute('data-nav-resizing', 'true');
      const frozen = await readStructureBoundary(dashboard);
      expect(Math.abs(frozen.navWidth - 120)).toBeLessThanOrEqual(1);
      expectSharedStructureEdges(frozen);
      expect(Math.abs(frozen.dividerX - 120)).toBeLessThanOrEqual(1.5);
      await expectCollapsedPreviewRollback(dashboard, async () => {
        await dashboard.mouse.up();
      });
    }

    await startResizeFrameRecorder(dashboard, 'collapsed-rollback');
    await dragToWidth(207, 8);
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(207);
    await dashboard.mouse.up();
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(COLLAPSED_SURFACE);
    await expect.poll(() => shell.evaluate(
      (node) => node.style.getPropertyValue('--dash-nav-preview-width'),
    )).toBe('');
    await awaitRecordedStructureSettle(dashboard, COLLAPSED_SURFACE, 'collapsed');
    expectRecordedResizePath(await stopResizeFrameRecorder(dashboard), {
      kind: 'rollback',
      direction: 'down',
      start: 207,
      end: COLLAPSED_SURFACE,
      rawPreview: 207,
      finalPhase: 'collapsed',
    });

    await startResizeFrameRecorder(dashboard, 'collapsed-auto-expand');
    await dragToWidth(208, 8);
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(208);
    await expect.poll(() => shell.getAttribute('data-nav-phase')).toMatch(/expanding|expanded/);
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(248);
    await dashboard.mouse.up();
    await expect.poll(() => shell.evaluate(
      (node) => node.style.getPropertyValue('--dash-nav-preview-width'),
    )).toBe('');
    await awaitRecordedStructureSettle(dashboard, 248, 'expanded');
    expectRecordedResizePath(await stopResizeFrameRecorder(dashboard), {
      kind: 'auto-transition',
      direction: 'up',
      start: 208,
      end: 248,
      rawPreview: 208,
      transientPhase: 'expanding',
      finalPhase: 'expanded',
    });

    await startResizeFrameRecorder(dashboard, 'reverse-cancel');
    await expect.poll(() => dashboard.evaluate(() => (
      (window as unknown as { __dashFrames?: unknown[] }).__dashFrames?.length ?? 0
    ))).toBeGreaterThan(3);
    const reverseToggleBox = await dashboard.getByTestId('dashboard-nav-toggle').boundingBox();
    if (!reverseToggleBox) throw new Error('toggle missing for reverse/cancel');
    const toggleCenter = {
      x: reverseToggleBox.x + (reverseToggleBox.width / 2),
      y: reverseToggleBox.y + (reverseToggleBox.height / 2),
    };
    await dashboard.mouse.click(toggleCenter.x, toggleCenter.y);
    await expect.poll(() => dashboard.evaluate(() => {
      const liveShell = document.querySelector('[data-testid="dashboard-shell"]');
      const nav = document.querySelector('.dashboard-nav');
      if (!liveShell || !nav) return false;
      return liveShell.getAttribute('data-nav-phase') === 'collapsing'
        && nav.getBoundingClientRect().width < 240;
    })).toBe(true);
    await dashboard.mouse.click(toggleCenter.x, toggleCenter.y);
    await expect.poll(() => shell.getAttribute('data-nav-phase')).toMatch(/expanding|expanded/);
    await expect.poll(() => shell.getAttribute('data-nav-phase')).toBe('expanded');
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(248);
    await expect.poll(() => shell.evaluate(
      (node) => node.style.getPropertyValue('--dash-nav-preview-width'),
    )).toBe('');
    await awaitRecordedStructureSettle(dashboard, 248, 'expanded');
    expectRecordedResizePath(await stopResizeFrameRecorder(dashboard), {
      kind: 'reverse-cancel',
      start: 248,
      end: 248,
      rawPreview: 248,
      finalPhase: 'expanded',
    });

    await startResizeFrameRecorder(dashboard, 'expanded-snap-193');
    await dragToWidth(193, 12);
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(193);
    await dashboard.mouse.up();
    await expect.poll(() => dashboard.locator('.dashboard-nav').evaluate(
      (node) => Math.round(node.getBoundingClientRect().width),
    )).toBe(216);
    await expect.poll(() => shell.evaluate(
      (node) => node.style.getPropertyValue('--dash-nav-preview-width'),
    )).toBe('');
    await awaitRecordedStructureSettle(dashboard, 216, 'expanded');
    expectRecordedResizePath(await stopResizeFrameRecorder(dashboard), {
      kind: 'rollback',
      direction: 'up',
      start: 193,
      end: 216,
      rawPreview: 193,
      finalPhase: 'expanded',
    });
    await expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    await expect(navResizer).toBeVisible();
  } finally {
    await app.close();
  }
});
