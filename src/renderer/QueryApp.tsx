import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import {
  COPY_SUCCESS_MESSAGE,
  EMPTY_QUERY_MESSAGE,
  MAX_QUERY_CHARS,
  QUERY_TOO_LONG_MESSAGE,
} from '@shared/contracts';
import { formatAcceleratorLabel } from '@shared/shortcut';
import {
  QUERY_CLOSE_DURATION_MS,
  QUERY_CONTENT_EXIT_DURATION_MS,
  QUERY_FOX_CENTER_OFFSET_PX,
  QUERY_HANDOFF_SIZE_PX,
  QUERY_OPEN_DURATION_MS,
  queryHandoffGeometry,
} from '@shared/fox-motion';
import { QUERY_INPUT_HEIGHT, QUERY_WIDTH } from '@shared/overlay-geometry';
import {
  IDENTITY_FOX_VISUAL_TRANSFORM,
  type FoxVisualTransform,
  type QueryAnchor,
  type ResultCount,
} from '@shared/overlay-events';
import { reduceOverlay, type OverlayPhase } from '@shared/overlay-machine';
import { FoxHead } from './components/FoxHead';
import { ScriptCard } from './features/search/ScriptCard';
import { searchScripts } from './features/search/search-service';
import type { RankedScript } from './features/search/types';
import { isImeComposing, shouldSubmitOnEnter } from './lib/ime';
import { isInteractiveTarget } from './lib/is-interactive-target';
import { useWindowDrag } from './lib/use-window-drag';

