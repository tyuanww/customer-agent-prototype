import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { OverlayController } from '../../src/main/overlay-controller';
import { registerOverlayIpc } from '../../src/main/overlay-ipc';
import { IPC_CHANNELS } from '../../src/shared/contracts';
import {
  OPEN_DASHBOARD_FAILURE_MESSAGE,
  type OpenDashboardResult,
} from '../../src/shared/dashboard-access';
import {
  isQueryLayoutAck,
  type QueryLayoutAck,
  type QueryLayoutRequest,
  type QueryResizeRequest,
} from '../../src/shared/query-layout';
import type { RendererRole } from '../../src/shared/overlay-events';
import { OVERLAY_EVENT_CHANNEL } from '../../src/shared/overlay-events';
import { createInitialOverlayState, overlaySnapshot } from '../../src/shared/overlay-machine';

type CapturedHandler = (event: IpcMainInvokeEvent, ...payload: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, CapturedHandler>();
  const handle = vi.fn((channel: string, handler: CapturedHandler) => {
    handlers.set(channel, handler);
  });
  return { handle, handlers };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
  },
}));

const DEV_SERVER_URL = 'http://127.0.0.1:5173/';
const REPORT_IDENTITY = {
  sessionEpoch: 1,
  generation: 2,
  windowGeneration: 1,
  contentRevision: 0,
} as const;

type SenderFixture = {
  sender: WebContents;
  event: IpcMainInvokeEvent;
};

function createSender(
  id: number,
  role: RendererRole,
  options: { subframe?: boolean } = {},
): SenderFixture {
  const mainFrame = { parent: null };
  const sender = {
    id,
    isDestroyed: () => false,
    getURL: () => `${DEV_SERVER_URL}?role=${role}`,
    mainFrame,
  } as unknown as WebContents;
  const senderFrame = options.subframe ? { parent: mainFrame } : mainFrame;
  return {
    sender,
    event: {
      sender,
      senderFrame,
    } as unknown as IpcMainInvokeEvent,
  };
}

function acceptedAck(
  sessionId: number,
  sequence: number,
  height: number,
): QueryLayoutAck {
  return {
    ok: true,
    sessionId,
    sequence,
    phase: 'RESULTS',
    resultCount: 3,
    height,
    resizeEdge: 'bottom',
  };
}

function createControllerFixture(options: { testHarness?: boolean } = {}) {
  const query = createSender(7, 'query');
  const fox = createSender(8, 'fox');
  const dashboard = createSender(9, 'dashboard');
  const roleById = new Map<number, RendererRole>([
    [query.sender.id, 'query'],
    [fox.sender.id, 'fox'],
    [dashboard.sender.id, 'dashboard'],
  ]);
  const reportQueryLayout = vi.fn((request: QueryLayoutRequest) =>
    acceptedAck(request.sessionId, request.sequence, request.desiredHeight),
  );
  const resizeQueryHeight = vi.fn((request: QueryResizeRequest) =>
    acceptedAck(request.sessionId, request.sequence, 360),
  );
  const openDashboard = vi.fn<() => Promise<OpenDashboardResult>>().mockResolvedValue({ ok: true });
  const moveBy = vi.fn().mockReturnValue(null);
  const commitFoxDragSettle = vi.fn();
  const querySubscribed = vi.fn();
  const reportSessionChange = vi.fn();
  const reportReleaseChange = vi.fn();
  const reportFocus = vi.fn();
  const reportRendererFrame = vi.fn();
  const reportRendererEvent = vi.fn(() => snapshot);
  const snapshotState = createInitialOverlayState({
    sessionEpoch: 1,
    generation: 2,
    windowGeneration: 1,
    releaseId: 'rel_synthetic',
  });
  const snapshot = overlaySnapshot(snapshotState);
  const controller = {
    accelerator: 'CommandOrControl+Shift+Space',
    phase: 'RESULTS',
    rendererDevServerUrl: DEV_SERVER_URL,
    shortcutMessage: '快捷键可用',
    shortcutRegistered: true,
    testHarness: options.testHarness ?? false,
    trustedContents: () => [query.sender, fox.sender, dashboard.sender],
    overlayRoleOf: (sender: WebContents) => roleById.get(sender.id) ?? null,
    reportQueryLayout,
    resizeQueryHeight,
    openDashboard,
    moveBy,
    commitFoxDragSettle,
    querySubscribed,
    reportSessionChange,
    reportReleaseChange,
    reportFocus,
    reportRendererFrame,
    reportRendererEvent,
    getOverlaySnapshot: () => snapshot,
  } as unknown as OverlayController;

  return {
    controller,
    dashboard,
    fox,
    query,
    reportQueryLayout,
    resizeQueryHeight,
    openDashboard,
    moveBy,
    commitFoxDragSettle,
    querySubscribed,
    reportSessionChange,
    reportReleaseChange,
    reportFocus,
    reportRendererFrame,
    reportRendererEvent,
    snapshot,
  };
}

