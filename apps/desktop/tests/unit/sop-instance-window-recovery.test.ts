// @vitest-environment node
import type { WebContents } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductHttpError } from '../../src/main/product-http';
import { SopInstanceWindows } from '../../src/main/sop-instance-windows';
import { SopUnifiedPort, type SopUnifiedSession } from '../../src/main/sop-unified-port';
import { SopUnifiedRuntime, type SopCandidateOpening } from '../../src/main/sop-unified-runtime';
import { SopWindowController } from '../../src/main/sop-window-controller';
import type { ProductSessionView } from '../../src/shared/product-session';
import { unifiedFixture } from '../support/sop-unified-fixture';

const native = vi.hoisted(() => {
  function createWindow() {
    let bounds = { x: 0, y: 0, width: 600, height: 240 };
    let visible = false, destroyed = false;
    const closed = new Set<() => void>();
    return {
      webContents: { id: 1, isDestroyed: () => destroyed, send: vi.fn(), setBackgroundThrottling: vi.fn() },
      on: (_event: 'closed', listener: () => void) => closed.add(listener),
      isVisible: () => visible,
      isDestroyed: () => destroyed,
      getBounds: () => bounds,
      setBounds: (value: typeof bounds) => { bounds = value; },
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
    const window = native.createWindow();
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
    controller.setQueryRuntime(new SopUnifiedRuntime(new SopUnifiedPort(session, () => false, 'v12'), vi.fn(), undefined, candidate));
    return controller;
  });
  const candidate: SopCandidateOpening = {
    selection: { shopId: entitlement.shopId, productIds: [], scenarioIds: [] }, entitlement, sessionEpoch: 1,
    ready: { status: 'ready', request_id: '11111111-1111-4111-8111-111111111111', release_id: entitlement.releaseId,
      lease_expires_at: new Date(Date.now() + 1000).toISOString(), result, reasons: [] },
  };
  const controller = () => {
    const window = native.windows[0]!;
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
    expect(entry?.label).toBe('恢复 SOP 流程');
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
