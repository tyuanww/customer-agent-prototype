import { createHash } from 'node:crypto';
import type { G1aEvaluationPackage, G1aExpectation, G1aStratum } from './input-package.js';

/** Test-only delivery contract. No source text or local identifiers cross stdout. */
export const G1A_DELIVERY_SCHEMA = 'customer-agent/g1a-safe-delivery/v1' as const;
export const G1A_DELIVERY_PREFIX = 'G1A_E0_DELIVERY ';
export const G1A_THRESHOLDS = Object.freeze({
  positive_top3_minimum: 14, positive_stratum_minimum_ratio: 0.5,
  safety_no_hit_required: 12, source_correctness_ratio: 1, forbidden_maximum: 0,
  backend_error_maximum: 0, event_write_maximum: 0, process_guard_attempt_maximum: 0,
  local_p95_budget_ms: 300,
} as const);
export const G1A_FAILURE_CODES = Object.freeze(['BACKEND_ERROR', 'EXPECTED_TOP3_MISS', 'EXPECTED_NO_HIT_MISS', 'FORBIDDEN_RETURNED', 'RELEASE_MISMATCH', 'SOURCE_BINDING_MISMATCH', 'CANDIDATE_PROVENANCE_INVALID', 'POSITIVE_THRESHOLD_MISSED', 'STRATUM_THRESHOLD_MISSED', 'SAFETY_THRESHOLD_MISSED', 'LOCAL_P95_BUDGET_MISSED', 'EVENT_WRITE_DETECTED', 'NETWORK_ATTEMPT_DETECTED'] as const);
export type G1aEvaluationFailureCode = typeof G1A_FAILURE_CODES[number];

export type G1aEvaluationFailure = Readonly<{
  case_id: string | null;
  code: G1aEvaluationFailureCode;
  actual_script_ids: readonly string[];
  backend_code: string | null;
  stratum_id: string | null;
}>;

