import type { Rect } from './overlay-geometry';

export const SOP_RESIZE_EDGES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type SopResizeEdge = typeof SOP_RESIZE_EDGES[number];
export const SOP_MIN_WIDTH = 300;
export type QuerySopView = Readonly<{ kind: 'query-home' | 'query-results' }> | Readonly<{ kind: 'sop'; taskId: string }>;
export type QuerySopPresentation = Readonly<{
  view: QuerySopView; viewEpoch: number;
  transition: Readonly<{ stage: 'preparing' | 'animating'; from: { width: number; height: number }; to: { width: number; height: number } }> | null;
}>;
export type QuerySopNavigation = { viewEpoch: number } & (
  | { type: 'home' | 'results' }
  | { type: 'restore'; taskId: string; revision: number }
  | { type: 'view-ready'; desiredHeight: number; reducedMotion: boolean }
  | { type: 'view-finished' }
);
export function isQuerySopNavigation(value: unknown): value is QuerySopNavigation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!isRecord(value)) return false;
  const v = value;
  if (typeof v.viewEpoch !== 'number' || !Number.isSafeInteger(v.viewEpoch) || v.viewEpoch <= 0) return false;
  const exact = (keys: string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
  if (v.type === 'home' || v.type === 'results' || v.type === 'view-finished') return exact(['type', 'viewEpoch']);
  if (v.type === 'restore') return exact(['type', 'viewEpoch', 'taskId', 'revision']) && typeof v.taskId === 'string'
    && v.taskId.length > 0 && v.taskId.length <= 128 && typeof v.revision === 'number' && Number.isSafeInteger(v.revision) && v.revision > 0;
  return v.type === 'view-ready' && exact(['type', 'viewEpoch', 'desiredHeight', 'reducedMotion'])
    && typeof v.reducedMotion === 'boolean' && typeof v.desiredHeight === 'number' && Number.isSafeInteger(v.desiredHeight)
    && v.desiredHeight > 0 && v.desiredHeight <= 16384;
}
export type QuerySopWindowIntent = { hostEpoch: number; taskId: string } & (
  | { [Kind in 'detach' | 'attach' | 'hide' | 'expand' | 'show-query']: { type: Kind } }['detach' | 'attach' | 'hide' | 'expand' | 'show-query']
  | { type: 'resize-start'; gesture: number; edge: SopResizeEdge }
  | { type: 'resize'; gesture: number; dx: number; dy: number }
  | { type: 'resize-end'; gesture: number } | { type: 'resize-cancel'; gesture: number }
);
export function isQuerySopWindowIntent(value: unknown): value is QuerySopWindowIntent {
  if (!isRecord(value)) return false;
  const v = value;
  if (typeof v.hostEpoch !== 'number' || !Number.isSafeInteger(v.hostEpoch) || v.hostEpoch <= 0
    || typeof v.taskId !== 'string' || !v.taskId || v.taskId.length > 128) return false;
  const exact = (keys: string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
  if (v.type === 'detach' || v.type === 'attach' || v.type === 'hide' || v.type === 'expand' || v.type === 'show-query') return exact(['hostEpoch', 'taskId', 'type']);
  if (!Number.isSafeInteger(v.gesture) || Number(v.gesture) <= 0) return false;
  if (v.type === 'resize-start') return exact(['hostEpoch', 'taskId', 'type', 'gesture', 'edge']) && SOP_RESIZE_EDGES.some(edge => edge === v.edge);
  if (v.type === 'resize-end' || v.type === 'resize-cancel') return exact(['hostEpoch', 'taskId', 'type', 'gesture']);
  return v.type === 'resize' && exact(['hostEpoch', 'taskId', 'type', 'gesture', 'dx', 'dy'])
    && [v.dx, v.dy].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 16384);
}

/** Resize from a fixed gesture baseline. The opposite edge stays fixed and the frame stays on screen. */
export function resizeSopFrame(base: Rect, edge: SopResizeEdge, dx: number, dy: number, area: Rect): Rect {
  const maxWidth = area.width;
  const minWidth = Math.min(SOP_MIN_WIDTH, maxWidth), minHeight = Math.min(320, area.height);
  const areaRight = area.x + area.width;
  const baseLeft = Math.max(area.x, Math.min(areaRight - minWidth, base.x));
  const baseWidth = Math.max(minWidth, Math.min(maxWidth, base.width));
  let left = baseLeft, right = Math.min(areaRight, baseLeft + baseWidth), top = base.y, bottom = base.y + base.height;
  if (edge.includes('w')) left = Math.max(area.x, Math.min(right - minWidth, Math.max(right - maxWidth, left + dx)));
  if (edge.includes('e')) right = Math.min(areaRight, Math.max(left + minWidth, Math.min(left + maxWidth, right + dx)));
  if (edge.includes('n')) top = Math.max(area.y, Math.min(bottom - minHeight, top + dy));
  if (edge.includes('s')) bottom = Math.min(area.y + area.height, Math.max(top + minHeight, bottom + dy));
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
