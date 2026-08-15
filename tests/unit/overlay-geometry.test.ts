import { describe, expect, it } from 'vitest';
import {
  FOX_EDGE_PEEK_TRAVEL_PX,
  FOX_EDGE_PEEK_VISIBLE_PX,
  FOX_EDGE_VISIBLE_PX,
  FOX_DRAG_SAFE_OVERFLOW_PX,
  FOX_SIZE,
  FOX_VISUAL_SIZE,
  QUERY_INPUT_HEIGHT,
  QUERY_PANEL_ONE_RESULT_HEIGHT,
  QUERY_PANEL_THREE_RESULTS_HEIGHT,
  QUERY_PANEL_TWO_RESULTS_HEIGHT,
  QUERY_WIDTH,
  clampRectToWorkArea,
  defaultFoxRect,
  dockFoxNativeRect,
  dockFoxRect,
  foxDockEdgeForRect,
  foxDragBaseRect,
  overlaySizeForPhase,
  placeQueryAnchoredToFox,
  placeQueryNearFox,
  sanitizeDragDelta,
} from '../../src/shared/overlay-geometry';

const workArea = { x: 0, y: 25, width: 1440, height: 875 };

describe('overlay geometry', () => {
  it('uses compact fox and IME capsule sizes instead of a 520×760 workstation', () => {
    expect(overlaySizeForPhase('FOX_IDLE')).toEqual({ width: FOX_SIZE, height: FOX_SIZE });
    expect(overlaySizeForPhase('SEARCH_INPUT')).toEqual({
      width: QUERY_WIDTH,
      height: QUERY_INPUT_HEIGHT,
    });
    expect(overlaySizeForPhase('RESULTS', 1)).toEqual({
      width: QUERY_WIDTH,
      height: QUERY_PANEL_ONE_RESULT_HEIGHT,
    });
    expect(overlaySizeForPhase('RESULTS', 2).height).toBe(QUERY_PANEL_TWO_RESULTS_HEIGHT);
    expect(overlaySizeForPhase('RESULTS', 3).height).toBe(QUERY_PANEL_THREE_RESULTS_HEIGHT);
    expect(overlaySizeForPhase('EMPTY')).toEqual({ width: QUERY_WIDTH, height: 240 });
    expect(overlaySizeForPhase('RESULTS')).not.toEqual({ width: 520, height: 760 });
  });

  it('clamps a right-bottom overflow back into the workArea', () => {
    const next = clampRectToWorkArea(
      { x: 1400, y: 800, width: QUERY_WIDTH, height: QUERY_PANEL_THREE_RESULTS_HEIGHT },
      workArea,
    );
    expect(next.x + next.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(next.y + next.height).toBeLessThanOrEqual(workArea.y + workArea.height);
    expect(next.x).toBeGreaterThanOrEqual(workArea.x);
    expect(next.y).toBeGreaterThanOrEqual(workArea.y);
  });

  it('keeps a growing panel near the fox anchor and on-screen', () => {
    const fox = { x: 1200, y: 780 };
    const input = placeQueryNearFox(
      fox,
      { width: QUERY_WIDTH, height: QUERY_INPUT_HEIGHT },
      workArea,
    );
    const panel = placeQueryNearFox(
      fox,
      { width: QUERY_WIDTH, height: QUERY_PANEL_THREE_RESULTS_HEIGHT },
      workArea,
    );
    expect(panel.y + panel.height).toBeLessThanOrEqual(workArea.y + workArea.height);
    expect(Math.abs(panel.x - input.x)).toBeLessThanOrEqual(8);
    expect(panel.y).toBeGreaterThanOrEqual(workArea.y);
  });

  it('places the default fox inside the workArea', () => {
    const fox = defaultFoxRect(workArea);
    expect(fox.width).toBe(FOX_SIZE);
    expect(fox.x + fox.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(fox.y + fox.height).toBeLessThanOrEqual(workArea.y + workArea.height);
  });

  it('rejects non-finite or oversized drag deltas', () => {
    expect(sanitizeDragDelta(8, -4)).toEqual({ dx: 8, dy: -4 });
    expect(sanitizeDragDelta(Number.NaN, 1)).toBeNull();
    expect(sanitizeDragDelta(9999, 0)).toBeNull();
    expect(sanitizeDragDelta('8', 1)).toBeNull();
  });

  it('tucks a visually centered fox symmetrically with exactly half its head exposed', () => {
    const left = { x: 0, y: 240, width: FOX_SIZE, height: FOX_SIZE };
    const right = {
      x: workArea.x + workArea.width - FOX_SIZE,
      y: 240,
      width: FOX_SIZE,
      height: FOX_SIZE,
    };
    expect(foxDockEdgeForRect(left, workArea)).toBe('left');
    expect(foxDockEdgeForRect(right, workArea)).toBe('right');
    const dockedLeft = dockFoxRect(left, workArea, 'left');
    const dockedRight = dockFoxRect(right, workArea, 'right');
    expect(dockedLeft.x + dockedLeft.width - workArea.x).toBe(FOX_EDGE_VISIBLE_PX);
    expect(workArea.x + workArea.width - dockedRight.x).toBe(FOX_EDGE_VISIBLE_PX);

    const visualStart = (FOX_SIZE - FOX_VISUAL_SIZE) / 2;
    const visualEnd = visualStart + FOX_VISUAL_SIZE;
    const leftVisibleVisual = Math.max(
      0,
      Math.min(visualEnd, FOX_SIZE) - Math.max(visualStart, FOX_SIZE - FOX_EDGE_VISIBLE_PX),
    );
    const rightVisibleVisual = Math.max(
      0,
      Math.min(visualEnd, FOX_EDGE_VISIBLE_PX) - Math.max(visualStart, 0),
    );
    expect(leftVisibleVisual).toBe(FOX_VISUAL_SIZE / 2);
    expect(rightVisibleVisual).toBe(FOX_VISUAL_SIZE / 2);

    const peekedLeft = dockFoxRect(left, workArea, 'left', FOX_EDGE_PEEK_VISIBLE_PX);
    const peekedRight = dockFoxRect(right, workArea, 'right', FOX_EDGE_PEEK_VISIBLE_PX);
    expect(peekedLeft.x + peekedLeft.width - workArea.x).toBe(FOX_EDGE_PEEK_VISIBLE_PX);
    expect(workArea.x + workArea.width - peekedRight.x).toBe(FOX_EDGE_PEEK_VISIBLE_PX);
    expect(FOX_EDGE_VISIBLE_PX).toBe(44);
    expect(FOX_EDGE_PEEK_VISIBLE_PX).toBe(80);
    expect(FOX_EDGE_PEEK_TRAVEL_PX).toBe(36);
  });

  it('clamps any requested edge visibility to the fox window width', () => {
    const fox = { x: 0, y: 240, width: FOX_SIZE, height: FOX_SIZE };
    expect(dockFoxRect(fox, workArea, 'left', -20).x).toBe(workArea.x - FOX_SIZE);
    expect(dockFoxRect(fox, workArea, 'right', FOX_SIZE + 100).x).toBe(
      workArea.x + workArea.width - FOX_SIZE,
    );
  });

  it('keeps the native fox window fully on-screen while the renderer owns the crop', () => {
    const fox = { x: 0, y: 240, width: FOX_SIZE, height: FOX_SIZE };
    expect(dockFoxNativeRect(fox, workArea, 'left')).toEqual(fox);
    expect(dockFoxNativeRect(fox, workArea, 'right')).toEqual({
      ...fox,
      x: workArea.x + workArea.width - FOX_SIZE,
    });
  });

  it('starts a docked drag from the fully visible peek geometry without a margin snap', () => {
    const left = foxDragBaseRect(
      { x: workArea.x, y: 240, width: FOX_SIZE, height: FOX_SIZE },
      workArea,
      'left',
    );
    const right = foxDragBaseRect(
      {
        x: workArea.x + workArea.width - FOX_SIZE,
        y: 240,
        width: FOX_SIZE,
        height: FOX_SIZE,
      },
      workArea,
      'right',
    );
    expect(FOX_DRAG_SAFE_OVERFLOW_PX).toBe(8);
    expect(left.x).toBe(workArea.x - FOX_DRAG_SAFE_OVERFLOW_PX);
    expect(right.x + right.width).toBe(
      workArea.x + workArea.width + FOX_DRAG_SAFE_OVERFLOW_PX,
    );
    expect(
      clampRectToWorkArea(
        { ...left, x: left.x + 1 },
        workArea,
        -FOX_DRAG_SAFE_OVERFLOW_PX,
      ).x,
    ).toBe(left.x + 1);
  });

  it('anchors the query to the fox side instead of visually teleporting the fox', () => {
    const leftFox = { x: 12, y: 120, width: FOX_SIZE, height: FOX_SIZE };
    const rightFox = {
      x: workArea.x + workArea.width - FOX_SIZE - 12,
      y: 120,
      width: FOX_SIZE,
      height: FOX_SIZE,
    };
    const size = { width: QUERY_WIDTH, height: QUERY_INPUT_HEIGHT };
    const leftQuery = placeQueryAnchoredToFox(leftFox, size, workArea);
    const rightQuery = placeQueryAnchoredToFox(rightFox, size, workArea);
    expect(Math.abs(leftQuery.x - leftFox.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(rightQuery.x + rightQuery.width - (rightFox.x + rightFox.width))).toBeLessThanOrEqual(8);

    const dockedLeft = placeQueryAnchoredToFox(leftFox, size, workArea, 'left');
    const dockedRight = placeQueryAnchoredToFox(rightFox, size, workArea, 'right');
    expect(dockedLeft.x).toBe(workArea.x);
    expect(dockedRight.x + dockedRight.width).toBe(workArea.x + workArea.width);
  });
});
