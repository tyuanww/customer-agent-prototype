// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { ProductSession } from '../../src/main/product-session';
import { ProductHttpError } from '../../src/main/product-http';
import { registerSeatAccountIpc } from '../../src/main/seat-account-ipc';
import { dashboardControlPlaneForSession } from '../../src/main/dashboard-control-plane';

const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>());
vi.mock('electron', () => ({
  app: undefined,
  ipcMain: {
    handle: (name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(name, callback);
    },
    removeHandler: (name: string) => handlers.delete(name),
  },
}));

it('binds account mutations to the current ACL revision and refuses the next command after revocation', async () => {
  const frame = { parent: null };
  const dashboard = {
    id: 1,
    mainFrame: frame,
    isDestroyed: () => false,
    getURL: () => 'http://127.0.0.1:5173/?role=dashboard',
  } as unknown as WebContents;
  let accountsOpen = true;
  const session = {
    view: () => ({
      ok: true,
      enabled: true,
      signedIn: true,
      sessionEpoch: 3,
      userId: 'user-admin',
      role: 'owner',
      authMode: 'mock',
      expiresAt: '2099-01-01T00:00:00.000Z',
      displayName: 'Admin',
      job: null,
    }),
    subscribe: vi.fn(() => () => undefined),
    request: vi.fn(async (_epoch: number, path: string) => {
      if (path === '/v1/access/settings') {
        return {
          status: 200,
          value: {
            state: 'open',
            accessRevision: accountsOpen ? 4 : 5,
            expiresAt: '2099-01-01T00:00:00.000Z',
            grants: 'closed',
            accounts: accountsOpen ? 'open' : 'closed',
            denyReason: accountsOpen ? null : 'REVOKED_GRANT',
          },
        };
      }
      if (path === '/v1/intake/seats') {
        return {
          status: 200,
          value: {
            seat: {
              displayName: 'Synthetic seat',
              username: 'seat-a',
              post: '客服',
              enabled: true,
            },
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    }),
  } as unknown as ProductSession;
  const owned = registerSeatAccountIpc(session, () => dashboard, () => 'http://127.0.0.1:5173/',
    () => true, () => true);
  const command = handlers.get('dashboard:seats-command')!;
  const event = { sender: dashboard, senderFrame: frame } as IpcMainInvokeEvent;
  const intent = {
    action: 'create' as const,
    displayName: 'Synthetic seat',
    username: 'seat-a',
    password: 'not-persisted-in-status',
    post: '客服' as const,
  };
  try {
    await expect(command(event, intent)).resolves.toMatchObject({
      ok: true,
      action: 'create',
      seat: { username: 'seat-a' },
    });
    accountsOpen = false;
    await expect(command(event, { ...intent, username: 'seat-b' })).resolves.toEqual({
      ok: false,
      message: '没有权限，请找人开通。',
    });
    expect(vi.mocked(session.request).mock.calls.filter((call) => call[1] === '/v1/intake/seats')).toHaveLength(1);
    expect(JSON.stringify(dashboardControlPlaneForSession(session, null).currentSync()))
      .not.toContain(intent.password);
  } finally {
    owned.dispose();
  }
});

it('projects a definitive seat refusal as failed instead of an unknown commit', async () => {
  const frame = { parent: null };
  const dashboard = {
    id: 2,
    mainFrame: frame,
    isDestroyed: () => false,
    getURL: () => 'http://127.0.0.1:5173/?role=dashboard',
  } as unknown as WebContents;
  const session = {
    view: () => ({
      ok: true,
      enabled: true,
      signedIn: true,
      sessionEpoch: 4,
      userId: 'user-admin',
      role: 'owner',
      authMode: 'mock',
      expiresAt: '2099-01-01T00:00:00.000Z',
      displayName: 'Admin',
      job: null,
    }),
    subscribe: vi.fn(() => () => undefined),
    request: vi.fn(async (_epoch: number, path: string) => {
      if (path === '/v1/access/settings') {
        return {
          status: 200,
          value: {
            state: 'open',
            accessRevision: 4,
            expiresAt: '2099-01-01T00:00:00.000Z',
            grants: 'closed',
            accounts: 'open',
            denyReason: null,
          },
        };
      }
      throw new ProductHttpError('VALIDATION', 'SEAT_USERNAME_INVALID');
    }),
  } as unknown as ProductSession;
  const owned = registerSeatAccountIpc(
    session,
    () => dashboard,
    () => 'http://127.0.0.1:5173/',
    () => true,
    () => true,
  );
  const command = handlers.get('dashboard:seats-command')!;
  const event = { sender: dashboard, senderFrame: frame } as IpcMainInvokeEvent;
  try {
    await expect(command(event, {
      action: 'create',
      displayName: 'Synthetic seat',
      username: 'invalid user',
      password: 'not-persisted-in-status',
      post: '客服',
    })).resolves.toEqual({
      ok: false,
      message: '登录名只能用字母、数字、下划线或连字符，最长 64 位。',
    });
    expect(dashboardControlPlaneForSession(session, null).currentSync()).toMatchObject([
      { domain: 'accounts', state: 'failed' },
    ]);
  } finally {
    owned.dispose();
  }
});
