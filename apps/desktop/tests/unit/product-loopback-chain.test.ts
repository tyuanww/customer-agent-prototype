import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

it('keeps the PG loopback chain on the desktop adapter, not fixture search', () => {
  const e2e = readFileSync(path.join(root, 'apps/api/tests/backend-runtime.e2e.test.ts'), 'utf8');
  expect(e2e).toContain("import(new URL('product-search.ts'");
  expect(e2e).toContain("import(new URL('product-announce.ts'");
  expect(e2e).toContain("import(new URL('product-session.ts'");
  expect(e2e).toContain("code: 'STALE'");
  expect(e2e).toContain('synthetic_owner');
  expect(e2e).not.toContain('synthetic-scripts');
  expect(e2e).not.toContain('searchScripts(');
});
