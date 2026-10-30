import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] ?? 'local';
if (mode !== 'local' && mode !== 'distribution') {
  throw new Error('Usage: node scripts/write-build-identity.mjs <local|distribution>');
}
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const productVersion = readFileSync(path.join(repositoryRoot, 'VERSION'), 'utf8').trim();
const gitOptions = { cwd: repositoryRoot, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } };
const head = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
if (!/^[0-9a-f]{40}$/.test(head)) {
  throw new Error('build identity requires the full git HEAD');
}
const status = execFileSync('git', [
  'status', '--porcelain=v1', '--untracked-files=normal', '--ignore-submodules=none',
], gitOptions);
const dirty = status.length > 0;
if (mode === 'distribution' && dirty) {
  throw new Error('distribution package requires a clean Git working tree; found dirty files');
}
const gitSha = dirty ? 'dirty' : head;
const destination = path.join(desktopRoot, 'build');
mkdirSync(destination, { recursive: true });
writeFileSync(path.join(destination, 'build-identity.json'), `${JSON.stringify({ productVersion, gitSha }, null, 2)}\n`);
console.log(`build identity ${productVersion} ${gitSha.slice(0, 7)}`);
