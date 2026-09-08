import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideSearch, toJudgableAlias } from '../decide.js';
import { loadJson, loadSources } from '../evaluate.js';
import { loadLabSearch } from '../lab-search.js';
import { reportRoot } from '../paths.js';
import { extractBodyRelationPolar } from '../relation-polar.js';
import type { SyntheticSource } from '../types.js';

function slim(fact: { polarity: string; relation: string; argument: string; marker: string | null | undefined }) {
  return {
    polarity: fact.polarity,
    relation: fact.relation,
    argument: fact.argument,
    marker: fact.marker ?? null,
  };
}

describe('answerText supported-statement boundary', () => {
  it('extracts only supported statements; non-statements stay relation none', async () => {
    const sources = loadSources();
    const base = sources.find((source) => source.id === 'muff-contact');
    if (base === undefined) throw new Error('muff-contact');
    const fixture = loadJson<{
      query: string;
      queryFacts: Array<{ polarity: string; relation: string; argument: string; marker: string | null }>;
      cases: Array<{
        id: string;
        body: string;
        reason: string;
        expectedFacts: Array<{ polarity: string; relation: string; argument: string; marker: string | null }>;
        sourceMustNotContain: Array<{ polarity: string; relation: string; argument: string }>;
        sameRelArg: boolean;
        polarConflict: boolean;
        exceptionEligible: boolean;
        leftoverHit: boolean;
        waivedLeftover: boolean;
        compatConflict: boolean;
        expected: { decision: string; shownScriptIds: string[] };
        expectedStep: string;
      }>;
    }>('cases-body-statement.json');
    const lab = await loadLabSearch();
    const problems: string[] = [];
    const rows: unknown[] = [];
    for (const spec of fixture.cases) {
      const source: SyntheticSource = { ...base, body: spec.body };
      const facts = extractBodyRelationPolar(spec.body).map(slim);
      const want = spec.expectedFacts.map(slim);
      if (JSON.stringify(facts) !== JSON.stringify(want)) {
        problems.push(`${spec.id} facts ${JSON.stringify(facts)} != ${JSON.stringify(want)}`);
      }
      for (const banned of spec.sourceMustNotContain) {
        if (facts.some((fact) => fact.polarity === banned.polarity && fact.relation === banned.relation && fact.argument === banned.argument)) {
          problems.push(`${spec.id} must not contain ${JSON.stringify(banned)}`);
        }
      }
      const decided = await decideSearch(fixture.query, [source]);
      const inspection = lab.inspectSearch(fixture.query, [toJudgableAlias(source)]);
      const row = inspection.candidates.find((candidate) => candidate.scriptId === source.id);
      if (row === undefined) {
        problems.push(`${spec.id} missing inspection`);
        continue;
      }
      if (JSON.stringify(row.queryFacts.map(slim)) !== JSON.stringify(fixture.queryFacts.map(slim))) {
        problems.push(`${spec.id} queryFacts`);
      }
      if (row.sameRelArg !== spec.sameRelArg) problems.push(`${spec.id} sameRelArg ${row.sameRelArg}`);
      if (row.polarConflict !== spec.polarConflict) problems.push(`${spec.id} polarConflict ${row.polarConflict}`);
      if (row.exceptionEligible !== spec.exceptionEligible) problems.push(`${spec.id} exceptionEligible`);
      if (row.leftoverHit !== spec.leftoverHit) problems.push(`${spec.id} leftoverHit`);
      if (row.waivedLeftover !== spec.waivedLeftover) problems.push(`${spec.id} waivedLeftover`);
      if (row.conflict !== spec.compatConflict) problems.push(`${spec.id} compatConflict`);
      if (decided.decision !== spec.expected.decision) problems.push(`${spec.id} decision ${decided.decision}`);
      if (decided.shownScriptIds.join(',') !== spec.expected.shownScriptIds.join(',')) problems.push(`${spec.id} shown`);
      if (decided.step !== spec.expectedStep) problems.push(`${spec.id} step ${decided.step}`);
      rows.push({
        id: spec.id,
        reason: spec.reason,
        sourceFacts: facts,
        sameRelArg: row.sameRelArg,
        polarConflict: row.polarConflict,
        exceptionEligible: row.exceptionEligible,
        leftoverHit: row.leftoverHit,
        waivedLeftover: row.waivedLeftover,
        compatConflict: row.conflict,
        decision: decided.decision,
        step: decided.step,
      });
    }
    writeFileSync(join(reportRoot(), 'body-statement.json'), `${JSON.stringify({ kind: 'BODY_STATEMENT', rows }, null, 2)}\n`);
    expect(problems).toEqual([]);
  });
});
