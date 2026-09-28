import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./dev-help.mjs', import.meta.url));

test('pnpm help:dev prints the golden path and a missing-script next step', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pnpm dev/);
  assert.match(result.stdout, /pnpm start/);
  assert.match(result.stdout, /ERR_PNPM_NO_SCRIPT/);
  assert.match(result.stdout, /docs\/tutorial-first-run\.md/);
  assert.match(result.stdout, /CONTRIBUTING\.md/);
  assert.match(result.stdout, /pnpm run/);
});

test('dev-help --check stays aligned with the printed copy', () => {
  const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
