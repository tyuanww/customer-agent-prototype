import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  attachTestHarness: vi.fn(),
  loadRenderer: vi.fn(),
  unregisterAll: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    focus: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    isHidden: vi.fn(() => false),
    isReady: () => true,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null),
  },
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: mocks.unregisterAll,
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 24, y: 120 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
  systemPreferences: {
    getAnimationSettings: () => ({ prefersReducedMotion: false }),
  },
}));

vi.mock('../../src/main/dashboard-window', () => ({
  createDashboardBrowserWindow: vi.fn(),
  readDashboardWindowSnapshot: vi.fn(),
}));

vi.mock('../../src/main/overlay-renderer-loader', () => ({
  loadRenderer: mocks.loadRenderer,
}));

vi.mock('../../src/main/window-security', () => ({
  lockRendererWindow: vi.fn(),
}));

vi.mock('../../src/main/overlay-test-harness', () => ({
  attachTestHarness: mocks.attachTestHarness,
  isTestHarnessEnabled: () => false,
}));

import { OverlayController } from '../../src/main/overlay-controller';
import { app, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/contracts';
import type {
  FoxDragSettleAck,
  OverlayCommand,
  OverlayRendererEvent,
} from '../../src/shared/overlay-events';
import {
  applyOverlayEvent,
  createInitialOverlayState,
  type OverlayState,
} from '../../src/shared/overlay-machine';
import type { OverlayReportIdentity } from '../../src/shared/overlay-report';

type FoxWindowFixture = BrowserWindow & {
  sent: OverlayCommand[];
  showInactive: ReturnType<typeof vi.fn>;
  setFocusable: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  blur: ReturnType<typeof vi.fn>;
  acceptNativeBounds(
    bounds: { x: number; y: number; width: number; height: number },
    event: 'move' | 'moved',
  ): void;
};

function createFoxWindow(): FoxWindowFixture {
  let bounds = { x: 0, y: 100, width: 88, height: 88 };
  const sent: OverlayCommand[] = [];
  const nativeBoundsListeners = new Map<'move' | 'moved', Set<() => void>>();
  return {
    getBounds: vi.fn(() => ({ ...bounds })),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    on: vi.fn((event: 'move' | 'moved', listener: () => void) => {
      const listeners = nativeBoundsListeners.get(event) ?? new Set<() => void>();
      listeners.add(listener);
      nativeBoundsListeners.set(event, listeners);
    }),
    setBounds: vi.fn((next: typeof bounds) => {
      bounds = { ...next };
    }),
    showInactive: vi.fn(),
    setFocusable: vi.fn(),
    hide: vi.fn(),
    blur: vi.fn(),
    focus: vi.fn(),
    webContents: {
      isDestroyed: () => false,
      focus: vi.fn(),
      send: vi.fn((channel: string, command: OverlayCommand) => {
        if (channel === IPC_CHANNELS.OVERLAY_COMMAND) {
          sent.push(command);
        }
      }),
    },
    sent,
    acceptNativeBounds: (
      next: { x: number; y: number; width: number; height: number },
      event: 'move' | 'moved',
    ) => {
      bounds = { ...next };
      for (const listener of nativeBoundsListeners.get(event) ?? []) {
        listener();
      }
    },
  } as unknown as FoxWindowFixture;
}

function controllerWithDockedFox(): { controller: OverlayController; fox: FoxWindowFixture } {
  const controller = new OverlayController();
  const fox = createFoxWindow();
  const parked = createInitialOverlayState({
    sessionEpoch: 1,
    generation: 1,
    windowGeneration: 1,
    releaseId: 'rel_synthetic',
  });
  Object.assign(controller as object, {
    fox,
    foxOrigin: { x: 0, y: 100 },
    overlayState: {
      ...parked,
      fox: { ...parked.fox, edge: 'left' },
    },
  });
  return { controller, fox };
}

function activeState(): OverlayState {
  let state = createInitialOverlayState({
    sessionEpoch: 1,
    generation: 1,
    windowGeneration: 1,
    releaseId: 'rel_synthetic',
  });
  const plan = {
    sessionEpoch: state.sessionEpoch,
    generation: state.generation,
    windowGeneration: state.windowGeneration,
    anchor: 'right' as const,
    dockEdge: 'none' as const,
    animate: false,
    restorePreviousApp: true,
    handoffCenterX: 500,
    handoffCenterY: 44,
    queryBounds: { x: 688, y: 700, width: 600, height: 88 },
    foxBounds: { x: 1200, y: 700, width: 88, height: 88 },
    foxVisualTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  };
  state = applyOverlayEvent(state, { type: 'OPEN_REQUESTED', ...plan }).state;
  state = applyOverlayEvent(state, {
    type: 'HANDOFF_ARMED',
    sessionEpoch: state.sessionEpoch,
    generation: state.generation,
    windowGeneration: state.windowGeneration,
    handoffId: state.handoff.id,
  }).state;
  state = applyOverlayEvent(state, {
    type: 'HANDOFF_OPENED',
    sessionEpoch: state.sessionEpoch,
    generation: state.generation,
    windowGeneration: state.windowGeneration,
    handoffId: state.handoff.id,
  }).state;
  return applyOverlayEvent(state, {
    type: 'CONTENT_CHANGED',
    sessionEpoch: state.sessionEpoch,
    generation: state.generation,
    windowGeneration: state.windowGeneration,
    contentRevision: 1,
    contentPhase: 'RESULTS',
    resultCount: 3,
  }).state;
}

function finishDrag(
  controller: OverlayController,
  generation: number,
  dx = 24,
): FoxDragSettleAck {
  expect(controller.moveBy(dx, 0, false, generation)).toBeNull();
  const settle = controller.moveBy(0, 0, true, generation);
  expect(settle).not.toBeNull();
  return settle as FoxDragSettleAck;
}

describe('OverlayController fox drag settle transaction', () => {
  const controllers: OverlayController[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const controller of controllers.splice(0)) {
      controller.dispose();
    }
  });

  it.each(['move', 'moved'] as const)(
    'adopts the native Fox frame from the BrowserWindow %s event',
    (event) => {
      const { controller, fox } = controllerWithDockedFox();
      controllers.push(controller);
      const bindNativeReadback = Reflect.get(
        controller,
        'bindFoxNativeBoundsReadback',
      ) as (win: BrowserWindow) => void;

      bindNativeReadback.call(controller, fox);
      fox.acceptNativeBounds({ x: 96, y: 124, width: 88, height: 88 }, event);

      expect(Reflect.get(controller, 'foxOrigin')).toEqual({ x: 96, y: 124 });
      expect(fox.setBounds).not.toHaveBeenCalled();
    },
  );

  it('holds repeated shortcut intents until the exact final settle commit, then opens once', () => {
    const { controller, fox } = controllerWithDockedFox();
    controllers.push(controller);
    expect(controller.moveBy(24, 0, false, 1)).toBeNull();
    controller.openSearch();
    controller.openSearch();
    expect(controller.phase).toBe('FOX_IDLE');

    const settle = controller.moveBy(0, 0, true, 1) as FoxDragSettleAck;
    expect(settle).toMatchObject({ generation: 1, settleId: 1 });
    controller.openSearch();
    expect(controller.phase).toBe('FOX_IDLE');
    expect(fox.sent).toContainEqual({ type: 'fox-drag-settled', ...settle });

    controller.commitFoxDragSettle(settle.settleId + 1);
    expect(controller.phase).toBe('FOX_IDLE');

    controller.commitFoxDragSettle(settle.settleId);
    expect(controller.phase).toBe('SEARCH_INPUT');

    controller.commitFoxDragSettle(settle.settleId);
    expect(controller.phase).toBe('SEARCH_INPUT');
  });

  it('keeps the open intent across a superseding generation and rejects old commits', () => {
    const { controller } = controllerWithDockedFox();
    controllers.push(controller);
    const first = finishDrag(controller, 1);
    controller.openSearch();
    expect(controller.phase).toBe('FOX_IDLE');

    expect(controller.moveBy(-12, 0, false, 2)).toBeNull();
    controller.commitFoxDragSettle(first.settleId);
    expect(controller.phase).toBe('FOX_IDLE');

    const second = controller.moveBy(0, 0, true, 2) as FoxDragSettleAck;
    expect(second.generation).toBe(2);
    expect(second.settleId).toBeGreaterThan(first.settleId);
    controller.commitFoxDragSettle(first.settleId);
    expect(controller.phase).toBe('FOX_IDLE');

    controller.commitFoxDragSettle(second.settleId);
    expect(controller.phase).toBe('SEARCH_INPUT');
  });

  it('fails closed for an out-of-order finish and leaves the active generation settleable', () => {
    const { controller } = controllerWithDockedFox();
    controllers.push(controller);

    expect(controller.moveBy(16, 0, false, 7)).toBeNull();
    expect(controller.moveBy(0, 0, true, 6)).toBeNull();
    controller.openSearch();
    expect(controller.phase).toBe('FOX_IDLE');

    const settle = controller.moveBy(0, 0, true, 7) as FoxDragSettleAck;
    expect(settle.generation).toBe(7);
    controller.commitFoxDragSettle(settle.settleId);
    expect(controller.phase).toBe('SEARCH_INPUT');
  });

  it('invalidates a native drag session when the authoritative session changes', () => {
    const { controller } = controllerWithDockedFox();
    controllers.push(controller);
    expect(controller.moveBy(24, 0, false, 1)).toBeNull();
    expect(Reflect.get(controller, 'foxDragTransaction')).not.toBeNull();
    Reflect.get(controller, 'startCommandObservation').call(
      controller,
      'layout',
      1,
      Reflect.get(controller, 'currentReportIdentity').call(controller),
    );
    expect((Reflect.get(controller, 'commandFrameStartedAt') as Map<string, number>).size).toBe(1);

    const state = Reflect.get(controller, 'overlayState') as OverlayState;
    controller.reportRendererEvent({
      type: 'session-changed',
      sessionEpoch: state.sessionEpoch,
      nextSessionEpoch: state.sessionEpoch + 1,
      releaseId: 'rel_synthetic_next',
      windowGeneration: state.windowGeneration,
      generation: state.generation,
      contentRevision: state.contentRevision,
    });

    expect(Reflect.get(controller, 'foxDragTransaction')).toBeNull();
    expect((Reflect.get(controller, 'commandFrameStartedAt') as Map<string, number>).size).toBe(0);
    expect(Reflect.get(controller, 'overlayState')).toMatchObject({
      drag: { session: null, settle: null },
      sessionEpoch: state.sessionEpoch + 1,
    });
  });

  it('cancels a pending blur recheck when the authoritative window generation changes', () => {
    vi.useFakeTimers();
    const controller = new OverlayController();
    const query = createFoxWindow();
    const state = activeState();
    Object.assign(controller as object, { query, overlayState: state });
    controllers.push(controller);
    Reflect.get(controller, 'armBlurGrace').call(controller);
    Reflect.get(controller, 'handleQueryBlur').call(controller);
    expect(Reflect.get(controller, 'pendingQueryBlur')).toBe(true);
    expect(Reflect.get(controller, 'blurRecheckTimer')).not.toBeNull();

    controller.reportRendererEvent({
      type: 'window-recreated',
      sessionEpoch: state.sessionEpoch,
      nextWindowGeneration: state.windowGeneration + 1,
      windowGeneration: state.windowGeneration,
      generation: state.generation,
      contentRevision: state.contentRevision,
    });

    expect(Reflect.get(controller, 'pendingQueryBlur')).toBe(false);
    expect(Reflect.get(controller, 'blurRecheckTimer')).toBeNull();
    expect(Reflect.get(controller, 'overlayState')).toMatchObject({
      windowGeneration: state.windowGeneration + 1,
      phase: 'parked',
    });
  });

  it('keeps a pending blur recheck when only content advances', () => {
    vi.useFakeTimers();
    const controller = new OverlayController();
    const query = createFoxWindow();
    const state = activeState();
    Object.assign(controller as object, { query, overlayState: state });
    controllers.push(controller);
    Reflect.get(controller, 'armBlurGrace').call(controller);
    Reflect.get(controller, 'handleQueryBlur').call(controller);

    controller.reportUiPhase('EMPTY', 0, {
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
      windowGeneration: state.windowGeneration,
      contentRevision: state.contentRevision + 1,
    });
    Reflect.get(controller, 'schedulePendingBlurRecheck').call(controller);

    expect(Reflect.get(controller, 'pendingQueryBlur')).toBe(true);
    expect(Reflect.get(controller, 'blurRecheckTimer')).not.toBeNull();
  });

  it('keeps a blur that arrives while the query window is still opening', () => {
    vi.useFakeTimers();
    const controller = new OverlayController();
    const query = createFoxWindow();
    const state = { ...activeState(), phase: 'opening' as const };
    Object.assign(controller as object, { query, overlayState: state });
    controllers.push(controller);
    Reflect.get(controller, 'armBlurGrace').call(controller);
    Reflect.get(controller, 'handleQueryBlur').call(controller);

    expect(Reflect.get(controller, 'pendingQueryBlur')).toBe(true);
    expect(Reflect.get(controller, 'blurRecheckTimer')).not.toBeNull();
  });
});

