import { describe, expect, it } from 'vitest';
import { decideSearch } from '../decide.js';
import { loadJson } from '../evaluate.js';
import type { DisplayDecision, SyntheticSource } from '../types.js';

const fixture = loadJson<{
  sources: SyntheticSource[];
  cases: Array<{
    id: string;
    query: string;
    pool: string[];
    allowedDecisions: DisplayDecision[];
    shownScriptIds: string[];
    bodyOverride?: string;
  }>;
}>('negation-regression.json');

describe('pre-implementation synthetic negation regressions', () => {
  it.each(fixture.cases)('$id preserves occurrence, assertion and source boundaries', async (spec) => {
    const pool = fixture.sources.filter((source) => spec.pool.includes(source.id)).map((source) => ({
      ...source,
      body: spec.bodyOverride ?? source.body,
    }));
    const result = await decideSearch(spec.query, pool);
    expect(spec.allowedDecisions).toContain(result.decision);
    expect(result.shownScriptIds).toEqual(spec.shownScriptIds);
  });
});
