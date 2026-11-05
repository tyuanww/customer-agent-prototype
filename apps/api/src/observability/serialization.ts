import type {
  AlertRecord,
  EvaluationRecord,
  QueryTelemetryRecord,
  StageRecord,
} from './contracts.generated.js';
import {
  redactAlertRecord,
  redactEvaluationRecord,
  redactQueryTelemetry,
  redactStageRecord,
} from './redaction.js';
import type { AssembledTrace } from './trace.js';

function stringifyKnown(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function serializeQueryTelemetry(record: QueryTelemetryRecord): string {
  return stringifyKnown(redactQueryTelemetry(record));
}

export function serializeStageRecord(record: StageRecord): string {
  return stringifyKnown(redactStageRecord(record));
}

export function serializeEvaluationRecord(record: EvaluationRecord): string {
  return stringifyKnown(redactEvaluationRecord(record));
}

export function serializeAlertRecord(record: AlertRecord): string {
  return stringifyKnown(redactAlertRecord(record));
}

export function serializeAssembledTrace(trace: AssembledTrace): string {
  return stringifyKnown({
    trace: trace.trace,
    query: redactQueryTelemetry(trace.query),
    status: trace.status,
    stages: trace.stages.map(redactStageRecord),
    totalDurationMs: trace.totalDurationMs,
    stageDurations: trace.stageDurations.map((stage) => ({
      stage: stage.stage,
      durationMs: stage.durationMs,
      outcome: stage.outcome,
    })),
  });
}
