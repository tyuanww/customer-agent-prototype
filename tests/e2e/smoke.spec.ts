import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page, _electron as electron } from '@playwright/test';
import {
  FOX_EDGE_PEEK_TRAVEL_PX,
  FOX_EDGE_PEEK_VISIBLE_PX,
  FOX_EDGE_VISIBLE_PX,
  FOX_SIZE,
} from '../../src/shared/overlay-geometry';
import {
  FOX_PEEK_DURATION_MS,
  QUERY_CLOSE_DURATION_MS,
  QUERY_OPEN_DURATION_MS,
} from '../../src/shared/fox-motion';
import { SYNTHETIC_SCRIPTS } from '../../src/renderer/data/synthetic-scripts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainEntry = path.join(repoRoot, 'out/main/index.js');
const screenshotDir = path.join(repoRoot, '.gstack/qa-reports/screenshots');
const CLEANSER_QUERY = '澄芽氨基酸洁面怎么用';
const VERBATIM_TAIL = '合成原文保留尾部空格与换行  \n\n';

const cleanser = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-prod-001');
const cleanserSecond = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-prod-001-care');
if (!cleanser || !cleanserSecond) {
  throw new Error('missing cleanser demo fixtures');
}

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

async function readMainClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText());
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
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((win) => {
      const bounds = win.getBounds();
      const url = win.webContents.getURL();
      return {
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
      };
    }),
  );
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
      expect(before.find((item) => item.role === 'query')?.visibleOnAllWorkspaces).toBe(true);
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
    await query.getByTestId('search-button').focus();
    await expect(questionInput).toHaveValue(CLEANSER_QUERY);
    // The renderer action is what this assertion exercises. On macOS CI the
    // transparent BrowserWindow can transiently lose native actionability even
    // after its DOM focus is correct, so bypass only Playwright's hit-test wait.
    await query.getByTestId('search-button').click({ force: true });
    await expect(query.getByTestId('script-card-3')).toBeVisible();
    await expect.poll(async () => {
      const snap = await windowSnapshot(app);
      return snap.find((item) => item.role === 'query')?.height;
    }).toBe(620);
    await expect(query.getByTestId('result-list')).not.toContainText('匹配分');
    await expect(query.getByTestId('match-reason-1')).toHaveText('精确问法');
    await expect(query.getByTestId('answer-text-1')).toHaveText(cleanser.answerText);
    const candidateLayout = await query.getByTestId('result-pane').evaluate((pane) => {
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
    if (!candidateLayout.fits) {
      throw new Error(`Top 3 does not fit: ${JSON.stringify(candidateLayout)}`);
    }
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

test('docks a symmetric half fox and runs directional peek/retract motion at both edges', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    const query = await waitForRole(app, 'query');
    await waitForHarness(app);
    for (const edge of ['left', 'right'] as const) {
      await app.evaluate((_electron, targetEdge) => {
        const harness = (
          globalThis as {
            __demoTest?: { dockFox: (edge: 'left' | 'right') => void };
          }
        ).__demoTest;
        if (!harness) {
          throw new Error('DEMO_E2E harness missing');
        }
        harness.dockFox(targetEdge);
      }, edge);
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', edge);
      await expect(fox.locator('.fox-head')).toHaveClass(new RegExp(`is-snapping-${edge}`));
      const snap = await fox.getByTestId('fox-idle').evaluate((el) => {
        const head = el.querySelector<HTMLElement>('.fox-head');
        return {
          token: Number(el.getAttribute('data-snap-token') ?? '0'),
          animationName: head ? getComputedStyle(head).animationName : '',
        };
      });
      expect(snap.token).toBeGreaterThan(0);
      expect(snap.animationName).toContain(`fox-snap-${edge}`);
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-snapping', 'false');
      const readNativeFoxFrame = () => app.evaluate(({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getAllWindows().find((item) =>
          item.webContents.getURL().includes('role=fox'),
        );
        if (!win) {
          return null;
        }
        const bounds = win.getBounds();
        const workArea = screen.getDisplayMatching(bounds).workArea;
        return {
          x: bounds.x,
          width: bounds.width,
          expectedX: workArea.x,
          expectedRightX: workArea.x + workArea.width - bounds.width,
        };
      });
      // Drive the renderer and main process through the same pointer contract.
      // Calling preload directly here would desynchronise FoxApp's dedupe ref
      // from the controller and make the following pointerover race-dependent.
      await fox.getByTestId('fox-button').dispatchEvent('pointerout');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-peeking', 'false');
      await expect.poll(async () => {
        const frame = await readNativeFoxFrame();
        if (!frame) {
          return false;
        }
        const expectedX = edge === 'left' ? frame.expectedX : frame.expectedRightX;
        return frame.x === expectedX && frame.width === FOX_SIZE;
      }).toBe(true);
      await expect(fox.locator('.fox-head-image')).toHaveCSS('transform', 'none');
      const centeredHead = await fox.locator('.fox-head').evaluate((head) => {
        const rect = head.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      });
      expect(centeredHead.width).toBe(64);
      expect(centeredHead.left).toBe(edge === 'left' ? -32 : 56);
      expect(centeredHead.right).toBe(edge === 'left' ? 32 : 120);
      await fox.screenshot({
        path: path.join(screenshotDir, `fox-dock-${edge}-rest-half.png`),
        omitBackground: true,
        clip: {
          x: edge === 'left' ? 0 : FOX_SIZE - FOX_EDGE_VISIBLE_PX,
          y: 0,
          width: FOX_EDGE_VISIBLE_PX,
          height: FOX_SIZE,
        },
      });

      await fox.getByTestId('fox-button').dispatchEvent('pointerover');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-peeking', 'true');
      await expect.poll(async () => (await readNativeFoxFrame())?.width).toBe(FOX_SIZE);
      const peekMotion = await fox.locator('.fox-head').evaluate((head) => {
        const style = getComputedStyle(head);
        return {
          animationName: style.animationName,
          animationDuration: style.animationDuration,
        };
      });
      expect(peekMotion.animationName).toContain(`fox-peek-${edge}`);
      expect(peekMotion.animationDuration).toBe('0.42s');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute(
        'data-peek-travel-px',
        String(FOX_EDGE_PEEK_TRAVEL_PX),
      );
      await fox.waitForTimeout(FOX_PEEK_DURATION_MS + 40);
      await fox.screenshot({
        path: path.join(screenshotDir, `fox-dock-${edge}-peek.png`),
        omitBackground: true,
      });
      await fox.getByTestId('fox-button').dispatchEvent('pointerout');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-peeking', 'false');
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-retracting', 'true');
      const retractAnimation = await fox.locator('.fox-head').evaluate(
        (head) => getComputedStyle(head).animationName,
      );
      expect(retractAnimation).toContain(`fox-retract-${edge}`);
      await expect.poll(async () => (await readNativeFoxFrame())?.width).toBe(FOX_SIZE);
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-retracting', 'false');

      const dragProbe = await app.evaluate(({ screen }, probeInput) => {
        const workArea = screen.getPrimaryDisplay().workArea;
        const safeOverflow = probeInput.foxSize - probeInput.peekVisible;
        const baseX = probeInput.edge === 'left'
          ? workArea.x - safeOverflow
          : workArea.x + workArea.width - probeInput.foxSize + safeOverflow;
        return {
          deltaX: probeInput.edge === 'left' ? 6 : -6,
          expectedX: baseX + (probeInput.edge === 'left' ? 6 : -6),
        };
      }, { edge, foxSize: FOX_SIZE, peekVisible: FOX_EDGE_PEEK_VISIBLE_PX });
      const tokenBeforeDrag = Number(
        await fox.getByTestId('fox-idle').getAttribute('data-snap-token'),
      );
      // Component coverage proves that screenX=0 stays in screen coordinates.
      // Exercise the real preload -> IPC -> controller chain here without a
      // synthetic pointer capture racing the native BrowserWindow relocation.
      await fox.evaluate(async (deltaX) => {
        await window.customerAgent?.moveFoxBy(deltaX, 0, false);
      }, dragProbe.deltaX);
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', 'none');
      await expect.poll(async () =>
        (await windowSnapshot(app)).find((item) => item.role === 'fox')?.x,
      ).toBe(dragProbe.expectedX);
      await fox.evaluate(async () => {
        await window.customerAgent?.moveFoxBy(0, 0, true);
      });
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', edge);
      await expect.poll(async () =>
        Number(await fox.getByTestId('fox-idle').getAttribute('data-snap-token')),
      ).toBeGreaterThan(tokenBeforeDrag);
      await expect.poll(async () => {
        const frame = await readNativeFoxFrame();
        if (!frame) {
          return false;
        }
        const expectedX = edge === 'left' ? frame.expectedX : frame.expectedRightX;
        return frame.x === expectedX && frame.width === FOX_SIZE;
      }).toBe(true);
      await expect(fox.getByTestId('fox-idle')).toHaveAttribute('data-snapping', 'false');

      await fox.getByTestId('fox-button').click();
      await expect.poll(async () => {
        const snap = await windowSnapshot(app);
        return snap.some((item) => item.role === 'query' && item.visible);
      }).toBe(true);
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-opening', 'true');
      const handoffCenter = await query.getByTestId('query-shell').evaluate((shell) => {
        const style = (shell as HTMLElement).style;
        return {
          x:
            Number.parseFloat(style.getPropertyValue('--query-handoff-clip-left')) +
            32,
          y:
            Number.parseFloat(style.getPropertyValue('--query-handoff-clip-top')) +
            32,
          foxWidth: document.querySelector<HTMLElement>('[data-testid="capsule-fox"]')
            ?.getBoundingClientRect().width,
          visual: {
            a: Number(style.getPropertyValue('--query-handoff-fox-a')),
            b: Number(style.getPropertyValue('--query-handoff-fox-b')),
            c: Number(style.getPropertyValue('--query-handoff-fox-c')),
            d: Number(style.getPropertyValue('--query-handoff-fox-d')),
            e: Number(style.getPropertyValue('--query-handoff-fox-e')),
            f: Number(style.getPropertyValue('--query-handoff-fox-f')),
          },
        };
      });
      const frozenFoxVisual = await fox.locator('.fox-head').evaluate((head) => {
        const transform = getComputedStyle(head).transform;
        const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
        return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f };
      });
      const afterOpenWindows = await windowSnapshot(app);
      const queryAfterOpen = afterOpenWindows.find((item) => item.role === 'query');
      const foxAfterOpen = afterOpenWindows.find((item) => item.role === 'fox');
      expect(queryAfterOpen).toBeDefined();
      expect(foxAfterOpen).toBeDefined();
      expect(handoffCenter.foxWidth).toBeCloseTo(64, 4);
      for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
        expect(handoffCenter.visual[key]).toBeCloseTo(frozenFoxVisual[key], 4);
      }
      const edgeX = await app.evaluate(({ screen }, targetEdge) => {
        const workArea = screen.getPrimaryDisplay().workArea;
        return targetEdge === 'left' ? workArea.x : workArea.x + workArea.width;
      }, edge);
      // A pointer-enter immediately before click may reveal the fox by 36px,
      // but the shared-element center must still begin at that edge trajectory.
      expect(Math.abs((queryAfterOpen?.x ?? 0) + handoffCenter.x - edgeX)).toBeLessThanOrEqual(
        FOX_EDGE_PEEK_TRAVEL_PX,
      );
      expect((queryAfterOpen?.y ?? 0) + handoffCenter.y).toBeCloseTo(
        (foxAfterOpen?.y ?? 0) + FOX_SIZE / 2,
        1,
      );
      // Move the real system pointer away from the edge anchor while the query
      // is visible. Otherwise showing the fox under the stationary pointer can
      // legitimately trigger a fresh hover peek before the resting assertion.
      await query.getByTestId('question-input').hover();
      await app.evaluate(() => {
        const harness = (globalThis as { __demoTest?: { dismiss: () => void } }).__demoTest;
        if (!harness) {
          throw new Error('DEMO_E2E harness missing');
        }
        harness.dismiss();
      });
      await expect(query.getByTestId('query-shell')).toHaveAttribute('data-closing', 'true');
      const collapseCenter = await query.getByTestId('query-shell').evaluate((shell) => {
        const style = (shell as HTMLElement).style;
        const scaleX = Number(style.getPropertyValue('--query-handoff-scale-x'));
        const originX = Number.parseFloat(style.getPropertyValue('--query-handoff-origin-x'));
        return originX * (1 - scaleX) + (600 * scaleX) / 2;
      });
      expect(collapseCenter).toBeCloseTo(edge === 'left' ? 0 : 600, 2);
      await expect.poll(async () => {
        const snap = await windowSnapshot(app);
        return {
          foxVisible: snap.some((item) => item.role === 'fox' && item.visible),
          queryVisible: snap.some((item) => item.role === 'query' && item.visible),
        };
      }).toEqual({ foxVisible: true, queryVisible: false });

      // The native frame remains stable; only the renderer crop changes between
      // rest and a fresh hover peek, so WindowServer cannot start a bounce loop.
      await expect.poll(async () => {
        const frame = await readNativeFoxFrame();
        if (!frame) {
          return false;
        }
        const expectedX = edge === 'left' ? frame.expectedX : frame.expectedRightX;
        return frame.x === expectedX && frame.width === FOX_SIZE;
      }).toBe(true);
    }
  } finally {
    await app.close();
  }
});

test('honors reduced motion without adding a rectangular fox background', async () => {
  const app = await launchApp();
  try {
    const fox = await waitForRole(app, 'fox');
    await fox.emulateMedia({ reducedMotion: 'reduce' });
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
    const snapStyle = await fox.locator('.fox-head').evaluate((head) => getComputedStyle(head).animationName);
    expect(['', 'none']).toContain(snapStyle);
  } finally {
    await app.close();
  }
});
