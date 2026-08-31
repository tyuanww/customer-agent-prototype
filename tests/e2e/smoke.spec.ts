import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page, _electron as electron } from '@playwright/test';
import {
  FOX_EDGE_VISIBLE_PX,
  FOX_SIZE,
} from '../../src/shared/overlay-geometry';
import {
  FOX_RETRACT_DURATION_MS,
  QUERY_CLOSE_DURATION_MS,
  QUERY_OPEN_DURATION_MS,
} from '../../src/shared/fox-motion';
import { SYNTHETIC_SCRIPTS } from '../../src/renderer/data/synthetic-scripts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainEntry = path.join(repoRoot, 'out/main/index.js');
const screenshotDir = path.join(repoRoot, '.gstack/qa-reports/screenshots');
const CLEANSER_QUERY = '澄芽氨基酸洁面怎么用';
const VERBATIM_TAIL = '合成原文保留尾部空格与换行  \n\n';
let launchSequence = 0;

const cleanser = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-prod-001');
const cleanserSecond = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-prod-001-care');
if (!cleanser || !cleanserSecond) {
  throw new Error('missing cleanser demo fixtures');
}

async function launchApp(envOverrides: NodeJS.ProcessEnv = {}): Promise<ElectronApplication> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-agent-demo-e2e-'));
  const shortcutKey = String.fromCharCode(65 + (launchSequence % 26));
  launchSequence += 1;
  try {
    const app = await electron.launch({
      cwd: repoRoot,
      args: [`--user-data-dir=${userDataDir}`, mainEntry, '--demo-e2e'],
      env: {
        ...process.env,
        DEMO_E2E: '1',
        DEMO_E2E_ACCELERATOR: `CommandOrControl+Alt+Shift+${shortcutKey}`,
        ...envOverrides,
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

async function readMainClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

async function parkFoxPointerOutside(app: ElectronApplication, fox: Page): Promise<void> {
  const session = await fox.context().newCDPSession(fox);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: -80,
    y: -80,
    button: 'none',
  });
  await fox.getByTestId('fox-idle').dispatchEvent('pointerleave');
  await fox.getByTestId('fox-button').dispatchEvent('pointerleave');

  if (process.platform !== 'darwin') {
    return;
  }
  const safe = await app.evaluate(({ screen, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('role=fox'));
    if (!win) return null;
    const bounds = win.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const candidates = [
      { x: workArea.x + 6, y: workArea.y + 6 },
      { x: workArea.x + workArea.width - 6, y: workArea.y + 6 },
      { x: workArea.x + 6, y: workArea.y + workArea.height - 6 },
      { x: workArea.x + workArea.width - 6, y: workArea.y + workArea.height - 6 },
    ];
    const far = candidates
      .map((point) => ({
        ...point,
        d: Math.hypot(
          point.x - (bounds.x + bounds.width / 2),
          point.y - (bounds.y + bounds.height / 2),
        ),
      }))
      .sort((left, right) => right.d - left.d)[0];
    return { x: Math.round(far.x), y: Math.round(far.y) };
  });
  if (!safe) return;
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('osascript', [
      '-l',
      'JavaScript',
      '-e',
      `ObjC.import("CoreGraphics"); $.CGWarpMouseCursorPosition({x:${safe.x}, y:${safe.y}}); $.CGAssociateMouseAndMouseCursorPosition(true);`,
    ], { stdio: 'ignore' });
  } catch {
    // OS cursor warp is best-effort; CDP + synthetic leave still apply.
  }
}

async function followFoxLocally(fox: Page): Promise<void> {
  await fox.getByTestId('fox-idle').evaluate((idle) => {
    const box = idle.getBoundingClientRect();
    idle.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width * 0.78,
      clientY: box.top + box.height * 0.22,
      pointerId: 7,
      pointerType: 'mouse',
    }));
  });
}

async function writeMainClipboard(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate(({ clipboard }, value) => {
    clipboard.writeText(value);
  }, text);
}

async function restoreClipboard(app: ElectronApplication, original: string): Promise<void> {
  try {
    await writeMainClipboard(app, original);
  } catch {
    // Window may already be tearing down.
  }
}

async function windowSnapshot(app: ElectronApplication): Promise<
  Array<{
    role: string;
    visible: boolean;
    focused: boolean;
    webContentsFocused: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    visibleOnAllWorkspaces: boolean;
  }>
> {
  return app.evaluate(({ BrowserWindow }) => {
    const snapshots: Array<{
      role: string;
      visible: boolean;
      focused: boolean;
      webContentsFocused: boolean;
      x: number;
      y: number;
      width: number;
      height: number;
      visibleOnAllWorkspaces: boolean;
    }> = [];

    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;

      try {
        const bounds = win.getBounds();
        const url = win.webContents.getURL();
        snapshots.push({
          role: url.includes('role=dashboard')
            ? 'dashboard'
            : url.includes('role=fox')
              ? 'fox'
              : url.includes('role=query')
                ? 'query'
                : url,
          visible: win.isVisible(),
          focused: win.isFocused(),
          webContentsFocused: win.webContents.isFocused(),
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          visibleOnAllWorkspaces: win.isVisibleOnAllWorkspaces(),
        });
      } catch (error) {
        // A native close can destroy the window between enumeration and readback.
        if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
        throw error;
      }
    }

    return snapshots;
  });
}

async function waitForNativeFocus(
  app: ElectronApplication,
  role: 'query' | 'dashboard',
): Promise<void> {
  await expect.poll(async () => {
    const snap = await windowSnapshot(app);
    const target = snap.find((item) => item.role === role);
    return {
      focused: target?.focused ?? false,
      webContentsFocused: target?.webContentsFocused ?? false,
    };
  }).toEqual({ focused: true, webContentsFocused: true });
}

async function waitForInteractiveQuery(
  app: ElectronApplication,
  query: Page,
): Promise<void> {
  await expect.poll(async () => {
    const snap = await windowSnapshot(app);
    return snap.find((item) => item.role === 'query' && item.visible) ?? null;
  }).toMatchObject({
    width: 600,
    height: 88,
    focused: true,
    webContentsFocused: true,
  });
  await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
  await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
  await expect.poll(() => query.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.dataset.testid || active?.id || active?.tagName.toLowerCase() || 'none';
  })).toBe('question-input');
}

