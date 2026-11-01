// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { CustomerAgentApi } from '../../src/shared/contracts';

const electron = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: { on: vi.fn(), removeListener: vi.fn(), invoke: electron.invoke },
}));

it('accepts valid clipboard receipts and rejects invalid or unavailable receipts', async () => {
  await import('../../src/preload/index');
  const exposed = electron.expose.mock.calls.find(call => call[0] === 'customerAgent');
  if (!exposed) throw new Error('Missing overlay preload API');
  const api: CustomerAgentApi = exposed[1];
  electron.invoke.mockResolvedValueOnce({ ok: true, copyGeneration: 3 });
  await expect(api.copyText('合成话术')).resolves.toEqual({ ok: true, copyGeneration: 3 });
  electron.invoke.mockResolvedValueOnce({ ok: true, copyGeneration: -1 });
  await expect(api.copyText('合成话术')).resolves.toEqual({ ok: false, message: '复制失败，请重试' });
  electron.invoke.mockRejectedValueOnce(new Error('IPC unavailable'));
  await expect(api.copyText('合成话术')).resolves.toEqual({ ok: false, message: '复制失败，请重试' });
});
