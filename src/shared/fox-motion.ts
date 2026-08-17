export const FOX_IDLE_DURATION_MS = 3000;
export const FOX_IDLE_FLOAT_PX = 4;
export const FOX_IDLE_SWING_DEG = 2;
export const FOX_IDLE_MAX_SCALE = 1.04;
export const FOX_DOCK_READY_TRAVEL_PX = 3;
export const FOX_DOCK_READY_RISE_PX = 2;
export const FOX_DOCK_READY_TILT_DEG = 5;
export const FOX_DOCK_READY_MAX_SCALE = 1.035;
export const FOX_HALO_DURATION_MS = 3200;
export const FOX_HALO_SIZE_MIN_PX = 76;
export const FOX_HALO_SIZE_MAX_PX = 84;
export const FOX_HALO_OPACITY_MIN = 0.56;
export const FOX_HALO_OPACITY_MAX = 0.94;
export const FOX_HALO_REDUCED_MOTION_OPACITY = 0.72;
export const FOX_SNAP_DURATION_MS = 480;
export const FOX_SNAP_DURATION_MIN_MS = 420;
export const FOX_SNAP_DURATION_MAX_MS = 560;
export const FOX_PEEK_DURATION_MS = 420;
export const FOX_RETRACT_DURATION_MS = 300;
export const QUERY_OPEN_DURATION_MS = 260;
export const QUERY_CLOSE_DURATION_MS = 200;
export const QUERY_CONTENT_EXIT_DURATION_MS = 110;
export const QUERY_HANDOFF_SIZE_PX = 64;
export const QUERY_FOX_CENTER_OFFSET_PX = 44;

export type QueryHandoffGeometry = {
  scaleX: number;
  scaleY: number;
  originX: number;
  originY: number;
  clipTop: number;
  clipRight: number;
  clipBottom: number;
  clipLeft: number;
};

export function queryHandoffGeometry(
  width: number,
  height: number,
  anchor: 'left' | 'right',
  dockEdge: FoxDockEdge = 'none',
  explicitCenter?: { x: number; y: number },
): QueryHandoffGeometry {
  const safeWidth = Math.max(QUERY_HANDOFF_SIZE_PX + 1, width);
  const safeHeight = Math.max(QUERY_HANDOFF_SIZE_PX + 1, height);
  const scaleX = QUERY_HANDOFF_SIZE_PX / safeWidth;
  const scaleY = QUERY_HANDOFF_SIZE_PX / safeHeight;
  const targetCenterX = explicitCenter?.x ?? (dockEdge === 'left'
    ? 0
    : dockEdge === 'right'
      ? safeWidth
      : anchor === 'left'
        ? QUERY_FOX_CENTER_OFFSET_PX
        : safeWidth - QUERY_FOX_CENTER_OFFSET_PX);
  const targetCenterY = explicitCenter?.y ?? QUERY_FOX_CENTER_OFFSET_PX;
  const halfHandoff = QUERY_HANDOFF_SIZE_PX / 2;

  return {
    scaleX,
    scaleY,
    originX: (targetCenterX - halfHandoff) / (1 - scaleX),
    originY: (targetCenterY - halfHandoff) / (1 - scaleY),
    clipTop: targetCenterY - halfHandoff,
    clipRight: safeWidth - targetCenterX - halfHandoff,
    clipBottom: safeHeight - targetCenterY - halfHandoff,
    clipLeft: targetCenterX - halfHandoff,
  };
}

export function isVisibleIdleDuration(ms: number): boolean {
  return ms >= 2800 && ms <= 3200;
}

export function isVisibleIdleFloat(px: number): boolean {
  return px >= 3 && px <= 4;
}

export function isVisibleIdleSwing(deg: number): boolean {
  return deg >= 1.8 && deg <= 2.2;
}

export function isAllowedIdleScale(scale: number): boolean {
  return scale > 1.025 && scale <= FOX_IDLE_MAX_SCALE;
}

export function isAllowedSnapDuration(ms: number): boolean {
  return ms >= FOX_SNAP_DURATION_MIN_MS && ms <= FOX_SNAP_DURATION_MAX_MS;
}
import type { FoxDockEdge } from './overlay-events';
