import { describe, expect, it } from 'vitest';
import { parseOverlaySnapshot } from '@customer-agent/unified-contracts';
import {
  OVERLAY_EVENT_TYPES,
  applyOverlayEvent,
  createInitialOverlayState,
  isOverlaySnapshotProjection,
  overlaySnapshot,
  type OverlayEvent,
  type OverlayState,
} from '../../src/shared/overlay-machine';
import { IDENTITY_FOX_VISUAL_TRANSFORM } from '../../src/shared/overlay-events';

const foxBounds = { x: 1200, y: 700, width: 88, height: 88 };
const queryBounds = { x: 688, y: 700, width: 600, height: 88 };

function initial(): OverlayState {
  return createInitialOverlayState({
    sessionEpoch: 4,
    generation: 10,
    windowGeneration: 2,
    releaseId: 'rel_synthetic_10',
  });
}

function at(state: OverlayState, overrides: Partial<OverlayEvent> = {}): OverlayEvent {
  return {
    type: 'OPEN_REQUESTED',
    sessionEpoch: state.sessionEpoch,
    generation: state.generation,
    windowGeneration: state.windowGeneration,
    anchor: 'right',
    dockEdge: 'none',
    animate: true,
    restorePreviousApp: true,
    handoffCenterX: 500,
    handoffCenterY: 44,
    queryBounds,
    foxBounds,
    foxVisualTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
    ...overrides,
  } as OverlayEvent;
}

function active(state = initial()): { state: OverlayState; handoffId: number } {
  const opened = applyOverlayEvent(state, at(state)).state;
  const handoffId = opened.handoff.id;
  const armed = applyOverlayEvent(opened, at(opened, {
    type: 'HANDOFF_ARMED',
    handoffId,
  })).state;
  const live = applyOverlayEvent(armed, at(armed, {
    type: 'HANDOFF_OPENED',
    handoffId,
  })).state;
  return { state: live, handoffId };
}

