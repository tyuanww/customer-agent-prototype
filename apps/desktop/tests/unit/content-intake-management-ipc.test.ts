// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerContentIntakeManagementIpc } from '../../src/main/content-intake-management-ipc';
import { ProductHttp, ProductHttpError } from '../../src/main/product-http';
import { ProductSession } from '../../src/main/product-session';
import type { ProductSessionView } from '../../src/shared/product-session';
import { intakeManagementData } from '../fixtures/intake-management-data';
const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>());
const fromWebContents = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents }, dialog: {}, ipcMain: { handle: (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name) } }));
it('rejects non-Dashboard, child frames and extra intent fields before touching a session', async () => {
  const frame = { parent: null };
  const dashboard = { id: 1, mainFrame: frame, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=dashboard' } as unknown as WebContents;
  const owned = registerContentIntakeManagementIpc(null, () => dashboard, () => 'http://127.0.0.1:5173/');
  const event = (sender: WebContents, senderFrame: unknown = frame) => ({ sender, senderFrame }) as IpcMainInvokeEvent;
  try {
    for (const [name, args] of [
      ['dashboard:intake-mode', []],
      ['dashboard:intake-shell-line', []],
      ['dashboard:intake-current', []],
      ['dashboard:intake-command', [{ action: 'list', next: false }]],
    ] as const) {
      const invoke = handlers.get(name)!;
      expect(await invoke(event({ ...dashboard, id: 3 } as WebContents), ...args)).toMatchObject({ code: 'FORBIDDEN' });
      expect(await invoke(event(dashboard, { parent: frame }), ...args)).toMatchObject({ code: 'FORBIDDEN' });
      expect(await invoke(event(dashboard), ...args, {})).toMatchObject({ code: 'VALIDATION' });
      expect(await invoke(event(dashboard), ...args)).toMatchObject(
        name.endsWith('shell-line') ? { ok: true, profileMode: null, contentIntake: null }
          : name.endsWith('mode') ? { enabled: false } : { code: 'UNAVAILABLE' },
      );
    }
    expect(await handlers.get('dashboard:intake-command')!(event(dashboard), { action: 'freeze', operationId: 'forged' })).toMatchObject({ code: 'VALIDATION' });
    for (const command of [
      { action: 'upload-choose', path: '/private/arbitrary.xlsx' },
      { action: 'upload-save-report', url: 'https://outside.example/report' },
      { action: 'upload-submit', preparerSelection: 'choice', editorSelections: ['choice'], confirmed: true, actor: 'forged' },
      { action: 'upload-retry', operationId: 'replace-original' },
      { action: 'revise', expectedPriorKey: { candidateId: 'other', version: 1, digest: 'forged' } },
      { action: 'cancel-candidate', key: { candidateId: 'other', version: 1 } },
    ]) expect(await handlers.get('dashboard:intake-command')!(event(dashboard), command)).toMatchObject({ code: 'VALIDATION' });
  } finally { owned.dispose(); }
  expect(handlers.size).toBe(0);
});

it('projects only synthetic-local and faq-v2 when an intake session exists', async () => {
  const frame = { parent: null };
  const dashboard = { id: 1, mainFrame: frame, isDestroyed: () => false, getURL: () => 'http://127.0.0.1:5173/?role=dashboard' } as unknown as WebContents;
  const owned = registerContentIntakeManagementIpc({} as never, () => dashboard, () => 'http://127.0.0.1:5173/', {
    mode: 'synthetic-local',
    apiOrigin: 'http://127.0.0.1:43100',
    identityOrigin: 'http://127.0.0.1:43101',
    contentIntake: 'faq-v2',
  });
  const event = { sender: dashboard, senderFrame: frame } as IpcMainInvokeEvent;
  try {
    const line = await handlers.get('dashboard:intake-shell-line')!(event);
    expect(line).toEqual({ ok: true, profileMode: 'synthetic-local', contentIntake: 'faq-v2' });
    expect(JSON.stringify(line)).not.toMatch(/apiOrigin|identityOrigin|password|DATABASE|secret|43100/i);
    expect(await handlers.get('dashboard:intake-mode')!(event)).toEqual({ ok: true, enabled: true });
  } finally { owned.dispose(); }
});

it('projects a failed batch read after invalidation until retry or a session change', async () => {
  const frame = { parent: null };
  const send = vi.fn();
  const dashboard = { id: 1, mainFrame: frame, isDestroyed: () => false, once: vi.fn(), send,
    getURL: () => 'http://127.0.0.1:5173/?role=dashboard' } as unknown as WebContents;
  fromWebContents.mockReturnValue({ isDestroyed: () => false, on: vi.fn() });
  const session = new ProductSession(new ProductHttp('http://127.0.0.1:43100'),
    { read: () => null, write: () => undefined, clear: () => undefined }, { open: async () => undefined });
  let sessionView: ProductSessionView = { ok: true, enabled: true, signedIn: true, sessionEpoch: 1, userId: 'synthetic',
    role: 'coach', authMode: 'mock', displayName: '合成审核员', expiresAt: '2099-01-01T00:00:00Z', job: null };
  const listeners = new Set<Parameters<ProductSession['subscribe']>[0]>();
  vi.spyOn(session, 'view').mockImplementation(() => sessionView);
  vi.spyOn(session, 'subscribe').mockImplementation(listener => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  });
  const data = intakeManagementData();
  let unavailable: 'authorization' | 'candidates' | null = null;
  const request = vi.spyOn(session, 'request').mockImplementation(async (_epoch, path) => {
    if (unavailable && path.startsWith(`/v1/intake/${unavailable}?`)) throw new ProductHttpError('UNAVAILABLE');
    return { status: 200, value: data.respond(path) };
  });
  const owned = registerContentIntakeManagementIpc(session, () => dashboard, () => 'http://127.0.0.1:5173/');
  const event = { sender: dashboard, senderFrame: frame } as IpcMainInvokeEvent;
  const list = () => handlers.get('dashboard:intake-command')!(event, { action: 'list', next: false });
  const current = () => handlers.get('dashboard:intake-current')!(event);
  try {
    expect(await list()).toMatchObject({ ok: true, view: { candidates: [expect.anything()] } });
    unavailable = 'candidates';
    expect(await list()).toMatchObject({ ok: false, code: 'UNAVAILABLE', message: '资料批次暂时无法读取。' });
    expect(send).toHaveBeenCalledWith('dashboard:intake-invalidated');
    const calls = request.mock.calls.length;
    expect(await current()).toMatchObject({ ok: false, code: 'UNAVAILABLE', message: '资料批次暂时无法读取。',
      view: { signedIn: true, authorized: false, candidates: [], batchListFailure: { stage: 'batches', retryFirstBatchPage: true } } });
    expect(request).toHaveBeenCalledTimes(calls);
    unavailable = null;
    expect(await list()).toMatchObject({ ok: true, view: { candidates: [expect.anything()] } });
    expect(await current()).toMatchObject({ ok: true });
    unavailable = 'authorization';
    expect(await list()).toMatchObject({ ok: false, code: 'UNAVAILABLE', message: '资料权限暂时无法读取。' });
    expect(await current()).toMatchObject({ ok: false, message: '资料权限暂时无法读取。',
      view: { batchListFailure: { stage: 'access', retryFirstBatchPage: true } } });
    sessionView = { ...sessionView, sessionEpoch: 2, userId: 'another-synthetic' };
    listeners.forEach(listener => listener(sessionView));
    expect(await current()).toMatchObject({ ok: true, view: { signedIn: true, authorized: false, candidates: [] } });
  } finally { owned.dispose(); }
});