async function waitForHarness(app: ElectronApplication): Promise<void> {
  await expect.poll(
    () => app.evaluate(() => Boolean((globalThis as { __demoTest?: unknown }).__demoTest)),
    { timeout: 10_000 },
  ).toBe(true);
}

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test('starts as a fox floater, searches, copies verbatim text, and never claims 已发送', async () => {
  const app = await launchApp();
  let savedClipboard = '';

  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');
    savedClipboard = await readMainClipboard(app);

    await fox.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => fox.evaluate(() => (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ))).toBe(false);
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'awake');
    await expect.poll(() => fox.locator('.fox-head').evaluate((head) => (
      getComputedStyle(head).animationName
    ))).toBe('fox-idle-motion');
    await expect(fox.getByTestId('fox-button')).toBeVisible();
    const foxTransparencyAndMotion = await fox.getByTestId('fox-button').evaluate((button) => {
      const htmlStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      const rootStyle = getComputedStyle(document.querySelector<HTMLElement>('#root')!);
      const head = button.querySelector<HTMLElement>('.fox-head');
      if (!head) {
        throw new Error('fox head missing');
      }
      const headStyle = getComputedStyle(head);
      return {
        htmlBackground: htmlStyle.backgroundColor,
        bodyBackground: bodyStyle.backgroundColor,
        rootBackground: rootStyle.backgroundColor,
        headBackground: headStyle.backgroundColor,
        animationName: headStyle.animationName,
        animationDuration: headStyle.animationDuration,
      };
    });
    const motionParams = await fox.getByTestId('fox-idle').evaluate((el) => ({
      duration: el.getAttribute('data-idle-duration-ms'),
      floatPx: el.getAttribute('data-idle-float-px'),
      swing: el.getAttribute('data-idle-swing-deg'),
      scale: el.getAttribute('data-idle-max-scale'),
      snap: el.getAttribute('data-snap-duration-ms'),
      cssDuration: getComputedStyle(el).getPropertyValue('--fox-idle-duration').trim(),
      cssFloat: getComputedStyle(el).getPropertyValue('--fox-idle-float').trim(),
      cssSwing: getComputedStyle(el).getPropertyValue('--fox-idle-swing').trim(),
      cssScale: getComputedStyle(el).getPropertyValue('--fox-idle-max-scale').trim(),
    }));
    expect(motionParams).toMatchObject({
      duration: '3000',
      floatPx: '4',
      swing: '2',
      scale: '1.04',
      snap: '480',
      cssDuration: '3s',
      cssFloat: '4px',
      cssSwing: '2deg',
      cssScale: '1.04',
    });
    expect(foxTransparencyAndMotion).toMatchObject({
      htmlBackground: 'rgba(0, 0, 0, 0)',
      bodyBackground: 'rgba(0, 0, 0, 0)',
      rootBackground: 'rgba(0, 0, 0, 0)',
      headBackground: 'rgba(0, 0, 0, 0)',
      animationName: 'fox-idle-motion',
      animationDuration: '3s',
    });
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-halo', 'purple-breathe');
    const undockedHalo = await fox.getByTestId('fox-button').evaluate((button) => {
      const halo = getComputedStyle(button, '::before');
      return {
        animationName: halo.animationName,
        width: Number.parseFloat(halo.width),
        backgroundImage: halo.backgroundImage,
      };
    });
    expect(undockedHalo.animationName).toBe('fox-halo-breathe');
    expect(undockedHalo.width).toBeGreaterThanOrEqual(76);
    expect(undockedHalo.width).toBeLessThanOrEqual(84);
    expect(undockedHalo.backgroundImage).toContain('139, 92, 246');
    await fox.screenshot({ path: path.join(screenshotDir, 'fox-undocked.png'), omitBackground: true });
    const motionFrameA = await fox.locator('.fox-head').evaluate((head) => getComputedStyle(head).transform);
    await fox.waitForTimeout(900);
    const motionFrameB = await fox.locator('.fox-head').evaluate((head) => getComputedStyle(head).transform);
    expect(motionFrameB).not.toBe(motionFrameA);
    await fox.screenshot({ path: path.join(screenshotDir, 'fox-idle.png'), omitBackground: true });
    const before = await windowSnapshot(app);
    expect(
      before.some(
        (item) =>
          item.role === 'fox' && item.visible && item.width === FOX_SIZE && item.height === FOX_SIZE,
      ),
    ).toBe(true);
    expect(before.some((item) => item.role === 'query' && item.visible)).toBe(false);
    if (process.platform === 'darwin') {
      expect(before.find((item) => item.role === 'query')?.visibleOnAllWorkspaces).toBe(false);
    }

    await fox.getByTestId('fox-button').click();
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.some(
        (item) => item.role === 'query' && item.visible && item.width === 600 && item.height === 88,
      );
    }).toBe(true);

    await expect(query.getByTestId('env-badges')).toContainText('DEMO');
    await expect(query.getByTestId('env-badges')).toContainText('SYNTHETIC DATA');
    await expect(query.getByTestId('question-input')).toBeFocused();
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');

    const questionInput = query.getByTestId('question-input');
    await questionInput.fill(CLEANSER_QUERY);
    await expect(questionInput).toHaveValue(CLEANSER_QUERY);
    // Enter is the primary Query submission contract and avoids coupling this
    // end-to-end slice to transparent-window pointer actionability. Button
    // submission remains covered deterministically by QueryApp component tests.
    await questionInput.press('Enter');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'true');
    await expect(query.getByTestId('script-card-3')).toBeVisible();
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.find((item) => item.role === 'query')?.height ?? 0;
    }).toBeGreaterThanOrEqual(240);
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.find((item) => item.role === 'query')?.height ?? 999;
    }).toBeLessThanOrEqual(620);
    await expect(query.getByTestId('result-list')).not.toContainText('匹配分');
    await expect(query.getByTestId('match-reason-1')).toHaveText('精确问法');
    await expect(query.getByTestId('answer-text-1')).toHaveText(cleanser.answerText);
    await expect.poll(async () => {
      return query.getByTestId('result-pane').evaluate((pane) => {
        const paneRect = pane.getBoundingClientRect();
        const candidates = Array.from(pane.querySelectorAll<HTMLElement>('.script-card, .copy-btn'));
        const bounds = candidates.map((item) => {
          const rect = item.getBoundingClientRect();
          return { className: item.className, top: rect.top, bottom: rect.bottom };
        });
        return {
          fits:
            pane.scrollHeight <= pane.clientHeight &&
            candidates.length === 6 &&
            bounds.every((rect) => rect.top >= paneRect.top && rect.bottom <= paneRect.bottom),
          clientHeight: pane.clientHeight,
          scrollHeight: pane.scrollHeight,
          paneTop: paneRect.top,
          paneBottom: paneRect.bottom,
          bounds,
        };
      });
    }, { timeout: 5_000 }).toMatchObject({ fits: true });
    await query.screenshot({ path: path.join(screenshotDir, 'overlay-results.png') });

    await query.keyboard.press('Digit2');
    await expect(query.getByTestId('toast')).toHaveText('已复制');
    expect(await readMainClipboard(app)).toBe(cleanserSecond.answerText);
    await expect(query.getByText('已发送')).toHaveCount(0);
    await query.screenshot({ path: path.join(screenshotDir, 'overlay-copied.png') });

    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return {
        queryVisible: snap.some((item) => item.role === 'query' && item.visible),
        foxVisible: snap.some((item) => item.role === 'fox' && item.visible),
      };
    }).toEqual({ queryVisible: false, foxVisible: true });

    const reopenedPhase = await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { expand: () => void; getPhase: () => string } })
        .__demoTest;
      if (!harness) {
        throw new Error('DEMO_E2E harness missing');
      }
      harness.expand();
      return harness.getPhase();
    });
    expect(reopenedPhase).toBe('SEARCH_INPUT');
    await query.evaluate(async (text) => {
      const api = window.customerAgent;
      if (!api) {
        throw new Error('missing customerAgent');
      }
      const result = await api.copyText(text);
      if (!result.ok) {
        throw new Error(result.message);
      }
    }, VERBATIM_TAIL);
    expect(await readMainClipboard(app)).toBe(VERBATIM_TAIL);

    await query.keyboard.press('Escape');
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.some((item) => item.role === 'query' && item.visible);
    }).toBe(false);

    const harnessPhase = await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { expand: () => void; getPhase: () => string } })
        .__demoTest;
      if (!harness) {
        throw new Error('DEMO_E2E harness missing');
      }
      harness.expand();
      return harness.getPhase();
    });
    expect(harnessPhase).toBe('SEARCH_INPUT');
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.some(
        (item) => item.role === 'query' && item.visible && item.width === 600 && item.height === 88,
      );
    }).toBe(true);

    await query.getByTestId('question-input').fill('收起后不应保留的临时问题');
    await app.evaluate(() => {
      const harness = (
        globalThis as {
          __demoTest?: { blurQuery: () => void };
        }
      ).__demoTest;
      if (!harness) {
        throw new Error('DEMO_E2E harness missing');
      }
      harness.blurQuery();
    });
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.some((item) => item.role === 'query' && item.visible);
    }).toBe(false);

    await app.evaluate(() => {
      const harness = (
        globalThis as {
          __demoTest?: { expand: () => void };
        }
      ).__demoTest;
      if (!harness) {
        throw new Error('DEMO_E2E harness missing');
      }
      harness.expand();
    });
    await expect(query.getByTestId('question-input')).toHaveValue('');

    await query.keyboard.press('Escape');
    await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { expand: () => void } }).__demoTest;
      if (!harness) {
        throw new Error('DEMO_E2E harness missing');
      }
      harness.expand();
    });
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'true');
    const shellRevealAnimation = await query.locator('.glass-shell').evaluate((shell) => {
      const animation = shell.getAnimations().find((candidate) => {
        return (candidate as Animation & { animationName?: string }).animationName ===
          'query-shell-unfold';
      });
      const frames = (animation?.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
      const first = frames[0] as (ComputedKeyframe & { clipPath?: string }) | undefined;
      const last = frames[frames.length - 1] as
        | (ComputedKeyframe & { clipPath?: string })
        | undefined;
      return animation
        ? {
            playState: animation.playState,
            startClip: first?.clipPath ?? '',
            endClip: last?.clipPath ?? '',
          }
        : null;
    });
    expect(shellRevealAnimation).not.toBeNull();
    expect(shellRevealAnimation?.playState).toBe('running');
    expect(shellRevealAnimation?.startClip).toContain('inset');
    expect(shellRevealAnimation?.endClip).toContain('inset');
    expect(shellRevealAnimation?.startClip).not.toBe(shellRevealAnimation?.endClip);
    const openingAnimation = await query.locator('.glass-surface').evaluate((surface) => {
      const animation = surface.getAnimations()[0];
      return animation
        ? { playState: animation.playState, currentTime: Number(animation.currentTime ?? 0) }
        : null;
    });
    expect(openingAnimation).not.toBeNull();
    expect(openingAnimation?.playState).toBe('running');
    expect(openingAnimation?.currentTime).toBeLessThan(QUERY_OPEN_DURATION_MS);
  } finally {
    await restoreClipboard(app, savedClipboard);
    await app.close();
  }
});

