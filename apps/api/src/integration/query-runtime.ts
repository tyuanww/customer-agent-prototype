import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { components } from '@customer-agent/contracts';
import {
  parseQueryOutcome,
  parseQueryTelemetryRecord,
  parseStageRecord,
  parseTraceIdentity,
  type BudgetClass,
  type QueryId,
  type QueryIntent,
  type QueryKind,
  type QueryOutcome,
  type QueryTelemetryRecord,
  type ReleaseSnapshot,
  type StageOutcome,
  type StageRecord,
  type TraceIdentity,
} from '@customer-agent/unified-contracts';
import type { AccessEvaluator } from '../access/evaluator.js';
import {
  assembleTrace,
  serializeAssembledTrace,
  serializeStageRecord,
} from '../observability/index.js';
import {
  ContentPipeline,
} from '../query/content-pipeline.js';
import {
  QueryCoordinator,
  type QueryAccessEvaluator,
  type QueryExecutionContext,
  type QueryTelemetryEvent,
} from '../query/query-coordinator.js';
import { SopPipeline } from '../query/sop-pipeline.js';
import type { PreparedSearchOperation } from '../search-routes.js';
import type { SearchBackendResult } from '../search-service.js';
import { toArcAccessDecision } from './access.js';
import {
  type CurrentReleaseIdentityReader,
  type LoadedQueryRelease,
  type QueryReleaseLoader,
} from './release.js';

type SearchCandidate = components['schemas']['SearchCandidate'];

type ActiveQueryRelease = LoadedQueryRelease & Readonly<{
  sop: SopPipeline | null;
}>;

type CollectedStage = Readonly<{
  stage: StageRecord['stage'];
  startedAt: string;
  durationMs: number;
  outcome: StageOutcome;
  errorCode: string | null;
  budgetClass: BudgetClass;
  external: boolean;
}>;

export type QueryObservation = Readonly<{
  trace: TraceIdentity;
  query: QueryTelemetryRecord | null;
  stages: readonly StageRecord[];
}>;

export type QueryObserver = Readonly<{
  record: (observation: QueryObservation) => void;
}>;

export type ApiQueryRuntime = Readonly<{
  initialize: () => Promise<boolean>;
  afterReleaseMutation: () => Promise<boolean>;
  search: (request: PreparedSearchOperation) => Promise<SearchBackendResult>;
  readiness: () => 'ok' | 'not_ready';
  inspect: () => Readonly<{
    activeReleaseId: string | null;
    activationCount: number;
    queryCount: number;
    sopItemCount: number;
    activating: boolean;
    closed: boolean;
  }>;
  close: () => Promise<void>;
}>;

type QueryRunContext = {
  request: PreparedSearchOperation;
  requestId: string;
  loaded: ActiveQueryRelease | null;
  stages: CollectedStage[];
  telemetry: QueryTelemetryEvent[];
};

const SOP_PROBE_EXPIRY = '2099-01-01T00:00:00.000Z';

