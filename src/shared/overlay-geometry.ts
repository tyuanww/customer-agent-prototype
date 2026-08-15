import type { FoxDockEdge, QueryAnchor, ResultCount } from './overlay-events';

export const FOX_WINDOW_SIZE = 88;
export const FOX_SIZE = FOX_WINDOW_SIZE;
export const FOX_VISUAL_SIZE = 64;
export const QUERY_WIDTH = 600;
export const QUERY_INPUT_HEIGHT = 88;
export const QUERY_PANEL_MIN_HEIGHT = 240;
export const QUERY_PANEL_ONE_RESULT_HEIGHT = 340;
export const QUERY_PANEL_TWO_RESULTS_HEIGHT = 430;
export const QUERY_PANEL_THREE_RESULTS_HEIGHT = 620;
export const QUERY_PANEL_MAX_HEIGHT = 620;
export const SCREEN_MARGIN = 8;
export const DRAG_THRESHOLD_PX = 4;
export const MAX_DRAG_DELTA_PER_EVENT = 240;
export const FOX_EDGE_TRIGGER_PX = 18;
// The 64px visual is centered in an 88px transparent window. Exposing half
// the window leaves exactly 32px (half) of the visual visible on either edge.
export const FOX_EDGE_VISIBLE_PX = FOX_SIZE / 2;
// Reveal the whole 64px visual with 4px of breathing room at the screen edge.
export const FOX_EDGE_PEEK_VISIBLE_PX = FOX_SIZE - 8;
export const FOX_EDGE_PEEK_TRAVEL_PX = FOX_EDGE_PEEK_VISIBLE_PX - FOX_EDGE_VISIBLE_PX;
// The peek state leaves only transparent chrome outside the work area. Fox
// dragging may preserve that small overflow so the first pointer delta stays
// continuous instead of snapping the native window to the ordinary 8px margin.
export const FOX_DRAG_SAFE_OVERFLOW_PX = FOX_SIZE - FOX_EDGE_PEEK_VISIBLE_PX;

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Size = {
  width: number;
  height: number;
};

export type OverlayChromePhase =
  | 'FOX_IDLE'
  | 'SEARCH_INPUT'
  | 'RESULTS'
  | 'EMPTY'
  | 'ERROR'
  | 'COPIED';

export function overlaySizeForPhase(phase: OverlayChromePhase, resultCount: ResultCount = 0): Size {
  if (phase === 'FOX_IDLE') {
    return { width: FOX_SIZE, height: FOX_SIZE };
  }
  if (phase === 'SEARCH_INPUT') {
    return { width: QUERY_WIDTH, height: QUERY_INPUT_HEIGHT };
  }
  if (phase === 'EMPTY' || (phase === 'ERROR' && resultCount === 0)) {
    return { width: QUERY_WIDTH, height: QUERY_PANEL_MIN_HEIGHT };
  }
  const height =
    resultCount <= 1
      ? QUERY_PANEL_ONE_RESULT_HEIGHT
      : resultCount === 2
        ? QUERY_PANEL_TWO_RESULTS_HEIGHT
        : QUERY_PANEL_THREE_RESULTS_HEIGHT;
  return { width: QUERY_WIDTH, height };
}

export function clampRectToWorkArea(
  rect: Rect,
  workArea: Rect,
  margin: number = SCREEN_MARGIN,
): Rect {
  const maxWidth = Math.max(1, workArea.width - margin * 2);
  const maxHeight = Math.max(1, workArea.height - margin * 2);
  const width = Math.min(Math.max(1, rect.width), maxWidth);
  const height = Math.min(Math.max(1, rect.height), maxHeight);
  const minX = workArea.x + margin;
  const minY = workArea.y + margin;
  const maxX = workArea.x + workArea.width - width - margin;
  const maxY = workArea.y + workArea.height - height - margin;
  const x = maxX >= minX ? Math.min(Math.max(rect.x, minX), maxX) : minX;
  const y = maxY >= minY ? Math.min(Math.max(rect.y, minY), maxY) : minY;
  return { x: Math.round(x), y: Math.round(y), width, height };
}

