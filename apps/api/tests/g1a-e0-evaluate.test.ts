import { G1A_DELIVERY_PREFIX, readG1aDelivery, serializeG1aDelivery, type G1aCompletedRun } from './support/g1a-e0/report-contract.js';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchBackend } from '../src/search-service.js';
import {
  assertExecutableG1aControlledReport,
  assertScrubbedG1aReport,
  evaluateG1aPackage,
} from './support/g1a-e0/evaluate.js';
import type {
  G1aEvaluationPackage,
  G1aStratum,
} from './support/g1a-e0/input-package.js';

const RELEASE_ID = 'rel_g1a_eval_0001';
const SOURCE_BINDING_HASH = 'a'.repeat(64);
const CONTENT_HASH = 'b'.repeat(64);
const SCRIPT_ID = 'script_g1a_eval_0001';
type SearchSuccess = Extract<Awaited<ReturnType<SearchBackend['search']>>, { ok: true }>;
type SearchCandidate = SearchSuccess['candidates'][number];

afterEach(() => {
  vi.restoreAllMocks();
});

function stratumAt(index: number): G1aStratum {
  if (index < 20) return 'positive';
  if (index < 32) return 'safety_negative';
  return 'robustness';
}

function evaluationPackage(
  classification: 'synthetic' | 'approved_redacted',
): G1aEvaluationPackage {
  const cases = Array.from({ length: 50 }, (_, index) => Object.freeze({
    case_id: `case_g1a_${String(index + 1).padStart(3, '0')}`,
    stratum: stratumAt(index),
    query_text: `合成评测问法${index + 1}`,
    platform: index % 2 === 0 ? 'qianniu' as const : 'douyin' as const,
    product_context_type: null,
    product_context_ref: null,
    as_of: '2026-09-04T00:00:00.000Z',
    core_intent_id: 'intent_g1a_core',
    semantic_cluster_id: `cluster_g1a_${String(index + 1).padStart(3, '0')}`,
    source_asset_ids: Object.freeze(['asset_g1a_source']),
  }));
  const expectations = cases.map((testCase) => Object.freeze({
    case_id: testCase.case_id,
    expected_search_action: testCase.stratum === 'safety_negative' ? 'no_hit' as const : 'top3' as const,
    downstream_action: testCase.stratum === 'safety_negative' ? 'escalate' as const : 'none' as const,
    acceptable_script_ids: testCase.stratum === 'safety_negative'
      ? Object.freeze([])
      : Object.freeze([SCRIPT_ID]),
    forbidden_script_ids: Object.freeze([]),
  }));
  return Object.freeze({
    manifest_sha256: 'c'.repeat(64),
    manifest: {
      classification,
      eval_set_id: 'eval_set_g1a_0001',
      content_snapshot_id: 'snapshot_g1a_0001',
      content_snapshot_sha256: 'd'.repeat(64),
      release_id: RELEASE_ID,
      source_binding_hash: SOURCE_BINDING_HASH,
    },
    content: Object.freeze([{
      script_id: SCRIPT_ID,
      script_version: 1,
      content_hash: CONTENT_HASH,
      title: '合成标题',
      answer_text: '合成答案',
      domain: 'presale',
      platform_scope: Object.freeze(['qianniu', 'douyin']),
      product_scope_type: 'storewide',
      product_scope_refs: Object.freeze([]),
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_to: '2099-01-01T00:00:00.000Z',
      intent_taxonomy_version: 'itax_g1a_eval',
      intent_id: 'intent_g1a_core',
      risk_level: 'low',
      risk_categories: Object.freeze([]),
      has_conflict: false,
      placeholder_keys: Object.freeze([]),
    }]),
    cases: Object.freeze(cases),
    expectations: Object.freeze(expectations),
  } as unknown as G1aEvaluationPackage);
}

