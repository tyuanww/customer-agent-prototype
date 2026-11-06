import {
  parseEvaluationRecord,
  type EvaluationRecord,
  type QueryKind,
} from '@customer-agent/unified-contracts';
import { ObservabilityError } from './errors.js';

type OrdinaryEvaluation = Extract<EvaluationRecord, { kind: 'ordinary' }>;
type SopEvaluation = Extract<EvaluationRecord, { kind: 'sop' }>;

export type EvaluationPair = Readonly<{
  ordinary: OrdinaryEvaluation;
  sop: SopEvaluation;
}>;

const MAX_SAMPLES = 1_000_000;

function canonicalGroup(
  records: readonly EvaluationRecord[],
  expectedKind: QueryKind,
): readonly EvaluationRecord[] {
  return records.map((record, index) => {
    let parsed: EvaluationRecord;
    try {
      parsed = parseEvaluationRecord(record);
    } catch {
      throw new ObservabilityError(
        'EVALUATION_RECORD_INVALID',
        `evaluation record at index ${index} does not match the frozen contract`,
      );
    }
    if (parsed.kind !== expectedKind) {
      throw new ObservabilityError(
        'EVALUATION_KIND_MIXED',
        'ordinary and SOP evaluations must remain in separate datasets',
      );
    }
    return parsed;
  });
}

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

function aggregateOrdinary(records: readonly EvaluationRecord[]): OrdinaryEvaluation {
  const canonical = canonicalGroup(records, 'ordinary') as readonly OrdinaryEvaluation[];
  const first = assertEvaluationBase(canonical) as OrdinaryEvaluation;
  const counts = aggregateCounts(canonical);
  const topK = first.metrics.topK;
  if (canonical.some((record) => record.metrics.topK !== topK)) {
    throw new ObservabilityError(
      'EVALUATION_DATASET_MIXED',
      'ordinary evaluation group requires one topK',
    );
  }
  let recallWeighted = 0;
  let noHitCount = 0;
  let responseValidationFailureCount = 0;
  for (const record of canonical) {
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

function aggregateSop(records: readonly EvaluationRecord[]): SopEvaluation {
  const canonical = canonicalGroup(records, 'sop') as readonly SopEvaluation[];
  const first = assertEvaluationBase(canonical) as SopEvaluation;
  const counts = aggregateCounts(canonical);
  const metrics = {
    matchedCount: 0,
    validPathCount: 0,
    validBranchCount: 0,
    staleReleaseRejectedCount: 0,
    unauthorizedResourceRejectedCount: 0,
  };
  for (const record of canonical) {
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
  return expectedKind === 'ordinary'
    ? aggregateOrdinary(records)
    : aggregateSop(records);
}

export function aggregateEvaluationPair(
  ordinary: readonly EvaluationRecord[],
  sop: readonly EvaluationRecord[],
): EvaluationPair {
  return Object.freeze({
    ordinary: aggregateOrdinary(ordinary),
    sop: aggregateSop(sop),
  });
}
