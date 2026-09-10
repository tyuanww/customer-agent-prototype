import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FOX_EDGE_PEEK_TRAVEL_PX,
  FOX_EDGE_PEEK_VISIBLE_PX,
  FOX_EDGE_VISIBLE_PX,
  FOX_DRAG_SAFE_OVERFLOW_PX,
  FOX_PEEK_CROP_OFFSET_PX,
  FOX_REST_CROP_OFFSET_PX,
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
  foxDockCropOffsetPx,
  foxDockEdgeForRect,
  foxDragBaseRect,
  foxDragInwardPx,
  foxDragSessionHeadOffset,
  advanceFoxDockDragSession,
  createFoxDockDragSession,
  finishFoxDockDragSession,
  foxVisualCenterForNativeRect,
  foxDockDragSessionNativeRect,
  foxDockDragSessionVisuallyUndocked,
  isInwardFoxDrag,
  isRectFullyOnWorkArea,
  inferFoxRectFromQuery,
  resolveFoxDockAfterDrag,
  applyQueryDragIncrements,
  settleQueryDragGesture,
  queryAnchorForFox,
  resolveSessionQueryAnchor,
  resolveQueryAnchorAfterCloseLifecycle,
  availableOverlayHeight,
  overlaySizeForPhase,
  preferredQuerySizeForPhase,
  placeQueryAnchoredToFox,
  placeQueryNearFox,
  reconcileFoxDockEdgeForWorkArea,
  sanitizeDragDelta,
  MAX_DRAG_DELTA_PER_EVENT,
} from '../../src/shared/overlay-geometry';
import { splitDragDelta } from '../../src/renderer/lib/use-window-drag';

const workArea = { x: 0, y: 25, width: 1440, height: 875 };

