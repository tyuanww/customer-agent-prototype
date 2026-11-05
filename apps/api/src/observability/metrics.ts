import type {
  BudgetClass,
  ObservabilityStage,
} from './contracts.generated.js';
import { ObservabilityError } from './errors.js';

export const BUDGET_SURFACES = [
  'ordinary-query',
  'sop-query',
  'dashboard-acceptance',
  'overlay-dispatch',
] as const;
export type BudgetSurface = (typeof BUDGET_SURFACES)[number];

export type Temperature = 'warm' | 'cold';

export type BudgetThresholds = Readonly<Record<BudgetSurface, number>>;

export const DEFAULT_OBSERVABILITY_BUDGETS: BudgetThresholds = Object.freeze({
  'ordinary-query': 500,
  'sop-query': 250,
  'dashboard-acceptance': 300,
  'overlay-dispatch': 50,
});

export type LatencyObservation = Readonly<{
  durationMs: number;
  error: boolean;
}>;

export type LatencyBatch = Readonly<{
  surface: BudgetSurface;
  stage: ObservabilityStage;
  budgetClass: BudgetClass;
  temperature: Temperature;
  limiter: string;
  observations: readonly LatencyObservation[];
}>;

export type LatencySummary = Readonly<{
  surface: BudgetSurface;
  stage: ObservabilityStage;
  budgetClass: BudgetClass;
  temperature: Temperature;
  limiter: string;
  sampleCount: number;
  errorCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}>;

export type BudgetEvaluation = Readonly<{
  surface: BudgetSurface;
  stage: ObservabilityStage;
  budgetClass: BudgetClass;
  temperature: Temperature;
  percentile: 'p95';
  thresholdMs: number;
  observedMs: number;
  sampleCount: number;
  breached: boolean;
}>;

const MAX_LATENCY_SAMPLES = 1_000_000;

function nearestRank(sorted: readonly number[], percentile: number): number {
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index] as number;
}

function assertLimiter(limiter: string): void {
  if (limiter.trim().length < 1 || limiter.length > 64) {
    throw new ObservabilityError(
      'LATENCY_INVALID_LIMITER',
      'latency limiter must be a non-empty string of at most 64 characters',
    );
  }
}

export function summarizeLatency(batch: LatencyBatch): LatencySummary {
  if (batch.observations.length === 0) {
    throw new ObservabilityError('LATENCY_EMPTY', 'latency batch requires at least one sample');
  }
  if (batch.observations.length > MAX_LATENCY_SAMPLES) {
    throw new ObservabilityError('LATENCY_TOO_MANY', 'latency batch exceeds the sample limit');
  }
  assertLimiter(batch.limiter);

  const durations: number[] = [];
  let errorCount = 0;
  for (const observation of batch.observations) {
    if (!Number.isFinite(observation.durationMs) || observation.durationMs < 0) {
      throw new ObservabilityError(
        'LATENCY_INVALID_SAMPLE',
        'latency samples require finite non-negative durations',
      );
    }
    durations.push(observation.durationMs);
    if (observation.error) errorCount += 1;
  }
  durations.sort((left, right) => left - right);

  return Object.freeze({
    surface: batch.surface,
    stage: batch.stage,
    budgetClass: batch.budgetClass,
    temperature: batch.temperature,
    limiter: batch.limiter,
    sampleCount: durations.length,
    errorCount,
    p50Ms: nearestRank(durations, 0.5),
    p95Ms: nearestRank(durations, 0.95),
    p99Ms: nearestRank(durations, 0.99),
  });
}

export function evaluateBudget(
  summary: LatencySummary,
  thresholds: BudgetThresholds = DEFAULT_OBSERVABILITY_BUDGETS,
): BudgetEvaluation {
  const thresholdMs = thresholds[summary.surface];
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    throw new ObservabilityError(
      'BUDGET_INVALID_THRESHOLD',
      'budget thresholds must be finite positive durations',
    );
  }
  return Object.freeze({
    surface: summary.surface,
    stage: summary.stage,
    budgetClass: summary.budgetClass,
    temperature: summary.temperature,
    percentile: 'p95',
    thresholdMs,
    observedMs: summary.p95Ms,
    sampleCount: summary.sampleCount,
    breached: summary.p95Ms > thresholdMs,
  });
}
