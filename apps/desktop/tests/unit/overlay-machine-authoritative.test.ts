import { describe, expect, it } from 'vitest';
import {
  OVERLAY_EVENT_TYPES,
  applyOverlayEvent,
  createInitialOverlayState,
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
    const lateCommitAfterMove = applyOverlayEvent(lateSameGenerationMove.state, at(
      lateSameGenerationMove.state,
      {
        type: 'FOX_DRAG_SETTLE_COMMITTED',
        settleId: 9,
        dragGeneration: 7,
      },
    ));
    expect(lateCommitAfterMove.decision).toBe('rejected');
    expect(lateCommitAfterMove.reason).toBe('stale-drag-session');

    const staleDisplay = applyOverlayEvent(ended, at(ended, {
      type: 'DISPLAY_CHANGED',
      displayId: 2,
      windowGeneration: ended.windowGeneration,
      generation: ended.generation,
    }));
    expect(staleDisplay.decision).toBe('rejected');
    expect(staleDisplay.reason).toBe('drag-settle-pending');
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

  it('records an explicit decision for every event family', () => {
    const activeState = active().state;
    const closing = applyOverlayEvent(activeState, at(activeState, {
      type: 'DISMISS_REQUESTED',
      animate: false,
      restorePreviousApp: true,
    })).state;
    const closed = applyOverlayEvent(closing, at(closing, {
      type: 'WINDOW_CLOSED',
    })).state;
    const states = [
      initial(),
      applyOverlayEvent(initial(), at(initial())).state,
      activeState,
      closing,
      closed,
    ];
    expect(new Set(states.map((state) => state.phase))).toEqual(
      new Set(['parked', 'opening', 'active', 'closing', 'closed']),
    );
    for (const state of states) {
      for (const type of OVERLAY_EVENT_TYPES) {
        const event = at(state, { type } as Partial<OverlayEvent>);
        const transition = applyOverlayEvent(state, event);
        expect(['applied', 'ignored', 'rejected']).toContain(transition.decision);
        expect(transition.snapshot.contract.sessionEpoch).toBe(transition.state.sessionEpoch);
        expect(transition.snapshot.contract.generation).toBe(transition.state.generation);
      }
    }
  });
});