test('hands the fox and query windows off smoothly through repeated and rapid toggles', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');
    await waitForHarness(app);
    const readVisibility = async () => {
      const snap = await windowSnapshot(app);
      return {
        fox: snap.some((item) => item.role === 'fox' && item.visible),
        query: snap.some((item) => item.role === 'query' && item.visible),
      };
    };

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await fox.getByTestId('fox-button').click();
      await expect.poll(readVisibility).toMatchObject({ query: true });
      await expect(query.getByTestId('question-input')).toBeFocused();
      const readFocusRouting = async () => {
        const snap = await windowSnapshot(app);
        const queryWindow = snap.find((item) => item.role === 'query');
        return {
          native: queryWindow?.focused,
          webContents: queryWindow?.webContentsFocused,
          document: await query.evaluate(() => document.hasFocus()),
        };
      };
      await expect.poll(readFocusRouting).toMatchObject({ document: true });
      const focusRouting = await readFocusRouting();
      // Playwright dispatches a synthetic renderer click and does not guarantee
      // macOS application activation while Codex/another Electron process is
      // frontmost. Still require the two native focus layers to agree; physical
      // OS-key delivery remains an explicit manual-device check.
      expect(focusRouting.native).toBe(focusRouting.webContents);
      const typedWithoutClick = `重开直接输入${cycle + 1}`;
      await query.keyboard.type(typedWithoutClick);
      await expect(query.getByTestId('question-input')).toHaveValue(typedWithoutClick);
      await expect(query.getByTestId('query-shell')).toHaveAttribute(
        'data-open-duration-ms',
        String(QUERY_OPEN_DURATION_MS),
      );
      // The fox inside the expanded capsule is the inverse of the idle click:
      // clicking it closes the query, while dragging it still only moves.
      await query.getByTestId('capsule-fox').click();
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-closing', 'true');

      const transitionSamples: Array<{ fox: boolean; query: boolean }> = [];
      for (let sample = 0; sample < 6; sample += 1) {
        transitionSamples.push(await readVisibility());
        await query.waitForTimeout(Math.max(16, Math.floor(QUERY_CLOSE_DURATION_MS / 6)));
      }
      expect(transitionSamples.every((state) => state.fox || state.query)).toBe(true);
      await expect.poll(readVisibility).toEqual({ fox: true, query: false });
    }

    // A close fallback timer from an older session must never hide a newer one.
    await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { expand: () => void } }).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.expand();
    });
    await expect.poll(readVisibility).toMatchObject({ query: true });
    await app.evaluate(() => {
      const harness = (
        globalThis as { __demoTest?: { dismiss: () => void; expand: () => void } }
      ).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.dismiss();
      setTimeout(() => harness.expand(), 40);
    });
    await query.waitForTimeout(QUERY_CLOSE_DURATION_MS + QUERY_OPEN_DURATION_MS + 120);
    await expect.poll(readVisibility).toEqual({ fox: false, query: true });
    await expect(query.getByTestId('question-input')).toBeFocused();
    expect(
      await app.evaluate(() => {
        const harness = (globalThis as { __demoTest?: { getPhase: () => string } }).__demoTest;
        return harness?.getPhase();
      }),
    ).toBe('SEARCH_INPUT');
  } finally {
    await app.close();
  }
});

test('documents that globalShortcut is exercised via the same main harness, not OS key delivery', async () => {
  const app = await launchApp();
  try {
    await waitForRole(app, 'fox');
    await waitForRole(app, 'query');
    await waitForHarness(app);
    const info = await app.evaluate(() => {
      const harness = (
        globalThis as {
          __demoTest?: {
            expand: () => void;
            dismiss: () => void;
            getPhase: () => string;
            shortcutRegistered: () => boolean;
          };
        }
      ).__demoTest;
      if (!harness) {
        throw new Error('DEMO_E2E harness missing');
      }
      harness.expand();
      const opened = harness.getPhase();
      harness.dismiss();
      const closed = harness.getPhase();
      return {
        opened,
        closed,
        shortcutRegistered: harness.shortcutRegistered(),
      };
    });
    expect(info.opened).toBe('SEARCH_INPUT');
    expect(info.closed).toBe('FOX_IDLE');
    await expect.poll(async () => {
      const windows = await windowSnapshot(app);
      return {
        fox: windows.some((item) => item.role === 'fox' && item.visible),
        query: windows.some((item) => item.role === 'query' && item.visible),
      };
    }).toEqual({ fox: true, query: false });
  } finally {
    await app.close();
  }
});

test('resizes the query window by result count in one session', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');
    await waitForHarness(app);

    await fox.getByTestId('fox-button').click();
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.find((item) => item.role === 'query' && item.visible);
    }).toMatchObject({ width: 600, height: 88, focused: true, webContentsFocused: true });
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    await expect(query.getByTestId('question-input')).toBeFocused();

    const searchAndMeasure = async (text: string, cardCount: number) => {
      const input = query.getByTestId('question-input');
      await input.click();
      await input.fill(text);
      await expect(input).toHaveValue(text);
      await expect(query.getByTestId('validation-error')).toHaveCount(0);
      await input.press('Enter');
      await expect(query.getByTestId(`script-card-${cardCount}`)).toBeVisible({ timeout: 10_000 });
      if (cardCount < 3) {
        await expect(query.getByTestId(`script-card-${cardCount + 1}`)).toHaveCount(0);
      }
      await expect.poll(async () => {
        const snap = await windowSnapshot(app);
        const item = snap.find((entry) => entry.role === 'query');
        return item ? { width: item.width, height: item.height, focused: item.focused } : null;
      }).toMatchObject({ width: 600, focused: true });
      const readHug = () => query.evaluate(() => {
        const pane = document.querySelector<HTMLElement>('[data-testid="result-pane"]');
        const lastCard = document.querySelector<HTMLElement>('.script-card:last-of-type');
        const lastCopy = [...document.querySelectorAll<HTMLElement>('[data-testid^="copy-button-"]')].at(-1);
        if (!pane || !lastCard || !lastCopy) throw new Error('result pane missing');
        const paneRect = pane.getBoundingClientRect();
        const lastRect = lastCard.getBoundingClientRect();
        const shell = document.querySelector<HTMLElement>('[data-testid="query-shell"]');
        const content = document.querySelector<HTMLElement>('.result-content');
        return {
          height: window.innerHeight,
          blank: paneRect.bottom - lastRect.bottom,
          paneTop: paneRect.top,
          paneBottom: paneRect.bottom,
          paneScrollHeight: pane.scrollHeight,
          paneClientHeight: pane.clientHeight,
          panePaddingBottom: getComputedStyle(pane).paddingBottom,
          lastBottom: lastRect.bottom,
          shellTop: shell?.getBoundingClientRect().top ?? null,
          contentBottom: content?.getBoundingClientRect().bottom ?? null,
          contentScrollHeight: content?.scrollHeight ?? null,
          lastReachable: lastCopy.getBoundingClientRect().bottom <= paneRect.bottom + 1
            || pane.scrollHeight > pane.clientHeight,
        };
      });
      let hug = await readHug();
      expect(hug.height).toBeGreaterThanOrEqual(240);
      expect(hug.height).toBeLessThanOrEqual(620);
      if (hug.height > 240 && hug.height < 620) {
        // Result cards enter with a short translate animation. Assert the
        // settled layout rather than sampling an arbitrary compositor frame.
        await expect.poll(async () => (await readHug()).blank).toBeLessThanOrEqual(12.5);
        hug = await readHug();
      }
      expect(hug.lastReachable).toBe(true);
      return hug;
    };

    await searchAndMeasure('面膜过敏怎么办', 1);
    await query.screenshot({ path: path.join(screenshotDir, 'query-top1.png') });
    await searchAndMeasure('澄芽洁面和雾屿精华能一起用吗', 2);
    await query.screenshot({ path: path.join(screenshotDir, 'query-top2.png') });
    await searchAndMeasure(CLEANSER_QUERY, 3);
    await query.screenshot({ path: path.join(screenshotDir, 'query-top3.png') });

    const compactScroll = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=query'),
      );
      if (!win) throw new Error('query window missing');
      const bounds = win.getBounds();
      win.setBounds({ ...bounds, height: 300 });
      return win.getBounds().height;
    });
    expect(compactScroll).toBe(300);
    const lastCopy = query.getByTestId('copy-button-3');
    await lastCopy.scrollIntoViewIfNeeded();
    await expect(lastCopy).toBeVisible();
    const lastCopyVisible = await lastCopy.evaluate((node) => {
      const pane = document.querySelector('[data-testid="result-pane"]');
      if (!pane) throw new Error('result pane missing');
      const paneRect = pane.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return rect.bottom <= paneRect.bottom + 1 && rect.top >= paneRect.top - 1;
    });
    expect(lastCopyVisible).toBe(true);

    await query.keyboard.press('Escape');
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.some((item) => item.role === 'query' && item.visible);
    }).toBe(false);

    await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { expand: () => void } }).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.expand();
    });
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.find((item) => item.role === 'query' && item.visible)?.height;
    }).toBe(88);
    await expect(query.getByTestId('question-input')).toBeFocused();
    await query.keyboard.type('可直接键入');
    await expect(query.getByTestId('question-input')).toHaveValue('可直接键入');
  } finally {
    await app.close();
  }
});

