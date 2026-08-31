import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => {
  const setAlwaysOnTop = vi.fn();
  const setMenuBarVisibility = vi.fn();
  const BrowserWindow = vi.fn(function MockBrowserWindow(_options: Record<string, unknown>) {
    return {
      setAlwaysOnTop,
      setMenuBarVisibility,
    };
  });
  return { BrowserWindow, setAlwaysOnTop, setMenuBarVisibility };
});

vi.mock('electron', () => ({
  BrowserWindow: electronMocks.BrowserWindow,
}));

import { createOverlayChromeWindow } from '../../src/main/overlay-chrome-window';

describe('overlay chrome window security contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a transparent overlay without renderer Node.js privileges', () => {
    const created = createOverlayChromeWindow('/tmp/preload.js', {
      width: 88,
      height: 88,
      title: 'Fox',
    });

    expect(created).toBeDefined();
    expect(electronMocks.BrowserWindow).toHaveBeenCalledOnce();
    const options = electronMocks.BrowserWindow.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      width: 88,
      height: 88,
      frame: false,
      transparent: true,
      show: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: '/tmp/preload.js',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: true,
      },
    });
    if (process.platform === 'darwin') {
      expect(options).toMatchObject({ type: 'panel', hiddenInMissionControl: true });
    }
    expect(electronMocks.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
    expect(electronMocks.setMenuBarVisibility).toHaveBeenCalledWith(false);
  });

  it('allows the query surface to opt out of the macOS panel role without weakening security', () => {
    createOverlayChromeWindow('/tmp/preload.js', {
      width: 600,
      height: 88,
      title: 'Query',
      macPanel: false,
      backgroundThrottling: false,
    });

    const options = electronMocks.BrowserWindow.mock.calls[0]?.[0];
    expect(options?.webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    });
    expect(options).not.toHaveProperty('type');
  });
});
