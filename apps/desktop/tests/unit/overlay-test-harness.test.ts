import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import {
  attachTestHarness,
  isTestHarnessEnabled,
  type OverlayTestHarnessHost,
} from '../../src/main/overlay-test-harness';

const electronMocks = vi.hoisted(() => ({
  getFocusedWindow: vi.fn(() => null),
  getDisplayMatching: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: electronMocks.getFocusedWindow,
  },
  screen: {
    getDisplayMatching: electronMocks.getDisplayMatching,
  },
}));

const originalDemo = process.env.DEMO_E2E;
const originalArgv = [...process.argv];

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_E2E;
  } else {
    process.env.DEMO_E2E = originalDemo;
  }
  process.argv = [...originalArgv];
  Reflect.deleteProperty(globalThis, '__demoTest');
  electronMocks.getFocusedWindow.mockReset();
  electronMocks.getDisplayMatching.mockReset();
  electronMocks.getFocusedWindow.mockReturnValue(null);
});

describe('demo e2e harness flag', () => {
  it('turns on only for DEMO_E2E=1 or --demo-e2e', () => {
    delete process.env.DEMO_E2E;
    process.argv = ['node', 'main.js'];
    expect(isTestHarnessEnabled()).toBe(false);

    process.env.DEMO_E2E = '1';
    expect(isTestHarnessEnabled()).toBe(true);

    delete process.env.DEMO_E2E;
    process.argv = ['node', 'main.js', '--demo-e2e'];
    expect(isTestHarnessEnabled()).toBe(true);
  });
});

describe('attachTestHarness without a Fox window', () => {
  it('keeps the optional provenance helper fail-closed', () => {
    const moveBy = vi.fn();
    const controller = {
      phase: 'FOX_IDLE',
      shortcutRegistered: true,
      openSearch: vi.fn(),
      dismiss: vi.fn(),
      toggle: vi.fn(),
      getWindows: vi.fn(() => [] as BrowserWindow[]),
      moveBy,
      openDashboard: vi.fn(),
      closeDashboard: vi.fn(),
      dashboardSnapshot: vi.fn(() => null),
      isDashboardTrusted: vi.fn(() => false),
      queryLayoutDebugState: vi.fn(() => null),
      resizeQueryHeight: vi.fn(),
      reportUiPhase: vi.fn(),
    } satisfies OverlayTestHarnessHost;

    attachTestHarness(controller);

    const harness = (globalThis as { __demoTest?: {
      expand: () => void;
      dockFox: (edge: 'left' | 'right') => void;
      blurQuery: () => void;
      queryHeight: () => number | null;
      beginFoxSetBoundsTrace: () => void;
      endFoxSetBoundsTrace: () => Array<{ bounds: unknown; animate: boolean }>;
      closeFocusedSurface: () => void;
    } }).__demoTest;
    expect(harness).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(globalThis, '__demoTest')?.enumerable).toBe(false);

    expect(() => harness!.dockFox('left')).not.toThrow();
    expect(moveBy).not.toHaveBeenCalled();
    expect(electronMocks.getDisplayMatching).not.toHaveBeenCalled();
    expect(() => harness!.blurQuery()).not.toThrow();
    expect(harness!.queryHeight()).toBeNull();
    harness!.beginFoxSetBoundsTrace();
    expect(harness!.endFoxSetBoundsTrace()).toEqual([]);
    expect(() => harness!.closeFocusedSurface()).not.toThrow();
    expect(electronMocks.getFocusedWindow).toHaveBeenCalledOnce();
  });
});
