import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const productVersion = readFileSync(path.join(repositoryRoot, 'VERSION'), 'utf8').trim();
const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(gitSha)) {
  throw new Error('build identity requires the full git HEAD');
}
const destination = path.join(desktopRoot, 'build');
mkdirSync(destination, { recursive: true });
writeFileSync(path.join(destination, 'build-identity.json'), `${JSON.stringify({ productVersion, gitSha }, null, 2)}\n`);
console.log(`build identity ${productVersion} ${gitSha.slice(0, 7)}`);
