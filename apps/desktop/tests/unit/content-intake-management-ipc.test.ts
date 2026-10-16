// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerContentIntakeManagementIpc } from '../../src/main/content-intake-management-ipc';
const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>());
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, ipcMain: { handle: (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name) } }));
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