type FoxSetBoundsTraceCall = {
  bounds: { x: number; y: number; width: number; height: number };
  animate: boolean;
};

async function readFoxNativeBounds(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((item) =>
      item.webContents.getURL().includes('role=fox'),
    );
    if (!win) return null;
    const bounds = win.getBounds();
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      visible: win.isVisible(),
    };
  });
}

async function beginFoxSetBoundsTrace(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const harness = (globalThis as {
      __demoTest?: { beginFoxSetBoundsTrace: () => void };
    }).__demoTest;
    if (!harness) throw new Error('DEMO_E2E harness missing');
    harness.beginFoxSetBoundsTrace();
  });
}

async function endFoxSetBoundsTrace(
  app: ElectronApplication,
): Promise<FoxSetBoundsTraceCall[]> {
  return app.evaluate(() => {
    const harness = (globalThis as {
      __demoTest?: { endFoxSetBoundsTrace: () => FoxSetBoundsTraceCall[] };
    }).__demoTest;
    if (!harness) throw new Error('DEMO_E2E harness missing');
    return harness.endFoxSetBoundsTrace();
  });
}

test('@float adopts a WindowServer stage boundary without hover/retract native drift', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');
    await waitForHarness(app);
    await app.evaluate(() => {
      const harness = (
        globalThis as { __demoTest?: { dockFox: (edge: 'left' | 'right') => void } }
      ).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.dockFox('left');
    });
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', 'left');
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-snapping', 'false');
    await fox.getByTestId('fox-button').dispatchEvent('pointerout');

    await beginFoxSetBoundsTrace(app);
    const stageSeat = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=fox'),
      );
      if (!win) throw new Error('fox window missing');
      const before = win.getBounds();
      const requested = { ...before, x: before.x + 96 };
      win.setBounds(requested);
      return { requested, accepted: win.getBounds() };
    });
    const stageSeated = stageSeat.accepted;
    expect(await endFoxSetBoundsTrace(app)).toEqual([
      { bounds: stageSeat.requested, animate: false },
    ]);
    await expect.poll(async () => (await readFoxNativeBounds(app))?.x).toBe(stageSeated.x);
    await fox.waitForTimeout(80);

    await fox.evaluate(async () => {
      await window.customerAgent?.moveFoxBy(0, 12, false);
      const settled = await window.customerAgent?.moveFoxBy(0, 0, true);
      if (settled) {
        await window.customerAgent?.commitFoxDragSettle(settled.settleId);
      }
    });
    const stageDragged = { ...stageSeated, y: stageSeated.y + 12, visible: true };
    await expect.poll(async () => readFoxNativeBounds(app)).toEqual(stageDragged);
    await fox.waitForTimeout(320);
    expect(await readFoxNativeBounds(app)).toEqual(stageDragged);

    await beginFoxSetBoundsTrace(app);
    await fox.getByTestId('fox-button').evaluate((button) => (button as HTMLElement).click());
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.some((item) => item.role === 'query' && item.visible);
    }).toBe(true);
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    expect(await endFoxSetBoundsTrace(app)).toEqual([]);
    const stageQuery = (await windowSnapshot(app)).find((item) => item.role === 'query');
    expect(stageQuery?.x).toBe(stageDragged.x);

    await beginFoxSetBoundsTrace(app);
    await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { dismiss: () => void } }).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.dismiss();
    });
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return {
        foxVisible: snap.some((item) => item.role === 'fox' && item.visible),
        queryVisible: snap.some((item) => item.role === 'query' && item.visible),
      };
    }).toEqual({ foxVisible: true, queryVisible: false });
    await query.waitForTimeout(320);
    const acceptedAfterClose = await readFoxNativeBounds(app);
    if (!acceptedAfterClose) {
      throw new Error('fox window missing after Query close');
    }
    expect(acceptedAfterClose).toMatchObject({
      y: stageDragged.y,
      width: FOX_SIZE,
      height: FOX_SIZE,
      visible: true,
    });

    // Stage Manager can apply a second, asynchronous seat when showInactive()
    // remaps the hidden Fox. That accepted frame is the contract: it may differ
    // from the synthetic pre-open x, but it must remain stable and become the
    // anchor for the next handoff instead of triggering a setBounds tug-of-war.
    await query.waitForTimeout(320);
    expect(await readFoxNativeBounds(app)).toEqual(acceptedAfterClose);
    expect(await endFoxSetBoundsTrace(app)).toEqual([]);

    await beginFoxSetBoundsTrace(app);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await fox.getByTestId('fox-button').dispatchEvent('pointerover');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-peeking', 'true');
      await fox.waitForTimeout(40);
      expect(await readFoxNativeBounds(app)).toEqual(acceptedAfterClose);

      await fox.getByTestId('fox-button').dispatchEvent('pointerout');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-peeking', 'false');
      await fox.waitForTimeout(FOX_RETRACT_DURATION_MS + 40);
      expect(await readFoxNativeBounds(app)).toEqual(acceptedAfterClose);
    }
    expect(await endFoxSetBoundsTrace(app)).toEqual([]);

    await beginFoxSetBoundsTrace(app);
    await fox.getByTestId('fox-button').evaluate((button) => (button as HTMLElement).click());
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.some((item) => item.role === 'query' && item.visible);
    }).toBe(true);
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'false');
    expect(await endFoxSetBoundsTrace(app)).toEqual([]);
    const reopenedQuery = (await windowSnapshot(app)).find(
      (item) => item.role === 'query' && item.visible,
    );
    expect(reopenedQuery?.x).toBe(acceptedAfterClose.x);
  } finally {
    await app.close();
  }
});

