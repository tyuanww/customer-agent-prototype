// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerWorkbenchModeIpc } from '../../src/main/workbench-mode-ipc';
import { isSopManualImageProjections } from '../../src/shared/sop-window';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), removeHandler: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
  removeHandler: mocks.removeHandler,
} }));

const devUrl = 'http://127.0.0.1:5173/';
function sender(id: number) {
  const frame = { parent: null };
  const contents = { id, mainFrame: frame, isDestroyed: () => false, getURL: () => `${devUrl}?role=dashboard` } as unknown as WebContents;
  return { contents, event: { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent };
}
beforeEach(() => { mocks.handlers.clear(); mocks.removeHandler.mockClear(); });

it('serves only Main-generated synthetic images to the Dashboard main frame, with no arguments', () => {
  const dashboard = sender(1), other = sender(2);
  const registered = registerWorkbenchModeIpc(null, () => dashboard.contents, () => devUrl);
  const handle = mocks.handlers.get('dashboard:sop-manual-images')!;
  const result = handle(dashboard.event);
  expect(isSopManualImageProjections(result)).toBe(true);
  if (!isSopManualImageProjections(result)) throw new Error('invalid projection');
  expect(result.find(item => item.nodeId === 'collect')?.images).toHaveLength(1);
  expect(handle(other.event)).toBeNull();
  expect(handle({ ...dashboard.event, senderFrame: { parent: dashboard.contents.mainFrame } } as IpcMainInvokeEvent)).toBeNull();
  expect(handle(dashboard.event, { dataUrl: 'file:///tmp/secret' })).toBeNull();
  registered.dispose();
  expect(mocks.removeHandler).toHaveBeenCalledWith('dashboard:sop-manual-images');
});

it('returns no synthetic images for product, FAQ or legacy profiles', () => {
  const dashboard = sender(1);
  for (const profile of [{ mode: 'product-remote' }, { mode: 'synthetic-local', contentIntake: 'faq-v2' }, { mode: 'synthetic-local' }] as const) {
    registerWorkbenchModeIpc(profile as Parameters<typeof registerWorkbenchModeIpc>[0], () => dashboard.contents, () => devUrl);
    expect(mocks.handlers.get('dashboard:sop-manual-images')!(dashboard.event)).toBeNull();
  }
});
