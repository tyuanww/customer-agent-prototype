import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_ROOT,
  BASELINE_PATH,
  PRODUCT_SEARCH_DECISION,
  PRODUCT_SEARCH_TEXT,
  fixtureRoot,
} from './paths.js';

export type LabBaseline = Readonly<{
  kind: string;
  status: string;
  product_base_commit: string;
  files: Readonly<Record<string, string>>;
  fixtures: Readonly<Record<string, string>>;
  n_cases: Readonly<{
    ids: readonly string[];
    known_unresolved: readonly string[];
    unresolved_reasons: Readonly<Record<string, string>>;
  }>;
}>;

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function replaceOnce(source: string, find: string, replacement: string, label: string): string {
  const count = source.split(find).length - 1;
  if (count !== 1) {
    throw new Error(`SEARCH_DECISION_LAB_PATCH_${label}: expected 1 occurrence, found ${count}`);
  }
  return source.replace(find, replacement);
}

export function loadBaseline(): LabBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as LabBaseline;
}

export function assertPinnedHashes(): LabBaseline {
  const baseline = loadBaseline();
  const errors: string[] = [];
  const productFiles: Readonly<Record<string, string>> = {
    'apps/api/src/search-decision.ts': PRODUCT_SEARCH_DECISION,
    'apps/api/src/search-text.ts': PRODUCT_SEARCH_TEXT,
    'apps/api/src/search-relations.ts': join(API_ROOT, 'src/search-relations.ts'),
  };
  for (const [rel, expected] of Object.entries(baseline.files)) {
    const path = productFiles[rel];
    if (path === undefined) {
      errors.push(`unknown pin ${rel}`);
      continue;
    }
    const actual = sha256(readFileSync(path));
    if (actual !== expected) {
      errors.push(`${rel} drifted: ${actual} != ${expected} (pinned ${baseline.product_base_commit})`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`SEARCH_DECISION_LAB_BASELINE_DRIFT: ${errors.join('; ')}`);
  }
  return baseline;
}

export function assertFixtureHashes(): LabBaseline {
  const baseline = loadBaseline();
  const errors: string[] = [];
  const fixtures = fixtureRoot();
  for (const [rel, expected] of Object.entries(baseline.fixtures)) {
    const actual = sha256(readFileSync(join(fixtures, rel.slice('fixtures/'.length))));
    if (actual !== expected) {
      errors.push(`${rel} drifted: ${actual} != ${expected}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`SEARCH_DECISION_LAB_FIXTURE_DRIFT: ${errors.join('; ')}`);
  }
  return baseline;
}

export function testUnfrozenFixturesAllowed(): boolean {
  return process.env.SEARCH_DECISION_LAB_TEST_UNFROZEN === '1';
}

export function requireFrozenFixtures(): LabBaseline {
  if (testUnfrozenFixturesAllowed()) return loadBaseline();
  return assertFixtureHashes();
}

/** Relocate imports only: policy and diagnostic ownership stay in src. */
export function applyLabInstrumentation(source: string): string {
  if (!source.includes('export function inspectSearch(')) {
    throw new Error('SEARCH_DECISION_LAB_PATCH_INSPECTION');
  }
  let next = replaceOnce(source, "from './search-text.js'", "from '../../../src/search-text.js'", 'TEXT_IMPORT');
  // The relation import and its type export intentionally share the same path.
  if (next.split("from './search-relations.js'").length - 1 !== 2) {
    throw new Error('SEARCH_DECISION_LAB_PATCH_RELATION_IMPORT');
  }
  next = next.replaceAll("from './search-relations.js'", "from '../../../src/search-relations.js'");
  if (next.includes(API_ROOT) || next.includes('/Users/')) {
    throw new Error('SEARCH_DECISION_LAB_PATCH_ABSOLUTE_PATH');
  }
  return next;
}
