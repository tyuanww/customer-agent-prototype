import { describe, expect, it } from 'vitest';
import {
  SOP_MAX_HEIGHT,
  SOP_MIN_HEIGHT,
  SOP_OFFSET_X,
  SOP_OFFSET_Y,
  SOP_OPEN_HEIGHT,
  SOP_WIDTH,
  clampSopHeight,
  placeSopNearQuery,
  sopLayoutNeedsProjection,
  sopWorkAreaForQuery,
} from '../../src/shared/sop-geometry';

const workArea = { x: 0, y: 25, width: 1440, height: 875 };
const query = { x: 80, y: 120, width: 600, height: 340 };

describe('SOP geometry cascade', () => {
  it('keeps the opening shell at 600x240 and clamps hug height', () => {
    expect(SOP_WIDTH).toBe(600);
    expect(SOP_OPEN_HEIGHT).toBe(240);
    expect(clampSopHeight(180, 800)).toBe(SOP_MIN_HEIGHT);
    expect(clampSopHeight(900, 800)).toBe(SOP_MAX_HEIGHT);
  });

  it('places the SOP to the right of Query when there is room', () => {
    const placed = placeSopNearQuery(query, workArea);
    expect(placed.x).toBe(query.x + query.width + SOP_OFFSET_X);
    expect(placed.y).toBe(query.y);
    expect(placed.x === query.x && placed.y === query.y).toBe(false);
  });

  it('falls to the left when the right side cannot fit', () => {
    const tight = { x: 820, y: 120, width: 600, height: 240 };
    const placed = placeSopNearQuery(tight, workArea);
    expect(placed.x).toBe(tight.x - SOP_WIDTH - SOP_OFFSET_X);
    expect(placed.x + placed.width).toBeLessThanOrEqual(workArea.x + workArea.width);
  });

  it('falls below Query when neither side fits', () => {
    const narrow = { x: 0, y: 25, width: 1440, height: 875 };
    const wideQuery = { x: 8, y: 40, width: 1424, height: 200 };
    const placed = placeSopNearQuery(wideQuery, narrow);
    expect(placed.y).toBeGreaterThanOrEqual(wideQuery.y + SOP_OFFSET_Y);
    expect(placed.x === wideQuery.x && placed.y === wideQuery.y).toBe(false);
  });

  it('uses the matching display work area when Query is present', () => {
    const primary = { x: 0, y: 25, width: 1440, height: 875 };
    const secondary = { x: 1440, y: 0, width: 1920, height: 1080 };
    const queryOnSecondary = { x: 1600, y: 80, width: 600, height: 340 };
    expect(sopWorkAreaForQuery(null, primary, () => secondary)).toEqual(primary);
    expect(sopWorkAreaForQuery(queryOnSecondary, primary, (rect) => {
      expect(rect).toEqual(queryOnSecondary);
      return secondary;
    })).toEqual(secondary);
  });

  it('only projects layout when the shell is not ready or the bounds change', () => {
    const current = { x: 10, y: 20, width: 600, height: 320 };
    expect(sopLayoutNeedsProjection('opening', current, current)).toBe(true);
    expect(sopLayoutNeedsProjection('ready', current, current)).toBe(false);
    expect(sopLayoutNeedsProjection('ready', current, { ...current, height: 400 })).toBe(true);
  });

  it('prefers not covering the Query capsule band', () => {
    const placed = placeSopNearQuery(query, workArea);
    const capsuleBottom = query.y + 88;
    const overlapsCapsule = placed.x < query.x + query.width
      && placed.x + placed.width > query.x
      && placed.y < capsuleBottom
      && placed.y + placed.height > query.y;
    expect(overlapsCapsule).toBe(false);
  });
});
