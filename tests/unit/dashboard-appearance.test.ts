import { describe, expect, it } from 'vitest';
import {
  clampDashboardNavWidth,
  DASHBOARD_NAV_COLLAPSED_WIDTH,
  DASHBOARD_NAV_DEFAULT_WIDTH,
  DASHBOARD_NAV_MAX_WIDTH,
  DASHBOARD_NAV_MIN_WIDTH,
  DASHBOARD_NAV_RESIZE_STEP,
  DASHBOARD_THEME_OPTIONS,
  getDashboardNavMaxWidth,
  resolveDashboardTheme,
} from '../../src/renderer/lib/dashboard-appearance';

describe('dashboard appearance contract', () => {
  it('keeps a stable collapsed rail and clamps the adjustable expanded width', () => {
    expect(DASHBOARD_NAV_COLLAPSED_WIDTH).toBe(72);
    expect(DASHBOARD_NAV_MIN_WIDTH).toBe(216);
    expect(DASHBOARD_NAV_DEFAULT_WIDTH).toBe(248);
    expect(DASHBOARD_NAV_MAX_WIDTH).toBe(360);
    expect(DASHBOARD_NAV_RESIZE_STEP).toBe(8);

    expect(getDashboardNavMaxWidth(980)).toBe(333);
    expect(getDashboardNavMaxWidth(1180)).toBe(360);
    expect(getDashboardNavMaxWidth(Number.NaN)).toBe(360);

    expect(clampDashboardNavWidth(100, 980)).toBe(216);
    expect(clampDashboardNavWidth(248, 980)).toBe(248);
    expect(clampDashboardNavWidth(900, 980)).toBe(333);
    expect(clampDashboardNavWidth(Number.NaN, 1180)).toBe(248);
  });

  it('resolves light, dark, and system modes deterministically', () => {
    expect(DASHBOARD_THEME_OPTIONS).toEqual([
      { mode: 'light', label: '浅色' },
      { mode: 'dark', label: '深色' },
      { mode: 'system', label: '跟随系统' },
    ]);
    expect(resolveDashboardTheme('light', true)).toBe('light');
    expect(resolveDashboardTheme('dark', false)).toBe('dark');
    expect(resolveDashboardTheme('system', false)).toBe('light');
    expect(resolveDashboardTheme('system', true)).toBe('dark');
  });
});
