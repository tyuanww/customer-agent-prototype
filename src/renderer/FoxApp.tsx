import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import {
  IDENTITY_FOX_VISUAL_TRANSFORM,
  isFoxVisualTransform,
  type FoxDockEdge,
  type FoxPeekIntent,
  type FoxVisualTransform,
} from '@shared/overlay-events';
import {
  FOX_IDLE_DURATION_MS,
  FOX_IDLE_FLOAT_PX,
  FOX_IDLE_MAX_SCALE,
  FOX_IDLE_SWING_DEG,
  FOX_PEEK_DURATION_MS,
  FOX_RETRACT_DURATION_MS,
  FOX_SNAP_DURATION_MS,
} from '@shared/fox-motion';
import {
  FOX_EDGE_PEEK_TRAVEL_PX,
  FOX_EDGE_PEEK_VISIBLE_PX,
  FOX_EDGE_VISIBLE_PX,
  FOX_SIZE,
  FOX_VISUAL_SIZE,
} from '@shared/overlay-geometry';
import { FoxHead } from './components/FoxHead';
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
  const dockEdgeRef = useRef<FoxDockEdge>('none');
  const peekIntentRef = useRef<FoxPeekIntent>('retract');
  const peekEpochRef = useRef(0);
  const pendingRetractEpochRef = useRef<number | null>(null);
  const retractTimerRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openingSearchRef = useRef(false);

  const clearRetractTimer = useCallback(() => {
    if (retractTimerRef.current !== null) {
      window.clearTimeout(retractTimerRef.current);
      retractTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
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
      if (command.type === 'fox-edge' || command.type === 'sync-fox-edge') {
        openingSearchRef.current = false;
        setHandoffFrozen(false);
        clearRetractTimer();
        pendingRetractEpochRef.current = null;
        const previousEdge = dockEdgeRef.current;
        dockEdgeRef.current = command.edge;
        peekEpochRef.current = command.epoch;
        peekIntentRef.current = 'retract';
        setPeeking(false);
        setRetracting(false);
        setDockEdge(command.edge);
        // A same-edge command after closing is an epoch/geometry sync, not a
        // fresh physical dock. Replaying the snap there would race with hover
        // peek and produce the long double-bounce seen at the screen edge.
        if (
          command.type === 'fox-edge' &&
          (command.edge === 'left' || command.edge === 'right') &&
          command.edge !== previousEdge
        ) {
          setSnapping(true);
          setSnapToken((current) => current + 1);
        } else {
          setSnapping(false);
        }
      }
    });
    return () => {
      clearRetractTimer();
      unsubscribe();
    };
  }, [clearRetractTimer]);

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
      setPeeking(false);
      setRetracting(false);
      void api.setFoxPeek('retract', epoch);
    });
  }, [clearRetractTimer]);

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
        setRetracting(false);
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
            setRetracting(false);
          }
        })
        .catch(() => {
          // Preserve the visually tucked end frame on an IPC failure. A later
          // pointer leave sends an idempotent reconcile request again.
        });
    },
    [clearRetractTimer],
  );

  const drag = useWindowDrag(
    (dx, dy, finished) => {
      void window.customerAgent?.moveFoxBy(dx, dy, finished);
    },
    openSearch,
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
        clearRetractTimer();
        pendingRetractEpochRef.current = null;
        setRetracting(false);
        if (peekIntentRef.current === 'peek') {
          setPeeking(true);
          return;
        }
        peekIntentRef.current = 'peek';
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
      setPeeking(false);
      clearRetractTimer();

      if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
        pendingRetractEpochRef.current = null;
        setRetracting(false);
        void api?.setFoxPeek('retract', epoch);
        return;
      }

      // Keep the 80px peek window open while the image glides back by the exact
      // geometry delta. animationend commits the native shrink; the timer is a
      // bounded fallback for throttled/hidden renderers.
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

  return (
    <div
      className={`fox-idle is-docked-${dockEdge}${snapping ? ' is-snapping' : ''}${peeking ? ' is-peeking' : ''}${retracting ? ' is-retracting' : ''}${handoffFrozen ? ' is-handoff-frozen' : ''}`}
      style={
        {
          '--fox-peek-travel': `${FOX_EDGE_PEEK_TRAVEL_PX}px`,
          '--fox-rest-crop-offset': `${FOX_SIZE - FOX_EDGE_VISIBLE_PX}px`,
          '--fox-peek-crop-offset': `${FOX_SIZE - FOX_EDGE_PEEK_VISIBLE_PX}px`,
          '--fox-peek-duration': `${FOX_PEEK_DURATION_MS}ms`,
          '--fox-retract-duration': `${FOX_RETRACT_DURATION_MS}ms`,
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
      data-snap-duration-ms={FOX_SNAP_DURATION_MS}
      data-peek-duration-ms={FOX_PEEK_DURATION_MS}
      data-retract-duration-ms={FOX_RETRACT_DURATION_MS}
      data-peek-travel-px={FOX_EDGE_PEEK_TRAVEL_PX}
    >
      <button
        ref={buttonRef}
        type="button"
        className="fox-button"
        data-testid="fox-button"
        aria-label={shortcutFailed ? `打开话术查询。${hint}` : '打开话术查询'}
        title={hint}
        onPointerEnter={() => requestPeek('peek')}
        onPointerLeave={() => {
          requestPeek('retract');
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) {
            requestPeek('peek');
          }
        }}
        onBlur={() => {
          if (!openingSearchRef.current) {
            requestPeek('retract');
          }
        }}
        {...drag}
      >
        <FoxHead
          key={snapping ? `snap-${dockEdge}-${snapToken}` : `idle-${dockEdge}`}
          size={FOX_VISUAL_SIZE}
          glowing
          warning={shortcutFailed}
          className={snapEdge === 'none' ? '' : `is-snapping is-snapping-${snapEdge}`}
          onAnimationEnd={(event) => {
            if (event.animationName.startsWith('fox-snap')) {
              finishSnap(peekEpochRef.current);
            }
            if (event.animationName.startsWith('fox-retract')) {
              finishRetract(peekEpochRef.current);
            }
          }}
        />
        {shortcutFailed ? (
          <span className="fox-warning-dot" data-testid="shortcut-fallback-dot" />
        ) : null}
      </button>
    </div>
  );
}
