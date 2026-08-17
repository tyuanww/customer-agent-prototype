import {
  type DashboardChromeMode,
  DASHBOARD_MACOS_COLLAPSED_SURFACE_WIDTH,
  DASHBOARD_MACOS_CONTROL_ISLAND_RIGHT,
  DASHBOARD_MACOS_ICON_ANCHOR_OFFSET,
  DASHBOARD_NATIVE_COLLAPSED_SURFACE_WIDTH,
  DASHBOARD_NATIVE_ICON_ANCHOR_OFFSET,
  dashboardCollapsedSurfaceWidth,
  dashboardNavIconAnchorOffset,
} from '@shared/dashboard-window';

export {
  DASHBOARD_MACOS_COLLAPSED_SURFACE_WIDTH,
  DASHBOARD_MACOS_CONTROL_ISLAND_RIGHT,
  DASHBOARD_MACOS_ICON_ANCHOR_OFFSET,
  DASHBOARD_NATIVE_COLLAPSED_SURFACE_WIDTH,
  DASHBOARD_NATIVE_ICON_ANCHOR_OFFSET,
  dashboardCollapsedSurfaceWidth,
  dashboardNavIconAnchorOffset,
};
export type { DashboardChromeMode };

export const DASHBOARD_NAV_NATIVE_COLLAPSED_WIDTH = DASHBOARD_NATIVE_COLLAPSED_SURFACE_WIDTH;
export const DASHBOARD_NAV_INTEGRATED_COLLAPSED_WIDTH = DASHBOARD_MACOS_COLLAPSED_SURFACE_WIDTH;
/** Native collapsed surface only. macOS integrated must use collapsedSurfaceWidth('integrated'). */
export const DASHBOARD_NAV_COLLAPSED_WIDTH = DASHBOARD_NAV_NATIVE_COLLAPSED_WIDTH;
export const DASHBOARD_NAV_MIN_WIDTH = 216;
export const DASHBOARD_NAV_DEFAULT_WIDTH = 248;
export const DASHBOARD_NAV_MAX_WIDTH = 360;
export const DASHBOARD_NAV_RESIZE_STEP = 8;
export const DASHBOARD_NAV_STRUCTURE_MS = 190;
export const DASHBOARD_NAV_AUTO_COLLAPSE_WIDTH = 192;
export const DASHBOARD_NAV_RESIZE_HYSTERESIS = 16;
export const DASHBOARD_NAV_AUTO_EXPAND_WIDTH =
  DASHBOARD_NAV_AUTO_COLLAPSE_WIDTH + DASHBOARD_NAV_RESIZE_HYSTERESIS;
export const DASHBOARD_STRUCTURE_BOUNDARY_VAR = '--dash-structure-boundary';
export const DASHBOARD_RENDERED_NAV_WIDTH_VAR = '--dash-rendered-nav-width';
export const DASHBOARD_NAV_PREVIEW_WIDTH_VAR = '--dash-nav-preview-width';
export const DASHBOARD_LABEL_REVEAL_MS = 110;

export type DashboardNavPhase = 'expanded' | 'collapsing' | 'collapsed' | 'expanding';
export type DashboardThemeMode = 'system' | 'light' | 'dark';
export type ResolvedDashboardTheme = 'light' | 'dark';

export const DASHBOARD_NAV_PHASES = [
  'expanded',
  'collapsing',
  'collapsed',
  'expanding',
] as const satisfies ReadonlyArray<DashboardNavPhase>;

export const DASHBOARD_THEME_OPTIONS = [
  { mode: 'light', label: '浅色' },
  { mode: 'dark', label: '深色' },
  { mode: 'system', label: '跟随系统' },
] as const satisfies ReadonlyArray<{ mode: DashboardThemeMode; label: string }>;

export const DASHBOARD_TOPBAR_BOUNDARY = '无后端 · 不保存';

export const DASHBOARD_GLASS_SELECTORS = [
  '.dashboard-nav',
  '.dashboard-nav-tooltip',
  '.dashboard-theme-popover',
] as const;

export type DashboardNavResizeOrigin = 'expanded' | 'collapsed';
export type DashboardNavResizeIntent = 'preview' | 'auto-collapse' | 'auto-expand';

