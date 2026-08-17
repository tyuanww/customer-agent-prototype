export const DASHBOARD_WINDOW_TITLE = '客服运营工作台 · 演示数据';

export const DASHBOARD_WINDOW_CHROME = {
  width: 1180,
  height: 760,
  minWidth: 980,
  minHeight: 680,
  frame: true,
  transparent: false,
  backgroundColor: '#F7F6F9',
  hasShadow: true,
  show: false,
  resizable: true,
  minimizable: true,
  maximizable: true,
  fullscreenable: true,
  skipTaskbar: false,
  alwaysOnTop: false,
  autoHideMenuBar: true,
} as const;

export type DashboardHostPlatform = 'darwin' | 'win32' | 'linux' | 'unknown';
export type DashboardTitleBarStyle = 'default' | 'hiddenInset';
export type DashboardChromeMode = 'integrated' | 'native';

export const DASHBOARD_MACOS_TITLEBAR_STYLE = 'hiddenInset' as const;
export const DASHBOARD_MACOS_TITLEBAR_HEIGHT = 48;
export const DASHBOARD_MACOS_TRAFFIC_SAFE_WIDTH = 72;
export const DASHBOARD_MACOS_CONTROL_SAFE_LEFT = DASHBOARD_MACOS_TRAFFIC_SAFE_WIDTH;
export const DASHBOARD_MACOS_TOGGLE_LEFT = DASHBOARD_MACOS_CONTROL_SAFE_LEFT;
export const DASHBOARD_MACOS_TOGGLE_SIZE = 40;
export const DASHBOARD_MACOS_TOGGLE_TOP = 4;
export const DASHBOARD_MACOS_TOGGLE_RIGHT =
  DASHBOARD_MACOS_TOGGLE_LEFT + DASHBOARD_MACOS_TOGGLE_SIZE;
export const DASHBOARD_MACOS_TOGGLE_TO_DIVIDER_GAP = 8;
export const DASHBOARD_MACOS_COLLAPSED_SURFACE_WIDTH =
  DASHBOARD_MACOS_TOGGLE_RIGHT + DASHBOARD_MACOS_TOGGLE_TO_DIVIDER_GAP;
export const DASHBOARD_MACOS_CONTROL_ISLAND_RIGHT = DASHBOARD_MACOS_COLLAPSED_SURFACE_WIDTH;
export const DASHBOARD_MACOS_ICON_ANCHOR_OFFSET = 60;
export const DASHBOARD_NATIVE_COLLAPSED_SURFACE_WIDTH = 72;
export const DASHBOARD_NATIVE_ICON_ANCHOR_OFFSET = 36;
export const DASHBOARD_MACOS_TRAFFIC_LIGHT_POSITION = {
  x: 14,
  y: 16,
} as const;
export const DASHBOARD_TRAFFIC_LIGHT_SAFE = {
  leftPx: DASHBOARD_MACOS_TRAFFIC_SAFE_WIDTH,
  topPx: DASHBOARD_MACOS_TITLEBAR_HEIGHT,
} as const;

export function dashboardCollapsedSurfaceWidth(chromeMode: DashboardChromeMode): number {
  return chromeMode === 'integrated'
    ? DASHBOARD_MACOS_COLLAPSED_SURFACE_WIDTH
    : DASHBOARD_NATIVE_COLLAPSED_SURFACE_WIDTH;
}

export function dashboardNavIconAnchorOffset(chromeMode: DashboardChromeMode): number {
  return chromeMode === 'integrated'
    ? DASHBOARD_MACOS_ICON_ANCHOR_OFFSET
    : DASHBOARD_NATIVE_ICON_ANCHOR_OFFSET;
}

