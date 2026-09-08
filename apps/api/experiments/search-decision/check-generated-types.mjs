#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const experimentRoot = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--no-warnings',
    '--import',
    pathToFileURL(path.join(experimentRoot, 'register-js-to-ts.mjs')).href,
    path.join(experimentRoot, 'generated-typecheck.ts'),
  ],
  { stdio: 'inherit' },
);
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