describe('OverlayController renderer work ownership', () => {
  const controllers: OverlayController[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const controller of controllers.splice(0)) {
      controller.dispose();
    }
  });

  it('runs cancellation capabilities and publishes one final snapshot after nested layout effects', () => {
    const cancelQuery = vi.fn();
    const cancelCopy = vi.fn();
    const clearContent = vi.fn();
    const controller = new OverlayController({
      overlayWork: { cancelQuery, cancelCopy, clearContent },
    });
    const query = createFoxWindow();
    const state = activeState();
    Object.assign(controller as object, { query, overlayState: state });
    controllers.push(controller);

    controller.reportRendererEvent({
      type: 'session-changed',
      sessionEpoch: state.sessionEpoch,
      nextSessionEpoch: state.sessionEpoch + 1,
      releaseId: 'rel_synthetic_next',
      windowGeneration: state.windowGeneration,
      generation: state.generation,
      contentRevision: state.contentRevision,
    });
    expect(cancelQuery).toHaveBeenCalledWith({
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
    });
    expect(cancelCopy).toHaveBeenCalledWith({
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
    });
    expect(clearContent).toHaveBeenCalledOnce();

    Object.assign(controller as object, { overlayState: activeState() });
    const active = Reflect.get(controller, 'overlayState') as OverlayState;
    query.sent.length = 0;
    controller.reportQueryLayout({
      sessionId: active.handoff.id,
      sequence: active.layout.sequence + 1,
      phase: 'RESULTS',
      resultCount: 3,
      desiredHeight: 420,
      identity: {
        sessionEpoch: active.sessionEpoch,
        generation: active.generation,
        windowGeneration: active.windowGeneration,
        contentRevision: active.contentRevision,
      },
    });

    const snapshots = query.sent.filter((command) => command.type === 'overlay-snapshot');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual(expect.objectContaining({
      type: 'overlay-snapshot',
      snapshot: expect.objectContaining({
        contract: expect.objectContaining({
          sessionEpoch: active.sessionEpoch,
          generation: active.generation,
        }),
        layout: expect.objectContaining({
          appliedHeight: expect.any(Number),
        }),
      }),
    }));
  });

  it('rejects a stale layout request without changing native bounds or sending an ACK', () => {
    const controller = new OverlayController();
    const query = createFoxWindow();
    const state = activeState();
    Object.assign(controller as object, { query, overlayState: state });
    controllers.push(controller);

    const ack = controller.reportQueryLayout({
      sessionId: state.handoff.id,
      sequence: 0,
      phase: state.contentPhase,
      resultCount: state.resultCount,
      desiredHeight: 420,
      identity: {
        sessionEpoch: state.sessionEpoch,
        generation: state.generation,
        windowGeneration: state.windowGeneration,
        contentRevision: state.contentRevision,
      },
    });

    expect(ack).toMatchObject({ ok: false, sequence: 0 });
    expect(query.setBounds).not.toHaveBeenCalled();
    expect(query.sent).toEqual([]);
    expect(Reflect.get(controller, 'overlayState')).toBe(state);
  });

  it('does not let a same-origin stale release report roll back the current release', () => {
    const controller = new OverlayController();
    const state = activeState();
    Object.assign(controller as object, { overlayState: state });
    controllers.push(controller);

    expect(controller.reportRendererEvent({
      type: 'release-changed',
      releaseId: 'rel_synthetic_next',
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
      windowGeneration: state.windowGeneration,
      contentRevision: state.contentRevision,
      releaseSequence: 11,
    })).not.toBeNull();
    expect(controller.reportRendererEvent({
      type: 'release-changed',
      releaseId: 'rel_synthetic_stale',
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
      windowGeneration: state.windowGeneration,
      contentRevision: state.contentRevision,
      releaseSequence: 10,
    })).toBeNull();
    expect(Reflect.get(controller, 'overlayState')).toMatchObject({
      releaseId: 'rel_synthetic_next',
      releaseSequence: 11,
    });
  });

  it('measures cold as the first completed observation duration after earlier work is dropped', () => {
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(120)
      .mockReturnValueOnce(160);
    const controller = new OverlayController();
    const state = activeState();
    Object.assign(controller as object, { overlayState: state });
    controllers.push(controller);
    const identity = {
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
      windowGeneration: state.windowGeneration,
      contentRevision: state.contentRevision,
    };
    const start = Reflect.get(controller, 'startCommandObservation') as (
      type: 'handoff' | 'layout' | 'settle',
      id: number,
      reportIdentity: typeof identity,
    ) => void;
    const record = Reflect.get(controller, 'recordRendererFrame') as (
      type: 'handoff' | 'layout' | 'settle',
      id: number,
      reportIdentity: typeof identity,
    ) => boolean;

    try {
      start.call(controller, 'layout', 1, identity);
      Reflect.get(controller, 'clearCommandObservations').call(controller);
      start.call(controller, 'layout', 2, identity);
      expect(record.call(controller, 'layout', 2, identity)).toBe(true);
      expect(controller.performanceSnapshot()).toMatchObject({
        count: 1,
        coldMs: 40,
        droppedObservations: 1,
        coldSemantics: 'first-completed-observation',
      });
    } finally {
      now.mockRestore();
    }
  });

  it('drops a scheduled display reconciliation after the lifecycle identity changes', () => {
    vi.useFakeTimers();
    const controller = new OverlayController();
    const query = createFoxWindow();
    const state = activeState();
    Object.assign(controller as object, { query, overlayState: state });
    controllers.push(controller);
    Reflect.get(controller, 'scheduleDisplayReconcile').call(controller);

    controller.reportRendererEvent({
      type: 'session-changed',
      sessionEpoch: state.sessionEpoch,
      nextSessionEpoch: state.sessionEpoch + 1,
      releaseId: 'rel_synthetic_next',
      windowGeneration: state.windowGeneration,
      generation: state.generation,
      contentRevision: state.contentRevision,
    });
    vi.mocked(query.setBounds).mockClear();
    vi.advanceTimersByTime(1_000);

    expect(query.setBounds).not.toHaveBeenCalled();
  });

  it('does not run post-drag reconciliation from an older drag generation', () => {
    vi.useFakeTimers();
    const controller = new OverlayController();
    const query = createFoxWindow();
    const state = activeState();
    Object.assign(controller as object, {
      query,
      overlayState: state,
      displayReconcilePending: true,
    });
    controllers.push(controller);
    Reflect.get(controller, 'schedulePostFoxDragWork').call(controller);
    Object.assign(controller as object, {
      overlayState: {
        ...state,
        drag: {
          ...state.drag,
          generation: 1,
          session: null,
          settle: null,
        },
      },
    });
    vi.mocked(query.setBounds).mockClear();
    vi.advanceTimersByTime(1);

    expect(query.setBounds).not.toHaveBeenCalled();
  });

  it('rejects a renderer report that claims a newer session than the originating snapshot', () => {
    const controller = new OverlayController();
    const state = activeState();
    Object.assign(controller as object, { overlayState: state });
    controllers.push(controller);

    const result = controller.reportRendererEvent({
      type: 'session-changed',
      sessionEpoch: state.sessionEpoch + 1,
      nextSessionEpoch: state.sessionEpoch + 2,
      releaseId: 'rel_forged',
      windowGeneration: state.windowGeneration,
      generation: state.generation,
      contentRevision: state.contentRevision,
    } satisfies OverlayRendererEvent);

    expect(result).toBeNull();
    expect(Reflect.get(controller, 'overlayState')).toBe(state);
  });

  it.each([
    {
      label: 'stale session',
      event: (state: OverlayState) => ({
        type: 'release-changed',
        releaseId: 'rel_stale',
        sessionEpoch: state.sessionEpoch - 1,
        generation: state.generation,
        windowGeneration: state.windowGeneration,
        contentRevision: state.contentRevision,
        releaseSequence: state.releaseSequence,
      } satisfies OverlayRendererEvent),
    },
    {
      label: 'stale window',
      event: (state: OverlayState) => ({
        type: 'focus-changed',
        focused: false,
        sessionEpoch: state.sessionEpoch,
        generation: state.generation,
        windowGeneration: state.windowGeneration - 1,
        contentRevision: state.contentRevision,
      } satisfies OverlayRendererEvent),
    },
    {
      label: 'stale generation',
      event: (state: OverlayState) => ({
        type: 'frame-observed',
        commandId: 1,
        commandType: 'layout',
        target: 'query',
        sessionEpoch: state.sessionEpoch,
        generation: state.generation - 1,
        windowGeneration: state.windowGeneration,
        contentRevision: state.contentRevision,
      } satisfies OverlayRendererEvent),
    },
    {
      label: 'stale window recreation',
      event: (state: OverlayState) => ({
        type: 'window-recreated',
        sessionEpoch: state.sessionEpoch,
        generation: state.generation,
        windowGeneration: state.windowGeneration - 1,
        nextWindowGeneration: state.windowGeneration + 1,
        contentRevision: state.contentRevision,
      } satisfies OverlayRendererEvent),
    },
    {
      label: 'skipped window generation',
      event: (state: OverlayState) => ({
        type: 'window-recreated',
        sessionEpoch: state.sessionEpoch,
        generation: state.generation,
        windowGeneration: state.windowGeneration,
        nextWindowGeneration: state.windowGeneration + 2,
        contentRevision: state.contentRevision,
      } satisfies OverlayRendererEvent),
    },
  ])('rejects a $label renderer report without mutating Main', ({ event }) => {
    const controller = new OverlayController();
    const state = activeState();
    Object.assign(controller as object, { overlayState: state });
    controllers.push(controller);

    expect(controller.reportRendererEvent(event(state))).toBeNull();
    expect(Reflect.get(controller, 'overlayState')).toBe(state);
  });

  it('checks handoff origin separately from content revision', () => {
    const controller = new OverlayController();
    controllers.push(controller);
    const initial = createInitialOverlayState({
      sessionEpoch: 1,
      generation: 1,
      windowGeneration: 1,
      releaseId: 'rel_synthetic',
    });
    const opening = applyOverlayEvent(initial, {
      type: 'OPEN_REQUESTED',
      sessionEpoch: initial.sessionEpoch,
      generation: initial.generation,
      windowGeneration: initial.windowGeneration,
      anchor: 'right',
      dockEdge: 'none',
      animate: false,
      queryBounds: { x: 688, y: 700, width: 600, height: 88 },
      foxBounds: { x: 1200, y: 700, width: 88, height: 88 },
      handoffCenterX: 500,
      handoffCenterY: 44,
      foxVisualTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    }).state;
    const withContent = applyOverlayEvent(opening, {
      type: 'CONTENT_CHANGED',
      sessionEpoch: opening.sessionEpoch,
      generation: opening.generation,
      windowGeneration: opening.windowGeneration,
      contentRevision: 1,
      contentPhase: 'RESULTS',
      resultCount: 3,
    }).state;
    Object.assign(controller as object, { overlayState: withContent });

    controller.reportHandoffMilestone(withContent.handoff.id, 'open-armed', {
      sessionEpoch: withContent.sessionEpoch,
      generation: withContent.generation,
      windowGeneration: withContent.windowGeneration,
      contentRevision: 0,
    });
    const armed = Reflect.get(controller, 'overlayState') as OverlayState;
    expect(armed).toMatchObject({
      phase: 'opening',
      contentRevision: withContent.contentRevision,
      handoff: { mode: 'opening' },
    });
    controller.reportHandoffMilestone(armed.handoff.id, 'open-finished', {
      sessionEpoch: armed.sessionEpoch,
      generation: armed.generation,
      windowGeneration: armed.windowGeneration,
      contentRevision: 0,
    });
    const handedOff = Reflect.get(controller, 'overlayState') as OverlayState;
    expect(handedOff).toMatchObject({
      phase: 'active',
      contentRevision: withContent.contentRevision,
      handoff: { mode: 'none' },
    });

    controller.reportUiPhase('EMPTY', 0, {
      sessionEpoch: handedOff.sessionEpoch,
      generation: handedOff.generation,
      windowGeneration: handedOff.windowGeneration,
      contentRevision: handedOff.contentRevision + 2,
    });
    expect(Reflect.get(controller, 'overlayState')).toBe(handedOff);

    controller.reportUiPhase('EMPTY', 0, {
      sessionEpoch: handedOff.sessionEpoch,
      generation: handedOff.generation,
      windowGeneration: handedOff.windowGeneration,
      contentRevision: handedOff.contentRevision + 1,
    });
    expect(Reflect.get(controller, 'overlayState')).toMatchObject({
      contentPhase: 'EMPTY',
      resultCount: 0,
      contentRevision: handedOff.contentRevision + 1,
    });
  });

  it('accepts a handoff milestone after unrelated content advanced', () => {
    const controller = new OverlayController();
    controllers.push(controller);
    const initial = createInitialOverlayState({
      sessionEpoch: 1,
      generation: 1,
      windowGeneration: 1,
      releaseId: 'rel_synthetic',
    });
    const preparing = applyOverlayEvent(initial, {
      type: 'OPEN_REQUESTED',
      sessionEpoch: initial.sessionEpoch,
      generation: initial.generation,
      windowGeneration: initial.windowGeneration,
      anchor: 'right',
      dockEdge: 'none',
      animate: false,
      queryBounds: { x: 688, y: 700, width: 600, height: 88 },
      foxBounds: { x: 1200, y: 700, width: 88, height: 88 },
      handoffCenterX: 500,
      handoffCenterY: 44,
      foxVisualTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    }).state;
    const opening = applyOverlayEvent(preparing, {
      type: 'HANDOFF_ARMED',
      sessionEpoch: preparing.sessionEpoch,
      generation: preparing.generation,
      windowGeneration: preparing.windowGeneration,
      handoffId: preparing.handoff.id,
    }).state;
    const withContent = applyOverlayEvent(opening, {
      type: 'CONTENT_CHANGED',
      sessionEpoch: opening.sessionEpoch,
      generation: opening.generation,
      windowGeneration: opening.windowGeneration,
      contentRevision: opening.contentRevision + 1,
      contentPhase: 'RESULTS',
      resultCount: 3,
    }).state;
    Object.assign(controller as object, { overlayState: withContent });

    controller.reportHandoffMilestone(withContent.handoff.id, 'open-finished', {
      sessionEpoch: withContent.sessionEpoch,
      generation: withContent.generation,
      windowGeneration: withContent.windowGeneration,
      contentRevision: opening.contentRevision,
    });

    expect(Reflect.get(controller, 'overlayState')).toMatchObject({
      phase: 'active',
      contentRevision: withContent.contentRevision,
      handoff: { mode: 'none' },
    });
  });

  it('bounds pending command observations and reports overflow separately from samples', () => {
    const controller = new OverlayController();
    const query = createFoxWindow();
    Object.assign(controller as object, { query });
    controllers.push(controller);
    const executeNativeEffects = Reflect.get(controller, 'executeNativeEffects') as (
      effects: readonly import('../../src/shared/overlay-machine').NativeEffect[],
    ) => void;

    for (let commandId = 1; commandId <= 300; commandId += 1) {
      executeNativeEffects.call(controller, [{
        type: 'SEND_RENDERER_COMMAND',
        target: 'query',
        commandId,
        command: {
          type: 'activate-search',
          anchor: 'right',
          animate: false,
        },
      }]);
    }

    const performance = controller.performanceSnapshot();
    expect(performance.pending).toBeLessThanOrEqual(256);
    expect(performance.errors).toBe(44);
    expect(performance.count).toBe(0);
  });

  it('tracks handoff and layout observations with the same numeric id independently', () => {
    const controller = new OverlayController();
    const query = createFoxWindow();
    const state = activeState();
    Object.assign(controller as object, { query, overlayState: state });
    controllers.push(controller);
    const executeNativeEffects = Reflect.get(controller, 'executeNativeEffects') as (
      effects: readonly import('../../src/shared/overlay-machine').NativeEffect[],
    ) => void;
    const startCommandObservation = Reflect.get(controller, 'startCommandObservation') as (
      type: 'handoff' | 'layout' | 'settle',
      id: number,
      identity: OverlayReportIdentity,
    ) => void;
    const identity = {
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
      windowGeneration: state.windowGeneration,
      contentRevision: state.contentRevision,
    };
    executeNativeEffects.call(controller, [{
      type: 'SEND_RENDERER_COMMAND',
      target: 'query',
      commandId: 5,
      command: {
        type: 'activate-search',
        anchor: 'right',
        animate: false,
      },
    }]);
    startCommandObservation.call(controller, 'layout', 5, identity);

    controller.reportRendererEvent({
      type: 'frame-observed',
      commandId: 5,
      commandType: 'layout',
      target: 'query',
      ...identity,
    });

    expect(controller.performanceSnapshot()).toMatchObject({ pending: 1, count: 1 });
    expect(
      Array.from(
        (Reflect.get(controller, 'commandFrameStartedAt') as Map<string, number>).keys(),
      ),
    ).toEqual([expect.stringMatching(/:handoff:5$/)]);
  });

  it('clears pending command observations when content identity advances', () => {
    const controller = new OverlayController();
    const state = activeState();
    Object.assign(controller as object, { overlayState: state });
    controllers.push(controller);
    Reflect.get(controller, 'startCommandObservation').call(
      controller,
      'layout',
      1,
      {
        sessionEpoch: state.sessionEpoch,
        generation: state.generation,
        windowGeneration: state.windowGeneration,
        contentRevision: state.contentRevision,
      },
    );

    controller.reportUiPhase('EMPTY', 0, {
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
      windowGeneration: state.windowGeneration,
      contentRevision: state.contentRevision + 1,
    });

    expect(controller.performanceSnapshot()).toMatchObject({
      pending: 0,
      droppedObservations: 1,
    });
  });

  it('rejects a layout timeout whose captured identity is stale', () => {
    vi.useFakeTimers();
    const controller = new OverlayController();
    const query = createFoxWindow();
    const state = activeState();
    Object.assign(controller as object, { query, overlayState: state });
    controllers.push(controller);
    const requested = applyOverlayEvent(state, {
      type: 'LAYOUT_REQUESTED',
      sessionEpoch: state.sessionEpoch,
      generation: state.generation,
      windowGeneration: state.windowGeneration,
      handoffId: state.handoff.id,
      sequence: state.layout.sequence + 1,
      desiredHeight: 420,
      contentPhase: state.contentPhase,
      resultCount: state.resultCount,
      contentRevision: state.contentRevision,
    });
    const schedule = requested.effects.find(
      (effect) => effect.type === 'SCHEDULE_TIMEOUT' && effect.timer === 'layout',
    );
    expect(schedule).toBeDefined();
    Object.assign(controller as object, { overlayState: requested.state });
    Reflect.get(controller, 'executeNativeEffects').call(controller, [schedule]);

    const nextSession = applyOverlayEvent(requested.state, {
      type: 'SESSION_CHANGED',
      sessionEpoch: requested.state.sessionEpoch + 1,
      generation: requested.state.generation,
      windowGeneration: requested.state.windowGeneration,
      releaseId: 'rel_synthetic_next',
    }).state;
    Object.assign(controller as object, { overlayState: nextSession });

    vi.advanceTimersByTime(200);

    expect(query.sent.filter((command) => command.type === 'query-layout-ack')).toEqual([]);
  });
});