const SEARCH_FEEDBACK_MS = 280;
const COPY_FEEDBACK_MS = 900;
const DEEP_THINKING_DESCRIPTION =
  'DeepSeek 仅作辅助重排预留，当前 OFF、未接入；不生成、不改写、不发送。';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const resultPaneRef = useRef<HTMLElement>(null);
  const composingRef = useRef(false);
  const copyInFlightRef = useRef(false);
  const searchInFlightRef = useRef(false);
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

  const reportPhase = useCallback((next: OverlayPhase, resultCount: ResultCount = 0) => {
    setPhase(next);
    if (next !== 'FOX_IDLE') {
      void window.customerAgent?.reportUiPhase(next, resultCount);
    }
  }, []);

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
        (document.activeElement as HTMLElement | null)?.blur?.();
        flushSync(() => {
          setAnchor(command.anchor);
          setHandoffGeometry(
            queryHandoffGeometry(
              QUERY_WIDTH,
              Math.max(QUERY_INPUT_HEIGHT, window.innerHeight),
              command.anchor,
              command.dockEdge,
            ),
          );
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
    if (searchInFlightRef.current) {
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setCopiedRank(null);
      setInvalidMessage(EMPTY_QUERY_MESSAGE);
      reportPhase(reduceOverlay(phase, { type: 'QUERY_BLANK' }));
      return;
    }

    if (query.length > MAX_QUERY_CHARS) {
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

  const retry = useCallback(() => {
    if (pendingCopyRef.current && errorMessage.includes('复制')) {
      void copyScript(pendingCopyRef.current);
      return;
    }
    runSearch();
  }, [copyScript, errorMessage, runSearch]);

  const dismiss = useCallback(() => {
    void window.customerAgent?.dismiss();
  }, []);

  const openDashboard = useCallback(() => {
    void window.customerAgent?.openDashboard();
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
      const rank = event.code.startsWith('Numpad') ? event.code.slice(-1) : event.key;
      if (rank !== '1' && rank !== '2' && rank !== '3') {
        return;
      }
      const script = results[Number(rank) - 1];
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

  const expanded = phase === 'RESULTS' || phase === 'EMPTY' || phase === 'ERROR' || phase === 'COPIED';
  const shortcutLabel = formatAcceleratorLabel('CommandOrControl+Shift+Space', platform);
  const foxVisualState = searching
    ? 'SEARCHING'
    : phase === 'RESULTS'
      ? 'RESULTS'
      : phase === 'EMPTY'
        ? 'EMPTY'
        : phase === 'COPIED'
          ? 'COPIED'
          : 'IDLE';

  return (
    <div
      className={[
        expanded ? 'query-shell is-expanded' : 'query-shell',
        parked ? 'is-parked' : '',
        opening ? 'is-opening' : '',
        closing ? 'is-closing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--query-open-duration': `${QUERY_OPEN_DURATION_MS}ms`,
          '--query-close-duration': `${QUERY_CLOSE_DURATION_MS}ms`,
          '--query-content-exit-duration': `${QUERY_CONTENT_EXIT_DURATION_MS}ms`,
          '--query-handoff-scale-x': handoffGeometry.scaleX,
          '--query-handoff-scale-y': handoffGeometry.scaleY,
          '--query-handoff-origin-x': `${handoffGeometry.originX}px`,
          '--query-handoff-origin-y': `${handoffGeometry.originY}px`,
          '--query-handoff-clip-top': `${handoffGeometry.clipTop}px`,
          '--query-handoff-clip-right': `${handoffGeometry.clipRight}px`,
          '--query-handoff-clip-bottom': `${handoffGeometry.clipBottom}px`,
          '--query-handoff-clip-left': `${handoffGeometry.clipLeft}px`,
          '--query-handoff-fox-translate-x': `${
            handoffGeometry.clipLeft +
            QUERY_HANDOFF_SIZE_PX / 2 -
            (anchor === 'left'
              ? QUERY_FOX_CENTER_OFFSET_PX
              : QUERY_WIDTH - QUERY_FOX_CENTER_OFFSET_PX)
          }px`,
          '--query-handoff-fox-translate-y': `${
            handoffGeometry.clipTop +
            QUERY_HANDOFF_SIZE_PX / 2 -
            QUERY_FOX_CENTER_OFFSET_PX
          }px`,
          '--query-handoff-fox-a': handoffFoxTransform.a,
          '--query-handoff-fox-b': handoffFoxTransform.b,
          '--query-handoff-fox-c': handoffFoxTransform.c,
          '--query-handoff-fox-d': handoffFoxTransform.d,
          '--query-handoff-fox-e': handoffFoxTransform.e,
          '--query-handoff-fox-f': handoffFoxTransform.f,
        } as CSSProperties
      }
      data-testid="query-shell"
      data-phase={phase}
      data-window-role="query"
      data-anchor={anchor}
      data-parked={parked ? 'true' : 'false'}
      data-opening={opening ? 'true' : 'false'}
      data-closing={closing ? 'true' : 'false'}
      data-open-duration-ms={QUERY_OPEN_DURATION_MS}
      data-close-duration-ms={QUERY_CLOSE_DURATION_MS}
      data-handoff-id={activeHandoffIdRef.current}
      aria-busy={searching}
    >
      <div
        className="glass-shell"
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          if (event.animationName === 'query-shell-unfold') {
            setOpening(false);
            reportHandoffMilestone(activeHandoffIdRef.current, 'open-finished');
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
        <div className="query-capsule">
          <button
            type="button"
            className="capsule-fox"
            data-testid="capsule-fox"
            data-fox-state={foxVisualState}
            aria-label="点击收起查询，拖拽移动查询窗"
            title="点击收起 · 拖拽移动"
            {...drag}
          >
            <FoxHead size={64} className={`is-query-${foxVisualState.toLowerCase()}`} />
          </button>
          <div className="capsule-field">
            <label className="sr-only" htmlFor="customer-question">
              客户问题
            </label>
            {deepThinkingInfoOpen ? (
              <div
                id="deep-thinking-panel"
                className="deep-thinking-note"
                data-testid="deep-thinking-panel"
                role="note"
              >
                <strong>DeepSeek 辅助重排预留</strong>
                <span>当前 OFF · 未接入 · 不生成 · 不改写 · 不发送</span>
              </div>
            ) : (
              <input
                id="customer-question"
                ref={inputRef}
                className="capsule-input"
                data-testid="question-input"
                value={query}
                maxLength={MAX_QUERY_CHARS}
                autoComplete="off"
                aria-describedby="query-guidance"
                aria-invalid={invalidMessage ? true : undefined}
                spellCheck={false}
                placeholder="输入或粘贴客户问题，回车查询"
                onPointerDown={cancelScheduledResultFocus}
                onFocus={cancelScheduledResultFocus}
                onBeforeInput={cancelScheduledInputFocus}
                onChange={(event) => {
                  changeQuery(event.target.value);
                }}
                onCompositionStart={() => {
                  cancelScheduledInputFocus();
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                onKeyDown={onKeyDown}
              />
            )}
            <span id="deep-thinking-description" className="sr-only">
              {DEEP_THINKING_DESCRIPTION}
            </span>
            <div className="capsule-meta">
              <p
                id="query-guidance"
                className="capsule-hint"
                aria-live={invalidMessage ? 'polite' : undefined}
              >
                {invalidMessage ? (
                  <span className="validation-error" data-testid="validation-error">
                    {invalidMessage}
                  </span>
                ) : (
                  <span>
                    Enter 查询 · Esc 收起 · 只复制不代发
                    {shortcutFailed ? '' : ` · ${shortcutLabel}`}
                  </span>
                )}
              </p>
              <div className="capsule-tools">
                <button
                  type="button"
                  className="dashboard-entry"
                  data-testid="open-dashboard"
                  aria-label="打开运营工作台"
                  title="打开运营工作台"
                  onClick={openDashboard}
                >
                  <svg
                    className="dashboard-entry-icon"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect x="2.75" y="3.25" width="14.5" height="13.5" rx="2.25" />
                    <path d="M3 7.25h14M7.25 7.5v9" />
                    <path d="M10 10.25h4.5M10 13.25h3" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="deep-thinking-entry"
                  data-testid="deep-thinking-toggle"
                  aria-label={`${deepThinkingInfoOpen ? '收起' : '查看'}深度思考预留说明，功能默认 OFF`}
                  aria-pressed={deepThinkingInfoOpen}
                  aria-expanded={deepThinkingInfoOpen}
                  aria-controls="deep-thinking-panel"
                  aria-describedby="deep-thinking-description"
                  onClick={() => setDeepThinkingInfoOpen((current) => !current)}
                >
                  深度思考 <span>预留 · OFF</span>
                </button>
                <div className="env-badges" data-testid="env-badges">
                  <span className="env-badge">DEMO</span>
                  <span className="env-badge">MOCK AUTH</span>
                  <span className="env-badge">SYNTHETIC DATA</span>
                </div>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="search-btn"
            data-testid="search-button"
            onClick={runSearch}
            disabled={searching}
            aria-busy={searching}
          >
            {searching ? (
              <span className="searching-label" data-testid="searching-indicator">
                <span className="searching-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                检索中
              </span>
            ) : (
              '查询'
            )}
          </button>
        </div>

        {shortcutFailed ? (
          <p className="shortcut-banner" data-testid="shortcut-fallback">
            {shortcutHint || '全局快捷键注册失败，请点击狐狸头打开。'}
          </p>
        ) : null}

        {expanded ? (
          <section
            ref={resultPaneRef}
            className="result-pane"
            data-testid="result-pane"
            aria-label="候选话术"
            tabIndex={-1}
          >
            {phase === 'EMPTY' ? (
              <div className="status-banner no-hit" data-testid="no-hit" role="status" aria-live="polite">
                <span className="no-hit-mark" aria-hidden="true">?</span>
                <strong>没找到合适话术</strong>
                <span>换个说法再试，或转人工话术师。当前 Demo 未接通真实话术库。</span>
              </div>
            ) : null}

            {phase === 'ERROR' ? (
              <div className="status-banner is-error" data-testid="error-state">
                <strong>查询未完成</strong>
                <span>{errorMessage || '出现可恢复错误，请重试。'}</span>
                <button type="button" className="retry-btn" data-testid="retry-button" onClick={retry}>
                  重试
                </button>
              </div>
            ) : null}

            {phase === 'RESULTS' || phase === 'COPIED' || (phase === 'ERROR' && results.length > 0) ? (
              <div className="card-list" data-testid="result-list">
                <div className="result-heading" role="status" aria-live="polite">
                  <strong>候选话术</strong>
                  {phase === 'COPIED' ? (
                    <span className="copied-feedback" data-testid="toast">
                      {COPY_SUCCESS_MESSAGE}
                    </span>
                  ) : (
                    <span>{results.length} 条 · 按 1 / 2 / 3 复制</span>
                  )}
                </div>
                {results.map((script) => (
                  <ScriptCard
                    key={script.scriptId}
                    script={script}
                    copying={copying || phase === 'COPIED'}
                    copied={copiedRank === script.rank}
                    onCopy={(item, trigger) => {
                      void copyScript(item, trigger);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
