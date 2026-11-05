import type {
  EvaluationRecord,
  QueryKind,
} from './contracts.generated.js';
import { ObservabilityError } from './errors.js';

type OrdinaryEvaluation = Extract<EvaluationRecord, { kind: 'ordinary' }>;
type SopEvaluation = Extract<EvaluationRecord, { kind: 'sop' }>;

export type EvaluationPair = Readonly<{
  ordinary: OrdinaryEvaluation;
  sop: SopEvaluation;
}>;

const MAX_SAMPLES = 1_000_000;

function assertEvaluationBase(records: readonly EvaluationRecord[]): EvaluationRecord {
  const first = records[0];
  if (first === undefined) {
    throw new ObservabilityError('EVALUATION_EMPTY', 'evaluation dataset requires at least one record');
  }
  for (const record of records) {
    if (record.datasetId !== first.datasetId || record.datasetVersion !== first.datasetVersion) {
      throw new ObservabilityError(
        'EVALUATION_DATASET_MIXED',
        'one evaluation group requires a fixed dataset ID and version',
      );
    }
    if (record.limiter !== first.limiter) {
      throw new ObservabilityError(
        'EVALUATION_LIMITER_MIXED',
        'one evaluation group requires one limiter',
      );
    }
  }
  return first;
}

function aggregateCounts(records: readonly EvaluationRecord[]): {
  samples: number;
  errors: number;
} {
  let samples = 0;
  let errors = 0;
  for (const record of records) {
    samples += record.samples;
    errors += record.errors;
  }
  if (samples > MAX_SAMPLES || errors > samples) {
    throw new ObservabilityError(
      'EVALUATION_COUNT_INVALID',
      'aggregated samples or errors exceed their contract bounds',
    );
  }
  return { samples, errors };
}

function aggregateOrdinary(records: readonly OrdinaryEvaluation[]): OrdinaryEvaluation {
  const first = assertEvaluationBase(records);
  const counts = aggregateCounts(records);
  const topK = first.kind === 'ordinary' ? first.metrics.topK : null;
  if (topK === null || records.some((record) => record.metrics.topK !== topK)) {
    throw new ObservabilityError(
      'EVALUATION_DATASET_MIXED',
      'ordinary evaluation group requires one topK',
    );
  }
  let recallWeighted = 0;
  let noHitCount = 0;
  let responseValidationFailureCount = 0;
  for (const record of records) {
    recallWeighted += record.metrics.recallAtK * record.samples;
    noHitCount += record.metrics.noHitCount;
    responseValidationFailureCount += record.metrics.responseValidationFailureCount;
  }
  if (noHitCount > counts.samples || responseValidationFailureCount > counts.samples) {
    throw new ObservabilityError(
      'EVALUATION_COUNT_INVALID',
      'ordinary evaluation counts exceed the sample denominator',
    );
  }
  return Object.freeze({
    kind: 'ordinary',
    datasetId: first.datasetId,
    datasetVersion: first.datasetVersion,
    samples: counts.samples,
    errors: counts.errors,
    limiter: first.limiter,
    metrics: Object.freeze({
      recallAtK: Number((recallWeighted / counts.samples).toFixed(6)),
      topK,
      noHitCount,
      responseValidationFailureCount,
    }),
  });
}

function aggregateSop(records: readonly SopEvaluation[]): SopEvaluation {
  const first = assertEvaluationBase(records);
  const counts = aggregateCounts(records);
  const metrics = {
    matchedCount: 0,
    validPathCount: 0,
    validBranchCount: 0,
    staleReleaseRejectedCount: 0,
    unauthorizedResourceRejectedCount: 0,
  };
  for (const record of records) {
    metrics.matchedCount += record.metrics.matchedCount;
    metrics.validPathCount += record.metrics.validPathCount;
    metrics.validBranchCount += record.metrics.validBranchCount;
    metrics.staleReleaseRejectedCount += record.metrics.staleReleaseRejectedCount;
    metrics.unauthorizedResourceRejectedCount += record.metrics.unauthorizedResourceRejectedCount;
  }
  if (Object.values(metrics).some((count) => count > counts.samples)) {
    throw new ObservabilityError(
      'EVALUATION_COUNT_INVALID',
      'SOP evaluation counts exceed the sample denominator',
    );
  }
  return Object.freeze({
    kind: 'sop',
    datasetId: first.datasetId,
    datasetVersion: first.datasetVersion,
    samples: counts.samples,
    errors: counts.errors,
    limiter: first.limiter,
    metrics: Object.freeze(metrics),
  });
}

export function aggregateEvaluationGroup(
  records: readonly EvaluationRecord[],
  expectedKind: QueryKind,
): EvaluationRecord {
  if (records.some((record) => record.kind !== expectedKind)) {
    throw new ObservabilityError(
      'EVALUATION_KIND_MIXED',
      'ordinary and SOP evaluations must remain in separate datasets',
    );
  }
  if (expectedKind === 'ordinary') {
    return aggregateOrdinary(records as readonly OrdinaryEvaluation[]);
  }
  return aggregateSop(records as readonly SopEvaluation[]);
}

export function aggregateEvaluationPair(
  ordinary: readonly OrdinaryEvaluation[],
  sop: readonly SopEvaluation[],
): EvaluationPair {
  return Object.freeze({
    ordinary: aggregateOrdinary(ordinary),
    sop: aggregateSop(sop),
  });
}
