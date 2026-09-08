import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBaseline } from './instrument.js';
import { assertFrozenNUniverse, readNAcceptanceReport, type NAcceptanceSets } from './n-report.js';
import { API_ROOT, EXPERIMENT_ROOT } from './paths.js';

export const EXPECTED_ACCEPTANCE_EXIT = 1;
const CLI = join(EXPERIMENT_ROOT, 'cli.mjs');
const STALE_SKEW_MS = 5_000;
const SPAWN_TIMEOUT_MS = 120_000;
const SPAWN_BUFFER = 10 * 1024 * 1024;

function sorted(items: readonly string[]): string[] {
  return [...items].sort();
}

function sameSorted(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

/**
 * Known-fail contract against a parsed report and the frozen N universe.
 * Kept here so the JSON reader does not own N10/N19 policy.
 */
export function assertKnownFailContract(payload: NAcceptanceSets): void {
  const baseline = loadBaseline();
  const frozenIds = baseline.n_cases.ids;
  const known = baseline.n_cases.known_unresolved;
  const reasons = baseline.n_cases.unresolved_reasons;
  assertFrozenNUniverse(payload, frozenIds);
  if (payload.unexpectedFailed.length > 0) {
    throw new Error(`SEARCH_DECISION_LAB_KNOWN_FAIL_UNEXPECTED:${JSON.stringify(payload.unexpectedFailed)}`);
  }
  if (!sameSorted(payload.knownFailed, known)) {
    throw new Error(`SEARCH_DECISION_LAB_KNOWN_FAIL_KNOWN:${JSON.stringify(payload.knownFailed)}`);
  }
  if (!sameSorted(payload.expectedKnown, known)) {
    throw new Error(`SEARCH_DECISION_LAB_KNOWN_FAIL_EXPECTED_KNOWN:${JSON.stringify(payload.expectedKnown)}`);
  }
  if (!sameSorted(payload.failed, known)) {
    throw new Error(`SEARCH_DECISION_LAB_KNOWN_FAIL_FAILED:${JSON.stringify(payload.failed)}`);
  }
  const passedWant = frozenIds.filter((id) => !known.includes(id));
  if (!sameSorted(payload.passed, passedWant)) {
    throw new Error(`SEARCH_DECISION_LAB_KNOWN_FAIL_PASSED:${JSON.stringify(payload.passed)}`);
  }
  for (const [id, reason] of Object.entries(reasons)) {
    if (payload.unresolvedReasons[id] !== reason) {
      throw new Error(`SEARCH_DECISION_LAB_KNOWN_FAIL_REASON:${id}`);
    }
  }
}

export type KnownFailProof = Readonly<{
  acceptanceExit: number;
  reportPath: string;
  payload: NAcceptanceSets;
}>;

/** Missing, stale, or unreadable JSON cannot be treated as a known-fail proof. */
export function assertFreshAcceptanceReport(reportPath: string, startedMs: number): unknown {
  if (!existsSync(reportPath)) {
    throw new Error('SEARCH_DECISION_LAB_ACCEPTANCE_REPORT_MISSING');
  }
  const mtimeMs = statSync(reportPath).mtimeMs;
  if (mtimeMs < startedMs - STALE_SKEW_MS) {
    throw new Error('SEARCH_DECISION_LAB_ACCEPTANCE_REPORT_STALE');
  }
  try {
    return JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (error) {
    throw new Error(`SEARCH_DECISION_LAB_ACCEPTANCE_REPORT_JSON:${String(error)}`);
  }
}

/**
 * Fresh-run owner for the known-fail proof: spawn the real acceptance CLI,
 * require its expected non-zero exit, then read that run's JSON.
 * Ordinary fixture overrides and the test-only unfreeze flag are stripped.
 */
export function proveKnownFail(): KnownFailProof {
  const reportDir = mkdtempSync(join(tmpdir(), 'search-decision-lab-known-fail-'));
  const reportPath = join(reportDir, 'n-acceptance.json');
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.SEARCH_DECISION_LAB_REPORT_DIR = reportDir;
  delete env.SEARCH_DECISION_LAB_TEST_UNFROZEN;
  delete env.SEARCH_DECISION_LAB_FIXTURE_ROOT;
  const started = Date.now();
  const result = spawnSync(process.execPath, [CLI, 'acceptance'], {
    cwd: API_ROOT,
    env,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    maxBuffer: SPAWN_BUFFER,
  });
  if (result.error) {
    throw new Error(`SEARCH_DECISION_LAB_ACCEPTANCE_SPAWN:${result.error.message}`);
  }
  if (result.status === null) {
    throw new Error(`SEARCH_DECISION_LAB_ACCEPTANCE_SIGNAL:${String(result.signal)}`);
  }
  if (result.status !== EXPECTED_ACCEPTANCE_EXIT) {
    throw new Error(
      `SEARCH_DECISION_LAB_ACCEPTANCE_EXIT:${result.status} want ${EXPECTED_ACCEPTANCE_EXIT}\n${result.stdout}\n${result.stderr}`,
    );
  }
  const parsed = assertFreshAcceptanceReport(reportPath, started);
  const payload = readNAcceptanceReport(parsed);
  assertKnownFailContract(payload);
  return Object.freeze({ acceptanceExit: result.status, reportPath, payload });
}
