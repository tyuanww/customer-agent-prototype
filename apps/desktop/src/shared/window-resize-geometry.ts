import type { Rect, Size } from './overlay-geometry';

export const WINDOW_RESIZE_DIRECTIONS = [
  'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right',
] as const;

export type WindowResizeDirection = (typeof WINDOW_RESIZE_DIRECTIONS)[number];

export function isWindowResizeDirection(value: unknown): value is WindowResizeDirection {
  return WINDOW_RESIZE_DIRECTIONS.some(direction => direction === value);
}

function resizeAxis(
  start: number,
  size: number,
  delta: number,
  areaStart: number,
  areaSize: number,
  min: number,
  max: number,
  movingStart: boolean,
): { start: number; size: number } {
  const end = start + size;
  const available = movingStart ? end - areaStart : areaStart + areaSize - start;
  const upper = Math.max(1, Math.min(max, available));
  const lower = Math.min(min, upper);
  const desired = size + (movingStart ? -delta : delta);
  const nextSize = Math.round(Math.min(upper, Math.max(lower, desired)));
  return { start: movingStart ? end - nextSize : start, size: nextSize };
}

/** Deltas are in logical pixels from pointer down. The baseline lies in bounds.
 * Resizing fixes each opposite edge and preserves any untouched axis. */
export function resizeRectFromEdge({
  baseline,
  bounds,
  direction,
  deltaX,
  deltaY,
  minSize,
  maxSize,
}: {
  baseline: Rect;
  bounds: Rect;
  direction: WindowResizeDirection;
  deltaX: number;
  deltaY: number;
  minSize: Size;
  maxSize: Size;
}): Rect {
  const left = direction.endsWith('left');
  const top = direction.startsWith('top');
  const horizontal = left || direction.endsWith('right')
    ? resizeAxis(baseline.x, baseline.width, deltaX, bounds.x, bounds.width, minSize.width, maxSize.width, left)
    : { start: baseline.x, size: baseline.width };
  const vertical = top || direction.startsWith('bottom')
    ? resizeAxis(baseline.y, baseline.height, deltaY, bounds.y, bounds.height, minSize.height, maxSize.height, top)
    : { start: baseline.y, size: baseline.height };
  return { x: horizontal.start, y: vertical.start, width: horizontal.size, height: vertical.size };
}
