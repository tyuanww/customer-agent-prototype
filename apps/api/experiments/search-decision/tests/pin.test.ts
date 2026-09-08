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
    expect(baseline.product_base_commit).toBe('69c6044fd2ac097131fd325b1df94550c85b1064');
    expect(loadBaseline().n_cases.ids).toHaveLength(23);
    expect(loadBaseline().n_cases.known_unresolved).toEqual([]);
    expect(Object.keys(loadBaseline().files)).toHaveLength(3);
    const generated = applyLabInstrumentation(readFileSync(PRODUCT_SEARCH_DECISION, 'utf8'));
    expect(generated).toContain('analyzeRelationQuery');
    expect(generated).not.toContain('/Users/');
    const path = materializeLabSearch();
    expect(readFileSync(path, 'utf8')).toBe(generated);
  });

  it('rejects changed import counts and embedded absolute paths', () => {
    const source = readFileSync(PRODUCT_SEARCH_DECISION, 'utf8');
    expect(() => applyLabInstrumentation(source.replaceAll("from './search-text.js'", "from './other.js'")))
      .toThrow(/PATCH_TEXT_IMPORT/);
    expect(() => applyLabInstrumentation(source.replace("from './search-relations.js'", "from './other.js'")))
      .toThrow(/PATCH_RELATION_IMPORT/);
    expect(() => applyLabInstrumentation(`${source}\n// /Users/synthetic/source`))
      .toThrow(/PATCH_ABSOLUTE_PATH/);
  });

  it('fails closed when a patch anchor is missing from the product source', () => {
    const source = readFileSync(PRODUCT_SEARCH_DECISION, 'utf8').replace(
      'export function inspectSearch(',
      'export function inspectSearchBroken(',
    );
    expect(() => applyLabInstrumentation(source)).toThrow(/SEARCH_DECISION_LAB_PATCH_INSPECTION/);
  });
});