describe('OverlayController yield previous-app focus', () => {
  const controllers: OverlayController[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const controller of controllers.splice(0)) {
      controller.dispose();
    }
  });

  function yieldPalette(controller: OverlayController, fox: FoxWindowFixture) {
    const yieldOrKeepPalette = Reflect.get(controller, 'yieldOrKeepPalette') as (
      win: BrowserWindow,
    ) => void;
    yieldOrKeepPalette.call(controller, fox);
  }

  function requestPreviousAppFocus(controller: OverlayController): void {
    const state = Reflect.get(controller, 'overlayState') as {
      focusIntent: string;
    };
    Reflect.set(controller, 'overlayState', {
      ...state,
      focusIntent: 'previous-app',
    });
  }

  it('on darwin hides then shows the fox on the next scheduler tick, not synchronously', () => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    const { controller, fox } = controllerWithDockedFox();
    controllers.push(controller);
    requestPreviousAppFocus(controller);
    fox.showInactive.mockClear();

    yieldPalette(controller, fox);

    expect(fox.setFocusable).toHaveBeenCalledWith(false);
    expect(app.hide).toHaveBeenCalledOnce();
    expect(fox.showInactive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(34);
    expect(fox.showInactive).toHaveBeenCalledOnce();
  });

  it('cancels the delayed fox show when search opens', () => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    const { controller, fox } = controllerWithDockedFox();
    controllers.push(controller);
    requestPreviousAppFocus(controller);
    fox.showInactive.mockClear();
    yieldPalette(controller, fox);
    const clearFoxYieldShow = Reflect.get(controller, 'clearFoxYieldShow') as () => void;
    clearFoxYieldShow.call(controller);
    vi.advanceTimersByTime(34);
    expect(fox.showInactive).not.toHaveBeenCalled();
  });

  it('does not app.hide when another chrome window is visible', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    const { controller, fox } = controllerWithDockedFox();
    controllers.push(controller);
    const extra = { isDestroyed: () => false, isVisible: () => true } as unknown as BrowserWindow;
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([fox, extra]);
    requestPreviousAppFocus(controller);
    fox.showInactive.mockClear();
    yieldPalette(controller, fox);
    expect(app.hide).not.toHaveBeenCalled();
    expect(fox.showInactive).toHaveBeenCalled();
  });

  it('still yields when the extra window is DevTools', () => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    const { controller, fox } = controllerWithDockedFox();
    controllers.push(controller);
    const devtools = {
      isDestroyed: () => false,
      isVisible: () => true,
      webContents: {
        isDestroyed: () => false,
        getType: () => 'remote',
        getURL: () => 'devtools://devtools/bundled/devtools_app.html',
      },
    } as unknown as BrowserWindow;
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([fox, devtools]);
    requestPreviousAppFocus(controller);
    fox.showInactive.mockClear();
    yieldPalette(controller, fox);
    expect(app.hide).toHaveBeenCalledOnce();
    expect(fox.showInactive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(34);
    expect(fox.showInactive).toHaveBeenCalledOnce();
  });

  it('on win32 hides the fox one tick then showInactive, without app.hide or steal', () => {
    vi.useFakeTimers();
    const previous = process.platform;
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    try {
      const { controller, fox } = controllerWithDockedFox();
      controllers.push(controller);
      requestPreviousAppFocus(controller);
      fox.showInactive.mockClear();
      yieldPalette(controller, fox);
      expect(fox.setFocusable).toHaveBeenCalledWith(false);
      expect(fox.blur).toHaveBeenCalledOnce();
      expect(fox.hide).toHaveBeenCalledOnce();
      expect(app.hide).not.toHaveBeenCalled();
      expect(app.focus).not.toHaveBeenCalled();
      expect(fox.showInactive).not.toHaveBeenCalled();
      vi.advanceTimersByTime(34);
      expect(fox.showInactive).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: previous });
    }
  });
});