test('@float keeps native fox bounds still during local follow, sleep, and press, then opens continuously', async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');
    await waitForHarness(app);
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'idle');
    const beforeFollow = await readFoxNativeBounds(app);
    expect(beforeFollow?.width).toBe(FOX_SIZE);
    expect(beforeFollow?.height).toBe(FOX_SIZE);

    await parkFoxPointerOutside(app, fox);
    await followFoxLocally(fox);
    await expect.poll(async () => fox.getByTestId('fox-idle').getAttribute('data-fox-follow')).toBe('true');
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'following-local');
    const followVars = await fox.getByTestId('fox-idle').evaluate((node) => ({
      x: Number.parseFloat(getComputedStyle(node).getPropertyValue('--fox-follow-x')),
      rot: Number.parseFloat(getComputedStyle(node).getPropertyValue('--fox-follow-rot')),
    }));
    expect(Math.abs(followVars.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(followVars.rot)).toBeLessThanOrEqual(2);
    expect(await readFoxNativeBounds(app)).toEqual(beforeFollow);

    await parkFoxPointerOutside(app, fox);
    await expect.poll(async () => fox.getByTestId('fox-idle').getAttribute('data-fox-follow')).toBe('false');
    // The local-follow path above is synthetic and deterministic. Isolate the
    // passive 8s/14s clock from an operator's physical cursor crossing this
    // always-on-top 88px window while the suite runs on a real desktop. Set
    // the native hit-test fence before the final cursor park so the OS warp
    // cannot enqueue a late pointermove that restarts the sleep deadline.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=fox'),
      );
      if (!win) throw new Error('fox window missing');
      win.setIgnoreMouseEvents(true);
    });
    await fox.getByTestId('fox-idle').evaluate((idle) => {
      idle.style.pointerEvents = 'none';
    });
    await parkFoxPointerOutside(app, fox);
    const drowsyAfter = Number(await fox.getByTestId('fox-idle').getAttribute('data-drowsy-after-ms'));
    const sleepAfter = Number(await fox.getByTestId('fox-idle').getAttribute('data-sleep-after-ms'));
    const waitForAmbient = async (expected: 'drowsy' | 'sleeping', timeoutMs: number) => {
      await expect.poll(
        () => fox.getByTestId('fox-idle').getAttribute('data-fox-ambient'),
        { timeout: timeoutMs },
      ).toBe(expected);
    };
    await waitForAmbient('drowsy', drowsyAfter + 2000);
    expect(await readFoxNativeBounds(app)).toEqual(beforeFollow);
    await waitForAmbient('sleeping', sleepAfter - drowsyAfter + 2000);
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'sleeping');
    expect(await readFoxNativeBounds(app)).toEqual(beforeFollow);

    // Re-enable the fox window before invoking the real click path. Keeping
    // ignoreMouseEvents enabled while calling HTMLElement.click() can leave
    // the Query window visible but unfocused on a busy desktop compositor.
    await fox.getByTestId('fox-idle').evaluate((idle) => {
      idle.style.removeProperty('pointer-events');
    });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=fox'),
      );
      if (!win) throw new Error('fox window missing');
      win.setIgnoreMouseEvents(false);
    });

    // Sample and activate in the same renderer task. The sleeping pose keeps
    // animating, so two separate CDP evaluations can legitimately observe
    // different compositor frames even when the handoff itself is continuous.
    const frozenBeforeOpen = await fox.getByTestId('fox-button').evaluate((button) => {
      const head = button.querySelector<HTMLElement>('.fox-head');
      if (!head) throw new Error('fox head missing');
      const matrix = new DOMMatrixReadOnly(getComputedStyle(head).transform);
      (button as HTMLButtonElement).click();
      return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f };
    });
    await waitForInteractiveQuery(app, query);
    await query.screenshot({
      path: path.join(screenshotDir, 'fox-query-canonical.png'),
      omitBackground: true,
    });
    const handoff = await query.getByTestId('query-shell').evaluate((shell) => {
      const style = getComputedStyle(shell);
      return {
        a: Number(style.getPropertyValue('--query-handoff-fox-a')),
        b: Number(style.getPropertyValue('--query-handoff-fox-b')),
        c: Number(style.getPropertyValue('--query-handoff-fox-c')),
        d: Number(style.getPropertyValue('--query-handoff-fox-d')),
        e: Number(style.getPropertyValue('--query-handoff-fox-e')),
        f: Number(style.getPropertyValue('--query-handoff-fox-f')),
      };
    });
    expect(handoff.a).toBeCloseTo(frozenBeforeOpen.a, 2);
    expect(handoff.b).toBeCloseTo(frozenBeforeOpen.b, 2);
    expect(handoff.c).toBeCloseTo(frozenBeforeOpen.c, 2);
    expect(handoff.d).toBeCloseTo(frozenBeforeOpen.d, 2);
    expect(handoff.e).toBeCloseTo(frozenBeforeOpen.e, 1);
    expect(handoff.f).toBeCloseTo(frozenBeforeOpen.f, 1);

    await query.getByTestId('question-input').press('Escape');
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return {
        fox: snap.some((item) => item.role === 'fox' && item.visible),
        query: snap.some((item) => item.role === 'query' && item.visible),
      };
    }).toEqual({ fox: true, query: false });
    await expect(fox.getByTestId('fox-button')).toBeVisible();

    const pressBefore = await readFoxNativeBounds(app);
    await fox.getByTestId('fox-button').hover();
    await fox.mouse.down();
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'pressed');
    expect(await readFoxNativeBounds(app)).toEqual(pressBefore);
    await fox.mouse.up();
    await waitForInteractiveQuery(app, query);
    await query.getByTestId('question-input').press('Escape');
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return {
        fox: snap.some((item) => item.role === 'fox' && item.visible),
        query: snap.some((item) => item.role === 'query' && item.visible),
      };
    }).toEqual({ fox: true, query: false });
    await expect(fox.getByTestId('fox-button')).toBeVisible();

    await app.evaluate(() => {
      const harness = (
        globalThis as { __demoTest?: { dockFox: (edge: 'left' | 'right') => void } }
      ).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.dockFox('left');
    });
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', 'left');
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-snapping', 'false');

    const beforeDrag = await readFoxNativeBounds(app);
    const dragPhases = await fox.getByTestId('fox-button').evaluate(async (button) => {
      const idle = () => document.querySelector('[data-testid="fox-idle"]');
      const fire = (type: string, init: { buttons: number; screenX: number; screenY: number }) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'pointerId', { configurable: true, value: 41 });
        Object.defineProperty(event, 'button', { configurable: true, value: 0 });
        Object.defineProperty(event, 'buttons', { configurable: true, value: init.buttons });
        Object.defineProperty(event, 'ctrlKey', { configurable: true, value: false });
        Object.defineProperty(event, 'screenX', { configurable: true, value: init.screenX });
        Object.defineProperty(event, 'screenY', { configurable: true, value: init.screenY });
        button.dispatchEvent(event);
      };
      const api = window.customerAgent;
      if (!api) throw new Error('customerAgent preload missing');
      let edgeEchoCount = 0;
      let unsubscribe = (): void => undefined;
      const undockEcho = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          unsubscribe();
          reject(new Error('fox-edge undock echo timed out'));
        }, 2000);
        unsubscribe = api.onOverlayCommand((command) => {
          if (command.type !== 'fox-edge' || command.edge !== 'none') return;
          edgeEchoCount += 1;
          if (edgeEchoCount === 1) {
            window.clearTimeout(timeout);
            window.requestAnimationFrame(() => resolve());
          }
        });
      });
      fire('pointerdown', { buttons: 1, screenX: 120, screenY: 160 });
      const afterDown = idle()?.getAttribute('data-fox-transient');
      fire('pointermove', { buttons: 1, screenX: 168, screenY: 156 });
      const afterMove = idle()?.getAttribute('data-fox-transient');
      const duringWidth = window.innerWidth;
      await undockEcho;
      const afterUndockEcho = idle()?.getAttribute('data-fox-transient');
      fire('pointermove', { buttons: 1, screenX: 360, screenY: 156 });
      const afterLong = idle()?.getAttribute('data-fox-transient');
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      const afterLongSettled = idle()?.getAttribute('data-fox-transient');
      unsubscribe();
      fire('pointerup', { buttons: 0, screenX: 360, screenY: 156 });
      return {
        afterDown,
        afterMove,
        afterUndockEcho,
        afterLong,
        afterLongSettled,
        afterUp: idle()?.getAttribute('data-fox-transient'),
        duringWidth,
        edgeEchoCount,
      };
    });
    expect(dragPhases.afterDown).toBe('pressed');
    expect(dragPhases.afterMove).toBe('dragging');
    expect(dragPhases.afterUndockEcho).toBe('dragging');
    expect(dragPhases.afterLong).toBe('annoyed-drag');
    expect(dragPhases.afterLongSettled).toBe('annoyed-drag');
    expect(dragPhases.afterUp).toBe('none');
    expect(dragPhases.edgeEchoCount).toBe(1);
    expect((await readFoxNativeBounds(app))?.width).toBe(FOX_SIZE);
    expect(beforeDrag?.width).toBe(FOX_SIZE);
    await fox.getByTestId('fox-button').dispatchEvent('pointerleave');
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');

    for (const edge of ['left', 'right'] as const) {
      await app.evaluate((_electron, targetEdge) => {
        const harness = (
          globalThis as { __demoTest?: { dockFox: (edge: 'left' | 'right') => void } }
        ).__demoTest;
        if (!harness) throw new Error('DEMO_E2E harness missing');
        harness.dockFox(targetEdge);
      }, edge);
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', edge);
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-snapping', 'false');
      await parkFoxPointerOutside(app, fox);
      const docked = await readFoxNativeBounds(app);
      expect(docked?.width).toBe(FOX_SIZE);
      expect(docked?.height).toBe(FOX_SIZE);
      await fox.getByTestId('fox-button').dispatchEvent('pointerout');
      await fox.getByTestId('fox-button').dispatchEvent('pointerover');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-peeking', 'true');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'peek');
      await fox.getByTestId('fox-button').dispatchEvent('pointerout');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-peeking', 'false');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-retracting', 'true');
    }

    const menuBefore = await windowSnapshot(app);
    await fox.getByTestId('fox-button').dispatchEvent('contextmenu');
    const menuAfter = await windowSnapshot(app);
    expect(menuAfter.filter((item) => item.visible).map((item) => item.role)).toEqual(
      menuBefore.filter((item) => item.visible).map((item) => item.role),
    );
    await expect(query.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    await expect(fox.getByTestId('fox-button')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('@float honors reduced motion without adding a rectangular fox background', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    await fox.emulateMedia({ reducedMotion: 'reduce' });
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'static');
    const style = await fox.getByTestId('fox-button').evaluate((button) => {
      const head = button.querySelector<HTMLElement>('.fox-head');
      if (!head) {
        throw new Error('fox head missing');
      }
      const computed = getComputedStyle(head);
      return {
        background: computed.backgroundColor,
        animationName: computed.animationName,
        boxShadow: computed.boxShadow,
        filter: computed.filter,
      };
    });
    expect(style.background).toBe('rgba(0, 0, 0, 0)');
    expect(style.animationName).toBe('none');
    expect(style.boxShadow).toBe('none');
    expect(style.filter).toContain('drop-shadow');
    const halo = await fox.getByTestId('fox-button').evaluate((button) => {
      const before = getComputedStyle(button, '::before');
      return { animationName: before.animationName, opacity: before.opacity };
    });
    expect(halo.animationName).toBe('none');
    expect(Number(halo.opacity)).toBeGreaterThanOrEqual(0.5);

    await app.evaluate(() => {
      const harness = (
        globalThis as {
          __demoTest?: { dockFox: (edge: 'left' | 'right') => void };
        }
      ).__demoTest;
      if (!harness) {
        throw new Error('DEMO_E2E harness missing');
      }
      harness.dockFox('left');
    });
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', 'left');
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-snapping', 'false');
    const snapStyle = await fox.locator('.fox-head').evaluate((head) => getComputedStyle(head).animationName);
    expect(['', 'none']).toContain(snapStyle);
  } finally {
    await app.close();
  }
});

