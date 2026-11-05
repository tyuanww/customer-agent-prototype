import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(root, 'generated');
const source = path.join(root, 'dist', 'index.js');
const outputs = new Map([
  ['policy-matrix.generated.json', 'renderPolicyMatrixJson'],
  ['role-ceiling.seed.generated.sql', 'renderRoleCeilingSeedSql'],
]);
const module = await import(`file://${source}`);
let drift = false;
for (const [name, renderer] of outputs) {
  const expected = module[renderer]();
  const target = path.join(generated, name);
  let actual = null;
  try { actual = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (process.argv.includes('--check')) {
    if (actual !== expected) { console.error(`generated drift: ${name}`); drift = true; }
  } else {
    await mkdir(generated, { recursive: true });
    await writeFile(target, expected, 'utf8');
  }
}
if (drift) process.exitCode = 1;
