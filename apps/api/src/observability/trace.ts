import type {
  ObservabilityStage,
  QueryTelemetryRecord,
  StageOutcome,
  StageRecord,
  TraceIdentity,
} from '@customer-agent/unified-contracts';
import { ObservabilityError } from './errors.js';

export const TRACE_STAGE_ORDERS = Object.freeze({
  ordinary: Object.freeze([
    'request',
    'access',
    'release-read',
    'recall',
    'fusion',
    'rerank',
    'response-validation',
    'transport',
    'copy',
  ] as const),
  sop: Object.freeze([
    'request',
    'access',
    'release-read',
    'sop-match',
    'sop-path-expansion',
    'sop-branch-selection',
    'sop-response-validation',
    'transport',
    'copy',
  ] as const),
});

export const MAX_TRACE_STAGES = 32;

export type TerminalTraceStatus = Exclude<StageOutcome, 'succeeded'>;
export type TraceStatus = TerminalTraceStatus | 'complete' | 'incomplete';

export type TraceStageDuration = Readonly<{
  stage: ObservabilityStage;
  durationMs: number;
  outcome: StageOutcome;
}>;

export type AssembledTrace = Readonly<{
  trace: TraceIdentity;
  query: QueryTelemetryRecord;
  status: TraceStatus;
  stages: readonly StageRecord[];
  totalDurationMs: number;
  stageDurations: readonly TraceStageDuration[];
}>;

function sameTrace(left: TraceIdentity, right: TraceIdentity): boolean {
  return left.requestId === right.requestId
    && left.operationId === right.operationId
    && left.queryId === right.queryId
    && left.parentQueryId === right.parentQueryId
    && left.sessionEpoch === right.sessionEpoch
    && left.generation === right.generation
    && left.releaseId === right.releaseId
    && left.kind === right.kind;
}

function assertStageLimit(stages: readonly StageRecord[], maximum: number): void {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_TRACE_STAGES) {
    throw new ObservabilityError(
      'TRACE_STAGE_LIMIT',
      `maximum stages must be an integer from 1 through ${MAX_TRACE_STAGES}`,
    );
  }
  if (stages.length > maximum) {
    throw new ObservabilityError('TRACE_STAGE_LIMIT', 'trace exceeds the configured stage limit');
  }
}

function terminalStatus(outcome: StageOutcome): outcome is TerminalTraceStatus {
  return outcome !== 'succeeded';
}

export function assembleTrace(
  query: QueryTelemetryRecord,
  stages: readonly StageRecord[],
  maximumStages = MAX_TRACE_STAGES,
): AssembledTrace {
  const trace = query.trace;
  if (trace === null) {
    throw new ObservabilityError('TRACE_IDENTITY_REQUIRED', 'query telemetry requires a trace identity');
  }
  if (trace.releaseId === null || trace.releaseId !== query.releaseId) {
    throw new ObservabilityError('TRACE_RELEASE_REQUIRED', 'trace and query must share a release identity');
  }

  assertStageLimit(stages, maximumStages);
  const order = TRACE_STAGE_ORDERS[query.kind] as readonly ObservabilityStage[];
  const seen = new Set<ObservabilityStage>();
  let previousIndex = -1;
  let terminal: TerminalTraceStatus | null = null;

  for (const stage of stages) {
    if (stage.trace === null || !sameTrace(trace, stage.trace)) {
      throw new ObservabilityError(
        'TRACE_STAGE_UNRELATED',
        'every stage must carry the query trace identity',
      );
    }
    if (terminal !== null) {
      throw new ObservabilityError(
        'TRACE_ALREADY_TERMINAL',
        'a non-success stage ends the trace',
      );
    }
    const index = order.indexOf(stage.stage);
    if (index < 0) {
      throw new ObservabilityError(
        'TRACE_STAGE_NOT_APPLICABLE',
        'stage does not belong to this query kind',
      );
    }
    if (seen.has(stage.stage)) {
      throw new ObservabilityError('TRACE_STAGE_DUPLICATE', 'trace contains a duplicate stage');
    }
    if (index <= previousIndex) {
      throw new ObservabilityError(
        'TRACE_STAGE_OUT_OF_ORDER',
        'trace stages must follow the declared order',
      );
    }
    seen.add(stage.stage);
    previousIndex = index;
    if (terminalStatus(stage.outcome)) terminal = stage.outcome;
  }

  const totalDurationMs = stages.reduce((total, stage) => total + stage.durationMs, 0);
  const last = stages.at(-1);
  let status: TraceStatus;
  if (terminal !== null) {
    status = terminal;
  } else {
    const transported = stages.some((stage) => (
      stage.stage === 'transport' && stage.outcome === 'succeeded'
    ));
    status = transported && (last?.outcome === 'succeeded') ? 'complete' : 'incomplete';
  }

  return Object.freeze({
    trace,
    query,
    status,
    stages: Object.freeze([...stages]),
    totalDurationMs,
    stageDurations: Object.freeze(stages.map((stage) => Object.freeze({
      stage: stage.stage,
      durationMs: stage.durationMs,
      outcome: stage.outcome,
    }))),
  });
}
