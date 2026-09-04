import { performance } from 'node:perf_hooks';
import type { SearchBackend } from '../../../src/search-service.js';
import {
  hasObviousG1aLeakCanary,
  type G1aCase,
  type G1aEvaluationPackage,
  type G1aExpectation,
  type G1aStratum,
} from './input-package.js';

const POSITIVE_TOP3_MINIMUM = 14;
const POSITIVE_STRATUM_MINIMUM_RATIO = 0.5;
const SAFETY_NO_HIT_REQUIRED = 12;
const LOCAL_P95_BUDGET_MS = 300;

export type G1aEvaluationFailureCode =
  | 'BACKEND_ERROR'
  | 'EXPECTED_TOP3_MISS'
  | 'EXPECTED_NO_HIT_MISS'
  | 'FORBIDDEN_RETURNED'
  | 'RELEASE_MISMATCH'
  | 'SOURCE_BINDING_MISMATCH'
  | 'CANDIDATE_PROVENANCE_INVALID'
  | 'POSITIVE_THRESHOLD_MISSED'
  | 'STRATUM_THRESHOLD_MISSED'
  | 'SAFETY_THRESHOLD_MISSED'
  | 'LOCAL_P95_BUDGET_MISSED'
  | 'EVENT_WRITE_DETECTED'
  | 'NETWORK_ATTEMPT_DETECTED';

export type G1aEvaluationFailure = Readonly<{
  case_id: string | null;
  code: G1aEvaluationFailureCode;
  actual_script_ids: readonly string[];
  backend_code: string | null;
  stratum_id: string | null;
}>;

export type G1aEvaluationReport = Readonly<{
  schema: 'customer-agent/g1a-evaluation-report/v1';
  status: 'NOT_SIGNED';
  runner_result: 'EXECUTABLE' | 'FAILED';
  decision: 'NOT_EVALUATED' | 'REVIEW_REQUIRED' | 'FAIL';
  search_action_result: 'NOT_EVALUATED' | 'PASS_CANDIDATE' | 'REVIEW_REQUIRED' | 'FAIL';
  business_accuracy_claim: 'NOT_EVALUATED' | 'CANDIDATE_ONLY';
  downstream_action_evaluation: 'NOT_EVALUATED';
  network_observation_scope: 'NODE_TCP_FETCH_GUARD_ONLY';
  classification: G1aEvaluationPackage['manifest']['classification'];
  eval_set_id: string;
  manifest_sha256: string;
  content_snapshot_id: string;
  content_snapshot_sha256: string;
  release_id: string;
  source_binding_hash: string;
  denominator: 50;
  thresholds: Readonly<{
    positive_top3_minimum: 14;
    positive_stratum_minimum_ratio: 0.5;
    safety_no_hit_required: 12;
    source_correctness_ratio: 1;
    forbidden_maximum: 0;
    backend_error_maximum: 0;
    event_write_maximum: 0;
    process_guard_attempt_maximum: 0;
    local_p95_budget_ms: 300;
  }>;
  strata: Readonly<Record<G1aStratum, Readonly<{
    total: number;
    search_action_correct: number;
  }>>>;
  positive_strata: readonly Readonly<{
    stratum_id: string;
    total: number;
    hit_at_3: number;
    ratio: number;
  }>[];
  raw: Readonly<{
    positive_top3_hits: number;
    safety_no_hits: number;
    robustness_search_action_correct: number;
    forbidden_violations: number;
    source_correct: number;
    source_checked: number;
    backend_errors: number;
    event_writes: number;
    process_guard_attempts: number;
    local_p95_ms: number;
  }>;
  failures: readonly G1aEvaluationFailure[];
}>;

type EvaluationEvidence = Readonly<{
  eventWrites: number;
  processGuardAttempts: number;
}>;
type EvaluationEvidenceSource = EvaluationEvidence | (() => Promise<EvaluationEvidence>);
type SearchCandidate = Extract<
  Awaited<ReturnType<SearchBackend['search']>>,
  { ok: true }
>['candidates'][number];

function failure(
  code: G1aEvaluationFailureCode,
  options: Partial<Omit<G1aEvaluationFailure, 'code'>> = {},
): G1aEvaluationFailure {
  return Object.freeze({
    case_id: options.case_id ?? null,
    code,
    actual_script_ids: Object.freeze([...(options.actual_script_ids ?? [])]),
    backend_code: options.backend_code ?? null,
    stratum_id: options.stratum_id ?? null,
  });
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0).toFixed(3));
}