function backend(options: Readonly<{
  sourceBindingHash?: string;
  resultReleaseId?: string;
  candidateReleaseId?: string;
  candidatePatch?: Partial<SearchCandidate>;
  emptyCaseNumbers?: readonly number[];
  failedCaseNumbers?: readonly number[];
  thrownCaseNumbers?: readonly number[];
  returnForbiddenForSafety?: boolean;
}> = {}): SearchBackend {
  return Object.freeze({
    async search(request) {
      const caseNumber = Number(request.normalizedQuery.replace('合成评测问法', ''));
      if (options.thrownCaseNumbers?.includes(caseNumber)) throw new Error('synthetic backend failure');
      if (options.failedCaseNumbers?.includes(caseNumber)) {
        return Object.freeze({ ok: false as const, code: 'OVERLOADED' as const });
      }
      const safety = caseNumber >= 21 && caseNumber <= 32;
      const candidates = options.emptyCaseNumbers?.includes(caseNumber)
        || (safety && !options.returnForbiddenForSafety)
        ? Object.freeze([])
        : Object.freeze([{
          rank: 1,
          release_id: options.candidateReleaseId ?? RELEASE_ID,
          script_id: SCRIPT_ID,
          script_version: 1,
          content_hash: CONTENT_HASH,
          title: '合成标题',
          category: 'presale' as const,
          answer_text: '合成答案',
          platform_scope: ['qianniu', 'douyin'] as ('qianniu' | 'douyin')[],
          product_scope_type: 'storewide' as const,
          product_scope_refs: [] as string[],
          effective_from: '2020-01-01T00:00:00.000Z',
          effective_to: '2099-01-01T00:00:00.000Z',
          intent_taxonomy_version: 'itax_g1a_eval',
          intent_id: 'intent_g1a_core',
          risk_level: 'low' as const,
          risk_categories: [] as ('refund_compensation' | 'price_discount')[],
          has_conflict: false,
          placeholder_keys: [] as ('order_id' | 'date')[],
          ...options.candidatePatch,
        }]);
      return Object.freeze({
        ok: true as const,
        releaseId: options.resultReleaseId ?? RELEASE_ID,
        sourceBindingHash: options.sourceBindingHash ?? SOURCE_BINDING_HASH,
        decision: candidates.length > 0 ? 'show' as const : 'reject' as const,
        candidates,
      });
    },
  });
}

function withExpectations(
  input: G1aEvaluationPackage,
  mutate: (expectation: G1aEvaluationPackage['expectations'][number], index: number) => G1aEvaluationPackage['expectations'][number],
): G1aEvaluationPackage {
  return Object.freeze({
    ...input,
    expectations: Object.freeze(input.expectations.map(mutate)),
  });
}

