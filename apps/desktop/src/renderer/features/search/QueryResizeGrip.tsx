import type { KeyboardEvent, PointerEvent, Ref } from 'react';
import {
  QUERY_LAYOUT_MAX_HEIGHT,
  QUERY_LAYOUT_MIN_HEIGHT,
  type QueryResizeEdge,
} from '@shared/query-layout';

type QueryResizeGripProps = {
  gripRef: Ref<HTMLDivElement>;
  activePointerIdRef: { current: number | null };
  edge: QueryResizeEdge;
  height: number;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onFinish: (kind: 'end' | 'cancel', pointerId: number, options?: { alreadyLost?: boolean }) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

export function QueryResizeGrip({
  gripRef,
  activePointerIdRef,
  edge,
  height,
  onPointerDown,
  onPointerMove,
  onFinish,
  onKeyDown,
}: QueryResizeGripProps) {
  return (
    <div
      ref={gripRef}
      className="query-resize-grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整查询窗高度"
      aria-valuemin={QUERY_LAYOUT_MIN_HEIGHT}
      aria-valuemax={QUERY_LAYOUT_MAX_HEIGHT}
      aria-valuenow={height}
      aria-valuetext={`${height} 像素`}
      data-edge={edge}
      data-testid="query-resize-grip"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        if (activePointerIdRef.current !== event.pointerId) {
          return;
        }
        onFinish('end', event.pointerId);
      }}
      onPointerCancel={(event) => {
        if (activePointerIdRef.current !== event.pointerId) {
          return;
        }
        onFinish('cancel', event.pointerId);
      }}
      onLostPointerCapture={(event) => {
        if (activePointerIdRef.current !== event.pointerId) {
          return;
        }
        onFinish('cancel', event.pointerId, { alreadyLost: true });
      }}
      onKeyDown={onKeyDown}
    />
  );
}
