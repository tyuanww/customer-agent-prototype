import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { applyLabInstrumentation, assertPinnedHashes } from './instrument.js';
import { GENERATED_DIR, GENERATED_SEARCH_DECISION, PRODUCT_SEARCH_DECISION } from './paths.js';
import type { LabSearchModule } from './types.js';

let cached: LabSearchModule | undefined;
let materializePromise: Promise<LabSearchModule> | undefined;

export function materializeLabSearch(): string {
  assertPinnedHashes();
  const product = readFileSync(PRODUCT_SEARCH_DECISION, 'utf8');
  const generated = applyLabInstrumentation(product);
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(GENERATED_SEARCH_DECISION, generated);
  return GENERATED_SEARCH_DECISION;
}

export async function loadLabSearch(): Promise<LabSearchModule> {
  if (cached !== undefined) return cached;
  if (materializePromise === undefined) {
    materializePromise = import(pathToFileURL(materializeLabSearch()).href).then((module) => {
      const loaded: LabSearchModule = {
        inspectSearch: module.inspectSearch,
        judgeSearch: module.judgeSearch,
      };
      cached = loaded;
      return loaded;
    });
  }
  return materializePromise;
}
