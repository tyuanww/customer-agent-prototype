import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

it('puts the catalog upload on the six-page SOP slot and keeps the seat window on the built-in tree', () => {
  const app = readFileSync(resolve(desktopRoot, 'src/renderer/DashboardApp.tsx'), 'utf8');
  const windowController = readFileSync(resolve(desktopRoot, 'src/main/sop-window-controller.ts'), 'utf8');
  const ops = readFileSync(resolve(desktopRoot, 'src/main/dashboard-ops-loop.ts'), 'utf8');
  expect(app).toContain('{active === \'sop\' && <SopLibraryModule />}');
  expect(app).not.toContain('{active === \'sop\' && <IntakeSopSource />}');
  expect(windowController).toContain('return this.tree ?? ALLERGY_SOP_TREE');
  expect(ops).toContain("'/v1/sop/import'");
});
