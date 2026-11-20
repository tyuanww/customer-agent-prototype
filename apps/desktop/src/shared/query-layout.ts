import type { ReportablePhase, ResultCount } from './overlay-events';
import type { OverlayPhase } from './overlay-machine';
import {
  isOverlayReportIdentity,
  type OverlayReportIdentity,
} from './overlay-report';
import {
  QUERY_INPUT_HEIGHT,
  QUERY_PANEL_MAX_HEIGHT,
  QUERY_PANEL_MIN_HEIGHT,
  QUERY_WIDTH,
  SCREEN_MARGIN,
  availableOverlayHeight,
  preferredQuerySizeForPhase,
  type Rect,
  type Size,
} from './overlay-geometry';
import { isWindowResizeDirection, resizeRectFromEdge, type WindowResizeDirection } from './window-resize-geometry';

export const QUERY_LAYOUT_MIN_HEIGHT = QUERY_PANEL_MIN_HEIGHT;
export const QUERY_LAYOUT_MAX_HEIGHT = QUERY_PANEL_MAX_HEIGHT;
export const QUERY_LAYOUT_MIN_WIDTH = 360;
export const QUERY_RESIZE_STEP = 8;
export const QUERY_RESIZE_STEP_LARGE = 24;
export const QUERY_CONTENT_BLANK_TOLERANCE_PX = 12;
export const QUERY_LAYOUT_FALLBACK_MS = 160;

const QUERY_LAYOUT_KEYS = ['sessionId', 'sequence', 'phase', 'resultCount', 'desiredHeight', 'identity'] as const;
const QUERY_LAYOUT_ACK_KEYS = [
  'ok',
  'sessionId',
  'sequence',
  'phase',
  'resultCount',
  'height',
  'width',
  'resizeEdge',
] as const;
const QUERY_LAYOUT_ACK_COMMAND_KEYS = [
  'type',
  'sessionId',
  'sequence',
  'phase',
  'resultCount',
  'height',
  'width',
  'resizeEdge',
] as const;
const QUERY_RESIZE_KEYS = ['type', 'sessionId', 'sequence', 'identity'] as const;

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

export type QueryResizeEdge = Extract<WindowResizeDirection, 'top' | 'bottom'>;
export type QueryChromeHandoffMode = 'preparing-open' | 'opening' | 'closing' | null;
export type QueryResizeKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export type QueryLayoutRequest = {
  sessionId: number;
  sequence: number;
  phase: ReportablePhase;
  resultCount: ResultCount;
  desiredHeight: number;
  identity: OverlayReportIdentity;
};

type QueryLayoutAckFields = {
  sessionId: number;
  sequence: number;
  phase: ReportablePhase;
  resultCount: ResultCount;
  height: number;
  width: number;
  resizeEdge: QueryResizeEdge;
};

export type QueryLayoutAck =
  | ({ ok: true } & QueryLayoutAckFields)
  | ({ ok: false } & QueryLayoutAckFields);

export type QueryLayoutAckCommand = {
  type: 'query-layout-ack';
  sessionId: number;
  sequence: number;
  phase: ReportablePhase;
  resultCount: ResultCount;
  height: number;
  width: number;
  resizeEdge: QueryResizeEdge;
};

export type QueryResizeDelta = { deltaX: number; deltaY: number };

export type QueryResizeRequest = {
  sessionId: number;
  sequence: number;
  identity: OverlayReportIdentity;
} & (
  | { type: 'begin'; direction: WindowResizeDirection }
  | ({ type: 'update' | 'end' } & QueryResizeDelta)
  | { type: 'cancel' }
  | ({ type: 'keyboard'; shiftKey: boolean } & (
      | { axis: 'height'; key: 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' }
      | { axis: 'width'; key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' }
    ))
);

export function isQueryResizeEdge(value: unknown): value is QueryResizeEdge {
  return value === 'top' || value === 'bottom';
}

export function isFiniteQueryInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value);
}

export function isQueryLayoutSessionId(value: unknown): value is number {
  return isFiniteQueryInteger(value) && value > 0;
}

