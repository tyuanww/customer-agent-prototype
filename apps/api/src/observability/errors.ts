export const OBSERVABILITY_ERROR_CODES = [
  'TRACE_IDENTITY_REQUIRED',
  'TRACE_RELEASE_REQUIRED',
  'TRACE_STAGE_LIMIT',
  'TRACE_STAGE_DUPLICATE',
  'TRACE_STAGE_OUT_OF_ORDER',
  'TRACE_ALREADY_TERMINAL',
  'TRACE_STAGE_NOT_APPLICABLE',
  'TRACE_STAGE_UNRELATED',
  'LATENCY_EMPTY',
  'LATENCY_INVALID_SAMPLE',
  'LATENCY_TOO_MANY',
  'LATENCY_INVALID_LIMITER',
  'BUDGET_INVALID_THRESHOLD',
  'ALERT_INVALID_OBSERVATION',
  'EVALUATION_EMPTY',
  'EVALUATION_KIND_MIXED',
  'EVALUATION_RECORD_INVALID',
  'EVALUATION_DATASET_MIXED',
  'EVALUATION_LIMITER_MIXED',
  'EVALUATION_COUNT_INVALID',
  'REPORT_COVERAGE_INVALID',
] as const;

export type ObservabilityErrorCode = (typeof OBSERVABILITY_ERROR_CODES)[number];

export class ObservabilityError extends Error {
  readonly code: ObservabilityErrorCode;

  constructor(code: ObservabilityErrorCode, message: string) {
    super(message);
    this.name = 'ObservabilityError';
    this.code = code;
  }
}
