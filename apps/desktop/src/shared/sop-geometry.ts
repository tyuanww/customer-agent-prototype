import { QUERY_INPUT_HEIGHT, clampRectToWorkArea, type Rect, type Size } from './overlay-geometry';

export const SOP_WIDTH = 600;
export const SOP_OPEN_HEIGHT = 240;
export const SOP_MIN_HEIGHT = 240;
export const SOP_MAX_HEIGHT = 620;
export const SOP_OFFSET_X = 16;
export const SOP_OFFSET_Y = 12;
export const SOP_COPY_FEEDBACK_MS = 1200;
export const SOP_LAYOUT_TIMEOUT_MS = 180;
export const SOP_CHROME_HEIGHT = 40;
export const SOP_CAPSULE_BAND = QUERY_INPUT_HEIGHT;

export function clampSopHeight(desiredHeight: number, availableHeight: number): number {
  const maxHeight = Math.max(1, Math.min(SOP_MAX_HEIGHT, Math.floor(availableHeight)));
  const minHeight = Math.min(SOP_MIN_HEIGHT, maxHeight);
  if (!Number.isFinite(desiredHeight)) {
    return minHeight;
  }
  return Math.round(Math.min(maxHeight, Math.max(minHeight, desiredHeight)));
}

export function sopOpeningSize(): Size {
  return { width: SOP_WIDTH, height: SOP_OPEN_HEIGHT };
}

function rectsOverlap(
  left: Pick<Rect, 'x' | 'y' | 'width' | 'height'>,
  right: Pick<Rect, 'x' | 'y' | 'width' | 'height'>,
): boolean {
  return (
    left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  );
}

function fitsInWorkArea(rect: Rect, workArea: Rect): boolean {
  return (
    rect.x >= workArea.x
    && rect.y >= workArea.y
    && rect.x + rect.width <= workArea.x + workArea.width
    && rect.y + rect.height <= workArea.y + workArea.height
  );
}

function queryCapsuleBand(query: Rect): Rect {
  return {
    x: query.x,
    y: query.y,
    width: query.width,
    height: Math.min(SOP_CAPSULE_BAND, query.height),
  };
}

function nudgeOffQueryOrigin(placed: Rect, query: Rect, workArea: Rect): Rect {
  if (placed.x !== query.x || placed.y !== query.y) {
    return placed;
  }
  const nudged = clampRectToWorkArea(
    { ...placed, x: placed.x + SOP_OFFSET_X, y: placed.y + SOP_OFFSET_Y },
    workArea,
  );
  if (nudged.x !== query.x || nudged.y !== query.y) {
    return nudged;
  }
  return clampRectToWorkArea(
    {
      ...placed,
      x: query.x + SOP_OFFSET_X,
      y: query.y + SOP_CAPSULE_BAND + SOP_OFFSET_Y,
    },
    workArea,
  );
}

function avoidQueryCapsule(placed: Rect, query: Rect, workArea: Rect): Rect {
  const capsule = queryCapsuleBand(query);
  if (!rectsOverlap(placed, capsule)) {
    return placed;
  }
  const belowCapsule = clampRectToWorkArea(
    { ...placed, y: query.y + capsule.height + SOP_OFFSET_Y },
    workArea,
  );
  if (!rectsOverlap(belowCapsule, capsule)) {
    return belowCapsule;
  }
  const rightOfCapsule = clampRectToWorkArea(
    { ...placed, x: query.x + query.width + SOP_OFFSET_X },
    workArea,
  );
  if (!rectsOverlap(rightOfCapsule, capsule)) {
    return rightOfCapsule;
  }
  return placed;
}

export function placeSopNearQuery(
  query: Rect | null,
  workArea: Rect,
  size: Size = sopOpeningSize(),
): Rect {
  const width = Math.min(SOP_WIDTH, Math.max(1, size.width));
  const height = clampSopHeight(size.height, workArea.height);
  if (!query) {
    return clampRectToWorkArea(
      { x: workArea.x + SOP_OFFSET_X, y: workArea.y + SOP_OFFSET_Y, width, height },
      workArea,
    );
  }

  const right = { x: query.x + query.width + SOP_OFFSET_X, y: query.y, width, height };
  const left = { x: query.x - width - SOP_OFFSET_X, y: query.y, width, height };
  const below = {
    x: query.x,
    y: query.y + query.height + SOP_OFFSET_Y,
    width,
    height,
  };

  const candidate = fitsInWorkArea(right, workArea)
    ? right
    : fitsInWorkArea(left, workArea)
      ? left
      : below;
  const clamped = clampRectToWorkArea(candidate, workArea);
  return avoidQueryCapsule(nudgeOffQueryOrigin(clamped, query, workArea), query, workArea);
}

export function applySopDrag(
  current: Rect,
  dx: number,
  dy: number,
  workArea: Rect,
): Rect {
  return clampRectToWorkArea(
    { ...current, x: current.x + dx, y: current.y + dy },
    workArea,
  );
}

export function applySopHeight(current: Rect, nextHeight: number, workArea: Rect): Rect {
  const height = clampSopHeight(nextHeight, workArea.height);
  const maxY = workArea.y + workArea.height - height;
  const y = Math.min(Math.max(current.y, workArea.y), maxY);
  return clampRectToWorkArea({ ...current, y, height, width: SOP_WIDTH }, workArea);
}