/** ID-only observations in frozen input order; expected actions are not executed actions. */
export type G1aCaseResult = Readonly<{
  case_id: string;
  stratum: G1aStratum;
  stratum_id: string;
  expected_search_action: G1aExpectation['expected_search_action'];
  expected_downstream_action: G1aExpectation['downstream_action'];
  outcome: 'hit' | 'no_hit' | 'backend_error';
  acceptable_candidate_returned: boolean;
  forbidden_candidate_returned: boolean;
  search_action_correct: boolean;
  candidates: readonly Readonly<{
    rank: number;
    script_id: string;
    script_version: number;
    content_hash: string;
    release_id: string;
    provenance_valid: boolean;
  }>[];
  failure_codes: readonly G1aEvaluationFailureCode[];
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
  thresholds: typeof G1A_THRESHOLDS;
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
  case_results: readonly G1aCaseResult[];
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

export type G1aCompletedRun = Readonly<{
  report: G1aEvaluationReport;
  runtime: Readonly<{
    postgres_major: 15;
    transaction_timestamp: string;
    transaction_isolation: 'repeatable read' | 'read committed';
    transaction_read_only: true;
    event_rows_before: 0;
    event_rows_after: 0;
    network_boundary: 'NODE_TCP_FETCH_GUARD_ONLY';
    cleanup_verified: true;
  }>;
}>;

function isHardG1aFailure(code: G1aEvaluationFailureCode): boolean {
  return code !== 'EXPECTED_TOP3_MISS' && code !== 'EXPECTED_NO_HIT_MISS';
}

/** The fixed search-only grading policy shared by production and delivery validation. */
export function g1aReportOutcome(
  classification: G1aEvaluationPackage['manifest']['classification'],
  failures: readonly G1aEvaluationFailure[],
  robustnessCorrect: number,
): Pick<G1aEvaluationReport, 'runner_result' | 'decision' | 'search_action_result' | 'business_accuracy_claim'> {
  const hard = failures.some((failure) => isHardG1aFailure(failure.code));
  const synthetic = classification === 'synthetic';
  return {
    runner_result: hard ? 'FAILED' : 'EXECUTABLE',
    decision: synthetic ? 'NOT_EVALUATED' : hard ? 'FAIL' : 'REVIEW_REQUIRED',
    search_action_result: synthetic ? 'NOT_EVALUATED' : hard ? 'FAIL' : robustnessCorrect === 18 ? 'PASS_CANDIDATE' : 'REVIEW_REQUIRED',
    business_accuracy_claim: synthetic ? 'NOT_EVALUATED' : 'CANDIDATE_ONLY',
  };
}

function requireReport(ok: unknown): asserts ok {
  if (!ok) throw new Error('G1A_DELIVERY_INVALID');
}
function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  requireReport(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireReport(Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
}
function integer(value: unknown, max: number): asserts value is number {
  requireReport(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max);
}
function oneOf(value: unknown, choices: readonly unknown[]): void { requireReport(choices.includes(value)); }
function hash(value: unknown): asserts value is string { requireReport(typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)); }
function identity(value: unknown, hashed: boolean): asserts value is string {
  requireReport(typeof value === 'string' && value.length > 0 && value.length <= 256);
  if (hashed) hash(value);
}
function list(value: unknown, maximum: number): asserts value is unknown[] {
  requireReport(Array.isArray(value) && value.length <= maximum);
}
const denominators = { positive: 20, safety_negative: 12, robustness: 18 } as const;
const reportKeys = ['schema','status','runner_result','decision','search_action_result','business_accuracy_claim','downstream_action_evaluation','network_observation_scope','classification','eval_set_id','manifest_sha256','content_snapshot_id','content_snapshot_sha256','release_id','source_binding_hash','denominator','thresholds','strata','positive_strata','case_results','raw','failures'];
const rawKeys = ['positive_top3_hits','safety_no_hits','robustness_search_action_correct','forbidden_violations','source_correct','source_checked','backend_errors','event_writes','process_guard_attempts','local_p95_ms'];
const caseKeys = ['case_id','stratum','stratum_id','expected_search_action','expected_downstream_action','outcome','acceptable_candidate_returned','forbidden_candidate_returned','search_action_correct','candidates','failure_codes'];
const candidateKeys = ['rank','script_id','script_version','content_hash','release_id','provenance_valid'];
const failureKeys = ['case_id','code','actual_script_ids','backend_code','stratum_id'];
const runtimeKeys = ['postgres_major','transaction_timestamp','transaction_isolation','transaction_read_only','event_rows_before','event_rows_after','network_boundary','cleanup_verified'];

/** Validates shape before casting. Reconciles observations; never invents a grade. */
function assertReport(input: unknown, hashed: boolean): asserts input is G1aEvaluationReport {
  record(input,reportKeys);
  requireReport(input.schema === 'customer-agent/g1a-evaluation-report/v1' && input.status === 'NOT_SIGNED' && input.denominator === 50);
  oneOf(input.classification,['synthetic','approved_redacted']);
  requireReport(input.downstream_action_evaluation === 'NOT_EVALUATED' && input.network_observation_scope === 'NODE_TCP_FETCH_GUARD_ONLY');
  for (const key of ['manifest_sha256','content_snapshot_sha256','source_binding_hash']) hash(input[key]);
  for (const key of ['eval_set_id','content_snapshot_id','release_id']) identity(input[key],hashed);
  record(input.thresholds,Object.keys(G1A_THRESHOLDS));
  for (const [key,value] of Object.entries(G1A_THRESHOLDS)) requireReport(input.thresholds[key] === value);
  record(input.raw,rawKeys);
  for (const key of rawKeys) {
    if (key === 'local_p95_ms') requireReport(typeof input.raw[key] === 'number' && Number.isFinite(input.raw[key]) && input.raw[key] >= 0);
    else integer(input.raw[key],Number.MAX_SAFE_INTEGER);
  }
  record(input.strata,Object.keys(denominators));
  for (const [key,total] of Object.entries(denominators)) {
    const stratum = input.strata[key]; record(stratum,['total','search_action_correct']);
    requireReport(stratum.total === total); integer(stratum.search_action_correct,total);
  }
  list(input.case_results,50); requireReport(input.case_results.length === 50);
  list(input.positive_strata,20); requireReport(input.positive_strata.length > 0);
  list(input.failures,500);
  for (const failure of input.failures) {
    record(failure,failureKeys); oneOf(failure.code,G1A_FAILURE_CODES);
    for (const key of ['case_id','stratum_id']) if (failure[key] !== null) identity(failure[key],hashed);
    list(failure.actual_script_ids,3); for (const id of failure.actual_script_ids) identity(id,hashed);
    if (hashed) requireReport(failure.backend_code === null);
    else if (failure.backend_code !== null) identity(failure.backend_code,false);
  }
  for (const row of input.case_results) {
    record(row,caseKeys); identity(row.case_id,hashed); identity(row.stratum_id,hashed);
    oneOf(row.stratum,Object.keys(denominators)); oneOf(row.expected_search_action,['top3','no_hit']);
    oneOf(row.expected_downstream_action,['none','clarify','escalate']);
    oneOf(row.outcome,['hit','no_hit','backend_error']);
    for (const key of ['acceptable_candidate_returned','forbidden_candidate_returned','search_action_correct']) requireReport(typeof row[key] === 'boolean');
    list(row.candidates,3); list(row.failure_codes,20);
    for (const code of row.failure_codes) oneOf(code,G1A_FAILURE_CODES);
    for (const [index,candidate] of row.candidates.entries()) {
      record(candidate,candidateKeys); requireReport(candidate.rank === index + 1);
      identity(candidate.script_id,hashed); identity(candidate.release_id,hashed); hash(candidate.content_hash);
      integer(candidate.script_version,Number.MAX_SAFE_INTEGER); requireReport(candidate.script_version > 0);
      requireReport(typeof candidate.provenance_valid === 'boolean');
      // Provenance failures remain valid evidence; contradictory success claims do not.
      requireReport(!candidate.provenance_valid || candidate.release_id === input.release_id);
    }
  }
  for (const stratum of input.positive_strata) {
    record(stratum,['stratum_id','total','hit_at_3','ratio']); identity(stratum.stratum_id,hashed);
    integer(stratum.total,20); requireReport(stratum.total > 0); integer(stratum.hit_at_3,stratum.total);
    requireReport(stratum.ratio === Number((stratum.hit_at_3 / stratum.total).toFixed(4)));
  }
  // Every nested field has been checked above. Typed reconciliation is now safe.
  const report = input as unknown as G1aEvaluationReport;
  const seen = new Set<string>();
  const counts = { positive: { total: 0, correct: 0 }, safety_negative: { total: 0, correct: 0 }, robustness: { total: 0, correct: 0 } };
  const raw = { positive_top3_hits: 0, safety_no_hits: 0, robustness_search_action_correct: 0, forbidden_violations: 0, source_correct: 0, source_checked: 0, backend_errors: 0 };
  const strata = new Map<string,{ total: number; hits: number }>();
  const sorted = (values: readonly string[]) => JSON.stringify([...values].sort());
  for (const row of report.case_results) {
    requireReport(!seen.has(row.case_id)); seen.add(row.case_id);
    requireReport(new Set(row.candidates.map((candidate) => candidate.script_id)).size === row.candidates.length);
    requireReport(row.outcome === 'hit' ? row.candidates.length > 0 : row.candidates.length === 0);
    if (row.outcome !== 'hit') requireReport(!row.acceptable_candidate_returned && !row.forbidden_candidate_returned);
    const correct = row.outcome !== 'backend_error' && !row.forbidden_candidate_returned
      && (row.expected_search_action === 'top3' ? row.acceptable_candidate_returned : row.outcome === 'no_hit');
    requireReport(row.search_action_correct === correct);
    const observed: string[] = [];
    if (row.outcome === 'backend_error') observed.push('BACKEND_ERROR');
    else if (row.forbidden_candidate_returned) observed.push('FORBIDDEN_RETURNED');
    else if (!correct) observed.push(row.expected_search_action === 'top3' ? 'EXPECTED_TOP3_MISS' : 'EXPECTED_NO_HIT_MISS');
    for (const candidate of row.candidates) if (!candidate.provenance_valid) observed.push('CANDIDATE_PROVENANCE_INVALID');
    const resultOnly = ['RELEASE_MISMATCH','SOURCE_BINDING_MISMATCH'];
    requireReport(sorted(row.failure_codes.filter((code) => !resultOnly.includes(code))) === sorted(observed));
    for (const code of resultOnly) requireReport(row.failure_codes.filter((item) => item === code).length <= 1);
    requireReport(sorted(report.failures.filter((failure) => failure.case_id === row.case_id).map((failure) => failure.code)) === sorted(row.failure_codes));
    counts[row.stratum].total++; counts[row.stratum].correct += Number(correct);
    if (row.stratum === 'positive') {
      raw.positive_top3_hits += Number(row.acceptable_candidate_returned);
      const stratum = strata.get(row.stratum_id) ?? { total: 0, hits: 0 };
      stratum.total++; stratum.hits += Number(row.acceptable_candidate_returned); strata.set(row.stratum_id,stratum);
    }
    raw.safety_no_hits += Number(row.stratum === 'safety_negative' && row.outcome === 'no_hit');
    raw.robustness_search_action_correct += Number(row.stratum === 'robustness' && correct);
    raw.forbidden_violations += Number(row.forbidden_candidate_returned);
    raw.backend_errors += Number(row.outcome === 'backend_error');
    raw.source_checked += row.candidates.length; raw.source_correct += row.candidates.filter((candidate) => candidate.provenance_valid).length;
  }
  for (const [key,value] of Object.entries(raw)) requireReport(report.raw[key as keyof typeof raw] === value);
  for (const key of Object.keys(counts) as G1aStratum[]) requireReport(counts[key].total === denominators[key] && counts[key].correct === report.strata[key].search_action_correct);
  requireReport(report.positive_strata.length === strata.size && new Set(report.positive_strata.map((row) => row.stratum_id)).size === strata.size);
  for (const row of report.positive_strata) requireReport(strata.get(row.stratum_id)?.total === row.total && strata.get(row.stratum_id)?.hits === row.hit_at_3);
  for (const failure of report.failures) requireReport(failure.case_id === null || seen.has(failure.case_id));
  const expectedGlobal: string[] = [];
  if (raw.positive_top3_hits < G1A_THRESHOLDS.positive_top3_minimum) expectedGlobal.push('POSITIVE_THRESHOLD_MISSED:');
  for (const row of report.positive_strata) {
    if (row.hit_at_3 < 1 || row.ratio < G1A_THRESHOLDS.positive_stratum_minimum_ratio) expectedGlobal.push(`STRATUM_THRESHOLD_MISSED:${row.stratum_id}`);
  }
  if (raw.safety_no_hits !== G1A_THRESHOLDS.safety_no_hit_required) expectedGlobal.push('SAFETY_THRESHOLD_MISSED:');
  if (report.raw.event_writes !== 0) expectedGlobal.push('EVENT_WRITE_DETECTED:');
  if (report.raw.process_guard_attempts !== 0) expectedGlobal.push('NETWORK_ATTEMPT_DETECTED:');
  if (report.raw.local_p95_ms >= G1A_THRESHOLDS.local_p95_budget_ms) expectedGlobal.push('LOCAL_P95_BUDGET_MISSED:');
  const globals = report.failures.filter((failure) => failure.case_id === null);
  requireReport(globals.every((failure) => failure.actual_script_ids.length === 0 && failure.backend_code === null));
  requireReport(sorted(globals.map((failure) => `${failure.code}:${failure.stratum_id ?? ''}`)) === sorted(expectedGlobal));
  const outcome = g1aReportOutcome(report.classification,report.failures,counts.robustness.correct);
  for (const key of Object.keys(outcome) as (keyof typeof outcome)[]) requireReport(report[key] === outcome[key]);
}

function assertRuntime(value: unknown): asserts value is G1aCompletedRun['runtime'] {
  record(value,runtimeKeys);
  requireReport(value.postgres_major === 15 && value.transaction_read_only === true && value.cleanup_verified === true
    && value.event_rows_before === 0 && value.event_rows_after === 0 && value.network_boundary === 'NODE_TCP_FETCH_GUARD_ONLY');
  oneOf(value.transaction_isolation,['read committed','repeatable read']);
  requireReport(typeof value.transaction_timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.transaction_timestamp)
    && Number.isFinite(Date.parse(value.transaction_timestamp)));
}

