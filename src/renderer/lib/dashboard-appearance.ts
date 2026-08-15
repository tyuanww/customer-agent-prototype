export const DASHBOARD_NAV_COLLAPSED_WIDTH = 72;
export const DASHBOARD_NAV_MIN_WIDTH = 216;
export const DASHBOARD_NAV_DEFAULT_WIDTH = 248;
export const DASHBOARD_NAV_MAX_WIDTH = 360;
export const DASHBOARD_NAV_RESIZE_STEP = 8;

export type DashboardThemeMode = 'system' | 'light' | 'dark';
export type ResolvedDashboardTheme = 'light' | 'dark';

export const DASHBOARD_THEME_OPTIONS = [
  { mode: 'light', label: '浅色' },
  { mode: 'dark', label: '深色' },
  { mode: 'system', label: '跟随系统' },
] as const satisfies ReadonlyArray<{ mode: DashboardThemeMode; label: string }>;

export function getDashboardNavMaxWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return DASHBOARD_NAV_MAX_WIDTH;
  }

  return Math.max(
    DASHBOARD_NAV_MIN_WIDTH,
    Math.min(DASHBOARD_NAV_MAX_WIDTH, Math.floor(viewportWidth * 0.34)),
  );
}

export function clampDashboardNavWidth(value: number, viewportWidth: number): number {
  const fallback = DASHBOARD_NAV_DEFAULT_WIDTH;
  const candidate = Number.isFinite(value) ? value : fallback;
  return Math.round(Math.min(
    getDashboardNavMaxWidth(viewportWidth),
    Math.max(DASHBOARD_NAV_MIN_WIDTH, candidate),
  ));
}

export function resolveDashboardTheme(
  mode: DashboardThemeMode,
  systemPrefersDark: boolean,
): ResolvedDashboardTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}
