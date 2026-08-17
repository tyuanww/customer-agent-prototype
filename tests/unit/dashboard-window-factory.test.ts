import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const setMenuBarVisibility = vi.fn();
  const on = vi.fn();
  const BrowserWindow = vi.fn(function MockBrowserWindow(_options: Record<string, unknown>) {
    return {
      getTitle: vi.fn(() => '客服运营工作台 · 演示数据'),
      on,
      setMenuBarVisibility,
      setTitle: vi.fn(),
    };
  });
  return {
    BrowserWindow,
    icon: { kind: 'brand-icon' },
    on,
    setMenuBarVisibility,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  nativeTheme: {
    shouldUseDarkColors: false,
  },
}));

vi.mock('../../src/main/app-identity', () => ({
  loadBrandNativeImage: vi.fn(() => mocks.icon),
}));

import { createDashboardBrowserWindow } from '../../src/main/dashboard-window';

describe('dashboard BrowserWindow factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires the final desktop window without renderer Node.js privileges', () => {
    const created = createDashboardBrowserWindow();

    expect(created).toBeDefined();
    expect(mocks.BrowserWindow).toHaveBeenCalledOnce();
    const options = mocks.BrowserWindow.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      frame: true,
      transparent: false,
      show: false,
      resizable: true,
      skipTaskbar: false,
      alwaysOnTop: false,
      icon: mocks.icon,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    expect(options?.webPreferences).not.toHaveProperty('preload');
    expect(mocks.setMenuBarVisibility).toHaveBeenCalledWith(false);
    expect(mocks.on).toHaveBeenCalledWith('page-title-updated', expect.any(Function));
  });
});