describe('overlay geometry', () => {
  it('uses compact fox and IME capsule sizes instead of a 520×760 workstation', () => {
    expect(preferredQuerySizeForPhase('FOX_IDLE')).toEqual({ width: FOX_SIZE, height: FOX_SIZE });
    expect(preferredQuerySizeForPhase('SEARCH_INPUT')).toEqual({
      width: QUERY_WIDTH,
      height: QUERY_INPUT_HEIGHT,
    });
    expect(preferredQuerySizeForPhase('EMPTY')).toEqual({ width: QUERY_WIDTH, height: 240 });
    expect(preferredQuerySizeForPhase('ERROR', 0)).toEqual({ width: QUERY_WIDTH, height: 240 });
    expect(preferredQuerySizeForPhase('RESULTS', 1)).toEqual({ width: QUERY_WIDTH, height: 340 });
    expect(preferredQuerySizeForPhase('RESULTS', 2)).toEqual({ width: QUERY_WIDTH, height: 430 });
    expect(preferredQuerySizeForPhase('RESULTS', 3)).toEqual({ width: QUERY_WIDTH, height: 620 });
    expect(preferredQuerySizeForPhase('COPIED', 1)).toEqual({ width: QUERY_WIDTH, height: 340 });
    expect(preferredQuerySizeForPhase('COPIED', 2)).toEqual({ width: QUERY_WIDTH, height: 430 });
    expect(preferredQuerySizeForPhase('COPIED', 3)).toEqual({ width: QUERY_WIDTH, height: 620 });
    expect(preferredQuerySizeForPhase('ERROR', 1)).toEqual({ width: QUERY_WIDTH, height: 340 });
    expect(preferredQuerySizeForPhase('ERROR', 2)).toEqual({ width: QUERY_WIDTH, height: 430 });
    expect(preferredQuerySizeForPhase('ERROR', 3)).toEqual({ width: QUERY_WIDTH, height: 620 });
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

  it('clamps result-panel height to workArea minus two screen margins', () => {
    const shortWorkArea = { height: 480 };
    expect(availableOverlayHeight(shortWorkArea)).toBe(464);
    expect(overlaySizeForPhase('RESULTS', 3, shortWorkArea)).toEqual({
      width: QUERY_WIDTH,
      height: 464,
    });
    expect(overlaySizeForPhase('COPIED', 3, shortWorkArea).height).toBe(464);
    expect(overlaySizeForPhase('ERROR', 3, shortWorkArea).height).toBe(464);
    expect(overlaySizeForPhase('SEARCH_INPUT', 0, shortWorkArea)).toEqual({
      width: QUERY_WIDTH,
      height: QUERY_INPUT_HEIGHT,
    });
    expect(overlaySizeForPhase('RESULTS', 1, shortWorkArea).height).toBe(340);
    expect(overlaySizeForPhase('RESULTS', 2, shortWorkArea).height).toBe(430);
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

  it('derives a docked visual center from the native frame accepted by the window server', () => {
    const stageBoundaryFox = {
      x: 173,
      y: 240,
      width: FOX_SIZE,
      height: FOX_SIZE,
    };
    expect(foxVisualCenterForNativeRect(stageBoundaryFox, 'left')).toEqual({
      x: 173,
      y: 240 + FOX_SIZE / 2,
    });
    expect(
      foxVisualCenterForNativeRect(
        stageBoundaryFox,
        'left',
        FOX_EDGE_PEEK_TRAVEL_PX,
      ),
    ).toEqual({
      x: 173 + FOX_EDGE_PEEK_TRAVEL_PX,
      y: 240 + FOX_SIZE / 2,
    });
    expect(foxVisualCenterForNativeRect(stageBoundaryFox, 'right')).toEqual({
      x: 173 + FOX_SIZE,
      y: 240 + FOX_SIZE / 2,
    });
  });

  it('starts a docked drag from the on-screen native frame with no overflow', () => {
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
    expect(FOX_REST_CROP_OFFSET_PX).toBe(44);
    expect(FOX_PEEK_CROP_OFFSET_PX).toBe(8);
    expect(left.x).toBe(workArea.x);
    expect(right.x + right.width).toBe(workArea.x + workArea.width);
    expect(isRectFullyOnWorkArea(left, workArea, 0)).toBe(true);
    expect(isRectFullyOnWorkArea(right, workArea, 0)).toBe(true);
    expect(clampRectToWorkArea({ ...left, x: left.x - 12 }, workArea, 0).x).toBe(workArea.x);
  });

  it('keeps outward and vertical docked drags docked while only net inward works the session', () => {
    const leftNative = { x: workArea.x, y: 240, width: FOX_SIZE, height: FOX_SIZE };
    const rightNative = {
      x: workArea.x + workArea.width - FOX_SIZE,
      y: 240,
      width: FOX_SIZE,
      height: FOX_SIZE,
    };
    const zeroWorkArea = { x: 0, y: 25, width: 1440, height: 875 };
    const leftAtZero = { ...leftNative, x: 0 };

    expect(isInwardFoxDrag('left', -12)).toBe(false);
    expect(isInwardFoxDrag('right', 12)).toBe(false);
    expect(isInwardFoxDrag('left', 8)).toBe(true);
    expect(isInwardFoxDrag('right', -8)).toBe(true);

    const leftSession = createFoxDockDragSession('left', false, leftNative);
    const leftOut = advanceFoxDockDragSession(leftSession, -20, 12, workArea);
    expect(foxDockDragSessionVisuallyUndocked(leftOut.session)).toBe(false);
    expect(leftOut.nativeRect.x).toBe(workArea.x);
    expect(leftOut.nativeRect.y).toBe(252);
    expect(isRectFullyOnWorkArea(leftOut.nativeRect, workArea, 0)).toBe(true);

    const rightSession = createFoxDockDragSession('right', false, rightNative);
    const rightOut = advanceFoxDockDragSession(rightSession, 20, -8, workArea);
    expect(foxDockDragSessionVisuallyUndocked(rightOut.session)).toBe(false);
    expect(rightOut.nativeRect.x).toBe(rightNative.x);
    expect(rightOut.nativeRect.y).toBe(232);

    const leftVertical = advanceFoxDockDragSession(leftSession, 0, 30, workArea);
    expect(foxDockDragSessionVisuallyUndocked(leftVertical.session)).toBe(false);
    expect(leftVertical.nativeRect.x).toBe(workArea.x);

    const leftIn = advanceFoxDockDragSession(leftSession, 16, 4, workArea);
    expect(foxDockDragSessionVisuallyUndocked(leftIn.session)).toBe(true);
    expect(leftIn.nativeRect.x).toBe(workArea.x);
    expect(foxDragSessionHeadOffset('left', leftSession.cropPx, 16)).toBe(-28);
    expect(isRectFullyOnWorkArea(leftIn.nativeRect, workArea, 0)).toBe(true);

    const rightIn = advanceFoxDockDragSession(rightSession, -16, 0, workArea);
    expect(foxDockDragSessionVisuallyUndocked(rightIn.session)).toBe(true);
    expect(rightIn.nativeRect.x).toBe(rightNative.x);
    expect(isRectFullyOnWorkArea(rightIn.nativeRect, workArea, 0)).toBe(true);

    expect(isRectFullyOnWorkArea(leftAtZero, zeroWorkArea, 0)).toBe(true);
    expect(foxDragInwardPx('left', 12)).toBe(12);
    expect(foxDragInwardPx('right', -12)).toBe(12);
  });

  it('keeps the first inward drag continuous with session head compensation', () => {
    const origin = { x: workArea.x, y: 240 };
    const rest = createFoxDockDragSession('left', false, origin);
    expect(rest.cropPx).toBe(FOX_REST_CROP_OFFSET_PX);
    const first = advanceFoxDockDragSession(rest, 10, 0, workArea);
    expect(first.nativeRect.x).toBe(workArea.x);
    expect(foxDragSessionHeadOffset('left', rest.cropPx, 10)).toBe(-34);
    expect(isRectFullyOnWorkArea(first.nativeRect, workArea, 0)).toBe(true);

    const pastCrop = advanceFoxDockDragSession(first.session, 50, 6, workArea);
    expect(pastCrop.nativeRect.x).toBe(workArea.x + 16);
    expect(foxDragSessionHeadOffset('left', rest.cropPx, pastCrop.session.logicalInward)).toBe(0);
    expect(isRectFullyOnWorkArea(pastCrop.nativeRect, workArea, 0)).toBe(true);

    const peek = createFoxDockDragSession('right', true, {
      x: workArea.x + workArea.width - FOX_SIZE,
      y: 240,
    });
    expect(foxDockCropOffsetPx(true)).toBe(FOX_PEEK_CROP_OFFSET_PX);
    const peekStep = advanceFoxDockDragSession(peek, -4, 0, workArea);
    expect(peekStep.nativeRect.x).toBe(workArea.x + workArea.width - FOX_SIZE);
    expect(foxDragSessionHeadOffset('right', peek.cropPx, peekStep.session.logicalInward)).toBe(4);
    expect(isRectFullyOnWorkArea(peekStep.nativeRect, workArea, 0)).toBe(true);

    const seated = finishFoxDockDragSession(first.session, workArea);
    expect(seated.edge).toBe('left');
    expect(seated.rect.x).toBe(workArea.x);

    const stageSeated = createFoxDockDragSession('left', false, {
      x: workArea.x + 173,
      y: 240,
    });
    const stageVertical = advanceFoxDockDragSession(stageSeated, 0, 18, workArea);
    const stageFinished = finishFoxDockDragSession(stageVertical.session, workArea);
    expect(stageFinished).toEqual({
      edge: 'left',
      rect: { x: workArea.x + 173, y: 258, width: FOX_SIZE, height: FOX_SIZE },
    });

    let cross = createFoxDockDragSession('left', false, origin);
    const span = workArea.width - FOX_SIZE;
    let remaining = span;
    let lastNative = { x: origin.x, y: origin.y, width: FOX_SIZE, height: FOX_SIZE };
    while (remaining !== 0) {
      const step = Math.sign(remaining) * Math.min(240, Math.abs(remaining));
      const advanced = advanceFoxDockDragSession(cross, step, 0, workArea);
      cross = advanced.session;
      lastNative = advanced.nativeRect;
      remaining -= step;
    }
    expect(lastNative.x).toBe(origin.x + span - FOX_REST_CROP_OFFSET_PX);
    const finishedCross = finishFoxDockDragSession(cross, workArea);
    expect(finishedCross.rect.x).toBe(lastNative.x);
    expect(finishedCross.rect.x).not.toBe(workArea.x + workArea.width - FOX_SIZE);
    expect(isRectFullyOnWorkArea(finishedCross.rect, workArea, 0)).toBe(true);
  });

  it('keeps >crop release continuous with the last advance frame on both edges', () => {
    const leftOrigin = { x: workArea.x, y: 240 };
    let left = createFoxDockDragSession('left', false, leftOrigin);
    const leftPast = advanceFoxDockDragSession(left, FOX_REST_CROP_OFFSET_PX + 24, 0, workArea);
    left = leftPast.session;
    expect(leftPast.nativeRect.x).toBe(workArea.x + 24);
    const leftFinish = finishFoxDockDragSession(left, workArea);
    expect(leftFinish.rect).toEqual(leftPast.nativeRect);
    expect(leftFinish.rect.x).toBe(foxDockDragSessionNativeRect(left, workArea).x);
    expect(leftFinish.rect.x).not.toBe(workArea.x + FOX_REST_CROP_OFFSET_PX + 24);

    const rightOrigin = {
      x: workArea.x + workArea.width - FOX_SIZE,
      y: 240,
    };
    let right = createFoxDockDragSession('right', false, rightOrigin);
    const rightPast = advanceFoxDockDragSession(right, -(FOX_REST_CROP_OFFSET_PX + 24), 0, workArea);
    right = rightPast.session;
    expect(rightPast.nativeRect.x).toBe(rightOrigin.x - 24);
    const rightFinish = finishFoxDockDragSession(right, workArea);
    expect(rightFinish.rect).toEqual(rightPast.nativeRect);
    expect(rightFinish.rect.x).not.toBe(rightOrigin.x - FOX_REST_CROP_OFFSET_PX - 24);
  });

  it('accumulates a docked gesture from pointerdown so outward then inward uses net displacement', () => {
    const origin = { x: workArea.x, y: 240 };
    let session = createFoxDockDragSession('left', false, origin);
    const out = advanceFoxDockDragSession(session, -20, 0, workArea);
    session = out.session;
    expect(foxDockDragSessionVisuallyUndocked(session)).toBe(false);
    expect(out.nativeRect.x).toBe(workArea.x);

    const stillOut = advanceFoxDockDragSession(session, 10, 0, workArea);
    session = stillOut.session;
    expect(session.logicalInward).toBe(-10);
    expect(foxDockDragSessionVisuallyUndocked(session)).toBe(false);
    expect(stillOut.nativeRect.x).toBe(workArea.x);
    expect(foxDragSessionHeadOffset('left', session.cropPx, session.logicalInward)).toBe(-44);

    const netIn = advanceFoxDockDragSession(session, 20, 0, workArea);
    expect(netIn.session.logicalInward).toBe(10);
    expect(foxDockDragSessionVisuallyUndocked(netIn.session)).toBe(true);
    expect(netIn.nativeRect.x).toBe(workArea.x);
    expect(foxDragSessionHeadOffset('left', session.cropPx, netIn.session.logicalInward)).toBe(-34);
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
    expect(dockedLeft.x).toBe(leftFox.x);
    expect(dockedRight.x + dockedRight.width).toBe(rightFox.x + rightFox.width);

    const stageBoundaryFox = { ...leftFox, x: workArea.x + 173 };
    const stageBoundaryQuery = placeQueryAnchoredToFox(
      stageBoundaryFox,
      size,
      workArea,
      'left',
    );
    expect(stageBoundaryQuery.x).toBe(stageBoundaryFox.x);

    const crossedFox = {
      x: workArea.x + workArea.width / 2 + 40,
      y: 120,
      width: FOX_SIZE,
      height: FOX_SIZE,
    };
    expect(queryAnchorForFox(crossedFox, workArea)).toBe('right');
    const pinnedSessionQuery = placeQueryAnchoredToFox(
      crossedFox,
      size,
      workArea,
      'none',
      'left',
    );
    expect(pinnedSessionQuery.x).toBe(crossedFox.x);
  });

  it('recomputes left, right, and undocked edges from the inferred fox after a query drag', () => {
    const leftQuery = { x: workArea.x, y: 120, width: QUERY_WIDTH, height: QUERY_INPUT_HEIGHT };
    const leftFox = inferFoxRectFromQuery(leftQuery, workArea, 'left');
    expect(resolveFoxDockAfterDrag(leftFox, workArea)).toBe('left');
    expect(foxDockEdgeForRect(leftFox, workArea)).toBe('left');

    const rightQuery = {
      x: workArea.x + workArea.width - QUERY_WIDTH,
      y: 120,
      width: QUERY_WIDTH,
      height: QUERY_INPUT_HEIGHT,
    };
    const rightFox = inferFoxRectFromQuery(rightQuery, workArea, 'right');
    expect(resolveFoxDockAfterDrag(rightFox, workArea)).toBe('right');
    expect(foxDockEdgeForRect(rightFox, workArea)).toBe('right');

    const midQuery = { x: 420, y: 120, width: QUERY_WIDTH, height: QUERY_INPUT_HEIGHT };
    const midFox = inferFoxRectFromQuery(midQuery, workArea, 'left');
    expect(resolveFoxDockAfterDrag(midFox, workArea)).toBe('none');
    expect(foxDockEdgeForRect(midFox, workArea)).toBe('none');
  });

  it('applies the inferred-fox dock resolution when a Query drag finishes', () => {
    const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');
    const controller = readFileSync(path.join(srcRoot, 'main/overlay-controller.ts'), 'utf8');
    const geometry = readFileSync(path.join(srcRoot, 'shared/overlay-geometry.ts'), 'utf8');
    expect(controller).toContain('this.queryDragAnchor = this.currentQueryAnchor()');
    expect(controller).toContain('inferFoxRectFromQuery(next, workArea, this.queryDragAnchor)');
    expect(controller).toContain('this.settlePinnedQueryDrag(next, workArea)');
    expect(controller).toContain('settleQueryDragGesture(queryRect, workArea, this.queryDragAnchor)');
    expect(controller).toContain('this.sessionQueryAnchor()');
    expect(controller).toContain('this.sessionQueryAnchor(queryAnchorForFox(fullFoxRect, workArea))');
    expect(controller).toContain('this.sessionQueryAnchor(queryAnchorForFox(foxRect, workArea))');
    expect(controller).toContain('this.queryDragAnchor ?? undefined');
    expect(controller).toContain(
      'return resolveSessionQueryAnchor(this.queryDragAnchor, computed)',
    );
    expect(controller).not.toMatch(
      /private cancelChromeHandoff\(\): void \{[^}]*clearQueryDragGesture/,
    );
    expect(controller).toContain('finishOrClearQueryDrag');
    expect(controller).toContain('clearQueryDragGesture');
    expect(controller).toMatch(/if \(!delta\) \{\s*if \(finished\) \{\s*this\.finishOrClearQueryDrag\(\);/s);
    expect(controller).toMatch(/dismiss\(restorePreviousApp = false\): void \{\s*if \(this\.isInactive\(\)\) \{\s*return;\s*\}\s*this\.restorePreviousAppOnIdle = restorePreviousApp === true;\s*this\.finishOrClearQueryDrag\(\);/s);
    expect(controller).toMatch(/finishClosingHandoff[\s\S]*this\.clearQueryDragGesture\(\)/);
    expect(controller).toContain('foxDockDragSessionVisuallyUndocked');
    expect(controller).toContain('createFoxDockDragSession');
    expect(controller).toContain('advanceFoxDockDragSession');
    expect(controller).toContain('finishFoxDockDragSession');
    expect(controller).not.toContain('applyDockedFoxDrag');
    expect(geometry).not.toContain('export function applyDockedFoxDrag');
    expect(controller).toContain('target === this.fox ? 0 : undefined');
    expect(controller).not.toContain('-FOX_DRAG_SAFE_OVERFLOW_PX');
    expect(controller).not.toContain('settleAndClearQueryDrag');
    expect(controller).not.toContain('sendToQuery({ type: \'sync-query-anchor\', anchor: settled.anchor })');
  });

  it('keeps foxOrigin continuous across split Query-drag chunks that cross the midline', () => {
    const startQuery = {
      x: workArea.x + 40,
      y: 120,
      width: QUERY_WIDTH,
      height: QUERY_INPUT_HEIGHT,
    };
    const startFox = inferFoxRectFromQuery(startQuery, workArea, 'left');
    expect(queryAnchorForFox(startFox, workArea)).toBe('left');

    const totalDx = workArea.width / 2 + FOX_SIZE + 80;
    expect(totalDx).toBeGreaterThan(MAX_DRAG_DELTA_PER_EVENT);
    const chunks = splitDragDelta(totalDx, 0);
    expect(chunks.length).toBeGreaterThan(2);

    const pinnedSteps = applyQueryDragIncrements(startQuery, workArea, 'left', chunks);
    expect(pinnedSteps).toHaveLength(chunks.length);

    let previousQueryX = startQuery.x;
    let previousFoxX = startFox.x;
    let crossedMidline = false;
    const jumpIfAnchorFlipped = QUERY_WIDTH - FOX_SIZE;
    for (const step of pinnedSteps) {
      const queryDelta = step.query.x - previousQueryX;
      const foxDelta = step.fox.x - previousFoxX;
      expect(Math.abs(foxDelta)).toBeLessThan(jumpIfAnchorFlipped);
      expect(foxDelta).toBeCloseTo(queryDelta, 5);
      if (queryAnchorForFox(step.fox, workArea) === 'right') {
        crossedMidline = true;
      }
      previousQueryX = step.query.x;
      previousFoxX = step.fox.x;
    }
    expect(crossedMidline).toBe(true);

    const last = pinnedSteps.at(-1);
    expect(last).toBeDefined();
    if (!last) {
      return;
    }
    const settled = settleQueryDragGesture(last.query, workArea, 'left');
    const invalidFinished = settleQueryDragGesture(last.query, workArea, 'left');
    expect(queryAnchorForFox(last.fox, workArea)).toBe('right');
    expect(settled.anchor).toBe('left');
    expect(invalidFinished.anchor).toBe('left');
    expect(settled.fox.x).toBe(last.fox.x);
    expect(settled.fox.y).toBe(last.fox.y);
    expect(invalidFinished.fox).toEqual(last.fox);
    expect(settled.fox).toEqual(inferFoxRectFromQuery(last.query, workArea, 'left'));
    expect(settled.dockEdge).toBe(resolveFoxDockAfterDrag(last.fox, workArea));
    expect(settled.dockEdge).toBe(resolveFoxDockAfterDrag(settled.fox, workArea));
    expect(settled.fox.x).toBe(last.query.x);

    let liveQuery = startQuery;
    let liveFox = startFox;
    let flippedMidGesture = false;
    for (const chunk of chunks) {
      liveQuery = {
        ...liveQuery,
        x: liveQuery.x + chunk.dx,
        y: liveQuery.y + chunk.dy,
      };
      const liveAnchor = queryAnchorForFox(liveFox, workArea);
      const nextFox = inferFoxRectFromQuery(liveQuery, workArea, liveAnchor);
      if (Math.abs(nextFox.x - liveFox.x) >= jumpIfAnchorFlipped - 1) {
        flippedMidGesture = true;
      }
      liveFox = nextFox;
    }
    expect(flippedMidGesture).toBe(true);
  });

  it('keeps a pinned session anchor through activate and cancelled close, then uses idle fox after close finishes', () => {
    expect(resolveSessionQueryAnchor('left', 'right')).toBe('left');
    expect(resolveSessionQueryAnchor(null, 'right')).toBe('right');

    const afterCrossMidlineActivate = resolveQueryAnchorAfterCloseLifecycle({
      pinned: 'left',
      computedFromIdleFox: 'right',
      closeCompleted: false,
    });
    expect(afterCrossMidlineActivate).toBe('left');

    const reopenBeforeCloseFinished = resolveQueryAnchorAfterCloseLifecycle({
      pinned: 'left',
      computedFromIdleFox: 'right',
      closeCompleted: false,
    });
    expect(reopenBeforeCloseFinished).toBe('left');

    const freshOpenAfterCloseFinished = resolveQueryAnchorAfterCloseLifecycle({
      pinned: 'left',
      computedFromIdleFox: 'right',
      closeCompleted: true,
    });
    expect(freshOpenAfterCloseFinished).toBe('right');
  });

  it('reconciles a removed-display dock to the nearest physical edge', () => {
    expect(reconcileFoxDockEdgeForWorkArea(1964, workArea, 'left')).toBe('right');
    expect(reconcileFoxDockEdgeForWorkArea(-44, workArea, 'right')).toBe('left');
    expect(reconcileFoxDockEdgeForWorkArea(32, workArea, 'left')).toBe('left');
    expect(reconcileFoxDockEdgeForWorkArea(1408, workArea, 'right')).toBe('right');
    // A vertically arranged removed display can overlap the replacement
    // display on X. The nearest physical edge still wins.
    expect(reconcileFoxDockEdgeForWorkArea(1000, workArea, 'left')).toBe('right');
    expect(reconcileFoxDockEdgeForWorkArea(440, workArea, 'right')).toBe('left');
    expect(reconcileFoxDockEdgeForWorkArea(1964, workArea, 'none')).toBe('none');
  });
});
