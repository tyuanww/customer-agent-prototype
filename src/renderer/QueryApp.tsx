import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  EMPTY_QUERY_MESSAGE,
  MAX_QUERY_CHARS,
  QUERY_TOO_LONG_MESSAGE,
} from '@shared/contracts';
import { formatAcceleratorLabel } from '@shared/shortcut';
import {
  QUERY_CLOSE_DURATION_MS,
  QUERY_CONTENT_EXIT_DURATION_MS,
  QUERY_OPEN_DURATION_MS,
  queryHandoffGeometry,
} from '@shared/fox-motion';
import { QUERY_INPUT_HEIGHT, QUERY_WIDTH } from '@shared/overlay-geometry';
import {
  acceptQueryLayoutAck,
  composeQueryDesiredHeight,
  isQueryContentLayoutPhase,
  measureQueryHugHeight,
  QUERY_CONTENT_BLANK_TOLERANCE_PX,
  QUERY_LAYOUT_FALLBACK_MS,
  QUERY_LAYOUT_MAX_HEIGHT,
  QUERY_LAYOUT_MIN_HEIGHT,
  type QueryLayoutAck,
  type QueryLayoutRequest,
  type QueryResizeEdge,
} from '@shared/query-layout';
import {
  IDENTITY_FOX_VISUAL_TRANSFORM,
  type FoxVisualTransform,
  type QueryAnchor,
  type ResultCount,
} from '@shared/overlay-events';
import { reduceOverlay, type OverlayPhase } from '@shared/overlay-machine';
import { QueryCapsule } from './features/search/QueryCapsule';
import { QueryResultsPane } from './features/search/QueryResultsPane';
import { searchScripts } from './features/search/search-service';
import type { RankedScript } from './features/search/types';
import {
  COPY_FEEDBACK_MS,
  DEEP_THINKING_DESCRIPTION,
  SEARCH_FEEDBACK_MS,
  maxContentBottom,
  queryFoxVisualState,
  queryHandoffCssVars,
  queryShellClassName,
  resultCopyRankFromKey,
} from './features/search/query-view';
import { isImeComposing, shouldSubmitOnEnter } from './lib/ime';
import { isInteractiveTarget } from './lib/is-interactive-target';
import { useWindowDrag } from './lib/use-window-drag';

