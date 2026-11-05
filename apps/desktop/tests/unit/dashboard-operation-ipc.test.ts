// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { ProductSession } from '../../src/main/product-session';
import { registerDashboardContentIpc } from '../../src/main/dashboard-content-ipc';
import { dashboardControlPlaneForSession } from '../../src/main/dashboard-control-plane';

const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>());
vi.mock('electron', () => ({
  app: undefined,
  ipcMain: {
    handle: (name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      handlers.set(name, callback);
    },
  },
}));

function dashboardWindow() {
  const frame = { parent: null };
  const dashboard = {
    id: 10,
    mainFrame: frame,
    isDestroyed: () => false,
    getURL: () => 'http://127.0.0.1:5173/?role=dashboard',
    send: vi.fn(),
  } as unknown as WebContents;
  const query = { ...dashboard, id: 1 } as WebContents;
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  return { dashboard, query, event };
}

function session() {
  return {
    view: () => ({
      ok: true,
      enabled: true,
      signedIn: true,
      sessionEpoch: 4,
      userId: 'user-owner',
      role: 'owner',
      authMode: 'mock',
      expiresAt: '2026-11-06T12:00:00.000Z',
      displayName: 'Synthetic',
      job: null,
    }),
    request: vi.fn(async () => ({
      status: 200,
      value: {
        state: 'open',
        accessRevision: 9,
        expiresAt: '2026-11-06T12:00:00.000Z',
        grants: 'open',
        accounts: 'open',
        denyReason: null,
      },
    })),
    subscribe: vi.fn(() => () => undefined),
  } as unknown as ProductSession;
}

it('rejects untrusted senders, child frames, and operation ids before touching state', async () => {
  const { dashboard, query, event } = dashboardWindow();
  registerDashboardContentIpc(session(), () => dashboard, () => 'http://127.0.0.1:5173/');
  const command = handlers.get('dashboard:operation-command')!;
  expect(await command(event(query), { action: 'recover', domain: 'release' }))
    .toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await command(event(dashboard, { parent: {} }), { action: 'recover', domain: 'release' }))
    .toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await command(event(dashboard), {
    action: 'recover',
    domain: 'release',
    operationId: 'forged',
  })).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await command(event(dashboard), { action: 'submit', domain: 'release' }))
    .toMatchObject({ ok: false, code: 'VALIDATION' });
});

it('projects durable status and accepts only domain-level cancel or recovery intent', async () => {
  const { dashboard, event } = dashboardWindow();
  const product = session();
  registerDashboardContentIpc(product, () => dashboard, () => 'http://127.0.0.1:5173/');
  const plane = dashboardControlPlaneForSession(product, null);
  plane.registerRecovery('release', async () => ({ kind: 'unknown' }));
  await plane.submit({
    domain: 'release',
    command: 'publish',
    capability: 'release:publish',
    intent: { title: 'synthetic' },
    execute: async () => ({ kind: 'unknown' }),
  });
  const current = handlers.get('dashboard:operation-current')!;
  const command = handlers.get('dashboard:operation-command')!;
  const projected = await current(event(dashboard)) as {
    ok: boolean;
    views: Array<Record<string, unknown>>;
  };
  expect(projected).toMatchObject({
    ok: true,
    views: [{ domain: 'release', state: 'unknown', canRecover: true }],
  });
  expect(JSON.stringify(projected)).not.toContain('user-owner');
  expect(JSON.stringify(projected)).not.toContain('sessionEpoch');
  expect(await command(event(dashboard), { action: 'recover', domain: 'release' }))
    .toMatchObject({ ok: true, views: [{ domain: 'release', state: 'unknown' }] });
});

it('keeps the operation surface empty outside the mounted product profile', async () => {
  const { dashboard, event } = dashboardWindow();
  registerDashboardContentIpc(null, () => dashboard, () => 'http://127.0.0.1:5173/');
  expect(await handlers.get('dashboard:operation-current')!(event(dashboard)))
    .toEqual({ ok: true, view: null, views: [] });
  expect(await handlers.get('dashboard:operation-current')!(event(dashboard), true))
    .toMatchObject({ ok: false, code: 'VALIDATION', views: [] });
});
