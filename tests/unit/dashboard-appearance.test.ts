import { describe, expect, it } from 'vitest';
import {
  clampDashboardNavPreviewWidth,
  clampDashboardNavWidth,
  collapsedTopbarDragInset,
  dashboardCollapsedSurfaceWidth,
  dashboardNavIconAnchorOffset,
  dashboardStructureBoundaryPx,
  DASHBOARD_GLASS_SELECTORS,
  DASHBOARD_MACOS_COLLAPSED_SURFACE_WIDTH,
  DASHBOARD_MACOS_ICON_ANCHOR_OFFSET,
  DASHBOARD_NATIVE_COLLAPSED_SURFACE_WIDTH,
  DASHBOARD_NATIVE_ICON_ANCHOR_OFFSET,
  DASHBOARD_NAV_AUTO_EXPAND_WIDTH,
  DASHBOARD_NAV_COLLAPSED_WIDTH,
  DASHBOARD_NAV_DEFAULT_WIDTH,
  DASHBOARD_NAV_INTEGRATED_COLLAPSED_WIDTH,
  DASHBOARD_NAV_MAX_WIDTH,
  DASHBOARD_NAV_MIN_WIDTH,
  DASHBOARD_NAV_NATIVE_COLLAPSED_WIDTH,
  DASHBOARD_NAV_PHASES,
  DASHBOARD_NAV_RESIZE_HYSTERESIS,
  DASHBOARD_NAV_RESIZE_STEP,
  DASHBOARD_NAV_STRUCTURE_MS,
  DASHBOARD_NAV_AUTO_COLLAPSE_WIDTH,
  DASHBOARD_RENDERED_NAV_WIDTH_VAR,
  DASHBOARD_STRUCTURE_BOUNDARY_VAR,
  resolveDashboardNavResizeIntent,
  resolveDashboardSeparatorAria,
  visualDividerXFromPseudo,
  parseCssColorAlpha,
  shouldAutoCollapseNavWidth,
  shouldAutoExpandNavWidth,
  DASHBOARD_THEME_OPTIONS,
  DASHBOARD_THEME_TOKENS,
  DASHBOARD_TOPBAR_BOUNDARY,
  dashboardNavPhaseTargetWidth,
  focusAdjacentTabbable,
  getDashboardNavMaxWidth,
  isDashboardNavRailPhase,
  isDashboardNavStablePhase,
  isDashboardNavStructureTransition,
  listDashboardTabbables,
  readDashboardStructureWidth,
  rectContainsRect,
  rectsIntersect,
  dashboardNavTooltipPosition,
  resolveDashboardTheme,
  settleDashboardNavPhase,
  systemPrefersDark,
  shouldSettleDashboardNavTransition,
  startDashboardNavPhase,
} from '../../src/renderer/lib/dashboard-appearance';

