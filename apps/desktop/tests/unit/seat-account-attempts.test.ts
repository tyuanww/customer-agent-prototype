// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { ProductSession } from '../../src/main/product-session';
import { ProductHttpError } from '../../src/main/product-http';
import { registerSeatAccountIpc } from '../../src/main/seat-account-ipc';
import { dashboardControlPlaneForSession } from '../../src/main/dashboard-control-plane';

const mock = vi.hoisted(() => ({
  userData: undefined as string | undefined,
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => mock.userData },
  ipcMain: {
    handle: (name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => mock.handlers.set(name, callback),
    removeHandler: (name: string) => mock.handlers.delete(name),
  },
}));
afterEach(() => { mock.userData = undefined; });

function fixture(write: (password: string) => Promise<void> = async () => undefined) {
  const frame = { parent: null };
  const dashboard = { id: 1, mainFrame: frame, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=dashboard' } as unknown as WebContents;
  const writes: string[] = [];
  let accountsOpen = true;
  const session = {
    view: () => ({ ok: true, enabled: true, signedIn: true, sessionEpoch: 3, userId: 'synthetic-admin', role: 'owner', authMode: 'mock', expiresAt: '2099-01-01T00:00:00.000Z', displayName: 'Admin', job: null }),
    subscribe: vi.fn(() => () => undefined),
    request: vi.fn(async (_epoch: number, path: string, options: { body?: { password?: string } }) => {
      if (path === '/v1/access/settings') return { status: 200, value: { state: 'open', accessRevision: accountsOpen ? 4 : 5, expiresAt: '2099-01-01T00:00:00.000Z', grants: 'closed', accounts: accountsOpen ? 'open' : 'closed', denyReason: null } };
      if (/^\/v1\/intake\/seats\/(synthetic-seat|other-seat)\/password$/.test(path)) {
        const password = options.body?.password;
        if (typeof password !== 'string') throw new Error('missing synthetic password');
        writes.push(password);
        await write(password);
        return { status: 200, value: {} };
      }
      throw new Error(`unexpected path ${path}`);
    }),
  } as unknown as ProductSession;
  const owned = registerSeatAccountIpc(session, () => dashboard, () => 'http://127.0.0.1:5173/', () => true, () => accountsOpen);
  const command = mock.handlers.get('dashboard:seats-command')!;
  const event = { sender: dashboard, senderFrame: frame } as IpcMainInvokeEvent;
  return {
    session, writes, dispose: owned.dispose,
    revoke: () => { accountsOpen = false; },
    reset: (password: string, username = 'synthetic-seat') => command(event, { action: 'reset', username, password }),
  };
}

it('applies separately confirmed A/B/A resets with distinct non-secret persistent identities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seat-attempts-'));
  mock.userData = directory;
  const f = fixture();
  try {
    for (const password of ['fixture-password-A', 'fixture-password-B', 'fixture-password-A']) {
      await expect(f.reset(password)).resolves.toMatchObject({ ok: true });
    }
    expect(f.writes).toEqual(['fixture-password-A', 'fixture-password-B', 'fixture-password-A']);
    const saved = await readFile(join(directory, 'dashboard-operations.json'), 'utf8');
    const records = JSON.parse(saved).records;
    expect(records).toHaveLength(3);
    expect(new Set(records.map((record: { envelope: { requestHash: string } }) => record.envelope.requestHash)).size).toBe(3);
    expect(records.every((record: { status: { state: string } }) => record.status.state === 'committed')).toBe(true);
    expect(saved).not.toContain('fixture-password');
  } finally { f.dispose(); await rm(directory, { recursive: true, force: true }); }
});

it('joins an identical in-flight confirmation and refuses a conflicting concurrent reset', async () => {
  let complete!: () => void;
  const f = fixture(() => new Promise<void>(resolve => { complete = resolve; }));
  try {
    const first = f.reset('fixture-password-A');
    await vi.waitFor(() => expect(f.writes).toHaveLength(1));
    const duplicate = f.reset('fixture-password-A');
    await expect(f.reset('fixture-password-B', ' synthetic-seat ')).resolves.toMatchObject({ ok: false, message: expect.stringContaining('还未确认') });
    f.revoke();
    complete();
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(duplicate).resolves.toMatchObject({ ok: true });
    await expect(f.reset('fixture-password-A')).resolves.toMatchObject({ ok: false });
    expect(f.writes).toEqual(['fixture-password-A']);
  } finally { f.dispose(); }
});

it('keeps a lost response unknown across restart and never replaces it with a new successful command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seat-unknown-'));
  mock.userData = directory;
  const f = fixture(async password => {
    if (password === 'fixture-password-A') throw new ProductHttpError('UNAVAILABLE');
  });
  try {
    await expect(f.reset('fixture-password-A')).resolves.toMatchObject({ ok: false, message: expect.stringContaining('还未确认') });
    const plane = dashboardControlPlaneForSession(f.session, directory);
    const original = plane.currentSync()[0];
    expect(original).toMatchObject({ domain: 'accounts', state: 'unknown', canRecover: true });
    await expect(plane.recover('accounts')).resolves.toMatchObject({ operationId: original?.operationId, state: 'unknown' });
    await expect(f.reset('fixture-password-B')).resolves.toMatchObject({ ok: false, message: expect.stringContaining('还未确认') });
    await expect(f.reset('fixture-password-B', 'other-seat')).resolves.toMatchObject({ ok: true });
    expect(f.writes).toEqual(['fixture-password-A', 'fixture-password-B']);
    f.dispose();
    const restarted = fixture();
    try {
      await expect(restarted.reset('fixture-password-B')).resolves.toMatchObject({ ok: false, message: expect.stringContaining('还未确认') });
      await expect(restarted.reset('fixture-password-B', 'other-seat')).resolves.toMatchObject({ ok: true });
      expect(restarted.writes).toEqual(['fixture-password-B']);
      expect(dashboardControlPlaneForSession(restarted.session, directory).currentSync()).toEqual(expect.arrayContaining([
        expect.objectContaining({ operationId: original?.operationId, state: 'unknown' }),
      ]));
    } finally { restarted.dispose(); }
  } finally { f.dispose(); await rm(directory, { recursive: true, force: true }); }
});
