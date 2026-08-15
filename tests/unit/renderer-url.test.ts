import { describe, expect, it } from 'vitest';
import { isAllowedRendererUrl } from '../../src/shared/renderer-url';

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