export function defaultFoxRect(workArea: Rect): Rect {
  return clampRectToWorkArea(
    {
      x: workArea.x + workArea.width - FOX_SIZE - 24,
      y: workArea.y + workArea.height - FOX_SIZE - 24,
      width: FOX_SIZE,
      height: FOX_SIZE,
    },
    workArea,
  );
}

export function inferFoxRectFromQuery(
  query: Pick<Rect, 'x' | 'y' | 'width'>,
  workArea: Rect,
  anchor: QueryAnchor,
): Rect {
  return clampRectToWorkArea(
    {
      x: anchor === 'right' ? query.x + query.width - FOX_SIZE : query.x,
      y: query.y,
      width: FOX_SIZE,
      height: FOX_SIZE,
    },
    workArea,
  );
}

export type QueryDragStep = {
  query: Rect;
  fox: Rect;
};

export function applyQueryDragIncrements(
  startQuery: Rect,
  workArea: Rect,
  pinnedAnchor: QueryAnchor,
  deltas: ReadonlyArray<{ dx: number; dy: number }>,
): QueryDragStep[] {
  const steps: QueryDragStep[] = [];
  let query = startQuery;
  for (const delta of deltas) {
    const nextQuery = clampRectToWorkArea(
      { ...query, x: query.x + delta.dx, y: query.y + delta.dy },
      workArea,
    );
    steps.push({
      query: nextQuery,
      fox: inferFoxRectFromQuery(nextQuery, workArea, pinnedAnchor),
    });
    query = nextQuery;
  }
  return steps;
}

export function settleQueryDragGesture(
  query: Pick<Rect, 'x' | 'y' | 'width'>,
  workArea: Rect,
  pinnedAnchor: QueryAnchor,
): { fox: Rect; dockEdge: FoxDockEdge; anchor: QueryAnchor } {
  const fox = inferFoxRectFromQuery(query, workArea, pinnedAnchor);
  return {
    fox,
    dockEdge: resolveFoxDockAfterDrag(fox, workArea),
    anchor: pinnedAnchor,
  };
}

export function resolveFoxDockAfterDrag(
  fox: Pick<Rect, 'x' | 'width'>,
  workArea: Rect,
): FoxDockEdge {
  return foxDockEdgeForRect(fox, workArea);
}

export function foxDockEdgeForRect(
  rect: Pick<Rect, 'x' | 'width'>,
  workArea: Rect,
  threshold: number = FOX_EDGE_TRIGGER_PX,
): FoxDockEdge {
  const leftDistance = rect.x - workArea.x;
  const rightDistance = workArea.x + workArea.width - (rect.x + rect.width);
  if (leftDistance <= threshold) {
    return 'left';
  }
  if (rightDistance <= threshold) {
    return 'right';
  }
  return 'none';
}

export function reconcileFoxDockEdgeForWorkArea(
  foxCenterX: number,
  workArea: Rect,
  edge: FoxDockEdge,
): FoxDockEdge {
  if (edge === 'none') {
    return edge;
  }
  const leftDistance = Math.abs(foxCenterX - workArea.x);
  const rightDistance = Math.abs(workArea.x + workArea.width - foxCenterX);
  if (leftDistance < rightDistance) {
    return 'left';
  }
  if (rightDistance < leftDistance) {
    return 'right';
  }
  return edge;
}

export function dockFoxRect(
  rect: Rect,
  workArea: Rect,
  edge: FoxDockEdge,
  visiblePx: number = FOX_EDGE_VISIBLE_PX,
): Rect {
  const clamped = clampRectToWorkArea(rect, workArea, 0);
  const visible = Math.min(clamped.width, Math.max(0, Math.round(visiblePx)));
  if (edge === 'left') {
    return { ...clamped, x: Math.round(workArea.x - clamped.width + visible) };
  }
  if (edge === 'right') {
    return {
      ...clamped,
      x: Math.round(workArea.x + workArea.width - visible),
    };
  }
  return clampRectToWorkArea(clamped, workArea);
}