describe('dashboard appearance contract', () => {
  it('keeps a stable collapsed rail and clamps the adjustable expanded width', () => {
    expect(DASHBOARD_GLASS_SELECTORS).not.toContain('.dashboard-titlebar-control-island');
    expect(DASHBOARD_STRUCTURE_BOUNDARY_VAR).toBe('--dash-structure-boundary');
    expect(DASHBOARD_RENDERED_NAV_WIDTH_VAR).toBe('--dash-rendered-nav-width');
    expect(collapsedTopbarDragInset(120, 120)).toBe(0);
    expect(collapsedTopbarDragInset(120, 72)).toBe(48);
    expect(rectsIntersect(
      { x: 72, y: 4, width: 40, height: 40 },
      { x: 120, y: 0, width: 400, height: 48 },
    )).toBe(false);
    expect(rectContainsRect(
      { x: 72, y: 0, width: 48, height: 48 },
      { x: 72, y: 4, width: 40, height: 40 },
    )).toBe(true);
    expect(DASHBOARD_NAV_NATIVE_COLLAPSED_WIDTH).toBe(72);
    expect(DASHBOARD_NAV_INTEGRATED_COLLAPSED_WIDTH).toBe(120);
    expect(DASHBOARD_NAV_COLLAPSED_WIDTH).toBe(72);
    expect(DASHBOARD_MACOS_COLLAPSED_SURFACE_WIDTH).toBe(120);
    expect(DASHBOARD_NATIVE_COLLAPSED_SURFACE_WIDTH).toBe(72);
    expect(dashboardCollapsedSurfaceWidth('integrated')).toBe(120);
    expect(dashboardCollapsedSurfaceWidth('native')).toBe(72);
    expect(dashboardNavIconAnchorOffset('integrated')).toBe(60);
    expect(dashboardNavIconAnchorOffset('native')).toBe(36);
    expect(DASHBOARD_MACOS_ICON_ANCHOR_OFFSET).toBe(60);
    expect(DASHBOARD_NATIVE_ICON_ANCHOR_OFFSET).toBe(36);
    expect(DASHBOARD_NAV_MIN_WIDTH).toBe(216);
    expect(DASHBOARD_NAV_DEFAULT_WIDTH).toBe(248);
    expect(DASHBOARD_NAV_MAX_WIDTH).toBe(360);
    expect(DASHBOARD_NAV_RESIZE_STEP).toBe(8);
    expect(DASHBOARD_NAV_AUTO_COLLAPSE_WIDTH).toBe(192);
    expect(DASHBOARD_NAV_RESIZE_HYSTERESIS).toBe(16);
    expect(DASHBOARD_NAV_AUTO_EXPAND_WIDTH).toBe(208);
    expect(shouldAutoCollapseNavWidth(192)).toBe(true);
    expect(shouldAutoCollapseNavWidth(193)).toBe(false);
    expect(shouldAutoExpandNavWidth(207)).toBe(false);
    expect(shouldAutoExpandNavWidth(208)).toBe(true);
    expect(resolveDashboardNavResizeIntent('expanded', 192)).toBe('auto-collapse');
    expect(resolveDashboardNavResizeIntent('expanded', 193)).toBe('preview');
    expect(resolveDashboardNavResizeIntent('collapsed', 207)).toBe('preview');
    expect(resolveDashboardNavResizeIntent('collapsed', 208)).toBe('auto-expand');
    expect(clampDashboardNavPreviewWidth(72, 1180, 72)).toBe(72);
    expect(clampDashboardNavPreviewWidth(120, 1180, 120)).toBe(120);
    expect(clampDashboardNavPreviewWidth(100, 1180, 120)).toBe(120);
    expect(clampDashboardNavPreviewWidth(193, 1180, 120)).toBe(193);
    expect(clampDashboardNavPreviewWidth(150, 1180, 72)).toBe(150);
    expect(clampDashboardNavPreviewWidth(400, 1180, 120)).toBe(360);
    expect(dashboardStructureBoundaryPx({
      phase: 'collapsed',
      expandedWidth: 248,
      collapsedWidth: 120,
    })).toBe(120);
    expect(dashboardStructureBoundaryPx({
      phase: 'collapsed',
      expandedWidth: 248,
      collapsedWidth: 72,
    })).toBe(72);
    expect(dashboardStructureBoundaryPx({
      phase: 'expanded',
      expandedWidth: 320,
      collapsedWidth: 120,
    })).toBe(320);
    expect(dashboardStructureBoundaryPx({
      phase: 'collapsed',
      expandedWidth: 248,
      collapsedWidth: 120,
      resizing: true,
      previewWidth: 160,
    })).toBe(160);
    expect(dashboardStructureBoundaryPx({
      phase: 'expanding',
      expandedWidth: 248,
      collapsedWidth: 120,
    })).toBe(248);

    expect(getDashboardNavMaxWidth(980)).toBe(333);
    expect(getDashboardNavMaxWidth(1180)).toBe(360);
    expect(getDashboardNavMaxWidth(Number.NaN)).toBe(360);

    expect(clampDashboardNavWidth(100, 980)).toBe(216);
    expect(clampDashboardNavWidth(248, 980)).toBe(248);
    expect(clampDashboardNavWidth(900, 980)).toBe(333);
    expect(clampDashboardNavWidth(Number.NaN, 1180)).toBe(248);

    expect(resolveDashboardSeparatorAria({
      phase: 'expanded',
      visualWidth: 193,
      collapsedWidth: 120,
      maxWidth: 360,
    })).toEqual({ valuemin: 216, valuemax: 360, valuenow: 216 });
    expect(resolveDashboardSeparatorAria({
      phase: 'collapsing',
      visualWidth: 192,
      collapsedWidth: 120,
      maxWidth: 360,
    })).toEqual({ valuemin: 120, valuemax: 360, valuenow: 192 });
    expect(resolveDashboardSeparatorAria({
      phase: 'collapsed',
      visualWidth: 160,
      collapsedWidth: 120,
      maxWidth: 360,
    })).toEqual({ valuemin: 120, valuemax: 360, valuenow: 160 });
    expect(visualDividerXFromPseudo({
      navRight: 120,
      afterRightPx: 0,
      afterWidthPx: 1,
    })).toBe(119.5);
    expect(parseCssColorAlpha('rgba(37, 32, 45, 0.10)')).toBeCloseTo(0.1);
    expect(parseCssColorAlpha('transparent')).toBe(0);
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

  it('settles explicit sidebar phases from grid-template-columns transitions', () => {
    expect(DASHBOARD_NAV_PHASES).toEqual(['expanded', 'collapsing', 'collapsed', 'expanding']);
    expect(DASHBOARD_NAV_STRUCTURE_MS).toBeGreaterThanOrEqual(180);
    expect(DASHBOARD_NAV_STRUCTURE_MS).toBeLessThanOrEqual(200);
    expect(isDashboardNavRailPhase('collapsing')).toBe(true);
    expect(isDashboardNavRailPhase('collapsed')).toBe(true);
    expect(isDashboardNavRailPhase('expanded')).toBe(false);
    expect(isDashboardNavStablePhase('expanded')).toBe(true);
    expect(isDashboardNavStablePhase('collapsing')).toBe(false);
    expect(startDashboardNavPhase('expanded', true)).toBe('collapsing');
    expect(startDashboardNavPhase('collapsed', false)).toBe('expanding');
    expect(settleDashboardNavPhase('collapsing')).toBe('collapsed');
    expect(settleDashboardNavPhase('expanding')).toBe('expanded');
    expect(settleDashboardNavPhase('expanded')).toBe('expanded');
    expect(dashboardNavPhaseTargetWidth('collapsing', 248, 72)).toBe(72);
    expect(dashboardNavPhaseTargetWidth('collapsing', 248, 120)).toBe(120);
    expect(dashboardNavPhaseTargetWidth('collapsed', 320, 120)).toBe(120);
    expect(dashboardNavPhaseTargetWidth('collapsed', 320, 72)).toBe(72);
    expect(dashboardNavPhaseTargetWidth('expanding', 248, 120)).toBe(248);
    expect(dashboardNavPhaseTargetWidth('expanded', 320, 120)).toBe(320);
    expect(shouldSettleDashboardNavTransition({
      eventType: 'transitionend',
      phase: 'expanding',
      actualWidth: 160,
      expandedWidth: 248,
    })).toBe(true);
    expect(shouldSettleDashboardNavTransition({
      eventType: 'transitioncancel',
      phase: 'expanding',
      actualWidth: 160,
      expandedWidth: 248,
    })).toBe(false);
    expect(shouldSettleDashboardNavTransition({
      eventType: 'transitioncancel',
      phase: 'expanding',
      actualWidth: 248,
      expandedWidth: 248,
    })).toBe(true);
    expect(shouldSettleDashboardNavTransition({
      eventType: 'transitioncancel',
      phase: 'collapsing',
      actualWidth: 72,
      expandedWidth: 248,
      collapsedWidth: 72,
    })).toBe(true);
    expect(shouldSettleDashboardNavTransition({
      eventType: 'transitioncancel',
      phase: 'collapsing',
      actualWidth: 120,
      expandedWidth: 248,
      collapsedWidth: 120,
    })).toBe(true);
    expect(shouldSettleDashboardNavTransition({
      eventType: 'transitioncancel',
      phase: 'collapsing',
      actualWidth: 72,
      expandedWidth: 248,
      collapsedWidth: 120,
    })).toBe(false);
    expect(shouldSettleDashboardNavTransition({
      eventType: 'transitioncancel',
      phase: 'expanding',
      actualWidth: null,
      expandedWidth: 248,
    })).toBe(false);
    expect(shouldSettleDashboardNavTransition({
      eventType: 'transitioncancel',
      phase: 'expanding',
      actualWidth: 160,
      expandedWidth: 248,
      reducedMotion: true,
    })).toBe(true);
    const measured = document.createElement('div');
    measured.className = 'dashboard-shell';
    const nav = document.createElement('aside');
    nav.className = 'dashboard-nav';
    nav.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 160,
      bottom: 400,
      width: 160,
      height: 400,
      toJSON: () => ({}),
    } as DOMRect);
    measured.append(nav);
    expect(readDashboardStructureWidth(measured)).toBe(160);
    expect(readDashboardStructureWidth(null)).toBeNull();
    const shell = {} as EventTarget;
    const child = {} as EventTarget;
    expect(isDashboardNavStructureTransition(shell, shell, 'grid-template-columns')).toBe(true);
    expect(isDashboardNavStructureTransition(child, shell, 'grid-template-columns')).toBe(false);
    expect(isDashboardNavStructureTransition(shell, shell, 'opacity')).toBe(false);
    expect(DASHBOARD_TOPBAR_BOUNDARY).toBe('无后端 · 不保存');
    expect(DASHBOARD_GLASS_SELECTORS).toEqual([
      '.dashboard-nav',
      '.dashboard-nav-tooltip',
      '.dashboard-theme-popover',
    ]);
    expect(DASHBOARD_THEME_TOKENS.light.ink).toBe('#24212a');
    expect(DASHBOARD_THEME_TOKENS.dark.ink).toBe('#f5f3f7');
    expect(DASHBOARD_THEME_TOKENS.light.selected).toBe('rgba(111, 76, 195, 0.10)');
    expect(DASHBOARD_THEME_TOKENS.dark.selected).toBe('rgba(167, 139, 250, 0.16)');
  });

  it('moves focus to the adjacent tabbable without wrapping into excluded trees', () => {
    document.body.innerHTML = `
      <button id="before">before</button>
      <button id="current">current</button>
      <div id="menu"><button id="inside">inside</button></div>
      <button id="after">after</button>
    `;
    const current = document.getElementById('current');
    const menu = document.getElementById('menu');
    if (!current || !menu) throw new Error('tab fixture missing');

    expect(listDashboardTabbables(document).map((item) => item.id)).toEqual([
      'before',
      'current',
      'inside',
      'after',
    ]);
    expect(focusAdjacentTabbable(current, 'forward', menu)?.id).toBe('after');
    expect(focusAdjacentTabbable(current, 'backward', menu)?.id).toBe('before');
    document.body.innerHTML = '';
  });

  it('places collapsed nav tooltips 10px to the right of the icon row', () => {
    expect(dashboardNavTooltipPosition({ right: 112, top: 80, height: 42 })).toEqual({
      left: 122,
      top: 101,
    });
  });

  it('reads the system color scheme only through matchMedia', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    expect(systemPrefersDark()).toBe(true);
    window.matchMedia = original;
    expect(resolveDashboardTheme('system', true)).toBe('dark');
    expect(resolveDashboardTheme('system', false)).toBe('light');
  });

  it('falls back to light when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    try {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: undefined,
      });
      expect(systemPrefersDark()).toBe(false);
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: original,
      });
    }
  });
});
