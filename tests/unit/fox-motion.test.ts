import { describe, expect, it } from 'vitest';
import {
  FOX_IDLE_DURATION_MS,
  FOX_IDLE_FLOAT_PX,
  FOX_IDLE_MAX_SCALE,
  FOX_IDLE_SWING_DEG,
  FOX_PEEK_DURATION_MS,
  FOX_RETRACT_DURATION_MS,
  FOX_SNAP_DURATION_MS,
  QUERY_CLOSE_DURATION_MS,
  QUERY_OPEN_DURATION_MS,
  queryHandoffGeometry,
  isAllowedIdleScale,
  isAllowedSnapDuration,
  isVisibleIdleDuration,
  isVisibleIdleFloat,
  isVisibleIdleSwing,
} from '../../src/shared/fox-motion';

describe('fox motion parameters', () => {
  it('keeps idle motion visibly stronger than the old 2px / 0.8deg cycle', () => {
    expect(isVisibleIdleDuration(FOX_IDLE_DURATION_MS)).toBe(true);
    expect(isVisibleIdleFloat(FOX_IDLE_FLOAT_PX)).toBe(true);
    expect(isVisibleIdleSwing(FOX_IDLE_SWING_DEG)).toBe(true);
    expect(isAllowedIdleScale(FOX_IDLE_MAX_SCALE)).toBe(true);
    expect(FOX_IDLE_FLOAT_PX).toBeGreaterThanOrEqual(3);
    expect(FOX_IDLE_SWING_DEG).toBeGreaterThan(0.8);
    expect(FOX_IDLE_MAX_SCALE).toBeLessThanOrEqual(1.04);
  });

  it('keeps the edge snap inside the 420-560ms directional window', () => {
    expect(isAllowedSnapDuration(FOX_SNAP_DURATION_MS)).toBe(true);
    expect(isAllowedSnapDuration(419)).toBe(false);
    expect(isAllowedSnapDuration(561)).toBe(false);
  });

  it('keeps the hover peek noticeable without becoming a blocking loop', () => {
    expect(FOX_PEEK_DURATION_MS).toBeGreaterThanOrEqual(400);
    expect(FOX_PEEK_DURATION_MS).toBeLessThanOrEqual(500);
    expect(FOX_RETRACT_DURATION_MS).toBeGreaterThanOrEqual(240);
    expect(FOX_RETRACT_DURATION_MS).toBeLessThan(FOX_PEEK_DURATION_MS);
  });

  it('keeps the frequent query handoff brief and closes faster than it opens', () => {
    expect(QUERY_OPEN_DURATION_MS).toBeGreaterThanOrEqual(220);
    expect(QUERY_OPEN_DURATION_MS).toBeLessThanOrEqual(300);
    expect(QUERY_CLOSE_DURATION_MS).toBeGreaterThanOrEqual(160);
    expect(QUERY_CLOSE_DURATION_MS).toBeLessThan(QUERY_OPEN_DURATION_MS);
  });

  it('collapses every query height onto the same left or right fox center', () => {
    for (const height of [88, 240, 340, 430, 620]) {
      for (const anchor of ['left', 'right'] as const) {
        const geometry = queryHandoffGeometry(600, height, anchor);
        const transformedLeft = geometry.originX * (1 - geometry.scaleX);
        const transformedTop = geometry.originY * (1 - geometry.scaleY);
        const centerX = transformedLeft + (600 * geometry.scaleX) / 2;
        const centerY = transformedTop + (height * geometry.scaleY) / 2;
        const clipWidth = 600 - geometry.clipLeft - geometry.clipRight;
        const clipHeight = height - geometry.clipTop - geometry.clipBottom;
        const clipCenterX = geometry.clipLeft + clipWidth / 2;
        const clipCenterY = geometry.clipTop + clipHeight / 2;
        expect(centerX).toBeCloseTo(anchor === 'left' ? 44 : 556, 5);
        expect(centerY).toBeCloseTo(44, 5);
        expect(clipWidth).toBe(64);
        expect(clipHeight).toBe(64);
        expect(clipCenterX).toBeCloseTo(centerX, 5);
        expect(clipCenterY).toBeCloseTo(centerY, 5);
      }
    }
  });

  it('moves the collapse target to the half-hidden fox center when docked', () => {
    for (const [anchor, edge, expectedCenter] of [
      ['left', 'left', 0],
      ['right', 'right', 600],
    ] as const) {
      const geometry = queryHandoffGeometry(600, 620, anchor, edge);
      const transformedLeft = geometry.originX * (1 - geometry.scaleX);
      const centerX = transformedLeft + (600 * geometry.scaleX) / 2;
      const clipWidth = 600 - geometry.clipLeft - geometry.clipRight;
      const clipCenterX = geometry.clipLeft + clipWidth / 2;
      expect(centerX).toBeCloseTo(expectedCenter, 5);
      expect(clipWidth).toBe(64);
      expect(clipCenterX).toBeCloseTo(expectedCenter, 5);
    }
  });
});
