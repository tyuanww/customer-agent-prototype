import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateNAcceptance } from '../evaluate.js';
import { loadBaseline } from '../instrument.js';
import { readNAcceptanceReport } from '../n-report.js';
import { EXPERIMENT_ROOT } from '../paths.js';
import {
  EXPECTED_ACCEPTANCE_EXIT,
  assertFreshAcceptanceReport,
  assertAcceptanceContract,
  proveAcceptance,
} from '../prove-acceptance.js';

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function copyFixtures(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'search-decision-lab-known-fail-fx-'));
  cpSync(join(EXPERIMENT_ROOT, 'fixtures'), tmp, { recursive: true });
  return tmp;
}

function truncateToKnownFails(root: string): void {
  const path = join(root, 'cases-n.json');
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { cases: Array<{ id: string }> };
  doc.cases = doc.cases.filter((item) => item.id === 'N10' || item.id === 'N19');
  writeFileSync(path, `${JSON.stringify(doc)}\n`);
}

function frozenContractPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const baseline = loadBaseline();
  const ids = [...baseline.n_cases.ids].sort();
  const known = [...baseline.n_cases.known_unresolved].sort();
  const passed = ids.filter((id) => !known.includes(id));
  return {
    kind: 'N_ACCEPTANCE_SETS',
    caseIds: ids,
    knownFailed: known,
    unexpectedFailed: [],
    failed: known,
    passed,
    expectedKnown: known,
    unresolvedReasons: { ...baseline.n_cases.unresolved_reasons },
    totals: { n: ids.length, failed: known.length, passed: passed.length },
    productBinding: { baseCommit: baseline.product_base_commit, files: { ...baseline.files } },
    ...overrides,
  };
}

