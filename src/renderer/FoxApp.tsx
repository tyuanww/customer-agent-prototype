import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import {
  IDENTITY_FOX_VISUAL_TRANSFORM,
  isFoxVisualTransform,
  type FoxDockEdge,
  type FoxDragSettleAck,
  selectAuthoritativeFoxDockSnapshot,
  type FoxPeekIntent,
  type FoxVisualTransform,
} from '@shared/overlay-events';
import {
  FOX_HALO_DURATION_MS,
  FOX_HALO_OPACITY_MAX,
  FOX_HALO_OPACITY_MIN,
  FOX_HALO_REDUCED_MOTION_OPACITY,
  FOX_HALO_SIZE_MAX_PX,
  FOX_HALO_SIZE_MIN_PX,
  FOX_DOCK_READY_MAX_SCALE,
  FOX_DOCK_READY_RISE_PX,
  FOX_DOCK_READY_TILT_DEG,
  FOX_DOCK_READY_TRAVEL_PX,
  FOX_IDLE_DURATION_MS,
  FOX_IDLE_FLOAT_PX,
  FOX_IDLE_MAX_SCALE,
  FOX_IDLE_SWING_DEG,
  FOX_PEEK_DURATION_MS,
  FOX_RETRACT_DURATION_MS,
  FOX_SNAP_DURATION_MS,
} from '@shared/fox-motion';
import {
  FOX_ANNOYED_DRAG_AFTER_MS,
  FOX_ANNOYED_DRAG_DURATION_MS,
  FOX_DRAG_SETTLE_WATCHDOG_MS,
  FOX_DROWSY_AFTER_MS,
  FOX_FOLLOW_MAX_DEG,
  FOX_FOLLOW_MAX_PX,
  FOX_PRESS_DURATION_MS,
  FOX_SLEEP_AFTER_MS,
  computeDragReaction,
  resolveFoxExpression,
  resolveFoxPose,
  resolveFoxStructuralPose,
  shouldShowFoxHeadsetSignal,
  shouldEnterAnnoyedDrag,
  writeFoxCssVars,
  type FoxAmbientPose,
  type FoxTransientPose,
} from '@shared/fox-presence';
import {
  FOX_EDGE_PEEK_TRAVEL_PX,
  FOX_EDGE_PEEK_VISIBLE_PX,
  FOX_EDGE_VISIBLE_PX,
  FOX_SIZE,
  FOX_VISUAL_SIZE,
  foxDockCropOffsetPx,
  foxDragInwardPx,
  foxDragSessionHeadOffset,
} from '@shared/overlay-geometry';
import { FoxHead } from './components/FoxHead';
import { useFoxAmbient, useFoxLocalFollow, usePrefersReducedMotion } from './lib/use-fox-presence';
import { useWindowDrag } from './lib/use-window-drag';

function readFoxVisualTransform(element: HTMLElement | null): FoxVisualTransform {
  if (!element || typeof DOMMatrixReadOnly === 'undefined') {
    return IDENTITY_FOX_VISUAL_TRANSFORM;
  }
  const transform = window.getComputedStyle(element).transform;
  if (!transform || transform === 'none') {
    return IDENTITY_FOX_VISUAL_TRANSFORM;
  }
  try {
    const matrix = new DOMMatrixReadOnly(transform);
    const snapshot = {
      a: matrix.a,
      b: matrix.b,
      c: matrix.c,
      d: matrix.d,
      e: matrix.e,
      f: matrix.f,
    };
    return isFoxVisualTransform(snapshot) ? snapshot : IDENTITY_FOX_VISUAL_TRANSFORM;
  } catch {
    return IDENTITY_FOX_VISUAL_TRANSFORM;
  }
}

