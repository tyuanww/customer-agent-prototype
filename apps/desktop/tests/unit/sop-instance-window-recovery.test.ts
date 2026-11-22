// @vitest-environment node
import type { WebContents } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductHttpError } from '../../src/main/product-http';
import { SopInstanceWindows } from '../../src/main/sop-instance-windows';
import { SopUnifiedPort, type SopUnifiedSession } from '../../src/main/sop-unified-port';
import { SopUnifiedRuntime, type SopCandidateOpening } from '../../src/main/sop-unified-runtime';
import { SopWindowController } from '../../src/main/sop-window-controller';
import type { ProductSessionView } from '../../src/shared/product-session';
import { isSopUnifiedProjection } from '../../src/shared/sop-unified';
import { unifiedFixture } from '../support/sop-unified-fixture';

const native = vi.hoisted(() => {
  function createWindow(id: number) {
    let bounds = { x: 0, y: 0, width: 600, height: 240 };
    let title = '';
    let visible = false, destroyed = false;
    const closed = new Set<() => void>();
    return {
      webContents: { id, isDestroyed: () => destroyed, send: vi.fn(), setBackgroundThrottling: vi.fn() },
      on: (event: string, listener: () => void) => { if (event === 'closed') closed.add(listener); },
      getTitle: () => title,
      setTitle: (value: string) => { title = value; },
      isVisible: () => visible,
      isDestroyed: () => destroyed,
      getBounds: () => bounds,
      setBounds: (value: typeof bounds) => { bounds = { ...value, height: Math.max(39, value.height) }; },
      showInactive: () => { visible = true; },
      show: () => { visible = true; },
      hide: () => { visible = false; },
      moveTop: vi.fn(),
      focus: vi.fn(),
      destroy: () => {
        if (destroyed) return;
        visible = false; destroyed = true;
        for (const listener of closed) listener();
      },
    };
  }
  return { windows: [] as ReturnType<typeof createWindow>[], createWindow, load: vi.fn<() => Promise<'loaded'>>() };
});
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), clipboard: {}, nativeImage: {},
  screen: { on: vi.fn(), removeListener: vi.fn() } }));
vi.mock('../../src/main/overlay-chrome-window.ts', () => ({
  createOverlayChromeWindow: () => {
    const window = native.createWindow(native.windows.length + 1);
    native.windows.push(window);
    return window;
  },
}));
vi.mock('../../src/main/overlay-renderer-loader.ts', () => ({ loadRenderer: native.load }));
vi.mock('../../src/main/window-security.ts', () => ({ lockRendererWindow: () => {} }));

beforeEach(() => { native.windows.length = 0; native.load.mockReset().mockResolvedValue('loaded'); });
afterEach(() => { vi.useRealTimers(); });

function holdRendererLoad() {
  let load!: () => void;
  native.load.mockReturnValueOnce(new Promise(resolve => { load = () => resolve('loaded'); }));
  return load;
}