test('@float keeps a visible idle halo and programmatic Dock identity evidence', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    // Declare this test's media contract explicitly. The preceding test opts
    // into reduced motion, and a halo animation assertion must not inherit
    // either that CDP override or the host's accessibility preference.
    await fox.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => fox.evaluate(() => (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ))).toBe(false);
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'awake');
    await expect.poll(() => fox.getByTestId('fox-button').evaluate((button) => (
      getComputedStyle(button, '::before').animationName
    ))).toContain('fox-halo-breathe');
    const halo = await fox.getByTestId('fox-idle').evaluate((root) => {
      const style = getComputedStyle(root);
      const button = root.querySelector('.fox-button');
      if (!button) throw new Error('fox button missing');
      const before = getComputedStyle(button, '::before');
      return {
        size: style.getPropertyValue('--fox-halo-size').trim(),
        min: Number(style.getPropertyValue('--fox-halo-opacity-min')),
        max: Number(style.getPropertyValue('--fox-halo-opacity-max')),
        duration: style.getPropertyValue('--fox-halo-duration').trim(),
        animation: before.animationName,
      };
    });
    expect(Number.parseFloat(halo.size)).toBeGreaterThanOrEqual(76);
    expect(Number.parseFloat(halo.size)).toBeLessThanOrEqual(84);
    expect(halo.min).toBeGreaterThanOrEqual(0.52);
    expect(halo.max).toBeLessThanOrEqual(0.95);
    expect(halo.animation).toContain('fox-halo-breathe');

    const identity = await app.evaluate(() => {
      const shell = (globalThis as {
        __demoDesktopShellTest?: {
          dockVisible: () => boolean | null;
          dockIconEmpty: () => boolean | null;
          identity: () => { activationPolicy: string; platform: string };
        };
      }).__demoDesktopShellTest;
      return {
        dockVisible: shell?.dockVisible() ?? null,
        dockIconEmpty: shell?.dockIconEmpty() ?? null,
        identity: shell?.identity() ?? null,
      };
    });
    if (process.platform === 'darwin') {
      expect(identity.dockVisible).toBe(true);
      expect(identity.dockIconEmpty).toBe(false);
    }
    // Real Cmd+Tab / Dock artwork still needs a manual macOS visual check.
  } finally {
    await app.close();
  }
});

test('@float keeps dock session, release, focus ring, and visor visibility contracts', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    await waitForHarness(app);
    const dockFox = async (targetEdge: 'left' | 'right') => {
      await app.evaluate((_electron, edge) => {
        const harness = (
          globalThis as { __demoTest?: { dockFox: (edge: 'left' | 'right') => void } }
        ).__demoTest;
        if (!harness) throw new Error('DEMO_E2E harness missing');
        harness.dockFox(edge);
      }, targetEdge);
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', targetEdge);
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-snapping', 'false');
    };
    const readNativeFoxFrame = () => app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=fox'),
      );
      if (!win) return null;
      const bounds = win.getBounds();
      const workArea = screen.getDisplayMatching(bounds).workArea;
      return {
        x: bounds.x,
        width: bounds.width,
        expectedX: workArea.x,
        expectedRightX: workArea.x + workArea.width - bounds.width,
        workRight: workArea.x + workArea.width,
      };
    });

    for (const edge of ['left', 'right'] as const) {
      await dockFox(edge);
      const before = await readNativeFoxFrame();
      expect(before).not.toBeNull();
      const inward = edge === 'left' ? FOX_SIZE - FOX_EDGE_VISIBLE_PX + 24 : -(FOX_SIZE - FOX_EDGE_VISIBLE_PX + 24);
      await fox.evaluate(async (delta) => {
        await window.customerAgent?.moveFoxBy(delta, 0, false);
      }, inward);
      const advanced = await readNativeFoxFrame();
      expect(advanced?.width).toBe(FOX_SIZE);
      expect(advanced && advanced.x >= advanced.expectedX && advanced.x <= advanced.expectedRightX).toBe(true);
      if (edge === 'left') {
        expect(advanced?.x).toBe((before?.x ?? 0) + 24);
      } else {
        expect(advanced?.x).toBe((before?.x ?? 0) - 24);
      }
      await fox.evaluate(async () => {
        await window.customerAgent?.moveFoxBy(0, 0, true);
      });
      const finished = await readNativeFoxFrame();
      expect(finished?.x).toBe(advanced?.x);
      expect(finished && finished.x >= finished.expectedX && finished.x <= finished.expectedRightX).toBe(true);
    }

    await dockFox('right');
    const rightSeated = await readNativeFoxFrame();
    expect(rightSeated?.x).toBe(rightSeated?.expectedRightX);
    expect((rightSeated?.x ?? 0) + FOX_SIZE).toBe(rightSeated?.workRight);

    await dockFox('left');
    const flash = await fox.getByTestId('fox-button').evaluate(async (button) => {
      const idle = () => document.querySelector<HTMLElement>('[data-testid="fox-idle"]');
      const fire = (type: string, init: { buttons: number; screenX: number }) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'pointerId', { configurable: true, value: 81 });
        Object.defineProperty(event, 'button', { configurable: true, value: 0 });
        Object.defineProperty(event, 'buttons', { configurable: true, value: init.buttons });
        Object.defineProperty(event, 'ctrlKey', { configurable: true, value: false });
        Object.defineProperty(event, 'screenX', { configurable: true, value: init.screenX });
        Object.defineProperty(event, 'screenY', { configurable: true, value: 160 });
        button.dispatchEvent(event);
      };
      fire('pointerdown', { buttons: 1, screenX: 24 });
      fire('pointermove', { buttons: 1, screenX: 40 });
      fire('pointerup', { buttons: 0, screenX: 40 });
      const frames: Array<{ sessionX: string; edge: string | null; settling: string | null }> = [];
      for (let i = 0; i < 8; i += 1) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        const root = idle();
        frames.push({
          sessionX: root?.style.getPropertyValue('--fox-session-x') ?? '',
          edge: root?.getAttribute('data-dock-edge') ?? null,
          settling: root?.getAttribute('data-fox-settling') ?? null,
        });
      }
      return frames;
    });
    expect(flash.some((frame) => frame.edge === 'none' && (frame.sessionX === '' || frame.sessionX === '0.00px'))).toBe(false);

    await dockFox('left');
    await fox.screenshot({
      path: path.join(screenshotDir, 'fox-float-light.png'),
      omitBackground: true,
    });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=fox'),
      );
      win?.show();
      win?.focus();
      win?.webContents.focus();
    });
    await fox.bringToFront();
    await fox.keyboard.press('Tab');
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-keyboard-focus', 'true');
    const focused = await fox.getByTestId('fox-button').evaluate((button) => {
      const ring = button.querySelector<HTMLElement>('[data-testid="fox-focus-ring"]');
      const idle = button.closest('[data-testid="fox-idle"]');
      const head = button.querySelector<HTMLElement>('.fox-head');
      const ringStyle = ring ? getComputedStyle(ring) : null;
      const before = ring ? getComputedStyle(ring, '::before') : null;
      const snapshot = {
        keyboard: idle?.getAttribute('data-fox-keyboard-focus'),
        idleOpacity: ringStyle?.opacity ?? '0',
        boxShadow: ringStyle?.boxShadow ?? '',
        borderRadius: ringStyle?.borderRadius ?? '',
        beforeColor: before?.borderColor ?? '',
        outlineStyle: getComputedStyle(button).outlineStyle,
        outlineWidth: getComputedStyle(button).outlineWidth,
      };
      const fire = (type: string, init: { buttons: number; screenX: number }) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'pointerId', { configurable: true, value: 82 });
        Object.defineProperty(event, 'button', { configurable: true, value: 0 });
        Object.defineProperty(event, 'buttons', { configurable: true, value: init.buttons });
        Object.defineProperty(event, 'ctrlKey', { configurable: true, value: false });
        Object.defineProperty(event, 'screenX', { configurable: true, value: init.screenX });
        Object.defineProperty(event, 'screenY', { configurable: true, value: 160 });
        button.dispatchEvent(event);
      };
      fire('pointerdown', { buttons: 1, screenX: 24 });
      const afterPointer = {
        keyboard: idle?.getAttribute('data-fox-keyboard-focus'),
        opacity: ring ? getComputedStyle(ring).opacity : '1',
      };
      fire('pointermove', { buttons: 1, screenX: 52 });
      const dragOpacity = ring ? getComputedStyle(ring).opacity : '1';
      const headFound = head !== null;
      const dragAnimationCount = head?.getAnimations().length ?? -1;
      const pose = idle?.getAttribute('data-fox-pose');
      const session = idle?.getAttribute('data-fox-drag-session');
      fire('pointerup', { buttons: 0, screenX: 52 });
      button.blur();
      return { snapshot, afterPointer, dragOpacity, headFound, dragAnimationCount, pose, session };
    });
    expect(focused.snapshot.keyboard).toBe('true');
    expect(Number(focused.snapshot.idleOpacity)).toBe(1);
    expect(focused.snapshot.boxShadow === 'none' || focused.snapshot.boxShadow === '').toBe(true);
    expect(focused.snapshot.borderRadius === '0px' || focused.snapshot.borderRadius === '0').toBe(true);
    expect(focused.snapshot.beforeColor.toLowerCase()).not.toContain('91, 140, 255');
    expect(focused.snapshot.beforeColor.toLowerCase()).not.toContain('#5b8cff');
    expect(
      focused.snapshot.outlineStyle === 'none'
      || focused.snapshot.outlineWidth === '0px'
      || focused.snapshot.outlineWidth === '0',
    ).toBe(true);
    expect(focused.afterPointer.keyboard).toBe('false');
    expect(Number(focused.afterPointer.opacity)).toBe(0);
    expect(Number(focused.dragOpacity)).toBe(0);
    expect(focused.pose).toBe('dragging');
    expect(focused.headFound).toBe(true);
    expect(focused.dragAnimationCount).toBe(0);
    expect(focused.session).toBe('left');

    await fox.keyboard.press('Tab');
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-keyboard-focus', 'true');
    await fox.screenshot({
      path: path.join(screenshotDir, 'fox-keyboard-focus.png'),
      omitBackground: true,
    });
    await fox.getByTestId('fox-button').evaluate((button) => button.blur());

    await fox.emulateMedia({ colorScheme: 'dark' });
    await fox.screenshot({
      path: path.join(screenshotDir, 'fox-float-dark.png'),
      omitBackground: true,
    });
    await fox.emulateMedia({ colorScheme: 'light' });

    const visor = await fox.getByTestId('fox-idle').evaluate((root) => {
      root.querySelectorAll<HTMLElement>('*').forEach((node) => {
        node.style.transition = 'none';
      });
      (root as HTMLElement).style.transition = 'none';
      root.setAttribute('data-fox-pose', 'sleeping');
      void (root as HTMLElement).offsetHeight;
      const slit = root.querySelector('[data-testid="fox-eye-slit-left"]');
      const glint = root.querySelector('[data-testid="fox-eye-glint-left"]');
      const visorLayer = root.querySelector('[data-testid="fox-visor-layer"]');
      const shadow = root.querySelector<HTMLElement>('[data-testid="fox-ground-shadow"]');
      const sleep = root.querySelector<HTMLElement>('[data-testid="fox-sleep-mark"]');
      const head = root.querySelector<HTMLElement>('.fox-head');
      const image = root.querySelector<HTMLImageElement>('.fox-head-image');
      return {
        slitFound: slit !== null,
        glintFound: glint !== null,
        visorFound: visorLayer !== null,
        shadowOpacity: shadow ? Number(getComputedStyle(shadow).opacity) : 0,
        sleepOpacity: sleep ? Number(getComputedStyle(sleep).opacity) : 0,
        sleepMarkDisplay: sleep ? getComputedStyle(sleep).display : 'none',
        headFilter: head ? getComputedStyle(head).filter : '',
        imageSrc: image?.currentSrc ?? image?.src ?? '',
      };
    });
    await fox.screenshot({
      path: path.join(screenshotDir, 'fox-sleep-visor.png'),
      omitBackground: true,
    });
    expect(visor.slitFound).toBe(false);
    expect(visor.glintFound).toBe(false);
    expect(visor.visorFound).toBe(false);
    expect(visor.imageSrc).toContain('fox-head');
    expect(visor.shadowOpacity).toBeGreaterThan(0.2);
    expect(visor.sleepOpacity).toBeGreaterThan(0.5);
    expect(visor.headFilter).toContain('drop-shadow');

    await fox.emulateMedia({ forcedColors: 'active' });
    await fox.keyboard.press('Tab');
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-keyboard-focus', 'true');
    const forced = await fox.getByTestId('fox-button').evaluate((button) => {
      const ring = button.querySelector<HTMLElement>('[data-testid="fox-focus-ring"]');
      const style = ring ? getComputedStyle(ring) : null;
      const keyboard = button.closest('[data-testid="fox-idle"]')?.getAttribute('data-fox-keyboard-focus');
      button.blur();
      return {
        keyboard,
        opacity: style?.opacity ?? '0',
        borderColor: style?.borderColor ?? '',
      };
    });
    expect(forced.keyboard).toBe('true');
    expect(Number(forced.opacity)).toBe(1);
    expect(forced.borderColor.toLowerCase()).not.toContain('91, 140, 255');
    await fox.emulateMedia({ forcedColors: 'none' });

    await fox.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(async () => fox.getByTestId('fox-idle').getAttribute('data-fox-pose')).toBe('static');
    await dockFox('left');
    await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'static');
    const reduced = await fox.getByTestId('fox-button').evaluate(async (button) => {
      const idle = () => document.querySelector<HTMLElement>('[data-testid="fox-idle"]');
      const fire = (type: string, init: { buttons: number; screenX: number }) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'pointerId', { configurable: true, value: 83 });
        Object.defineProperty(event, 'button', { configurable: true, value: 0 });
        Object.defineProperty(event, 'buttons', { configurable: true, value: init.buttons });
        Object.defineProperty(event, 'ctrlKey', { configurable: true, value: false });
        Object.defineProperty(event, 'screenX', { configurable: true, value: init.screenX });
        Object.defineProperty(event, 'screenY', { configurable: true, value: 160 });
        button.dispatchEvent(event);
      };
      fire('pointerdown', { buttons: 1, screenX: 24 });
      fire('pointermove', { buttons: 1, screenX: 56 });
      const afterMove = {
        transient: idle()?.getAttribute('data-fox-transient'),
        session: idle()?.getAttribute('data-fox-drag-session'),
        sessionX: idle()?.style.getPropertyValue('--fox-session-x') ?? '',
        edge: idle()?.getAttribute('data-dock-edge'),
      };
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      const afterEcho = {
        transient: idle()?.getAttribute('data-fox-transient'),
        session: idle()?.getAttribute('data-fox-drag-session'),
        sessionX: idle()?.style.getPropertyValue('--fox-session-x') ?? '',
      };
      fire('pointerup', { buttons: 0, screenX: 56 });
      return { afterMove, afterEcho };
    });
    expect(reduced.afterMove.transient).toBe('dragging');
    expect(reduced.afterMove.session).toBe('left');
    expect(Number.parseFloat(reduced.afterMove.sessionX)).toBeLessThan(0);
    expect(reduced.afterEcho.transient).toBe('dragging');
    expect(reduced.afterEcho.session).toBe('left');
    expect(reduced.afterEcho.sessionX).toBe(reduced.afterMove.sessionX);
  } finally {
    await app.close();
  }
});

