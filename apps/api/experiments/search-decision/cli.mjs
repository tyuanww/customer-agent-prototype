#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const experimentRoot = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(experimentRoot, '../..');
const command = process.argv[2] ?? '';
const vitest = path.join(apiRoot, 'node_modules/vitest/vitest.mjs');

const env = { ...process.env };
delete env.SEARCH_DECISION_LAB_TEST_UNFROZEN;
let files;
if (command === 'acceptance') {
  env.CUSTOMER_AGENT_SEARCH_DECISION_FULL_ACCEPTANCE = '1';
  files = [path.join(experimentRoot, 'tests/full-acceptance.test.ts')];
} else if (command === 'proof') {
  files = [path.join(experimentRoot, 'tests/acceptance-proof.test.ts')];
} else if (command === 'round1') {
  files = [path.join(experimentRoot, 'tests/round1-scope.test.ts')];
} else if (command === 'known-fail') {
  console.error('N10/N19 are repaired. Use pnpm test:search-decision:proof; historical known-fail belongs to PR #44.');
  process.exit(2);
} else {
  console.error('usage: cli.mjs acceptance|proof|round1');
  process.exit(2);
}

const result = spawnSync(process.execPath, [vitest, 'run', ...files], {
  cwd: apiRoot,
  env,
  stdio: 'inherit',
});
process.exit(result.status === null ? 1 : result.status);