export function isQueryLayoutSequence(value: unknown): value is number {
  return isFiniteQueryInteger(value) && value > 0;
}

export function isQueryLayoutRequest(value: unknown): value is QueryLayoutRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (!hasExactKeys(value, QUERY_LAYOUT_KEYS)) {
    return false;
  }
  const record = value as Partial<QueryLayoutRequest>;
  return (
    isQueryLayoutSessionId(record.sessionId) &&
    isQueryLayoutSequence(record.sequence) &&
    (record.phase === 'SEARCH_INPUT' ||
      record.phase === 'RESULTS' ||
      record.phase === 'EMPTY' ||
      record.phase === 'ERROR' ||
      record.phase === 'COPIED') &&
    (record.resultCount === 0 ||
      record.resultCount === 1 ||
      record.resultCount === 2 ||
      record.resultCount === 3) &&
    isFiniteQueryInteger(record.desiredHeight) &&
    isOverlayReportIdentity(record.identity)
  );
}

export function isQueryResizeRequest(value: unknown): value is QueryResizeRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const request = value as Record<string, unknown>;
  if (
    !isQueryLayoutSessionId(request.sessionId)
    || !isQueryLayoutSequence(request.sequence)
    || !isOverlayReportIdentity(request.identity)
  ) {
    return false;
  }
  switch (request.type) {
    case 'begin':
      return hasExactKeys(value, [...QUERY_RESIZE_KEYS, 'direction'])
        && isWindowResizeDirection(request.direction);
    case 'update':
    case 'end':
      return hasExactKeys(value, [...QUERY_RESIZE_KEYS, 'deltaX', 'deltaY'])
        && isQueryResizeDelta(request.deltaX)
        && isQueryResizeDelta(request.deltaY);
    case 'cancel':
      return hasExactKeys(value, QUERY_RESIZE_KEYS);
    case 'keyboard':
      return hasExactKeys(value, [...QUERY_RESIZE_KEYS, 'axis', 'key', 'shiftKey'])
        && typeof request.shiftKey === 'boolean'
        && (request.axis === 'width'
          ? request.key === 'ArrowLeft' || request.key === 'ArrowRight' || request.key === 'Home' || request.key === 'End'
          : request.axis === 'height' && (request.key === 'ArrowUp' || request.key === 'ArrowDown' || request.key === 'Home' || request.key === 'End'));
    default:
      return false;
  }
}

function isQueryResizeDelta(value: unknown): value is number {
  return isFiniteQueryInteger(value) && Math.abs(value) <= 4096;
}

export function acceptQueryLayoutSequence(current: number, incoming: number): boolean {
  return isQueryLayoutSequence(incoming) && incoming > current;
}

export function isQueryLayoutAck(value: unknown): value is QueryLayoutAck {
  if (!value || typeof value !== 'object' || !hasExactKeys(value, QUERY_LAYOUT_ACK_KEYS)) {
    return false;
  }
  const record = value as Partial<QueryLayoutAck>;
  const validIdentifiers = record.ok === true
    ? isQueryLayoutSessionId(record.sessionId) && isQueryLayoutSequence(record.sequence)
    : record.ok === false
      && isFiniteQueryInteger(record.sessionId)
      && record.sessionId >= 0
      && isFiniteQueryInteger(record.sequence)
      && record.sequence >= 0;
  return (
    validIdentifiers &&
    (record.phase === 'SEARCH_INPUT' ||
      record.phase === 'RESULTS' ||
      record.phase === 'EMPTY' ||
      record.phase === 'ERROR' ||
      record.phase === 'COPIED') &&
    (record.resultCount === 0 ||
      record.resultCount === 1 ||
      record.resultCount === 2 ||
      record.resultCount === 3) &&
    isFiniteQueryInteger(record.height) &&
    record.height > 0 &&
    isFiniteQueryInteger(record.width) &&
    record.width > 0 &&
    isQueryResizeEdge(record.resizeEdge)
  );
}

