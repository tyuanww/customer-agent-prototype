import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), session: {} }));
import { allowedLoginUrl, isChooserUrl } from '../../src/main/product-login-window';
it('allows only configured authorization and callback routes, not arbitrary loopback targets', () => {
  const check = (url: string) => allowedLoginUrl(url, 'http://127.0.0.1:4201', 'http://127.0.0.1:4200');
  expect(check('http://127.0.0.1:4201/authorize?state=s')).toBe(true);
  expect(check('http://127.0.0.1:4200/v1/auth/callback?state=s&code=c')).toBe(true);
  expect(check('https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=cli_aaaaaaaaaaaaaaaa')).toBe(true);
  const credentialUrl = new URL('http://127.0.0.1:4201/authorize');
  credentialUrl.username = 'synthetic'; credentialUrl.password = 'invalid';
  expect(check(credentialUrl.href)).toBe(false);
  for (const url of ['https://example.com', 'http://127.0.0.1:9999/authorize', 'http://127.0.0.1:4200/v1/auth/me', 'file:///tmp/token', 'https://accounts.feishu.cn/open-apis/authen/v1/index']) expect(check(url)).toBe(false);
});

it('allows packaged renderer html and hashed assets, not parent-relative files', () => {
  expect(isChooserUrl('file:///Users/app/out/renderer/index.html')).toBe(true);
  expect(isChooserUrl('file:///Users/app/out/renderer/assets/index-Bvsq1Vx8.js')).toBe(true);
  expect(isChooserUrl('file:///Users/app/out/renderer/assets/LoginApp-BzcsWSWI.js')).toBe(true);
  expect(isChooserUrl('file:///Users/app/out/renderer/assets/fox-head-DuCgrBSA.png')).toBe(true);
  expect(isChooserUrl('file:///Users/app/out/renderer/assets/js/index-Bvsq1Vx8.js')).toBe(true);
  expect(isChooserUrl('file:///tmp/app.asar/out/renderer/index.html')).toBe(true);
  expect(isChooserUrl('file:///tmp/app.asar/out/renderer/assets/index.js')).toBe(true);
  expect(isChooserUrl('file:///tmp/app.asar/renderer/index.html')).toBe(true);
  expect(isChooserUrl('file:///tmp/app.asar/renderer/assets/js/index.js')).toBe(true);
  expect(isChooserUrl('file:///Users/app/out/renderer/assets/%2e%2e%2fsecret.js')).toBe(false);
  expect(isChooserUrl('file:///tmp/token')).toBe(false);
  expect(isChooserUrl('file:///Users/app/out/main/index.js')).toBe(false);
  expect(isChooserUrl('http://127.0.0.1:5173/index.html')).toBe(false);
  expect(isChooserUrl('http://127.0.0.1:5173/index.html', 'http://127.0.0.1:5173')).toBe(true);
});
