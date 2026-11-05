import type {
  AlertRecord,
  BudgetBreachAlert,
  DeadLetterGrowthAlert,
  EvaluationRecord,
  QueryTelemetryRecord,
  ReleaseIndexFailureAlert,
  StageRecord,
  StaleReleaseAlert,
  TraceIdentity,
  UnknownOperationAlert,
} from '@customer-agent/unified-contracts';

function copyTrace(trace: TraceIdentity): TraceIdentity {
  const common = {
    requestId: trace.requestId,
    operationId: trace.operationId,
    queryId: trace.queryId,
    parentQueryId: trace.parentQueryId,
    releaseId: trace.releaseId,
    kind: trace.kind,
  };
  if (trace.sessionEpoch === null) {
    return Object.freeze({ ...common, sessionEpoch: null, generation: null });
  }
  return Object.freeze({
    ...common,
    sessionEpoch: trace.sessionEpoch,
    generation: trace.generation,
  });
}

export function redactTraceIdentity(trace: TraceIdentity): TraceIdentity {
  return copyTrace(trace);
}

export function redactQueryTelemetry(record: QueryTelemetryRecord): QueryTelemetryRecord {
  const trace = record.trace === null ? null : copyTrace(record.trace);
  if (record.kind === 'sop') {
    return Object.freeze({
      trace,
      kind: 'sop',
      releaseId: record.releaseId,
      queryFingerprint: record.queryFingerprint,
      queryLength: record.queryLength,
      intent: 'sop',
    });
  }
  return Object.freeze({
    trace,
    kind: 'ordinary',
    releaseId: record.releaseId,
    queryFingerprint: record.queryFingerprint,
    queryLength: record.queryLength,
    intent: record.intent,
  });
}

export function redactStageRecord(record: StageRecord): StageRecord {
  const common = {
    trace: record.trace === null ? null : copyTrace(record.trace),
    stage: record.stage,
    startedAt: record.startedAt,
    durationMs: record.durationMs,
    budgetClass: record.budgetClass,
    external: record.external,
  };
  if (record.outcome === 'succeeded') {
    return Object.freeze({ ...common, outcome: 'succeeded', errorCode: null });
  }
  if (record.outcome === 'failed') {
    return Object.freeze({ ...common, outcome: 'failed', errorCode: record.errorCode });
  }
  return Object.freeze({
    ...common,
    outcome: record.outcome,
    errorCode: record.errorCode,
  });
}

export function redactEvaluationRecord(record: EvaluationRecord): EvaluationRecord {
  const common = {
    datasetId: record.datasetId,
    datasetVersion: record.datasetVersion,
    samples: record.samples,
    errors: record.errors,
    limiter: record.limiter,
  };
  if (record.kind === 'ordinary') {
    return Object.freeze({
      ...common,
      kind: 'ordinary',
      metrics: Object.freeze({
        recallAtK: record.metrics.recallAtK,
        topK: record.metrics.topK,
        noHitCount: record.metrics.noHitCount,
        responseValidationFailureCount: record.metrics.responseValidationFailureCount,
      }),
    });
  }
  return Object.freeze({
    ...common,
    kind: 'sop',
    metrics: Object.freeze({
      matchedCount: record.metrics.matchedCount,
      validPathCount: record.metrics.validPathCount,
      validBranchCount: record.metrics.validBranchCount,
      staleReleaseRejectedCount: record.metrics.staleReleaseRejectedCount,
      unauthorizedResourceRejectedCount: record.metrics.unauthorizedResourceRejectedCount,
    }),
  });
}

export function redactBudgetBreachAlert(alert: BudgetBreachAlert): BudgetBreachAlert {
  return Object.freeze({
    kind: 'budget_breach',
    observedAt: alert.observedAt,
    stage: alert.stage,
    budgetClass: alert.budgetClass,
    percentile: alert.percentile,
    thresholdMs: alert.thresholdMs,
    observedMs: alert.observedMs,
    sampleCount: alert.sampleCount,
  });
}

export function redactUnknownOperationAlert(alert: UnknownOperationAlert): UnknownOperationAlert {
  return Object.freeze({
    kind: 'unknown_operation',
    observedAt: alert.observedAt,
    operationId: alert.operationId,
    reasonCode: alert.reasonCode,
  });
}

export function redactDeadLetterGrowthAlert(
  alert: DeadLetterGrowthAlert,
): DeadLetterGrowthAlert {
  return Object.freeze({
    kind: 'dead_letter_growth',
    observedAt: alert.observedAt,
    queue: alert.queue,
    previousDepth: alert.previousDepth,
    currentDepth: alert.currentDepth,
  });
}

export function redactStaleReleaseAlert(alert: StaleReleaseAlert): StaleReleaseAlert {
  return Object.freeze({
    kind: 'stale_release',
    observedAt: alert.observedAt,
    trace: copyTrace(alert.trace),
    expectedReleaseId: alert.expectedReleaseId,
  });
}

export function redactReleaseIndexFailureAlert(
  alert: ReleaseIndexFailureAlert,
): ReleaseIndexFailureAlert {
  return Object.freeze({
    kind: 'release_index_failure',
    observedAt: alert.observedAt,
    releaseId: alert.releaseId,
    projection: alert.projection,
    errorCode: alert.errorCode,
  });
}

export function redactAlertRecord(record: AlertRecord): AlertRecord {
  switch (record.kind) {
    case 'budget_breach':
      return redactBudgetBreachAlert(record);
    case 'unknown_operation':
      return redactUnknownOperationAlert(record);
    case 'dead_letter_growth':
      return redactDeadLetterGrowthAlert(record);
    case 'stale_release':
      return redactStaleReleaseAlert(record);
    case 'release_index_failure':
      return redactReleaseIndexFailureAlert(record);
  }
}
