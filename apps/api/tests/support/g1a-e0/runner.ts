import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createSearchRepository } from '../../../src/search-repository.js';
import { createSearchBackend } from '../../../src/search-service.js';
import {
  assertScrubbedG1aReport,
  evaluateG1aPackage,
  type G1aEvaluationReport,
} from './evaluate.js';
import {
  readG1aEvaluationPackage,
  type G1aEvaluationPackage,
} from './input-package.js';
import { loadG1aEvaluationRelease } from './loader.js';
import { installG1aNetworkGuard } from './network-guard.js';

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

export type RunG1aPackageOptions = Readonly<{
  inputRoot: string;
  repositoryRoot: string;
  expectedManifestSha256: string;
  expectedOwnerAcceptanceSha256?: string;
  expectedOwnerSubjectHash?: string;
  now?: Date;
}>;

export class G1aRunError extends Error {
  readonly code: 'G1A_RUNTIME_TIME_INVALID' | 'G1A_RUNTIME_EVENT_STATE_INVALID' | 'G1A_RUNTIME_CLEANUP_FAILED';

  constructor(code: G1aRunError['code']) {
    super(code);
    this.name = 'G1aRunError';
    this.code = code;
  }
}

async function eventRowCount(owner: Client): Promise<number> {
  const result = await owner.query<{ count: number }>(`
    SELECT (
      (SELECT pg_catalog.count(*) FROM public.query_events)
      + (SELECT pg_catalog.count(*) FROM public.candidate_impressions)
      + (SELECT pg_catalog.count(*) FROM public.adoption_events)
      + (SELECT pg_catalog.count(*) FROM public.escalate_actions)
    )::integer AS count
  `);
  return result.rows[0]?.count ?? -1;
}

function activeAt(
  item: G1aEvaluationPackage['content'][number],
  instant: number,
): boolean {
  return Date.parse(item.effective_from) <= instant
    && (item.effective_to === null || instant < Date.parse(item.effective_to));
}

function assertFrozenRuntimeTime(input: G1aEvaluationPackage, transactionTimestamp: string): void {
  const instant = Date.parse(transactionTimestamp);
  const createdAt = Date.parse(input.manifest.created_at);
  const expiresAt = Date.parse(input.manifest.expires_at);
  const caseTimes = new Set(input.cases.map((testCase) => testCase.as_of));
  if (!Number.isFinite(instant) || instant < createdAt || instant >= expiresAt || caseTimes.size !== 1) {
    throw new G1aRunError('G1A_RUNTIME_TIME_INVALID');
  }
  const evaluationInstant = Date.parse(input.cases[0]!.as_of);
  if (!Number.isFinite(evaluationInstant)
    || input.content.some((item) => activeAt(item, evaluationInstant) !== activeAt(item, instant))) {
    throw new G1aRunError('G1A_RUNTIME_TIME_INVALID');
  }
}

async function closeClient(client: Client | undefined, errors: unknown[]): Promise<void> {
  if (!client) return;
  try {
    await client.end();
  } catch (error: unknown) {
    errors.push(error);
  }
}

/**
 * Runs one already-verified package without HTTP, runtime events, desktop, or a
 * durable database. A result is returned only after every client and the
 * temporary PostgreSQL root have been cleaned up.
 */