describe('G1A-E0 aggregate evaluator', () => {
  it('retains all 50 case outcomes without turning backend errors into no-hit evidence', async () => {
    const report = await evaluateG1aPackage(
      backend({ emptyCaseNumbers: [3], failedCaseNumbers: [1], thrownCaseNumbers: [2] }),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );
    expect(report.case_results).toHaveLength(50);
    expect(report.case_results.map((row) => row.case_id))
      .toEqual(evaluationPackage('approved_redacted').cases.map((row) => row.case_id));
    expect(report.case_results.slice(0, 3)).toMatchObject([
      { outcome: 'backend_error', candidates: [], search_action_correct: false, failure_codes: ['BACKEND_ERROR'] },
      { outcome: 'backend_error', candidates: [], search_action_correct: false, failure_codes: ['BACKEND_ERROR'] },
      { outcome: 'no_hit', candidates: [], search_action_correct: false, failure_codes: ['EXPECTED_TOP3_MISS'] },
    ]);
    expect(report.case_results[3]).toMatchObject({
      outcome: 'hit', search_action_correct: true,
      candidates: [{ rank: 1, script_id: SCRIPT_ID, script_version: 1, content_hash: CONTENT_HASH,
        release_id: RELEASE_ID, provenance_valid: true }],
      failure_codes: [],
    });
    expect(report.case_results[20]).toMatchObject({
      stratum: 'safety_negative', outcome: 'no_hit', search_action_correct: true,
      expected_search_action: 'no_hit', expected_downstream_action: 'escalate', candidates: [],
    });
    expect(report.case_results.filter((row) => row.outcome === 'backend_error')).toHaveLength(report.raw.backend_errors);
    expect(report.case_results.flatMap((row) => row.candidates)).toHaveLength(report.raw.source_checked);
    expect(report.case_results.filter((row) => row.stratum === 'positive' && row.search_action_correct))
      .toHaveLength(report.strata.positive.search_action_correct);
    expect(report.downstream_action_evaluation).toBe('NOT_EVALUATED');
    expect(() => assertScrubbedG1aReport(report)).not.toThrow();
    expect(JSON.stringify(report.case_results)).not.toMatch(/合成评测问法|合成答案|synthetic backend failure/);
  });

  it('preserves candidate provenance failures separately from search-action matches', async () => {
    const report = await evaluateG1aPackage(
      backend({ candidatePatch: { content_hash: 'e'.repeat(64) } }),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );
    expect(report.case_results[0]).toMatchObject({
      outcome: 'hit', search_action_correct: true,
      candidates: [{ content_hash: 'e'.repeat(64), provenance_valid: false }],
      failure_codes: ['CANDIDATE_PROVENANCE_INVALID'],
    });
    expect(report.decision).toBe('FAIL');
    expect(report.raw.source_correct).toBe(0);
  });

  it('retains every ranked candidate identity without copying candidate text', async () => {
    const original = backend();
    const report = await evaluateG1aPackage({
      async search(request) {
        const result = await original.search(request);
        if (!result.ok || result.candidates.length === 0) return result;
        return { ...result, candidates: [result.candidates[0]!,
          { ...result.candidates[0]!, rank: 2, script_id: 'script_synthetic_second' },
          { ...result.candidates[0]!, rank: 3, script_id: 'script_synthetic_third' }] };
      },
    }, evaluationPackage('synthetic'), { eventWrites: 0, processGuardAttempts: 0 });
    expect(report.case_results[0]?.candidates.map((candidate) => [candidate.rank, candidate.script_id]))
      .toEqual([[1, SCRIPT_ID], [2, 'script_synthetic_second'], [3, 'script_synthetic_third']]);
    expect(report.case_results[0]?.candidates.map((candidate) => candidate.provenance_valid))
      .toEqual([true, false, false]);
    expect(report.raw.source_checked).toBe(38 * 3);
    expect(() => assertScrubbedG1aReport(report)).not.toThrow();
    expect(JSON.stringify(report.case_results)).not.toContain('合成');
  });

  it('keeps a fully successful synthetic substitute unsigned and not evaluated', async () => {
    const report = await evaluateG1aPackage(
      backend(),
      evaluationPackage('synthetic'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(report).toMatchObject({
      status: 'NOT_SIGNED',
      runner_result: 'EXECUTABLE',
      decision: 'NOT_EVALUATED',
      search_action_result: 'NOT_EVALUATED',
      business_accuracy_claim: 'NOT_EVALUATED',
      downstream_action_evaluation: 'NOT_EVALUATED',
      denominator: 50,
      raw: {
        positive_top3_hits: 20,
        safety_no_hits: 12,
        robustness_search_action_correct: 18,
        backend_errors: 0,
        event_writes: 0,
        process_guard_attempts: 0,
      },
      failures: [],
    });
    expect(() => assertScrubbedG1aReport(report)).not.toThrow();
    expect(JSON.stringify(report)).not.toContain('合成评测问法');
    expect(JSON.stringify(report)).not.toContain('合成答案');
  });

  it('keeps the overall decision under review when only approved-redacted search actions pass', async () => {
    const report = await evaluateG1aPackage(
      backend(),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(report).toMatchObject({
      status: 'NOT_SIGNED',
      runner_result: 'EXECUTABLE',
      decision: 'REVIEW_REQUIRED',
      search_action_result: 'PASS_CANDIDATE',
      business_accuracy_claim: 'CANDIDATE_ONLY',
      downstream_action_evaluation: 'NOT_EVALUATED',
    });
    expect(() => assertExecutableG1aControlledReport(report)).not.toThrow();
  });

  it('fails closed on a release-source binding mismatch', async () => {
    const report = await evaluateG1aPackage(
      backend({ sourceBindingHash: 'e'.repeat(64) }),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(report.runner_result).toBe('FAILED');
    expect(report.decision).toBe('FAIL');
    expect(report.search_action_result).toBe('FAIL');
    expect(() => assertExecutableG1aControlledReport(report))
      .toThrow('G1A_EVALUATION_NOT_EXECUTABLE');
    expect(report.failures.some((failure) => failure.code === 'SOURCE_BINDING_MISMATCH')).toBe(true);
  });

  it('fails closed when the backend reports another release', async () => {
    const report = await evaluateG1aPackage(
      backend({ resultReleaseId: 'rel_g1a_eval_other' }),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(report.runner_result).toBe('FAILED');
    expect(report.decision).toBe('FAIL');
    expect(report.failures.some((failure) => failure.code === 'RELEASE_MISMATCH')).toBe(true);
  });

  it('fails closed when a candidate row belongs to another release', async () => {
    const report = await evaluateG1aPackage(
      backend({ candidateReleaseId: 'rel_g1a_eval_other' }),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(report.runner_result).toBe('FAILED');
    expect(report.decision).toBe('FAIL');
    expect(report.failures.some((failure) => failure.code === 'CANDIDATE_PROVENANCE_INVALID')).toBe(true);
  });

  it('rejects candidate field drift across the frozen provenance tuple', async () => {
    const patches: readonly Partial<SearchCandidate>[] = [
      { content_hash: 'e'.repeat(64) },
      { platform_scope: ['qianniu'] },
      { product_scope_type: 'sku', product_scope_refs: ['sku_g1a_other'] },
      { effective_to: '2021-01-01T00:00:00.000Z' },
    ];

    for (const candidatePatch of patches) {
      const report = await evaluateG1aPackage(
        backend({ candidatePatch }),
        evaluationPackage('approved_redacted'),
        { eventWrites: 0, processGuardAttempts: 0 },
      );
      expect(report.decision).toBe('FAIL');
      expect(report.failures.some((failure) => failure.code === 'CANDIDATE_PROVENANCE_INVALID')).toBe(true);
    }
  });

  it('normalizes returned and thrown backend failures without leaking their errors', async () => {
    const report = await evaluateG1aPackage(
      backend({ failedCaseNumbers: [1], thrownCaseNumbers: [2] }),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(report).toMatchObject({ runner_result: 'FAILED', decision: 'FAIL' });
    expect(report.raw.backend_errors).toBe(2);
    expect(report.failures.filter((failure) => failure.code === 'BACKEND_ERROR'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ backend_code: 'OVERLOADED' }),
        expect.objectContaining({ backend_code: 'THREW' }),
      ]));
    expect(JSON.stringify(report)).not.toContain('synthetic backend failure');
  });

  it('enforces the positive total and per-stratum thresholds', async () => {
    const report = await evaluateG1aPackage(
      backend({ emptyCaseNumbers: [1, 3, 5, 7, 9, 11, 13] }),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(report.decision).toBe('FAIL');
    expect(report.raw.positive_top3_hits).toBe(13);
    expect(report.failures.some((failure) => failure.code === 'POSITIVE_THRESHOLD_MISSED')).toBe(true);
    expect(report.failures.some((failure) => failure.code === 'STRATUM_THRESHOLD_MISSED')).toBe(true);
  });

  it('treats safety no-hit and forbidden-return violations as hard failures', async () => {
    const input = withExpectations(
      evaluationPackage('approved_redacted'),
      (expectation, index) => index === 20
        ? Object.freeze({ ...expectation, forbidden_script_ids: Object.freeze([SCRIPT_ID]) })
        : expectation,
    );
    const report = await evaluateG1aPackage(
      backend({ returnForbiddenForSafety: true }),
      input,
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(report.decision).toBe('FAIL');
    expect(report.raw.safety_no_hits).toBe(0);
    expect(report.failures.some((failure) => failure.code === 'FORBIDDEN_RETURNED')).toBe(true);
    expect(report.failures.some((failure) => failure.code === 'SAFETY_THRESHOLD_MISSED')).toBe(true);
  });

  it('requires review rather than claiming pass when a frozen robustness expectation is wrong', async () => {
    const robustnessCases = Array.from({ length: 18 }, (_, index) => index + 33);
    const report = await evaluateG1aPackage(
      backend({ emptyCaseNumbers: robustnessCases }),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(report.raw.robustness_search_action_correct).toBe(0);
    expect(report.runner_result).toBe('EXECUTABLE');
    expect(report.decision).toBe('REVIEW_REQUIRED');
    expect(report.search_action_result).toBe('REVIEW_REQUIRED');
    expect(report.failures.filter((failure) => failure.code === 'EXPECTED_TOP3_MISS')).toHaveLength(18);
    expect(() => assertExecutableG1aControlledReport(report)).not.toThrow();
  });

  it('rejects a synthetic report at the controlled-package execution gate', async () => {
    const report = await evaluateG1aPackage(
      backend(),
      evaluationPackage('synthetic'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(() => assertExecutableG1aControlledReport(report))
      .toThrow('G1A_EVALUATION_NOT_EXECUTABLE');
  });

  it('fails when event writes or process-guarded network attempts are observed', async () => {
    const report = await evaluateG1aPackage(
      backend(),
      evaluationPackage('approved_redacted'),
      { eventWrites: 1, processGuardAttempts: 1 },
    );

    expect(report.decision).toBe('FAIL');
    expect(report.failures.some((failure) => failure.code === 'EVENT_WRITE_DETECTED')).toBe(true);
    expect(report.failures.some((failure) => failure.code === 'NETWORK_ATTEMPT_DETECTED')).toBe(true);
  });

  it('enforces the local p95 budget deterministically', async () => {
    let invocation = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const pair = Math.floor(invocation / 2);
      const isEnd = invocation % 2 === 1;
      invocation += 1;
      return (pair * 1_000) + (isEnd ? (pair < 3 ? 301 : 1) : 0);
    });

    const report = await evaluateG1aPackage(
      backend(),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(report.raw.local_p95_ms).toBe(301);
    expect(report.decision).toBe('FAIL');
    expect(report.failures.some((failure) => failure.code === 'LOCAL_P95_BUDGET_MISSED')).toBe(true);
  });

  it('refuses to emit a report when an identifier contains PII-shaped digits', async () => {
    const piiShapedId = `script_${['138', '0013', '8000'].join('-')}`;
    const report = await evaluateG1aPackage(
      backend({ candidatePatch: { script_id: piiShapedId } }),
      evaluationPackage('approved_redacted'),
      { eventWrites: 0, processGuardAttempts: 0 },
    );

    expect(() => assertScrubbedG1aReport(report)).toThrow('G1A_REPORT_NOT_SCRUBBED');
  });
});


describe('versioned safe G1a delivery contract', () => {
  async function completed(options: Parameters<typeof backend>[0] = {}): Promise<G1aCompletedRun> {
    return { report: await evaluateG1aPackage(backend(options), evaluationPackage('approved_redacted'), { eventWrites: 0, processGuardAttempts: 0 }),
      // Unit fixture only. Actual PG15 evidence is exercised in the integration suite.
      runtime: { postgres_major: 15, transaction_timestamp: '2026-09-06T00:00:00.000Z', transaction_isolation: 'read committed',
        transaction_read_only: true, event_rows_before: 0, event_rows_after: 0, network_boundary: 'NODE_TCP_FETCH_GUARD_ONLY', cleanup_verified: true } };
  }
  it.each([{}, { emptyCaseNumbers: [1] }, { failedCaseNumbers: [1] }, { emptyCaseNumbers: Array.from({ length: 20 }, (_, i) => i + 1) }])('retains complete observations and legitimate failures: %j', async (options) => {
    const run = await completed(options);
    const line = serializeG1aDelivery(run);
    const delivery = readG1aDelivery(line,run.report.manifest_sha256);
    expect(delivery.report.case_results).toHaveLength(50);
    expect(delivery.report.raw).toEqual(run.report.raw);
    expect(delivery.report.decision).toEqual(run.report.decision);
    expect(line).not.toContain(SCRIPT_ID);
    expect(line).not.toContain(RELEASE_ID);
    expect(delivery.report.case_results[0]?.case_id).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects missing rows, contradictions, unknown fields, unsupported versions and failed cleanup', async () => {
    const run = await completed();
    const line = serializeG1aDelivery(run);
    const safe = readG1aDelivery(line,run.report.manifest_sha256);
    const mutations: Array<(value: typeof safe) => void> = [
      (v) => { Object.assign(v, { schema: 'unsupported' }); },
      (v) => { Object.assign(v.report, { answer_text: 'sensitive text' }); },
      (v) => { Object.assign(v.report, { denominator: 49 }); },
      (v) => { Object.assign(v.report.raw, { positive_top3_hits: 19 }); },
      (v) => { Object.assign(v.report.case_results[0]!, { search_action_correct: false }); },
      (v) => { Object.assign(v.report.case_results[0]!, { expected_downstream_action: 'send_automatically' }); },
      (v) => { Object.assign(v.report.case_results[0]!, { case_id: 'private text' }); },
      (v) => { Object.assign(v.report.case_results[0]!.candidates[0]!, { answer_text: 'private text' }); },
      (v) => { Object.assign(v.report, { case_results: v.report.case_results.slice(1) }); },
      (v) => { Object.assign(v.report, { case_results: [v.report.case_results[1], ...v.report.case_results.slice(1)] }); },
      (v) => { Object.assign(v.runtime, { cleanup_verified: false }); },
      (v) => { Object.assign(v.runtime, { transaction_read_only: false }); },
      (v) => { Object.assign(v.runtime, { event_rows_after: 1 }); },
      (v) => { Object.assign(v.report, { decision: 'FAIL' }); },
      (v) => { Object.assign(v.report.thresholds, { positive_top3_minimum: 1 }); },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(safe); mutate(value);
      expect(() => readG1aDelivery(G1A_DELIVERY_PREFIX + JSON.stringify(value),run.report.manifest_sha256)).toThrow('G1A_DELIVERY_INVALID');
    }
    expect(() => readG1aDelivery(line + line,run.report.manifest_sha256)).toThrow('G1A_DELIVERY_INVALID');
    expect(() => readG1aDelivery('',run.report.manifest_sha256)).toThrow('G1A_DELIVERY_INVALID');
    expect(() => readG1aDelivery(line,'f'.repeat(64))).toThrow('G1A_DELIVERY_INVALID');
    expect(() => serializeG1aDelivery({ ...run,runtime: { ...run.runtime,cleanup_verified: false } } as unknown as G1aCompletedRun)).toThrow('G1A_DELIVERY_INVALID');
  });
  it('rejects a release mismatch claiming valid provenance at both delivery boundaries', async () => {
    const run = await completed();
    const changed = structuredClone(run);
    Object.assign(changed.report.case_results[0]!.candidates[0]!, { release_id: 'rel_different' });
    expect(() => serializeG1aDelivery(changed)).toThrow('G1A_DELIVERY_INVALID');
    const safe = structuredClone(readG1aDelivery(serializeG1aDelivery(run),run.report.manifest_sha256));
    Object.assign(safe.report.case_results[0]!.candidates[0]!, { release_id: 'f'.repeat(64) });
    expect(() => readG1aDelivery(G1A_DELIVERY_PREFIX + JSON.stringify(safe),run.report.manifest_sha256)).toThrow('G1A_DELIVERY_INVALID');
  });
  it('preserves legitimate release provenance failures as complete failed reports', async () => {
    const run = await completed({ candidateReleaseId: 'rel_different' });
    const safe = readG1aDelivery(serializeG1aDelivery(run),run.report.manifest_sha256);
    expect(safe.report.decision).toBe('FAIL');
    expect(safe.report.case_results).toHaveLength(50);
    expect(safe.report.case_results[0]!.candidates[0]!).toMatchObject({ provenance_valid: false });
    expect(safe.report.case_results[0]!.candidates[0]!.release_id).not.toBe(safe.report.release_id);
    expect(safe.report.case_results[0]!.failure_codes).toContain('CANDIDATE_PROVENANCE_INVALID');
    expect(safe.report.raw.source_correct).toBe(0);
  });
  it('rejects a missing aggregate failure even when another hard failure remains', async () => {
    const run = await completed({ emptyCaseNumbers: Array.from({length:20},(_,i) => i + 1) });
    const safe = structuredClone(readG1aDelivery(serializeG1aDelivery(run),run.report.manifest_sha256));
    Object.assign(safe.report,{ failures: safe.report.failures.filter((f) => f.code !== 'POSITIVE_THRESHOLD_MISSED') });
    expect(() => readG1aDelivery(G1A_DELIVERY_PREFIX + JSON.stringify(safe),run.report.manifest_sha256)).toThrow('G1A_DELIVERY_INVALID');
  });
});
