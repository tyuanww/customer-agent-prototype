import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideSearch, toJudgableAlias } from '../decide.js';
import { loadJson, loadSources, poolOf, sourceMap, type NCase } from '../evaluate.js';
import { loadLabSearch } from '../lab-search.js';
import { reportRoot } from '../paths.js';

function slim(fact: { polarity: string; relation: string; argument: string; marker: string | null | undefined }) {
  return {
    polarity: fact.polarity,
    relation: fact.relation,
    argument: fact.argument,
    marker: fact.marker ?? null,
  };
}

describe('N-case fact-level diagnostics', () => {
  it('records relation facts, exact match, leftover waiver split, and must-not-contain', async () => {
    const sources = loadSources();
    const byId = sourceMap(sources);
    const nCases = loadJson<{ cases: NCase[] }>('cases-n.json').cases;
    const round2 = loadJson<{ overrides: Record<string, { compatConflict: boolean; requiresClarification: boolean }> }>('diagnostics-round2.json').overrides;
    const lab = await loadLabSearch();
    const problems: string[] = [];
    const rows: unknown[] = [];
    for (const spec of nCases) {
      if (spec.expectedFacts === undefined) {
        problems.push(`${spec.id} missing expectedFacts`);
        continue;
      }
      const override = round2[spec.id];
      const expectedFacts = { ...spec.expectedFacts, ...(override ?? {}) };
      const pool = poolOf(spec, byId);
      const decided = await decideSearch(spec.query, pool);
      const inspection = lab.inspectSearch(
        spec.query,
        pool.filter((source) => source.annotation.status === 'ok').map(toJudgableAlias),
      );
      const primary = spec.pool[0];
      const row = inspection.candidates.find((candidate) => candidate.scriptId === primary);
      if (row === undefined) {
        problems.push(`${spec.id} missing inspection row`);
        continue;
      }
      const queryGot = row.queryFacts.map(slim);
      const queryWant = expectedFacts.query.map(slim);
      if (JSON.stringify(queryGot) !== JSON.stringify(queryWant)) {
        problems.push(`${spec.id} queryFacts ${JSON.stringify(queryGot)} != ${JSON.stringify(queryWant)}`);
      }
      const sourceGot = row.sourceFacts.map(slim);
      const sourceWant = expectedFacts.source
        .filter((fact) => fact.sourceId === primary)
        .map(slim);
      if (JSON.stringify(sourceGot) !== JSON.stringify(sourceWant)) {
        problems.push(`${spec.id} sourceFacts ${JSON.stringify(sourceGot)} != ${JSON.stringify(sourceWant)}`);
      }
      if (row.sameRelArg !== expectedFacts.sameRelArg) problems.push(`${spec.id} sameRelArg ${row.sameRelArg}`);
      if (row.polarConflict !== expectedFacts.polarConflict) problems.push(`${spec.id} polarConflict ${row.polarConflict}`);
      if (row.exceptionEligible !== expectedFacts.exceptionEligible) {
        problems.push(`${spec.id} exceptionEligible ${row.exceptionEligible}`);
      }
      if (expectedFacts.leftoverHit !== null && row.leftoverHit !== expectedFacts.leftoverHit) {
        problems.push(`${spec.id} leftoverHit ${row.leftoverHit}`);
      }
      const waivedWant = expectedFacts.leftoverHit === null
        ? row.leftoverHit && row.exceptionEligible
        : expectedFacts.waivedLeftover;
      if (row.waivedLeftover !== waivedWant) {
        problems.push(`${spec.id} waivedLeftover ${row.waivedLeftover} want ${waivedWant}`);
      }
      if (expectedFacts.compatConflict !== null && row.conflict !== expectedFacts.compatConflict) {
        problems.push(`${spec.id} compatConflict ${row.conflict}`);
      }
      for (const banned of expectedFacts.sourceMustNotContain ?? []) {
        if (row.sourceFacts.some((fact) => fact.polarity === banned.polarity && fact.relation === banned.relation && fact.argument === banned.argument)) {
          problems.push(`${spec.id} source must not contain ${JSON.stringify(banned)}`);
        }
      }
      if (override && row.requiresClarification !== override.requiresClarification) problems.push(`${spec.id} requiresClarification`);
      rows.push({
        id: spec.id,
        round1Unresolved: spec.unresolved,
        requiresClarification: row.requiresClarification,
        expected: spec.expected.decision,
        actual: decided.decision,
        step: decided.step,
        match: decided.decision === spec.expected.decision && decided.shownScriptIds.join(',') === spec.expected.shownScriptIds.join(','),
        queryFacts: row.queryFacts,
        sourceFacts: row.sourceFacts,
        sameRelArg: row.sameRelArg,
        polarConflict: row.polarConflict,
        leftoverHit: row.leftoverHit,
        exceptionEligible: row.exceptionEligible,
        waivedLeftover: row.waivedLeftover,
        compatConflict: row.conflict,
      });
    }
    writeFileSync(join(reportRoot(), 'n-results.json'), `${JSON.stringify({ kind: 'N_ROUND2', rows }, null, 2)}\n`);
    expect(problems).toEqual([]);
  });
});
