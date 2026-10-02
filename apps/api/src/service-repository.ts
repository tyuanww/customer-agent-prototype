import { performance } from 'node:perf_hooks';
import type { components } from '@customer-agent/contracts';
import { Client, Pool, type PoolClient, type QueryResultRow } from 'pg';
import { createContentRuntime } from './features/content-runtime.js';
import { createSearchRuntime, type SearchRuntime } from './features/search-runtime.js';
import type { ContentImportRepository } from './content-import-repository.js';
import type {
  PreparedAdoptionOperation,
  PreparedEscalationOperation,
} from './event-repository.js';
import {
  interpretRuntimeSchemaRow,
  RUNTIME_POLICY_FLAGS_SQL,
  RUNTIME_SCHEMA_PROBE_SQL,
  runtimePolicyFlagParameters,
  type RuntimeSchemaProbeRow,
} from './repository/runtime-boundary-probe.js';
import {
  createApiRuntimeDiagnostic,
  reportApiRuntimeDiagnostic,
  type ApiRuntimeDiagnosticCode,
  type ApiRuntimeDiagnosticSink,
} from './runtime-diagnostics.js';
import type { ApiDatabaseBootstrapConfig } from './runtime-config.js';
import type { PreparedSearchOperation } from './search-routes.js';
import type { SearchRepositoryRequest, SearchRepositoryResult } from './search-repository.js';

export type ServiceReadinessChecks = components['schemas']['ReadyChecks'];
export type ServicePolicyFlags = Readonly<Omit<components['schemas']['PolicyResponse'], 'auth_mode'>>;

export type ServiceRepository = Readonly<{
  readiness: () => Promise<ServiceReadinessChecks>;
  readPolicyFlags: () => Promise<ServicePolicyFlags | null>;
  searchCandidates: SearchRuntime['searchCandidates'];
  executeSearch: SearchRuntime['executeSearch'];
  recordAdoption: SearchRuntime['recordAdoption'];
  recordEscalation: SearchRuntime['recordEscalation'];
  contentImport: ContentImportRepository;
  close: () => Promise<void>;
}>;

type RuntimePool = Pick<Pool, 'query' | 'connect' | 'end' | 'on'>;
type RuntimeClock = () => number;

class RuntimePoolClient extends Client {
  runtimeConnectionStartedAt = performance.now();
  runtimeConnectionAdmitted = false;
}

/** Internal deterministic test seam for pg-pool's late-connect race guard. */
export function runtimeConnectionExceededDeadline(
  startedAt: number,
  timeoutMs: number,
  now = performance.now(),
): boolean {
  return now - startedAt >= timeoutMs;
}

function verifyRuntimeConnectionDeadline(
  client: PoolClient,
  timeoutMs: number,
  now: number,
  done: (error?: Error) => void,
): void {
  if (Reflect.get(client, 'runtimeConnectionAdmitted') === true) {
    done();
    return;
  }
  const startedAt = Reflect.get(client, 'runtimeConnectionStartedAt');
  if (typeof startedAt !== 'number'
    || runtimeConnectionExceededDeadline(startedAt, timeoutMs, now)) {
    done(new Error('Runtime database connection exceeded its configured deadline'));
    return;
  }
  try {
    Reflect.set(client, 'runtimeConnectionAdmitted', true);
  } catch {
    // Frozen test doubles cannot record admission.
  }
  done();
}

/** Internal deterministic test seam for the exact callback passed to pg-pool. */
export function createRuntimePoolVerify(
  timeoutMs: number,
  now: RuntimeClock = () => performance.now(),
): (client: PoolClient, done: (error?: Error) => void) => void {
  return (client, done) => verifyRuntimeConnectionDeadline(client, timeoutMs, now(), done);
}

interface RuntimePolicyFlagsRow extends QueryResultRow, ServicePolicyFlags {}

function freezeChecks(
  database: ServiceReadinessChecks['database'],
  schema: ServiceReadinessChecks['schema'],
): ServiceReadinessChecks {
  // The repository only proves database/schema. App composition replaces auth,
  // storage and content with their owners; unwired owners stay not_ready.
  return Object.freeze({
    database,
    schema,
    auth: 'not_ready',
    storage: 'not_ready',
    content: 'not_ready',
  });
}

class PostgresServiceRepository implements ServiceRepository {
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private readonly searchRuntime: ReturnType<typeof createSearchRuntime>;
  readonly contentImport: ContentImportRepository;
  private activeProbe: Readonly<{
    operation: Promise<ServiceReadinessChecks>;
    response: Promise<ServiceReadinessChecks>;
  }> | null = null;

  constructor(
    private readonly pool: RuntimePool,
    private readonly readinessTimeoutMs: number,
    private readonly diagnosticSink: ApiRuntimeDiagnosticSink,
    private readonly now: RuntimeClock,
  ) {
    this.searchRuntime = createSearchRuntime(this.pool, this.diagnosticSink, () => this.closed);
    this.contentImport = createContentRuntime(this.pool, this.diagnosticSink);
    // node-postgres emits idle-client failures on Pool itself. Consume the event
    // so it cannot crash the process. pg-pool already evicts that idle client;
    // the next readiness request must run a fresh probe instead of inventing a
    // one-request outage after the failed client has gone.
    this.pool.on('error', (error) => {
      this.report('DATABASE_IDLE_CLIENT_FAILED', error);
    });
  }

  searchCandidates(request: SearchRepositoryRequest): Promise<SearchRepositoryResult> {
    return this.searchRuntime.searchCandidates(request);
  }

