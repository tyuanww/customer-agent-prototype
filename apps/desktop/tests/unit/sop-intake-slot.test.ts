import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

it('keeps the legacy SOP catalog isolated from intake and retains the existing seat tree', () => {
  const app = readFileSync(resolve(desktopRoot, 'src/renderer/DashboardApp.tsx'), 'utf8');
  const destinations = readFileSync(resolve(desktopRoot, 'src/renderer/features/dashboard/intake-destinations.tsx'), 'utf8');
  const rows = readFileSync(resolve(desktopRoot, 'src/renderer/features/dashboard/intake-destination-rows.ts'), 'utf8');
  const windowController = readFileSync(resolve(desktopRoot, 'src/main/sop-window-controller.ts'), 'utf8');
  const ops = readFileSync(resolve(desktopRoot, 'src/main/dashboard-ops-loop.ts'), 'utf8');
  expect(destinations).toContain("sop: (ctx) => ctx.workbenchMode === 'legacy'");
  expect(app).not.toContain('sopUploadRefusal');
  expect(app).toContain('renderIntakeDestinations');
  expect(app).not.toContain('<SopLibraryModule');
  expect(rows).toContain([
    "id: 'sop',",
    "    label: 'SOP',",
    "    blurb: '学习与执行操作流程',",
    "    group: '话术运营',",
    "    audience: 'everyone',",
    "    needsPermissionBridge: false,",
    '    keepAlive: false,',
  ].join('\n'));
  expect(destinations).not.toContain('IntakeSopSource');
  expect(app).not.toContain('IntakeSopSource');
  expect(windowController).toContain('return this.tree ?? ALLERGY_SOP_TREE');
  expect(ops).toContain("'/v1/sop/import'");
  expect(ops).not.toContain('sopUploadRefusal');
});