export function dashboardChromeCssVars(chromeMode: DashboardChromeMode): {
  '--dash-titlebar-height': string;
  '--dash-control-safe-left': string;
  '--dash-control-island-right': string;
  '--dash-collapsed-surface-width': string;
  '--dash-nav-icon-anchor-offset': string;
  '--dash-nav-icon-slot-width': string;
} {
  const collapsedSurface = dashboardCollapsedSurfaceWidth(chromeMode);
  return {
    '--dash-titlebar-height': `${chromeMode === 'integrated' ? DASHBOARD_MACOS_TITLEBAR_HEIGHT : 0}px`,
    '--dash-control-safe-left': `${DASHBOARD_MACOS_CONTROL_SAFE_LEFT}px`,
    '--dash-control-island-right': `${DASHBOARD_MACOS_CONTROL_ISLAND_RIGHT}px`,
    '--dash-collapsed-surface-width': `${collapsedSurface}px`,
    '--dash-nav-icon-anchor-offset': `${dashboardNavIconAnchorOffset(chromeMode)}px`,
    '--dash-nav-icon-slot-width': `${collapsedSurface}px`,
  };
}

export const DASHBOARD_WINDOW_SECURITY = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: false,
} as const;

export function normalizeDashboardHostPlatform(
  value: string | null | undefined,
): DashboardHostPlatform {
  if (value === 'darwin' || value === 'win32' || value === 'linux') {
    return value;
  }
  return 'unknown';
}

export function inferDashboardHostPlatform(input: {
  platform?: string | null;
  userAgent?: string | null;
}): DashboardHostPlatform {
  const explicit = normalizeDashboardHostPlatform(input.platform);
  if (explicit !== 'unknown') {
    return explicit;
  }

  const userAgent = input.userAgent ?? '';
  if (/Mac OS X|Macintosh|\bdarwin\b/i.test(userAgent)) {
    return 'darwin';
  }
  if (/Windows NT|Win32|Win64|Windows/i.test(userAgent)) {
    return 'win32';
  }
  if (/Linux/i.test(userAgent)) {
    return 'linux';
  }
  return 'unknown';
}

export function usesIntegratedDashboardChrome(platform: DashboardHostPlatform): boolean {
  return platform === 'darwin';
}

export function dashboardChromeModeFor(
  platform: DashboardHostPlatform,
): DashboardChromeMode {
  return usesIntegratedDashboardChrome(platform) ? 'integrated' : 'native';
}

export function dashboardTitleBarStyleFor(
  platform: DashboardHostPlatform | string,
): DashboardTitleBarStyle {
  return platform === 'darwin' ? DASHBOARD_MACOS_TITLEBAR_STYLE : 'default';
}

export function resolveDashboardNativeChrome(platform: string): {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  frame: true;
  transparent: false;
  backgroundColor: string;
  hasShadow: true;
  show: false;
  resizable: true;
  minimizable: true;
  maximizable: true;
  fullscreenable: true;
  skipTaskbar: false;
  alwaysOnTop: false;
  autoHideMenuBar: true;
  titleBarStyle?: typeof DASHBOARD_MACOS_TITLEBAR_STYLE;
  trafficLightPosition?: { x: number; y: number };
} {
  if (platform === 'darwin') {
    return {
      ...DASHBOARD_WINDOW_CHROME,
      titleBarStyle: DASHBOARD_MACOS_TITLEBAR_STYLE,
      trafficLightPosition: {
        x: DASHBOARD_MACOS_TRAFFIC_LIGHT_POSITION.x,
        y: DASHBOARD_MACOS_TRAFFIC_LIGHT_POSITION.y,
      },
    };
  }

  return {
    ...DASHBOARD_WINDOW_CHROME,
  };
}

export const DASHBOARD_ENV_BADGES = ['演示数据'] as const;

export const DASHBOARD_STRUCTURE_DISCLAIMER =
  '无后端 · 不保存 · 话术正文与 VOC 明细均为合成镜像';
export const DASHBOARD_ARCHITECTURE_MARK = '架构模拟 / MOCK / NOT CONNECTED';
export const DASHBOARD_REFRESHED_AT = '2026-08-13 18:40:00 CST';
export const DASHBOARD_REFRESH_LABEL = `数据更新至：${DASHBOARD_REFRESHED_AT} · 固定快照`;
export const DASHBOARD_METRIC_SCOPE =
  '口径：根问题与检索操作双账；adopted = 复制成功，不等于发送或正确。固定合成演示口径，非生产指标。';