function capturedHandler(channel: string): CapturedHandler {
  const handler = electronMocks.handlers.get(channel);
  expect(handler).toBeTypeOf('function');
  return handler as CapturedHandler;
}

function expectRejectedAck(
  value: unknown,
  expectedIds: { sessionId: number; sequence: number },
): void {
  expect(isQueryLayoutAck(value)).toBe(true);
  expect(value).toMatchObject({ ok: false, ...expectedIds });
}

describe('overlay query layout IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.handlers.clear();
  });

  it('accepts subscription readiness only from the trusted Query main frame', () => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const receive = capturedHandler(IPC_CHANNELS.QUERY_SUBSCRIBED);
    for (const event of [fixture.fox.event, fixture.dashboard.event,
      createSender(99, 'query').event, createSender(7, 'query', { subframe: true }).event]) receive(event);
    expect(fixture.querySubscribed).not.toHaveBeenCalled();
    receive(fixture.query.event);
    expect(fixture.querySubscribed).toHaveBeenCalledOnce();
  });

  it('routes only trusted main-frame overlay events to their narrow controller capability', () => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const receive = capturedHandler(OVERLAY_EVENT_CHANNEL);
    const session = {
      type: 'session-changed',
      sessionEpoch: 1,
      nextSessionEpoch: 5,
      releaseId: 'rel_synthetic',
      windowGeneration: 1,
      generation: 2,
      contentRevision: 0,
    } as const;

    expect(receive(fixture.fox.event, session)).toBeNull();
    expect(fixture.reportSessionChange).not.toHaveBeenCalled();
    expect(receive(createSender(7, 'query', { subframe: true }).event, session)).toBeNull();
    expect(receive(fixture.query.event, session)).toEqual(fixture.snapshot);
    expect(fixture.reportRendererEvent).toHaveBeenCalledWith(session);

    receive(fixture.query.event, {
      type: 'frame-observed',
      commandId: 4,
      commandType: 'handoff',
      target: 'query',
      sessionEpoch: 1,
      windowGeneration: 1,
      generation: 2,
      contentRevision: 0,
    });
    expect(fixture.reportRendererEvent).toHaveBeenCalledTimes(2);
  });

  it('forwards the originating renderer identity unchanged to Main', () => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const receive = capturedHandler(OVERLAY_EVENT_CHANNEL);
    const session = {
      type: 'session-changed',
      sessionEpoch: 1,
      nextSessionEpoch: 2,
      releaseId: 'rel_synthetic',
      windowGeneration: 1,
      generation: 2,
      contentRevision: 0,
    } as const;

    expect(receive(fixture.query.event, session)).toEqual(fixture.snapshot);
    expect(fixture.reportRendererEvent).toHaveBeenCalledOnce();
    expect(fixture.reportRendererEvent).toHaveBeenCalledWith(session);
    expect(fixture.reportSessionChange).not.toHaveBeenCalled();
  });

  it('returns the trusted renderer context with the runtime platform', () => {
    const fixture = createControllerFixture({ testHarness: true });
    registerOverlayIpc(() => fixture.controller);

    expect(capturedHandler(IPC_CHANNELS.GET_WINDOW_CONTEXT)(fixture.query.event)).toEqual({
      role: 'query',
      phase: 'RESULTS',
      platform: process.platform,
      shortcut: {
        registered: true,
        accelerator: 'CommandOrControl+Shift+Space',
        message: '快捷键可用',
      },
      snapshot: fixture.snapshot,
      testHarness: true,
    });
  });

  it('returns a fail-closed context with the runtime platform for an untrusted sender', () => {
    const fixture = createControllerFixture();
    const untrusted = createSender(99, 'query');
    registerOverlayIpc(() => fixture.controller);

    expect(capturedHandler(IPC_CHANNELS.GET_WINDOW_CONTEXT)(untrusted.event)).toEqual({
      role: 'query',
      phase: 'FOX_IDLE',
      platform: process.platform,
      shortcut: {
        registered: false,
        accelerator: 'CommandOrControl+Shift+Space',
        message: '窗口上下文不可用',
      },
      snapshot: expect.objectContaining({
        contract: expect.objectContaining({ releaseId: 'rel_overlay_unbound' }),
      }),
      testHarness: false,
    });
  });

  it('returns a typed fail-closed window context when the overlay controller is unavailable', () => {
    registerOverlayIpc(() => null);
    const query = createSender(7, 'query');

    expect(capturedHandler(IPC_CHANNELS.GET_WINDOW_CONTEXT)(query.event)).toEqual({
      role: 'query',
      phase: 'FOX_IDLE',
      platform: process.platform,
      shortcut: {
        registered: false,
        accelerator: 'CommandOrControl+Shift+Space',
        message: '窗口上下文不可用',
      },
      snapshot: expect.objectContaining({
        contract: expect.objectContaining({ releaseId: 'rel_overlay_unbound' }),
      }),
      testHarness: false,
    });
  });

  it('awaits dashboard opening and returns a typed failure to the trusted query', async () => {
    const fixture = createControllerFixture();
    fixture.openDashboard.mockResolvedValueOnce({
      ok: false,
      message: OPEN_DASHBOARD_FAILURE_MESSAGE,
    });
    registerOverlayIpc(() => fixture.controller);
    const handler = capturedHandler(IPC_CHANNELS.OPEN_DASHBOARD);

    await expect(Promise.resolve(handler(fixture.query.event, undefined))).resolves.toEqual({
      ok: false,
      message: OPEN_DASHBOARD_FAILURE_MESSAGE,
    });
    expect(fixture.openDashboard).toHaveBeenCalledOnce();
  });

  it('returns a typed success after the trusted query waits for a loaded dashboard', async () => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const handler = capturedHandler(IPC_CHANNELS.OPEN_DASHBOARD);

    await expect(Promise.resolve(handler(fixture.query.event, undefined))).resolves.toEqual({ ok: true });
    expect(fixture.openDashboard).toHaveBeenCalledOnce();
  });

  it('requires a generation for a production Fox move and forwards the valid transaction', () => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const handler = capturedHandler(IPC_CHANNELS.MOVE_FOX_BY);

    expect(handler(fixture.fox.event, 12, -4, false)).toBeNull();
    expect(fixture.moveBy).not.toHaveBeenCalled();

    expect(handler(fixture.fox.event, 12, -4, false, 3, REPORT_IDENTITY)).toBeNull();
    expect(fixture.moveBy).toHaveBeenCalledOnce();
    expect(fixture.moveBy).toHaveBeenCalledWith(12, -4, false, 3, REPORT_IDENTITY);
  });

  it('accepts a final settle commit only from the trusted Fox main frame', () => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const handler = capturedHandler(IPC_CHANNELS.COMMIT_FOX_DRAG_SETTLE);

    handler(fixture.query.event, 4);
    handler(createSender(8, 'fox', { subframe: true }).event, 4);
    handler(fixture.fox.event, 0);
    expect(fixture.commitFoxDragSettle).not.toHaveBeenCalled();

    handler(fixture.fox.event, 4, REPORT_IDENTITY);
    expect(fixture.commitFoxDragSettle).toHaveBeenCalledOnce();
    expect(fixture.commitFoxDragSettle).toHaveBeenCalledWith(4, REPORT_IDENTITY);
  });

  it.each([
    ['untrusted renderer', () => createSender(99, 'query').event],
    ['fox', (fixture: ReturnType<typeof createControllerFixture>) => fixture.fox.event],
    ['dashboard', (fixture: ReturnType<typeof createControllerFixture>) => fixture.dashboard.event],
  ])('fails closed for a %s without invoking the controller', async (_label, eventFor) => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const handler = capturedHandler(IPC_CHANNELS.OPEN_DASHBOARD);

    await expect(Promise.resolve(handler(eventFor(fixture), undefined))).resolves.toEqual({
      ok: false,
      message: OPEN_DASHBOARD_FAILURE_MESSAGE,
    });
    expect(fixture.openDashboard).not.toHaveBeenCalled();
  });

  it('returns a typed failure when the overlay controller is unavailable', async () => {
    registerOverlayIpc(() => null);
    const query = createSender(7, 'query');
    const handler = capturedHandler(IPC_CHANNELS.OPEN_DASHBOARD);

    await expect(Promise.resolve(handler(query.event, undefined))).resolves.toEqual({
      ok: false,
      message: OPEN_DASHBOARD_FAILURE_MESSAGE,
    });
  });

  it('turns an unexpected controller rejection into a typed failure', async () => {
    const fixture = createControllerFixture();
    fixture.openDashboard.mockRejectedValueOnce(new Error('dashboard failed'));
    registerOverlayIpc(() => fixture.controller);
    const handler = capturedHandler(IPC_CHANNELS.OPEN_DASHBOARD);

    await expect(Promise.resolve(handler(fixture.query.event, undefined))).resolves.toEqual({
      ok: false,
      message: OPEN_DASHBOARD_FAILURE_MESSAGE,
    });
    expect(fixture.openDashboard).toHaveBeenCalledOnce();
  });

  it('forwards a valid layout report from the trusted query main frame', () => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const request: QueryLayoutRequest = {
      sessionId: 11,
      sequence: 3,
      phase: 'RESULTS',
      resultCount: 3,
      desiredHeight: 344,
      identity: REPORT_IDENTITY,
    };

    const result = capturedHandler(IPC_CHANNELS.REPORT_QUERY_LAYOUT)(
      fixture.query.event,
      request,
    );

    expect(result).toEqual(acceptedAck(11, 3, 344));
    expect(fixture.reportQueryLayout).toHaveBeenCalledOnce();
    expect(fixture.reportQueryLayout).toHaveBeenCalledWith(request);
    expect(fixture.resizeQueryHeight).not.toHaveBeenCalled();
  });

  it('forwards a valid resize request from the trusted query main frame', () => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const request: QueryResizeRequest = {
      type: 'update',
      sessionId: 11,
      sequence: 4,
      deltaY: 24,
      identity: REPORT_IDENTITY,
    };

    const result = capturedHandler(IPC_CHANNELS.RESIZE_QUERY_HEIGHT)(
      fixture.query.event,
      request,
    );

    expect(result).toEqual(acceptedAck(11, 4, 360));
    expect(fixture.resizeQueryHeight).toHaveBeenCalledOnce();
    expect(fixture.resizeQueryHeight).toHaveBeenCalledWith(request);
    expect(fixture.reportQueryLayout).not.toHaveBeenCalled();
  });

  it.each([
    ['fox', (fixture: ReturnType<typeof createControllerFixture>) => fixture.fox.event],
    ['dashboard', (fixture: ReturnType<typeof createControllerFixture>) => fixture.dashboard.event],
    [
      'query subframe',
      () => createSender(7, 'query', { subframe: true }).event,
    ],
    ['untrusted renderer', () => createSender(99, 'query').event],
  ])('rejects layout reports from a %s without calling the controller', (_label, eventFor) => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const request: QueryLayoutRequest = {
      sessionId: 21,
      sequence: 8,
      phase: 'RESULTS',
      resultCount: 3,
      desiredHeight: 420,
      identity: REPORT_IDENTITY,
    };

    const result = capturedHandler(IPC_CHANNELS.REPORT_QUERY_LAYOUT)(eventFor(fixture), request);

    expectRejectedAck(result, { sessionId: 21, sequence: 8 });
    expect(fixture.reportQueryLayout).not.toHaveBeenCalled();
    expect(fixture.resizeQueryHeight).not.toHaveBeenCalled();
  });

  it.each([
    ['fox', (fixture: ReturnType<typeof createControllerFixture>) => fixture.fox.event],
    ['dashboard', (fixture: ReturnType<typeof createControllerFixture>) => fixture.dashboard.event],
    [
      'query subframe',
      () => createSender(7, 'query', { subframe: true }).event,
    ],
    ['untrusted renderer', () => createSender(99, 'query').event],
  ])('rejects resize requests from a %s without calling the controller', (_label, eventFor) => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);
    const request: QueryResizeRequest = {
      type: 'begin',
      sessionId: 22,
      sequence: 9,
      identity: REPORT_IDENTITY,
    };

    const result = capturedHandler(IPC_CHANNELS.RESIZE_QUERY_HEIGHT)(eventFor(fixture), request);

    expectRejectedAck(result, { sessionId: 22, sequence: 9 });
    expect(fixture.resizeQueryHeight).not.toHaveBeenCalled();
    expect(fixture.reportQueryLayout).not.toHaveBeenCalled();
  });

  it('forwards in-range query resize deltas from the trusted query main frame', () => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);

    for (const deltaY of [-4096, 4096]) {
      fixture.resizeQueryHeight.mockClear();
      const accepted = capturedHandler(IPC_CHANNELS.RESIZE_QUERY_HEIGHT)(
        fixture.query.event,
        {
          type: 'update',
          sessionId: 30,
          sequence: 11,
          deltaY,
          identity: REPORT_IDENTITY,
        },
      );
      expect(accepted).toEqual(acceptedAck(30, 11, 360));
      expect(fixture.resizeQueryHeight).toHaveBeenCalledOnce();
      expect(fixture.resizeQueryHeight).toHaveBeenCalledWith({
        type: 'update',
        sessionId: 30,
        sequence: 11,
        deltaY,
        identity: REPORT_IDENTITY,
      });
    }
  });

  it('fails closed for malformed layout and out-of-range resize payloads', () => {
    const fixture = createControllerFixture();
    registerOverlayIpc(() => fixture.controller);

    const layoutResult = capturedHandler(IPC_CHANNELS.REPORT_QUERY_LAYOUT)(
      fixture.query.event,
      {
        sessionId: 30,
        sequence: 10,
        phase: 'RESULTS',
        resultCount: 3,
        desiredHeight: Number.POSITIVE_INFINITY,
      },
    );
    expectRejectedAck(layoutResult, { sessionId: 0, sequence: 0 });
    expect(fixture.reportQueryLayout).not.toHaveBeenCalled();

    for (const deltaY of [-4097, -0.5, 0.5, 4097, Number.POSITIVE_INFINITY, Number.NaN, '12']) {
      const resizeResult = capturedHandler(IPC_CHANNELS.RESIZE_QUERY_HEIGHT)(
        fixture.query.event,
        {
          type: 'update',
          sessionId: 30,
          sequence: 11,
          deltaY,
        },
      );
      expectRejectedAck(resizeResult, { sessionId: 0, sequence: 0 });
    }
    expect(fixture.resizeQueryHeight).not.toHaveBeenCalled();
  });

  it('returns protocol-valid rejected acknowledgements while the controller is unavailable', () => {
    registerOverlayIpc(() => null);
    const query = createSender(7, 'query');
    const layout = capturedHandler(IPC_CHANNELS.REPORT_QUERY_LAYOUT)(query.event, {
      sessionId: 40,
      sequence: 12,
      phase: 'RESULTS',
      resultCount: 3,
      desiredHeight: 360,
        identity: REPORT_IDENTITY,
    });
    const resize = capturedHandler(IPC_CHANNELS.RESIZE_QUERY_HEIGHT)(query.event, {
      type: 'begin',
      sessionId: 40,
      sequence: 13,
      identity: REPORT_IDENTITY,
    });

    expectRejectedAck(layout, { sessionId: 0, sequence: 0 });
    expectRejectedAck(resize, { sessionId: 0, sequence: 0 });
  });

  it('forwards restorePreviousApp only when the Query renderer sends true', () => {
    const fixture = createControllerFixture();
    const dismiss = vi.fn();
    Object.assign(fixture.controller, { dismiss });
    registerOverlayIpc(() => fixture.controller);
    const handler = capturedHandler(IPC_CHANNELS.DISMISS);
    handler(fixture.query.event);
    expect(dismiss).toHaveBeenCalledWith(false);
    handler(fixture.query.event, true);
    expect(dismiss).toHaveBeenCalledWith(true);
    handler(fixture.query.event, 'true');
    expect(dismiss).toHaveBeenLastCalledWith(false);
    handler(createSender(99, 'query').event, true);
    expect(dismiss).toHaveBeenCalledTimes(3);
  });
});
