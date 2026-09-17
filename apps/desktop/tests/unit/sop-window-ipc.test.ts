import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerSopWindowIpc } from '../../src/main/sop-window-ipc';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import type { OverlayController } from '../../src/main/overlay-controller';
import type { SopWindowController } from '../../src/main/sop-window-controller';
import type { OverlayRole } from '../../src/shared/overlay-events';

type CapturedHandler = (event: IpcMainInvokeEvent, ...payload: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, CapturedHandler>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: CapturedHandler) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.handle },
}));

const DEV = 'http://127.0.0.1:5173/';

function sender(id: number, role: OverlayRole | 'sop' | 'dashboard') {
  const mainFrame = { parent: null };
  const webContents = {
    id,
    isDestroyed: () => false,
    getURL: () => `${DEV}?role=${role}`,
    mainFrame,
  } as unknown as WebContents;
  return {
    webContents,
    event: { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent,
  };
}

describe('SOP window IPC sender matrix', () => {
  const query = sender(7, 'query');
  const fox = sender(8, 'fox');
  const dashboard = sender(9, 'dashboard');
  const sop = sender(11, 'sop');
  const open = vi.fn(async () => ({ ok: true as const }));
  const entryAvailable = vi.fn(() => true);
  const resumeAvailable = vi.fn(() => false);
  const chooseEdge = vi.fn(() => ({ ok: true as const }));
  const copyCurrent = vi.fn(() => ({ ok: true as const }));

  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.handlers.clear();
    const overlay = {
      rendererDevServerUrl: DEV,
      trustedContents: () => [query.webContents, fox.webContents],
      overlayRoleOf: (contents: WebContents) => {
        if (contents.id === 7) return 'query';
        if (contents.id === 8) return 'fox';
        return null;
      },
    } as unknown as OverlayController;
    const sopController = {
      sopContents: () => sop.webContents,
      isSopContents: (contents: WebContents) => contents.id === sop.webContents.id,
      open,
      entryAvailable,
      resumeAvailable,
      chooseEdge,
      copyCurrent,
    } as unknown as SopWindowController;
    registerSopWindowIpc({
      getOverlay: () => overlay,
      getSop: () => sopController,
    });
  });

  function handler(channel: string): CapturedHandler {
    const next = electronMocks.handlers.get(channel);
    expect(next).toBeTypeOf('function');
    return next as CapturedHandler;
  }

  it('lets Query open and ask entry-available, and denies fox or dashboard', async () => {
    await expect(handler(IPC_CHANNELS.SOP_WINDOW_OPEN)(query.event, 'allergy-aftersale-demo')).resolves.toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith('allergy-aftersale-demo');
    expect(handler(IPC_CHANNELS.SOP_WINDOW_ENTRY_AVAILABLE)(query.event)).toBe(true);
    expect(handler(IPC_CHANNELS.SOP_WINDOW_RESUME_AVAILABLE)(query.event)).toBe(false);

    await expect(handler(IPC_CHANNELS.SOP_WINDOW_OPEN)(fox.event, 'allergy-aftersale-demo')).resolves.toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    await expect(handler(IPC_CHANNELS.SOP_WINDOW_OPEN)(dashboard.event, 'allergy-aftersale-demo')).resolves.toMatchObject({ ok: false });
    expect(handler(IPC_CHANNELS.SOP_WINDOW_ENTRY_AVAILABLE)(fox.event)).toBe(false);
    expect(handler(IPC_CHANNELS.SOP_WINDOW_ENTRY_AVAILABLE)(sop.event)).toBe(false);
    expect(handler(IPC_CHANNELS.SOP_WINDOW_RESUME_AVAILABLE)(fox.event)).toBe(false);
  });

  it('lets only the SOP window choose edges or copy', () => {
    expect(handler(IPC_CHANNELS.SOP_WINDOW_CHOOSE_EDGE)(sop.event, 'has-photo')).toEqual({ ok: true });
    expect(chooseEdge).toHaveBeenCalledWith('has-photo');
    expect(handler(IPC_CHANNELS.SOP_WINDOW_CHOOSE_EDGE)(query.event, 'has-photo')).toMatchObject({ ok: false });
    expect(handler(IPC_CHANNELS.SOP_WINDOW_COPY_CURRENT)(sop.event)).toEqual({ ok: true });
    expect(handler(IPC_CHANNELS.SOP_WINDOW_COPY_CURRENT)(query.event)).toMatchObject({ ok: false });
  });
});
