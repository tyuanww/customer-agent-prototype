import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const versionFile = path.join(here, '..', 'VERSION');
const desktopPackage = path.join(here, '..', 'apps/desktop/package.json');

test('VERSION matches the desktop package version', () => {
  const version = readFileSync(versionFile, 'utf8').trim();
  const desktop = JSON.parse(readFileSync(desktopPackage, 'utf8'));
  assert.equal(desktop.version, version);
  assert.match(version, /^\d+\.\d+\.\d+$/);
});