function setup() {
  const { result, entitlement } = unifiedFixture();
  result.media = [];
  let sessionView: ProductSessionView = {
    ok: true, enabled: true, signedIn: true, sessionEpoch: 1, userId: 'synthetic-user',
    role: 'agent', authMode: 'mock', expiresAt: entitlement.validUntil, displayName: '合成坐席', job: null,
  };
  const listeners = new Set<Parameters<SopUnifiedSession['subscribe']>[0]>();
  const request = vi.fn<SopUnifiedSession['request']>().mockImplementation(async (_epoch, path) => {
    if (path === '/v1/intake/sop/continuations/close') return { status: 204, value: null };
    throw new ProductHttpError('UNAVAILABLE');
  });
  const session: SopUnifiedSession = {
    view: () => sessionView, request, onExplicitLogout: () => () => {},
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const manager = new SopInstanceWindows(session, (instance, candidate) => {
    const controller = new SopWindowController({ instance, preloadPath: '/tmp/unused-preload', queryBounds: () => null,
      workArea: () => ({ x: 0, y: 0, width: 1200, height: 900 }), sessionRole: () => sessionView.role });
    controller.setQueryRuntime(new SopUnifiedRuntime(new SopUnifiedPort(session, () => false, 'v12'), vi.fn(), async () => ({
      selection: { shopId: entitlement.shopId, productIds: [], scenarioIds: [] }, entitlement, isCurrent: () => true,
    }), candidate));
    return controller;
  });
  const candidate: SopCandidateOpening = {
    selection: { shopId: entitlement.shopId, productIds: [], scenarioIds: [] }, entitlement, sessionEpoch: 1,
    ready: { status: 'ready', request_id: '11111111-1111-4111-8111-111111111111', release_id: entitlement.releaseId,
      lease_expires_at: new Date(Date.now() + 1000).toISOString(), result, reasons: [] },
  };
  const controller = (index = 0) => {
    const window = native.windows[index]!;
    const contents = window.webContents as unknown as WebContents;
    const controller = manager.fromContents(contents);
    if (!controller) throw new Error('missing native window registration');
    return { window, contents, controller };
  };
  return { manager, request, candidate, controller, loseSession() {
    sessionView = { ...sessionView, signedIn: false, sessionEpoch: 2, role: null, userId: null };
    for (const listener of listeners) listener(sessionView);
  } };
}

it.each(['expired C', 'session loss'] as const)('discards the candidate window after %s during renderer load', async reason => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const h = setup();
  const load = holdRendererLoad();
  try {
    const opening = h.manager.openCandidate(h.candidate);
    const { window, contents } = h.controller();
    if (reason === 'expired C') vi.setSystemTime(Date.now() + 1001);
    else h.loseSession();
    load();
    await expect(opening).resolves.toBe('unavailable');
    expect(h.request).not.toHaveBeenCalled();
    expect(h.manager.resumeEntries()).toEqual([]);
    expect(window.isDestroyed()).toBe(true);
    expect(h.manager.fromContents(contents)).toBeNull();
  } finally { load(); h.manager.destroy(); }
});

it('hides a candidate with an unknown D receipt and keeps it available to resume', async () => {
  const h = setup();
  try {
    await h.manager.openCandidate(h.candidate);
    expect(h.request).toHaveBeenCalledWith(1, '/v1/intake/sop/check', expect.objectContaining({ body: expect.objectContaining({
      action: 'open', queryRequestId: h.candidate.ready.request_id,
    }) }));
    const { controller, window, contents } = h.controller();
    controller.close();
    expect(window.isVisible()).toBe(false);
    expect(h.manager.fromContents(contents)).toBe(controller);
    const [entry] = h.manager.resumeEntries();
    expect(entry?.label).toBe('#01 恢复 SOP 流程');
    entry?.resume();
    expect(window.isVisible()).toBe(true);
  } finally { h.manager.destroy(); }
});

it('keeps a hidden manual draft available to reopen without a session', async () => {
  const h = setup();
  try {
    h.loseSession();
    await h.manager.open('sop-query');
    const { controller, window, contents } = h.controller();
    controller.close();
    expect(window.isVisible()).toBe(false);
    expect(h.manager.fromContents(contents)).toBe(controller);
    await h.manager.open('sop-query');
    expect(native.windows).toHaveLength(1);
    expect(window.isVisible()).toBe(true);
  } finally { h.manager.destroy(); }
});

it('centers the first measured SOP content and keeps the top on later layouts and reopen', async () => {
  const h = setup();
  try {
    await h.manager.open('sop-query');
    const { controller, window } = h.controller();
    expect(window.getBounds()).toEqual({ x: 16, y: 330, width: 600, height: 240 });
    controller.reportLayout({ sessionId: 1, sequence: 1, desiredHeight: 240 });
    const content = { sessionId: 1, sequence: 2, desiredHeight: 620, contentReady: true } as const;
    controller.reportLayout(content);
    expect(window.getBounds()).toEqual({ x: 16, y: 140, width: 600, height: 620 });
    controller.close();
    await h.manager.open('sop-query');
    controller.reportLayout({ ...content, sequence: 3, desiredHeight: 420 });
    expect(window.getBounds()).toEqual({ x: 16, y: 140, width: 600, height: 420 });
  } finally { h.manager.destroy(); }
});

