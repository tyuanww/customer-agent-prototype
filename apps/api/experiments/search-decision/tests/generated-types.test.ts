import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_TSCONFIG,
  materializeAndTypecheckGenerated,
  runGeneratedTsc,
} from '../generated-typecheck.js';
import { materializeLabSearch } from '../lab-search.js';
import { EXPERIMENT_ROOT, GENERATED_DIR, GENERATED_SEARCH_DECISION } from '../paths.js';

const GENERATED_TAIL = 'experiments/search-decision/.generated/search-decision.ts';
const MUTATED_TAIL = 'experiments/search-decision/.generated/search-decision.type-error.ts';
const TYPE_PROBE = '\nexport const __searchDecisionLabGeneratedTypeProbe: number = "not-a-number";\n';

function listedGenerated(output: string): boolean {
  return output.split(/\r?\n/).some((line) => line.replaceAll('\\', '/').endsWith(GENERATED_TAIL));
}

describe('generated decision module typecheck', () => {
  it('typechecks the materialized .generated module on the clean-checkout path', () => {
    const generatedPath = materializeAndTypecheckGenerated();
    expect(generatedPath.replaceAll('\\', '/').endsWith(GENERATED_TAIL)).toBe(true);
    const listed = runGeneratedTsc(['--noEmit', '--listFiles']);
    expect(listed.status).toBe(0);
    expect(listedGenerated(listed.output)).toBe(true);
    expect(GENERATED_TSCONFIG.replaceAll('\\', '/')).toContain('experiments/search-decision/tsconfig.generated.json');
  });

  it('fails when the generated file itself has a type error, not only the patch string', () => {
    const generatedPath = materializeLabSearch();
    expect(generatedPath).toBe(GENERATED_SEARCH_DECISION);
    expect(readFileSync(join(EXPERIMENT_ROOT, 'instrument.ts'), 'utf8')).not.toContain(
      '__searchDecisionLabGeneratedTypeProbe',
    );
    const mutatedPath = join(GENERATED_DIR, 'search-decision.type-error.ts');
    const mutatedTsconfig = join(GENERATED_DIR, 'tsconfig.type-error.json');
    writeFileSync(mutatedPath, `${readFileSync(generatedPath, 'utf8')}${TYPE_PROBE}`);
    writeFileSync(mutatedTsconfig, `${JSON.stringify({
      extends: '../tsconfig.generated.json',
      include: ['./search-decision.type-error.ts'],
      exclude: [],
    }, null, 2)}\n`);
    try {
      expect(readFileSync(mutatedPath, 'utf8')).toContain('__searchDecisionLabGeneratedTypeProbe');
      const result = runGeneratedTsc(['--noEmit'], mutatedTsconfig);
      expect(result.status).not.toBe(0);
      expect(result.output.replaceAll('\\', '/')).toContain(MUTATED_TAIL);
    } finally {
      rmSync(mutatedPath, { force: true });
      rmSync(mutatedTsconfig, { force: true });
    }
  });
});
