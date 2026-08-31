import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_ENV_BADGES,
  DASHBOARD_MACOS_COLLAPSED_SURFACE_WIDTH,
  DASHBOARD_MACOS_CONTROL_ISLAND_RIGHT,
  DASHBOARD_MACOS_CONTROL_SAFE_LEFT,
  DASHBOARD_MACOS_ICON_ANCHOR_OFFSET,
  DASHBOARD_MACOS_TOGGLE_RIGHT,
  DASHBOARD_NATIVE_COLLAPSED_SURFACE_WIDTH,
  DASHBOARD_NATIVE_ICON_ANCHOR_OFFSET,
  DASHBOARD_MACOS_TITLEBAR_HEIGHT,
  DASHBOARD_MACOS_TITLEBAR_STYLE,
  DASHBOARD_MACOS_TRAFFIC_LIGHT_POSITION,
  DASHBOARD_STRUCTURE_DISCLAIMER,
  DASHBOARD_TRAFFIC_LIGHT_SAFE,
  DASHBOARD_WINDOW_CHROME,
  DASHBOARD_WINDOW_SECURITY,
  DASHBOARD_WINDOW_TITLE,
  dashboardChromeCssVars,
  dashboardChromeModeFor,
  dashboardTitleBarStyleFor,
  inferDashboardHostPlatform,
  resolveDashboardNativeChrome,
  usesIntegratedDashboardChrome,
} from '../../src/shared/dashboard-window';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainWindow = readFileSync(path.join(root, 'src/main/dashboard-window.ts'), 'utf8');
const overlayController = [
  readFileSync(path.join(root, 'src/main/overlay-controller.ts'), 'utf8'),
  readFileSync(path.join(root, 'src/main/overlay-renderer-loader.ts'), 'utf8'),
  readFileSync(path.join(root, 'src/main/overlay-chrome-window.ts'), 'utf8'),
].join('\n');

describe('dashboard window contract', () => {
  it('uses a standard framed desktop window instead of an overlay panel', () => {
    expect(DASHBOARD_WINDOW_CHROME).toMatchObject({
      width: 1180,
      height: 760,
      minWidth: 980,
      minHeight: 680,
      frame: true,
      transparent: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: true,
    });
    expect(DASHBOARD_WINDOW_CHROME).not.toHaveProperty('titleBarStyle');
    expect(DASHBOARD_WINDOW_CHROME).not.toHaveProperty('titleBarOverlay');
    expect(DASHBOARD_WINDOW_SECURITY).toEqual({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    });
    expect('preload' in DASHBOARD_WINDOW_SECURITY).toBe(false);
    expect(DASHBOARD_WINDOW_TITLE).toBe('客服运营工作台 · 演示数据');
  });

  it('hides the native macOS title text with hiddenInset while keeping Windows and Linux native', () => {
    expect(DASHBOARD_MACOS_TITLEBAR_STYLE).toBe('hiddenInset');
    expect(DASHBOARD_MACOS_TITLEBAR_HEIGHT).toBe(48);
    expect(DASHBOARD_MACOS_CONTROL_SAFE_LEFT).toBe(72);
    expect(DASHBOARD_MACOS_CONTROL_ISLAND_RIGHT).toBe(120);
    expect(DASHBOARD_MACOS_COLLAPSED_SURFACE_WIDTH).toBe(120);
    expect(DASHBOARD_MACOS_TOGGLE_RIGHT).toBe(112);
    expect(DASHBOARD_MACOS_ICON_ANCHOR_OFFSET).toBe(60);
    expect(DASHBOARD_NATIVE_COLLAPSED_SURFACE_WIDTH).toBe(72);
    expect(DASHBOARD_NATIVE_ICON_ANCHOR_OFFSET).toBe(36);
    expect(dashboardChromeModeFor('darwin')).toBe('integrated');
    expect(DASHBOARD_MACOS_TRAFFIC_LIGHT_POSITION).toEqual({ x: 14, y: 16 });
    expect(DASHBOARD_TRAFFIC_LIGHT_SAFE.topPx).toBe(48);
    expect(DASHBOARD_TRAFFIC_LIGHT_SAFE.leftPx).toBe(72);
    expect(dashboardChromeCssVars('integrated')).toEqual({
      '--dash-titlebar-height': '48px',
      '--dash-control-safe-left': '72px',
      '--dash-control-island-right': '120px',
      '--dash-collapsed-surface-width': '120px',
      '--dash-nav-icon-anchor-offset': '60px',
      '--dash-nav-icon-slot-width': '120px',
    });
    expect(dashboardChromeCssVars('native')).toEqual({
      '--dash-titlebar-height': '0px',
      '--dash-control-safe-left': '72px',
      '--dash-control-island-right': '120px',
      '--dash-collapsed-surface-width': '72px',
      '--dash-nav-icon-anchor-offset': '36px',
      '--dash-nav-icon-slot-width': '72px',
    });

    expect(resolveDashboardNativeChrome('darwin')).toMatchObject({
      frame: true,
      transparent: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 16 },
    });
    expect(resolveDashboardNativeChrome('win32')).toEqual(DASHBOARD_WINDOW_CHROME);
    expect(resolveDashboardNativeChrome('linux')).toEqual(DASHBOARD_WINDOW_CHROME);
    expect(resolveDashboardNativeChrome('win32')).not.toHaveProperty('titleBarStyle');
    expect(resolveDashboardNativeChrome('linux')).not.toHaveProperty('trafficLightPosition');

    expect(dashboardTitleBarStyleFor('darwin')).toBe('hiddenInset');
    expect(dashboardTitleBarStyleFor('win32')).toBe('default');
    expect(usesIntegratedDashboardChrome('darwin')).toBe(true);
    expect(usesIntegratedDashboardChrome('win32')).toBe(false);
    expect(dashboardChromeModeFor('darwin')).toBe('integrated');
    expect(dashboardChromeModeFor('linux')).toBe('native');

    expect(mainWindow).toContain('resolveDashboardNativeChrome(process.platform)');
    expect(mainWindow).toContain("win.on('page-title-updated'");
    expect(mainWindow).toContain('event.preventDefault()');
    expect(mainWindow).toContain('DASHBOARD_WINDOW_TITLE');
    expect(mainWindow).not.toContain('titleBarOverlay');
    expect(mainWindow).not.toContain('vibrancy');
    expect(mainWindow).not.toContain('setVibrancy');
    expect(overlayController).toContain("url.searchParams.set('platform', process.platform)");
    expect(overlayController).toContain('query: { role, platform: process.platform }');
  });

  it('infers host platform from an explicit value or user agent without preload', () => {
    expect(inferDashboardHostPlatform({ platform: 'darwin' })).toBe('darwin');
    expect(inferDashboardHostPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    })).toBe('darwin');
    expect(inferDashboardHostPlatform({
      userAgent: 'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0',
    })).toBe('darwin');
    expect(inferDashboardHostPlatform({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })).toBe('win32');
    expect(inferDashboardHostPlatform({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    })).toBe('linux');
    expect(inferDashboardHostPlatform({ userAgent: 'unknown-agent' })).toBe('unknown');
  });

  it('uses one visible demo marker while keeping the non-Dafuyan boundary explicit', () => {
    expect(DASHBOARD_ENV_BADGES).toEqual(['演示数据']);
    expect(DASHBOARD_STRUCTURE_DISCLAIMER).toBe(
      '无后端 · 不保存 · 话术正文与 VOC 明细均为合成镜像',
    );
  });
});