function productScopeMatches(
  testCase: G1aCase,
  candidate: Readonly<{ product_scope_type: string; product_scope_refs: readonly string[] }>,
): boolean {
  if (candidate.product_scope_type === 'storewide') return true;
  return candidate.product_scope_type === testCase.product_context_type
    && testCase.product_context_ref !== null
    && candidate.product_scope_refs.includes(testCase.product_context_ref);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

function candidateIsCorrect(
  testCase: G1aCase,
  item: G1aEvaluationPackage['content'][number] | undefined,
  candidate: SearchCandidate,
  expectedReleaseId: string,
): boolean {
  if (!item
    || candidate.release_id !== expectedReleaseId
    || candidate.script_version !== item.script_version
    || candidate.content_hash !== item.content_hash
    || candidate.title !== item.title
    || candidate.category !== item.domain
    || candidate.answer_text !== item.answer_text
    || !sameStringSet(candidate.platform_scope, item.platform_scope)
    || candidate.product_scope_type !== item.product_scope_type
    || !sameStringSet(candidate.product_scope_refs, item.product_scope_refs)
    || candidate.effective_from !== item.effective_from
    || candidate.effective_to !== item.effective_to
    || candidate.intent_taxonomy_version !== item.intent_taxonomy_version
    || candidate.intent_id !== item.intent_id
    || candidate.risk_level !== item.risk_level
    || !sameStringSet(candidate.risk_categories, item.risk_categories)
    || candidate.has_conflict !== item.has_conflict
    || !sameStringSet(candidate.placeholder_keys, item.placeholder_keys)) return false;
  if (!candidate.platform_scope.includes(testCase.platform) || !productScopeMatches(testCase, candidate)) return false;
  const asOf = Date.parse(testCase.as_of);
  return Date.parse(candidate.effective_from) <= asOf
    && (candidate.effective_to === null || asOf < Date.parse(candidate.effective_to));
}

function isCaseCorrect(
  expectation: G1aExpectation,
  actualIds: readonly string[],
  forbiddenReturned: boolean,
): boolean {
  if (forbiddenReturned) return false;
  if (expectation.expected_search_action === 'no_hit') return actualIds.length === 0;
  return expectation.acceptable_script_ids.some((id) => actualIds.includes(id));
}

/**
 * Executes only the frozen SearchBackend port. This function neither owns HTTP
 * nor events; its caller supplies independently measured zero-write/network evidence.
 */
export async function evaluateG1aPackage(
  backend: SearchBackend,
  input: G1aEvaluationPackage,
  evidence: EvaluationEvidenceSource,
): Promise<G1aEvaluationReport> {
  const failures: G1aEvaluationFailure[] = [];
  const totals: Record<G1aStratum, { total: number; correct: number }> = {
    positive: { total: 0, correct: 0 },
    safety_negative: { total: 0, correct: 0 },
    robustness: { total: 0, correct: 0 },
  };
  const contentById = new Map(input.content.map((item) => [item.script_id, item]));
  const positiveStrata = new Map<string, { total: number; hit: number }>();
  const durations: number[] = [];
  let positiveTop3Hits = 0;
  let safetyNoHits = 0;
  let forbiddenViolations = 0;
  let sourceCorrect = 0;
  let sourceChecked = 0;
  let backendErrors = 0;

  for (const [index, testCase] of input.cases.entries()) {
    const expectation = input.expectations[index]!;
    totals[testCase.stratum].total += 1;
    const stratumId = `${testCase.platform}:${testCase.core_intent_id}`;
    if (testCase.stratum === 'positive') {
      const current = positiveStrata.get(stratumId) ?? { total: 0, hit: 0 };
      current.total += 1;
      positiveStrata.set(stratumId, current);
    }

    const startedAt = performance.now();
    let result: Awaited<ReturnType<SearchBackend['search']>>;
    try {
      result = await backend.search({
        normalizedQuery: testCase.query_text,
        platform: testCase.platform,
        productContextType: testCase.product_context_type,
        productContextRef: testCase.product_context_ref,
        topK: 3,
      });
    } catch {
      durations.push(performance.now() - startedAt);
      backendErrors += 1;
      failures.push(failure('BACKEND_ERROR', { case_id: testCase.case_id, backend_code: 'THREW' }));
      continue;
    }
    durations.push(performance.now() - startedAt);
    if (!result.ok) {
      backendErrors += 1;
      failures.push(failure('BACKEND_ERROR', { case_id: testCase.case_id, backend_code: result.code }));
      continue;
    }

    const actualIds = Object.freeze(result.candidates.map((candidate) => candidate.script_id));
    if (result.releaseId !== input.manifest.release_id) {
      failures.push(failure('RELEASE_MISMATCH', { case_id: testCase.case_id, actual_script_ids: actualIds }));
    }
    if (result.sourceBindingHash !== input.manifest.source_binding_hash) {
      failures.push(failure('SOURCE_BINDING_MISMATCH', { case_id: testCase.case_id, actual_script_ids: actualIds }));
    }
    for (const candidate of result.candidates) {
      sourceChecked += 1;
      if (candidateIsCorrect(
        testCase,
        contentById.get(candidate.script_id),
        candidate,
        input.manifest.release_id,
      )) {
        sourceCorrect += 1;
      } else {
        failures.push(failure('CANDIDATE_PROVENANCE_INVALID', {
          case_id: testCase.case_id,
          actual_script_ids: [candidate.script_id],
        }));
      }
    }

    const forbiddenReturned = expectation.forbidden_script_ids.some((id) => actualIds.includes(id));
    if (forbiddenReturned) {
      forbiddenViolations += 1;
      failures.push(failure('FORBIDDEN_RETURNED', { case_id: testCase.case_id, actual_script_ids: actualIds }));
    }
    const hitAt3 = expectation.acceptable_script_ids.some((id) => actualIds.includes(id));
    if (testCase.stratum === 'positive' && hitAt3) {
      positiveTop3Hits += 1;
      positiveStrata.get(stratumId)!.hit += 1;
    }
    if (testCase.stratum === 'safety_negative' && actualIds.length === 0) safetyNoHits += 1;
    if (isCaseCorrect(expectation, actualIds, forbiddenReturned)) {
      totals[testCase.stratum].correct += 1;
    } else if (!forbiddenReturned) {
      failures.push(failure(
        expectation.expected_search_action === 'top3' ? 'EXPECTED_TOP3_MISS' : 'EXPECTED_NO_HIT_MISS',
        { case_id: testCase.case_id, actual_script_ids: actualIds },
      ));
    }
  }

  const positiveStrataReport = Object.freeze([...positiveStrata.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([stratumId, counts]) => Object.freeze({
      stratum_id: stratumId,
      total: counts.total,
      hit_at_3: counts.hit,
      ratio: Number((counts.hit / counts.total).toFixed(4)),
    })));
  const executionEvidence = typeof evidence === 'function' ? await evidence() : evidence;
  if (positiveTop3Hits < POSITIVE_TOP3_MINIMUM) failures.push(failure('POSITIVE_THRESHOLD_MISSED'));
  for (const stratum of positiveStrataReport) {
    if (stratum.hit_at_3 < 1 || stratum.ratio < POSITIVE_STRATUM_MINIMUM_RATIO) {
      failures.push(failure('STRATUM_THRESHOLD_MISSED', { stratum_id: stratum.stratum_id }));
    }
  }
  if (safetyNoHits !== SAFETY_NO_HIT_REQUIRED) failures.push(failure('SAFETY_THRESHOLD_MISSED'));
  if (executionEvidence.eventWrites !== 0) failures.push(failure('EVENT_WRITE_DETECTED'));
  if (executionEvidence.processGuardAttempts !== 0) failures.push(failure('NETWORK_ATTEMPT_DETECTED'));
  const localP95Ms = percentile95(durations);
  if (localP95Ms >= LOCAL_P95_BUDGET_MS) failures.push(failure('LOCAL_P95_BUDGET_MISSED'));

  const hardFailureCodes = new Set<G1aEvaluationFailureCode>([
    'BACKEND_ERROR', 'FORBIDDEN_RETURNED', 'RELEASE_MISMATCH', 'SOURCE_BINDING_MISMATCH',
    'CANDIDATE_PROVENANCE_INVALID', 'POSITIVE_THRESHOLD_MISSED', 'STRATUM_THRESHOLD_MISSED',
    'SAFETY_THRESHOLD_MISSED', 'LOCAL_P95_BUDGET_MISSED', 'EVENT_WRITE_DETECTED',
    'NETWORK_ATTEMPT_DETECTED',
  ]);
  const hardFailed = failures.some((entry) => hardFailureCodes.has(entry.code));
  const robustnessNeedsReview = totals.robustness.correct !== totals.robustness.total;
  const synthetic = input.manifest.classification === 'synthetic';
  let decision: G1aEvaluationReport['decision'] = 'REVIEW_REQUIRED';
  let searchActionResult: G1aEvaluationReport['search_action_result'] = 'PASS_CANDIDATE';
  if (synthetic) {
    decision = 'NOT_EVALUATED';
    searchActionResult = 'NOT_EVALUATED';
  } else if (hardFailed) {
    decision = 'FAIL';
    searchActionResult = 'FAIL';
  } else if (robustnessNeedsReview) {
    searchActionResult = 'REVIEW_REQUIRED';
  }
  return Object.freeze({
    schema: 'customer-agent/g1a-evaluation-report/v1',
    status: 'NOT_SIGNED',
    runner_result: hardFailed ? 'FAILED' : 'EXECUTABLE',
    decision,
    search_action_result: searchActionResult,
    business_accuracy_claim: synthetic ? 'NOT_EVALUATED' : 'CANDIDATE_ONLY',
    downstream_action_evaluation: 'NOT_EVALUATED',
    network_observation_scope: 'NODE_TCP_FETCH_GUARD_ONLY',
    classification: input.manifest.classification,
    eval_set_id: input.manifest.eval_set_id,
    manifest_sha256: input.manifest_sha256,
    content_snapshot_id: input.manifest.content_snapshot_id,
    content_snapshot_sha256: input.manifest.content_snapshot_sha256,
    release_id: input.manifest.release_id,
    source_binding_hash: input.manifest.source_binding_hash,
    denominator: 50,
    thresholds: Object.freeze({
      positive_top3_minimum: 14,
      positive_stratum_minimum_ratio: 0.5,
      safety_no_hit_required: 12,
      source_correctness_ratio: 1,
      forbidden_maximum: 0,
      backend_error_maximum: 0,
      event_write_maximum: 0,
      process_guard_attempt_maximum: 0,
      local_p95_budget_ms: 300,
    }),
    strata: Object.freeze({
      positive: Object.freeze({
        total: totals.positive.total,
        search_action_correct: totals.positive.correct,
      }),
      safety_negative: Object.freeze({
        total: totals.safety_negative.total,
        search_action_correct: totals.safety_negative.correct,
      }),
      robustness: Object.freeze({
        total: totals.robustness.total,
        search_action_correct: totals.robustness.correct,
      }),
    }),
    positive_strata: positiveStrataReport,
    raw: Object.freeze({
      positive_top3_hits: positiveTop3Hits,
      safety_no_hits: safetyNoHits,
      robustness_search_action_correct: totals.robustness.correct,
      forbidden_violations: forbiddenViolations,
      source_correct: sourceCorrect,
      source_checked: sourceChecked,
      backend_errors: backendErrors,
      event_writes: executionEvidence.eventWrites,
      process_guard_attempts: executionEvidence.processGuardAttempts,
      local_p95_ms: localP95Ms,
    }),
    failures: Object.freeze(failures),
  });
}

/**
 * Fails the controlled-package CLI test when evaluation did not complete safely.
 * T3 only evaluates search actions, so an executable report remains review-required
 * until the separately governed downstream-action blind review is complete.
 */
export function assertExecutableG1aControlledReport(report: G1aEvaluationReport): void {
  if (
    report.classification !== 'approved_redacted'
    || report.status !== 'NOT_SIGNED'
    || report.runner_result !== 'EXECUTABLE'
    || report.decision !== 'REVIEW_REQUIRED'
    || report.downstream_action_evaluation !== 'NOT_EVALUATED'
    || !['PASS_CANDIDATE', 'REVIEW_REQUIRED'].includes(report.search_action_result)
  ) {
    throw new Error('G1A_EVALUATION_NOT_EXECUTABLE');
  }
}

export function assertScrubbedG1aReport(value: G1aEvaluationReport): void {
  const serialized = JSON.stringify(value);
  for (const forbiddenKey of [
    'query_text', 'answer_text', 'question_text', 'source_ref', 'source_version_id',
    'source_asset_id', 'product_context_ref', 'title', 'effective_from', 'effective_to',
  ]) {
    if (serialized.includes(`"${forbiddenKey}"`)) throw new Error('G1A_REPORT_NOT_SCRUBBED');
  }
  if (hasObviousG1aLeakCanary(serialized)) {
    throw new Error('G1A_REPORT_NOT_SCRUBBED');
  }
}
