import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const generatedDeclaration = resolve(
  repositoryRoot,
  'packages/unified-contracts/dist/index.d.ts',
);
const contractSource = resolve(
  repositoryRoot,
  'packages/unified-contracts/src/index.ts',
);
const outputs = [
  resolve(repositoryRoot, 'apps/api/src/observability/contracts.generated.d.ts'),
  resolve(repositoryRoot, 'apps/desktop/src/main/observability/contracts.generated.d.ts'),
] as const;

function expected(): string {
  execFileSync(
    'pnpm',
    ['--filter', '@customer-agent/unified-contracts', 'build:runtime'],
    { cwd: repositoryRoot, stdio: 'pipe' },
  );
  const declaration = readFileSync(generatedDeclaration, 'utf8')
    .replaceAll('declare const DENY_REASONS:', 'declare const _DENY_REASONS:')
    .replaceAll('typeof DENY_REASONS', 'typeof _DENY_REASONS');
  const sourceHash = createHash('sha256')
    .update(readFileSync(contractSource))
    .digest('hex');
  return [
    '/**',
    ' * Generated from @customer-agent/unified-contracts by',
    ' * scripts/observability/sync-contract-types.ts. Do not edit.',
    ` * Source SHA-256: ${sourceHash}`,
    ' */',
    '',
    declaration,
  ].join('\n');
}

function main(): void {
  const body = expected();
  const check = process.argv.includes('--check');
  for (const output of outputs) {
    if (check) {
      if (readFileSync(output, 'utf8') !== body) {
        throw new Error(`generated contract snapshot is stale: ${output}`);
      }
      continue;
    }
    writeFileSync(output, body);
  }
  process.stdout.write(check ? 'contract snapshots are current\n' : 'contract snapshots updated\n');
}

main();