function opaqueToken(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function encodedToken(prefix: string, value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('hex');
  return `${prefix}_${encoded.length <= 120 ? encoded : opaqueToken(prefix, value).slice(prefix.length + 1)}`;
}

function backendFailure(
  code: Extract<QueryOutcome, { kind: 'failure' }>['failureCode'],
): SearchBackendResult {
  if (code === 'ACCESS_DENIED' || code === 'ACCESS_EXPIRED') return { ok: false, code: 'FORBIDDEN' };
  if (code === 'RELEASE_STALE' || code === 'RELEASE_LEASE_EXPIRED') return { ok: false, code: 'CONFLICT' };
  if (code === 'VALIDATION') return { ok: false, code: 'VALIDATION' };
  return { ok: false, code: 'OVERLOADED' };
}

function queryKind(outcome: QueryOutcome): QueryKind {
  return outcome.kind === 'sop'
    || (outcome.kind === 'failure' && outcome.failureCode.startsWith('SOP_'))
    ? 'sop'
    : 'ordinary';
}

function intentFor(kind: QueryKind, request: PreparedSearchOperation): QueryIntent {
  if (kind === 'sop') return 'sop';
  return request.search.productContextType === null ? 'general' : 'product';
}

export function createSerializedQueryObserver(
  sink: (line: string) => void = (line) => console.info(line),
): QueryObserver {
  return Object.freeze({
    record(observation) {
      try {
        if (observation.query !== null) {
          sink(serializeAssembledTrace(assembleTrace(observation.query, observation.stages)));
          return;
        }
        for (const stage of observation.stages) sink(serializeStageRecord(stage));
      } catch {
        // A malformed or broken sink cannot alter the query result.
      }
    },
  });
}

export function createApiQueryRuntime(options: Readonly<{
  loader: QueryReleaseLoader;
  access: AccessEvaluator;
  observer: QueryObserver;
  currentRelease?: CurrentReleaseIdentityReader;
  onActivationFailure?: (error: unknown) => void;
  onObservationFailure?: (error: unknown) => void;
  now?: () => Date;
}>): ApiQueryRuntime {
  const context = new AsyncLocalStorage<QueryRunContext>();
  const contentPipeline = new ContentPipeline(options.now === undefined ? {} : { now: options.now });
  let active: ActiveQueryRelease | null = null;
  let pending: Promise<boolean> | null = null;
  let closed = false;

  function currentContext(): QueryRunContext | null {
    return context.getStore() ?? null;
  }

  function addStage(
    run: QueryRunContext | null,
    stage: StageRecord['stage'],
    startedAt: string,
    started: number,
    outcome: StageOutcome,
    errorCode: string | null,
    budgetClass: BudgetClass,
    external = false,
  ): void {
    run?.stages.push(Object.freeze({
      stage,
      startedAt,
      durationMs: Math.max(0, performance.now() - started),
      outcome,
      errorCode,
      budgetClass,
      external,
    }));
  }

  async function measured<T>(
    run: QueryRunContext | null,
    stage: StageRecord['stage'],
    budgetClass: BudgetClass,
    work: () => Promise<Readonly<{ value: T; outcome: StageOutcome; errorCode: string | null }>>,
  ): Promise<T> {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const completed = await work();
      addStage(run, stage, startedAt, started, completed.outcome, completed.errorCode, budgetClass);
      return completed.value;
    } catch (error) {
      addStage(run, stage, startedAt, started, 'failed', 'STAGE_FAILED', budgetClass);
      throw error;
    }
  }

  const access: QueryAccessEvaluator = Object.freeze({
    async evaluate() {
      const run = currentContext();
      if (run === null) throw new Error('QUERY_CONTEXT_MISSING');
      return measured(run, 'access', 'interactive', async () => {
        const evaluation = await options.access.evaluate(run.request.actor.user_id, ['query']);
        const decision = toArcAccessDecision(
          run.request.actor,
          evaluation,
          active?.sourceScopes ?? [],
        );
        return {
          value: decision,
          outcome: decision.state === 'allowed' ? 'succeeded' : 'failed',
          errorCode: decision.state === 'allowed' ? null : decision.denyReason ?? 'ACCESS_DENIED',
        } as const;
      });
    },
  });

  const releases = Object.freeze({
    async current(): Promise<ReleaseSnapshot | null> {
      const run = currentContext();
      return measured(run, 'release-read', 'interactive', async () => {
        const loaded = active;
        if (loaded === null) {
          return { value: null, outcome: 'failed' as const, errorCode: 'RELEASE_UNAVAILABLE' };
        }
        if (options.currentRelease !== undefined) {
          const currentReleaseId = await options.currentRelease();
          if (currentReleaseId === null) {
            return { value: null, outcome: 'failed' as const, errorCode: 'RELEASE_UNAVAILABLE' };
          }
          if (currentReleaseId !== loaded.snapshot.releaseId) {
            void activate();
            return { value: null, outcome: 'stale' as const, errorCode: 'RELEASE_STALE' };
          }
        }
        if (run !== null) run.loaded = loaded;
        return { value: loaded.snapshot, outcome: 'succeeded' as const, errorCode: null };
      });
    },
  });

  const content = Object.freeze({
    query(input: Parameters<ContentPipeline['query']>[0]) {
      const run = currentContext();
      return measured(run, 'recall', 'interactive', async () => ({
        value: await contentPipeline.query(input),
        outcome: 'succeeded' as const,
        errorCode: null,
      }));
    },
  });

  const sop = Object.freeze({
    matches(text: string): boolean {
      const pipeline = active?.sop;
      const snapshot = active?.snapshot;
      if (pipeline === null || pipeline === undefined || snapshot === null || snapshot === undefined) return false;
      try {
        const result = pipeline.query({
          queryId: opaqueToken('qry', `sop-probe:${text}`),
          text,
          lease: {
            releaseId: snapshot.releaseId,
            sessionEpoch: 1,
            revoked: false,
            expiresAt: SOP_PROBE_EXPIRY,
          },
        });
        return result.kind !== 'no-hit';
      } catch {
        return true;
      }
    },
    async query(input: QueryExecutionContext): Promise<Extract<QueryOutcome, { kind: 'sop' | 'no-hit' | 'failure' }>> {
      const run = currentContext();
      return measured(run, 'sop-match', 'interactive', async () => {
        const pipeline = active?.sop;
        if (pipeline === null || pipeline === undefined) {
          const value = Object.freeze({
            kind: 'failure' as const,
            queryId: input.queryId,
            failureCode: 'SOP_UNAVAILABLE',
            retryable: false,
            message: '该问题需要售后流程，但当前版本尚不可用',
          });
          return { value, outcome: 'failed' as const, errorCode: value.failureCode };
        }
        const value = parseQueryOutcome(pipeline.query({
          queryId: input.queryId,
          text: input.text,
          lease: {
            releaseId: input.snapshot.releaseId,
            sessionEpoch: 1,
            revoked: false,
            expiresAt: input.access.expiresAt,
          },
        })) as Extract<QueryOutcome, { kind: 'sop' | 'no-hit' | 'failure' }>;
        return {
          value,
          outcome: value.kind === 'failure' ? 'failed' as const : 'succeeded' as const,
          errorCode: value.kind === 'failure' ? value.failureCode : null,
        };
      });
    },
  });

  const coordinator = new QueryCoordinator({
    access,
    releases,
    content,
    sop,
    telemetry: {
      record(event) {
        currentContext()?.telemetry.push(event);
      },
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  function observe(run: QueryRunContext, outcome: QueryOutcome): void {
    try {
      const kind = queryKind(outcome);
      const releaseId = run.loaded?.snapshot.releaseId ?? null;
      const trace = parseTraceIdentity({
        requestId: opaqueToken('req', run.requestId),
        operationId: null,
        queryId: encodedToken('qry', run.request.queryId),
        parentQueryId: run.request.parentQueryId === null
          ? null
          : encodedToken('qry', run.request.parentQueryId),
        sessionEpoch: null,
        generation: null,
        releaseId,
        kind,
      });
      const stages = run.stages.map((stage) => parseStageRecord({
        trace,
        stage: stage.stage,
        startedAt: stage.startedAt,
        durationMs: stage.durationMs,
        outcome: stage.outcome,
        errorCode: stage.errorCode,
        budgetClass: stage.budgetClass,
        external: stage.external,
      }));
      const query = releaseId === null
        ? null
        : parseQueryTelemetryRecord({
          trace,
          kind,
          releaseId,
          queryFingerprint: run.request.queryHash,
          queryLength: Math.max(1, [...run.request.search.normalizedQuery].length),
          intent: intentFor(kind, run.request),
        });
      options.observer.record(Object.freeze({ trace, query, stages: Object.freeze(stages) }));
    } catch (error) {
      // The observer is outside the user contract. Invalid or failed telemetry
      // must not change the search result.
      try { options.onObservationFailure?.(error); } catch { /* Observational. */ }
    }
  }

  function backendResult(
    request: PreparedSearchOperation,
    outcome: QueryOutcome,
    loaded: ActiveQueryRelease | null,
  ): SearchBackendResult {
    if (outcome.kind === 'failure') return backendFailure(outcome.failureCode);
    if (outcome.kind === 'sop') return { ok: false, code: 'OVERLOADED' };
    if (loaded === null) return { ok: false, code: 'OVERLOADED' };
    const candidates: SearchCandidate[] = [];
    if (outcome.kind === 'content') {
      for (const candidate of outcome.candidates.slice(0, request.search.topK)) {
        const metadata = loaded.candidates.get(candidate.candidateId);
        if (metadata === undefined) return { ok: false, code: 'INTERNAL' };
        candidates.push({ ...metadata, rank: candidates.length + 1 });
      }
    }
    return {
      ok: true,
      releaseId: loaded.snapshot.releaseId,
      sourceBindingHash: loaded.sourceBindingHash,
      decision: candidates.length === 0 ? 'reject' : 'show',
      candidates,
    };
  }

  async function activate(): Promise<boolean> {
    if (closed) return false;
    if (pending !== null) return pending;
    pending = (async () => {
      try {
        const loaded = await options.loader();
        if (loaded === null) {
          active = null;
          return false;
        }
        if (loaded.snapshot.content.state === 'ready') {
          contentPipeline.activate(loaded.snapshot, loaded.items);
        }
        const sopPipeline = loaded.sopProjection === null
          ? null
          : new SopPipeline(loaded.sopProjection);
        active = Object.freeze({ ...loaded, sop: sopPipeline });
        return true;
      } catch (error) {
        active = null;
        try { options.onActivationFailure?.(error); } catch { /* Observational. */ }
        return false;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  return Object.freeze({
    initialize: activate,
    afterReleaseMutation: activate,
    async search(request) {
      if (closed || active === null) return { ok: false, code: 'OVERLOADED' };
      const run: QueryRunContext = {
        request,
        requestId: request.requestId ?? request.queryId,
        loaded: null,
        stages: [],
        telemetry: [],
      };
      try {
        return await context.run(run, async () => {
          const outcome = await coordinator.query({
            queryId: encodedToken('qry', request.queryId) as QueryId,
            text: request.search.normalizedQuery,
            route: 'auto',
            platform: request.search.platform,
            productContextType: request.search.productContextType,
            productContextRef: request.search.productContextRef,
          });
          const backend = outcome.kind === 'failure'
            ? backendResult(request, outcome, run.loaded)
            : await measured(
              run,
              queryKind(outcome) === 'sop' ? 'sop-response-validation' : 'response-validation',
              'interactive',
              async () => ({
                value: backendResult(request, outcome, run.loaded),
                outcome: 'succeeded' as const,
                errorCode: null,
              }),
            );
          observe(run, outcome);
          return backend;
        });
      } catch {
        observe(run, {
          kind: 'failure',
          queryId: encodedToken('qry', request.queryId) as QueryId,
          failureCode: 'PIPELINE_FAILED',
          retryable: true,
          message: '查询暂不可用，请重试',
        });
        return { ok: false, code: 'OVERLOADED' };
      }
    },
    readiness() {
      return !closed && active !== null ? 'ok' : 'not_ready';
    },
    inspect() {
      const content = contentPipeline.inspect();
      return Object.freeze({
        activeReleaseId: active?.snapshot.releaseId ?? null,
        activationCount: content.activationCount,
        queryCount: content.queryCount,
        sopItemCount: active?.snapshot.sop.itemCount ?? 0,
        activating: pending !== null,
        closed,
      });
    },
    async close() {
      closed = true;
      await pending?.catch(() => undefined);
      active = null;
    },
  });
}