export function isQueryLayoutAckCommand(value: unknown): value is QueryLayoutAckCommand {
  if (!value || typeof value !== 'object' || !hasExactKeys(value, QUERY_LAYOUT_ACK_COMMAND_KEYS)) {
    return false;
  }
  const record = value as { type?: unknown };
  if (record.type !== 'query-layout-ack') {
    return false;
  }
  const { type: _type, ...ackFields } = value as QueryLayoutAckCommand & { ok?: boolean };
  return isQueryLayoutAck({
    ok: true,
    ...ackFields,
  });
}

export function shouldIgnoreQueryLayout(
  handoffMode: QueryChromeHandoffMode,
  phase: OverlayPhase,
): boolean {
  return (
    handoffMode === 'preparing-open' ||
    handoffMode === 'opening' ||
    handoffMode === 'closing' ||
    phase === 'FOX_IDLE'
  );
}

export function isQueryContentLayoutPhase(
  phase: OverlayPhase,
): phase is 'RESULTS' | 'EMPTY' | 'ERROR' {
  return phase === 'RESULTS' || phase === 'EMPTY' || phase === 'ERROR';
}

export function acceptQueryLayoutAck(input: {
  ack: QueryLayoutAck | null | undefined;
  requestSessionId?: number;
  requestSequence?: number;
  minSequence: number;
  activeSessionId: number;
  currentPhase: OverlayPhase;
  currentResultCount: ResultCount;
}): boolean {
  if (!isQueryLayoutAck(input.ack) || !input.ack.ok) {
    return false;
  }
  if (input.ack.sessionId !== input.activeSessionId) {
    return false;
  }
  if (input.requestSessionId !== undefined && input.ack.sessionId !== input.requestSessionId) {
    return false;
  }
  if (input.requestSequence !== undefined && input.ack.sequence !== input.requestSequence) {
    return false;
  }
  if (!acceptQueryLayoutSequence(input.minSequence, input.ack.sequence)) {
    return false;
  }
  if (input.ack.phase !== input.currentPhase) {
    return false;
  }
  if (input.ack.resultCount !== input.currentResultCount) {
    return false;
  }
  return true;
}

export function composeQueryDesiredHeight(input: {
  capsuleHeight?: number;
  bannerHeight?: number;
  contentScrollHeight?: number;
  chromeExtra?: number;
  gripHeight?: number;
}): number {
  const capsule = Number.isFinite(input.capsuleHeight)
    ? Math.max(0, input.capsuleHeight as number)
    : QUERY_INPUT_HEIGHT;
  const banner = Number.isFinite(input.bannerHeight) ? Math.max(0, input.bannerHeight as number) : 0;
  const content = Number.isFinite(input.contentScrollHeight)
    ? Math.max(0, input.contentScrollHeight as number)
    : 0;
  const chrome = Number.isFinite(input.chromeExtra) ? Math.max(0, input.chromeExtra as number) : 0;
  const grip = Number.isFinite(input.gripHeight) ? Math.max(0, input.gripHeight as number) : 0;
  return Math.round(capsule + banner + content + chrome + grip);
}

export function hugQueryDesiredHeight(contentBottom: number, shellTop: number): number {
  return Math.round(contentBottom - shellTop + QUERY_CONTENT_BLANK_TOLERANCE_PX);
}

export function measureQueryHugHeight(input: {
  shellTop: number;
  paneTop?: number;
  paneScrollHeight?: number;
  panePaddingBottom?: number;
  lastContentBottom?: number;
}): number {
  const pad = Math.max(0, input.panePaddingBottom ?? 0);
  const fromScroll =
    Number.isFinite(input.paneTop) && Number.isFinite(input.paneScrollHeight)
      ? (input.paneTop as number) + Math.max(0, (input.paneScrollHeight as number) - pad)
      : 0;
  const fromLast = Number.isFinite(input.lastContentBottom) ? (input.lastContentBottom as number) : 0;
  // scrollHeight rounds to whole CSS pixels and can include overflow/focus-ring
  // paint beyond the last result. Prefer the actual final content edge when it
  // exists so a naturally sized Query does not retain a visible bottom gutter.
  return hugQueryDesiredHeight(fromLast > 0 ? fromLast : fromScroll, input.shellTop);
}

