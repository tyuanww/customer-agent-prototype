import { createHmac } from 'node:crypto';
import {
  parseEvaluationRecord,
  parseQueryTelemetryRecord,
  parseStageRecord,
  parseTraceIdentity,
} from '../../packages/unified-contracts/src/index.ts';
import type {
  BudgetSurface,
  LatencyBatch,
  LatencySummary,
  TraceStatus,
} from '../../apps/api/src/observability/index.ts';

const OBSERVED_AT = '2026-11-05T00:00:00.000Z';
const RELEASE_ID = 'rel_obs_01';
const FIXTURE_LIMITER = 'synthetic-fixture-v1';

type Temperature = 'warm' | 'cold';

type SurfaceFixture = Readonly<{
  surface: BudgetSurface;
  kind: 'ordinary' | 'sop' | null;
  stage: 'transport' | 'dashboard-operation';
  warmErrors: number;
  coldErrors: number;
  duration: (temperature: Temperature, index: number) => number;
}>;

const SURFACES: readonly SurfaceFixture[] = Object.freeze([
  Object.freeze({
    surface: 'ordinary-query',
    kind: 'ordinary',
    stage: 'transport',
    warmErrors: 2,
    coldErrors: 0,
    duration: (temperature, index) => {
      const base = temperature === 'warm' ? 350 + ((index * 3) % 80) : 520 + ((index * 3) % 50);
      return temperature === 'warm' && index >= 180 ? base + 160 : base;
    },
  }),
  Object.freeze({
    surface: 'sop-query',
    kind: 'sop',
    stage: 'transport',
    warmErrors: 0,
    coldErrors: 1,
    duration: (temperature, index) => {
      const base = temperature === 'warm' ? 160 + ((index * 5) % 70) : 230 + ((index * 5) % 40);
      return temperature === 'warm' && index >= 185 ? base + 30 : base;
    },
  }),
  Object.freeze({
    surface: 'dashboard-acceptance',
    kind: null,
    stage: 'dashboard-operation',
    warmErrors: 1,
    coldErrors: 0,
    duration: (temperature, index) => {
      const base = temperature === 'warm' ? 220 + ((index * 4) % 70) : 320 + ((index * 4) % 30);
      return temperature === 'warm' && index >= 185 ? base + 35 : base;
    },
  }),
  Object.freeze({
    surface: 'overlay-dispatch',
    kind: null,
    stage: 'transport',
    warmErrors: 0,
    coldErrors: 0,
    duration: (temperature, index) => (
      temperature === 'warm' ? 20 + ((index * 3) % 22) : 40 + ((index * 2) % 15)
    ),
  }),
] satisfies readonly SurfaceFixture[]);

function fingerprint(seed: string): `${string}` {
  return createHmac('sha256', 'synthetic-observability-fixture')
    .update(seed)
    .digest('hex');
}

function traceFor(
  kind: 'ordinary' | 'sop',
  surface: BudgetSurface,
  temperature: Temperature,
  index: number,
  releaseId = RELEASE_ID,
) {
  return parseTraceIdentity({
    requestId: `req-${surface}-${temperature}-${index}`,
    operationId: null,
    queryId: `query-${surface}-${temperature}-${index}`,
    parentQueryId: null,
    sessionEpoch: 1,
    generation: index,
    releaseId,
    kind,
  });
}

function queryFor(
  kind: 'ordinary' | 'sop',
  surface: BudgetSurface,
  temperature: Temperature,
  index: number,
) {
  return parseQueryTelemetryRecord({
    trace: traceFor(kind, surface, temperature, index),
    kind,
    releaseId: RELEASE_ID,
    queryFingerprint: fingerprint(`${kind}:${surface}:${temperature}:${index}`),
    queryLength: 12 + (index % 7),
    intent: kind === 'sop' ? 'sop' : 'product',
  });
}

