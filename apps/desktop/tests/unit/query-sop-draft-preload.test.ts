// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { CustomerAgentApi } from '../../src/shared/contracts';

const electron = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: { on: vi.fn(), removeListener: vi.fn(), invoke: electron.invoke },
}));

it('allows only validated, task-scoped draft calls and fails closed on invalid responses', async () => {
  await import('../../src/preload/index');
  const exposed = electron.expose.mock.calls.find(call => call[0] === 'customerAgent');
  if (!exposed) throw new Error('Missing overlay preload API');
  const api: CustomerAgentApi = exposed[1];
  const drafts = api.sopWindow;
  if (!drafts?.draftCurrent || !drafts.draftStart || !drafts.draftUpdate || !drafts.draftDiscard) throw new Error('Missing draft API');

  const identity = { taskId: 'synthetic-task', hostEpoch: 2 };
  const draft = { draftId: 3, revision: 4, initialName: null, value: '合成草稿', sequence: 1 };
  electron.invoke.mockResolvedValueOnce({ ok: true, draft });
  await expect(drafts.draftCurrent(identity)).resolves.toEqual({ ok: true, draft });
  expect(electron.invoke).toHaveBeenLastCalledWith('query-sop:draft-current', identity);

  electron.invoke.mockResolvedValueOnce({ ok: true, draft: { ...draft, draftId: -1 } });
  await expect(drafts.draftStart({ ...identity, revision: 4 })).resolves.toEqual({ ok: false });
  await expect(drafts.draftUpdate({ ...identity, draftId: 3, sequence: 2, value: 'x'.repeat(257) })).resolves.toBe(false);
  expect(electron.invoke).toHaveBeenCalledTimes(2);

  electron.invoke.mockRejectedValueOnce(new Error('disconnected'));
  await expect(drafts.draftDiscard({ ...identity, draftId: 3 })).resolves.toBe(false);
});