test('closeFocusedSurface closes Dashboard, collapses Query, and is a no-op on idle Fox', async () => {
  const app = await launchApp();
  try {
    await waitForHarness(app);
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');

    await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { openDashboard: () => Promise<void> } }).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      return harness.openDashboard();
    });
    const dashboard = await waitForRole(app, 'dashboard');
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.some((item) => item.role === 'dashboard' && item.visible);
    }).toBe(true);
    await dashboard.bringToFront();
    await waitForNativeFocus(app, 'dashboard');
    const queryContentsId = await app.evaluate(({ BrowserWindow }) => {
      const queryWin = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=query'),
      );
      return queryWin?.webContents.id ?? null;
    });
    await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { closeFocusedSurface: () => void } }).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.closeFocusedSurface();
    });
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return {
        dashboard: snap.some((item) => item.role === 'dashboard' && item.visible),
        fox: snap.some((item) => item.role === 'fox' && item.visible),
      };
    }).toEqual({ dashboard: false, fox: true });

    await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { openDashboard: () => Promise<void> } }).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      return harness.openDashboard();
    });
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.some((item) => item.role === 'dashboard' && item.visible);
    }).toBe(true);
    await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { closeDashboard: () => void } }).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.closeDashboard();
    });

    await fox.getByTestId('fox-button').click();
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.some((item) => item.role === 'query' && item.visible);
    }).toBe(true);
    await query.bringToFront();
    await waitForNativeFocus(app, 'query');
    await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { closeFocusedSurface: () => void } }).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.closeFocusedSurface();
    });
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return {
        query: snap.some((item) => item.role === 'query' && item.visible),
        fox: snap.some((item) => item.role === 'fox' && item.visible),
      };
    }).toEqual({ query: false, fox: true });
    const queryAfter = await app.evaluate(({ BrowserWindow }, previousId) => {
      const queryWin = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('role=query'),
      );
      return {
        exists: Boolean(queryWin),
        destroyed: queryWin?.webContents.isDestroyed() ?? true,
        id: queryWin?.webContents.id ?? null,
        previousId,
      };
    }, queryContentsId);
    expect(queryAfter.exists).toBe(true);
    expect(queryAfter.destroyed).toBe(false);
    expect(queryAfter.id).toBe(queryContentsId);

    // Idle Fox is deliberately restored with showInactive(), so native focus is
    // neither required nor stable here. Exercise the idle state as shipped.
    await app.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { closeFocusedSurface: () => void } }).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.closeFocusedSurface();
    });
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return {
        dashboard: snap.some((item) => item.role === 'dashboard' && item.visible),
        query: snap.some((item) => item.role === 'query' && item.visible),
        fox: snap.some((item) => item.role === 'fox' && item.visible),
      };
    }).toEqual({ dashboard: false, query: false, fox: true });
    // Playwright page.keyboard Meta+W/Control+W does not reliably fire Electron
    // native menu role:close. Keep the three-surface harness above; real Cmd+W
    // remains a manual OS check. Do not register a global shortcut just for tests.
  } finally {
    await app.close();
  }
});

