import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const source = resolve(repositoryRoot, 'packages/unified-contracts/src/index.ts');
const apiSnapshot = resolve(
  repositoryRoot,
  'apps/api/src/observability/contracts.generated.d.ts',
);
const desktopSnapshot = resolve(
  repositoryRoot,
  'apps/desktop/src/main/observability/contracts.generated.d.ts',
);

describe('observability contract snapshots', () => {
  it('bind both temporary declarations to the frozen contract source', () => {
    const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex');
    const api = readFileSync(apiSnapshot, 'utf8');
    const desktop = readFileSync(desktopSnapshot, 'utf8');
    expect(api).toBe(desktop);
    expect(api).toContain(`Source SHA-256: ${sourceHash}`);
    expect(api).toContain('export type StageRecord');
    expect(api).toContain('export type EvaluationRecord');
    expect(api).toContain('export type AlertRecord');
  });
});