function stage(
  trace: ReturnType<typeof traceFor>,
  name: string,
  index: number,
  durationMs: number,
  outcome: 'succeeded' | 'failed' | 'cancelled',
  errorCode: string | null,
) {
  return parseStageRecord({
    trace,
    stage: name,
    startedAt: `2026-11-05T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    durationMs,
    outcome,
    errorCode,
    budgetClass: 'interactive',
    external: false,
  });
}

function queryStageRecords(
  query: ReturnType<typeof queryFor>,
  index: number,
  durationMs: number,
  failure: boolean,
  cancelled: boolean,
  incomplete: boolean,
) {
  const order = query.kind === 'ordinary'
    ? ['request', 'access', 'release-read', 'recall', 'fusion', 'rerank', 'response-validation', 'transport'] as const
    : ['request', 'access', 'release-read', 'sop-match', 'sop-path-expansion', 'sop-branch-selection', 'sop-response-validation', 'transport'] as const;
  const first = order.slice(0, -1);
  const records = first.map((name, stageIndex) => stage(
    query.trace as NonNullable<typeof query.trace>,
    name,
    stageIndex,
    1 + (stageIndex % 3),
    'succeeded',
    null,
  ));
  if (!incomplete) {
    const outcome = failure ? 'failed' : cancelled ? 'cancelled' : 'succeeded';
    const errorCode = failure ? 'SYNTHETIC_STAGE_FAILURE' : cancelled ? 'SYNTHETIC_CANCELLED' : null;
    records.push(stage(
      query.trace as NonNullable<typeof query.trace>,
      'transport',
      order.length - 1,
      Math.max(0, durationMs - records.reduce((total, record) => total + record.durationMs, 0)),
      outcome,
      errorCode,
    ));
  }
  return records;
}

function emptyStatusCounts(): Record<TraceStatus, number> {
  return {
    complete: 0,
    incomplete: 0,
    cancelled: 0,
    failed: 0,
    stale: 0,
    unknown: 0,
  };
}

function observationsFor(
  fixture: SurfaceFixture,
  temperature: Temperature,
  sampleCount: number,
) {
  return Array.from({ length: sampleCount }, (_, index) => ({
    durationMs: fixture.duration(temperature, index),
    error: index < (temperature === 'warm' ? fixture.warmErrors : fixture.coldErrors),
  }));
}

function evaluationFixtures() {
  return Object.freeze({
    ordinary: Object.freeze([
      parseEvaluationRecord({
        kind: 'ordinary',
        datasetId: 'ordinary-synthetic-obs-v1',
        datasetVersion: 1,
        samples: 120,
        errors: 0,
        limiter: 'dataset-size',
        metrics: {
          recallAtK: 0.91,
          topK: 3,
          noHitCount: 8,
          responseValidationFailureCount: 0,
        },
      }),
      parseEvaluationRecord({
        kind: 'ordinary',
        datasetId: 'ordinary-synthetic-obs-v1',
        datasetVersion: 1,
        samples: 80,
        errors: 1,
        limiter: 'dataset-size',
        metrics: {
          recallAtK: 0.95,
          topK: 3,
          noHitCount: 3,
          responseValidationFailureCount: 1,
        },
      }),
    ]),
    sop: Object.freeze([
      parseEvaluationRecord({
        kind: 'sop',
        datasetId: 'sop-synthetic-obs-v1',
        datasetVersion: 1,
        samples: 160,
        errors: 0,
        limiter: 'dataset-size',
        metrics: {
          matchedCount: 152,
          validPathCount: 148,
          validBranchCount: 146,
          staleReleaseRejectedCount: 4,
          unauthorizedResourceRejectedCount: 2,
        },
      }),
      parseEvaluationRecord({
        kind: 'sop',
        datasetId: 'sop-synthetic-obs-v1',
        datasetVersion: 1,
        samples: 40,
        errors: 1,
        limiter: 'dataset-size',
        metrics: {
          matchedCount: 38,
          validPathCount: 37,
          validBranchCount: 36,
          staleReleaseRejectedCount: 1,
          unauthorizedResourceRejectedCount: 1,
        },
      }),
    ]),
  });
}

export type SyntheticFixtureOutput = Readonly<{
  observedAt: string;
  latency: readonly LatencySummary[];
  traceStatusCounts: Readonly<{
    ordinary: Readonly<Record<TraceStatus, number>>;
    sop: Readonly<Record<TraceStatus, number>>;
  }>;
  evaluations: ReturnType<typeof evaluationFixtures>;
  latencyBatches: readonly LatencyBatch[];
  unknownOperations: Parameters<ObservabilityRuntime['buildAlertRecords']>[0]['unknownOperations'];
  deadLetters: Parameters<ObservabilityRuntime['buildAlertRecords']>[0]['deadLetters'];
  staleReleases: Parameters<ObservabilityRuntime['buildAlertRecords']>[0]['staleReleases'];
  releaseIndexFailures: Parameters<ObservabilityRuntime['buildAlertRecords']>[0]['releaseIndexFailures'];
}>;

export type ObservabilityRuntime = Pick<
  typeof import('../../apps/api/src/observability/index.ts'),
  'assembleTrace' | 'buildAlertRecords' | 'summarizeLatency'
>;

export function buildSyntheticFixtures(runtime: ObservabilityRuntime): SyntheticFixtureOutput {
  const ordinaryCounts = emptyStatusCounts();
  const sopCounts = emptyStatusCounts();
  const latencyBatches: LatencyBatch[] = [];
  const latency: LatencySummary[] = [];

  for (const fixture of SURFACES) {
    for (const temperature of ['warm', 'cold'] as const) {
      const sampleCount = temperature === 'warm' ? 200 : 20;
      const observations = observationsFor(fixture, temperature, sampleCount);
      latencyBatches.push(Object.freeze({
        surface: fixture.surface,
        stage: fixture.stage,
        budgetClass: 'interactive',
        temperature,
        limiter: FIXTURE_LIMITER,
        observations: Object.freeze(observations),
      }));
      latency.push(runtime.summarizeLatency(latencyBatches.at(-1) as LatencyBatch));

      if (fixture.kind !== null) {
        const counts = fixture.kind === 'ordinary' ? ordinaryCounts : sopCounts;
        for (let index = 0; index < sampleCount; index += 1) {
          const query = queryFor(fixture.kind, fixture.surface, temperature, index);
          const failure = index < (temperature === 'warm' ? fixture.warmErrors : fixture.coldErrors);
          const cancelled = !failure && index === 0;
          const incomplete = !failure && !cancelled && index === 1;
          const trace = runtime.assembleTrace(
            query,
            queryStageRecords(
              query,
              index,
              observations[index]?.durationMs ?? 0,
              failure,
              cancelled,
              incomplete,
            ),
          );
          counts[trace.status] += 1;
        }
      }
    }
  }

  const staleTrace = traceFor('ordinary', 'ordinary-query', 'warm', 0, 'rel_obs_stale');
  return Object.freeze({
    observedAt: OBSERVED_AT,
    latency: Object.freeze(latency),
    traceStatusCounts: Object.freeze({
      ordinary: Object.freeze(ordinaryCounts),
      sop: Object.freeze(sopCounts),
    }),
    evaluations: evaluationFixtures(),
    latencyBatches: Object.freeze(latencyBatches),
    unknownOperations: Object.freeze([{
      observedAt: OBSERVED_AT,
      operationId: 'op_unknown_synthetic',
      reasonCode: 'UNKNOWN_OPERATION',
    }]),
    deadLetters: Object.freeze([
      {
        observedAt: OBSERVED_AT,
        queue: 'content-parse',
        previousDepth: 2,
        currentDepth: 5,
      },
      {
        observedAt: OBSERVED_AT,
        queue: 'release-index',
        previousDepth: 1,
        currentDepth: 1,
      },
    ]),
    staleReleases: Object.freeze([{
      observedAt: OBSERVED_AT,
      trace: staleTrace,
      expectedReleaseId: 'rel_obs_current',
    }]),
    releaseIndexFailures: Object.freeze([{
      observedAt: OBSERVED_AT,
      releaseId: 'rel_obs_broken',
      projection: 'sop',
      errorCode: 'SYNTHETIC_INDEX_FAILURE',
    }]),
  });
}
