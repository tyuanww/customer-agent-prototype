import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), session: {} }));
import { allowedHelpUrl } from '../../src/main/product-help-open';

it('allows only the exact loopback synthetic-help path', () => {
  const origin = 'http://127.0.0.1:4201';
  expect(allowedHelpUrl(`${origin}/synthetic-help`, origin)).toBe(true);
  const credentialUrl = new URL(`${origin}/synthetic-help`);
  credentialUrl.username = 'synthetic'; credentialUrl.password = 'invalid';
  expect(allowedHelpUrl(credentialUrl.href, origin)).toBe(false);
  for (const url of [
    `${origin}/authorize`,
    `${origin}/synthetic-help?next=/`,
    `${origin}/synthetic-help#ok`,
    'http://127.0.0.1:9999/synthetic-help',
    'https://example.com/synthetic-help',
    'file:///tmp/help',
  ]) expect(allowedHelpUrl(url, origin)).toBe(false);
});
