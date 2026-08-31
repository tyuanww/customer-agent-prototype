import {
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import {
  DASHBOARD_DEFERRED_NAV,
  DASHBOARD_MANIFEST,
  DASHBOARD_NAV,
  nextDashboardNavId,
  type DashboardModuleId,
} from './data/dashboard-manifest';
import { AnnounceModule } from './features/dashboard/AnnounceModule';
import { ArchitectureModule } from './features/dashboard/ArchitectureModule';
import { DashboardBrandFox } from './components/DashboardBrandFox';
import { ContentModule } from './features/dashboard/ContentModule';
import { DashboardChromeIcon, DashboardNavIcon } from './features/dashboard/DashboardIcons';
import { DashboardThemeMenu } from './features/dashboard/DashboardThemeMenu';
import { IterationModule } from './features/dashboard/IterationModule';
import { LedgerModule } from './features/dashboard/LedgerModule';
import { OverviewModule } from './features/dashboard/OverviewModule';
import { ReviewModule } from './features/dashboard/ReviewModule';
import { WorkorderModule } from './features/dashboard/WorkorderModule';
import { WordingLibraryModule } from './features/dashboard/WordingLibraryModule';
import {
  DASHBOARD_WINDOW_TITLE,
  dashboardChromeCssVars,
  dashboardChromeModeFor,
  inferDashboardHostPlatform,
} from '@shared/dashboard-window';
import {
  clampDashboardNavPreviewWidth,
  clampDashboardNavWidth,
  dashboardCollapsedSurfaceWidth,
  dashboardNavIconAnchorOffset,
  dashboardStructureBoundaryPx,
  DASHBOARD_NAV_DEFAULT_WIDTH,
  DASHBOARD_NAV_MIN_WIDTH,
  DASHBOARD_NAV_PREVIEW_WIDTH_VAR,
  DASHBOARD_NAV_RESIZE_STEP,
  DASHBOARD_RENDERED_NAV_WIDTH_VAR,
  DASHBOARD_STRUCTURE_BOUNDARY_VAR,
  resolveDashboardNavResizeIntent,
  DASHBOARD_TOPBAR_BOUNDARY,
  getDashboardNavMaxWidth,
  isDashboardNavRailPhase,
  isDashboardNavStablePhase,
  isDashboardNavStructureTransition,
  prefersReducedMotion,
  readDashboardStructureWidth,
  dashboardNavTooltipPosition,
  resolveDashboardSeparatorAria,
  resolveDashboardTheme,
  settleDashboardNavPhase,
  systemPrefersDark,
  shouldSettleDashboardNavTransition,
  startDashboardNavPhase,
  type DashboardNavPhase,
  type DashboardThemeMode,
} from './lib/dashboard-appearance';
import './styles/dashboard.css';

type DashboardLeafModuleId = Exclude<DashboardModuleId, 'overview'>;

const MODULES: Record<DashboardLeafModuleId, () => ReactElement> = {
  ledger: LedgerModule,
  workorders: WorkorderModule,
  review: ReviewModule,
  wording: WordingLibraryModule,
  iteration: IterationModule,
  content: ContentModule,
  announce: AnnounceModule,
  architecture: ArchitectureModule,
};

type NavTooltipState = {
  key: string;
  label: string;
  left: number;
  top: number;
  visible: boolean;
};

export function DashboardApp() {
  const [active, setActive] = useState<DashboardModuleId>('overview');
  const [navPhase, setNavPhase] = useState<DashboardNavPhase>('expanded');
  const [navWidth, setNavWidth] = useState(DASHBOARD_NAV_DEFAULT_WIDTH);
  const [navResizing, setNavResizing] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [themeMode, setThemeMode] = useState<DashboardThemeMode>('system');
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [navTooltip, setNavTooltip] = useState<NavTooltipState | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const navToggleRef = useRef<HTMLButtonElement | null>(null);
  const pendingNavFocusRef = useRef(false);
  const navResizeHandleRef = useRef<HTMLDivElement | null>(null);
  const navWidthRef = useRef(DASHBOARD_NAV_DEFAULT_WIDTH);
  const lastExpandedWidthRef = useRef(DASHBOARD_NAV_DEFAULT_WIDTH);
  const navResizeOriginWidthRef = useRef(DASHBOARD_NAV_DEFAULT_WIDTH);
  const navResizePointerRef = useRef<number | null>(null);
  const finishNavResizeRef = useRef<(commit?: boolean) => void>(() => undefined);
  const navResizeShellLeftRef = useRef<number | null>(null);
  const navResizeFrameRef = useRef<number | null>(null);
  const pendingNavWidthRef = useRef<number | null>(null);
  const navResizeCommittedRef = useRef(false);
  const navAutoCollapsedRef = useRef(false);
  const navAutoExpandedRef = useRef(false);
  const navResizeFromCollapsedRef = useRef(false);
  const navHoldFrameRef = useRef(false);
  const navSettlingPreviewRef = useRef(false);
  const navPendingSettleTargetRef = useRef<number | null>(null);
  const navPendingPhaseRef = useRef<DashboardNavPhase | null>(null);
  const navSettleEpochRef = useRef(0);
  const navSettleRafRef = useRef<number | null>(null);
  const navHoldRafIdsRef = useRef<number[]>([]);
  const navPhaseRef = useRef<DashboardNavPhase>('expanded');
  const navPreviewWidthRef = useRef(DASHBOARD_NAV_DEFAULT_WIDTH);
  const tooltipOpenTimerRef = useRef<number | null>(null);
  const tooltipCloseTimerRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const ActiveModule = active === 'overview' ? null : MODULES[active];
  const navMaxWidth = getDashboardNavMaxWidth(viewportWidth);
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
  const iconAnchorOffset = dashboardNavIconAnchorOffset(chromeMode);
  navPhaseRef.current = navPhase;
  const activeItem = useMemo(
    () => DASHBOARD_NAV.find((item) => item.id === active) ?? DASHBOARD_NAV[0],
    [active],
  );

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [active]);

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

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  const applyNavWidth = useCallback((value: number, commit: boolean) => {
    const next = clampDashboardNavWidth(value, viewportWidth);
    navWidthRef.current = next;
    shellRef.current?.style.setProperty('--dashboard-nav-width', `${next}px`);
    if (commit) {
      lastExpandedWidthRef.current = next;
      setNavWidth(next);
    }
    return next;
  }, [viewportWidth]);

  const publishRenderedWidth = useCallback((width: number, options?: {
    preview?: boolean;
    aria?: number;
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
    const aria = resolveDashboardSeparatorAria({
      phase: navPhaseRef.current,
      visualWidth: options?.aria ?? next,
      collapsedWidth: collapsedSurface,
      maxWidth: getDashboardNavMaxWidth(viewportWidth),
    });
    navResizeHandleRef.current?.setAttribute('aria-valuemin', String(aria.valuemin));
    navResizeHandleRef.current?.setAttribute('aria-valuemax', String(aria.valuemax));
    navResizeHandleRef.current?.setAttribute('aria-valuenow', String(aria.valuenow));
    navResizeHandleRef.current?.setAttribute('aria-valuetext', `${aria.valuenow} 像素`);
    return next;
  }, [collapsedSurface, viewportWidth]);

  const clearNavPreviewWidth = useCallback(() => {
    navPreviewWidthRef.current = collapsedSurface;
    shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
  }, [collapsedSurface]);

  const publishCollapsedSeparatorAria = useCallback(() => {
    navResizeHandleRef.current?.setAttribute('aria-valuenow', String(collapsedSurface));
    navResizeHandleRef.current?.setAttribute(
      'aria-valuetext',
      `${collapsedSurface} 像素`,
    );
  }, [collapsedSurface]);

  const stableRenderedWidth = useCallback((phase: DashboardNavPhase, expandedWidth: number) => (
    dashboardStructureBoundaryPx({
      phase,
      expandedWidth,
      collapsedWidth: collapsedSurface,
    })
  ), [collapsedSurface]);

  const cancelResizeFrame = useCallback(() => {
    if (navResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(navResizeFrameRef.current);
      navResizeFrameRef.current = null;
    }
  }, []);

  const cancelSettleAndHoldRafs = useCallback(() => {
    if (navSettleRafRef.current !== null) {
      window.cancelAnimationFrame(navSettleRafRef.current);
      navSettleRafRef.current = null;
    }
    if (navHoldRafIdsRef.current.length > 0) {
      for (const id of navHoldRafIdsRef.current) {
        window.cancelAnimationFrame(id);
      }
      navHoldRafIdsRef.current = [];
    }
  }, []);

  const setNavHoldFlag = useCallback((hold: boolean) => {
    navHoldFrameRef.current = hold;
    const shell = shellRef.current;
    if (!shell) return;
    if (hold) shell.setAttribute('data-nav-hold', 'true');
    else shell.removeAttribute('data-nav-hold');
  }, []);

  const interruptNavSettle = useCallback(() => {
    cancelSettleAndHoldRafs();
    cancelResizeFrame();
    navSettleEpochRef.current += 1;
    navPendingSettleTargetRef.current = null;
    navPendingPhaseRef.current = null;
    setNavHoldFlag(false);
    const painted = readDashboardStructureWidth(shellRef.current);
    const frozen = painted != null && painted > 0
      ? Math.round(painted)
      : navPreviewWidthRef.current;
    navSettlingPreviewRef.current = true;
    publishRenderedWidth(frozen, { preview: true });
    return frozen;
  }, [cancelResizeFrame, cancelSettleAndHoldRafs, publishRenderedWidth, setNavHoldFlag]);

  const schedulePaintHold = useCallback((onPainted: () => void) => {
    cancelSettleAndHoldRafs();
    const settleEpoch = navSettleEpochRef.current;
    const first = window.requestAnimationFrame(() => {
      if (settleEpoch !== navSettleEpochRef.current) {
        navHoldRafIdsRef.current = [];
        return;
      }
      const second = window.requestAnimationFrame(() => {
        navHoldRafIdsRef.current = [];
        if (settleEpoch !== navSettleEpochRef.current) return;
        onPainted();
      });
      navHoldRafIdsRef.current = [second];
    });
    navHoldRafIdsRef.current = [first];
  }, [cancelSettleAndHoldRafs]);

  useLayoutEffect(() => {
    if (navResizing) return;
    const pendingTarget = navPendingSettleTargetRef.current;
    const pendingPhase = navPendingPhaseRef.current;
    if (pendingTarget != null || pendingPhase != null) {
      const settleEpoch = navSettleEpochRef.current;
      const flush = () => {
        navSettleRafRef.current = null;
        if (settleEpoch !== navSettleEpochRef.current) return;
        if (
          navPendingSettleTargetRef.current !== pendingTarget
          || navPendingPhaseRef.current !== pendingPhase
        ) {
          return;
        }
        navPendingSettleTargetRef.current = null;
        navPendingPhaseRef.current = null;
        setNavHoldFlag(false);
        if (pendingPhase) applyNavPhase(pendingPhase, false);
        if (pendingTarget == null) return;
        if (prefersReducedMotion() || Math.abs(navPreviewWidthRef.current - pendingTarget) <= 1) {
          publishRenderedWidth(pendingTarget);
          navSettlingPreviewRef.current = false;
          const settled = settleDashboardNavPhase(navPhaseRef.current);
          if (settled !== navPhaseRef.current) applyNavPhase(settled, false);
          if (pendingTarget === collapsedSurface) {
            clearNavPreviewWidth();
            publishCollapsedSeparatorAria();
          } else {
            shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
          }
          return;
        }
        navSettlingPreviewRef.current = true;
        publishRenderedWidth(pendingTarget, { preview: true });
      };
      navSettleRafRef.current = window.requestAnimationFrame(flush);
      return;
    }
    if (navHoldFrameRef.current || navSettlingPreviewRef.current) return;
    publishRenderedWidth(stableRenderedWidth(navPhase, navWidthRef.current));
    if (navPhase === 'collapsed') {
      clearNavPreviewWidth();
      publishCollapsedSeparatorAria();
    } else if (navPhase === 'expanded') {
      shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
    }
  }, [
    clearNavPreviewWidth,
    collapsedSurface,
    navPhase,
    navResizing,
    navWidth,
    publishCollapsedSeparatorAria,
    publishRenderedWidth,
    setNavHoldFlag,
    stableRenderedWidth,
  ]);

  useEffect(() => {
    const clamped = clampDashboardNavWidth(navWidthRef.current, viewportWidth);
    if (clamped !== navWidthRef.current) applyNavWidth(clamped, true);
  }, [applyNavWidth, viewportWidth]);

  const releaseNavPointer = useCallback(() => {
    cancelResizeFrame();
    pendingNavWidthRef.current = null;
    const pointerId = navResizePointerRef.current;
    const handle = navResizeHandleRef.current;
    // Clear the pointer first: releasePointerCapture may synchronously dispatch
    // lostpointercapture, which must not finish the same gesture twice.
    navResizePointerRef.current = null;
    navResizeShellLeftRef.current = null;
    if (pointerId !== null && handle?.hasPointerCapture?.(pointerId)) {
      handle.releasePointerCapture?.(pointerId);
    }
  }, [cancelResizeFrame]);

  const finishPointerSession = useCallback(() => {
    releaseNavPointer();
    navResizeCommittedRef.current = false;
    navResizeFromCollapsedRef.current = false;
    setNavResizing(false);
  }, [releaseNavPointer]);

  const rollbackCollapsedPreview = useCallback(() => {
    const current = navPreviewWidthRef.current;
    navSettlingPreviewRef.current = true;
    finishPointerSession();
    publishCollapsedSeparatorAria();
    if (prefersReducedMotion() || Math.abs(current - collapsedSurface) <= 1) {
      publishRenderedWidth(collapsedSurface);
      clearNavPreviewWidth();
      publishCollapsedSeparatorAria();
      navSettlingPreviewRef.current = false;
      return;
    }
    publishRenderedWidth(current, { preview: true });
    navPendingSettleTargetRef.current = collapsedSurface;
  }, [
    clearNavPreviewWidth,
    collapsedSurface,
    finishPointerSession,
    publishCollapsedSeparatorAria,
    publishRenderedWidth,
  ]);

  const snapExpandedPreview = useCallback((target: number) => {
    const current = navPreviewWidthRef.current;
    const next = applyNavWidth(target, true);
    finishPointerSession();
    if (prefersReducedMotion() || Math.abs(current - next) <= 1) {
      publishRenderedWidth(next);
      shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
      navSettlingPreviewRef.current = false;
      return;
    }
    navSettlingPreviewRef.current = true;
    publishRenderedWidth(current, { preview: true });
    navPendingSettleTargetRef.current = next;
  }, [applyNavWidth, finishPointerSession, publishRenderedWidth]);

  const finishNavResize = useCallback((commit = true) => {
    const active = navResizePointerRef.current !== null
      || navResizeFromCollapsedRef.current
      || navAutoCollapsedRef.current
      || navAutoExpandedRef.current
      || navHoldFrameRef.current;
    if (!active) {
      releaseNavPointer();
      navResizeCommittedRef.current = false;
      setNavResizing(false);
      return;
    }
    if (navAutoCollapsedRef.current || navAutoExpandedRef.current) {
      releaseNavPointer();
      navResizeCommittedRef.current = false;
      navResizeFromCollapsedRef.current = false;
      setNavResizing(false);
      return;
    }
    if (navResizeFromCollapsedRef.current) {
      rollbackCollapsedPreview();
      return;
    }
    if (commit && !navResizeCommittedRef.current) {
      snapExpandedPreview(navWidthRef.current);
      return;
    }
    if (!commit) {
      snapExpandedPreview(navResizeOriginWidthRef.current);
      return;
    }
    finishPointerSession();
    shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
  }, [
    finishPointerSession,
    releaseNavPointer,
    rollbackCollapsedPreview,
    snapExpandedPreview,
  ]);
  finishNavResizeRef.current = finishNavResize;

  useLayoutEffect(() => {
    const abortNavResize = () => {
      const active = navResizePointerRef.current !== null
        || navResizeFromCollapsedRef.current
        || navAutoCollapsedRef.current
        || navAutoExpandedRef.current
        || navHoldFrameRef.current;
      if (active) finishNavResizeRef.current(false);
    };
    const forwardLostPointerEvent = (event: PointerEvent): void => {
      const handle = navResizeHandleRef.current;
      if (
        !handle
        || navResizePointerRef.current !== event.pointerId
        || event.target === handle
        || (event.target instanceof Node && handle.contains(event.target))
      ) {
        return;
      }
      // Native titlebar/app-region changes can retarget a captured pointer to
      // the page beneath the separator. Forward that sample through the real
      // separator handlers so move/up/cancel cannot leave resize mode stuck.
      handle.dispatchEvent(new PointerEvent(event.type, {
        bubbles: true,
        cancelable: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      }));
    };
    window.addEventListener('blur', abortNavResize);
    window.addEventListener('resize', abortNavResize);
    window.addEventListener('pointermove', forwardLostPointerEvent, true);
    window.addEventListener('pointerup', forwardLostPointerEvent, true);
    window.addEventListener('pointercancel', forwardLostPointerEvent, true);
    return () => {
      window.removeEventListener('blur', abortNavResize);
      window.removeEventListener('resize', abortNavResize);
      window.removeEventListener('pointermove', forwardLostPointerEvent, true);
      window.removeEventListener('pointerup', forwardLostPointerEvent, true);
      window.removeEventListener('pointercancel', forwardLostPointerEvent, true);
    };
  }, []);

  useEffect(() => () => {
    cancelResizeFrame();
    cancelSettleAndHoldRafs();
    navSettleEpochRef.current += 1;
    navPendingSettleTargetRef.current = null;
    navPendingPhaseRef.current = null;
    navSettlingPreviewRef.current = false;
    setNavHoldFlag(false);
    clearNavPreviewWidth();
    if (tooltipOpenTimerRef.current !== null) window.clearTimeout(tooltipOpenTimerRef.current);
    if (tooltipCloseTimerRef.current !== null) window.clearTimeout(tooltipCloseTimerRef.current);
  }, [cancelResizeFrame, cancelSettleAndHoldRafs, clearNavPreviewWidth, setNavHoldFlag]);

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

  const applyNavPhase = (nextPhase: DashboardNavPhase, restoreFocus: boolean) => {
    pendingNavFocusRef.current = restoreFocus;
    navPhaseRef.current = nextPhase;
    setNavPhase(nextPhase);
  };

  const toggleNavigation = (options?: { restoreFocus?: boolean }) => {
    interruptNavSettle();
    if (navResizePointerRef.current !== null || navResizing) {
      finishPointerSession();
    }
    navAutoCollapsedRef.current = false;
    navAutoExpandedRef.current = false;
    hideNavTooltip(true);
    const collapse = !isDashboardNavRailPhase(navPhaseRef.current);
    if (!collapse) {
      applyNavWidth(lastExpandedWidthRef.current, true);
    }
    const nextPhase = prefersReducedMotion()
      ? (collapse ? 'collapsed' : 'expanded')
      : startDashboardNavPhase(navPhaseRef.current, collapse);
    applyNavPhase(nextPhase, Boolean(options?.restoreFocus));
    if (prefersReducedMotion()) {
      const target = collapse ? collapsedSurface : lastExpandedWidthRef.current;
      publishRenderedWidth(target);
      if (collapse) {
        clearNavPreviewWidth();
        publishCollapsedSeparatorAria();
      } else {
        shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
      }
      navSettlingPreviewRef.current = false;
      return;
    }
    navSettlingPreviewRef.current = true;
    navPendingSettleTargetRef.current = collapse
      ? collapsedSurface
      : lastExpandedWidthRef.current;
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
        expandedWidth: navWidthRef.current,
        collapsedWidth: collapsedSurface,
        reducedMotion,
      });
      if (!shouldSettle) return phase;
      cancelSettleAndHoldRafs();
      navSettleEpochRef.current += 1;
      navPendingSettleTargetRef.current = null;
      navPendingPhaseRef.current = null;
      setNavHoldFlag(false);
      navSettlingPreviewRef.current = false;
      const next = settleDashboardNavPhase(phase);
      const targetWidth = next === 'collapsed' ? collapsedSurface : navWidthRef.current;
      publishRenderedWidth(targetWidth);
      if (next === 'collapsed') {
        clearNavPreviewWidth();
        publishCollapsedSeparatorAria();
      } else {
        shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
      }
      navPhaseRef.current = next;
      return next;
    });
  }, [
    cancelSettleAndHoldRafs,
    clearNavPreviewWidth,
    collapsedSurface,
    publishCollapsedSeparatorAria,
    publishRenderedWidth,
    setNavHoldFlag,
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
    cancelSettleAndHoldRafs();
    cancelResizeFrame();
    navSettleEpochRef.current += 1;
    if (navResizePointerRef.current !== null || navResizing) {
      finishPointerSession();
    }
    const phaseNow = navPhaseRef.current;
    const pendingPhase = navPendingPhaseRef.current;
    const pendingTarget = navPendingSettleTargetRef.current;
    const nextPhase: DashboardNavPhase = (
      navAutoExpandedRef.current
      || phaseNow === 'expanding'
      || pendingPhase === 'expanding'
      || pendingPhase === 'expanded'
    )
      ? 'expanded'
      : (
        navAutoCollapsedRef.current
        || phaseNow === 'collapsing'
        || pendingPhase === 'collapsing'
        || pendingPhase === 'collapsed'
        || (pendingTarget != null && Math.abs(pendingTarget - collapsedSurface) <= 1)
      )
        ? 'collapsed'
        : settleDashboardNavPhase(phaseNow);
    const nextWidth = nextPhase === 'collapsed'
      ? collapsedSurface
      : clampDashboardNavWidth(
        pendingTarget != null && pendingTarget >= DASHBOARD_NAV_MIN_WIDTH
          ? pendingTarget
          : lastExpandedWidthRef.current,
        viewportWidth,
      );
    navPendingSettleTargetRef.current = null;
    navPendingPhaseRef.current = null;
    navAutoCollapsedRef.current = false;
    navAutoExpandedRef.current = false;
    navSettlingPreviewRef.current = false;
    setNavHoldFlag(false);
    applyNavPhase(nextPhase, false);
    publishRenderedWidth(nextWidth);
    if (nextPhase === 'collapsed') {
      clearNavPreviewWidth();
      publishCollapsedSeparatorAria();
    } else {
      shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
    }
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

  const navWidthFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const shellLeft = navResizeShellLeftRef.current ?? 0;
    return event.clientX - shellLeft;
  };

  const startNavResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!isDashboardNavStablePhase(navPhaseRef.current)) return;
    event.preventDefault();
    interruptNavSettle();
    navResizeShellLeftRef.current = shellRef.current?.getBoundingClientRect().left ?? 0;
    navResizePointerRef.current = event.pointerId;
    const fromCollapsed = isDashboardNavRailPhase(navPhaseRef.current);
    navResizeFromCollapsedRef.current = fromCollapsed;
    navResizeOriginWidthRef.current = fromCollapsed
      ? collapsedSurface
      : lastExpandedWidthRef.current;
    navPreviewWidthRef.current = fromCollapsed
      ? collapsedSurface
      : lastExpandedWidthRef.current;
    navResizeCommittedRef.current = false;
    navAutoCollapsedRef.current = false;
    navAutoExpandedRef.current = false;
    setNavHoldFlag(false);
    navSettlingPreviewRef.current = false;
    publishRenderedWidth(navPreviewWidthRef.current, {
      preview: true,
      aria: fromCollapsed ? collapsedSurface : lastExpandedWidthRef.current,
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setNavResizing(true);
  };

  const armAutoCollapse = () => {
    if (navAutoCollapsedRef.current || navAutoExpandedRef.current) return;
    navAutoCollapsedRef.current = true;
    setNavHoldFlag(true);
    navPhaseRef.current = 'collapsing';
    applyNavPhase('collapsing', false);
    publishRenderedWidth(navPreviewWidthRef.current, { preview: true });
    releaseNavPointer();
    if (prefersReducedMotion()) {
      setNavHoldFlag(false);
      applyNavPhase('collapsed', false);
      publishRenderedWidth(collapsedSurface);
      clearNavPreviewWidth();
      publishCollapsedSeparatorAria();
      setNavResizing(false);
      return;
    }
    setNavResizing(false);
    schedulePaintHold(() => {
      setNavHoldFlag(false);
      navSettlingPreviewRef.current = true;
      publishRenderedWidth(collapsedSurface, { preview: true });
    });
  };

  const armAutoExpand = () => {
    if (navAutoExpandedRef.current || navAutoCollapsedRef.current) return;
    navAutoExpandedRef.current = true;
    setNavHoldFlag(true);
    hideNavTooltip(true);
    const target = clampDashboardNavWidth(lastExpandedWidthRef.current, viewportWidth);
    lastExpandedWidthRef.current = target;
    applyNavWidth(target, true);
    releaseNavPointer();
    if (prefersReducedMotion()) {
      setNavHoldFlag(false);
      applyNavPhase('expanded', false);
      publishRenderedWidth(target);
      shellRef.current?.style.removeProperty(DASHBOARD_NAV_PREVIEW_WIDTH_VAR);
      setNavResizing(false);
      return;
    }
    setNavResizing(false);
    schedulePaintHold(() => {
      setNavHoldFlag(false);
      navSettlingPreviewRef.current = true;
      applyNavPhase(startDashboardNavPhase(navPhaseRef.current, false), false);
      publishRenderedWidth(target, { preview: true });
    });
  };

  const scheduleNavPreview = (value: number) => {
    pendingNavWidthRef.current = value;
    if (navResizeFrameRef.current !== null) return;
    navResizeFrameRef.current = window.requestAnimationFrame(() => {
      navResizeFrameRef.current = null;
      if (pendingNavWidthRef.current === null) return;
      const next = clampDashboardNavPreviewWidth(
        pendingNavWidthRef.current,
        viewportWidth,
        collapsedSurface,
      );
      pendingNavWidthRef.current = null;
      publishRenderedWidth(next, { preview: true });
    });
  };

  const moveNavResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (navAutoCollapsedRef.current || navAutoExpandedRef.current || navHoldFrameRef.current) return;
    if (navResizePointerRef.current !== event.pointerId) return;
    if (event.buttons === 0) {
      finishNavResize(false);
      return;
    }
    const raw = navWidthFromPointer(event);
    const origin = navResizeFromCollapsedRef.current ? 'collapsed' : 'expanded';
    const intent = resolveDashboardNavResizeIntent(origin, raw);
    const live = clampDashboardNavPreviewWidth(raw, viewportWidth, collapsedSurface);
    if (intent === 'auto-expand' || intent === 'auto-collapse') {
      publishRenderedWidth(live, { preview: true });
      if (intent === 'auto-expand') armAutoExpand();
      else armAutoCollapse();
      return;
    }
    scheduleNavPreview(raw);
  };

  const endNavResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (navAutoCollapsedRef.current || navAutoExpandedRef.current || navHoldFrameRef.current) return;
    if (navResizePointerRef.current !== event.pointerId) return;
    if (navResizeFromCollapsedRef.current) {
      rollbackCollapsedPreview();
      return;
    }
    if (event.type === 'pointerup') {
      cancelResizeFrame();
      pendingNavWidthRef.current = null;
      const raw = navWidthFromPointer(event);
      const live = clampDashboardNavPreviewWidth(raw, viewportWidth, collapsedSurface);
      publishRenderedWidth(live, { preview: true });
      if (raw < DASHBOARD_NAV_MIN_WIDTH) {
        snapExpandedPreview(DASHBOARD_NAV_MIN_WIDTH);
        return;
      }
      applyNavWidth(raw, true);
      navResizeCommittedRef.current = true;
      snapExpandedPreview(navWidthRef.current);
      return;
    }
    snapExpandedPreview(navResizeOriginWidthRef.current);
  };

  const handleNavResizeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (navCollapsed) {
      if (event.key === 'Enter' || event.key === 'ArrowRight') {
        event.preventDefault();
        toggleNavigation({ restoreFocus: true });
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        applyNavWidth(navMaxWidth, true);
        toggleNavigation({ restoreFocus: true });
        return;
      }
      if (event.key === 'Home' || event.key === 'ArrowLeft') {
        event.preventDefault();
        return;
      }
      return;
    }
    const step = event.shiftKey ? DASHBOARD_NAV_RESIZE_STEP * 3 : DASHBOARD_NAV_RESIZE_STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = navWidthRef.current - step;
    if (event.key === 'ArrowRight') next = navWidthRef.current + step;
    if (event.key === 'Home') next = DASHBOARD_NAV_MIN_WIDTH;
    if (event.key === 'End') next = navMaxWidth;
    if (event.key === 'Enter') {
      event.preventDefault();
      toggleNavigation({ restoreFocus: true });
      return;
    }
    if (next === null) return;
    event.preventDefault();
    applyNavWidth(next, true);
  };

  const move = (delta: number) => {
    const nextId = nextDashboardNavId(active, delta);
    setActive(nextId);
    window.requestAnimationFrame(() => {
      document.getElementById(`dash-nav-${nextId}`)?.focus();
    });
  };

  const focusModule = (moduleId: DashboardModuleId) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`dash-nav-${moduleId}`)?.focus();
    });
  };

  let lastGroup: string | null = null;
  const liveStructureWidth = navResizing || navHoldFrameRef.current || navSettlingPreviewRef.current
    ? navPreviewWidthRef.current
    : stableRenderedWidth(navPhase, navWidth);
  const separatorAria = resolveDashboardSeparatorAria({
    phase: navPhase,
    visualWidth: navResizing || navHoldFrameRef.current || navSettlingPreviewRef.current
      ? navPreviewWidthRef.current
      : (navCollapsed ? collapsedSurface : navWidth),
    collapsedWidth: collapsedSurface,
    maxWidth: navMaxWidth,
  });

  return (
    <div
      ref={shellRef}
      className={`dashboard-shell${navCollapsed ? ' is-nav-collapsed' : ''}`}
      data-testid="dashboard-shell"
      data-window-role="dashboard"
      data-nav-collapsed={navCollapsed}
      data-nav-phase={navPhase}
      data-nav-resizing={navResizing}
      data-nav-width={navWidth}
      data-last-expanded-width={lastExpandedWidthRef.current}
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
          <button
            ref={navToggleRef}
            type="button"
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
          </button>
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
        <details className="dashboard-nav-boundary dashboard-no-drag" data-testid="dashboard-boundary-details">
          <summary>演示环境</summary>
          <p data-testid="dashboard-boundary-disclaimer">
            {DASHBOARD_MANIFEST.banners.disclaimer}
          </p>
          <dl>
            <div><dt>权限</dt><dd>MOCK AUTH</dd></div>
            <div><dt>数据</dt><dd>SYNTHETIC DATA</dd></div>
            <div><dt>服务</dt><dd>NO BACKEND</dd></div>
            <div><dt>存储</dt><dd>不保存</dd></div>
          </dl>
        </details>
        <div
          ref={navResizeHandleRef}
          className="dashboard-nav-resizer dashboard-no-drag"
          role="separator"
          aria-label="调整工作台侧栏宽度"
          aria-controls="dashboard-sidebar"
          aria-orientation="vertical"
          aria-valuemin={separatorAria.valuemin}
          aria-valuemax={separatorAria.valuemax}
          aria-valuenow={separatorAria.valuenow}
          aria-valuetext={`${separatorAria.valuenow} 像素`}
          tabIndex={0}
          data-testid="dashboard-nav-resizer"
          onPointerDown={startNavResize}
          onPointerMove={moveNavResize}
          onPointerUp={endNavResize}
          onPointerCancel={endNavResize}
          onLostPointerCapture={(event) => {
            if (navResizePointerRef.current !== event.pointerId) return;
            if (navAutoCollapsedRef.current || navAutoExpandedRef.current || navHoldFrameRef.current) {
              return;
            }
            finishNavResize(false);
          }}
          onDoubleClick={() => {
            applyNavWidth(DASHBOARD_NAV_DEFAULT_WIDTH, true);
            if (navCollapsed) toggleNavigation();
          }}
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
        <header className="dashboard-topbar dashboard-drag-region">
          <div
            className="dashboard-topbar-drag-surface dashboard-drag-region"
            data-testid="dashboard-topbar-drag-surface"
            aria-hidden="true"
          />
          <div className="dashboard-page-context">
            <strong>{activeItem.label}</strong>
            <p className="dashboard-refresh" data-testid="dashboard-refresh">
              {DASHBOARD_MANIFEST.banners.refreshLabel}
            </p>
          </div>
          <div className="dashboard-topbar-actions dashboard-no-drag">
            <DashboardThemeMenu themeMode={themeMode} onChange={setThemeMode} />
            <div className="dashboard-banners" aria-label="数据环境与边界">
              <div className="env-badges" role="list" data-testid="dashboard-env-badges">
                {DASHBOARD_MANIFEST.banners.env.map((badge) => (
                  <span key={badge} className="env-badge" role="listitem">
                    {badge}
                  </span>
                ))}
              </div>
              <p className="dashboard-disclaimer" data-testid="dashboard-disclaimer">
                {DASHBOARD_TOPBAR_BOUNDARY}
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
          {ActiveModule ? <ActiveModule /> : <OverviewModule onNavigate={setActive} />}
        </main>
      </div>
    </div>
  );
}
