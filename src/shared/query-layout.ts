import type { ReportablePhase, ResultCount } from './overlay-events';
import {
  QUERY_INPUT_HEIGHT,
  QUERY_PANEL_MAX_HEIGHT,
  QUERY_PANEL_MIN_HEIGHT,
  QUERY_WIDTH,
  SCREEN_MARGIN,
  availableOverlayHeight,
  preferredQuerySizeForPhase,
  type OverlayChromePhase,
  type Rect,
  type Size,
} from './overlay-geometry';

export const QUERY_LAYOUT_MIN_HEIGHT = QUERY_PANEL_MIN_HEIGHT;
export const QUERY_LAYOUT_MAX_HEIGHT = QUERY_PANEL_MAX_HEIGHT;
export const QUERY_RESIZE_STEP = 8;
export const QUERY_RESIZE_STEP_LARGE = 24;
export const QUERY_CONTENT_BLANK_TOLERANCE_PX = 12;
export const QUERY_LAYOUT_FALLBACK_MS = 160;

const QUERY_LAYOUT_KEYS = ['sessionId', 'sequence', 'phase', 'resultCount', 'desiredHeight'] as const;
const QUERY_LAYOUT_ACK_KEYS = [
  'ok',
  'sessionId',
  'sequence',
  'phase',
  'resultCount',
  'height',
  'resizeEdge',
] as const;
const QUERY_LAYOUT_ACK_COMMAND_KEYS = [
  'type',
  'sessionId',
  'sequence',
  'phase',
  'resultCount',
  'height',
  'resizeEdge',
] as const;
const QUERY_RESIZE_BEGIN_KEYS = ['type', 'sessionId', 'sequence'] as const;
const QUERY_RESIZE_UPDATE_KEYS = ['type', 'sessionId', 'sequence', 'deltaY'] as const;
const QUERY_RESIZE_KEYBOARD_KEYS = ['type', 'sessionId', 'sequence', 'key', 'shiftKey'] as const;

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

export type QueryResizeEdge = 'top' | 'bottom';
export type QueryChromeHandoffMode = 'preparing-open' | 'opening' | 'closing' | null;
export type QueryResizeKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

export type QueryLayoutRequest = {
  sessionId: number;
  sequence: number;
  phase: ReportablePhase;
  resultCount: ResultCount;
  desiredHeight: number;
};

type QueryLayoutAckFields = {
  sessionId: number;
  sequence: number;
  phase: ReportablePhase;
  resultCount: ResultCount;
  height: number;
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
  resizeEdge: QueryResizeEdge;
};

export type QueryResizeRequest =
  | {
      type: 'begin';
      sessionId: number;
      sequence: number;
    }
  | {
      type: 'update';
      sessionId: number;
      sequence: number;
      deltaY: number;
    }
  | {
      type: 'end' | 'cancel';
      sessionId: number;
      sequence: number;
    }
  | {
      type: 'keyboard';
      sessionId: number;
      sequence: number;
      key: QueryResizeKey;
      shiftKey: boolean;
    };

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
    isFiniteQueryInteger(record.desiredHeight)
  );
}

export function isQueryResizeRequest(value: unknown): value is QueryResizeRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { type?: unknown };
  if (
    record.type === 'begin' ||
    record.type === 'end' ||
    record.type === 'cancel'
  ) {
    const request = value as { sessionId?: unknown; sequence?: unknown };
    return (
      hasExactKeys(value, QUERY_RESIZE_BEGIN_KEYS) &&
      isQueryLayoutSessionId(request.sessionId) &&
      isQueryLayoutSequence(request.sequence)
    );
  }
  if (record.type === 'update') {
    const request = value as { sessionId?: unknown; sequence?: unknown; deltaY?: unknown };
    return (
      hasExactKeys(value, QUERY_RESIZE_UPDATE_KEYS) &&
      isQueryLayoutSessionId(request.sessionId) &&
      isQueryLayoutSequence(request.sequence) &&
      isFiniteQueryInteger(request.deltaY) &&
      Math.abs(request.deltaY) <= 4096
    );
  }
  if (record.type === 'keyboard') {
    const request = value as {
      sessionId?: unknown;
      sequence?: unknown;
      key?: unknown;
      shiftKey?: unknown;
    };
    return (
      hasExactKeys(value, QUERY_RESIZE_KEYBOARD_KEYS) &&
      isQueryLayoutSessionId(request.sessionId) &&
      isQueryLayoutSequence(request.sequence) &&
      (request.key === 'ArrowUp' ||
        request.key === 'ArrowDown' ||
        request.key === 'Home' ||
        request.key === 'End') &&
      typeof request.shiftKey === 'boolean'
    );
  }
  return false;
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
    record.height <= 4096 &&
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
  phase: OverlayChromePhase,
): boolean {
  return (
    handoffMode === 'preparing-open' ||
    handoffMode === 'opening' ||
    handoffMode === 'closing' ||
    phase === 'FOX_IDLE'
  );
}

export function isQueryContentLayoutPhase(
  phase: OverlayChromePhase,
): phase is 'RESULTS' | 'EMPTY' | 'ERROR' {
  return phase === 'RESULTS' || phase === 'EMPTY' || phase === 'ERROR';
}

export function acceptQueryLayoutAck(input: {
  ack: QueryLayoutAck | null | undefined;
  requestSessionId?: number;
  requestSequence?: number;
  minSequence: number;
  activeSessionId: number;
  currentPhase: OverlayChromePhase;
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
  const maxHeight = Math.max(1, Math.min(QUERY_LAYOUT_MAX_HEIGHT, Math.floor(availableHeight)));
  const minHeight = Math.min(QUERY_LAYOUT_MIN_HEIGHT, maxHeight);
  if (!Number.isFinite(desiredHeight)) {
    return minHeight;
  }
  return Math.round(Math.min(maxHeight, Math.max(minHeight, desiredHeight)));
}

export function fallbackQuerySizeForPhase(
  phase: OverlayChromePhase,
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
  phase: OverlayChromePhase;
  resultCount?: ResultCount;
  workArea?: Pick<Rect, 'height'>;
  measuredHeight?: number | null;
  manualHeight?: number | null;
}): Size {
  if (input.phase === 'FOX_IDLE') {
    return preferredQuerySizeForPhase(input.phase);
  }
  if (input.phase === 'SEARCH_INPUT') {
    return preferredQuerySizeForPhase(input.phase);
  }
  const available = input.workArea ? availableOverlayHeight(input.workArea) : QUERY_LAYOUT_MAX_HEIGHT;
  const chosen = input.manualHeight ?? input.measuredHeight;
  if (typeof chosen === 'number' && Number.isFinite(chosen)) {
    return {
      width: QUERY_WIDTH,
      height: clampQueryDesiredHeight(chosen, available),
    };
  }
  return fallbackQuerySizeForPhase(input.phase, input.resultCount ?? 0, input.workArea);
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
      width: QUERY_WIDTH,
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
    width: QUERY_WIDTH,
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
  return key === 'ArrowDown' ? step : -step;
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

export function rejectedQueryLayoutAck(
  sessionId: number,
  sequence: number,
  height = QUERY_INPUT_HEIGHT,
  resizeEdge: QueryResizeEdge = 'bottom',
  phase: ReportablePhase = 'SEARCH_INPUT',
  resultCount: ResultCount = 0,
): QueryLayoutAck {
  return {
    ok: false,
    sessionId,
    sequence,
    phase,
    resultCount,
    height,
    resizeEdge,
  };
}
