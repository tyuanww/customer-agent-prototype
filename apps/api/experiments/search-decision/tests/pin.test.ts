import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyLabInstrumentation, assertFixtureHashes, assertPinnedHashes, loadBaseline } from '../instrument.js';
import { materializeLabSearch } from '../lab-search.js';
import { PRODUCT_SEARCH_DECISION } from '../paths.js';

describe('build boundary', () => {
  it('keeps experiments out of the API compile and package surface', () => {
    const build = JSON.parse(readFileSync(fileURLToPath(new URL('../../../tsconfig.build.json', import.meta.url)), 'utf8')) as {
      exclude: string[];
    };
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')) as {
      files: string[];
      scripts: Record<string, string>;
    };
    const tsconfig = JSON.parse(readFileSync(fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)), 'utf8')) as {
      exclude: string[];
    };
    const generatedTsconfig = JSON.parse(readFileSync(fileURLToPath(new URL('../tsconfig.generated.json', import.meta.url)), 'utf8')) as {
      include: string[];
    };
    expect(build.exclude).toContain('experiments/**/*.ts');
    expect(tsconfig.exclude).toContain('experiments/**/.generated/**');
    expect(generatedTsconfig.include).toEqual(['.generated/search-decision.ts']);
    expect(pkg.files).toEqual(['dist', 'README.md']);
    expect(pkg.scripts.typecheck).toContain('check-generated-types.mjs');
  });
});

describe('pinned product baseline', () => {
  it('matches frozen SHA-256 and materializes a diagnostic copy without absolute paths', () => {
    const baseline = assertPinnedHashes();
    assertFixtureHashes();
    expect(baseline.product_commit).toBe('0f9862adfd4a90e5416c1237f0a85c88535c9c2c');
    expect(loadBaseline().n_cases.ids).toHaveLength(23);
    expect(loadBaseline().n_cases.known_unresolved).toEqual(['N10', 'N19']);
    expect(loadBaseline().files['apps/api/src/search-decision.ts']).toBe(
      'fa8aac418f9fd7687bbb13c256cc54b7a9ae23a4dcb5861db4f0d95cab78a70b',
    );
    const generated = applyLabInstrumentation(readFileSync(PRODUCT_SEARCH_DECISION, 'utf8'));
    expect(generated).toContain('extractBodyRelationPolar');
    expect(generated).not.toContain('/Users/');
    const path = materializeLabSearch();
    expect(readFileSync(path, 'utf8')).toBe(generated);
  });

  it('fails closed when a patch anchor is missing from the product source', () => {
    const source = readFileSync(PRODUCT_SEARCH_DECISION, 'utf8').replace(
      'function candidateConflict(',
      'function candidateConflictBroken(',
    );
    expect(() => applyLabInstrumentation(source)).toThrow(/SEARCH_DECISION_LAB_PATCH_CONFLICT/);
  });
});
