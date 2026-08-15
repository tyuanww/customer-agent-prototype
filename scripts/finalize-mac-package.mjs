import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'local' && mode !== 'distribution') {
  throw new Error('Usage: node scripts/finalize-mac-package.mjs <local|distribution>');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(
  root,
  'release',
  mode === 'local' ? 'local-unsigned' : 'distribution',
);

if (!existsSync(outputDir)) {
  throw new Error(`macOS package output does not exist: ${outputDir}`);
}

const removable = readdirSync(outputDir, { recursive: true })
  .map(String)
  .filter((relativePath) => path.basename(relativePath).endsWith('.blockmap'));

for (const relativePath of removable) {
  const absolutePath = path.resolve(outputDir, relativePath);
  if (!absolutePath.startsWith(`${outputDir}${path.sep}`)) {
    throw new Error(`Refusing to remove a path outside the package output: ${absolutePath}`);
  }
  if (statSync(absolutePath).isFile()) {
    unlinkSync(absolutePath);
  }
}

console.log(
  `Removed ${removable.length} generated update blockmap file(s) from the offline macOS package output.`,
);