export type DashboardRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function rectsIntersect(a: DashboardRect, b: DashboardRect): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

export function rectContainsRect(outer: DashboardRect, inner: DashboardRect): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function collapsedTopbarDragInset(
  islandRight = DASHBOARD_MACOS_CONTROL_ISLAND_RIGHT,
  collapsedSurface = DASHBOARD_NAV_INTEGRATED_COLLAPSED_WIDTH,
): number {
  return Math.max(0, islandRight - collapsedSurface);
}

export const DASHBOARD_THEME_TOKENS = {
  light: {
    ink: '#24212a',
    selected: 'rgba(111, 76, 195, 0.10)',
    hover: 'rgba(36, 33, 42, 0.055)',
    disabledBg: '#f5f3f6',
    disabledInk: '#958e9f',
  },
  dark: {
    ink: '#f5f3f7',
    selected: 'rgba(167, 139, 250, 0.16)',
    hover: 'rgba(255, 255, 255, 0.065)',
    disabledBg: '#27242a',
    disabledInk: '#817a87',
  },
} as const;

const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function isDashboardTabbable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.tabIndex < 0) return false;
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style && (style.visibility === 'hidden' || style.display === 'none')) return false;
  return true;
}

export function listDashboardTabbables(
  root: ParentNode,
  exclude?: Element | null,
): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)].filter((element) => (
    isDashboardTabbable(element) && !exclude?.contains(element)
  ));
}

export function focusAdjacentTabbable(
  from: HTMLElement,
  direction: 'forward' | 'backward',
  exclude?: Element | null,
): HTMLElement | null {
  const list = listDashboardTabbables(from.ownerDocument, exclude);
  const index = list.indexOf(from);
  if (index < 0) return null;
  const next = direction === 'forward' ? list[index + 1] ?? null : list[index - 1] ?? null;
  next?.focus({ preventScroll: true });
  return next;
}

export function isDashboardNavRailPhase(phase: DashboardNavPhase): boolean {
  return phase === 'collapsed' || phase === 'collapsing';
}

export function isDashboardNavStablePhase(phase: DashboardNavPhase): boolean {
  return phase === 'expanded' || phase === 'collapsed';
}

export function settleDashboardNavPhase(phase: DashboardNavPhase): DashboardNavPhase {
  if (phase === 'collapsing') return 'collapsed';
  if (phase === 'expanding') return 'expanded';
  return phase;
}

export function dashboardNavPhaseTargetWidth(
  phase: DashboardNavPhase,
  expandedWidth: number,
  collapsedWidth = DASHBOARD_NAV_NATIVE_COLLAPSED_WIDTH,
): number {
  return isDashboardNavRailPhase(phase) ? collapsedWidth : expandedWidth;
}

export function readDashboardStructureWidth(root: Element | null): number | null {
  if (!root) return null;
  const nav = root.querySelector('.dashboard-nav');
  if (nav) {
    const width = nav.getBoundingClientRect().width;
    if (Number.isFinite(width) && width > 0) return width;
  }
  const style = root.ownerDocument.defaultView?.getComputedStyle(root);
  if (!style) return null;
  const fromGrid = Number.parseFloat(style.gridTemplateColumns);
  if (Number.isFinite(fromGrid) && fromGrid > 0) return fromGrid;
  return null;
}

export function shouldSettleDashboardNavTransition(input: {
  eventType: string;
  phase: DashboardNavPhase;
  actualWidth: number | null;
  expandedWidth: number;
  collapsedWidth?: number;
  reducedMotion?: boolean;
}): boolean {
  if (input.reducedMotion) return true;
  if (input.eventType === 'transitionend') return true;
  if (input.eventType !== 'transitioncancel') return false;
  if (input.actualWidth == null || !Number.isFinite(input.actualWidth)) return false;
  return Math.abs(
    input.actualWidth - dashboardNavPhaseTargetWidth(
      input.phase,
      input.expandedWidth,
      input.collapsedWidth ?? DASHBOARD_NAV_NATIVE_COLLAPSED_WIDTH,
    ),
  ) <= 1;
}