it.each(['drag', 'resize'])('honors a title %s before the first content layout', async gesture => {
  const h = setup();
  try {
    await h.manager.open('sop-query');
    const { controller, window } = h.controller();
    if (gesture === 'drag') controller.moveBy(40, -90, true);
    else {
      controller.resize({ type: 'begin', sessionId: 1, sequence: 1, direction: 'top-left' });
      controller.resize({ type: 'end', sessionId: 1, sequence: 1, deltaX: -8, deltaY: -90 });
    }
    const content = { sessionId: 1, sequence: 1, desiredHeight: 620, contentReady: true } as const;
    controller.reportLayout(content);
    expect(window.getBounds()).toEqual(gesture === 'drag'
      ? { x: 56, y: 240, width: 600, height: 620 }
      : { x: 8, y: 240, width: 608, height: 330 });
  } finally { h.manager.destroy(); }
});

it('reserves non-overlapping bookmark slots when the native minimum height exceeds 32', async () => {
  const h = setup();
  h.request.mockImplementation(async (_epoch, path, options) => {
    if (path.endsWith('/close')) return { status: 204, value: null };
    const { continuationId } = options?.body as { continuationId: string };
    return { status: 200, value: { continuationId, entitlement: h.candidate.entitlement } };
  });
  try {
    for (const index of [0, 1]) {
      await expect(h.manager.openCandidate(h.candidate)).resolves.toBe('opened');
      expect(h.controller(index).controller.bookmark('park')).toEqual({ ok: true });
    }
    const first = h.controller();
    const second = h.controller(1);
    expect(h.manager.resumeEntries().map(entry => entry.label)).toEqual([
      '#01 合成完整任务图', '#02 合成完整任务图',
    ]);
    expect(first.window.getTitle()).toBe('#01 合成完整任务图');
    expect(second.window.getTitle()).toBe('#02 合成完整任务图');
    expect(first.window.webContents.send).toHaveBeenCalledWith('sop-window:chrome', {
      kind: 'parked', caseNumber: 1, name: '合成完整任务图',
    });
    expect(second.window.webContents.send).toHaveBeenCalledWith('sop-window:chrome', {
      kind: 'parked', caseNumber: 2, name: '合成完整任务图',
    });
    const firstBounds = first.window.getBounds();
    const secondBounds = second.window.getBounds();
    expect(firstBounds).toMatchObject({ x: 0, width: 182, height: 39 });
    expect(secondBounds).toMatchObject({ x: 0, width: 182, height: 39 });
    expect(Math.abs(firstBounds.y - secondBounds.y)).toBeGreaterThanOrEqual(39);
    expect(first.controller.bookmark('restore')).toEqual({ ok: true });
    expect(first.window.getBounds()).toEqual({ x: 16, y: 330, width: 600, height: 240 });
  } finally { h.manager.destroy(); }
});

it('uses a fresh case number when the same native window starts a new case', async () => {
  const h = setup();
  const shops = vi.spyOn(SopUnifiedPort.prototype, 'shops').mockResolvedValue([h.candidate.selection.shopId]);
  const query = vi.spyOn(SopUnifiedPort.prototype, 'query').mockImplementation(async input => ({
    ...h.candidate.ready, request_id: input.request_id, lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
  }));
  const check = vi.spyOn(SopUnifiedPort.prototype, 'check').mockImplementation(async input => ({
    continuationId: input.continuationId!, entitlement: h.candidate.entitlement,
  }));
  try {
    await expect(h.manager.open('sop-query')).resolves.toEqual({ ok: true });
    const { controller, window, contents } = h.controller();
    const projection: unknown = window.webContents.send.mock.lastCall?.[1];
    if (!isSopUnifiedProjection(projection) || !projection.shops[0]) throw new Error('Missing SOP shop projection');
    await expect(controller.unifiedCommand({
      kind: 'query', shopKey: projection.shops[0].key, group: '品质售后SOP', text: '合成办理',
    })).resolves.toEqual({ ok: true });
    expect(window.getTitle()).toBe('#01 合成完整任务图');
    await expect(controller.restart()).resolves.toEqual({ ok: true });
    expect(h.manager.fromContents(contents)).toBe(controller);
    expect(native.windows).toHaveLength(1);
    expect(h.manager.resumeEntries().map(entry => entry.label)).toEqual(['#02 合成完整任务图']);
    expect(window.getTitle()).toBe('#02 合成完整任务图');
  } finally {
    h.manager.destroy();
    shops.mockRestore(); query.mockRestore(); check.mockRestore();
  }
});
