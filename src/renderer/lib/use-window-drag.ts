import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import { DRAG_THRESHOLD_PX, MAX_DRAG_DELTA_PER_EVENT } from '@shared/overlay-geometry';

type DragHandlers = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLElement>) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
};

export function splitDragDelta(dx: number, dy: number): Array<{ dx: number; dy: number }> {
  const chunks = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_DRAG_DELTA_PER_EVENT),
  );
  return Array.from({ length: chunks }, () => ({ dx: dx / chunks, dy: dy / chunks }));
}

function pointerPoint(event: PointerEvent<HTMLElement>): { x: number; y: number } {
  return {
    // A physical screen edge is a valid zero coordinate. Falling back with
    // `||` mixes screen and client coordinate systems exactly when the fox is
    // dragged away from the left/top edge and creates a large false delta.
    x: event.screenX,
    y: event.screenY,
  };
}

export function useWindowDrag(
  onMove: (dx: number, dy: number, finished: boolean) => void,
  onClick: () => void,
): DragHandlers {
  const onMoveRef = useRef(onMove);
  const onClickRef = useRef(onClick);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const handledClickRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const captureTargetRef = useRef<HTMLElement | null>(null);

  onMoveRef.current = onMove;
  onClickRef.current = onClick;

  const emitClick = useCallback((): void => {
    if (movedRef.current || handledClickRef.current) {
      return;
    }
    handledClickRef.current = true;
    onClickRef.current();
  }, []);

  const emitMove = useCallback((dx: number, dy: number): void => {
    for (const chunk of splitDragDelta(dx, dy)) {
      onMoveRef.current(chunk.dx, chunk.dy, false);
    }
  }, []);

  const finishDrag = useCallback(
    (allowClick: boolean): void => {
      if (!draggingRef.current) {
        return;
      }

      const moved = movedRef.current;
      const pointerId = activePointerIdRef.current;
      const captureTarget = captureTargetRef.current;

      // Clear the drag first: releasePointerCapture may synchronously dispatch
      // lostpointercapture, which must not finish the same gesture twice.
      draggingRef.current = false;
      lastRef.current = null;
      activePointerIdRef.current = null;
      captureTargetRef.current = null;

      if (
        captureTarget &&
        pointerId !== null &&
        typeof captureTarget.releasePointerCapture === 'function'
      ) {
        try {
          if (
            typeof captureTarget.hasPointerCapture !== 'function' ||
            captureTarget.hasPointerCapture(pointerId)
          ) {
            captureTarget.releasePointerCapture(pointerId);
          }
        } catch {
          // The host may already have released capture while moving the window.
        }
      }

      if (moved) {
        onMoveRef.current(0, 0, true);
      }

      if (allowClick && !moved) {
        emitClick();
      } else {
        // Suppress any click synthesized after blur/cancel/lost capture.
        handledClickRef.current = true;
      }
    },
    [emitClick],
  );

  useEffect(() => {
    const stopOnBlur = (): void => {
      finishDrag(false);
    };
    window.addEventListener('blur', stopOnBlur);
    return () => {
      window.removeEventListener('blur', stopOnBlur);
    };
  }, [finishDrag]);

  return {
    onPointerDown(event) {
      if (typeof event.button === 'number' && event.button > 0) {
        return;
      }
      // macOS treats Ctrl+primary-click as a native context-menu gesture. Do not
      // start a drag or synthesize the normal primary action; the main process
      // still receives Electron's context-menu event and owns the native menu.
      if (event.ctrlKey) {
        handledClickRef.current = true;
        return;
      }
      if (draggingRef.current) {
        finishDrag(false);
      }
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // jsdom and some hosts do not implement pointer capture.
        }
      }
      draggingRef.current = true;
      movedRef.current = false;
      handledClickRef.current = false;
      lastRef.current = pointerPoint(event);
      activePointerIdRef.current = event.pointerId;
      captureTargetRef.current = event.currentTarget;
    },
    onPointerMove(event) {
      if (
        !draggingRef.current ||
        !lastRef.current ||
        activePointerIdRef.current !== event.pointerId
      ) {
        return;
      }
      // Electron can lose pointerup while the BrowserWindow follows the cursor.
      // A move with no primary button is authoritative evidence that the gesture
      // ended; finalize once and ignore all subsequent movement.
      if (typeof event.buttons === 'number' && (event.buttons & 1) === 0) {
        finishDrag(false);
        return;
      }
      const point = pointerPoint(event);
      const dx = point.x - lastRef.current.x;
      const dy = point.y - lastRef.current.y;
      if (!movedRef.current && dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        return;
      }
      movedRef.current = true;
      lastRef.current = point;
      emitMove(dx, dy);
    },
    onPointerUp(event) {
      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }
      finishDrag(true);
    },
    onPointerCancel(event) {
      if (activePointerIdRef.current === event.pointerId) {
        finishDrag(false);
      }
    },
    onLostPointerCapture(event) {
      if (activePointerIdRef.current === event.pointerId) {
        finishDrag(false);
      }
    },
    onClick(event) {
      if (event.ctrlKey && event.detail > 0) {
        event.preventDefault();
        return;
      }
      // Keyboard activation emits click without a preceding pointerdown.
      if (event.detail === 0) {
        onClickRef.current();
        return;
      }
      if (movedRef.current) {
        event.preventDefault();
        return;
      }
      emitClick();
    },
  };
}
