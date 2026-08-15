import {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import {
  DASHBOARD_DEFERRED_NAV,
  DASHBOARD_MANIFEST,
  DASHBOARD_NAV,
  isDashboardModuleId,
  type DashboardModuleId,
} from './data/dashboard-manifest';
import { AnnounceModule } from './features/dashboard/AnnounceModule';
import { ArchitectureModule } from './features/dashboard/ArchitectureModule';
import { FoxHead } from './components/FoxHead';
import { ContentModule } from './features/dashboard/ContentModule';
import { IterationModule } from './features/dashboard/IterationModule';
import { LedgerModule } from './features/dashboard/LedgerModule';
import { OverviewModule } from './features/dashboard/OverviewModule';
import { ReviewModule } from './features/dashboard/ReviewModule';
import { WorkorderModule } from './features/dashboard/WorkorderModule';
import { WordingLibraryModule } from './features/dashboard/WordingLibraryModule';
import {
  clampDashboardNavWidth,
  DASHBOARD_NAV_DEFAULT_WIDTH,
  DASHBOARD_NAV_MIN_WIDTH,
  DASHBOARD_NAV_RESIZE_STEP,
  DASHBOARD_THEME_OPTIONS,
  getDashboardNavMaxWidth,
  resolveDashboardTheme,
  type DashboardThemeMode,
} from './lib/dashboard-appearance';
import './styles/dashboard.css';

const MODULES: Record<DashboardModuleId, () => ReactElement> = {
  overview: () => <OverviewModule />,
  ledger: LedgerModule,
  workorders: WorkorderModule,
  review: ReviewModule,
  wording: WordingLibraryModule,
  iteration: IterationModule,
  content: ContentModule,
  announce: AnnounceModule,
  architecture: ArchitectureModule,
};

type DashboardNavIconId = DashboardModuleId | 'workorder-trash';

const NAV_ICON_PATHS: Record<DashboardNavIconId, readonly string[]> = {
  overview: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  workorders: ['M6 3h9l3 3v15H6z', 'M9 11h6', 'M9 15h6'],
  ledger: ['M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14', 'm16 16 4 4'],
  review: ['M5 4h14v16H5z', 'm8 10 2 2 5-5', 'M8 16h8'],
  wording: ['M4 5c3-1 6 0 8 2v13c-2-2-5-3-8-2z', 'M20 5c-3-1-6 0-8 2v13c2-2 5-3 8-2z'],
  iteration: ['M20 7v5h-5', 'M4 17v-5h5', 'M18.5 9A7 7 0 0 0 6 7', 'M5.5 15A7 7 0 0 0 18 17'],
  content: ['M12 3v12', 'm8 7 4-4 4 4', 'M5 14v6h14v-6'],
  announce: ['M6 17h12l-2-3v-4a4 4 0 0 0-8 0v4z', 'M10 20h4'],
  architecture: ['M12 4v5', 'M5 20v-5h14v5', 'M5 15h14', 'm12 9-7 6', 'm12-6 7 6'],
  'workorder-trash': ['M4 7h16', 'M9 7V4h6v3', 'M7 7l1 14h8l1-14'],
};

function DashboardNavIcon({ id }: { id: DashboardNavIconId }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {NAV_ICON_PATHS[id].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

type DashboardChromeIconId = 'panel-close' | 'panel-open' | 'light' | 'dark' | 'system';

const CHROME_ICON_PATHS: Record<DashboardChromeIconId, readonly string[]> = {
  'panel-close': ['M4 4.5h16v15H4z', 'M9 4.5v15', 'm16 9-3 3 3 3'],
  'panel-open': ['M4 4.5h16v15H4z', 'M9 4.5v15', 'm13 9 3 3-3 3'],
  light: ['M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2', 'm5.6-5.4-1.4-1.4', 'm11.6 11.6-1.4-1.4', 'm0-9.2 1.4-1.4', 'm-11.6 11.6 1.4-1.4', 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
  dark: ['M20 15.2A8 8 0 0 1 8.8 4 8.2 8.2 0 1 0 20 15.2'],
  system: ['M4 5h16v11H4z', 'M9 20h6', 'M12 16v4'],
};

function DashboardChromeIcon({ id }: { id: DashboardChromeIconId }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {CHROME_ICON_PATHS[id].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

type NavTooltipState = {
  key: string;
  label: string;
  left: number;
  top: number;
  visible: boolean;
};

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function DashboardApp() {
  const [active, setActive] = useState<DashboardModuleId>('overview');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [navWidth, setNavWidth] = useState(DASHBOARD_NAV_DEFAULT_WIDTH);
  const [navResizing, setNavResizing] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [themeMode, setThemeMode] = useState<DashboardThemeMode>('system');
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [navTooltip, setNavTooltip] = useState<NavTooltipState | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const navResizeHandleRef = useRef<HTMLDivElement | null>(null);
  const navWidthRef = useRef(DASHBOARD_NAV_DEFAULT_WIDTH);
  const navResizePointerRef = useRef<number | null>(null);
  const navResizeFrameRef = useRef<number | null>(null);
  const pendingNavWidthRef = useRef<number | null>(null);
  const tooltipOpenTimerRef = useRef<number | null>(null);
  const tooltipCloseTimerRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const ActiveModule = MODULES[active];
  const navMaxWidth = getDashboardNavMaxWidth(viewportWidth);
  const resolvedTheme = resolveDashboardTheme(themeMode, systemDark);
  const activeItem = useMemo(
    () => DASHBOARD_NAV.find((item) => item.id === active) ?? DASHBOARD_NAV[0],
    [active],
  );

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [active]);

  useEffect(() => {
    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    if (!media) return undefined;

    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.dataset.dashboardThemeMode = themeMode;
    html.dataset.dashboardTheme = resolvedTheme;
    html.style.colorScheme = resolvedTheme;
    return () => {
      delete html.dataset.dashboardThemeMode;
      delete html.dataset.dashboardTheme;
      html.style.removeProperty('color-scheme');
    };
  }, [resolvedTheme, themeMode]);

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  const applyNavWidth = useCallback((value: number, commit: boolean) => {
    const next = clampDashboardNavWidth(value, viewportWidth);
    navWidthRef.current = next;
    shellRef.current?.style.setProperty('--dashboard-nav-width', `${next}px`);
    navResizeHandleRef.current?.setAttribute('aria-valuenow', String(next));
    navResizeHandleRef.current?.setAttribute('aria-valuetext', `${next} 像素`);
    if (commit) setNavWidth(next);
    return next;
  }, [viewportWidth]);

  useEffect(() => {
    const clamped = clampDashboardNavWidth(navWidthRef.current, viewportWidth);
    if (clamped !== navWidthRef.current) applyNavWidth(clamped, true);
  }, [applyNavWidth, viewportWidth]);

  const cancelResizeFrame = useCallback(() => {
    if (navResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(navResizeFrameRef.current);
      navResizeFrameRef.current = null;
    }
  }, []);

  const finishNavResize = useCallback(() => {
    cancelResizeFrame();
    if (pendingNavWidthRef.current !== null) {
      applyNavWidth(pendingNavWidthRef.current, false);
      pendingNavWidthRef.current = null;
    }
    const pointerId = navResizePointerRef.current;
    const handle = navResizeHandleRef.current;
    navResizePointerRef.current = null;
    if (pointerId !== null && handle?.hasPointerCapture?.(pointerId)) {
      handle.releasePointerCapture?.(pointerId);
    }
    setNavWidth(navWidthRef.current);
    setNavResizing(false);
  }, [applyNavWidth, cancelResizeFrame]);

  useEffect(() => {
    if (!navResizing) return undefined;
    window.addEventListener('blur', finishNavResize);
    return () => window.removeEventListener('blur', finishNavResize);
  }, [finishNavResize, navResizing]);

  useEffect(() => () => {
    cancelResizeFrame();
    if (tooltipOpenTimerRef.current !== null) window.clearTimeout(tooltipOpenTimerRef.current);
    if (tooltipCloseTimerRef.current !== null) window.clearTimeout(tooltipCloseTimerRef.current);
  }, [cancelResizeFrame]);

  const hideNavTooltip = useCallback((immediate = false) => {
    if (tooltipOpenTimerRef.current !== null) {
      window.clearTimeout(tooltipOpenTimerRef.current);
      tooltipOpenTimerRef.current = null;
    }
    if (tooltipCloseTimerRef.current !== null) {
      window.clearTimeout(tooltipCloseTimerRef.current);
      tooltipCloseTimerRef.current = null;
    }
    if (immediate) {
      setNavTooltip(null);
      return;
    }
    setNavTooltip((current) => current ? { ...current, visible: false } : null);
    tooltipCloseTimerRef.current = window.setTimeout(() => {
      setNavTooltip(null);
      tooltipCloseTimerRef.current = null;
    }, 140);
  }, []);

  const showNavTooltip = useCallback((
    target: HTMLElement,
    key: string,
    label: string,
    immediate: boolean,
  ) => {
    if (!navCollapsed) return;
    hideNavTooltip(true);
    const open = () => {
      const rect = target.getBoundingClientRect();
      setNavTooltip({
        key,
        label,
        left: rect.right + 10,
        top: rect.top + (rect.height / 2),
        visible: true,
      });
      tooltipOpenTimerRef.current = null;
    };
    if (immediate) {
      open();
      return;
    }
    tooltipOpenTimerRef.current = window.setTimeout(open, 320);
  }, [hideNavTooltip, navCollapsed]);

  useEffect(() => {
    if (!navCollapsed) hideNavTooltip(true);
  }, [hideNavTooltip, navCollapsed]);

  const toggleNavigation = () => {
    finishNavResize();
    hideNavTooltip(true);
    setNavCollapsed((collapsed) => !collapsed);
  };

  const scheduleNavResize = (value: number) => {
    pendingNavWidthRef.current = value;
    if (navResizeFrameRef.current !== null) return;
    navResizeFrameRef.current = window.requestAnimationFrame(() => {
      navResizeFrameRef.current = null;
      if (pendingNavWidthRef.current === null) return;
      applyNavWidth(pendingNavWidthRef.current, false);
      pendingNavWidthRef.current = null;
    });
  };

  const navWidthFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const shellLeft = shellRef.current?.getBoundingClientRect().left ?? 0;
    return event.clientX - shellLeft;
  };

  const startNavResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || navCollapsed) return;
    event.preventDefault();
    navResizePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setNavResizing(true);
  };

  const moveNavResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (navResizePointerRef.current !== event.pointerId) return;
    if (event.buttons === 0) {
      finishNavResize();
      return;
    }
    scheduleNavResize(navWidthFromPointer(event));
  };

  const endNavResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (navResizePointerRef.current !== event.pointerId) return;
    if (event.type === 'pointerup') {
      cancelResizeFrame();
      pendingNavWidthRef.current = null;
      applyNavWidth(navWidthFromPointer(event), false);
    }
    finishNavResize();
  };

  const handleNavResizeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? DASHBOARD_NAV_RESIZE_STEP * 3 : DASHBOARD_NAV_RESIZE_STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = navWidthRef.current - step;
    if (event.key === 'ArrowRight') next = navWidthRef.current + step;
    if (event.key === 'Home') next = DASHBOARD_NAV_MIN_WIDTH;
    if (event.key === 'End') next = navMaxWidth;
    if (event.key === 'Enter') {
      event.preventDefault();
      toggleNavigation();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    applyNavWidth(next, true);
  };

  const move = (delta: number) => {
    const index = DASHBOARD_NAV.findIndex((item) => item.id === active);
    const next = DASHBOARD_NAV[(index + delta + DASHBOARD_NAV.length) % DASHBOARD_NAV.length];
    setActive(next.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`dash-nav-${next.id}`)?.focus();
    });
  };

  const focusModule = (moduleId: DashboardModuleId) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`dash-nav-${moduleId}`)?.focus();
    });
  };

  let lastGroup: string | null = null;

  return (
    <div
      ref={shellRef}
      className={`dashboard-shell${navCollapsed ? ' is-nav-collapsed' : ''}`}
      data-testid="dashboard-shell"
      data-window-role="dashboard"
      data-nav-collapsed={navCollapsed}
      data-nav-resizing={navResizing}
      data-nav-width={navWidth}
      data-theme-mode={themeMode}
      data-theme={resolvedTheme}
      style={{ '--dashboard-nav-width': `${navWidth}px` } as CSSProperties}
    >
      <aside id="dashboard-sidebar" className="dashboard-nav" aria-label="工作台模块">
        <div className="dashboard-brand" data-testid="dashboard-brand">
          <div className="dashboard-brand-logo" data-testid="dashboard-brand-logo" aria-hidden="true">
            <FoxHead size={38} className="dashboard-brand-fox" />
          </div>
          <div className="dashboard-brand-copy">
            <strong>客服运营工作台</strong>
            <span className="dashboard-brand-subtitle">运营管理端</span>
          </div>
          <button
            type="button"
            className={`dashboard-nav-toggle ${navCollapsed ? 'is-expand-overlay' : 'is-collapse'}`}
            aria-controls="dashboard-primary-navigation"
            aria-expanded={!navCollapsed}
            aria-label={navCollapsed ? '展开工作台导航' : '折叠工作台导航'}
            title={navCollapsed ? '展开导航' : '折叠导航'}
            data-variant={navCollapsed ? 'expand-overlay' : 'collapse'}
            data-testid="dashboard-nav-toggle"
            onClick={(event) => {
              if (event.detail > 0) {
                event.currentTarget.blur();
              }
              toggleNavigation();
            }}
          >
            <span
              className="dashboard-nav-toggle-icon"
              data-testid="dashboard-nav-toggle-glyph"
              aria-hidden="true"
            >
              <span className="dashboard-nav-toggle-icon__state is-close">
                <DashboardChromeIcon id="panel-close" />
              </span>
              <span className="dashboard-nav-toggle-icon__state is-open">
                <DashboardChromeIcon id="panel-open" />
              </span>
            </span>
          </button>
        </div>
        <div
          id="dashboard-primary-navigation"
          className="dashboard-nav-list"
          role="tablist"
          aria-label="工作台功能"
          aria-orientation="vertical"
        >
          {DASHBOARD_NAV.map((item) => {
            const selected = item.id === active;
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div className="dashboard-nav-item" key={item.id}>
                {showGroup ? <p className="dashboard-nav-group">{item.group}</p> : null}
                <button
                  id={`dash-nav-${item.id}`}
                  type="button"
                  role="tab"
                  aria-controls="dashboard-module-panel"
                  data-nav-group={item.group}
                  tabIndex={selected ? 0 : -1}
                  className={selected ? 'is-active' : ''}
                  aria-selected={selected}
                  aria-current={selected ? 'page' : undefined}
                  aria-label={item.label}
                  aria-describedby={navTooltip?.key === item.id && navTooltip.visible
                    ? 'dashboard-nav-tooltip'
                    : undefined}
                  data-testid={`nav-${item.id}`}
                  onClick={() => {
                    hideNavTooltip(true);
                    setActive(item.id);
                  }}
                  onMouseEnter={(event) => showNavTooltip(
                    event.currentTarget,
                    item.id,
                    item.label,
                    false,
                  )}
                  onMouseLeave={() => hideNavTooltip()}
                  onFocus={(event) => showNavTooltip(
                    event.currentTarget,
                    item.id,
                    item.label,
                    true,
                  )}
                  onBlur={() => hideNavTooltip()}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      hideNavTooltip(true);
                      return;
                    }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      move(1);
                    }
                    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                      event.preventDefault();
                      move(-1);
                    }
                    if (event.key === 'Home') {
                      event.preventDefault();
                      const first = DASHBOARD_NAV[0].id;
                      setActive(first);
                      focusModule(first);
                    }
                    if (event.key === 'End') {
                      event.preventDefault();
                      const last = DASHBOARD_NAV[DASHBOARD_NAV.length - 1].id;
                      setActive(last);
                      focusModule(last);
                    }
                  }}
                >
                  <span className="dashboard-nav-icon"><DashboardNavIcon id={item.id} /></span>
                  <span className="dashboard-nav-label">{item.label}</span>
                </button>
                {item.id === 'workorders' ? DASHBOARD_DEFERRED_NAV.map((deferred) => (
                  <button
                    key={deferred.id}
                    type="button"
                    tabIndex={-1}
                    disabled
                    aria-disabled="true"
                    aria-label={`${deferred.label}，${deferred.statusLabel}`}
                    aria-describedby={navTooltip?.key === deferred.id && navTooltip.visible
                      ? 'dashboard-nav-tooltip'
                      : undefined}
                    title={`${deferred.label} · ${deferred.statusLabel}`}
                    className="is-deferred"
                    data-testid={`nav-${deferred.id}`}
                    onMouseEnter={(event) => showNavTooltip(
                      event.currentTarget,
                      deferred.id,
                      `${deferred.label} · ${deferred.statusLabel}`,
                      false,
                    )}
                    onMouseLeave={() => hideNavTooltip()}
                  >
                    <span className="dashboard-nav-icon"><DashboardNavIcon id={deferred.id} /></span>
                    <span className="dashboard-nav-label">{deferred.label}</span>
                    <small>{deferred.statusLabel}</small>
                  </button>
                )) : null}
              </div>
            );
          })}
        </div>
        <details className="dashboard-nav-boundary" data-testid="dashboard-boundary-details">
          <summary>演示环境</summary>
          <dl>
            <div><dt>权限</dt><dd>MOCK AUTH</dd></div>
            <div><dt>数据</dt><dd>SYNTHETIC DATA</dd></div>
            <div><dt>服务</dt><dd>NO BACKEND</dd></div>
            <div><dt>存储</dt><dd>不保存</dd></div>
          </dl>
        </details>
        <div
          ref={navResizeHandleRef}
          className="dashboard-nav-resizer"
          role="separator"
          aria-label="调整工作台侧栏宽度"
          aria-controls="dashboard-sidebar"
          aria-orientation="vertical"
          aria-valuemin={DASHBOARD_NAV_MIN_WIDTH}
          aria-valuemax={navMaxWidth}
          aria-valuenow={navWidth}
          aria-valuetext={`${navWidth} 像素`}
          tabIndex={navCollapsed ? -1 : 0}
          hidden={navCollapsed}
          data-testid="dashboard-nav-resizer"
          onPointerDown={startNavResize}
          onPointerMove={moveNavResize}
          onPointerUp={endNavResize}
          onPointerCancel={endNavResize}
          onLostPointerCapture={finishNavResize}
          onDoubleClick={() => applyNavWidth(DASHBOARD_NAV_DEFAULT_WIDTH, true)}
          onKeyDown={handleNavResizeKey}
        />
      </aside>

      {navTooltip ? (
        <div
          id="dashboard-nav-tooltip"
          role="tooltip"
          className={`dashboard-nav-tooltip${navTooltip.visible ? ' is-visible' : ''}`}
          style={{ left: navTooltip.left, top: navTooltip.top }}
          data-testid="dashboard-nav-tooltip"
        >
          {navTooltip.label}
        </div>
      ) : null}

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="dashboard-page-context">
            <p className="dashboard-eyebrow">{activeItem.group}</p>
            <strong>{activeItem.label}</strong>
            <p className="dashboard-refresh" data-testid="dashboard-refresh">
              {DASHBOARD_MANIFEST.banners.refreshLabel}
            </p>
          </div>
          <div className="dashboard-topbar-actions">
            <div
              className="dashboard-theme-switcher"
              role="group"
              aria-label="工作台外观"
              data-testid="dashboard-theme-switcher"
            >
              {DASHBOARD_THEME_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  className={themeMode === option.mode ? 'is-active' : ''}
                  aria-pressed={themeMode === option.mode}
                  aria-label={`${option.label}模式`}
                  title={option.label}
                  data-testid={`dashboard-theme-${option.mode}`}
                  onClick={() => setThemeMode(option.mode)}
                >
                  <DashboardChromeIcon id={option.mode} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <div className="dashboard-banners" aria-label="数据环境与边界">
              <div className="env-badges" role="list" data-testid="dashboard-env-badges">
                {DASHBOARD_MANIFEST.banners.env.map((badge) => (
                  <span key={badge} className="env-badge" role="listitem">
                    {badge}
                  </span>
                ))}
              </div>
              <p className="dashboard-disclaimer" data-testid="dashboard-disclaimer">
                {DASHBOARD_MANIFEST.banners.disclaimer}
              </p>
            </div>
          </div>
        </header>
        <main
          id="dashboard-module-panel"
          ref={contentRef}
          className="dashboard-content"
          role="tabpanel"
          aria-labelledby={`dash-nav-${active}`}
          data-testid="dashboard-content"
          data-active-module={active}
        >
          {active === 'overview' ? <OverviewModule onNavigate={setActive} /> : <ActiveModule />}
        </main>
      </div>
    </div>
  );
}

export function selectDashboardModule(value: string): DashboardModuleId {
  return isDashboardModuleId(value) ? value : 'overview';
}
