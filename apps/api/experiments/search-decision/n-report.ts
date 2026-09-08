export type NAcceptanceSets = {
  kind: 'N_ACCEPTANCE_SETS';
  caseIds: string[];
  knownFailed: string[];
  unexpectedFailed: string[];
  failed: string[];
  passed: string[];
  expectedKnown: string[];
  unresolvedReasons: Record<string, string>;
  totals: { n: number; failed: number; passed: number };
  productBinding: { baseCommit: string; files: Record<string, string> };
};

function asUniqueStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`SEARCH_DECISION_LAB_REPORT_${label}_NOT_STRING_ARRAY`);
  }
  const items = value as string[];
  if (new Set(items).size !== items.length) {
    throw new Error(`SEARCH_DECISION_LAB_REPORT_${label}_DUPLICATE`);
  }
  return items;
}

function sorted(items: readonly string[]): string[] {
  return [...items].sort();
}

function sameSorted(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

/**
 * Structural report reader. Checks shape, uniqueness, and internal totals.
 * Does not know frozen case IDs or N10/N19 known-fail policy.
 */
export function readNAcceptanceReport(raw: unknown): NAcceptanceSets {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('SEARCH_DECISION_LAB_REPORT_NOT_OBJECT');
  }
  const doc = raw as Record<string, unknown>;
  if (doc.kind !== 'N_ACCEPTANCE_SETS') {
    throw new Error('SEARCH_DECISION_LAB_REPORT_KIND');
  }
  const totalsRaw = doc.totals;
  if (totalsRaw === null || typeof totalsRaw !== 'object') {
    throw new Error('SEARCH_DECISION_LAB_REPORT_TOTALS');
  }
  const totalsDoc = totalsRaw as Record<string, unknown>;
  if (typeof totalsDoc.n !== 'number' || typeof totalsDoc.failed !== 'number' || typeof totalsDoc.passed !== 'number') {
    throw new Error('SEARCH_DECISION_LAB_REPORT_TOTALS');
  }
  const reasonsRaw = doc.unresolvedReasons;
  if (reasonsRaw === null || typeof reasonsRaw !== 'object' || Array.isArray(reasonsRaw)) {
    throw new Error('SEARCH_DECISION_LAB_REPORT_REASONS');
  }
  const unresolvedReasons: Record<string, string> = {};
  for (const [key, value] of Object.entries(reasonsRaw as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(`SEARCH_DECISION_LAB_REPORT_REASON_VALUE:${key}`);
    }
    unresolvedReasons[key] = value;
  }
  const payload: NAcceptanceSets = {
    kind: 'N_ACCEPTANCE_SETS',
    caseIds: asUniqueStringArray(doc.caseIds, 'CASE_IDS'),
    knownFailed: asUniqueStringArray(doc.knownFailed, 'KNOWN'),
    unexpectedFailed: asUniqueStringArray(doc.unexpectedFailed, 'UNEXPECTED'),
    failed: asUniqueStringArray(doc.failed, 'FAILED'),
    passed: asUniqueStringArray(doc.passed, 'PASSED'),
    expectedKnown: asUniqueStringArray(doc.expectedKnown, 'EXPECTED_KNOWN'),
    unresolvedReasons,
    totals: {
      n: totalsDoc.n,
      failed: totalsDoc.failed,
      passed: totalsDoc.passed,
    },
    productBinding: readProductBinding(doc.productBinding),
  };
  const passedSet = new Set(payload.passed);
  const failedSet = new Set(payload.failed);
  for (const id of payload.passed) {
    if (failedSet.has(id)) throw new Error(`SEARCH_DECISION_LAB_REPORT_PASS_FAIL_OVERLAP:${id}`);
  }
  const union = sorted([...payload.passed, ...payload.failed]);
  if (!sameSorted(union, payload.caseIds)) {
    throw new Error('SEARCH_DECISION_LAB_REPORT_CASE_IDS_NOT_PARTITION');
  }
  const failedParts = sorted([...payload.knownFailed, ...payload.unexpectedFailed]);
  if (!sameSorted(failedParts, payload.failed)) {
    throw new Error('SEARCH_DECISION_LAB_REPORT_FAILED_PARTS');
  }
  if (payload.totals.n !== payload.caseIds.length) {
    throw new Error(`SEARCH_DECISION_LAB_REPORT_TOTAL_N:${payload.totals.n}!=${payload.caseIds.length}`);
  }
  if (payload.totals.failed !== payload.failed.length) {
    throw new Error(`SEARCH_DECISION_LAB_REPORT_TOTAL_FAILED:${payload.totals.failed}!=${payload.failed.length}`);
  }
  if (payload.totals.passed !== payload.passed.length) {
    throw new Error(`SEARCH_DECISION_LAB_REPORT_TOTAL_PASSED:${payload.totals.passed}!=${payload.passed.length}`);
  }
  if (payload.totals.n !== payload.totals.passed + payload.totals.failed) {
    throw new Error('SEARCH_DECISION_LAB_REPORT_TOTALS_SUM');
  }
  if (passedSet.size + failedSet.size !== payload.caseIds.length) {
    throw new Error('SEARCH_DECISION_LAB_REPORT_NOT_EXHAUSTIVE');
  }
  return payload;
}

function readProductBinding(raw: unknown): NAcceptanceSets['productBinding'] {
  if (raw === null || typeof raw !== 'object') throw new Error('SEARCH_DECISION_LAB_REPORT_PRODUCT_BINDING');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.baseCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(doc.baseCommit)
    || doc.files === null || typeof doc.files !== 'object' || Array.isArray(doc.files)) {
    throw new Error('SEARCH_DECISION_LAB_REPORT_PRODUCT_BINDING');
  }
  const files: Record<string, string> = {};
  for (const [key, value] of Object.entries(doc.files)) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error('SEARCH_DECISION_LAB_REPORT_PRODUCT_HASH');
    }
    files[key] = value;
  }
  return { baseCommit: doc.baseCommit, files };
}

export function assertFrozenNUniverse(
  payload: NAcceptanceSets,
  frozenIds: readonly string[],
): void {
  if (!sameSorted(payload.caseIds, frozenIds)) {
    throw new Error(
      `SEARCH_DECISION_LAB_REPORT_FROZEN_IDS:${JSON.stringify(sorted(payload.caseIds))}!=${JSON.stringify(sorted(frozenIds))}`,
    );
  }
  if (payload.totals.n !== frozenIds.length) {
    throw new Error(`SEARCH_DECISION_LAB_REPORT_FROZEN_N:${payload.totals.n}!=${frozenIds.length}`);
  }
}
