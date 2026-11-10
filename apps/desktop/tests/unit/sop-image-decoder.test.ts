// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  native: vi.fn(() => ({ isEmpty: () => false })),
  load: vi.fn((_url: string): Promise<void> => Promise.resolve()),
  decode: vi.fn((): Promise<unknown> => Promise.resolve(true)),
  options: [] as unknown[],
  windows: [] as { closed: boolean }[],
}));
vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: mock.native },
  BrowserWindow: class {
    closed = false;
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn(), executeJavaScript: mock.decode };
    constructor(options: unknown) { mock.options.push(options); mock.windows.push(this); }
    loadURL = mock.load;
    isDestroyed() { return this.closed; }
    destroy() { this.closed = true; }
  },
}));
import { decodeSopImage } from '../../src/main/sop-image-decoder';

beforeEach(() => {
  vi.clearAllMocks(); mock.options.length = 0; mock.windows.length = 0;
  mock.load.mockResolvedValue(); mock.decode.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

it('keeps native PNG decoding without creating another document', async () => {
  expect(await decodeSopImage(Buffer.from('synthetic'), 'image/png', new AbortController().signal)).toBe(true);
  expect(mock.native).toHaveBeenCalledOnce();
  expect(mock.windows).toHaveLength(0);
});
it('decodes GIF in a hidden isolated document and destroys it after success', async () => {
  expect(await decodeSopImage(Buffer.from('GIF89a'), 'image/gif', new AbortController().signal)).toBe(true);
  expect(mock.options).toEqual([{ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }]);
  expect(mock.load.mock.calls[0]?.[0]).toMatch(/^data:text\/html,/);
  expect(mock.decode).toHaveBeenCalledOnce();
  expect(mock.native).not.toHaveBeenCalled();
  expect(mock.windows[0]?.closed).toBe(true);
});
it('rejects a decoder failure and destroys the document', async () => {
  mock.decode.mockRejectedValue(new Error('synthetic image decode failure'));
  expect(await decodeSopImage(Buffer.from('GIF89a'), 'image/gif', new AbortController().signal)).toBe(false);
  expect(mock.windows[0]?.closed).toBe(true);
});
it('discards a pending decoder when its media owner is cancelled', async () => {
  mock.load.mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const result = decodeSopImage(Buffer.from('GIF89a'), 'image/gif', controller.signal);
  controller.abort();
  expect(await result).toBe(false);
  expect(mock.windows[0]?.closed).toBe(true);
  expect(mock.decode).not.toHaveBeenCalled();
});
it('bounds an unresponsive decoder and releases its native window', async () => {
  vi.useFakeTimers(); mock.decode.mockReturnValue(new Promise(() => {}));
  const result = decodeSopImage(Buffer.from('GIF89a'), 'image/gif', new AbortController().signal);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toBe(false);
  expect(mock.windows[0]?.closed).toBe(true);
});
