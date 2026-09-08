import { describe, expect, it } from 'vitest';
import { judgeSearch as productJudgeSearch } from '../../../src/search-decision.js';
import { toJudgableAlias, toJudgableOriginal } from '../decide.js';
import { loadJson, loadSources, poolOf, sourceMap } from '../evaluate.js';
import { loadLabSearch } from '../lab-search.js';
import type { CaseSpec } from '../types.js';

describe('lab judgeSearch vs product judgeSearch', () => {
  it('inspection and product share one policy on every interface and v3 pool', async () => {
    const lab = await loadLabSearch();
    const sources = loadSources();
    const byId = sourceMap(sources);
    const interfaceCases = loadJson<{ cases: CaseSpec[] }>('cases-interface.json').cases;
    const v3Cases = loadJson<{ cases: CaseSpec[] }>('cases-v3-regression.json').cases;
    const allowedProductDiff = new Set<string>();
    const mismatches: string[] = [];
    const productDiffs = new Set<string>();
    for (const spec of [...interfaceCases, ...v3Cases]) {
      const pool = poolOf(spec, byId);
      for (const mapper of [toJudgableOriginal, toJudgableAlias]) {
        const candidates = pool.map(mapper);
        const product = productJudgeSearch(spec.query, candidates);
        const vendor = lab.judgeSearch(spec.query, candidates);
        const inspected = lab.inspectSearch(spec.query, candidates);
        const vendorDiffers = vendor.decision !== product.decision
          || vendor.shownScriptIds.join(',') !== product.shownScriptIds.join(',');
        if (vendorDiffers) productDiffs.add(spec.id);
        if (vendorDiffers && !allowedProductDiff.has(spec.id)) {
          mismatches.push(`${spec.id} ${mapper.name} lab!=product`);
        }
        if (inspected.decision !== vendor.decision || inspected.shownScriptIds.join(',') !== vendor.shownScriptIds.join(',')) {
          mismatches.push(`${spec.id} ${mapper.name} inspect!=judge`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect([...productDiffs].sort()).toEqual([]);
  });
});
