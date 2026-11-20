import { describe, expect, it } from 'vitest';
import {
  SOP_MAX_HEIGHT,
  SOP_MIN_HEIGHT,
  SOP_OFFSET_X,
  SOP_OFFSET_Y,
  SOP_OPEN_HEIGHT,
  SOP_WIDTH,
  clampSopHeight,
  applySopHeight,
  placeSopBesideWindows,
  placeSopBookmark,
  placeSopLeftCenter,
  placeSopNearQuery,
  sopLayoutNeedsProjection,
  sopWorkAreaForQuery,
} from '../../src/shared/sop-geometry';
import { resizeRectFromEdge } from '../../src/shared/window-resize-geometry';

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

  it('centers the first SOP on a negative-coordinate display and keeps two bookmarks disjoint', () => {
    const display = { x: -1440, y: 40, width: 1400, height: 840 };
    expect(placeSopLeftCenter(display)).toEqual({ x: -1424, y: 340, width: 600, height: 240 });
    const first = placeSopBookmark(display, []);
    if (!first) throw new Error('Expected the first bookmark');
    const second = placeSopBookmark(display, [first]);
    if (!second) throw new Error('Expected another bookmark slot');
    expect([first.x, second.x]).toEqual([display.x, display.x]);
    expect(Math.abs(first.y - second.y)).toBeGreaterThanOrEqual(first.height);
    expect(placeSopBookmark({ ...display, height: 12 }, [{ ...display, height: 12 }])).toBeNull();
  });

  it('keeps the Query capsule available when it occupies the first SOP position', () => {
    const display = { x: 0, y: 0, width: 900, height: 700 };
    const capsule = { x: 16, y: 230, width: 600, height: 88 };
    const placed = placeSopBesideWindows(placeSopLeftCenter(display), [], capsule, display);
    expect(placed).toEqual({ x: 16, y: 330, width: 600, height: 240 });
  });

  it('resizes two axes from a corner and clamps at the fixed opposite edges', () => {
    const baseline = { x: 120, y: 160, width: 600, height: 300 };
    const limits = { minSize: { width: 360, height: 240 }, maxSize: workArea };
    expect(resizeRectFromEdge({
      baseline, bounds: workArea, direction: 'top-left', deltaX: -160, deltaY: 100, ...limits,
    })).toEqual({ x: 0, y: 220, width: 720, height: 240 });
    const horizontal = resizeRectFromEdge({
      baseline, bounds: workArea, direction: 'right', deltaX: -90, deltaY: 100, ...limits,
    });
    expect(horizontal).toEqual({ x: 120, y: 160, width: 510, height: 300 });
    expect(applySopHeight(horizontal, 380, workArea)).toEqual({ ...horizontal, height: 380 });
  });
});