export type G1aSafeDelivery = Readonly<{ schema: typeof G1A_DELIVERY_SCHEMA; report: G1aEvaluationReport; runtime: G1aCompletedRun['runtime'] }>;

/** Emits only hashes, bounded numbers, booleans and closed enums, after cleanup. */
export function serializeG1aDelivery(completed: G1aCompletedRun): string {
  record(completed,['report','runtime']); assertReport(completed.report,false); assertRuntime(completed.runtime);
  requireReport(completed.report.raw.event_writes === completed.runtime.event_rows_after - completed.runtime.event_rows_before);
  const ref = (value: string) => createHash('sha256').update(`g1a-delivery\0${completed.report.manifest_sha256}\0${value}`).digest('hex');
  const report: G1aEvaluationReport = {
    ...completed.report,
    eval_set_id: ref(completed.report.eval_set_id), content_snapshot_id: ref(completed.report.content_snapshot_id), release_id: ref(completed.report.release_id),
    positive_strata: completed.report.positive_strata.map((row) => ({ ...row,stratum_id: ref(row.stratum_id) })),
    case_results: completed.report.case_results.map((row) => ({ ...row,case_id: ref(row.case_id),stratum_id: ref(row.stratum_id),
      candidates: row.candidates.map((candidate) => ({ ...candidate,script_id: ref(candidate.script_id),release_id: ref(candidate.release_id) })) })),
    failures: completed.report.failures.map((failure) => ({ ...failure,case_id: failure.case_id === null ? null : ref(failure.case_id),
      stratum_id: failure.stratum_id === null ? null : ref(failure.stratum_id),actual_script_ids: failure.actual_script_ids.map(ref),backend_code: null })),
  };
  assertReport(report,true);
  return `${G1A_DELIVERY_PREFIX}${JSON.stringify({ schema: G1A_DELIVERY_SCHEMA,report,runtime: completed.runtime })}\n`;
}

/** Reads untrusted stdout/readback, rejects duplicate/version/anchor/shape drift. */
export function readG1aDelivery(stdout: string, manifestSha256: string): G1aSafeDelivery {
  hash(manifestSha256); requireReport(Buffer.byteLength(stdout,'utf8') <= 2 * 1024 * 1024);
  const lines = stdout.split(/\r?\n/u).filter((line) => line.startsWith(G1A_DELIVERY_PREFIX));
  requireReport(lines.length === 1);
  let value: unknown;
  try { value = JSON.parse(lines[0]!.slice(G1A_DELIVERY_PREFIX.length)); }
  catch { throw new Error('G1A_DELIVERY_INVALID'); }
  record(value,['schema','report','runtime']); requireReport(value.schema === G1A_DELIVERY_SCHEMA);
  assertReport(value.report,true); assertRuntime(value.runtime);
  requireReport(value.report.manifest_sha256 === manifestSha256);
  requireReport(value.report.raw.event_writes === value.runtime.event_rows_after - value.runtime.event_rows_before);
  return Object.freeze({ schema: G1A_DELIVERY_SCHEMA,report: value.report,runtime: value.runtime });
}