export function FoxApp() {
  const [shortcutFailed, setShortcutFailed] = useState(false);
  const [hint, setHint] = useState('点击打开查询，可拖拽移动');
  const [dockEdge, setDockEdge] = useState<FoxDockEdge>('none');
  const [snapping, setSnapping] = useState(false);
  const [snapToken, setSnapToken] = useState(0);
  const [peeking, setPeeking] = useState(false);
  const [retracting, setRetracting] = useState(false);
  const [handoffFrozen, setHandoffFrozen] = useState(false);
  const [handoffVisualTransform, setHandoffVisualTransform] = useState<FoxVisualTransform>(
    IDENTITY_FOX_VISUAL_TRANSFORM,
  );
  const [transient, setTransient] = useState<FoxTransientPose>('none');
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [wakeHeadsetSignal, setWakeHeadsetSignal] = useState(false);
  const pointerFocusLockRef = useRef(false);
  const dockEdgeRef = useRef<FoxDockEdge>('none');
  const peekIntentRef = useRef<FoxPeekIntent>('retract');
  const peekEpochRef = useRef(0);
  const pendingRetractEpochRef = useRef<number | null>(null);
  const retractTimerRef = useRef<number | null>(null);
  const peekingRef = useRef(false);
  const retractingRef = useRef(false);
  const peekArmedRef = useRef(true);
  const [peekArmed, setPeekArmed] = useState(true);
  const pointerOverRef = useRef(false);
  const hoverReleaseRef = useRef(false);
  const dragSessionRef = useRef<{ edge: 'left' | 'right'; cropPx: number } | null>(null);
  const pendingDragSyncRef = useRef<{ edge: FoxDockEdge; epoch: number } | null>(null);
  const pendingDragEchoRef = useRef<{ edge: FoxDockEdge; epoch: number } | null>(null);
  const [dragSessionEdge, setDragSessionEdge] = useState<'none' | 'left' | 'right'>('none');
  const settlingRef = useRef(false);
  const [settling, setSettling] = useState(false);
  const dragGenerationRef = useRef(0);
  const nativeDragGenerationRef = useRef(0);
  const gestureActiveRef = useRef(false);
  const deferredFinalSettleRef = useRef<FoxDragSettleAck | null>(null);
  const lastCommittedSettleIdRef = useRef(0);
  const mountedRef = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openingSearchRef = useRef(false);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragRef = useRef<ReturnType<typeof computeDragReaction> | null>(null);
  const annoyedDragTimerRef = useRef<number | null>(null);
  const settleWatchdogRef = useRef<number | null>(null);
  const transientRef = useRef<FoxTransientPose>('none');
  const previousAmbientRef = useRef<FoxAmbientPose>('awake');
  const reducedMotion = usePrefersReducedMotion();
  const structural = resolveFoxStructuralPose({
    handoff: handoffFrozen,
    snap: snapping,
    peek: peeking,
    retract: retracting,
    dragging: transient === 'dragging' || transient === 'annoyed-drag',
  });
  const ambientPaused = shortcutFailed
    || structural !== 'none'
    || transient !== 'none';
  const { ambient, wake } = useFoxAmbient({
    paused: ambientPaused,
    // Reduced motion keeps the semantic sleep clock, then CSS renders the
    // closed eye and Z marks statically without any displacement.
    reducedMotion: false,
  });
  const followEnabled = !reducedMotion && structural === 'none' && transient === 'none' && !shortcutFailed;
  const { following, reset: resetFollow } = useFoxLocalFollow(rootRef, {
    enabled: followEnabled,
    reducedMotion,
    onActivity: wake,
  });
  const displayedAmbient: FoxAmbientPose = following && ambient === 'awake' ? 'following-local' : ambient;
  const resolvedPose = resolveFoxPose({
    reducedMotion,
    warning: shortcutFailed,
    structural,
    transient,
    ambient: displayedAmbient,
  });
  const expression = resolveFoxExpression({
    warning: shortcutFailed,
    structural,
    transient,
    ambient: displayedAmbient,
  });
  const headsetSignal = shouldShowFoxHeadsetSignal({
    reducedMotion,
    warning: shortcutFailed,
    structural,
    transient,
    ambient: displayedAmbient,
    justWoke: wakeHeadsetSignal,
  });

  useEffect(() => {
    const previous = previousAmbientRef.current;
    const wokeFromRest = (previous === 'drowsy' || previous === 'sleeping')
      && (displayedAmbient === 'awake' || displayedAmbient === 'following-local');
    previousAmbientRef.current = displayedAmbient;
    if (wokeFromRest) {
      setWakeHeadsetSignal(true);
      return;
    }
    if (displayedAmbient === 'drowsy' || displayedAmbient === 'sleeping') {
      setWakeHeadsetSignal(false);
    }
  }, [displayedAmbient]);

  useEffect(() => {
    if (
      wakeHeadsetSignal
      && (
        reducedMotion
        || shortcutFailed
        || structural !== 'none'
        || transient !== 'none'
      )
    ) {
      // The wake pulse is one-shot. If a higher-priority interaction removes
      // the SVG before animationend, consume it instead of replaying it late.
      setWakeHeadsetSignal(false);
    }
  }, [reducedMotion, shortcutFailed, structural, transient, wakeHeadsetSignal]);

  const cancelDragRaf = useCallback(() => {
    if (dragRafRef.current !== null) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
  }, []);

  const resetDragVars = useCallback(() => {
    cancelDragRaf();
    writeFoxCssVars(rootRef.current, 'drag', null);
    writeFoxCssVars(rootRef.current, 'session', null);
    dragSessionRef.current = null;
    pendingDragSyncRef.current = null;
    pendingDragEchoRef.current = null;
    settlingRef.current = false;
    setDragSessionEdge('none');
    setSettling(false);
  }, [cancelDragRaf]);

  const beginPendingSettle = useCallback((): void => {
    if (settlingRef.current) {
      return;
    }
    settlingRef.current = true;
    setSettling(true);
  }, []);

  const startDockDragSession = useCallback((): void => {
    if (dragSessionRef.current) {
      return;
    }
    const edge = dockEdgeRef.current;
    if (edge !== 'left' && edge !== 'right') {
      return;
    }
    const cropPx = foxDockCropOffsetPx(
      peekIntentRef.current === 'peek' || peekingRef.current || retractingRef.current,
    );
    dragSessionRef.current = { edge, cropPx };
    setDragSessionEdge(edge);
  }, []);

  const applyDragSessionOffset = useCallback((totalDx: number): void => {
    const session = dragSessionRef.current;
    if (!session) {
      writeFoxCssVars(rootRef.current, 'session', null);
      setDragSessionEdge('none');
      return;
    }
    const inward = foxDragInwardPx(session.edge, totalDx);
    if (inward <= 0) {
      writeFoxCssVars(rootRef.current, 'session', { x: 0, y: 0, rot: 0 });
      setDragSessionEdge(session.edge);
      return;
    }
    const offsetX = foxDragSessionHeadOffset(session.edge, session.cropPx, inward);
    writeFoxCssVars(rootRef.current, 'session', { x: offsetX, y: 0, rot: 0 });
    setDragSessionEdge(session.edge);
  }, []);

  const suppressPeekUntilLeave = useCallback((): void => {
    peekArmedRef.current = false;
    setPeekArmed(false);
  }, []);

  const publishTransient = useCallback((next: FoxTransientPose, synchronous = false): void => {
    if (transientRef.current === next) {
      return;
    }
    transientRef.current = next;
    if (synchronous) {
      flushSync(() => {
        setTransient(next);
      });
      return;
    }
    setTransient(next);
  }, []);

  const clearAnnoyedDragTimer = useCallback((): void => {
    if (annoyedDragTimerRef.current !== null) {
      window.clearTimeout(annoyedDragTimerRef.current);
      annoyedDragTimerRef.current = null;
    }
  }, []);

  const clearSettleWatchdog = useCallback((): void => {
    if (settleWatchdogRef.current !== null) {
      window.clearTimeout(settleWatchdogRef.current);
      settleWatchdogRef.current = null;
    }
  }, []);

  const clearRetractTimer = useCallback(() => {
    if (retractTimerRef.current !== null) {
      window.clearTimeout(retractTimerRef.current);
      retractTimerRef.current = null;
    }
  }, []);

  const resetPeekVisualState = useCallback(() => {
    peekingRef.current = false;
    retractingRef.current = false;
    setPeeking(false);
    setRetracting(false);
  }, []);

  const commitDragSettleAck = useCallback((ack: FoxDragSettleAck): void => {
    if (
      !mountedRef.current
      || ack.settleId <= lastCommittedSettleIdRef.current
      || ack.generation !== nativeDragGenerationRef.current
    ) {
      return;
    }
    if (gestureActiveRef.current) {
      const deferred = deferredFinalSettleRef.current;
      if (!deferred || ack.settleId > deferred.settleId) {
        deferredFinalSettleRef.current = ack;
      }
      return;
    }
    lastCommittedSettleIdRef.current = ack.settleId;
    deferredFinalSettleRef.current = null;
    const pendingSync = pendingDragSyncRef.current;
    const pendingEcho = pendingDragEchoRef.current;
    pendingDragSyncRef.current = null;
    pendingDragEchoRef.current = null;
    const finalSnapshot = selectAuthoritativeFoxDockSnapshot(
      ack,
      pendingSync,
      pendingEcho,
      { edge: dockEdgeRef.current, epoch: peekEpochRef.current },
    ) ?? ack;
    const finalEdge = finalSnapshot.edge;
    const finalEpoch = finalSnapshot.epoch;
    const previousEdge = dockEdgeRef.current;
    const shouldSnap = finalEdge !== 'none' && finalEdge !== previousEdge;
    clearSettleWatchdog();
    clearAnnoyedDragTimer();
    cancelDragRaf();
    pendingDragRef.current = null;
    writeFoxCssVars(rootRef.current, 'drag', null);
    writeFoxCssVars(rootRef.current, 'session', null);
    dragSessionRef.current = null;
    settlingRef.current = false;
    transientRef.current = 'none';
    dockEdgeRef.current = finalEdge;
    peekEpochRef.current = finalEpoch;
    peekIntentRef.current = 'retract';
    peekingRef.current = false;
    retractingRef.current = false;
    flushSync(() => {
      setTransient('none');
      setDragSessionEdge('none');
      setSettling(false);
      setPeeking(false);
      setRetracting(false);
      setDockEdge(finalEdge);
      setSnapping(shouldSnap);
      if (shouldSnap) {
        setSnapToken((current) => current + 1);
      }
    });
    resetFollow();
    wake();
    // Main owns the pending shortcut intent. This Fox-only commit releases the
    // native settle fence only after the renderer has painted the same frame.
    void window.customerAgent?.commitFoxDragSettle(ack.settleId).catch(() => {
      // Fail closed: without a successful commit Main keeps Query handoff fenced.
    });
  }, [cancelDragRaf, clearAnnoyedDragTimer, clearSettleWatchdog, resetFollow, wake]);

  const abortDragSettle = useCallback((generation: number): void => {
    if (generation !== dragGenerationRef.current || !settlingRef.current) {
      return;
    }
    const pendingSync = pendingDragSyncRef.current;
    const pendingEcho = pendingDragEchoRef.current;
    pendingDragSyncRef.current = null;
    pendingDragEchoRef.current = null;
    const pendingEdge = selectAuthoritativeFoxDockSnapshot(pendingSync, pendingEcho);
    const previousEdge = dockEdgeRef.current;
    clearSettleWatchdog();
    clearAnnoyedDragTimer();
    resetDragVars();
    if (pendingEdge) {
      const shouldSnap = pendingEdge.edge !== 'none' && pendingEdge.edge !== previousEdge;
      transientRef.current = 'none';
      dockEdgeRef.current = pendingEdge.edge;
      peekEpochRef.current = pendingEdge.epoch;
      peekIntentRef.current = 'retract';
      peekingRef.current = false;
      retractingRef.current = false;
      flushSync(() => {
        setTransient('none');
        setPeeking(false);
        setRetracting(false);
        setDockEdge(pendingEdge.edge);
        setSnapping(shouldSnap);
        if (shouldSnap) {
          setSnapToken((current) => current + 1);
        }
      });
    } else {
      publishTransient('none');
    }
    resetFollow();
    wake();
  }, [clearAnnoyedDragTimer, clearSettleWatchdog, publishTransient, resetDragVars, resetFollow, wake]);

  useEffect(() => {
    mountedRef.current = true;
    const api = window.customerAgent;
    if (!api) {
      setShortcutFailed(true);
      setHint('复制通道不可用，请在桌面 Demo 中打开');
      return;
    }

    void api
      .getWindowContext()
      .then((context) => {
        if (!context.shortcut.registered) {
          setShortcutFailed(true);
          setHint(context.shortcut.message || '全局快捷键不可用，请点击打开');
        }
      })
      .catch(() => {
        // Keep the local click path working.
      });

    const unsubscribe = api.onOverlayCommand((command) => {
      if (command.type === 'shortcut-status' && !command.registered) {
        setShortcutFailed(true);
        setHint(command.message);
      }
      if (command.type === 'fox-drag-settled') {
        commitDragSettleAck(command);
        return;
      }
      if (command.type === 'fox-edge' || command.type === 'sync-fox-edge') {
        const hasLiveSession = dragSessionRef.current !== null || settlingRef.current;
        if (hasLiveSession) {
          // MOVE broadcasts are informational while a dock-drag transaction is
          // active. Only the finished IPC acknowledgement may atomically clear
          // the renderer crop compensation; a late ordinary echo must not be
          // mistaken for the final settle.
          peekEpochRef.current = Math.max(peekEpochRef.current, command.epoch);
          if (command.type === 'sync-fox-edge') {
            pendingDragSyncRef.current = selectAuthoritativeFoxDockSnapshot(
              pendingDragSyncRef.current,
              { edge: command.edge, epoch: command.epoch },
            );
          } else {
            pendingDragEchoRef.current = selectAuthoritativeFoxDockSnapshot(
              pendingDragEchoRef.current,
              { edge: command.edge, epoch: command.epoch },
            );
          }
          return;
        }
        if (command.epoch <= peekEpochRef.current) {
          return;
        }
        openingSearchRef.current = false;
        setHandoffFrozen(false);
        clearAnnoyedDragTimer();
        publishTransient('none');
        resetDragVars();
        resetFollow();
        wake();
        clearRetractTimer();
        pendingRetractEpochRef.current = null;
        const previousEdge = dockEdgeRef.current;
        dockEdgeRef.current = command.edge;
        peekEpochRef.current = command.epoch;
        peekIntentRef.current = 'retract';
        peekingRef.current = false;
        retractingRef.current = false;
        setPeeking(false);
        setRetracting(false);
        setDockEdge(command.edge);
        if (
          command.type === 'fox-edge' &&
          (command.edge === 'left' || command.edge === 'right') &&
          command.edge !== previousEdge
        ) {
          if (pointerOverRef.current && previousEdge !== 'none') {
            suppressPeekUntilLeave();
          }
          setSnapping(true);
          setSnapToken((current) => current + 1);
        } else {
          setSnapping(false);
        }
      }
    });
    return () => {
      mountedRef.current = false;
      dragGenerationRef.current += 1;
      nativeDragGenerationRef.current = 0;
      gestureActiveRef.current = false;
      deferredFinalSettleRef.current = null;
      settlingRef.current = false;
      clearRetractTimer();
      clearAnnoyedDragTimer();
      clearSettleWatchdog();
      cancelDragRaf();
      unsubscribe();
    };
  }, [
    cancelDragRaf,
    clearAnnoyedDragTimer,
    clearRetractTimer,
    clearSettleWatchdog,
    commitDragSettleAck,
    publishTransient,
    resetDragVars,
    resetFollow,
    suppressPeekUntilLeave,
    wake,
  ]);

  useEffect(() => {
    const releasePointerFocusLock = (): void => {
      pointerFocusLockRef.current = false;
    };
    const markKeyboardIntent = (event: KeyboardEvent): void => {
      if (event.key === 'Tab' || event.key.startsWith('Arrow')) {
        pointerFocusLockRef.current = false;
      }
    };
    window.addEventListener('pointerup', releasePointerFocusLock, true);
    window.addEventListener('pointercancel', releasePointerFocusLock, true);
    window.addEventListener('keydown', markKeyboardIntent, true);
    return () => {
      window.removeEventListener('pointerup', releasePointerFocusLock, true);
      window.removeEventListener('pointercancel', releasePointerFocusLock, true);
      window.removeEventListener('keydown', markKeyboardIntent, true);
    };
  }, []);

  useEffect(() => {
    if (!reducedMotion) {
      return;
    }
    clearAnnoyedDragTimer();
    publishTransient('none');
    if (!dragSessionRef.current && !settlingRef.current) {
      resetDragVars();
    }
    resetFollow();
  }, [clearAnnoyedDragTimer, publishTransient, reducedMotion, resetDragVars, resetFollow]);

  const finishSnap = useCallback((epoch: number): void => {
    const intent = peekIntentRef.current;
    // macOS may clamp a partially off-screen transparent window after the CSS
    // snap has already started. Reconcile the native bounds at the animation
    // boundary, while preserving a hover peek that arrived during the snap.
    void Promise.resolve(window.customerAgent?.setFoxPeek(intent, epoch)).finally(() => {
      if (peekEpochRef.current === epoch) {
        setSnapping(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!snapping) {
      return;
    }
    const epoch = peekEpochRef.current;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      finishSnap(epoch);
      return;
    }
    const timer = window.setTimeout(() => {
      finishSnap(epoch);
    }, FOX_SNAP_DURATION_MS + 80);
    return () => window.clearTimeout(timer);
  }, [finishSnap, snapping, snapToken]);

  const openSearch = useCallback(() => {
    const api = window.customerAgent;
    if (!api) {
      return;
    }
    clearRetractTimer();
    openingSearchRef.current = true;
    pendingRetractEpochRef.current = null;
    peekIntentRef.current = 'retract';
    wake();
    resetFollow();
    writeFoxCssVars(rootRef.current, 'session', null);
    dragSessionRef.current = null;
    settlingRef.current = false;
    setSettling(false);
    const visualTransform = readFoxVisualTransform(
      buttonRef.current?.querySelector<HTMLElement>('.fox-head') ?? null,
    );
    // Freeze the exact computed frame as an explicit matrix. `animation: none`
    // plus this matrix also neutralises a pointer-enter animation that React
    // committed in the same click task but the compositor had not sampled yet.
    flushSync(() => {
      setHandoffVisualTransform(visualTransform);
      setHandoffFrozen(true);
    });
    // Mouse clicks leave the button as document.activeElement even after its
    // BrowserWindow is hidden. Clear that stale focus so showing the tucked fox
    // later does not look like a new keyboard-focus peek.
    buttonRef.current?.blur();
    // OPEN advances the main-process peek epoch and samples the fox's actual
    // native bounds for the shared-element handoff. Moving a docked fox back to
    // its resting bounds here would create the visible pre-open "flash".
    const epoch = peekEpochRef.current;
    void Promise.resolve(api.openSearch(visualTransform)).catch(() => {
      openingSearchRef.current = false;
      setHandoffFrozen(false);
      resetPeekVisualState();
      void api.setFoxPeek('retract', epoch);
    });
  }, [clearRetractTimer, resetFollow, resetPeekVisualState, wake]);

  const finishRetract = useCallback(
    (epoch: number) => {
      if (
        pendingRetractEpochRef.current !== epoch ||
        peekEpochRef.current !== epoch ||
        peekIntentRef.current !== 'retract'
      ) {
        return;
      }
      pendingRetractEpochRef.current = null;
      clearRetractTimer();
      const api = window.customerAgent;
      if (!api) {
        resetPeekVisualState();
        return;
      }
      // Keep the CSS image at its tucked end frame until the main process has
      // actually applied the native 44px bounds. Clearing the class first made
      // the image spring back for one compositor frame.
      void api
        .setFoxPeek('retract', epoch)
        .then(() => {
          if (
            peekEpochRef.current === epoch &&
            peekIntentRef.current === 'retract' &&
            pendingRetractEpochRef.current === null
          ) {
            retractingRef.current = false;
            setRetracting(false);
          }
        })
        .catch(() => {
          // Preserve the visually tucked end frame on an IPC failure. A later
          // pointer leave sends an idempotent reconcile request again.
        });
    },
    [clearRetractTimer, resetPeekVisualState],
  );

  const drag = useWindowDrag(
    (dx, dy, finished) => {
      const api = window.customerAgent;
      const generation = dragGenerationRef.current;
      let request: Promise<FoxDragSettleAck | null> | undefined;
      try {
        request = api?.moveFoxBy(dx, dy, finished, generation);
      } catch {
        if (finished) {
          queueMicrotask(() => abortDragSettle(generation));
        }
        return;
      }
      if (!finished) {
        void request?.catch(() => undefined);
        return;
      }
      clearSettleWatchdog();
      settleWatchdogRef.current = window.setTimeout(() => {
        settleWatchdogRef.current = null;
        abortDragSettle(generation);
      }, FOX_DRAG_SETTLE_WATCHDOG_MS);
      void Promise.resolve(request ?? null)
        .then((ack) => {
          if (ack) {
            commitDragSettleAck(ack);
          } else {
            abortDragSettle(generation);
          }
        })
        .catch(() => abortDragSettle(generation));
    },
    openSearch,
    {
      onPressStart() {
        gestureActiveRef.current = true;
        if (settlingRef.current) {
          abortDragSettle(dragGenerationRef.current);
        }
        dragGenerationRef.current += 1;
        clearSettleWatchdog();
        pointerFocusLockRef.current = true;
        flushSync(() => {
          setKeyboardFocus(false);
        });
        startDockDragSession();
        clearAnnoyedDragTimer();
        wake();
        resetFollow();
        publishTransient('pressed', true);
        if (reducedMotion) {
          return;
        }
      },
      onGestureSample(sample) {
        nativeDragGenerationRef.current = dragGenerationRef.current;
        deferredFinalSettleRef.current = null;
        startDockDragSession();
        const session = dragSessionRef.current;
        if (session && foxDragInwardPx(session.edge, sample.totalDx) > 0 && dockEdgeRef.current !== 'none') {
          flushSync(() => {
            peekingRef.current = false;
            retractingRef.current = false;
            peekIntentRef.current = 'retract';
            setPeeking(false);
            setRetracting(false);
            dockEdgeRef.current = 'none';
            setDockEdge('none');
            setDragSessionEdge(session.edge);
          });
        }
        applyDragSessionOffset(sample.totalDx);
        suppressPeekUntilLeave();
        wake();
        resetFollow();
        publishTransient('dragging', true);
        if (reducedMotion) {
          return;
        }
        pendingDragRef.current = computeDragReaction(sample.totalDx, sample.totalDy);
        if (dragRafRef.current === null) {
          dragRafRef.current = window.requestAnimationFrame(() => {
            dragRafRef.current = null;
            writeFoxCssVars(rootRef.current, 'drag', pendingDragRef.current);
          });
        }
        if (shouldEnterAnnoyedDrag(sample)) {
          clearAnnoyedDragTimer();
          publishTransient('annoyed-drag', true);
          return;
        }
        if (annoyedDragTimerRef.current === null) {
          annoyedDragTimerRef.current = window.setTimeout(() => {
            annoyedDragTimerRef.current = null;
            if (transientRef.current === 'dragging') {
              publishTransient('annoyed-drag');
            }
          }, Math.max(0, FOX_ANNOYED_DRAG_AFTER_MS - sample.elapsedMs));
        }
      },
      onGestureEnd({ moved }) {
        gestureActiveRef.current = false;
        clearAnnoyedDragTimer();
        cancelDragRaf();
        publishTransient('none', true);
        if (!moved) {
          resetDragVars();
          const deferred = deferredFinalSettleRef.current;
          deferredFinalSettleRef.current = null;
          if (deferred) {
            commitDragSettleAck(deferred);
          }
          return;
        }
        deferredFinalSettleRef.current = null;
        beginPendingSettle();
      },
    },
  );

  const requestPeek = useCallback(
    (intent: FoxPeekIntent) => {
      if (openingSearchRef.current) {
        return;
      }
      if (dockEdge === 'none') {
        return;
      }

      const api = window.customerAgent;
      const epoch = peekEpochRef.current;

      if (intent === 'peek') {
        if (!peekArmedRef.current) {
          return;
        }
        clearRetractTimer();
        pendingRetractEpochRef.current = null;
        retractingRef.current = false;
        setRetracting(false);
        if (peekIntentRef.current === 'peek') {
          peekingRef.current = true;
          setPeeking(true);
          return;
        }
        peekIntentRef.current = 'peek';
        peekingRef.current = true;
        setPeeking(true);
        void api?.setFoxPeek('peek', epoch);
        return;
      }

      if (peekIntentRef.current === 'retract') {
        if (pendingRetractEpochRef.current === epoch) {
          return;
        }
        // Do not trust the logical intent alone. Reconcile the native bounds as
        // well; the main process performs an idempotent bounds comparison.
        void api?.setFoxPeek('retract', epoch);
        return;
      }

      peekIntentRef.current = 'retract';
      peekingRef.current = false;
      setPeeking(false);
      clearRetractTimer();

      if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
        pendingRetractEpochRef.current = null;
        retractingRef.current = false;
        setRetracting(false);
        void api?.setFoxPeek('retract', epoch);
        return;
      }

      // Keep the 80px peek window open while the image glides back by the exact
      // geometry delta. animationend commits the native shrink; the timer is a
      // bounded fallback for throttled/hidden renderers.
      retractingRef.current = true;
      setRetracting(true);
      pendingRetractEpochRef.current = epoch;
      retractTimerRef.current = window.setTimeout(() => {
        retractTimerRef.current = null;
        finishRetract(epoch);
      }, FOX_RETRACT_DURATION_MS + 80);
    },
    [clearRetractTimer, dockEdge, finishRetract],
  );

  const snapEdge = snapping && (dockEdge === 'left' || dockEdge === 'right') ? dockEdge : 'none';
  const haloPaused = snapping
    || peeking
    || retracting
    || handoffFrozen
    || shortcutFailed
    || transient !== 'none';

  return (
    <div
      ref={rootRef}
      className={`fox-idle is-docked-${dockEdge}${snapping ? ' is-snapping' : ''}${peeking ? ' is-peeking' : ''}${retracting ? ' is-retracting' : ''}${handoffFrozen ? ' is-handoff-frozen' : ''}${haloPaused ? ' is-halo-paused' : ''}`}
      style={
        {
          '--fox-peek-travel': `${FOX_EDGE_PEEK_TRAVEL_PX}px`,
          '--fox-rest-crop-offset': `${FOX_SIZE - FOX_EDGE_VISIBLE_PX}px`,
          '--fox-peek-crop-offset': `${FOX_SIZE - FOX_EDGE_PEEK_VISIBLE_PX}px`,
          '--fox-peek-duration': `${FOX_PEEK_DURATION_MS}ms`,
          '--fox-retract-duration': `${FOX_RETRACT_DURATION_MS}ms`,
          '--fox-halo-duration': `${FOX_HALO_DURATION_MS / 1000}s`,
          '--fox-halo-size': `${FOX_HALO_SIZE_MIN_PX}px`,
          '--fox-halo-outer-size': `${FOX_HALO_SIZE_MAX_PX}px`,
          '--fox-halo-opacity-min': FOX_HALO_OPACITY_MIN,
          '--fox-halo-opacity-max': FOX_HALO_OPACITY_MAX,
          '--fox-halo-reduced-opacity': FOX_HALO_REDUCED_MOTION_OPACITY,
          '--fox-dock-ready-travel': `${FOX_DOCK_READY_TRAVEL_PX}px`,
          '--fox-dock-ready-rise': `${FOX_DOCK_READY_RISE_PX}px`,
          '--fox-dock-ready-tilt': `${FOX_DOCK_READY_TILT_DEG}deg`,
          '--fox-dock-ready-max-scale': FOX_DOCK_READY_MAX_SCALE,
          '--fox-press-duration': `${FOX_PRESS_DURATION_MS}ms`,
          '--fox-annoyed-drag-duration': `${FOX_ANNOYED_DRAG_DURATION_MS}ms`,
          '--fox-handoff-a': handoffVisualTransform.a,
          '--fox-handoff-b': handoffVisualTransform.b,
          '--fox-handoff-c': handoffVisualTransform.c,
          '--fox-handoff-d': handoffVisualTransform.d,
          '--fox-handoff-e': handoffVisualTransform.e,
          '--fox-handoff-f': handoffVisualTransform.f,
        } as CSSProperties
      }
      data-testid="fox-idle"
      data-window-role="fox"
      data-fox-pose={resolvedPose}
      data-fox-expression={expression}
      data-fox-headset-signal={headsetSignal ? 'true' : 'false'}
      data-fox-structural={structural}
      data-fox-transient={transient}
      data-fox-ambient={displayedAmbient}
      data-fox-follow={following ? 'true' : 'false'}
      data-fox-warning={shortcutFailed ? 'true' : 'false'}
      data-fox-keyboard-focus={keyboardFocus ? 'true' : 'false'}
      data-fox-peek-armed={peekArmed ? 'true' : 'false'}
      data-fox-drag-session={dragSessionEdge}
      data-fox-settling={settling ? 'true' : 'false'}
      data-dock-edge={dockEdge}
      data-snapping={snapping ? 'true' : 'false'}
      data-peeking={peeking ? 'true' : 'false'}
      data-retracting={retracting ? 'true' : 'false'}
      data-snap-token={String(snapToken)}
      data-snap-edge={snapEdge}
      data-idle-duration-ms={FOX_IDLE_DURATION_MS}
      data-idle-float-px={FOX_IDLE_FLOAT_PX}
      data-idle-swing-deg={FOX_IDLE_SWING_DEG}
      data-idle-max-scale={FOX_IDLE_MAX_SCALE}
      data-follow-max-px={FOX_FOLLOW_MAX_PX}
      data-follow-max-deg={FOX_FOLLOW_MAX_DEG}
      data-settle-watchdog-ms={FOX_DRAG_SETTLE_WATCHDOG_MS}
      data-drowsy-after-ms={FOX_DROWSY_AFTER_MS}
      data-sleep-after-ms={FOX_SLEEP_AFTER_MS}
      data-press-duration-ms={FOX_PRESS_DURATION_MS}
      data-annoyed-drag-duration-ms={FOX_ANNOYED_DRAG_DURATION_MS}
      data-dock-ready-travel-px={FOX_DOCK_READY_TRAVEL_PX}
      data-dock-ready-rise-px={FOX_DOCK_READY_RISE_PX}
      data-dock-ready-tilt-deg={FOX_DOCK_READY_TILT_DEG}
      data-dock-ready-max-scale={FOX_DOCK_READY_MAX_SCALE}
      data-snap-duration-ms={FOX_SNAP_DURATION_MS}
      data-peek-duration-ms={FOX_PEEK_DURATION_MS}
      data-retract-duration-ms={FOX_RETRACT_DURATION_MS}
      data-peek-travel-px={FOX_EDGE_PEEK_TRAVEL_PX}
      data-halo={haloPaused ? 'paused' : 'purple-breathe'}
      data-halo-duration-ms={FOX_HALO_DURATION_MS}
    >
      <button
        ref={buttonRef}
        type="button"
        className="fox-button"
        data-testid="fox-button"
        aria-label={shortcutFailed ? `打开话术查询。${hint}` : '打开话术查询'}
        title={hint}
        onPointerEnter={() => {
          hoverReleaseRef.current = false;
          pointerOverRef.current = true;
          requestPeek('peek');
        }}
        onPointerOver={() => {
          hoverReleaseRef.current = false;
          pointerOverRef.current = true;
          requestPeek('peek');
        }}
        onPointerLeave={() => {
          pointerOverRef.current = false;
          peekArmedRef.current = true;
          setPeekArmed(true);
          if (hoverReleaseRef.current) {
            return;
          }
          hoverReleaseRef.current = true;
          requestPeek('retract');
        }}
        onPointerOut={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) {
            return;
          }
          pointerOverRef.current = false;
          peekArmedRef.current = true;
          setPeekArmed(true);
          if (hoverReleaseRef.current) {
            return;
          }
          hoverReleaseRef.current = true;
          requestPeek('retract');
        }}
        onPointerDownCapture={() => {
          pointerFocusLockRef.current = true;
          flushSync(() => {
            setKeyboardFocus(false);
          });
        }}
        onFocus={(event) => {
          wake();
          resetFollow();
          const keyboard = !pointerFocusLockRef.current
            && event.currentTarget.matches(':focus-visible');
          setKeyboardFocus(keyboard);
          if (keyboard) {
            requestPeek('peek');
          }
        }}
        onBlur={() => {
          pointerFocusLockRef.current = false;
          setKeyboardFocus(false);
          if (!openingSearchRef.current) {
            requestPeek('retract');
          }
        }}
        {...drag}
      >
        <span className="fox-ground-shadow" aria-hidden="true" data-testid="fox-ground-shadow" />
        <FoxHead
          key={snapping ? `snap-${dockEdge}-${snapToken}` : `idle-${dockEdge}`}
          size={FOX_VISUAL_SIZE}
          glowing
          warning={shortcutFailed}
          expression={expression}
          headsetSignal={headsetSignal}
          className={snapEdge === 'none' ? '' : `is-snapping is-snapping-${snapEdge}`}
          onAnimationEnd={(event) => {
            if (event.animationName.startsWith('fox-snap')) {
              finishSnap(peekEpochRef.current);
            }
            if (event.animationName.startsWith('fox-retract')) {
              finishRetract(peekEpochRef.current);
            }
            if (event.animationName === 'fox-headset-wave') {
              setWakeHeadsetSignal(false);
            }
          }}
        />
        <span className="fox-focus-ring" aria-hidden="true" data-testid="fox-focus-ring" />
        <span className="fox-sleep-mark" aria-hidden="true" data-testid="fox-sleep-mark">
          <span>z</span>
          <span>Z</span>
          <span>Z</span>
        </span>
        {shortcutFailed ? (
          <span className="fox-warning-dot" data-testid="shortcut-fallback-dot" />
        ) : null}
      </button>
    </div>
  );
}
