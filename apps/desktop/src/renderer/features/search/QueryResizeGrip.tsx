import type { KeyboardEvent, PointerEvent } from 'react';
import {
  QUERY_LAYOUT_MIN_HEIGHT,
  QUERY_LAYOUT_MIN_WIDTH,
  type QueryResizeEdge,
} from '@shared/query-layout';
import { WINDOW_RESIZE_DIRECTIONS, type WindowResizeDirection } from '@shared/window-resize-geometry';

type ResizePointer = Pick<PointerEvent<HTMLDivElement>, 'pointerId' | 'screenX' | 'screenY'>;

type QueryResizeGripProps = {
  edge: QueryResizeEdge;
  height: number;
  width: number;
  onPointerDown: (event: PointerEvent<HTMLDivElement>, direction: WindowResizeDirection) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onFinish: (kind: 'end' | 'cancel', event: ResizePointer, alreadyLost?: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, axis: 'width' | 'height') => void;
};

export function QueryResizeGrip({
  edge,
  height,
  width,
  onPointerDown,
  onPointerMove,
  onFinish,
  onKeyDown,
}: QueryResizeGripProps) {
  return WINDOW_RESIZE_DIRECTIONS.map((direction) => {
    // A single keyboard control per axis keeps the tab order short.
    const axis = direction === edge ? 'height' : direction === 'right' ? 'width' : undefined;
    const value = axis === 'height' ? height : width;
    const min = axis === 'height' ? QUERY_LAYOUT_MIN_HEIGHT : QUERY_LAYOUT_MIN_WIDTH;
    const limit = axis === 'height' ? window.screen.availHeight : window.screen.availWidth;
    return (
      <div
        key={direction}
        className="query-resize-grip"
        role={axis ? 'separator' : undefined}
        aria-hidden={axis ? undefined : true}
        aria-orientation={axis === 'height' ? 'horizontal' : axis === 'width' ? 'vertical' : undefined}
        aria-label={axis === 'height' ? '调整查询窗高度' : axis === 'width' ? '调整查询窗宽度' : undefined}
        aria-valuemin={axis ? Math.min(min, value) : undefined}
        aria-valuemax={axis ? Math.max(value, limit) : undefined}
        aria-valuenow={axis ? value : undefined}
        aria-valuetext={axis ? `${value} 像素` : undefined}
        data-axis={axis}
        data-edge={direction}
        data-testid={axis === 'height' ? 'query-resize-grip' : `query-resize-${direction}`}
        tabIndex={axis ? 0 : undefined}
        onPointerDown={(event) => onPointerDown(event, direction)}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onFinish('end', event)}
        onPointerCancel={(event) => onFinish('cancel', event)}
        onLostPointerCapture={(event) => onFinish('cancel', event, true)}
        onKeyDown={axis ? (event) => onKeyDown(event, axis) : undefined}
      />
    );
  });
}
