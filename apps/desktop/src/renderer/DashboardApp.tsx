import { Avatar, Button, Dropdown } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import {
  intakeDestinationItem,
  intakeSidebarItems,
  readIntakePreviewPage,
  renderIntakeDestinations,
  type IntakeDestination,
  type IntakeSidebarItem,
} from './features/dashboard/intake-destinations';
import { type DashboardContentRole } from '../shared/dashboard-content';
import { type SessionJobView } from '../shared/product-session';
import type { WorkbenchKind } from '../shared/workbench-mode';
import { canGrant, canUploadSop, canViewPermissions, type PageUseSnapshot } from '../shared/page-use';
import {
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { DashboardBrandFox } from './components/DashboardBrandFox';
import { DashboardChromeIcon, DashboardNavIcon, type DashboardNavIconId } from './features/dashboard/DashboardIcons';
import { DashboardThemeMenu } from './features/dashboard/DashboardThemeMenu';
import { DASHBOARD_FONT_FAMILY, IntakeAntdTheme } from './features/dashboard/intake-antd';
import {
  DASHBOARD_WINDOW_TITLE,
  dashboardChromeCssVars,
  dashboardChromeModeFor,
  inferDashboardHostPlatform,
} from '@shared/dashboard-window';
import {
  dashboardCollapsedSurfaceWidth,
  dashboardNavIconAnchorOffset,
  dashboardStructureBoundaryPx,
  DASHBOARD_NAV_DEFAULT_WIDTH,
  DASHBOARD_NAV_PREVIEW_WIDTH_VAR,
  DASHBOARD_RENDERED_NAV_WIDTH_VAR,
  DASHBOARD_STRUCTURE_BOUNDARY_VAR,
  isDashboardNavRailPhase,
  isDashboardNavStablePhase,
  isDashboardNavStructureTransition,
  prefersReducedMotion,
  readDashboardStructureWidth,
  dashboardNavTooltipPosition,
  resolveDashboardTheme,
  settleDashboardNavPhase,
  systemPrefersDark,
  shouldSettleDashboardNavTransition,
  startDashboardNavPhase,
  type DashboardNavPhase,
  type DashboardThemeMode,
} from './lib/dashboard-appearance';
import './styles/dashboard.css';
import './features/dashboard/workbench-v9.css';
import './features/dashboard/desk-chrome.css';
import './styles/radix-palette.css';
import './styles/workbench-tokens.css';
import './styles/workbench-shell.css';

function lastGroupIndex(item: IntakeSidebarItem, items: readonly IntakeSidebarItem[]): number {
  return items.findIndex((candidate) => candidate.group === item.group);
}

function sidebarIcon(id: IntakeDestination): DashboardNavIconId {
  return id;
}

function rememberPreviewPage(id: IntakeDestination) {
  const location = window.location;
  const local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  if (!local || new URLSearchParams(location.search).get('preview') !== 'intake') return;
  const url = new URL(location.href);
  url.searchParams.set('page', id);
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function nextSidebarDestination(active: IntakeDestination, delta: number, items: readonly IntakeSidebarItem[]): IntakeDestination {
  const index = items.findIndex((item) => item.id === active);
  return items[(index + delta + items.length) % items.length].id;
}

type NavTooltipState = {
  key: string;
  label: string;
  left: number;
  top: number;
  visible: boolean;
};

export function DashboardApp() {
  return <DashboardWorkspace />;
}

function usePageUse(): PageUseSnapshot {
  const [snapshot, setSnapshot] = useState<PageUseSnapshot>({ phase: 'signed-out' });
  useEffect(() => {
    const api = window.dashboardPageUse;
    if (!api) return undefined;
    let live = true;
    void api.current().then((next) => {
      if (live) setSnapshot(next);
    }).catch(() => {
      if (live) setSnapshot({ phase: 'signed-out' });
    });
    const stop = api.onChanged((next) => {
      if (live) setSnapshot(next);
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  return snapshot;
}

function DashboardWorkspace() {
  const snapshot = usePageUse();
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchKind | null>(null);
  const [workbenchStatus, setWorkbenchStatus] = useState<'pending' | 'ready' | 'error'>(() => window.dashboardWorkbench ? 'pending' : 'ready');
  const [workbenchAttempt, setWorkbenchAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    const api = window.dashboardWorkbench;
    if (!api) {
      setWorkbenchMode(null);
      setWorkbenchStatus('ready');
      return () => { alive = false; };
    }
    setWorkbenchStatus('pending');
    void Promise.resolve().then(() => api.mode()).then(reply => {
      if (!alive) return;
      if (reply.ok) {
        setWorkbenchMode(reply.kind);
        setWorkbenchStatus('ready');
      } else {
        setWorkbenchMode(null);
        setWorkbenchStatus('error');
      }
    }).catch(() => {
      if (alive) {
        setWorkbenchMode(null);
        setWorkbenchStatus('error');
      }
    });
    return () => { alive = false; };
  }, [workbenchAttempt]);
  const permissionsOpen = canViewPermissions(snapshot);
  const grantAllowed = canGrant(snapshot);
  const sopUpload = canUploadSop(snapshot);
  const [sessionJob, setSessionJob] = useState<SessionJobView | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [sessionPhase, setSessionPhase] = useState<'pending' | 'signed-out' | 'ready'>(
    () => (window.dashboardContent === undefined ? 'ready' : 'pending'),
  );
  const jobKnown = sessionPhase === 'ready';
  const [contentSignedIn, setContentSignedIn] = useState<boolean | null>(null);
  const [contentRole, setContentRole] = useState<DashboardContentRole | null>(null);
  const sessionEpoch = useRef(0);
  const sessionConfirmed = useRef(false);
  const seatLibraryOnly = sessionJob?.status === 'resolved' && sessionJob.role === 'agent';
  const sessionKey = !jobKnown || contentSignedIn !== true
    ? 'signed-out'
    : `${contentRole ?? 'none'}:${sessionJob?.status === 'resolved' ? sessionJob.title : sessionJob?.status ?? 'missing'}`;
  const navItems = intakeSidebarItems(permissionsOpen, seatLibraryOnly, jobKnown && contentSignedIn !== false);
  const [active, setActive] = useState<IntakeDestination>(() => readIntakePreviewPage(window.location, permissionsOpen));
  const activeNav = active === 'content' ? 'wording' : active;
  const [backStack, setBackStack] = useState<IntakeDestination[]>([]);
  const [todoCount, setTodoCount] = useState<number | null>(null);
  const [scriptDraft, setScriptDraft] = useState<string | null>(null);
  const [navPhase, setNavPhase] = useState<DashboardNavPhase>('expanded');
  const navWidth = DASHBOARD_NAV_DEFAULT_WIDTH;
  const [themeMode, setThemeMode] = useState<DashboardThemeMode>('system');
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [navTooltip, setNavTooltip] = useState<NavTooltipState | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const navToggleRef = useRef<HTMLButtonElement | null>(null);
  const pendingNavFocusRef = useRef(false);
  const navSettlingPreviewRef = useRef(false);
  const navPendingSettleTargetRef = useRef<number | null>(null);
  const navPendingPhaseRef = useRef<DashboardNavPhase | null>(null);
  const navSettleEpochRef = useRef(0);
  const navSettleRafRef = useRef<number | null>(null);
  const navPhaseRef = useRef<DashboardNavPhase>('expanded');
  const navPreviewWidthRef = useRef(DASHBOARD_NAV_DEFAULT_WIDTH);
  const tooltipOpenTimerRef = useRef<number | null>(null);
  const tooltipCloseTimerRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const resolvedTheme = resolveDashboardTheme(themeMode, systemDark);

  const navCollapsed = isDashboardNavRailPhase(navPhase);
  const hostPlatform = useMemo(
    () => inferDashboardHostPlatform({
      platform: new URLSearchParams(window.location.search).get('platform'),
      userAgent: navigator.userAgent,
    }),
    [],
  );
  const chromeMode = dashboardChromeModeFor(hostPlatform);
  const collapsedSurface = dashboardCollapsedSurfaceWidth(chromeMode);
  const selectNav = (id: IntakeDestination) => { setBackStack([]); setActive(id); rememberPreviewPage(id); };
  const jump = (id: IntakeDestination) => { setBackStack((stack) => [...stack, active]); setActive(id); rememberPreviewPage(id); };
  const goBack = () => {
    const previous = backStack[backStack.length - 1];
    if (!previous) return;
    setBackStack((stack) => stack.slice(0, -1));
    setActive(previous);
  };
  useLayoutEffect(() => {
    if (!jobKnown) return;
    if (active === 'content' && seatLibraryOnly) { setActive('wording'); return; }
    if (navItems.some((item) => item.id === activeNav)) return;
    const next = navItems[0]?.id;
    if (next) setActive(next);
  }, [jobKnown, navItems, active, activeNav, seatLibraryOnly]);
  useLayoutEffect(() => {
    if (!permissionsOpen) return;
    if (readIntakePreviewPage(window.location, true) !== 'permissions') return;
    if (new URLSearchParams(window.location.search).get('page') !== 'permissions') return;
    setActive((current) => (current === 'overview' ? 'permissions' : current));
  }, [permissionsOpen]);
  const iconAnchorOffset = dashboardNavIconAnchorOffset(chromeMode);
  navPhaseRef.current = navPhase;
  const activeItem = useMemo(
    () => navItems.find((item) => item.id === active) ?? intakeDestinationItem(active),
    [active, navItems],
  );

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [active]);

  useEffect(() => {
    const api = window.dashboardContent;
    if (!api) return undefined;
    let live = true;
    const applySignedOut = () => {
      sessionConfirmed.current = false;
      setSessionJob(null);
      setSessionName(null);
      setContentSignedIn(false);
      setContentRole(null);
      setSessionPhase('signed-out');
    };
    const load = () => {
      const epoch = ++sessionEpoch.current;
      void Promise.resolve(api.session()).then((result) => {
        if (!live || epoch !== sessionEpoch.current) return;
        if (!result.ok) {
          if (sessionConfirmed.current) return;
          applySignedOut();
          return;
        }
        if (!result.signedIn) {
          applySignedOut();
          return;
        }
        sessionConfirmed.current = true;
        setSessionJob(result.job ?? null);
        setSessionName(result.displayName);
        setContentSignedIn(true);
        setContentRole(result.role);
        setSessionPhase('ready');
      }).catch(() => {
        if (!live || epoch !== sessionEpoch.current || sessionConfirmed.current) return;
        applySignedOut();
      });
    };
    load();
    window.addEventListener('focus', load);
    const stopSession = api.onSessionChanged?.(load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
      stopSession?.();
    };
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DASHBOARD_WINDOW_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

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

  const publishRenderedWidth = useCallback((width: number, options?: {
    preview?: boolean;
  }) => {
    const next = Math.round(width);
    navPreviewWidthRef.current = next;
    const shell = shellRef.current;
    if (shell) {
      shell.style.setProperty(DASHBOARD_RENDERED_NAV_WIDTH_VAR, `${next}px`);
      shell.style.setProperty(DASHBOARD_STRUCTURE_BOUNDARY_VAR, `${next}px`);
      if (options?.preview) {
        shell.style.setProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR, `${next}px`);
      }
    }
    return next;
  }, []);

  const clearNavPreviewWidth = useCallback(() => {
    navPreviewWidthRef.current = collapsedSurface;
    shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
  }, [collapsedSurface]);

  const stableRenderedWidth = useCallback((phase: DashboardNavPhase, expandedWidth: number) => (
    dashboardStructureBoundaryPx({
      phase,
      expandedWidth,
      collapsedWidth: collapsedSurface,
    })
  ), [collapsedSurface]);

  const cancelSettleRaf = useCallback(() => {
    if (navSettleRafRef.current !== null) {
      window.cancelAnimationFrame(navSettleRafRef.current);
      navSettleRafRef.current = null;
    }
  }, []);

  const applyNavPhase = (nextPhase: DashboardNavPhase, restoreFocus: boolean) => {
    pendingNavFocusRef.current = restoreFocus;
    navPhaseRef.current = nextPhase;
    setNavPhase(nextPhase);
  };

  const interruptNavSettle = useCallback(() => {
    cancelSettleRaf();
    navSettleEpochRef.current += 1;
    navPendingSettleTargetRef.current = null;
    navPendingPhaseRef.current = null;
    const painted = readDashboardStructureWidth(shellRef.current);
    const frozen = painted != null && painted > 0
      ? Math.round(painted)
      : navPreviewWidthRef.current;
    navSettlingPreviewRef.current = true;
    publishRenderedWidth(frozen, { preview: true });
    return frozen;
  }, [cancelSettleRaf, publishRenderedWidth]);

  useLayoutEffect(() => {
    const pendingTarget = navPendingSettleTargetRef.current;
    if (pendingTarget != null) {
      const settleEpoch = navSettleEpochRef.current;
      const flush = () => {
        navSettleRafRef.current = null;
        if (settleEpoch !== navSettleEpochRef.current) return;
        if (navPendingSettleTargetRef.current !== pendingTarget) return;
        navPendingSettleTargetRef.current = null;
        if (prefersReducedMotion() || Math.abs(navPreviewWidthRef.current - pendingTarget) <= 1) {
          publishRenderedWidth(pendingTarget);
          navSettlingPreviewRef.current = false;
          const settled = settleDashboardNavPhase(navPhaseRef.current);
          if (settled !== navPhaseRef.current) applyNavPhase(settled, false);
          if (pendingTarget === collapsedSurface) clearNavPreviewWidth();
          else shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
          return;
        }
        navSettlingPreviewRef.current = true;
        publishRenderedWidth(pendingTarget, { preview: true });
      };
      navSettleRafRef.current = window.requestAnimationFrame(flush);
      return () => {
        cancelSettleRaf();
      };
    }
    if (navSettlingPreviewRef.current) return;
    publishRenderedWidth(stableRenderedWidth(navPhase, navWidth));
    if (navPhase === 'collapsed') clearNavPreviewWidth();
    else if (navPhase === 'expanded') {
      shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
    }
    return undefined;
  }, [
    cancelSettleRaf,
    clearNavPreviewWidth,
    collapsedSurface,
    navPhase,
    navWidth,
    publishRenderedWidth,
    stableRenderedWidth,
  ]);

  useEffect(() => () => {
    cancelSettleRaf();
    navSettleEpochRef.current += 1;
    navPendingSettleTargetRef.current = null;
    navPendingPhaseRef.current = null;
    navSettlingPreviewRef.current = false;
    clearNavPreviewWidth();
    if (tooltipOpenTimerRef.current !== null) window.clearTimeout(tooltipOpenTimerRef.current);
    if (tooltipCloseTimerRef.current !== null) window.clearTimeout(tooltipCloseTimerRef.current);
  }, [cancelSettleRaf, clearNavPreviewWidth]);

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
        ...dashboardNavTooltipPosition(rect),
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

  useLayoutEffect(() => {
    if (!isDashboardNavStablePhase(navPhase)) return;
    if (!pendingNavFocusRef.current) return;
    pendingNavFocusRef.current = false;
    navToggleRef.current?.focus({ preventScroll: true });
  }, [navPhase]);

  const toggleNavigation = (options?: { restoreFocus?: boolean }) => {
    interruptNavSettle();
    hideNavTooltip(true);
    const collapse = !isDashboardNavRailPhase(navPhaseRef.current);
    const nextPhase = prefersReducedMotion()
      ? (collapse ? 'collapsed' : 'expanded')
      : startDashboardNavPhase(navPhaseRef.current, collapse);
    applyNavPhase(nextPhase, Boolean(options?.restoreFocus));
    const target = collapse ? collapsedSurface : navWidth;
    if (prefersReducedMotion()) {
      publishRenderedWidth(target);
      if (collapse) clearNavPreviewWidth();
      else shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
      navSettlingPreviewRef.current = false;
      return;
    }
    navSettlingPreviewRef.current = true;
    navPendingSettleTargetRef.current = target;
  };

  const handleNavToggleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const fromKeyboard = event.detail === 0;
    if (!fromKeyboard) event.currentTarget.blur();
    toggleNavigation({ restoreFocus: fromKeyboard });
  };

  const handleNavStructureTransition = useCallback((event: TransitionEvent) => {
    if (!isDashboardNavStructureTransition(event.target, event.currentTarget, event.propertyName)) {
      return;
    }
    const currentTarget = event.currentTarget instanceof Element ? event.currentTarget : shellRef.current;
    const actualWidth = readDashboardStructureWidth(currentTarget);
    const reducedMotion = prefersReducedMotion();
    setNavPhase((phase) => {
      const shouldSettle = shouldSettleDashboardNavTransition({
        eventType: event.type,
        phase,
        actualWidth,
        expandedWidth: navWidth,
        collapsedWidth: collapsedSurface,
        reducedMotion,
      });
      if (!shouldSettle) return phase;
      cancelSettleRaf();
      navSettleEpochRef.current += 1;
      navPendingSettleTargetRef.current = null;
      navPendingPhaseRef.current = null;
      navSettlingPreviewRef.current = false;
      const next = settleDashboardNavPhase(phase);
      const targetWidth = next === 'collapsed' ? collapsedSurface : navWidth;
      publishRenderedWidth(targetWidth);
      if (next === 'collapsed') clearNavPreviewWidth();
      else shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
      navPhaseRef.current = next;
      return next;
    });
  }, [
    cancelSettleRaf,
    clearNavPreviewWidth,
    collapsedSurface,
    navWidth,
    publishRenderedWidth,
  ]);

  const navStructureTransitionRef = useRef(handleNavStructureTransition);
  navStructureTransitionRef.current = handleNavStructureTransition;

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const onNativeTransition = (event: TransitionEvent) => {
      navStructureTransitionRef.current(event);
    };
    shell.addEventListener('transitionend', onNativeTransition);
    shell.addEventListener('transitioncancel', onNativeTransition);
    return () => {
      shell.removeEventListener('transitionend', onNativeTransition);
      shell.removeEventListener('transitioncancel', onNativeTransition);
    };
  }, []);

  const settleReducedMotionNavRef = useRef<() => void>(() => undefined);
  settleReducedMotionNavRef.current = () => {
    cancelSettleRaf();
    navSettleEpochRef.current += 1;
    const phaseNow = navPhaseRef.current;
    const pendingPhase = navPendingPhaseRef.current;
    const pendingTarget = navPendingSettleTargetRef.current;
    const nextPhase: DashboardNavPhase = (
      phaseNow === 'expanding'
      || pendingPhase === 'expanding'
      || pendingPhase === 'expanded'
    )
      ? 'expanded'
      : (
        phaseNow === 'collapsing'
        || phaseNow === 'collapsed'
        || pendingPhase === 'collapsing'
        || pendingPhase === 'collapsed'
        || (pendingTarget != null && Math.abs(pendingTarget - collapsedSurface) <= 1)
      )
        ? 'collapsed'
        : settleDashboardNavPhase(phaseNow);
    const nextWidth = nextPhase === 'collapsed' ? collapsedSurface : navWidth;
    navPendingSettleTargetRef.current = null;
    navPendingPhaseRef.current = null;
    navSettlingPreviewRef.current = false;
    applyNavPhase(nextPhase, false);
    publishRenderedWidth(nextWidth);
    if (nextPhase === 'collapsed') clearNavPreviewWidth();
    else shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
  };

  useEffect(() => {
    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    if (!media) return undefined;
    const settleIfReduced = () => {
      if (!media.matches) return;
      settleReducedMotionNavRef.current();
    };
    media.addEventListener('change', settleIfReduced);
    return () => media.removeEventListener('change', settleIfReduced);
  }, []);

  const move = (delta: number) => {
    const nextId = nextSidebarDestination(activeNav, delta, navItems);
    selectNav(nextId);
    window.requestAnimationFrame(() => {
      document.getElementById(`dash-nav-${nextId}`)?.focus();
    });
  };

  const focusModule = (moduleId: IntakeDestination) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`dash-nav-${moduleId}`)?.focus();
    });
  };

  let lastGroup: string | null = null;
  const liveStructureWidth = navSettlingPreviewRef.current
    ? navPreviewWidthRef.current
    : stableRenderedWidth(navPhase, navWidth);

  return (
    <IntakeAntdTheme>
    <div
      ref={shellRef}
      className={`dashboard-shell${navCollapsed ? ' is-nav-collapsed' : ''} is-intake`}
      data-testid="dashboard-shell"
      data-window-role="dashboard"
      data-nav-collapsed={navCollapsed}
      data-nav-phase={navPhase}
      data-nav-width={navWidth}
      data-last-expanded-width={navWidth}
      data-collapsed-surface={collapsedSurface}
      data-icon-anchor={iconAnchorOffset}
      data-theme-mode={themeMode}
      data-theme={resolvedTheme}
      data-platform={hostPlatform}
      data-dashboard-chrome={chromeMode}
      style={{
        '--dashboard-nav-width': `${navWidth}px`,
        '--dash-rendered-nav-width': `${liveStructureWidth}px`,
        '--dash-structure-boundary': `${liveStructureWidth}px`,
        '--dash-nav-rail-width': `${collapsedSurface}px`,
        ...dashboardChromeCssVars(chromeMode),
        colorScheme: resolvedTheme,
        fontFamily: DASHBOARD_FONT_FAMILY,
      } as CSSProperties}
    >
      <aside id="dashboard-sidebar" className="dashboard-nav" aria-label="工作台模块">
        <div
          className="dashboard-titlebar-drag-strip"
          data-testid="dashboard-titlebar-drag-strip"
          aria-hidden="true"
        />
        <div
          className="dashboard-titlebar-drag-strip dashboard-titlebar-drag-strip-end"
          data-testid="dashboard-titlebar-drag-strip-end"
          aria-hidden="true"
        />
        <div
          className="dashboard-titlebar-control-island dashboard-no-drag"
          data-testid="dashboard-titlebar-control-island"
        >
        <div className="dashboard-nav-chrome dashboard-no-drag" data-testid="dashboard-nav-chrome">
          <Button
            ref={navToggleRef}
            htmlType="button"
            autoInsertSpace={false}
            className="dashboard-nav-toggle dashboard-no-drag"
            aria-controls="dashboard-primary-navigation"
            aria-expanded={!navCollapsed}
            aria-label={navCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            title={navCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            data-testid="dashboard-nav-toggle"
            onClick={handleNavToggleClick}
          >
            <span
              className="dashboard-nav-toggle-icon is-collapse-glyph"
              data-testid="dashboard-nav-toggle-glyph"
              aria-hidden="true"
            >
              <DashboardChromeIcon id="panel-close" />
            </span>
            <span className="dashboard-nav-toggle-icon is-expand-glyph" aria-hidden="true">
              <DashboardChromeIcon id="panel-open" />
            </span>
          </Button>
        </div>
        </div>
        <div
          className="dashboard-brand dashboard-no-drag"
          data-testid="dashboard-brand"
        >
          <div className="dashboard-brand-logo dashboard-no-drag" data-testid="dashboard-brand-logo">
            <DashboardBrandFox theme={resolvedTheme} size={40} />
          </div>
          <div className="dashboard-brand-copy">
            <strong>客服运营工作台</strong>
            <span className="dashboard-brand-subtitle">运营管理端</span>
          </div>
        </div>
        <div
          id="dashboard-primary-navigation"
          className="dashboard-nav-list dashboard-no-drag"
          role="tablist"
          aria-label="工作台功能"
          aria-orientation="vertical"
        >
          {navItems.map((item) => {
            const selected = item.id === activeNav;
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div className="dashboard-nav-item" key={item.id}>
                {showGroup && lastGroupIndex(item, navItems) > 0 ? <span className="dashboard-nav-gap" aria-hidden="true" /> : null}
                <Button
                  id={`dash-nav-${item.id}`}
                  htmlType="button"
                  autoInsertSpace={false}
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
                    selectNav(item.id);
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
                      const first = navItems[0].id;
                      selectNav(first);
                      focusModule(first);
                    }
                    if (event.key === 'End') {
                      event.preventDefault();
                      const last = navItems[navItems.length - 1].id;
                      selectNav(last);
                      focusModule(last);
                    }
                  }}
                >
                  <span className="dashboard-nav-icon"><DashboardNavIcon id={sidebarIcon(item.id)} /></span>
                  <span className="dashboard-nav-label">{item.label}</span>
                  {item.id === 'overview' && todoCount ? <small className="dashboard-nav-badge" aria-label={`待办 ${todoCount} 项`}>{todoCount}</small> : null}
                </Button>
              </div>
            );
          })}
        </div>
        <div className="dashboard-account dashboard-no-drag">
          {contentSignedIn ? <Dropdown
            trigger={['click']}
            menu={{ items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', disabled: logoutBusy }], onClick: ({ key }) => {
              if (key !== 'logout' || logoutBusy) return;
              setLogoutBusy(true);
              setLogoutError(null);
              void (async () => {
                try {
                  const result = await window.dashboardContent?.logout?.();
                  if (!result || !result.ok) setLogoutError(result?.message ?? '退出未完成，请重试。');
                } catch { setLogoutError('退出未完成，请重试。'); }
                finally { setLogoutBusy(false); }
              })();
            } }}
          >
            <Button className="dashboard-account-button" type="text" aria-label="账号信息" title={sessionName ?? '已登录'}>
              <Avatar size={32} icon={<UserOutlined />} />
              <span className="dashboard-account-copy"><strong>{sessionName ?? '已登录'}</strong><small>{sessionJob?.status === 'resolved' ? sessionJob.title : '账号'}</small></span>
            </Button>
          </Dropdown> : <div className="dashboard-account-signed-out"><Avatar size={32} icon={<UserOutlined />} /><span>未登录</span></div>}
          {logoutError ? <p role="alert">{logoutError}</p> : null}
        </div>
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
        <header className="dashboard-topbar dashboard-drag-region">
          <div
            className="dashboard-topbar-drag-surface dashboard-drag-region"
            data-testid="dashboard-topbar-drag-surface"
            aria-hidden="true"
          />
          <div className="dashboard-page-context">
            <p className="intake-crumb">
              {backStack.length > 0 ? <Button htmlType="button" autoInsertSpace={false} className="intake-back dashboard-no-drag" aria-label="返回" onClick={goBack}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg></Button> : null}
              <strong>{sessionPhase === 'pending' ? '正在确认' : sessionPhase === 'signed-out' ? '请先登录' : activeItem.label}</strong>
            </p>
            {sessionJob?.notice ? <p role="status" data-testid="permission-notice">{sessionJob.notice}</p> : null}
          </div>
          <div className="dashboard-topbar-actions dashboard-no-drag">
            <DashboardThemeMenu themeMode={themeMode} onChange={setThemeMode} />
          </div>
        </header>
        <main
          id="dashboard-module-panel"
          ref={contentRef}
          className="dashboard-content"
          role="tabpanel"
          aria-labelledby={navItems.some((item) => item.id === activeNav) ? `dash-nav-${activeNav}` : undefined}
          data-testid="dashboard-content"
          data-active-module={active}
        >
          {renderIntakeDestinations({
            active,
            canViewPermissions: permissionsOpen,
            canGrant: grantAllowed,
            canUploadSop: sopUpload,
            seatLibraryOnly,
            jobKnown,
            jobPending: sessionPhase === 'pending',
            sessionKey,
            workbenchMode,
            workbenchStatus,
            onRetryWorkbench: () => setWorkbenchAttempt(value => value + 1),
            contentSignedIn,
            snapshot,
            onOpen: jump,
            onTodoCount: setTodoCount,
            onSupplyScript: (question) => { setScriptDraft(question); jump('content'); },
            scriptDraft,
            onDraftConsumed: () => setScriptDraft(null),
          })}
        </main>
      </div>
    </div>
    </IntakeAntdTheme>
  );
}