export function startDashboardNavPhase(
  phase: DashboardNavPhase,
  collapse: boolean,
): DashboardNavPhase {
  if (collapse) {
    return phase === 'collapsed' || phase === 'collapsing' ? phase : 'collapsing';
  }
  return phase === 'expanded' || phase === 'expanding' ? phase : 'expanding';
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isDashboardNavStructureTransition(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
  propertyName: string,
): boolean {
  return target === currentTarget && propertyName === 'grid-template-columns';
}

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

export function shouldAutoCollapseNavWidth(rawWidth: number): boolean {
  return Number.isFinite(rawWidth) && rawWidth <= DASHBOARD_NAV_AUTO_COLLAPSE_WIDTH;
}

export function shouldAutoExpandNavWidth(rawWidth: number): boolean {
  return Number.isFinite(rawWidth) && rawWidth >= DASHBOARD_NAV_AUTO_EXPAND_WIDTH;
}

export function resolveDashboardNavResizeIntent(
  origin: DashboardNavResizeOrigin,
  rawWidth: number,
): DashboardNavResizeIntent {
  if (origin === 'expanded' && shouldAutoCollapseNavWidth(rawWidth)) return 'auto-collapse';
  if (origin === 'collapsed' && shouldAutoExpandNavWidth(rawWidth)) return 'auto-expand';
  return 'preview';
}

export function clampDashboardNavPreviewWidth(
  value: number,
  viewportWidth: number,
  collapsedWidth = DASHBOARD_NAV_NATIVE_COLLAPSED_WIDTH,
): number {
  const floor = Number.isFinite(collapsedWidth)
    ? collapsedWidth
    : DASHBOARD_NAV_NATIVE_COLLAPSED_WIDTH;
  const candidate = Number.isFinite(value) ? value : floor;
  return Math.round(Math.min(
    getDashboardNavMaxWidth(viewportWidth),
    Math.max(floor, candidate),
  ));
}

export function dashboardStructureBoundaryPx(input: {
  phase: DashboardNavPhase;
  expandedWidth: number;
  collapsedWidth?: number;
  previewWidth?: number | null;
  resizing?: boolean;
}): number {
  const preview = input.previewWidth;
  if (input.resizing && preview != null && Number.isFinite(preview)) {
    return preview;
  }
  if (isDashboardNavRailPhase(input.phase)) {
    return input.collapsedWidth ?? DASHBOARD_NAV_NATIVE_COLLAPSED_WIDTH;
  }
  return input.expandedWidth;
}

export function renderedDashboardNavWidth(input: {
  phase: DashboardNavPhase;
  expandedWidth: number;
  collapsedWidth: number;
  previewWidth?: number | null;
  resizing?: boolean;
}): number {
  return dashboardStructureBoundaryPx(input);
}

export function resolveDashboardSeparatorAria(input: {
  phase: DashboardNavPhase;
  visualWidth: number;
  collapsedWidth: number;
  maxWidth: number;
  expandedMin?: number;
}): { valuemin: number; valuemax: number; valuenow: number } {
  const expandedMin = input.expandedMin ?? DASHBOARD_NAV_MIN_WIDTH;
  const valuemin = isDashboardNavRailPhase(input.phase) ? input.collapsedWidth : expandedMin;
  const valuemax = input.maxWidth;
  const visual = Number.isFinite(input.visualWidth) ? input.visualWidth : valuemin;
  const valuenow = Math.round(Math.min(valuemax, Math.max(valuemin, visual)));
  return { valuemin, valuemax, valuenow };
}

export function visualDividerXFromPseudo(input: {
  navRight: number;
  afterRightPx: number;
  afterWidthPx: number;
}): number {
  return input.navRight - input.afterRightPx - (input.afterWidthPx / 2);
}

export function parseCssColorAlpha(color: string): number {
  const normalized = color.trim().toLowerCase();
  if (!normalized || normalized === 'transparent') return 0;
  const match = normalized.match(/rgba?\(([^)]+)\)/);
  if (!match) return 1;
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.some((part) => !Number.isFinite(part))) return 1;
  return parts.length >= 4 ? parts[3] : 1;
}

export function resolveDashboardTheme(
  mode: DashboardThemeMode,
  systemPrefersDark: boolean,
): ResolvedDashboardTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}
