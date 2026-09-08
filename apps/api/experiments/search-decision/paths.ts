import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPERIMENT_ROOT = fileURLToPath(new URL('.', import.meta.url));
export const API_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const PRODUCT_SEARCH_DECISION = join(API_ROOT, 'src/search-decision.ts');
export const PRODUCT_SEARCH_TEXT = join(API_ROOT, 'src/search-text.ts');
export const BASELINE_PATH = join(EXPERIMENT_ROOT, 'baseline.json');
export const GENERATED_DIR = join(EXPERIMENT_ROOT, '.generated');
export const GENERATED_SEARCH_DECISION = join(GENERATED_DIR, 'search-decision.ts');

export function fixtureRoot(): string {
  return process.env.SEARCH_DECISION_LAB_FIXTURE_ROOT ?? join(EXPERIMENT_ROOT, 'fixtures');
}

export function reportRoot(): string {
  const root = process.env.SEARCH_DECISION_LAB_REPORT_DIR ?? join(GENERATED_DIR, 'reports');
  mkdirSync(root, { recursive: true });
  return root;
}
