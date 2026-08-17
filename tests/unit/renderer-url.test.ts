import { afterEach, describe, expect, it } from 'vitest';
import {
  isAllowedRendererUrl,
  resolveRendererDevServerUrl,
} from '../../src/shared/renderer-url';

const originalRendererUrl = process.env.ELECTRON_RENDERER_URL;

afterEach(() => {
  if (originalRendererUrl === undefined) {
    delete process.env.ELECTRON_RENDERER_URL;
  } else {
    process.env.ELECTRON_RENDERER_URL = originalRendererUrl;
  }
});

describe('isAllowedRendererUrl', () => {
  it('accepts the packaged renderer file URL', () => {
    expect(isAllowedRendererUrl('file:///Users/demo/app/out/renderer/index.html')).toBe(true);
  });

  it('accepts the local Vite dev server and rejects other hosts', () => {
    expect(
      isAllowedRendererUrl('http://127.0.0.1:5173/', 'http://127.0.0.1:5173'),
    ).toBe(true);
    expect(isAllowedRendererUrl('https://example.com/evil', 'http://127.0.0.1:5173')).toBe(
      false,
    );
  });

  it('rejects a loose file index and localhost when no explicit dev URL is set', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173';
    expect(isAllowedRendererUrl('file:///tmp/index.html')).toBe(false);
    expect(isAllowedRendererUrl('file:///tmp/renderer/index.html')).toBe(false);
    expect(isAllowedRendererUrl('http://localhost:5173/', undefined)).toBe(false);
    expect(isAllowedRendererUrl('http://127.0.0.1:5173/', undefined)).toBe(false);
  });

  it('accepts a packaged asar renderer file URL', () => {
    expect(
      isAllowedRendererUrl(
        'file:///Applications/Demo.app/Contents/Resources/app.asar/out/renderer/index.html',
      ),
    ).toBe(true);
  });
});

describe('resolveRendererDevServerUrl', () => {
  it('ignores ELECTRON_RENDERER_URL for packaged applications', () => {
    expect(resolveRendererDevServerUrl(true, 'http://127.0.0.1:5173')).toBeUndefined();
  });

  it('normalizes an unpackaged localhost dev server URL', () => {
    expect(resolveRendererDevServerUrl(false, 'http://localhost:5173')).toBe(
      'http://localhost:5173/',
    );
  });

  it('rejects remote, credentialed, and non-http development URLs', () => {
    expect(resolveRendererDevServerUrl(false, 'https://example.com')).toBeUndefined();
    expect(resolveRendererDevServerUrl(false, 'http://user:secret@localhost:5173')).toBeUndefined();
    expect(resolveRendererDevServerUrl(false, 'file:///tmp/index.html')).toBeUndefined();
  });
});