export function QueryApp() {
  const [phase, setPhase] = useState<OverlayPhase>('SEARCH_INPUT');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RankedScript[]>([]);
  const [invalidMessage, setInvalidMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [copying, setCopying] = useState(false);
  const [searching, setSearching] = useState(false);
  const [copiedRank, setCopiedRank] = useState<1 | 2 | 3 | null>(null);
  const [platform, setPlatform] = useState('win32');
  const [shortcutHint, setShortcutHint] = useState('');
  const [shortcutFailed, setShortcutFailed] = useState(false);
  const [anchor, setAnchor] = useState<QueryAnchor>('left');
  const [parked, setParked] = useState(true);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [handoffGeometry, setHandoffGeometry] = useState(() =>
    queryHandoffGeometry(QUERY_WIDTH, QUERY_INPUT_HEIGHT, 'left'),
  );
  const [handoffFoxTransform, setHandoffFoxTransform] = useState<FoxVisualTransform>(
    IDENTITY_FOX_VISUAL_TRANSFORM,
  );
  const [deepThinkingInfoOpen, setDeepThinkingInfoOpen] = useState(false);
  const [layoutReady, setLayoutReady] = useState(true);
  const [resizeEdge, setResizeEdge] = useState<QueryResizeEdge>('bottom');
  const [queryHeight, setQueryHeight] = useState(QUERY_INPUT_HEIGHT);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultPaneRef = useRef<HTMLElement>(null);
  const resultContentRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const layoutSequenceRef = useRef(0);
  const lastAppliedLayoutSequenceRef = useRef(0);
  const layoutFrameRef = useRef<number | null>(null);
  const hugPassRef = useRef(0);
  const phaseRef = useRef<OverlayPhase>(phase);
  const resultCountRef = useRef<ResultCount>(0);
  const resizeGripRef = useRef<HTMLDivElement | null>(null);
  const resizePointerRef = useRef<number | null>(null);
  const resizeOriginYRef = useRef(0);
  const resizeDeltaRef = useRef(0);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeFinishedRef = useRef(true);
  const composingRef = useRef(false);
  const copyInFlightRef = useRef(false);
  const searchInFlightRef = useRef(false);
  const dashboardOpenFailedRef = useRef(false);
  const copyGenerationRef = useRef(0);
  const searchGenerationRef = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const resultFocusFrameRef = useRef<number | null>(null);
  const openingFrameRef = useRef<number | null>(null);
  const inputFocusFrameRef = useRef<number | null>(null);
  const collapseCleanupTimerRef = useRef<number | null>(null);
  const pendingCopyRef = useRef<RankedScript | null>(null);
  const activeHandoffIdRef = useRef(0);
  const queryInteractiveRef = useRef(false);
  const openingRef = useRef(false);
  const openingUserInteractionRef = useRef(false);
  phaseRef.current = phase;

  const cancelScheduledResultFocus = useCallback(() => {
    if (resultFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(resultFocusFrameRef.current);
      resultFocusFrameRef.current = null;
    }
  }, []);

  const cancelScheduledOpening = useCallback(() => {
    if (openingFrameRef.current !== null) {
      window.cancelAnimationFrame(openingFrameRef.current);
      openingFrameRef.current = null;
    }
  }, []);

  const cancelScheduledInputFocus = useCallback(() => {
    if (inputFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(inputFocusFrameRef.current);
      inputFocusFrameRef.current = null;
    }
  }, []);

  const finishCollapseContent = useCallback(() => {
    setPhase('SEARCH_INPUT');
    setResults([]);
    setCopying(false);
    setSearching(false);
    setCopiedRank(null);
    setErrorMessage('');
    setInvalidMessage('');
    setLayoutReady(true);
    layoutSequenceRef.current = 0;
    lastAppliedLayoutSequenceRef.current = 0;
    resultCountRef.current = 0;
  }, []);

  const cancelScheduledCollapseContent = useCallback((finish: boolean) => {
    if (collapseCleanupTimerRef.current !== null) {
      window.clearTimeout(collapseCleanupTimerRef.current);
      collapseCleanupTimerRef.current = null;
      if (finish) {
        finishCollapseContent();
      }
    }
  }, [finishCollapseContent]);

  const scheduleResultFocus = useCallback(() => {
    cancelScheduledResultFocus();
    resultFocusFrameRef.current = window.requestAnimationFrame(() => {
      resultFocusFrameRef.current = null;
      resultPaneRef.current?.focus();
    });
  }, [cancelScheduledResultFocus]);

  const focusQueryInput = useCallback((selectExistingText = true) => {
    cancelScheduledInputFocus();
    const applyFocus = (selectExistingText: boolean) => {
      const input = inputRef.current;
      if (!input || !queryInteractiveRef.current) {
        return;
      }
      input.focus();
      if (selectExistingText) {
        input.select();
      }
    };
    // Native window focus and renderer focus do not always settle in the same
    // task after a hidden macOS panel is shown. Focus once immediately, then
    // reconcile on the next compositor frame.
    applyFocus(selectExistingText);
    const valueBeforeRetry = inputRef.current?.value ?? '';
    inputFocusFrameRef.current = window.requestAnimationFrame(() => {
      inputFocusFrameRef.current = null;
      // Never re-select text after the user has already started typing; doing so
      // can replace the first IME/keyboard character during a close/reopen race.
      applyFocus(selectExistingText && inputRef.current?.value === valueBeforeRetry);
    });
  }, [cancelScheduledInputFocus]);

  const reportHandoffMilestone = useCallback(
    (handoffId: number, milestone: 'open-armed' | 'open-finished' | 'close-finished') => {
      const report = window.customerAgent?.reportHandoffMilestone;
      if (!report || handoffId <= 0) {
        return;
      }
      void report(handoffId, milestone).catch(() => {
        // Main owns a bounded fallback timer; renderer failure cannot strand a window.
      });
    },
    [],
  );

  const finishOpening = useCallback(() => {
    if (!openingRef.current) {
      return;
    }
    openingRef.current = false;
    setOpening(false);
    if (!openingUserInteractionRef.current) {
      // A mapped macOS panel can assign passive focus to a non-input node.
      // Restore the primary contract unless the user actually interacted with
      // a Query control during the opening transition.
      focusQueryInput(false);
    }
    reportHandoffMilestone(activeHandoffIdRef.current, 'open-finished');
  }, [focusQueryInput, reportHandoffMilestone]);

  const reportPhase = useCallback((next: OverlayPhase, resultCount: ResultCount = 0) => {
    setPhase(next);
    resultCountRef.current = resultCount;
    if (next === 'SEARCH_INPUT') {
      setLayoutReady(true);
    } else if (next !== 'COPIED' && next !== 'FOX_IDLE' && window.customerAgent?.reportQueryLayout) {
      setLayoutReady(false);
    }
    if (next !== 'FOX_IDLE') {
      void window.customerAgent?.reportUiPhase(next, resultCount);
    }
  }, []);

  const requestQueryLayout = useCallback((phase: OverlayPhase, resultCount: ResultCount) => {
    if (
      !isQueryContentLayoutPhase(phase)
      || opening
      || closing
      || !resizeFinishedRef.current
    ) {
      return;
    }
    const api = window.customerAgent;
    const report = api?.reportQueryLayout;
    if (!report) {
      setLayoutReady(true);
      return;
    }
    const shell = shellRef.current;
    const pane = resultPaneRef.current;
    const content = resultContentRef.current;
    const banner = bannerRef.current;
    const capsule = shell?.querySelector<HTMLElement>('.query-capsule');
    const lastCard = pane?.querySelector<HTMLElement>('.script-card:last-of-type');
    const lastCopy = lastCard?.querySelector<HTMLElement>('.copy-btn');
    const lastContentBottom = maxContentBottom([
      lastCard,
      lastCopy,
      banner,
      content?.lastElementChild ?? null,
    ]);
    const panePad = pane
      ? Number.parseFloat(getComputedStyle(pane).paddingBottom) || 0
      : 0;
    const paneBorder = pane
      ? Number.parseFloat(getComputedStyle(pane).borderTopWidth) || 0
      : 0;
    const intrinsic = composeQueryDesiredHeight({
      capsuleHeight: capsule?.offsetHeight ?? QUERY_INPUT_HEIGHT,
      bannerHeight: banner?.offsetHeight ?? 0,
      contentScrollHeight: Math.max(
        content?.scrollHeight ?? 0,
        banner?.offsetHeight ?? 0,
      ),
      chromeExtra: paneBorder + QUERY_CONTENT_BLANK_TOLERANCE_PX,
    });
    const hugged = shell
      ? measureQueryHugHeight({
          shellTop: shell.getBoundingClientRect().top,
          paneTop: pane?.getBoundingClientRect().top,
          paneScrollHeight: Math.max(
            pane?.scrollHeight ?? 0,
            (content?.scrollHeight ?? 0) + panePad,
          ),
          panePaddingBottom: panePad,
          lastContentBottom: lastContentBottom > 0 ? lastContentBottom : undefined,
        })
      : intrinsic;
    const measuredFromDom = lastContentBottom > 0 ? hugged : intrinsic;
    const request: QueryLayoutRequest = {
      sessionId: activeHandoffIdRef.current,
      sequence: ++layoutSequenceRef.current,
      phase,
      resultCount,
      desiredHeight: measuredFromDom,
    };
    void report(request).then((ack) => {
      if (!acceptQueryLayoutAck({
        ack,
        requestSessionId: request.sessionId,
        requestSequence: request.sequence,
        minSequence: lastAppliedLayoutSequenceRef.current,
        activeSessionId: activeHandoffIdRef.current,
        currentPhase: phaseRef.current,
        currentResultCount: resultCountRef.current,
      })) {
        return;
      }
      lastAppliedLayoutSequenceRef.current = ack.sequence;
      layoutSequenceRef.current = Math.max(layoutSequenceRef.current, ack.sequence);
      setResizeEdge(ack.resizeEdge);
      setQueryHeight(ack.height);
      setLayoutReady(true);
    }).catch(() => undefined);
  }, [closing, opening]);

  useEffect(() => {
    const api = window.customerAgent;
    if (!api) {
      return;
    }

    void api
      .getPlatform()
      .then((info) => {
        if (info.platform) {
          setPlatform(info.platform);
        }
      })
      .catch(() => {
        // Keep Windows-first shortcut label.
      });

    void api
      .getWindowContext()
      .then((context) => {
        if (!context.shortcut.registered) {
          setShortcutFailed(true);
          setShortcutHint(context.shortcut.message);
        }
      })
      .catch(() => {
        // Click path still works.
      });

    return api.onOverlayCommand((command) => {
      if (command.type === 'prepare-search') {
        cancelScheduledOpening();
        cancelScheduledInputFocus();
        cancelScheduledCollapseContent(true);
        activeHandoffIdRef.current = command.handoffId;
        queryInteractiveRef.current = false;
        openingRef.current = false;
        openingUserInteractionRef.current = false;
        searchGenerationRef.current += 1;
        searchInFlightRef.current = false;
        if (searchTimerRef.current !== null) {
          window.clearTimeout(searchTimerRef.current);
          searchTimerRef.current = null;
        }
        setSearching(false);
        (document.activeElement as HTMLElement | null)?.blur?.();
        flushSync(() => {
          setAnchor(command.anchor);
          setHandoffGeometry(
            queryHandoffGeometry(
              QUERY_WIDTH,
              QUERY_INPUT_HEIGHT,
              command.anchor,
              'none',
              { x: command.handoffCenterX, y: command.handoffCenterY },
            ),
          );
          setHandoffFoxTransform(command.foxVisualTransform);
          setParked(true);
          setOpening(false);
          setClosing(false);
          setPhase('SEARCH_INPUT');
          setQuery('');
          setResults([]);
          setInvalidMessage('');
          setErrorMessage('');
          setDeepThinkingInfoOpen(false);
          setLayoutReady(true);
          layoutSequenceRef.current = 0;
          lastAppliedLayoutSequenceRef.current = 0;
          resultCountRef.current = 0;
        });
        // With backgroundThrottling disabled for the hidden Query window, this
        // rAF is a real layout/paint barrier rather than an arbitrary delay.
        openingFrameRef.current = window.requestAnimationFrame(() => {
          openingFrameRef.current = null;
          if (activeHandoffIdRef.current === command.handoffId) {
            reportHandoffMilestone(command.handoffId, 'open-armed');
          }
        });
        return;
      }
      if (command.type === 'activate-search') {
        cancelScheduledOpening();
        cancelScheduledCollapseContent(true);
        if (command.handoffId !== undefined) {
          if (command.handoffId !== activeHandoffIdRef.current) {
            return;
          }
        } else {
          setHandoffGeometry(
            queryHandoffGeometry(QUERY_WIDTH, QUERY_INPUT_HEIGHT, command.anchor),
          );
        }
        queryInteractiveRef.current = true;
        openingRef.current = command.animate;
        openingUserInteractionRef.current = false;
        flushSync(() => {
          setAnchor(command.anchor);
          setClosing(false);
          setParked(false);
          setOpening(command.animate);
          setPhase((current) => (current === 'FOX_IDLE' ? 'SEARCH_INPUT' : current));
          setInvalidMessage('');
        });
        focusQueryInput();
        if (!command.animate && command.handoffId !== undefined) {
          reportHandoffMilestone(command.handoffId, 'open-finished');
        }
        return;
      }
      if (command.type === 'sync-query-anchor') {
        setAnchor(command.anchor);
        return;
      }
      if (command.type === 'collapse') {
        cancelScheduledOpening();
        cancelScheduledInputFocus();
        cancelScheduledCollapseContent(false);
        if (command.handoffId !== undefined) {
          activeHandoffIdRef.current = command.handoffId;
        }
        queryInteractiveRef.current = false;
        openingRef.current = false;
        openingUserInteractionRef.current = false;
        (document.activeElement as HTMLElement | null)?.blur?.();
        flushSync(() => {
          setAnchor(command.anchor);
          setHandoffGeometry(
            queryHandoffGeometry(
              QUERY_WIDTH,
              Math.max(QUERY_INPUT_HEIGHT, window.innerHeight),
              command.anchor,
              command.dockEdge,
              { x: command.handoffCenterX, y: command.handoffCenterY },
            ),
          );
          setLayoutReady(true);
          layoutSequenceRef.current = 0;
          lastAppliedLayoutSequenceRef.current = 0;
          resultCountRef.current = 0;
          setOpening(false);
          // Animated closes keep the shared fox visible until the shell reaches
          // its handoff frame; no-motion closes park immediately.
          setParked(!command.animate);
          setClosing(command.animate);
        });
        cancelScheduledResultFocus();
        searchGenerationRef.current += 1;
        copyGenerationRef.current += 1;
        searchInFlightRef.current = false;
        if (searchTimerRef.current !== null) {
          window.clearTimeout(searchTimerRef.current);
          searchTimerRef.current = null;
        }
        if (dismissTimerRef.current !== null) {
          window.clearTimeout(dismissTimerRef.current);
          dismissTimerRef.current = null;
        }
        copyInFlightRef.current = false;
        pendingCopyRef.current = null;
        composingRef.current = false;
        setQuery('');
        setCopying(false);
        setSearching(false);
        setInvalidMessage('');
        setDeepThinkingInfoOpen(false);
        if (command.animate) {
          collapseCleanupTimerRef.current = window.setTimeout(() => {
            collapseCleanupTimerRef.current = null;
            finishCollapseContent();
          }, QUERY_CONTENT_EXIT_DURATION_MS);
        } else {
          finishCollapseContent();
          if (command.handoffId !== undefined) {
            reportHandoffMilestone(command.handoffId, 'close-finished');
          }
        }
        return;
      }
      if (command.type === 'query-layout-ack') {
        const ack: QueryLayoutAck = {
          ok: true,
          sessionId: command.sessionId,
          sequence: command.sequence,
          phase: command.phase,
          resultCount: command.resultCount,
          height: command.height,
          resizeEdge: command.resizeEdge,
        };
        if (!acceptQueryLayoutAck({
          ack,
          minSequence: lastAppliedLayoutSequenceRef.current,
          activeSessionId: activeHandoffIdRef.current,
          currentPhase: phaseRef.current,
          currentResultCount: resultCountRef.current,
        })) {
          return;
        }
        lastAppliedLayoutSequenceRef.current = ack.sequence;
        layoutSequenceRef.current = Math.max(layoutSequenceRef.current, ack.sequence);
        setResizeEdge(ack.resizeEdge);
        setQueryHeight(ack.height);
        setLayoutReady(true);
        return;
      }
      if (command.type === 'shortcut-status' && !command.registered) {
        setShortcutFailed(true);
        setShortcutHint(command.message);
      }
    });
  }, [
    cancelScheduledCollapseContent,
    cancelScheduledInputFocus,
    cancelScheduledOpening,
    cancelScheduledResultFocus,
    finishCollapseContent,
    focusQueryInput,
    reportHandoffMilestone,
  ]);

  useLayoutEffect(() => {
    if (opening || closing) {
      return undefined;
    }
    if (!isQueryContentLayoutPhase(phase)) {
      hugPassRef.current = 0;
      return undefined;
    }
    if (layoutReady) {
      return undefined;
    }
    hugPassRef.current = 1;
    layoutFrameRef.current = window.requestAnimationFrame(() => {
      layoutFrameRef.current = null;
      requestQueryLayout(phase, results.length as ResultCount);
    });
    return () => {
      if (layoutFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutFrameRef.current);
        layoutFrameRef.current = null;
      }
    };
  }, [closing, layoutReady, opening, phase, requestQueryLayout, results.length]);

  useEffect(() => {
    if (!layoutReady || opening || closing) {
      return undefined;
    }
    if (!isQueryContentLayoutPhase(phase)) {
      hugPassRef.current = 0;
      return undefined;
    }
    if (hugPassRef.current !== 1) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const pane = resultPaneRef.current;
      const lastContent = pane?.querySelector<HTMLElement>(
        '.script-card:last-of-type, .status-banner',
      );
      const overflowed = Boolean(
        pane &&
          lastContent &&
          (lastContent.getBoundingClientRect().bottom > pane.getBoundingClientRect().bottom + 0.5
            || pane.scrollHeight > pane.clientHeight + 0.5),
      );
      hugPassRef.current = 2;
      if (overflowed && resizeFinishedRef.current) {
        requestQueryLayout(phase, results.length as ResultCount);
      }
    }, 32);
    return () => window.clearTimeout(timer);
  }, [closing, layoutReady, opening, phase, queryHeight, requestQueryLayout, results.length]);

  useEffect(() => {
    if (!opening) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      finishOpening();
    }, QUERY_OPEN_DURATION_MS + 48);
    return () => window.clearTimeout(timer);
  }, [finishOpening, opening]);

  useEffect(() => {
    if (layoutReady || opening || closing) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setLayoutReady(true);
    }, QUERY_LAYOUT_FALLBACK_MS + 80);
    return () => window.clearTimeout(timer);
  }, [closing, layoutReady, opening]);

  useEffect(() => {
    const restoreInputFocus = () => {
      if (queryInteractiveRef.current) {
        // Reconcile native keyboard routing without selecting existing text;
        // otherwise returning from another app makes the next key overwrite it.
        focusQueryInput(false);
      }
    };
    window.addEventListener('focus', restoreInputFocus);
    return () => window.removeEventListener('focus', restoreInputFocus);
  }, [focusQueryInput]);

  useEffect(
    () => () => {
      searchGenerationRef.current += 1;
      copyGenerationRef.current += 1;
      searchInFlightRef.current = false;
      copyInFlightRef.current = false;
      cancelScheduledOpening();
      cancelScheduledInputFocus();
      cancelScheduledCollapseContent(false);
      cancelScheduledResultFocus();
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
      }
    },
    [
      cancelScheduledCollapseContent,
      cancelScheduledInputFocus,
      cancelScheduledOpening,
      cancelScheduledResultFocus,
    ],
  );

  useEffect(() => {
    if (phase === 'RESULTS' && results.length > 0) {
      scheduleResultFocus();
    }
  }, [phase, results.length, scheduleResultFocus]);

  const cancelPendingSearch = useCallback(() => {
    searchGenerationRef.current += 1;
    searchInFlightRef.current = false;
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setSearching(false);
  }, []);

  const cancelPendingCopy = useCallback(() => {
    copyGenerationRef.current += 1;
    copyInFlightRef.current = false;
    pendingCopyRef.current = null;
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setCopying(false);
    setCopiedRank(null);
  }, []);

  const changeQuery = useCallback(
    (nextQuery: string) => {
      cancelScheduledResultFocus();
      cancelPendingSearch();
      cancelPendingCopy();
      setQuery(nextQuery);
      setResults([]);
      setErrorMessage('');
      setInvalidMessage('');
      if (phase !== 'SEARCH_INPUT') {
        reportPhase('SEARCH_INPUT');
      }
    },
    [cancelPendingCopy, cancelPendingSearch, cancelScheduledResultFocus, phase, reportPhase],
  );

  const runSearch = useCallback(() => {
    dashboardOpenFailedRef.current = false;
    if (searchInFlightRef.current) {
      return;
    }
    const liveQuery = inputRef.current?.value ?? query;
    const trimmed = liveQuery.trim();
    if (!trimmed) {
      setResults([]);
      setCopiedRank(null);
      setInvalidMessage(EMPTY_QUERY_MESSAGE);
      reportPhase(reduceOverlay(phase, { type: 'QUERY_BLANK' }));
      return;
    }

    if (liveQuery.length > MAX_QUERY_CHARS) {
      setResults([]);
      setCopiedRank(null);
      setInvalidMessage(QUERY_TOO_LONG_MESSAGE);
      reportPhase(reduceOverlay(phase, { type: 'QUERY_BLANK' }));
      return;
    }

    setInvalidMessage('');
    setErrorMessage('');
    cancelPendingCopy();
    cancelScheduledResultFocus();
    reportPhase('SEARCH_INPUT');
    searchInFlightRef.current = true;
    setSearching(true);
    setResults([]);
    const generation = ++searchGenerationRef.current;

    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      if (generation !== searchGenerationRef.current) {
        return;
      }
      try {
        const outcome = searchScripts(trimmed);
        if (outcome.status === 'invalid') {
          setResults([]);
          setInvalidMessage(QUERY_TOO_LONG_MESSAGE);
          reportPhase('SEARCH_INPUT');
          return;
        }
        if (outcome.status === 'no-hit') {
          setResults([]);
          reportPhase('EMPTY');
          window.requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
          });
          return;
        }
        setResults(outcome.results);
        reportPhase('RESULTS', outcome.results.length as ResultCount);
      } catch {
        setResults([]);
        setErrorMessage('本地检索失败，请重试。当前 Demo 未连接外部服务。');
        reportPhase('ERROR');
      } finally {
        if (generation === searchGenerationRef.current) {
          searchInFlightRef.current = false;
          setSearching(false);
        }
      }
    }, SEARCH_FEEDBACK_MS);
  }, [cancelPendingCopy, cancelScheduledResultFocus, phase, query, reportPhase]);

  const copyScript = useCallback(
    async (script: RankedScript, trigger: HTMLButtonElement | null = null) => {
      if (
        copyInFlightRef.current ||
        phase === 'COPIED' ||
        dismissTimerRef.current !== null
      ) {
        return;
      }
      copyInFlightRef.current = true;
      const copyGeneration = copyGenerationRef.current;
      pendingCopyRef.current = script;
      if (trigger) {
        trigger.focus();
      }

      const api = window.customerAgent;
      const resultCount = results.length as ResultCount;
      if (!api) {
        setErrorMessage('复制通道不可用，请在桌面 Demo 中重试');
        reportPhase('ERROR', resultCount);
        copyInFlightRef.current = false;
        return;
      }

      setCopying(true);
      try {
        const result = await api.copyText(script.answerText);
        if (copyGeneration !== copyGenerationRef.current) {
          return;
        }
        if (result.ok) {
          setCopiedRank(script.rank);
          setErrorMessage('');
          reportPhase('COPIED', resultCount);
          dismissTimerRef.current = window.setTimeout(() => {
            dismissTimerRef.current = null;
            if (copyGeneration === copyGenerationRef.current) {
              void window.customerAgent?.dismiss();
            }
          }, COPY_FEEDBACK_MS);
          return;
        }
        setErrorMessage(result.message || '复制失败，请重试');
        reportPhase('ERROR', resultCount);
      } catch {
        if (copyGeneration !== copyGenerationRef.current) {
          return;
        }
        setErrorMessage('复制失败，请重试');
        reportPhase('ERROR', resultCount);
      } finally {
        if (copyGeneration === copyGenerationRef.current) {
          copyInFlightRef.current = false;
          setCopying(false);
        }
      }
    },
    [phase, reportPhase, results.length],
  );

  const openDashboard = useCallback(() => {
    dashboardOpenFailedRef.current = false;
    const request = window.customerAgent?.openDashboard();
    const failOpen = (): void => {
      dashboardOpenFailedRef.current = true;
      setErrorMessage('工作台未打开，请重试。查询窗口仍保持可用。');
      reportPhase('ERROR', results.length as ResultCount);
    };
    if (!request) {
      failOpen();
      return;
    }
    void Promise.resolve(request).then((result) => {
      if (!result || result.ok !== true) {
        failOpen();
        return;
      }
      dashboardOpenFailedRef.current = false;
      setErrorMessage('');
      if (phaseRef.current === 'ERROR') {
        const resultCount = results.length as ResultCount;
        reportPhase(resultCount > 0 ? 'RESULTS' : 'SEARCH_INPUT', resultCount);
      }
    }).catch(() => {
      failOpen();
    });
  }, [reportPhase, results.length]);

  const retry = useCallback(() => {
    if (dashboardOpenFailedRef.current) {
      openDashboard();
      return;
    }
    if (pendingCopyRef.current && errorMessage.includes('复制')) {
      void copyScript(pendingCopyRef.current);
      return;
    }
    runSearch();
  }, [copyScript, errorMessage, openDashboard, runSearch]);

  const dismiss = useCallback(() => {
    void window.customerAgent?.dismiss();
  }, []);

  const drag = useWindowDrag(
    (dx, dy, finished) => {
      void window.customerAgent?.moveFoxBy(dx, dy, finished);
    },
    dismiss,
  );

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      if (
        phase !== 'RESULTS' ||
        searchInFlightRef.current ||
        searching ||
        copying ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isImeComposing(event) ||
        isInteractiveTarget(event.target)
      ) {
        return;
      }
      const rank = resultCopyRankFromKey(event.code, event.key);
      if (rank === null) {
        return;
      }
      const script = results[rank - 1];
      if (!script) {
        return;
      }
      event.preventDefault();
      void copyScript(script);
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, [copyScript, copying, dismiss, phase, results, searching]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (composingRef.current || !shouldSubmitOnEnter(event)) {
      return;
    }
    event.preventDefault();
    runSearch();
  };

  const showQueryResizeGrip = isQueryContentLayoutPhase(phase);
  const expanded = showQueryResizeGrip || phase === 'COPIED';

  const applyQueryResizeAck = useCallback((
    ack: QueryLayoutAck | null | undefined,
    request: { sessionId: number; sequence: number },
  ) => {
    if (!acceptQueryLayoutAck({
      ack,
      requestSessionId: request.sessionId,
      requestSequence: request.sequence,
      minSequence: lastAppliedLayoutSequenceRef.current,
      activeSessionId: activeHandoffIdRef.current,
      currentPhase: phaseRef.current,
      currentResultCount: resultCountRef.current,
    }) || !ack) {
      return;
    }
    lastAppliedLayoutSequenceRef.current = ack.sequence;
    layoutSequenceRef.current = Math.max(layoutSequenceRef.current, ack.sequence);
    setResizeEdge(ack.resizeEdge);
    setQueryHeight(ack.height);
  }, []);

  const releaseQueryResizeCapture = useCallback((pointerId: number | null) => {
    const grip = resizeGripRef.current;
    if (pointerId === null || !grip) {
      return;
    }
    try {
      if (grip.hasPointerCapture?.(pointerId)) {
        grip.releasePointerCapture(pointerId);
      }
    } catch {
      // Capture may already have been released by the host.
    }
  }, []);

  const finishQueryResize = useCallback((
    kind: 'end' | 'cancel',
    pointerId?: number,
    options?: { alreadyLost?: boolean },
  ) => {
    if (resizeFinishedRef.current) {
      return;
    }
    if (pointerId !== undefined && resizePointerRef.current !== pointerId) {
      return;
    }
    resizeFinishedRef.current = true;
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    const captured = resizePointerRef.current;
    resizePointerRef.current = null;
    if (!options?.alreadyLost) {
      releaseQueryResizeCapture(captured);
    }
    const api = window.customerAgent?.resizeQueryHeight;
    if (!api || activeHandoffIdRef.current <= 0) {
      return;
    }
    const request = {
      type: kind,
      sessionId: activeHandoffIdRef.current,
      sequence: ++layoutSequenceRef.current,
      phase: phaseRef.current,
    };
    void api({
      type: kind,
      sessionId: request.sessionId,
      sequence: request.sequence,
    }).then((ack) => {
      applyQueryResizeAck(ack, request);
    }).catch(() => undefined);
  }, [applyQueryResizeAck, releaseQueryResizeCapture]);

  const startQueryResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (parked || opening || closing || !showQueryResizeGrip) {
      return;
    }
    if (typeof event.button === 'number' && event.button !== 0) {
      return;
    }
    if (resizePointerRef.current !== null && !resizeFinishedRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    resizeGripRef.current = event.currentTarget;
    resizeFinishedRef.current = false;
    resizePointerRef.current = event.pointerId;
    resizeOriginYRef.current = event.screenY;
    resizeDeltaRef.current = 0;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const request = {
      type: 'begin' as const,
      sessionId: activeHandoffIdRef.current,
      sequence: ++layoutSequenceRef.current,
      phase: phaseRef.current,
    };
    void window.customerAgent?.resizeQueryHeight?.({
      type: 'begin',
      sessionId: request.sessionId,
      sequence: request.sequence,
    }).then((ack) => {
      applyQueryResizeAck(ack, request);
    }).catch(() => undefined);
  };

  const moveQueryResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (resizeFinishedRef.current || resizePointerRef.current !== event.pointerId) {
      return;
    }
    if (typeof event.buttons === 'number' && (event.buttons & 1) === 0) {
      finishQueryResize('cancel', event.pointerId);
      return;
    }
    // The preload/Main contract accepts finite integers only. Pointer
    // coordinates can be fractional on scaled displays, so normalize once at
    // the renderer boundary instead of silently rejecting a valid drag frame.
    resizeDeltaRef.current = Math.round(event.screenY - resizeOriginYRef.current);
    if (resizeFrameRef.current !== null) {
      return;
    }
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      if (resizeFinishedRef.current) {
        return;
      }
      const request = {
        sessionId: activeHandoffIdRef.current,
        sequence: ++layoutSequenceRef.current,
        phase: phaseRef.current,
      };
      void window.customerAgent?.resizeQueryHeight?.({
        type: 'update',
        sessionId: request.sessionId,
        sequence: request.sequence,
        deltaY: resizeDeltaRef.current,
      }).then((ack) => {
        applyQueryResizeAck(ack, request);
      }).catch(() => undefined);
    });
  };

  const handleQueryResizeKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== 'ArrowUp' &&
      event.key !== 'ArrowDown' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    event.preventDefault();
    const request = {
      sessionId: activeHandoffIdRef.current,
      sequence: ++layoutSequenceRef.current,
      phase: phaseRef.current,
    };
    void window.customerAgent?.resizeQueryHeight?.({
      type: 'keyboard',
      sessionId: request.sessionId,
      sequence: request.sequence,
      key: event.key,
      shiftKey: event.shiftKey,
    }).then((ack) => {
      applyQueryResizeAck(ack, request);
    }).catch(() => undefined);
  };

  useEffect(() => {
    const abort = () => finishQueryResize('cancel');
    const onWindowPointerUp = (event: PointerEvent) => {
      finishQueryResize('end', event.pointerId);
    };
    const onWindowPointerCancel = (event: PointerEvent) => {
      finishQueryResize('cancel', event.pointerId);
    };
    window.addEventListener('blur', abort);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerCancel);
    return () => {
      window.removeEventListener('blur', abort);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
    };
  }, [finishQueryResize]);

  useEffect(() => () => {
    finishQueryResize('cancel');
  }, [finishQueryResize]);

  const shortcutLabel = formatAcceleratorLabel('CommandOrControl+Shift+Space', platform);
  const foxVisualState = queryFoxVisualState(searching, phase);

  return (
    <div
      className={queryShellClassName({
        expanded,
        parked,
        opening,
        closing,
        layoutReady,
      })}
      style={queryHandoffCssVars({
        geometry: handoffGeometry,
        foxTransform: handoffFoxTransform,
        anchor,
      })}
      ref={shellRef}
      data-testid="query-shell"
      data-phase={phase}
      data-window-role="query"
      data-anchor={anchor}
      data-layout-ready={layoutReady ? 'true' : 'false'}
      data-resize-edge={resizeEdge}
      data-parked={parked ? 'true' : 'false'}
      data-opening={opening ? 'true' : 'false'}
      data-closing={closing ? 'true' : 'false'}
      data-open-duration-ms={QUERY_OPEN_DURATION_MS}
      data-close-duration-ms={QUERY_CLOSE_DURATION_MS}
      data-handoff-id={activeHandoffIdRef.current}
      aria-busy={searching}
      onPointerDownCapture={() => {
        if (openingRef.current) {
          openingUserInteractionRef.current = true;
        }
      }}
      onKeyDownCapture={() => {
        if (openingRef.current) {
          openingUserInteractionRef.current = true;
        }
      }}
    >
      <div
        className="glass-shell"
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          if (event.animationName === 'query-shell-unfold') {
            finishOpening();
          }
          if (event.animationName === 'query-shell-fold') {
            flushSync(() => {
              setParked(true);
              setClosing(false);
            });
            reportHandoffMilestone(activeHandoffIdRef.current, 'close-finished');
          }
        }}
      >
        <div className="glass-surface" aria-hidden="true" />
        <QueryCapsule
          foxVisualState={foxVisualState}
          foxDrag={drag}
          deepThinkingInfoOpen={deepThinkingInfoOpen}
          deepThinkingDescription={DEEP_THINKING_DESCRIPTION}
          query={query}
          inputRef={inputRef}
          invalidMessage={invalidMessage}
          shortcutFailed={shortcutFailed}
          shortcutLabel={shortcutLabel}
          searching={searching}
          onCancelScheduledResultFocus={cancelScheduledResultFocus}
          onCancelScheduledInputFocus={cancelScheduledInputFocus}
          onChangeQuery={changeQuery}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={onKeyDown}
          onOpenDashboard={openDashboard}
          onToggleDeepThinking={() => setDeepThinkingInfoOpen((current) => !current)}
          onSearch={runSearch}
        />

        {shortcutFailed ? (
          <p ref={bannerRef} className="shortcut-banner" data-testid="shortcut-fallback">
            {shortcutHint || '全局快捷键注册失败，请点击狐狸头打开。'}
          </p>
        ) : null}

        {expanded ? (
          <QueryResultsPane
            phase={phase}
            resultPaneRef={resultPaneRef}
            bannerRef={bannerRef}
            resultContentRef={resultContentRef}
            errorMessage={errorMessage}
            results={results}
            copying={copying}
            copiedRank={copiedRank}
            onRetry={retry}
            onCopy={(item, trigger) => {
              void copyScript(item, trigger);
            }}
          />
        ) : null}
        {showQueryResizeGrip ? (
          <div
            ref={resizeGripRef}
            className="query-resize-grip"
            role="separator"
            aria-orientation="horizontal"
            aria-label="调整查询窗高度"
            aria-valuemin={QUERY_LAYOUT_MIN_HEIGHT}
            aria-valuemax={QUERY_LAYOUT_MAX_HEIGHT}
            aria-valuenow={queryHeight}
            aria-valuetext={`${queryHeight} 像素`}
            data-edge={resizeEdge}
            data-testid="query-resize-grip"
            tabIndex={0}
            onPointerDown={startQueryResize}
            onPointerMove={moveQueryResize}
            onPointerUp={(event) => {
              if (resizePointerRef.current !== event.pointerId) return;
              finishQueryResize('end', event.pointerId);
            }}
            onPointerCancel={(event) => {
              if (resizePointerRef.current !== event.pointerId) return;
              finishQueryResize('cancel', event.pointerId);
            }}
            onLostPointerCapture={(event) => {
              if (resizePointerRef.current !== event.pointerId) return;
              finishQueryResize('cancel', event.pointerId, { alreadyLost: true });
            }}
            onKeyDown={handleQueryResizeKey}
          />
        ) : null}
      </div>
    </div>
  );
}