export async function runVerifiedG1aEvaluation(
  input: G1aEvaluationPackage,
): Promise<G1aCompletedRun> {
  const isolation = input.owner_acceptance ? 'read committed' : 'repeatable read';
  const harness = new Pg15Harness();
  let owner: Client | undefined;
  let runtime: Client | undefined;
  let guard: ReturnType<typeof installG1aNetworkGuard> | undefined;
  let runtimeTransactionOpen = false;
  let report: G1aEvaluationReport | undefined;
  let transactionTimestamp = '';
  let eventRowsBefore = -1;
  let eventRowsAfter = -1;
  let mainError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    harness.start();
    const database = harness.createDatabase('g1a_eval');
    guard = installG1aNetworkGuard(harness.socket);
    owner = await harness.connect(database.config);
    await applyDatabaseMigrations(owner);
    await loadG1aEvaluationRelease(owner, input);

    const runtimeRole = `g1a_eval_${randomBytes(8).toString('hex')}`;
    await owner.query(`CREATE ROLE ${runtimeRole} LOGIN`);
    await owner.query(`GRANT app_runtime TO ${runtimeRole}`);
    runtime = await harness.connect({ ...database.config, user: runtimeRole });
    // Owner admission holds source/revocation fences and requires fresh READ COMMITTED snapshots.
    await runtime.query(input.owner_acceptance
      ? 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY'
      : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    runtimeTransactionOpen = true;
    const runtimeState = await runtime.query<{
      transaction_timestamp: Date | string;
      transaction_isolation: string;
      transaction_read_only: string;
      server_version_num: string;
    }>(`
      SELECT
        pg_catalog.transaction_timestamp() AS transaction_timestamp,
        pg_catalog.current_setting('transaction_isolation') AS transaction_isolation,
        pg_catalog.current_setting('transaction_read_only') AS transaction_read_only,
        pg_catalog.current_setting('server_version_num') AS server_version_num
    `);
    const runtimeRow = runtimeState.rows[0];
    if (!runtimeRow
      || runtimeRow.transaction_isolation !== isolation
      || runtimeRow.transaction_read_only !== 'on'
      || Math.trunc(Number(runtimeRow.server_version_num) / 10_000) !== 15) {
      throw new G1aRunError('G1A_RUNTIME_TIME_INVALID');
    }
    transactionTimestamp = new Date(runtimeRow.transaction_timestamp).toISOString();
    assertFrozenRuntimeTime(input, transactionTimestamp);

    eventRowsBefore = await eventRowCount(owner);
    if (eventRowsBefore !== 0) throw new G1aRunError('G1A_RUNTIME_EVENT_STATE_INVALID');
    const repository = createSearchRepository(runtime as never);
    const backend = createSearchBackend({ searchCandidates: repository.search });
    report = await evaluateG1aPackage(backend, input, async () => {
      eventRowsAfter = await eventRowCount(owner!);
      return Object.freeze({
        eventWrites: eventRowsAfter - eventRowsBefore,
        processGuardAttempts: guard!.attempts(),
      });
    });
    if (eventRowsAfter !== 0) throw new G1aRunError('G1A_RUNTIME_EVENT_STATE_INVALID');
    assertScrubbedG1aReport(report);
  } catch (error: unknown) {
    mainError = error;
  } finally {
    if (runtimeTransactionOpen && runtime) {
      try {
        await runtime.query('ROLLBACK');
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    await closeClient(runtime, cleanupErrors);
    await closeClient(owner, cleanupErrors);
    try {
      guard?.restore();
    } catch (error: unknown) {
      cleanupErrors.push(error);
    }
    try {
      harness.stop();
    } catch (error: unknown) {
      cleanupErrors.push(error);
    }
    if (existsSync(harness.root)) cleanupErrors.push(new G1aRunError('G1A_RUNTIME_CLEANUP_FAILED'));
  }

  if (mainError !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError([mainError, ...cleanupErrors], 'G1A_RUNTIME_AND_CLEANUP_FAILED');
  }
  if (mainError !== undefined) throw mainError;
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'G1A_RUNTIME_CLEANUP_FAILED');
  if (!report || eventRowsBefore !== 0 || eventRowsAfter !== 0) {
    throw new G1aRunError('G1A_RUNTIME_EVENT_STATE_INVALID');
  }

  return Object.freeze({
    report,
    runtime: Object.freeze({
      postgres_major: 15,
      transaction_timestamp: transactionTimestamp,
      transaction_isolation: isolation,
      transaction_read_only: true,
      event_rows_before: 0,
      event_rows_after: 0,
      network_boundary: 'NODE_TCP_FETCH_GUARD_ONLY',
      cleanup_verified: true,
    }),
  });
}

/** Verifies the package before any PostgreSQL resource is constructed. */
export async function runG1aEvaluationPackage(
  options: RunG1aPackageOptions,
): Promise<G1aCompletedRun> {
  const input = await readG1aEvaluationPackage(options.inputRoot, {
    repositoryRoot: options.repositoryRoot,
    expectedManifestSha256: options.expectedManifestSha256,
    ...(options.now ? { now: options.now } : {}),
    ...(options.expectedOwnerAcceptanceSha256 !== undefined ? { expectedOwnerAcceptanceSha256: options.expectedOwnerAcceptanceSha256 } : {}),
    ...(options.expectedOwnerSubjectHash !== undefined ? { expectedOwnerSubjectHash: options.expectedOwnerSubjectHash } : {}),
  });
  return runVerifiedG1aEvaluation(input);
}