export function clampQueryDesiredHeight(
  desiredHeight: number,
  availableHeight: number,
): number {
  return clampQueryHeight(desiredHeight, Math.min(availableHeight, QUERY_LAYOUT_MAX_HEIGHT));
}

function clampQueryHeight(desiredHeight: number, availableHeight: number): number {
  const maxHeight = Math.max(1, Math.floor(availableHeight));
  const minHeight = Math.min(QUERY_LAYOUT_MIN_HEIGHT, maxHeight);
  if (!Number.isFinite(desiredHeight)) {
    return minHeight;
  }
  return Math.round(Math.min(maxHeight, Math.max(minHeight, desiredHeight)));
}

export function fallbackQuerySizeForPhase(
  phase: OverlayPhase,
  resultCount: ResultCount = 0,
  workArea?: Pick<Rect, 'height'>,
): Size {
  const preferred = preferredQuerySizeForPhase(phase, resultCount);
  if (!workArea || phase === 'FOX_IDLE' || phase === 'SEARCH_INPUT') {
    return preferred;
  }
  return {
    width: QUERY_WIDTH,
    height: clampQueryDesiredHeight(preferred.height, availableOverlayHeight(workArea)),
  };
}

export function effectiveQuerySize(input: {
  phase: OverlayPhase;
  resultCount?: ResultCount;
  workArea?: Size;
  measuredHeight?: number | null;
  manualSize?: Size | null;
}): Size {
  if (input.phase === 'FOX_IDLE') {
    return preferredQuerySizeForPhase(input.phase);
  }
  if (input.phase === 'SEARCH_INPUT') {
    return preferredQuerySizeForPhase(input.phase);
  }
  const available = input.workArea ? availableOverlayHeight(input.workArea) : QUERY_LAYOUT_MAX_HEIGHT;
  if (input.manualSize) {
    return {
      width: clampQueryDesiredWidth(input.manualSize.width, input.workArea ? availableQueryWidth(input.workArea) : Infinity),
      height: clampQueryHeight(input.manualSize.height, available),
    };
  }
  if (typeof input.measuredHeight === 'number' && Number.isFinite(input.measuredHeight)) {
    return {
      width: QUERY_WIDTH,
      height: clampQueryDesiredHeight(input.measuredHeight, available),
    };
  }
  return fallbackQuerySizeForPhase(input.phase, input.resultCount ?? 0, input.workArea);
}

function availableQueryWidth(workArea: Pick<Size, 'width'>): number {
  return Math.max(1, workArea.width - SCREEN_MARGIN * 2);
}

export function clampQueryDesiredWidth(desiredWidth: number, availableWidth: number): number {
  const maxWidth = Math.max(1, Math.floor(availableWidth));
  return Math.round(Math.min(maxWidth, Math.max(Math.min(QUERY_LAYOUT_MIN_WIDTH, maxWidth), desiredWidth)));
}

/** Resizing one edge retains the position of the opposite edge. Deltas are from pointer down. */
export function applyQueryResize(
  baseline: Rect,
  direction: WindowResizeDirection,
  delta: QueryResizeDelta,
  workArea: Rect,
): Rect {
  return resizeRectFromEdge({
    baseline,
    bounds: workArea,
    direction,
    ...delta,
    minSize: { width: QUERY_LAYOUT_MIN_WIDTH, height: QUERY_LAYOUT_MIN_HEIGHT },
    maxSize: { width: availableQueryWidth(workArea), height: availableOverlayHeight(workArea) },
  });
}

export function resolveQueryResizeEdge(
  query: Pick<Rect, 'y' | 'height'>,
  workArea: Pick<Rect, 'y' | 'height'>,
): QueryResizeEdge {
  const spaceAbove = query.y - workArea.y;
  const spaceBelow = workArea.y + workArea.height - (query.y + query.height);
  return spaceBelow >= spaceAbove ? 'bottom' : 'top';
}

