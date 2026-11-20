import { useRef } from 'react';
import { isWindowResizeDirection, WINDOW_RESIZE_DIRECTIONS } from '@shared/window-resize-geometry';
import { useWindowDrag } from './lib/use-window-drag';

export function SopResizeHandles({ sessionId, nextSequence }: {
  sessionId: number;
  nextSequence: () => number;
}) {
  const gesture = useRef<{ sequence: number; deltaX: number; deltaY: number } | null>(null);
  const drag = useWindowDrag(() => undefined, () => undefined, {
    onGestureSample({ totalDx, totalDy }) {
      const current = gesture.current;
      if (!current) return;
      current.deltaX = totalDx;
      current.deltaY = totalDy;
      void window.sopWindow?.resize?.({ type: 'update', sessionId, ...current });
    },
    onGestureEnd({ reason }) {
      const current = gesture.current;
      gesture.current = null;
      if (!current) return;
      void window.sopWindow?.resize?.(reason === 'up' || reason === 'buttons0'
        ? { type: 'end', sessionId, ...current }
        : { type: 'cancel', sessionId, sequence: current.sequence });
    },
  });
  return (
    <div className="sop-resize-handles" aria-hidden="true" {...drag} onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0 || event.ctrlKey || !(event.target instanceof HTMLElement)) return;
      const direction = event.target.dataset.edge;
      if (!isWindowResizeDirection(direction)) return;
      drag.onPointerDown(event);
      const sequence = nextSequence();
      gesture.current = { sequence, deltaX: 0, deltaY: 0 };
      void window.sopWindow?.resize?.({ type: 'begin', sessionId, sequence, direction });
    }}>
      {WINDOW_RESIZE_DIRECTIONS.map(direction => <div key={direction} data-edge={direction} />)}
    </div>
  );
}
