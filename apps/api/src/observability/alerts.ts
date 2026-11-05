import type {
  AlertRecord,
  DeadLetterQueue,
  OperationId,
  ReleaseId,
  TraceIdentity,
} from '@customer-agent/unified-contracts';
import {
  BUDGET_SURFACES,
  DEFAULT_OBSERVABILITY_BUDGETS,
  evaluateBudget,
  type BudgetThresholds,
  type LatencySummary,
} from './metrics.js';
import { ObservabilityError } from './errors.js';

export type UnknownOperationObservation = Readonly<{
  observedAt: string;
  operationId: OperationId;
  reasonCode: string;
}>;

export type DeadLetterObservation = Readonly<{
  observedAt: string;
  queue: DeadLetterQueue;
  previousDepth: number;
  currentDepth: number;
}>;

export type StaleReleaseObservation = Readonly<{
  observedAt: string;
  trace: TraceIdentity;
  expectedReleaseId: ReleaseId;
}>;

export type ReleaseIndexFailureObservation = Readonly<{
  observedAt: string;
  releaseId: ReleaseId;
  projection: 'content' | 'sop';
  errorCode: string;
}>;

export type AlertObservationInput = Readonly<{
  observedAt: string;
  latency: readonly LatencySummary[];
  unknownOperations: readonly UnknownOperationObservation[];
  deadLetters: readonly DeadLetterObservation[];
  staleReleases: readonly StaleReleaseObservation[];
  releaseIndexFailures: readonly ReleaseIndexFailureObservation[];
}>;

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new ObservabilityError(
      'ALERT_INVALID_OBSERVATION',
      `${label} requires a positive integer`,
    );
  }
}

function assertDepth(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ObservabilityError(
      'ALERT_INVALID_OBSERVATION',
      'dead-letter depths require non-negative integers',
    );
  }
}

function alertSortKey(alert: AlertRecord): string {
  switch (alert.kind) {
    case 'budget_breach':
      return `0:${alert.stage}:${alert.budgetClass}:${alert.thresholdMs}`;
    case 'unknown_operation':
      return `1:${alert.operationId}:${alert.reasonCode}`;
    case 'dead_letter_growth':
      return `2:${alert.queue}`;
    case 'stale_release':
      return `3:${alert.trace.queryId}:${alert.expectedReleaseId}`;
    case 'release_index_failure':
      return `4:${alert.releaseId}:${alert.projection}:${alert.errorCode}`;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildAlertRecords(
  input: AlertObservationInput,
  thresholds: BudgetThresholds = DEFAULT_OBSERVABILITY_BUDGETS,
): readonly AlertRecord[] {
  const alerts: AlertRecord[] = [];

  const seenSurfaces = new Set<string>();
  for (const summary of input.latency) {
    if (!BUDGET_SURFACES.includes(summary.surface)) {
      throw new ObservabilityError('ALERT_INVALID_OBSERVATION', 'latency surface is not supported');
    }
    seenSurfaces.add(`${summary.surface}:${summary.temperature}`);
    assertPositiveInteger(summary.sampleCount, 'budget alert');
    const budget = evaluateBudget(summary, thresholds);
    if (budget.breached) {
      alerts.push(Object.freeze({
        kind: 'budget_breach',
        observedAt: input.observedAt,
        stage: budget.stage,
        budgetClass: budget.budgetClass,
        percentile: 'p95',
        thresholdMs: budget.thresholdMs,
        observedMs: budget.observedMs,
        sampleCount: budget.sampleCount,
      }));
    }
  }
  if (seenSurfaces.size !== input.latency.length) {
    throw new ObservabilityError(
      'ALERT_INVALID_OBSERVATION',
      'latency summaries require one warm and one cold entry per surface',
    );
  }

  for (const observation of input.unknownOperations) {
    alerts.push(Object.freeze({
      kind: 'unknown_operation',
      observedAt: observation.observedAt,
      operationId: observation.operationId,
      reasonCode: observation.reasonCode,
    }));
  }

  for (const observation of input.deadLetters) {
    assertDepth(observation.previousDepth);
    assertDepth(observation.currentDepth);
    if (observation.currentDepth > observation.previousDepth) {
      alerts.push(Object.freeze({
        kind: 'dead_letter_growth',
        observedAt: observation.observedAt,
        queue: observation.queue,
        previousDepth: observation.previousDepth,
        currentDepth: observation.currentDepth,
      }));
    }
  }

  for (const observation of input.staleReleases) {
    if (observation.trace.releaseId === null
      || observation.trace.releaseId === observation.expectedReleaseId) {
      throw new ObservabilityError(
        'ALERT_INVALID_OBSERVATION',
        'stale release observation requires two different release IDs',
      );
    }
    alerts.push(Object.freeze({
      kind: 'stale_release',
      observedAt: observation.observedAt,
      trace: observation.trace,
      expectedReleaseId: observation.expectedReleaseId,
    }));
  }

  for (const observation of input.releaseIndexFailures) {
    alerts.push(Object.freeze({
      kind: 'release_index_failure',
      observedAt: observation.observedAt,
      releaseId: observation.releaseId,
      projection: observation.projection,
      errorCode: observation.errorCode,
    }));
  }

  alerts.sort((left, right) => compareText(alertSortKey(left), alertSortKey(right)));
  return Object.freeze(alerts);
}
