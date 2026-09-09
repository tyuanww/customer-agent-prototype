import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), session: {} }));
import { allowedLoginUrl } from '../../src/main/product-login-window';
it('allows only configured authorization and callback routes, not arbitrary loopback targets', () => {
  const check = (url: string) => allowedLoginUrl(url, 'http://127.0.0.1:4201', 'http://127.0.0.1:4200');
  expect(check('http://127.0.0.1:4201/authorize?state=s')).toBe(true);
  expect(check('http://127.0.0.1:4200/v1/auth/callback?state=s&code=c')).toBe(true);
  const credentialUrl = new URL('http://127.0.0.1:4201/authorize');
  credentialUrl.username = 'synthetic'; credentialUrl.password = 'invalid';
  expect(check(credentialUrl.href)).toBe(false);
  for (const url of ['https://example.com', 'http://127.0.0.1:9999/authorize', 'http://127.0.0.1:4200/v1/auth/me', 'file:///tmp/token']) expect(check(url)).toBe(false);
});
