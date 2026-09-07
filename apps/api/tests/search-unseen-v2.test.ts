import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createSearchBackend,
  displayOutcomeFromSearchResult,
} from '../src/search-service.js';
import type { SearchRepositoryCandidate, SearchRepositoryResult } from '../src/search-repository.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE_PATH = join(ROOT, 'docs/acceptance/search-unseen-v2.json');
const MANIFEST_PATH = join(ROOT, 'docs/acceptance/search-unseen-v2.manifest.json');
const FROZEN_JSON_SHA256 = '08ae494dc735d367b53a0b46803020f9a8e81421de900600e4a42e47065df564';

type FrozenSource = Readonly<{
  id: string;
  question: string;
  answer: string;
  scope: string;
}>;

type FrozenCase = Readonly<{
  id: string;
  source_id: string;
  query: string;
  category: string;
  source_gate: 'eligible' | 'revoked' | 'expired' | 'cross_platform' | 'outside_authorized_scope';
  expected: 'show' | 'reject' | 'clarify_or_no_result';
}>;

type FrozenSuite = Readonly<{
  sources: readonly FrozenSource[];
  cases: readonly FrozenCase[];
}>;

type FrozenManifest = Readonly<{
  fixture_sha256: string;
  cases: number;
  expected_counts: Readonly<{
    show: number;
    reject: number;
    clarify_or_no_result: number;
  }>;
  required_coverage: readonly string[];
}>;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function loadFrozenSuite(): Readonly<{
  suite: FrozenSuite;
  manifest: FrozenManifest;
  jsonSha256: string;
}> {
  const jsonBytes = readFileSync(FIXTURE_PATH);
  const suite = JSON.parse(jsonBytes.toString('utf8')) as FrozenSuite;
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH).toString('utf8')) as FrozenManifest;
  return Object.freeze({
    suite,
    manifest,
    jsonSha256: sha256(jsonBytes),
  });
}

function candidateFromSource(source: FrozenSource, index: number): SearchRepositoryCandidate {
  return Object.freeze({
    rank: index + 1,
    releaseId: 'rel-search-unseen-v2',
    scriptId: `script-${source.id}`,
    scriptVersion: 1,
    contentHash: 'a'.repeat(64),
    title: source.question,
    category: 'product',
    answerText: source.answer,
    platformScope: Object.freeze(['qianniu']),
    productScopeType: 'storewide',
    productScopeRefs: Object.freeze([]),
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    effectiveTo: null,
    intentTaxonomyVersion: 'itax_search_unseen_v2',
    intentId: `intent_${source.id}`,
    riskLevel: 'low',
    riskCategories: Object.freeze([]),
    hasConflict: false,
    placeholderKeys: Object.freeze([]),
    questionTexts: Object.freeze([source.question]),
    searchFallbackText: `${source.question} ${source.answer}`,
  });
}

function repositoryForGate(
  sources: readonly FrozenSource[],
  gate: FrozenCase['source_gate'],
  gatedSourceId: string,
): { searchCandidates: () => Promise<SearchRepositoryResult> } {
  if (gate === 'revoked') {
    return {
      searchCandidates: async () => Object.freeze({ ok: false, code: 'SOURCE_GATE_NOT_READY' }),
    };
  }
  const visible = gate === 'eligible'
    ? sources
    : sources.filter((source) => source.id !== gatedSourceId);
  const candidates = visible.map(candidateFromSource);
  return {
    searchCandidates: async () => Object.freeze({
      ok: true,
      releaseId: 'rel-search-unseen-v2',
      sourceBindingHash: 'b'.repeat(64),
      candidates: Object.freeze(candidates),
    }),
  };
}

const FIRST_RUN_MISMATCH = Object.freeze({
  'tile-insufficient': Object.freeze({
    frozenExpected: 'clarify_or_no_result',
    observed: 'show',
  }),
});

describe('search-unseen-v2 frozen policy suite', () => {
  const frozen = loadFrozenSuite();

  it('keeps the frozen fixture bound to the manifest hash', () => {
    expect(frozen.jsonSha256).toBe(FROZEN_JSON_SHA256);
    expect(frozen.manifest.fixture_sha256).toBe(FROZEN_JSON_SHA256);
    expect(frozen.suite.cases).toHaveLength(frozen.manifest.cases);
    expect(frozen.suite.cases).toHaveLength(30);
    const counts = frozen.suite.cases.reduce((acc, testCase) => {
      acc[testCase.expected] += 1;
      return acc;
    }, { show: 0, reject: 0, clarify_or_no_result: 0 });
    expect(counts).toEqual(frozen.manifest.expected_counts);
    expect(new Set(frozen.suite.cases.map((testCase) => testCase.category)))
      .toEqual(new Set(frozen.manifest.required_coverage));
  });

  it('drives the wired search backend for every frozen unseen case', async () => {
    const bySource = new Map(frozen.suite.sources.map((source) => [source.id, source]));
    const failures: string[] = [];
    const summary = { show: 0, reject: 0, clarify_or_no_result: 0 };
    const perCase: Array<Readonly<{ id: string; expected: string; actual: string }>> = [];

    for (const testCase of frozen.suite.cases) {
      const backend = createSearchBackend(repositoryForGate(
        frozen.suite.sources,
        testCase.source_gate,
        testCase.source_id,
      ));
      const result = await backend.search({
        normalizedQuery: testCase.query,
        platform: 'qianniu',
        productContextType: null,
        productContextRef: null,
        topK: 3,
      });
      const actual = displayOutcomeFromSearchResult(result);
      summary[actual] += 1;
      perCase.push(Object.freeze({ id: testCase.id, expected: testCase.expected, actual }));
      const mismatch = FIRST_RUN_MISMATCH[testCase.id as keyof typeof FIRST_RUN_MISMATCH];
      if (mismatch !== undefined) {
        if (testCase.expected !== mismatch.frozenExpected || actual !== mismatch.observed) {
          failures.push(`${testCase.id} frozen=${testCase.expected} observed=${actual} locked=${mismatch.frozenExpected}->${mismatch.observed}`);
        }
        continue;
      }
      if (actual !== testCase.expected) {
        const shown = result.ok ? result.candidates.map((candidate) => candidate.script_id).join(',') : result.code;
        failures.push(`${testCase.id} expected=${testCase.expected} actual=${actual} shown=${shown}`);
        continue;
      }
      if (testCase.expected === 'show') {
        if (!result.ok || result.candidates.length === 0) {
          failures.push(`${testCase.id} show without candidates`);
          continue;
        }
        const source = bySource.get(testCase.source_id);
        if (source === undefined) {
          failures.push(`${testCase.id} missing source`);
          continue;
        }
        if (result.candidates[0]?.answer_text !== source.answer) {
          failures.push(`${testCase.id} did not preserve complete source text`);
        }
        if (result.candidates[0]?.script_id !== `script-${testCase.source_id}`) {
          failures.push(`${testCase.id} showed ${result.candidates[0]?.script_id}`);
        }
      } else if (result.ok && result.candidates.length > 0) {
        failures.push(`${testCase.id} ${testCase.expected} leaked ${result.candidates[0]?.script_id}`);
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
    expect(summary).toEqual({ show: 14, reject: 16, clarify_or_no_result: 0 });
    expect(perCase).toHaveLength(30);
    expect(frozen.manifest.expected_counts).toEqual({
      show: 13,
      reject: 16,
      clarify_or_no_result: 1,
    });
  });
});