export function pickQueryResizeEdgeForHeight(
  query: Rect,
  nextHeight: number,
  workArea: Rect,
  preferred: QueryResizeEdge,
): QueryResizeEdge {
  const preferredFit = applyQueryVerticalResize(query, nextHeight, preferred, workArea);
  const target = Math.min(
    Math.max(1, nextHeight),
    availableOverlayHeight(workArea),
  );
  if (preferredFit.height >= target) {
    return preferred;
  }
  const other: QueryResizeEdge = preferred === 'bottom' ? 'top' : 'bottom';
  const otherFit = applyQueryVerticalResize(query, nextHeight, other, workArea);
  return otherFit.height > preferredFit.height ? other : preferred;
}

export function applyQueryVerticalResize(
  query: Rect,
  nextHeight: number,
  edge: QueryResizeEdge,
  workArea: Rect,
): Rect {
  const globalAvailable = availableOverlayHeight(workArea);
  if (edge === 'top') {
    const bottom = query.y + query.height;
    const minY = workArea.y + SCREEN_MARGIN;
    const maxHeight = Math.max(1, Math.min(globalAvailable, bottom - minY));
    const height = clampQueryDesiredHeight(nextHeight, maxHeight);
    const y = Math.min(bottom - 1, Math.max(minY, bottom - height));
    return {
      x: query.x,
      y: Math.round(y),
      width: query.width,
      height,
    };
  }
  const maxHeight = Math.max(
    1,
    Math.min(globalAvailable, workArea.y + workArea.height - SCREEN_MARGIN - query.y),
  );
  const height = clampQueryDesiredHeight(nextHeight, maxHeight);
  return {
    x: query.x,
    y: query.y,
    width: query.width,
    height,
  };
}

export function queryResizeDeltaForKey(
  key: QueryResizeKey,
  shiftKey: boolean,
): number | 'natural' | 'max' {
  if (key === 'Home') {
    return 'natural';
  }
  if (key === 'End') {
    return 'max';
  }
  const step = shiftKey ? QUERY_RESIZE_STEP_LARGE : QUERY_RESIZE_STEP;
  return key === 'ArrowDown' || key === 'ArrowRight' ? step : -step;
}

export function queryHandoffCenterFromBounds(
  foxCenter: { x: number; y: number },
  query: Pick<Rect, 'x' | 'y'>,
): { x: number; y: number } {
  return {
    x: foxCenter.x - query.x,
    y: foxCenter.y - query.y,
  };
}

export function reportableOverlayPhase(phase: OverlayPhase): ReportablePhase {
  return phase === 'FOX_IDLE' ? 'SEARCH_INPUT' : phase;
}

export function acceptedQueryLayoutAck(
  sessionId: number,
  sequence: number,
  height: number,
  resizeEdge: QueryResizeEdge,
  phase: ReportablePhase,
  resultCount: ResultCount,
  width = QUERY_WIDTH,
): QueryLayoutAck {
  return {
    ok: true,
    sessionId,
    sequence,
    phase,
    resultCount,
    height,
    width,
    resizeEdge,
  };
}

export function queryLayoutAckCommand(
  sessionId: number,
  sequence: number,
  phase: ReportablePhase,
  resultCount: ResultCount,
  height: number,
  resizeEdge: QueryResizeEdge,
  width = QUERY_WIDTH,
): QueryLayoutAckCommand {
  return {
    type: 'query-layout-ack',
    sessionId,
    sequence,
    phase,
    resultCount,
    height,
    width,
    resizeEdge,
  };
}

export function rejectedQueryLayoutAck(
  sessionId: number,
  sequence: number,
  height = QUERY_INPUT_HEIGHT,
  resizeEdge: QueryResizeEdge = 'bottom',
  phase: ReportablePhase = 'SEARCH_INPUT',
  resultCount: ResultCount = 0,
  width = QUERY_WIDTH,
): QueryLayoutAck {
  return {
    ok: false,
    sessionId,
    sequence,
    phase,
    resultCount,
    height,
    width,
    resizeEdge,
  };
}
