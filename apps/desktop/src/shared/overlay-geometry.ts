import type { FoxDockEdge, QueryAnchor, ResultCount } from './overlay-events';
import type { OverlayPhase } from './overlay-machine';

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
// Peek chrome leftover inside the on-screen 88px frame (not a native overflow).
// Native fox bounds stay fully inside workArea with margin 0.
export const FOX_DRAG_SAFE_OVERFLOW_PX = FOX_SIZE - FOX_EDGE_PEEK_VISIBLE_PX;
export const FOX_REST_CROP_OFFSET_PX = FOX_SIZE - FOX_EDGE_VISIBLE_PX;
export const FOX_PEEK_CROP_OFFSET_PX = FOX_SIZE - FOX_EDGE_PEEK_VISIBLE_PX;

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

export function preferredQuerySizeForPhase(
  phase: OverlayPhase,
  resultCount: ResultCount = 0,
): Size {
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

export function availableOverlayHeight(workArea: Pick<Rect, 'height'>): number {
  return Math.max(1, workArea.height - SCREEN_MARGIN * 2);
}

export function overlaySizeForPhase(
  phase: OverlayPhase,
  resultCount: ResultCount = 0,
  workArea?: Pick<Rect, 'height'>,
  measuredHeight?: number | null,
): Size {
  if (phase === 'FOX_IDLE' || phase === 'SEARCH_INPUT') {
    return preferredQuerySizeForPhase(phase, resultCount);
  }
  const available = workArea ? availableOverlayHeight(workArea) : QUERY_PANEL_MAX_HEIGHT;
  if (typeof measuredHeight === 'number' && Number.isFinite(measuredHeight)) {
    const maxHeight = Math.max(QUERY_PANEL_MIN_HEIGHT, Math.min(QUERY_PANEL_MAX_HEIGHT, available));
    return {
      width: QUERY_WIDTH,
      height: Math.round(Math.min(maxHeight, Math.max(QUERY_PANEL_MIN_HEIGHT, measuredHeight))),
    };
  }
  const preferred = preferredQuerySizeForPhase(phase, resultCount);
  return {
    width: preferred.width,
    height: Math.min(preferred.height, available),
  };
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

/**
 * Resolve the shared-element center from the native Fox frame that the window
 * server actually accepted. A macOS window manager may seat a background
 * overlay at an active-stage boundary instead of the requested display edge;
 * deriving this point from workArea would make the handoff jump away from the
 * visible fox.
 */
export function foxVisualCenterForNativeRect(
  rect: Pick<Rect, 'x' | 'y' | 'width' | 'height'>,
  edge: FoxDockEdge,
  peekTravelPx = 0,
): { x: number; y: number } {
  const peekTravel = Math.min(rect.width, Math.max(0, peekTravelPx));
  const x = edge === 'left'
    ? rect.x + peekTravel
    : edge === 'right'
      ? rect.x + rect.width - peekTravel
      : rect.x + rect.width / 2;
  return {
    x,
    y: rect.y + rect.height / 2,
  };
}

export function foxDragBaseRect(
  fullFoxRect: Rect,
  workArea: Rect,
  edge: FoxDockEdge,
): Rect {
  if (edge === 'none') {
    return fullFoxRect;
  }
  return dockFoxNativeRect(fullFoxRect, workArea, edge);
}

export function isRectFullyOnWorkArea(
  rect: Pick<Rect, 'x' | 'y' | 'width' | 'height'>,
  workArea: Rect,
  margin = 0,
): boolean {
  return (
    rect.x >= workArea.x + margin
    && rect.y >= workArea.y + margin
    && rect.x + rect.width <= workArea.x + workArea.width - margin
    && rect.y + rect.height <= workArea.y + workArea.height - margin
  );
}

export function isInwardFoxDrag(edge: FoxDockEdge, dx: number): boolean {
  if (edge === 'left') {
    return dx > 0;
  }
  if (edge === 'right') {
    return dx < 0;
  }
  return false;
}

export function foxDockCropOffsetPx(peeking: boolean): number {
  return peeking ? FOX_PEEK_CROP_OFFSET_PX : FOX_REST_CROP_OFFSET_PX;
}

export function foxDragInwardPx(edge: 'left' | 'right', totalDx: number): number {
  return edge === 'left' ? totalDx : -totalDx;
}

export function foxDragSessionHeadOffset(
  edge: 'left' | 'right',
  cropPx: number,
  inwardPx: number,
): number {
  const remaining = Math.max(0, cropPx - Math.max(0, inwardPx));
  if (remaining === 0) {
    return 0;
  }
  return edge === 'left' ? -remaining : remaining;
}

export type FoxDockDragSession = {
  edge: 'left' | 'right';
  cropPx: number;
  originX: number;
  originY: number;
  logicalInward: number;
  logicalDy: number;
};

export function createFoxDockDragSession(
  edge: 'left' | 'right',
  peeking: boolean,
  origin: Pick<Rect, 'x' | 'y'>,
): FoxDockDragSession {
  return {
    edge,
    cropPx: foxDockCropOffsetPx(peeking),
    originX: origin.x,
    originY: origin.y,
    logicalInward: 0,
    logicalDy: 0,
  };
}

export function foxDockDragSessionExtraPx(session: FoxDockDragSession): number {
  return Math.max(0, session.logicalInward - session.cropPx);
}

export function foxDockDragSessionVisuallyUndocked(
  session: Pick<FoxDockDragSession, 'logicalInward'>,
): boolean {
  return session.logicalInward > 0;
}

export function foxDockDragSessionNativeRect(
  session: FoxDockDragSession,
  workArea: Rect,
): Rect {
  const extra = foxDockDragSessionExtraPx(session);
  const sign = session.edge === 'left' ? 1 : -1;
  return clampRectToWorkArea(
    {
      x: session.originX + sign * extra,
      y: session.originY + session.logicalDy,
      width: FOX_SIZE,
      height: FOX_SIZE,
    },
    workArea,
    0,
  );
}

export function advanceFoxDockDragSession(
  session: FoxDockDragSession,
  dx: number,
  dy: number,
  workArea: Rect,
): {
  session: FoxDockDragSession;
  nativeRect: Rect;
} {
  const inwardDelta = foxDragInwardPx(session.edge, dx);
  const nextSession: FoxDockDragSession = {
    ...session,
    logicalInward: session.logicalInward + inwardDelta,
    logicalDy: session.logicalDy + dy,
  };
  return {
    session: nextSession,
    nativeRect: foxDockDragSessionNativeRect(nextSession, workArea),
  };
}

export function finishFoxDockDragSession(
  session: FoxDockDragSession,
  workArea: Rect,
): { rect: Rect; edge: FoxDockEdge } {
  if (session.logicalInward <= session.cropPx) {
    const seated = clampRectToWorkArea(
      {
        x: session.originX,
        y: session.originY + session.logicalDy,
        width: FOX_SIZE,
        height: FOX_SIZE,
      },
      workArea,
      0,
    );
    return { rect: seated, edge: session.edge };
  }
  const visual = foxDockDragSessionNativeRect(session, workArea);
  const edge = resolveFoxDockAfterDrag(visual, workArea);
  return { rect: dockFoxNativeRect(visual, workArea, edge), edge };
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
  // Keep a docked Query aligned with the native Fox frame that WindowServer
  // actually accepted. Stage Manager may seat a background overlay inward
  // from the physical workArea edge; re-requesting x=0 here would make the
  // shared-element handoff jump and restart the native boundary tug-of-war.
  if (dockEdge === 'left') {
    return clampRectToWorkArea({ ...placed, x: fox.x }, workArea, 0);
  }
  if (dockEdge === 'right') {
    return clampRectToWorkArea(
      { ...placed, x: fox.x + fox.width - placed.width },
      workArea,
      0,
    );
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
