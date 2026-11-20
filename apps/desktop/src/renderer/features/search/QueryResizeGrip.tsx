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
    const keyboardAxis = direction === edge ? 'height' : direction === 'right' ? 'width' : undefined;
    const value = keyboardAxis === 'height' ? height : width;
    const min = keyboardAxis === 'height' ? QUERY_LAYOUT_MIN_HEIGHT : QUERY_LAYOUT_MIN_WIDTH;
    const limit = keyboardAxis === 'height' ? window.screen.availHeight : window.screen.availWidth;
    return (
      <div
        key={direction}
        className="query-resize-grip"
        role={keyboardAxis ? 'separator' : undefined}
        aria-hidden={keyboardAxis ? undefined : true}
        aria-orientation={keyboardAxis === 'height' ? 'horizontal' : keyboardAxis === 'width' ? 'vertical' : undefined}
        aria-label={keyboardAxis === 'height' ? '调整查询窗高度' : keyboardAxis === 'width' ? '调整查询窗宽度' : undefined}
        aria-valuemin={keyboardAxis ? Math.min(min, value) : undefined}
        aria-valuemax={keyboardAxis ? Math.max(value, limit) : undefined}
        aria-valuenow={keyboardAxis ? value : undefined}
        aria-valuetext={keyboardAxis ? `${value} 像素` : undefined}
        data-axis={keyboardAxis}
        data-edge={direction}
        data-testid={keyboardAxis === 'height' ? 'query-resize-grip' : `query-resize-${direction}`}
        tabIndex={keyboardAxis ? 0 : undefined}
        onPointerDown={(event) => onPointerDown(event, direction)}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onFinish('end', event)}
        onPointerCancel={(event) => onFinish('cancel', event)}
        onLostPointerCapture={(event) => onFinish(event.buttons === 0 ? 'end' : 'cancel', event, true)}
        onKeyDown={keyboardAxis ? (event) => onKeyDown(event, keyboardAxis) : undefined}
      />
    );
  });
}
