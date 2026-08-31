import { describe, expect, it, vi } from 'vitest';
import { loadRenderer } from '../../src/main/overlay-renderer-loader';

type LoaderWindow = Parameters<typeof loadRenderer>[0];

function createWindow(options: {
  loadUrl?: () => Promise<void>;
  loadFile?: () => Promise<void>;
  isDestroyed?: () => boolean;
} = {}): {
  win: LoaderWindow;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
} {
  const loadURL = vi.fn(options.loadUrl ?? (async () => undefined));
  const loadFile = vi.fn(options.loadFile ?? (async () => undefined));
  return {
    win: {
      isDestroyed: options.isDestroyed ?? (() => false),
      loadURL,
      loadFile,
    } as unknown as LoaderWindow,
    loadURL,
    loadFile,
  };
}

describe('loadRenderer', () => {
  it('loads the explicit unpackaged dev server URL with role and platform context', async () => {
    const { win, loadURL, loadFile } = createWindow();

    await expect(
      loadRenderer(win, 'fox', 'http://localhost:5173/'),
    ).resolves.toBe('loaded');

    const loaded = new URL(String(loadURL.mock.calls[0]?.[0]));
    expect(loaded.origin).toBe('http://localhost:5173');
    expect(loaded.searchParams.get('role')).toBe('fox');
    expect(loaded.searchParams.get('platform')).toBe(process.platform);
    expect(loadFile).not.toHaveBeenCalled();
  });

  it('loads the packaged renderer file when no sanitized dev URL is supplied', async () => {
    const { win, loadURL, loadFile } = createWindow();

    await expect(loadRenderer(win, 'dashboard')).resolves.toBe('loaded');

    expect(loadURL).not.toHaveBeenCalled();
    expect(loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/renderer\/index\.html$/),
      { query: { role: 'dashboard', platform: process.platform } },
    );
  });

  it('rethrows a live window load failure', async () => {
    const failure = new Error('renderer unavailable');
    const { win } = createWindow({
      loadUrl: async () => {
        throw failure;
      },
    });

    await expect(
      loadRenderer(win, 'query', 'http://127.0.0.1:5173/', () => false),
    ).rejects.toBe(failure);
  });

  it('turns a load failure into cancellation when shutdown begins during the load', async () => {
    const failure = new Error('aborted by shutdown');
    let cancelled = false;
    const { win } = createWindow({
      loadUrl: async () => {
        cancelled = true;
        throw failure;
      },
    });

    await expect(
      loadRenderer(win, 'query', 'http://127.0.0.1:5173/', () => cancelled),
    ).resolves.toBe('cancelled');
  });

  it('does not begin a load after cancellation', async () => {
    const { win, loadURL, loadFile } = createWindow();

    await expect(loadRenderer(win, 'fox', undefined, () => true)).resolves.toBe('cancelled');
    expect(loadURL).not.toHaveBeenCalled();
    expect(loadFile).not.toHaveBeenCalled();
  });

  it('returns cancelled when shutdown starts after a deferred successful load', async () => {
    let cancelled = false;
    let resolveLoad!: () => void;
    const { win, loadURL } = createWindow({
      loadUrl: () => new Promise<void>((resolve) => {
        resolveLoad = resolve;
      }),
    });

    const pending = loadRenderer(win, 'dashboard', 'http://127.0.0.1:5173/', () => cancelled);
    expect(loadURL).toHaveBeenCalledOnce();
    cancelled = true;
    resolveLoad();
    await expect(pending).resolves.toBe('cancelled');
  });
});
