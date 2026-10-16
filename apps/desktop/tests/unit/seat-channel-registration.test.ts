import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function source(relative: string): string {
  return readFileSync(resolve(desktopRoot, relative), 'utf8');
}

it('registers publish, announce, and search even when the intake shell is on', () => {
  const main = source('src/main/main.ts');
  const content = source('src/main/dashboard-content.ts');
  const contentIpc = source('src/main/dashboard-content-ipc.ts');
  const search = source('src/main/product-search.ts');
  const searchIpc = source('src/main/product-search-ipc.ts');
  const announce = source('src/main/product-announce.ts');
  const announceIpc = source('src/main/product-announce-ipc.ts');
  const wrap = /if \(!productProfile\??\.contentIntake\) \{[\s\S]*?register(ProductSearchIpc|DashboardContentIpc|ProductAnnounceIpc)\(/;
  expect(main).not.toMatch(wrap);
  expect(main.indexOf('new ProductAnnounce(')).toBeGreaterThan(0);
  expect(main.indexOf('registerProductSearchIpc(')).toBeGreaterThan(0);
  expect(main.indexOf('registerDashboardContentIpc(')).toBeGreaterThan(0);
  expect(main.indexOf('registerProductAnnounceIpc(')).toBeGreaterThan(0);
  expect(contentIpc).toContain(`IPC_CHANNELS.DASHBOARD_CONTENT_PUBLISH`);
  expect(content).toContain("'/v1/content/publish'");
  expect(searchIpc).toContain('IPC_CHANNELS.PRODUCT_SEARCH');
  expect(search).toContain("'/v1/search'");
  expect(announceIpc).toContain('IPC_CHANNELS.PRODUCT_ANNOUNCE_REFRESH');
  expect(announce).toContain("'/v1/announce/current'");
  expect(IPC_CHANNELS.DASHBOARD_CONTENT_PUBLISH).toBe('dashboard:content-publish');
});