describe('full N acceptance proof', () => {
  it('uses the real acceptance CLI, expected exit 0, and that run\'s frozen 23-case JSON', async () => {
    const fixtures = copyFixtures();
    truncateToKnownFails(fixtures);
    try {
      const result = await withEnv({
        SEARCH_DECISION_LAB_FIXTURE_ROOT: fixtures,
        SEARCH_DECISION_LAB_TEST_UNFROZEN: '1',
      }, () => proveAcceptance());
      expect(result.acceptanceExit).toBe(EXPECTED_ACCEPTANCE_EXIT);
      const disk = readNAcceptanceReport(JSON.parse(readFileSync(result.reportPath, 'utf8')));
      expect(disk).toEqual(result.payload);
      expect(result.payload.totals.n).toBe(23);
      expect(result.payload.caseIds).toHaveLength(23);
      expect(result.payload.failed).toEqual([]);
      expect(result.payload.passed).toHaveLength(23);
      expect(result.payload.passed).toContain('N10');
      expect(result.payload.passed).toContain('N19');
      expect(result.payload.unexpectedFailed).toEqual([]);
    } finally {
      rmSync(fixtures, { recursive: true, force: true });
    }
  }, 120_000);

  it('rejects truncated fixtures on the frozen path and as a acceptance contract', async () => {
    const fixtures = copyFixtures();
    const reports = mkdtempSync(join(tmpdir(), 'search-decision-lab-known-fail-rep-'));
    truncateToKnownFails(fixtures);
    try {
      await withEnv({
        SEARCH_DECISION_LAB_FIXTURE_ROOT: fixtures,
        SEARCH_DECISION_LAB_REPORT_DIR: reports,
        SEARCH_DECISION_LAB_TEST_UNFROZEN: undefined,
      }, async () => {
        await expect(evaluateNAcceptance()).rejects.toThrow(/SEARCH_DECISION_LAB_FIXTURE_DRIFT/);
      });
      const truncated = await withEnv({
        SEARCH_DECISION_LAB_FIXTURE_ROOT: fixtures,
        SEARCH_DECISION_LAB_REPORT_DIR: reports,
        SEARCH_DECISION_LAB_TEST_UNFROZEN: '1',
      }, () => evaluateNAcceptance());
      expect(truncated.totals.n).toBe(2);
      expect(truncated.passed).toEqual(['N10', 'N19']);
      expect(truncated.failed).toEqual([]);
      expect(() => assertAcceptanceContract(truncated)).toThrow(/SEARCH_DECISION_LAB_REPORT_FROZEN_IDS/);
    } finally {
      rmSync(fixtures, { recursive: true, force: true });
      rmSync(reports, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects truncated, overlapping, duplicate, and unexpected-failure reports', () => {
    const wrongProduct = frozenContractPayload({ productBinding: { baseCommit: 'a'.repeat(40), files: {} } });
    expect(() => assertAcceptanceContract(readNAcceptanceReport(wrongProduct))).toThrow(/PRODUCT_BINDING/);
    const truncated = frozenContractPayload({
      caseIds: ['N10', 'N19'],
      passed: ['N10', 'N19'],
      totals: { n: 2, failed: 0, passed: 2 },
    });
    expect(() => assertAcceptanceContract(readNAcceptanceReport(truncated))).toThrow(
      /SEARCH_DECISION_LAB_REPORT_FROZEN_IDS/,
    );
    expect(() => readNAcceptanceReport(frozenContractPayload({
      passed: ['N01', 'N10'],
      failed: ['N10', 'N19'],
      knownFailed: ['N10', 'N19'],
      totals: { n: 23, failed: 2, passed: 21 },
    }))).toThrow(/SEARCH_DECISION_LAB_REPORT_PASS_FAIL_OVERLAP/);
    expect(() => readNAcceptanceReport(frozenContractPayload({
      caseIds: ['N01', 'N01'],
    }))).toThrow(/SEARCH_DECISION_LAB_REPORT_CASE_IDS_DUPLICATE/);
    const unexpected = frozenContractPayload({
      failed: ['N01'],
      unexpectedFailed: ['N01'],
      passed: loadBaseline().n_cases.ids.filter((id) => id !== 'N01').slice().sort(),
      totals: { n: 23, failed: 1, passed: 22 },
    });
    const parsedUnexpected = readNAcceptanceReport(unexpected);
    expect(() => assertAcceptanceContract(parsedUnexpected)).toThrow(/SEARCH_DECISION_LAB_ACCEPTANCE_PROOF_UNEXPECTED/);
    const missingKnown = frozenContractPayload({
      failed: ['N10'],
      knownFailed: ['N10'],
      passed: loadBaseline().n_cases.ids.filter((id) => id !== 'N10').slice().sort(),
      totals: { n: 23, failed: 1, passed: 22 },
    });
    expect(() => assertAcceptanceContract(readNAcceptanceReport(missingKnown))).toThrow(
      /SEARCH_DECISION_LAB_ACCEPTANCE_PROOF/,
    );
  });

  it('rejects missing and malformed product provenance', () => {
    for (const productBinding of [undefined, null, {}, { baseCommit: 'short', files: {} },
      { baseCommit: 'a'.repeat(40), files: [] }]) {
      expect(() => readNAcceptanceReport(frozenContractPayload({ productBinding }))).toThrow(/PRODUCT_BINDING/);
    }
    expect(() => readNAcceptanceReport(frozenContractPayload({
      productBinding: { baseCommit: 'a'.repeat(40), files: { source: 'not-sha256' } },
    }))).toThrow(/PRODUCT_HASH/);
  });

  it('rejects missing, stale, and invalid acceptance reports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'search-decision-lab-report-gate-'));
    const missing = join(dir, 'missing.json');
    expect(() => assertFreshAcceptanceReport(missing, Date.now())).toThrow(
      /SEARCH_DECISION_LAB_ACCEPTANCE_REPORT_MISSING/,
    );
    const stale = join(dir, 'stale.json');
    writeFileSync(stale, '{}\n');
    const old = new Date(Date.now() - 60_000);
    utimesSync(stale, old, old);
    expect(() => assertFreshAcceptanceReport(stale, Date.now())).toThrow(
      /SEARCH_DECISION_LAB_ACCEPTANCE_REPORT_STALE/,
    );
    const invalid = join(dir, 'invalid.json');
    writeFileSync(invalid, '{');
    expect(() => assertFreshAcceptanceReport(invalid, Date.now())).toThrow(
      /SEARCH_DECISION_LAB_ACCEPTANCE_REPORT_JSON/,
    );
    rmSync(dir, { recursive: true, force: true });
  });
});