describe('authoritative overlay reducer', () => {
  it('uses the ARC overlay contract and rejects a competing wire shape', () => {
    const projection = overlaySnapshot(initial());

    expect(parseOverlaySnapshot(projection.contract)).toEqual(projection.contract);
    expect(isOverlaySnapshotProjection(projection)).toBe(true);
    expect(isOverlaySnapshotProjection({
      ...projection,
      contract: { ...projection.contract, extra: true },
    })).toBe(false);
  });

  it('owns lifecycle, surface, handoff, focus, layout, drag, session and window identities', () => {
    const state = initial();
    expect(state).toMatchObject({
      phase: 'parked',
      activeSurface: 'fox',
      contentPhase: 'SEARCH_INPUT',
      resultCount: 0,
      sessionEpoch: 4,
      generation: 10,
      windowGeneration: 2,
      focusIntent: 'fox',
    });
    expect(state.handoff).toMatchObject({ id: 0, sequence: 0, mode: 'none' });
    expect(state.layout).toMatchObject({ sequence: 0, ackSequence: 0 });
    expect(state.drag).toMatchObject({ generation: 0, session: null, settle: null });

    const opening = applyOverlayEvent(state, at(state));
    expect(opening.decision).toBe('applied');
    expect(opening.state).toMatchObject({
      phase: 'opening',
      activeSurface: 'fox',
      focusIntent: 'query',
    });
    expect(opening.state.handoff).toMatchObject({
      id: 1,
      sequence: 1,
      mode: 'preparing-open',
    });
    expect(opening.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'SEND_RENDERER_COMMAND', target: 'query' }),
      expect.objectContaining({ type: 'SCHEDULE_TIMEOUT', timer: 'handoff' }),
    ]));
    expect(opening.snapshot.contract).toMatchObject({
      role: 'fox',
      activeSurface: 'fox',
      sessionEpoch: 4,
      generation: state.generation + 1,
      handoffSequence: 1,
      layoutSequence: 0,
      releaseId: 'rel_synthetic_10',
    });
  });

  it('rejects stale handoff acknowledgements and never reopens a closed window', () => {
    const opened = active();
    const closing = applyOverlayEvent(opened.state, at(opened.state, {
      type: 'DISMISS_REQUESTED',
      animate: false,
      restorePreviousApp: true,
    })).state;
    const parked = applyOverlayEvent(closing, at(closing, {
      type: 'HANDOFF_CLOSED',
      handoffId: closing.handoff.id,
    })).state;

    const staleArmed = applyOverlayEvent(parked, at(parked, {
      type: 'HANDOFF_ARMED',
      handoffId: opened.handoffId,
    }));
    expect(staleArmed.decision).toBe('rejected');
    expect(staleArmed.reason).toBe('stale-handoff');
    expect(staleArmed.state.phase).toBe('parked');

    const staleOpen = applyOverlayEvent(parked, at(parked, {
      type: 'HANDOFF_OPENED',
      handoffId: opened.handoffId,
    }));
    expect(staleOpen.decision).toBe('rejected');
    expect(staleOpen.state.phase).toBe('parked');
    expect(staleOpen.effects).toEqual([]);
  });

  it('rejects late content, layout and ACK events from an older generation or session', () => {
    const opened = active();
    const withResults = applyOverlayEvent(opened.state, at(opened.state, {
      type: 'CONTENT_CHANGED',
      contentPhase: 'RESULTS',
      resultCount: 3,
      contentRevision: 1,
    })).state;
    const closing = applyOverlayEvent(withResults, at(withResults, {
      type: 'DISMISS_REQUESTED',
      animate: false,
      restorePreviousApp: true,
    })).state;
    const closed = applyOverlayEvent(closing, at(closing, {
      type: 'HANDOFF_CLOSED',
      handoffId: closing.handoff.id,
    })).state;

    for (const event of [
      at(closed, {
        type: 'CONTENT_CHANGED',
        contentPhase: 'RESULTS',
        resultCount: 3,
        contentRevision: 1,
        generation: withResults.generation,
      }),
      at(closed, {
        type: 'LAYOUT_REQUESTED',
        handoffId: opened.handoffId,
        sequence: closed.layout.sequence + 1,
        desiredHeight: 420,
        contentPhase: 'RESULTS',
        resultCount: 3,
      }),
      at(closed, {
        type: 'QUERY_LAYOUT_ACK',
        handoffId: opened.handoffId,
        sequence: closed.layout.sequence + 1,
        height: 420,
        resizeEdge: 'bottom',
        contentPhase: 'RESULTS',
        resultCount: 3,
        generation: withResults.generation,
      }),
    ]) {
      const transition = applyOverlayEvent(closed, event);
      expect(transition.decision).toBe('rejected');
      expect(transition.state.phase).toBe('parked');
      expect(transition.effects).toEqual([]);
    }

    const staleSession = applyOverlayEvent(withResults, at(withResults, {
      type: 'CONTENT_CHANGED',
      contentPhase: 'ERROR',
      resultCount: 0,
      contentRevision: 2,
      sessionEpoch: withResults.sessionEpoch - 1,
    }));
    expect(staleSession.decision).toBe('rejected');
    expect(staleSession.reason).toBe('stale-session');
    expect(staleSession.state.contentPhase).toBe('RESULTS');
  });

  it('clears content, cancels work and restores Query focus on a newer session epoch', () => {
    const opened = active();
    const withResults = applyOverlayEvent(opened.state, at(opened.state, {
      type: 'CONTENT_CHANGED',
      contentPhase: 'RESULTS',
      resultCount: 3,
      contentRevision: 1,
    })).state;
    const transition = applyOverlayEvent(withResults, at(withResults, {
      type: 'SESSION_CHANGED',
      sessionEpoch: withResults.sessionEpoch + 1,
      releaseId: 'rel_synthetic_11',
    }));

    expect(transition.decision).toBe('applied');
    expect(transition.state).toMatchObject({
      phase: 'active',
      activeSurface: 'query',
      contentPhase: 'SEARCH_INPUT',
      resultCount: 0,
      focusIntent: 'query',
      sessionEpoch: withResults.sessionEpoch + 1,
      releaseId: 'rel_synthetic_11',
    });
    expect(transition.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'CANCEL_QUERY', sessionEpoch: withResults.sessionEpoch, generation: withResults.generation }),
      expect.objectContaining({ type: 'CANCEL_COPY', sessionEpoch: withResults.sessionEpoch, generation: withResults.generation }),
      expect.objectContaining({ type: 'CLEAR_CONTENT' }),
      expect.objectContaining({ type: 'CANCEL_TIMEOUT', timer: 'handoff' }),
      expect.objectContaining({ type: 'CANCEL_TIMEOUT', timer: 'layout' }),
      expect.objectContaining({ type: 'CANCEL_TIMEOUT', timer: 'drag-settle' }),
      expect.objectContaining({ type: 'FOCUS_WINDOW', target: 'query', sessionEpoch: withResults.sessionEpoch + 1 }),
    ]));
  });

  it('cannot commit a stale drag settle or stale multi-display bounds', () => {
    const parked = initial();
    const moving = applyOverlayEvent(parked, at(parked, {
      type: 'FOX_DRAG_MOVED',
      dragGeneration: 7,
      dx: 24,
      dy: 0,
      nextBounds: { ...foxBounds, x: 1224 },
      displayId: 1,
    })).state;
    const ended = applyOverlayEvent(moving, at(moving, {
      type: 'FOX_DRAG_ENDED',
      dragGeneration: 7,
      settledBounds: { ...foxBounds, x: 1240 },
      edge: 'none',
      settleId: 9,
      displayId: 1,
    })).state;
    expect(ended.drag.settle).toMatchObject({ id: 9, generation: 7, displayId: 1 });

    const staleOpen = applyOverlayEvent(ended, at(ended, {
      type: 'OPEN_REQUESTED',
      generation: ended.generation,
    }));
    expect(staleOpen.decision).toBe('ignored');
    expect(staleOpen.reason).toBe('awaiting-drag-settle');

    const staleCommit = applyOverlayEvent(ended, at(ended, {
      type: 'FOX_DRAG_SETTLE_COMMITTED',
      settleId: 8,
      dragGeneration: 7,
    }));
    expect(staleCommit.decision).toBe('rejected');
    expect(staleCommit.reason).toBe('stale-drag-settle');

    const lateSameGenerationMove = applyOverlayEvent(ended, at(ended, {
      type: 'FOX_DRAG_MOVED',
      dragGeneration: 7,
      dx: 4,
      dy: 0,
      nextBounds: { ...foxBounds, x: 1244 },
    }));
    expect(lateSameGenerationMove.decision).toBe('rejected');
    expect(lateSameGenerationMove.reason).toBe('stale-drag-settle');
    expect(lateSameGenerationMove.effects).toEqual([]);
    expect(lateSameGenerationMove.state.drag.session).toBeNull();
    expect(lateSameGenerationMove.state.drag.settle).not.toBeNull();

    const staleDisplay = applyOverlayEvent(ended, at(ended, {
      type: 'DISPLAY_CHANGED',
      displayId: 2,
      windowGeneration: ended.windowGeneration,
      generation: ended.generation,
    }));
    expect(staleDisplay.decision).toBe('rejected');
    expect(staleDisplay.reason).toBe('drag-settle-pending');
  });

  it('enforces the previous content transition table with monotonic content revisions', () => {
    const opened = active();
    const phases = ['SEARCH_INPUT', 'RESULTS', 'EMPTY', 'ERROR', 'COPIED'] as const;
    const legal = new Set([
      'RESULTS->COPIED',
      'COPIED->COPIED',
    ]);

    for (const from of phases) {
      const state: OverlayState = {
        ...opened.state,
        contentPhase: from,
        resultCount: from === 'RESULTS' || from === 'COPIED' ? 3 : 0,
        contentRevision: 9,
      };
      for (const to of phases) {
        const transition = applyOverlayEvent(state, at(state, {
          type: 'CONTENT_CHANGED',
          contentPhase: to,
          resultCount: to === 'RESULTS' || to === 'COPIED' ? 3 : 0,
          contentRevision: state.contentRevision + 1,
        }));
        if (to !== 'COPIED' || legal.has(`${from}->${to}`)) {
          expect(
            transition.decision,
            `${from}->${to} should stay legal`,
          ).toBe('applied');
        } else {
          expect(
            transition.decision,
            `${from}->${to} must not overwrite content`,
          ).toBe('rejected');
          expect(transition.state.contentPhase).toBe(from);
        }
      }
    }

    const current = {
      ...opened.state,
      contentPhase: 'EMPTY' as const,
      contentRevision: 12,
    };
    const late = applyOverlayEvent(current, at(current, {
      type: 'CONTENT_CHANGED',
      contentPhase: 'ERROR',
      resultCount: 0,
      contentRevision: 11,
    }));
    expect(late.decision).toBe('rejected');
    expect(late.reason).toBe('stale-content');
    expect(late.state.contentPhase).toBe('EMPTY');
  });

  it('invalidates all prior window work when a replacement window generation is created', () => {
    const opened = active();
    const replacement = applyOverlayEvent(opened.state, at(opened.state, {
      type: 'WINDOW_RECREATED',
      windowGeneration: opened.state.windowGeneration + 1,
    }));
    expect(replacement.decision).toBe('applied');
    expect(replacement.state).toMatchObject({
      phase: 'parked',
      activeSurface: 'fox',
      contentPhase: 'SEARCH_INPUT',
      resultCount: 0,
      focusIntent: 'fox',
      windowGeneration: opened.state.windowGeneration + 1,
    });

    const stale = applyOverlayEvent(replacement.state, at(replacement.state, {
      type: 'HANDOFF_ARMED',
      handoffId: opened.handoffId,
      windowGeneration: opened.state.windowGeneration,
    }));
    expect(stale.decision).toBe('rejected');
    expect(stale.reason).toBe('stale-window');
    expect(stale.state.phase).toBe('parked');
  });

  it('rejects window recreation when the reported generation or session is stale', () => {
    const opened = active();

    const staleGeneration = applyOverlayEvent(opened.state, at(opened.state, {
      type: 'WINDOW_RECREATED',
      generation: opened.state.generation - 1,
      windowGeneration: opened.state.windowGeneration + 1,
    }));
    expect(staleGeneration.decision).toBe('rejected');
    expect(staleGeneration.reason).toBe('stale-generation');
    expect(staleGeneration.state).toBe(opened.state);
    expect(staleGeneration.effects).toEqual([]);

    const staleSession = applyOverlayEvent(opened.state, at(opened.state, {
      type: 'WINDOW_RECREATED',
      sessionEpoch: opened.state.sessionEpoch - 1,
      windowGeneration: opened.state.windowGeneration + 1,
    }));
    expect(staleSession.decision).toBe('rejected');
    expect(staleSession.reason).toBe('stale-session');
    expect(staleSession.state).toBe(opened.state);
    expect(staleSession.effects).toEqual([]);

    const skippedWindow = applyOverlayEvent(opened.state, at(opened.state, {
      type: 'WINDOW_RECREATED',
      windowGeneration: opened.state.windowGeneration + 2,
    }));
    expect(skippedWindow.decision).toBe('rejected');
    expect(skippedWindow.reason).toBe('stale-window');
    expect(skippedWindow.state).toBe(opened.state);
  });

  it('routes reactivation, display sync and layout fallback through typed effects', () => {
    const opened = active();
    const reactivated = applyOverlayEvent(opened.state, at(opened.state, {
      type: 'QUERY_REACTIVATED',
      anchor: 'right',
    }));
    expect(reactivated.decision).toBe('applied');
    expect(reactivated.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'SEND_RENDERER_COMMAND',
        target: 'query',
        command: expect.objectContaining({ type: 'activate-search', anchor: 'right' }),
      }),
      expect.objectContaining({ type: 'FOCUS_WINDOW', target: 'query' }),
    ]));

    const displayed = applyOverlayEvent(reactivated.state, at(reactivated.state, {
      type: 'DISPLAY_CHANGED',
      displayId: 2,
      edge: 'left',
      foxBounds,
      queryBounds,
      queryAnchor: 'right',
    }));
    expect(displayed.decision).toBe('applied');
    expect(displayed.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'SEND_RENDERER_COMMAND',
        target: 'query',
        command: { type: 'sync-query-anchor', anchor: 'right' },
      }),
    ]));

    const requested = applyOverlayEvent(displayed.state, at(displayed.state, {
      type: 'LAYOUT_REQUESTED',
      handoffId: displayed.state.handoff.id,
      sequence: displayed.state.layout.sequence + 1,
      desiredHeight: 420,
      contentPhase: displayed.state.contentPhase,
      resultCount: displayed.state.resultCount,
      contentRevision: displayed.state.contentRevision,
    }));
    expect(requested.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'SCHEDULE_TIMEOUT',
        timer: 'layout',
        sequence: requested.state.layout.sequence,
        guard: expect.objectContaining({
          contentRevision: requested.state.contentRevision,
        }),
      }),
    ]));

    const timedOut = applyOverlayEvent(requested.state, at(requested.state, {
      type: 'LAYOUT_TIMEOUT',
      handoffId: requested.state.handoff.id,
      sequence: requested.state.layout.sequence,
      contentRevision: requested.state.contentRevision,
    }));
    expect(timedOut.decision).toBe('applied');
    expect(timedOut.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'APPLY_QUERY_LAYOUT_FALLBACK',
        handoffId: requested.state.handoff.id,
        sequence: requested.state.layout.sequence,
      }),
    ]));
  });

  it('routes shortcut status to both overlay surfaces through typed effects', () => {
    const state = initial();
    const transition = applyOverlayEvent(state, at(state, {
      type: 'SHORTCUT_STATUS_CHANGED',
      registered: false,
      accelerator: 'CommandOrControl+Shift+Space',
      message: 'click the fox',
    }));

    expect(transition.decision).toBe('applied');
    expect(transition.effects).toEqual([
      expect.objectContaining({
        type: 'SEND_RENDERER_COMMAND',
        target: 'fox',
        command: expect.objectContaining({ type: 'shortcut-status', registered: false }),
      }),
      expect.objectContaining({
        type: 'SEND_RENDERER_COMMAND',
        target: 'query',
        command: expect.objectContaining({ type: 'shortcut-status', registered: false }),
      }),
    ]);
  });

  it('has an exhaustive valid, stale and invalid outcome matrix', () => {
    const parked = initial();
    const opening = applyOverlayEvent(parked, at(parked)).state;
    const activeState = active().state;
    const closing = applyOverlayEvent(activeState, at(activeState, {
      type: 'DISMISS_REQUESTED',
      animate: false,
      restorePreviousApp: true,
    })).state;
    const closed = applyOverlayEvent(activeState, at(activeState, {
      type: 'WINDOW_CLOSED',
    })).state;
    const states = [
      parked,
      opening,
      activeState,
      closing,
      closed,
    ];
    const appliedByPhase: Record<OverlayState['phase'], ReadonlySet<OverlayEvent['type']>> = {
      parked: new Set([
        'OPEN_REQUESTED',
        'SESSION_CHANGED',
        'RELEASE_CHANGED',
        'WINDOW_RECREATED',
        'WINDOW_CLOSED',
        'FOX_DRAG_MOVED',
        'DISPLAY_CHANGED',
        'FOX_EDGE_SYNCED',
        'FOX_PEEK_CHANGED',
        'SHORTCUT_STATUS_CHANGED',
        'RENDERER_FRAME_OBSERVED',
      ]),
      opening: new Set([
        'DISMISS_REQUESTED',
        'QUERY_SUBSCRIBED',
        'HANDOFF_ARMED',
        'HANDOFF_TIMEOUT',
        'HANDOFF_CANCELLED',
        'CONTENT_CHANGED',
        'SESSION_CHANGED',
        'RELEASE_CHANGED',
        'WINDOW_RECREATED',
        'WINDOW_CLOSED',
        'QUERY_FOCUSED',
        'QUERY_BLURRED',
        'FOX_DRAG_MOVED',
        'DISPLAY_CHANGED',
        'FOX_EDGE_SYNCED',
        'SHORTCUT_STATUS_CHANGED',
        'RENDERER_FRAME_OBSERVED',
      ]),
      active: new Set([
        'DISMISS_REQUESTED',
        'QUERY_REACTIVATED',
        'CONTENT_CHANGED',
        'SESSION_CHANGED',
        'RELEASE_CHANGED',
        'WINDOW_RECREATED',
        'WINDOW_CLOSED',
        'QUERY_FOCUSED',
        'QUERY_BLURRED',
        'LAYOUT_REQUESTED',
        'RESIZE_BEGIN',
        'RESIZE_KEYBOARD',
        'FOX_DRAG_MOVED',
        'DISPLAY_CHANGED',
        'FOX_EDGE_SYNCED',
        'SHORTCUT_STATUS_CHANGED',
        'RENDERER_FRAME_OBSERVED',
      ]),
      closing: new Set([
        'HANDOFF_CLOSED',
        'HANDOFF_TIMEOUT',
        'HANDOFF_CANCELLED',
        'SESSION_CHANGED',
        'RELEASE_CHANGED',
        'WINDOW_RECREATED',
        'WINDOW_CLOSED',
        'FOCUS_RESTORED',
        'FOX_DRAG_MOVED',
        'DISPLAY_CHANGED',
        'FOX_EDGE_SYNCED',
        'SHORTCUT_STATUS_CHANGED',
        'RENDERER_FRAME_OBSERVED',
      ]),
      closed: new Set([
        'SESSION_CHANGED',
        'RELEASE_CHANGED',
        'WINDOW_RECREATED',
        'FOX_DRAG_MOVED',
        'DISPLAY_CHANGED',
        'FOX_EDGE_SYNCED',
        'SHORTCUT_STATUS_CHANGED',
        'RENDERER_FRAME_OBSERVED',
      ]),
    };
    const ignoredByPhase: Record<OverlayState['phase'], ReadonlySet<OverlayEvent['type']>> = {
      parked: new Set([
        'DISMISS_REQUESTED',
        'TOGGLE_REQUESTED',
        'QUERY_SUBSCRIBED',
        'QUERY_REACTIVATED',
        'QUERY_FOCUSED',
        'QUERY_BLURRED',
        'FOCUS_RESTORED',
        'QUERY_DRAG_CLEARED',
      ]),
      opening: new Set([
        'OPEN_REQUESTED',
        'TOGGLE_REQUESTED',
        'QUERY_REACTIVATED',
        'FOCUS_RESTORED',
        'QUERY_DRAG_CLEARED',
        'FOX_PEEK_CHANGED',
      ]),
      active: new Set([
        'OPEN_REQUESTED',
        'TOGGLE_REQUESTED',
        'QUERY_SUBSCRIBED',
        'HANDOFF_TIMEOUT',
        'FOCUS_RESTORED',
        'QUERY_DRAG_CLEARED',
        'FOX_PEEK_CHANGED',
      ]),
      closing: new Set([
        'OPEN_REQUESTED',
        'DISMISS_REQUESTED',
        'TOGGLE_REQUESTED',
        'QUERY_SUBSCRIBED',
        'QUERY_REACTIVATED',
        'QUERY_FOCUSED',
        'QUERY_BLURRED',
        'QUERY_DRAG_CLEARED',
        'FOX_PEEK_CHANGED',
      ]),
      closed: new Set([
        'OPEN_REQUESTED',
        'DISMISS_REQUESTED',
        'TOGGLE_REQUESTED',
        'QUERY_SUBSCRIBED',
        'QUERY_REACTIVATED',
        'WINDOW_CLOSED',
        'QUERY_FOCUSED',
        'QUERY_BLURRED',
        'FOCUS_RESTORED',
        'QUERY_DRAG_CLEARED',
        'FOX_PEEK_CHANGED',
      ]),
    };

    function validEventFor(state: OverlayState, type: OverlayEvent['type']): OverlayEvent {
      const base = {
        sessionEpoch: state.sessionEpoch,
        generation: state.generation,
        windowGeneration: state.windowGeneration,
      };
      switch (type) {
        case 'OPEN_REQUESTED':
          return at(state);
        case 'DISMISS_REQUESTED':
          return { type, ...base, restorePreviousApp: true, animate: false, handoffCenterX: 44, handoffCenterY: 44 };
        case 'TOGGLE_REQUESTED':
        case 'QUERY_SUBSCRIBED':
        case 'WINDOW_RECREATED':
        case 'WINDOW_CLOSED':
        case 'QUERY_FOCUSED':
        case 'QUERY_BLURRED':
        case 'FOCUS_RESTORED':
        case 'QUERY_DRAG_CLEARED':
          return type === 'WINDOW_RECREATED'
            ? { type, ...base, windowGeneration: state.windowGeneration + 1 }
            : { type, ...base };
        case 'QUERY_REACTIVATED':
          return { type, ...base, anchor: 'left' };
        case 'HANDOFF_ARMED':
        case 'HANDOFF_OPENED':
        case 'HANDOFF_CLOSED':
        case 'HANDOFF_TIMEOUT':
        case 'HANDOFF_CANCELLED':
          return {
            type,
            ...base,
            handoffId: state.handoff.id > 0 ? state.handoff.id : 1,
          };
        case 'CONTENT_CHANGED':
          return {
            type,
            ...base,
            contentRevision: state.contentRevision + 1,
            contentPhase: 'RESULTS',
            resultCount: 3,
          };
        case 'SESSION_CHANGED':
          return { type, ...base, sessionEpoch: state.sessionEpoch + 1, releaseId: 'rel_synthetic_next' };
        case 'RELEASE_CHANGED':
          return { type, ...base, releaseId: 'rel_synthetic_next' };
        case 'LAYOUT_REQUESTED':
          return {
            type,
            ...base,
            handoffId: state.handoff.id,
            sequence: state.layout.sequence + 1,
            desiredHeight: 420,
            contentPhase: state.contentPhase,
            resultCount: state.resultCount,
            contentRevision: state.contentRevision,
          };
        case 'QUERY_LAYOUT_ACK':
          return {
            type,
            ...base,
            handoffId: state.handoff.id,
            sequence: state.layout.sequence + 1,
            height: 420,
            resizeEdge: 'bottom',
            contentPhase: state.contentPhase,
            resultCount: state.resultCount,
            contentRevision: state.contentRevision,
          };
        case 'LAYOUT_TIMEOUT':
          return {
            type,
            ...base,
            handoffId: state.handoff.id,
            sequence: state.layout.sequence + 1,
            contentRevision: state.contentRevision,
          };
        case 'RESIZE_BEGIN':
          return {
            type,
            ...base,
            handoffId: state.handoff.id,
            sequence: state.layout.sequence + 1,
            baselineHeight: 320,
            edge: 'bottom',
            contentRevision: state.contentRevision,
          };
        case 'RESIZE_UPDATE':
          return {
            type,
            ...base,
            handoffId: state.handoff.id,
            sequence: state.layout.sequence + 1,
            height: 360,
            edge: 'bottom',
            contentRevision: state.contentRevision,
          };
        case 'RESIZE_END':
          return {
            type,
            ...base,
            handoffId: state.handoff.id,
            sequence: state.layout.sequence + 1,
            height: 360,
            commit: true,
            contentRevision: state.contentRevision,
          };
        case 'RESIZE_KEYBOARD':
          return {
            type,
            ...base,
            handoffId: state.handoff.id,
            sequence: state.layout.sequence + 1,
            height: 360,
            edge: 'bottom',
            contentRevision: state.contentRevision,
          };
        case 'FOX_DRAG_MOVED':
          return {
            type,
            ...base,
            dragGeneration: 7,
            target: 'fox',
            dx: 4,
            dy: 0,
            nextBounds: foxBounds,
            displayId: 1,
          };
        case 'FOX_DRAG_ENDED':
          return {
            type,
            ...base,
            dragGeneration: 7,
            target: 'fox',
            settledBounds: foxBounds,
            edge: 'none',
            settleId: 9,
            displayId: 1,
          };
        case 'FOX_DRAG_SETTLE_COMMITTED':
          return { type, ...base, dragGeneration: 7, settleId: 9 };
        case 'FOX_DRAG_TIMEOUT':
          return { type, ...base, dragGeneration: 7 };
        case 'DISPLAY_CHANGED':
          return { type, ...base, displayId: 1, edge: 'none', foxBounds };
        case 'FOX_EDGE_SYNCED':
          return { type, ...base, edge: state.fox.edge, peekEpoch: state.fox.peekEpoch + 1 };
        case 'FOX_PEEK_CHANGED':
          return {
            type,
            ...base,
            intent: state.fox.peekIntent === 'peek' ? 'retract' : 'peek',
            peekEpoch: state.fox.peekEpoch,
          };
        case 'SHORTCUT_STATUS_CHANGED':
          return { type, ...base, registered: true, accelerator: 'CommandOrControl+Shift+Space', message: '' };
        case 'RENDERER_FRAME_OBSERVED':
          return { type, ...base, commandId: 1, target: 'query', frame: 'snapshot', commandType: 'handoff' };
      }
    }

    function staleEventFor(state: OverlayState, event: OverlayEvent): OverlayEvent {
      if (event.type === 'WINDOW_RECREATED') {
        return { ...event, windowGeneration: state.windowGeneration };
      }
      if (event.type === 'SESSION_CHANGED') {
        return { ...event, sessionEpoch: state.sessionEpoch };
      }
      return { ...event, generation: state.generation - 1 };
    }

    expect(states.map((state) => state.phase)).toEqual(
      ['parked', 'opening', 'active', 'closing', 'closed'],
    );
    for (const state of states) {
      for (const type of OVERLAY_EVENT_TYPES) {
        const valid = validEventFor(state, type);
        expect(valid.type, `${state.phase}:${type} fixture type`).toBe(type);
        const validTransition = applyOverlayEvent(state, valid);
        const expected = appliedByPhase[state.phase].has(type)
          ? 'applied'
          : ignoredByPhase[state.phase].has(type)
            ? 'ignored'
            : 'rejected';
        expect(
          validTransition.decision,
          `${state.phase}:${type} expected ${expected}`,
        ).toBe(expected);
        expect(
          Boolean(validTransition.state.drag.session && validTransition.state.drag.settle),
          `${state.phase}:${type} drag ownership`,
        ).toBe(false);

        const stale = staleEventFor(state, valid);
        expect(
          applyOverlayEvent(state, stale).decision,
          `${state.phase}:${type} stale outcome`,
        ).toBe('rejected');

        const invalid = { ...valid, type: 'NOT_AN_OVERLAY_EVENT' } as unknown as OverlayEvent;
        expect(
          applyOverlayEvent(state, invalid).decision,
          `${state.phase}:${type} invalid outcome`,
        ).toBe('rejected');
      }
    }
  });
});