/**
 * Keep the native transparent window fully inside the work area. macOS may
 * asynchronously clamp a partially off-screen panel back on-screen, which
 * creates a tug-of-war with repeated setBounds calls. The renderer performs
 * the half-fox crop inside this stable native frame instead.
 */
export function dockFoxNativeRect(
  rect: Rect,
  workArea: Rect,
  edge: FoxDockEdge,
): Rect {
  const clamped = clampRectToWorkArea(rect, workArea, 0);
  if (edge === 'left') {
    return { ...clamped, x: workArea.x };
  }
  if (edge === 'right') {
    return { ...clamped, x: workArea.x + workArea.width - clamped.width };
  }
  return clamped;
}

export function foxDragBaseRect(
  fullFoxRect: Rect,
  workArea: Rect,
  edge: FoxDockEdge,
): Rect {
  if (edge === 'none') {
    return fullFoxRect;
  }
  return dockFoxRect(fullFoxRect, workArea, edge, FOX_EDGE_PEEK_VISIBLE_PX);
}

export function placeQueryNearFox(
  fox: Pick<Rect, 'x' | 'y'>,
  size: Size,
  workArea: Rect,
): Rect {
  return clampRectToWorkArea(
    {
      x: fox.x,
      y: fox.y,
      width: size.width,
      height: size.height,
    },
    workArea,
  );
}

export function queryAnchorForFox(
  fox: Pick<Rect, 'x' | 'width'>,
  workArea: Rect,
): QueryAnchor {
  const center = fox.x + fox.width / 2;
  return center > workArea.x + workArea.width / 2 ? 'right' : 'left';
}

export function resolveSessionQueryAnchor(
  pinned: QueryAnchor | null,
  computed: QueryAnchor,
): QueryAnchor {
  return pinned ?? computed;
}

export function resolveQueryAnchorAfterCloseLifecycle(input: {
  pinned: QueryAnchor | null;
  computedFromIdleFox: QueryAnchor;
  closeCompleted: boolean;
}): QueryAnchor {
  return resolveSessionQueryAnchor(
    input.closeCompleted ? null : input.pinned,
    input.computedFromIdleFox,
  );
}

export function placeQueryAnchoredToFox(
  fox: Rect,
  size: Size,
  workArea: Rect,
  dockEdge: FoxDockEdge = 'none',
  pinnedAnchor?: QueryAnchor,
): Rect {
  const anchor = pinnedAnchor ?? queryAnchorForFox(fox, workArea);
  const placed = clampRectToWorkArea(
    {
      x: anchor === 'right' ? fox.x + fox.width - size.width : fox.x,
      y: fox.y,
      width: size.width,
      height: size.height,
    },
    workArea,
  );
  // A docked fox exposes 32px of its 64px visual exactly on the physical edge.
  // Keep the query window flush to that edge during the shared-element
  // handoff; the ordinary 8px safety margin would clip the proxy to 24px.
  if (dockEdge === 'left') {
    return { ...placed, x: workArea.x };
  }
  if (dockEdge === 'right') {
    return { ...placed, x: workArea.x + workArea.width - placed.width };
  }
  return placed;
}

export function isFiniteDelta(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function sanitizeDragDelta(dx: unknown, dy: unknown): { dx: number; dy: number } | null {
  if (!isFiniteDelta(dx) || !isFiniteDelta(dy)) {
    return null;
  }
  if (Math.abs(dx) > MAX_DRAG_DELTA_PER_EVENT || Math.abs(dy) > MAX_DRAG_DELTA_PER_EVENT) {
    return null;
  }
  return { dx, dy };
}
