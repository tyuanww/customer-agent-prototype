import { readG1aDelivery, type G1aSafeDelivery } from './report-contract.ts';

export const KEYWORD_BASELINE_COMMIT = '362e53c8eaf4995774eeb0c46660c54c316ecd04';
export type ComparisonIdentity = Readonly<{ baseline_commit: string; candidate_commit: string }>;

function requireComparison(condition: unknown): asserts condition {
  if (!condition) throw new Error('G1A_COMPARISON_INVALID');
}

/** Consumes each lane through the existing allowlisted report parser first.
 * Pairing uses case IDs, never input order, and never awards a downstream grade.
 */
export function compareG1aDeliveries(
  baselineOutput: string, candidateOutput: string, manifestSha256: string, identity: ComparisonIdentity, expectedCandidateCommit: string,
) {
  requireComparison(identity !== null && typeof identity === 'object' && !Array.isArray(identity));
  requireComparison(Object.keys(identity).sort().join(',') === 'baseline_commit,candidate_commit');
  requireComparison(typeof identity.candidate_commit === 'string');
  requireComparison(identity.baseline_commit === KEYWORD_BASELINE_COMMIT);
  requireComparison(/^[0-9a-f]{40}$/.test(expectedCandidateCommit) && identity.candidate_commit === expectedCandidateCommit);
  const baseline = readG1aDelivery(baselineOutput, manifestSha256);
  const candidate = readG1aDelivery(candidateOutput, manifestSha256);
  for (const key of ['manifest_sha256', 'content_snapshot_id', 'content_snapshot_sha256', 'release_id', 'source_binding_hash', 'eval_set_id', 'classification'] as const) {
    requireComparison(baseline.report[key] === candidate.report[key]);
  }
  for (const key of Object.keys(baseline.runtime) as (keyof G1aSafeDelivery['runtime'])[]) {
    requireComparison(baseline.runtime[key] === candidate.runtime[key]);
  }
  for (const delivery of [baseline, candidate]) {
    requireComparison(delivery.runtime.cleanup_verified && delivery.runtime.event_rows_before === 0 && delivery.runtime.event_rows_after === 0);
    requireComparison(delivery.report.raw.event_writes === 0 && delivery.report.raw.process_guard_attempts === 0);
  }
  const before = new Map(baseline.report.case_results.map(row => [row.case_id, row]));
  requireComparison(before.size === 50 && candidate.report.case_results.length === 50);
  const cases = candidate.report.case_results.map(row => {
    const old = before.get(row.case_id);
    requireComparison(old);
    for (const key of ['stratum', 'stratum_id', 'expected_search_action', 'expected_downstream_action'] as const) {
      requireComparison(old[key] === row[key]);
    }
    before.delete(row.case_id);
    return Object.freeze({ case_id: row.case_id, baseline_correct: old.search_action_correct,
      candidate_correct: row.search_action_correct,
      change: old.search_action_correct === row.search_action_correct ? 'unchanged'
        : row.search_action_correct ? 'improved' : 'regressed' });
  });
  requireComparison([...before.keys()].length === 0);
  const count = (change: string) => cases.filter(row => row.change === change).length;
  const lane = (delivery: G1aSafeDelivery) => Object.freeze({ report: delivery.report, runtime: delivery.runtime });
  return Object.freeze({ schema: 'customer-agent/g1a-comparison/v1', status: 'NOT_SIGNED',
    identity: Object.freeze({ ...identity }), manifest_sha256: manifestSha256,
    baseline: lane(baseline), candidate: lane(candidate), cases: Object.freeze(cases),
    summary: Object.freeze({ total: 50, improved: count('improved'), regressed: count('regressed'), unchanged: count('unchanged') }),
    downstream_action_evaluation: 'NOT_EVALUATED', t6_signed: false });
}
