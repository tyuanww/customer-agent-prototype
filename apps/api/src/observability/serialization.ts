import {
  parseAlertRecord,
  parseEvaluationRecord,
  parseQueryTelemetryRecord,
  parseStageRecord,
  parseTraceIdentity,
  type AlertRecord,
  type EvaluationRecord,
  type QueryTelemetryRecord,
  type StageRecord,
} from '@customer-agent/unified-contracts';
import {
  redactAlertRecord,
  redactEvaluationRecord,
  redactQueryTelemetry,
  redactStageRecord,
  redactTraceIdentity,
} from './redaction.js';
import type { AssembledTrace } from './trace.js';

function stringifyKnown(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function serializeQueryTelemetry(record: QueryTelemetryRecord): string {
  return stringifyKnown(parseQueryTelemetryRecord(redactQueryTelemetry(record)));
}

export function serializeStageRecord(record: StageRecord): string {
  return stringifyKnown(parseStageRecord(redactStageRecord(record)));
}

export function serializeEvaluationRecord(record: EvaluationRecord): string {
  return stringifyKnown(parseEvaluationRecord(redactEvaluationRecord(record)));
}

export function serializeAlertRecord(record: AlertRecord): string {
  return stringifyKnown(parseAlertRecord(redactAlertRecord(record)));
}

export function serializeAssembledTrace(assembled: AssembledTrace): string {
  return stringifyKnown({
    trace: parseTraceIdentity(redactTraceIdentity(assembled.trace)),
    query: parseQueryTelemetryRecord(redactQueryTelemetry(assembled.query)),
    status: assembled.status,
    stages: assembled.stages.map((record) => (
      parseStageRecord(redactStageRecord(record))
    )),
    totalDurationMs: assembled.totalDurationMs,
    stageDurations: assembled.stageDurations.map((stage) => ({
      stage: stage.stage,
      durationMs: stage.durationMs,
      outcome: stage.outcome,
    })),
  });
}
