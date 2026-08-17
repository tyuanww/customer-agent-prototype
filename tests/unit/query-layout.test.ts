import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  acceptQueryLayoutAck,
  acceptQueryLayoutSequence,
  isQueryLayoutAck,
  isQueryLayoutAckCommand,
  isQueryContentLayoutPhase,
  applyQueryVerticalResize,
  clampQueryDesiredHeight,
  pickQueryResizeEdgeForHeight,
  composeQueryDesiredHeight,
  effectiveQuerySize,
  fallbackQuerySizeForPhase,
  isQueryLayoutRequest,
  isQueryResizeRequest,
  queryHandoffCenterFromBounds,
  queryResizeDeltaForKey,
  rejectedQueryLayoutAck,
  resolveQueryResizeEdge,
  shouldIgnoreQueryLayout,
  QUERY_LAYOUT_MAX_HEIGHT,
  QUERY_LAYOUT_MIN_HEIGHT,
  hugQueryDesiredHeight,
  measureQueryHugHeight,
  QUERY_CONTENT_BLANK_TOLERANCE_PX,
} from '../../src/shared/query-layout';

const workArea = { x: 0, y: 25, width: 1440, height: 875 };

describe('query content-hugging layout', () => {
  it('composes capsule + banner + content + chrome + grip', () => {
    expect(composeQueryDesiredHeight({
      capsuleHeight: 88,
      bannerHeight: 24,
      contentScrollHeight: 180,
      chromeExtra: 4,
    })).toBe(296);
    expect(hugQueryDesiredHeight(300, 0)).toBe(300 + QUERY_CONTENT_BLANK_TOLERANCE_PX);
    expect(QUERY_CONTENT_BLANK_TOLERANCE_PX).toBeGreaterThanOrEqual(8);
    expect(QUERY_CONTENT_BLANK_TOLERANCE_PX).toBeLessThanOrEqual(12);
    expect(measureQueryHugHeight({
      shellTop: 10,
      paneTop: 88,
      paneScrollHeight: 220,
      panePaddingBottom: 8,
      lastContentBottom: 290,
    })).toBe(hugQueryDesiredHeight(290, 10));
    expect(measureQueryHugHeight({
      shellTop: 10,
      paneTop: 88,
      paneScrollHeight: 220,
      panePaddingBottom: 8,
    })).toBe(hugQueryDesiredHeight(300, 10));
  });

  it('clamps desired height to 240..min(620, available)', () => {
    expect(clampQueryDesiredHeight(180, 800)).toBe(QUERY_LAYOUT_MIN_HEIGHT);
    expect(clampQueryDesiredHeight(400, 800)).toBe(400);
    expect(clampQueryDesiredHeight(900, 800)).toBe(QUERY_LAYOUT_MAX_HEIGHT);
    expect(clampQueryDesiredHeight(500, 300)).toBe(300);
    expect(clampQueryDesiredHeight(240, 180)).toBe(180);
  });

  it('uses measured or manual height before the old 340/430/620 buckets', () => {
    expect(effectiveQuerySize({
      phase: 'RESULTS',
      resultCount: 3,
      workArea,
      measuredHeight: 312,
    }).height).toBe(312);
    expect(effectiveQuerySize({
      phase: 'RESULTS',
      resultCount: 3,
      workArea,
      measuredHeight: 312,
      manualHeight: 410,
    }).height).toBe(410);
    expect(fallbackQuerySizeForPhase('RESULTS', 3).height).toBe(620);
    expect(fallbackQuerySizeForPhase('RESULTS', 1).height).toBe(340);
    expect(effectiveQuerySize({ phase: 'SEARCH_INPUT' }).height).toBe(88);
  });

  it('fails closed on malicious layout payloads and stale sequences', () => {
    expect(isQueryLayoutRequest({
      sessionId: 2,
      sequence: 1,
      phase: 'RESULTS',
      resultCount: 3,
      desiredHeight: 312,
    })).toBe(true);
    expect(isQueryLayoutRequest({
      sessionId: 2,
      sequence: 1,
      phase: 'RESULTS',
      resultCount: 4,
      desiredHeight: 312,
    })).toBe(false);
    expect(isQueryLayoutRequest({
      sessionId: 2,
      sequence: 1,
      phase: 'RESULTS',
      resultCount: 3,
      desiredHeight: Number.POSITIVE_INFINITY,
    })).toBe(false);
    expect(isQueryLayoutRequest({
      sessionId: 2,
      sequence: 1,
      phase: 'FOX_IDLE',
      resultCount: 0,
      desiredHeight: 88,
    })).toBe(false);
    expect(acceptQueryLayoutSequence(3, 3)).toBe(false);
    expect(acceptQueryLayoutSequence(3, 4)).toBe(true);
    expect(shouldIgnoreQueryLayout('opening', 'RESULTS')).toBe(true);
    expect(shouldIgnoreQueryLayout(null, 'RESULTS')).toBe(false);
    expect(isQueryContentLayoutPhase('RESULTS')).toBe(true);
    expect(isQueryContentLayoutPhase('COPIED')).toBe(false);
    expect(isQueryContentLayoutPhase('SEARCH_INPUT')).toBe(false);
    for (const deltaY of [-4096, 4096]) {
      expect(isQueryResizeRequest({
        type: 'update',
        sessionId: 2,
        sequence: 1,
        deltaY,
      })).toBe(true);
    }
    for (const deltaY of [-4097, -0.5, 0.5, 4097, Number.POSITIVE_INFINITY, Number.NaN, '12']) {
      expect(isQueryResizeRequest({
        type: 'update',
        sessionId: 2,
        sequence: 1,
        deltaY,
      })).toBe(false);
    }
    expect(isQueryResizeRequest({
      type: 'update',
      sessionId: 2,
      sequence: 1,
      deltaY: 12,
      unexpected: true,
    })).toBe(false);
    const validAck = {
      ok: true,
      sessionId: 4,
      sequence: 2,
      phase: 'RESULTS' as const,
      resultCount: 3 as const,
      height: 430,
      resizeEdge: 'bottom' as const,
    };
    expect(isQueryLayoutAck(validAck)).toBe(true);
    expect(isQueryLayoutAck({ ...validAck, sessionId: 0, sequence: 0 })).toBe(false);
    expect(isQueryLayoutAck({
      ...validAck,
      ok: false,
      sessionId: 0,
      sequence: 0,
    })).toBe(true);
    expect(isQueryLayoutAck({
      ...validAck,
      ok: false,
      sessionId: -1,
      sequence: 0,
    })).toBe(false);
    expect(isQueryLayoutAck(rejectedQueryLayoutAck(0, 0))).toBe(true);
    expect(isQueryLayoutAck({ ...validAck, width: 800 })).toBe(false);
    expect(isQueryLayoutAckCommand({
      type: 'query-layout-ack',
      sessionId: 4,
      sequence: 2,
      phase: 'RESULTS',
      resultCount: 3,
      height: 430,
      resizeEdge: 'bottom',
    })).toBe(true);
    expect(isQueryLayoutAckCommand({
      type: 'query-layout-ack',
      sessionId: 4,
      sequence: 2,
      height: 430,
      resizeEdge: 'bottom',
    })).toBe(false);
    expect(acceptQueryLayoutAck({
      ack: validAck,
      requestSessionId: 4,
      requestSequence: 2,
      minSequence: 1,
      activeSessionId: 4,
      currentPhase: 'RESULTS',
      currentResultCount: 3,
    })).toBe(true);
    expect(acceptQueryLayoutAck({
      ack: validAck,
      minSequence: 2,
      activeSessionId: 4,
      currentPhase: 'RESULTS',
      currentResultCount: 3,
    })).toBe(false);
    expect(acceptQueryLayoutAck({
      ack: validAck,
      minSequence: 1,
      activeSessionId: 4,
      currentPhase: 'EMPTY',
      currentResultCount: 3,
    })).toBe(false);
    expect(acceptQueryLayoutAck({
      ack: validAck,
      requestSessionId: 4,
      requestSequence: 2,
      minSequence: 1,
      activeSessionId: 5,
      currentPhase: 'RESULTS',
      currentResultCount: 3,
    })).toBe(false);
    expect(acceptQueryLayoutAck({
      ack: { ...validAck, sessionId: 3 },
      requestSessionId: 4,
      requestSequence: 2,
      minSequence: 1,
      activeSessionId: 4,
      currentPhase: 'RESULTS',
      currentResultCount: 3,
    })).toBe(false);
  });

  it('pins the opposite edge and maps keyboard steps', () => {
    const query = { x: 100, y: 200, width: 600, height: 300 };
    const taller = applyQueryVerticalResize(query, 400, 'bottom', workArea);
    expect(taller).toMatchObject({ x: 100, y: 200, width: 600, height: 400 });
    expect(taller.y + taller.height).toBeLessThanOrEqual(workArea.y + workArea.height - 8);
    const upward = applyQueryVerticalResize(query, 400, 'top', workArea);
    expect(upward.y + upward.height).toBe(500);
    expect(upward.y).toBeGreaterThanOrEqual(workArea.y + 8);
    const tiny = { x: 0, y: 30, width: 144, height: 80 };
    const squeezed = applyQueryVerticalResize(tiny, 240, 'bottom', { x: 0, y: 25, width: 200, height: 100 });
    expect(squeezed.y + squeezed.height).toBeLessThanOrEqual(25 + 100 - 8);
    expect(squeezed.height).toBeLessThan(240);
    expect(resolveQueryResizeEdge({ y: 30, height: 240 }, workArea)).toBe('bottom');
    expect(resolveQueryResizeEdge({ y: 700, height: 240 }, workArea)).toBe('top');
    const nearBottom = { x: 100, y: 800, width: 600, height: 88 };
    expect(pickQueryResizeEdgeForHeight(nearBottom, 520, workArea, 'bottom')).toBe('top');
    const roomBelow = { x: 100, y: 40, width: 600, height: 88 };
    expect(pickQueryResizeEdgeForHeight(roomBelow, 400, workArea, 'bottom')).toBe('bottom');
    expect(queryResizeDeltaForKey('ArrowDown', false)).toBe(8);
    expect(queryResizeDeltaForKey('ArrowUp', true)).toBe(-24);
    expect(queryResizeDeltaForKey('Home', false)).toBe('natural');
    expect(queryResizeDeltaForKey('End', false)).toBe('max');
    expect(queryHandoffCenterFromBounds({ x: 844, y: 244 }, { x: 200, y: 200 })).toEqual({
      x: 644,
      y: 44,
    });
  });

  it('rejects resize payloads that try to move x/y/width', () => {
    expect(isQueryResizeRequest({
      type: 'update',
      sessionId: 1,
      sequence: 2,
      deltaY: 12,
    })).toBe(true);
    expect(isQueryResizeRequest({
      type: 'update',
      sessionId: 1,
      sequence: 2,
      deltaY: Number.NaN,
    })).toBe(false);
    expect(isQueryResizeRequest({
      type: 'begin',
      sessionId: 1,
      sequence: 2,
      x: 10,
      y: 10,
      width: 800,
    })).toBe(false);
  });
});

describe('main query layout policy', () => {
  const controller = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/overlay-controller.ts'),
    'utf8',
  );

  it('keeps natural layout off the resize gesture and advances fallback sequences', () => {
    expect(controller).toContain('!isQueryContentLayoutPhase(this.phase)');
    expect(controller).toContain('this.queryResizeSession !== null && !this.queryResizeSession.finished');
    expect(controller).toContain('this.manualQueryHeight !== null || this.queryResizeSession');
    expect(controller).toContain('this.lastQueryLayoutSequence += 1');
    expect(controller).toContain('phase: this.phase === \'FOX_IDLE\' ? \'SEARCH_INPUT\' : this.phase');
    expect(controller).toContain('resultCount: this.resultCount');
    expect(controller).toContain('this.settleQueryResizeSession(true)');
    expect(controller).toContain('if (this.queryResizeSession && !this.queryResizeSession.finished)');
    expect(controller).toContain('sessionId: this.activeChromeHandoffId');
    expect(isQueryLayoutRequest({
      sessionId: 2,
      sequence: 1,
      phase: 'RESULTS',
      resultCount: 3,
      desiredHeight: 312,
      width: 800,
    })).toBe(false);
  });
});
