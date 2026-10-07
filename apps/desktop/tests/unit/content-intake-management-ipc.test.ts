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
    for (const [name, args] of [['dashboard:intake-mode', []], ['dashboard:intake-current', []], ['dashboard:intake-command', [{ action: 'list', next: false }]]] as const) {
      const invoke = handlers.get(name)!;
      expect(await invoke(event({ ...dashboard, id: 3 } as WebContents), ...args)).toMatchObject({ code: 'FORBIDDEN' });
      expect(await invoke(event(dashboard, { parent: frame }), ...args)).toMatchObject({ code: 'FORBIDDEN' });
      expect(await invoke(event(dashboard), ...args, {})).toMatchObject({ code: 'VALIDATION' });
      expect(await invoke(event(dashboard), ...args)).toMatchObject(name.endsWith('mode') ? { enabled: false } : { code: 'UNAVAILABLE' });
    }
    expect(await handlers.get('dashboard:intake-command')!(event(dashboard), { action: 'freeze', operationId: 'forged' })).toMatchObject({ code: 'VALIDATION' });
  } finally { owned.dispose(); }
  expect(handlers.size).toBe(0);
});