  executeSearch(request: PreparedSearchOperation) {
    return this.searchRuntime.executeSearch(request);
  }

  recordAdoption(request: PreparedAdoptionOperation) {
    return this.searchRuntime.recordAdoption(request);
  }

  recordEscalation(request: PreparedEscalationOperation) {
    return this.searchRuntime.recordEscalation(request);
  }

  readiness(): Promise<ServiceReadinessChecks> {
    if (this.closed) return Promise.resolve(freezeChecks('not_ready', 'not_ready'));
    if (this.activeProbe !== null) return this.activeProbe.response;

    const startedAt = this.now();
    let deadlineReported = false;
    const deadlineFailure = (): ServiceReadinessChecks => {
      if (!deadlineReported) {
        deadlineReported = true;
        this.report('DATABASE_READINESS_DEADLINE_EXCEEDED');
      }
      return freezeChecks('not_ready', 'not_ready');
    };
    const operation = this.executeProbe();
    const checkedOperation = operation.then((checks) => (
      runtimeConnectionExceededDeadline(startedAt, this.readinessTimeoutMs, this.now())
        ? deadlineFailure()
        : checks
    ));
    let deadline: ReturnType<typeof setTimeout>;
    const bounded = new Promise<ServiceReadinessChecks>((resolve) => {
      deadline = setTimeout(() => {
        resolve(deadlineFailure());
      }, this.readinessTimeoutMs);
      deadline.unref?.();
    });
    const response = Promise.race([checkedOperation, bounded]);
    this.activeProbe = Object.freeze({ operation, response });
    void operation.finally(() => {
      clearTimeout(deadline);
      if (this.activeProbe?.operation === operation) this.activeProbe = null;
    });
    return response;
  }

  async readPolicyFlags(): Promise<ServicePolicyFlags | null> {
    if (this.closed) return null;
    try {
      const result = await this.pool.query<RuntimePolicyFlagsRow>(
        RUNTIME_POLICY_FLAGS_SQL,
        runtimePolicyFlagParameters(),
      );
      if (this.closed) return null;
      const row = result.rows[0];
      if (!row || row.rewrite !== false || row.auto_send !== false) {
        this.report('POLICY_READ_FAILED');
        return null;
      }
      return Object.freeze({
        rewrite: false,
        auto_send: false,
        autofill_adapter: row.autofill_adapter,
        llm_ranker: row.llm_ranker,
        metrics_experimental_kpi: row.metrics_experimental_kpi,
      });
    } catch (error: unknown) {
      this.report('POLICY_READ_FAILED', error);
      return null;
    }
  }

  private async executeProbe(): Promise<ServiceReadinessChecks> {
    try {
      const result = await this.pool.query<RuntimeSchemaProbeRow>(RUNTIME_SCHEMA_PROBE_SQL);
      if (this.closed) return freezeChecks('not_ready', 'not_ready');
      const interpreted = interpretRuntimeSchemaRow(result.rows[0]);
      return freezeChecks(interpreted.database, interpreted.schema);
    } catch (error: unknown) {
      this.report('DATABASE_READINESS_PROBE_FAILED', error);
      return freezeChecks('not_ready', 'not_ready');
    }
  }

  private report(code: ApiRuntimeDiagnosticCode, error?: unknown): void {
    try {
      this.diagnosticSink(createApiRuntimeDiagnostic(code, error));
    } catch {
      // Diagnostics are observational; a broken sink must not change readiness
      // or expose the raw failure through a secondary exception.
    }
  }

  close(): Promise<void> {
    if (this.closePromise === null) {
      this.closed = true;
      this.closePromise = this.pool.end();
    }
    return this.closePromise;
  }
}

export function createServiceRepository(
  config: ApiDatabaseBootstrapConfig,
  diagnosticSink: ApiRuntimeDiagnosticSink = reportApiRuntimeDiagnostic,
): ServiceRepository {
  return createServiceRepositoryForPool(new Pool({
    Client: RuntimePoolClient,
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    query_timeout: config.readinessTimeoutMs,
    statement_timeout: config.readinessTimeoutMs,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'cs-ai-api',
    maxLifetimeSeconds: 300,
    verify: createRuntimePoolVerify(config.connectionTimeoutMs),
  }), {
    readinessTimeoutMs: config.readinessTimeoutMs,
    diagnosticSink,
  });
}

/** Internal deterministic test seam; not exported from the package entrypoint. */
const sharedRuntimePools = new WeakMap<ServiceRepository, Pool>();

export function createServiceRepositoryForPool(
  pool: RuntimePool,
  options: Readonly<{
    readinessTimeoutMs?: number;
    diagnosticSink?: ApiRuntimeDiagnosticSink;
    now?: RuntimeClock;
  }> = {},
): ServiceRepository {
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 2_000;
  if (!Number.isSafeInteger(readinessTimeoutMs) || readinessTimeoutMs <= 0) {
    throw new RangeError('readinessTimeoutMs must be a positive integer');
  }
  const repository = new PostgresServiceRepository(
    pool,
    readinessTimeoutMs,
    options.diagnosticSink ?? (() => undefined),
    options.now ?? (() => performance.now()),
  );
  if (pool instanceof Pool) sharedRuntimePools.set(repository, pool);
  return repository;
}

/** Shared app_runtime pool. Announce/current/snapshot/ack reuse it instead of opening another pool. */
export function sharedRuntimePool(repository: ServiceRepository): Pool | undefined {
  return sharedRuntimePools.get(repository);
}
