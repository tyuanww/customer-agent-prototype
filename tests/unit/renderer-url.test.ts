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
});