test('rejects a second query resize begin and settles the session on COPIED', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');
    await waitForHarness(app);
    await fox.getByTestId('fox-button').click();
    await waitForInteractiveQuery(app, query);

    type LayoutDebug = {
      handoffId: number;
      lastSequence: number;
      phase: string;
      resultCount: number;
      resizeSession: { sessionId: number; finished: boolean; lastSequence: number } | null;
    };
    type ResizeAck = { ok: boolean; sequence: number };
    // This slice owns the Main resize-session state machine. Query search,
    // result rendering, and COPIED UI are covered at component level, so drive
    // the typed phase boundary directly instead of coupling this test to native
    // focus/blur while the transparent Query window changes height.
    const debug = await app.evaluate(() => {
      const harness = (
        globalThis as {
          __demoTest?: {
            reportUiPhase: (phase: 'RESULTS', resultCount: 3) => void;
            queryLayoutDebug: () => LayoutDebug;
          };
        }
      ).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.reportUiPhase('RESULTS', 3);
      return harness.queryLayoutDebug();
    });
    expect(debug.phase).toBe('RESULTS');
    expect(debug.handoffId).toBeGreaterThan(0);
    const first = await app.evaluate((_, input) => {
      const harness = (
        globalThis as {
          __demoTest?: {
            resizeQueryHeight: (request: {
              type: 'begin' | 'keyboard' | 'end';
              sessionId: number;
              sequence: number;
              key?: 'Home';
              shiftKey?: boolean;
            }) => ResizeAck;
          };
        }
      ).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      return harness.resizeQueryHeight({
        type: 'begin',
        sessionId: input.handoffId,
        sequence: input.lastSequence + 1,
      });
    }, debug);
    expect(first.ok).toBe(true);
    const second = await app.evaluate((_, input) => {
      const harness = (
        globalThis as {
          __demoTest?: {
            resizeQueryHeight: (request: {
              type: 'begin' | 'keyboard' | 'end';
              sessionId: number;
              sequence: number;
              key?: 'Home';
              shiftKey?: boolean;
            }) => ResizeAck;
            queryLayoutDebug: () => LayoutDebug;
          };
        }
      ).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      return {
        begin: harness.resizeQueryHeight({
          type: 'begin',
          sessionId: input.handoffId,
          sequence: input.sequence + 1,
        }),
        keyboard: harness.resizeQueryHeight({
          type: 'keyboard',
          sessionId: input.handoffId,
          sequence: input.sequence + 2,
          key: 'Home',
          shiftKey: false,
        }),
        session: harness.queryLayoutDebug().resizeSession,
      };
    }, { handoffId: debug.handoffId, sequence: first.sequence });
    expect(second.begin.ok).toBe(false);
    expect(second.keyboard.ok).toBe(false);
    expect(second.session).not.toBeNull();

    const afterCopy = await app.evaluate((_, input) => {
      const harness = (
        globalThis as {
          __demoTest?: {
            reportUiPhase: (phase: 'COPIED', resultCount: 3) => void;
            resizeQueryHeight: (request: {
              type: 'end';
              sessionId: number;
              sequence: number;
            }) => ResizeAck;
            queryLayoutDebug: () => LayoutDebug;
          };
        }
      ).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.reportUiPhase('COPIED', 3);
      const lateEnd = harness.resizeQueryHeight({
        type: 'end',
        sessionId: input.handoffId,
        sequence: input.sequence + 3,
      });
      return {
        lateEnd,
        session: harness.queryLayoutDebug().resizeSession,
      };
    }, { handoffId: debug.handoffId, sequence: first.sequence });
    expect(afterCopy.session).toBeNull();
    expect(afterCopy.lateEnd.ok).toBe(false);
  } finally {
    await app.close();
  }
});

function collectProcessText(app: ElectronApplication): { stderr: string[]; stdout: string[] } {
  const stderr: string[] = [];
  const stdout: string[] = [];
  const child = app.process();
  child.stderr?.on('data', (chunk) => {
    stderr.push(String(chunk));
  });
  child.stdout?.on('data', (chunk) => {
    stdout.push(String(chunk));
  });
  return { stderr, stdout };
}

function expectNoDestroyedWindowNoise(logs: string[]): void {
  const text = logs.join('');
  expect(text).not.toMatch(/Object has been destroyed/i);
  expect(text).not.toMatch(/visibilityChanged/i);
  expect(text).not.toMatch(/Uncaught Exception|UnhandledPromiseRejection/i);
}

function waitForCleanProcessExit(app: ElectronApplication): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}> {
  const child = app.process();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Electron did not exit within 15 seconds'));
    }, 15_000);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('pending renderer server did not expose a TCP port');
  }
  return address.port;
}

test('startup quit, handoff quit, and post-dispose activate stay fail-closed', async () => {
  let rendererRequestStarted!: () => void;
  const firstRendererRequest = new Promise<void>((resolve) => {
    rendererRequestStarted = resolve;
  });
  const pendingRenderer = createServer((_request, _response) => {
    rendererRequestStarted();
    // Intentionally keep navigation pending so quitting exercises the
    // loadURL-during-destruction boundary instead of a fully started window.
  });
  const pendingPort = await listenOnLoopback(pendingRenderer);
  let pendingStartup: ElectronApplication | null = null;
  let pendingLogs: { stderr: string[]; stdout: string[] } = { stderr: [], stdout: [] };
  try {
    pendingStartup = await launchApp({
      ELECTRON_RENDERER_URL: `http://127.0.0.1:${pendingPort}`,
    });
    pendingLogs = collectProcessText(pendingStartup);
    await Promise.race([
      firstRendererRequest,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('renderer navigation did not start')), 15_000);
      }),
    ]);
    const exit = waitForCleanProcessExit(pendingStartup);
    await pendingStartup.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });
    await expect(exit).resolves.toEqual({ code: 0, signal: null });
  } finally {
    await pendingStartup?.close().catch(() => undefined);
    await new Promise<void>((resolve) => pendingRenderer.close(() => resolve()));
  }
  expectNoDestroyedWindowNoise(pendingLogs.stderr);
  expectNoDestroyedWindowNoise(pendingLogs.stdout);

  for (let index = 0; index < 3; index += 1) {
    const startup = await launchApp();
    const startupLogs = collectProcessText(startup);
    try {
      await waitForRole(startup, 'fox');
      await startup.evaluate(async ({ app: electronApp }) => {
        electronApp.quit();
      });
      await startup.waitForEvent('close', { timeout: 15_000 }).catch(() => undefined);
    } finally {
      await startup.close().catch(() => undefined);
    }
    expectNoDestroyedWindowNoise(startupLogs.stderr);
    expectNoDestroyedWindowNoise(startupLogs.stdout);
  }

  const handoff = await launchApp();
  const handoffLogs = collectProcessText(handoff);
  try {
    await waitForHarness(handoff);
    await waitForRole(handoff, 'fox');
    await handoff.evaluate(() => {
      const harness = (globalThis as { __demoTest?: { expand: () => void } }).__demoTest;
      if (!harness) throw new Error('DEMO_E2E harness missing');
      harness.expand();
    });
    await handoff.evaluate(async ({ app: electronApp }) => {
      electronApp.quit();
    });
    await handoff.waitForEvent('close', { timeout: 15_000 }).catch(() => undefined);
  } finally {
    await handoff.close().catch(() => undefined);
  }
  expectNoDestroyedWindowNoise(handoffLogs.stderr);
  expectNoDestroyedWindowNoise(handoffLogs.stdout);

  const activate = await launchApp();
  const activateLogs = collectProcessText(activate);
  try {
    await waitForHarness(activate);
    await activate.evaluate(({ app: electronApp }) => {
      electronApp.emit('before-quit');
      electronApp.emit('activate');
    });
    const afterShutdown = await activate.evaluate(() => {
      const controllerMissing = (globalThis as { __demoTest?: unknown }).__demoTest;
      return {
        harnessStillPresent: Boolean(controllerMissing),
      };
    });
    // The in-process harness object may still exist on the old controller, but
    // bootstrap IPC / activate must not recreate work after the fence.
    expect(afterShutdown.harnessStillPresent).toBe(true);
    await activate.close();
  } finally {
    await activate.close().catch(() => undefined);
  }
  expectNoDestroyedWindowNoise(activateLogs.stderr);
});
