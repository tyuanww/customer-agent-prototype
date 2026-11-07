import type {
  StageOutcome,
  StageRecord,
  TraceIdentity,
} from '@customer-agent/unified-contracts';

export type DesktopStageObservation = Readonly<{
  startedAt: string;
  durationMs: number;
  outcome: StageOutcome;
  errorCode: string | null;
}>;

export type DesktopCopyObservation = DesktopStageObservation & Readonly<{
  trace: TraceIdentity;
}>;

export type DashboardStage = Extract<
  StageRecord['stage'],
  'dashboard-operation' | 'content-parse' | 'content-publish' | 'release-invalidation'
>;

export class DesktopObservabilityInputError extends Error {
  readonly code:
    | 'DESKTOP_INVALID_DURATION'
    | 'DESKTOP_INVALID_OUTCOME'
    | 'DESKTOP_INVALID_START_TIME';

  constructor(
    code: DesktopObservabilityInputError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'DesktopObservabilityInputError';
    this.code = code;
  }
}

function assertObservation(input: DesktopStageObservation): void {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw new DesktopObservabilityInputError(
      'DESKTOP_INVALID_DURATION',
      'stage duration must be finite and non-negative',
    );
  }
  if (input.startedAt.trim().length === 0 || input.startedAt.length > 64) {
    throw new DesktopObservabilityInputError(
      'DESKTOP_INVALID_START_TIME',
      'stage start time must be a bounded non-empty timestamp',
    );
  }
  if (input.outcome === 'succeeded' && input.errorCode !== null) {
    throw new DesktopObservabilityInputError(
      'DESKTOP_INVALID_OUTCOME',
      'successful stages cannot carry an error code',
    );
  }
  if (input.outcome === 'failed' && input.errorCode === null) {
    throw new DesktopObservabilityInputError(
      'DESKTOP_INVALID_OUTCOME',
      'failed stages require a stable error code',
    );
  }
}

function stageRecord(
  stage: StageRecord['stage'],
  trace: TraceIdentity | null,
  observation: DesktopStageObservation,
): StageRecord {
  assertObservation(observation);
  const common = {
    trace,
    stage,
    startedAt: observation.startedAt,
    durationMs: observation.durationMs,
    budgetClass: 'interactive' as const,
    external: false,
  };
  if (observation.outcome === 'succeeded') {
    return Object.freeze({ ...common, outcome: 'succeeded', errorCode: null });
  }
  if (observation.outcome === 'failed') {
    if (observation.errorCode === null) {
      throw new DesktopObservabilityInputError(
        'DESKTOP_INVALID_OUTCOME',
        'failed stages require a stable error code',
      );
    }
    return Object.freeze({
      ...common,
      outcome: 'failed',
      errorCode: observation.errorCode,
    });
  }
  return Object.freeze({
    ...common,
    outcome: observation.outcome,
    errorCode: observation.errorCode,
  });
}

export function observeDesktopCopy(input: DesktopCopyObservation): StageRecord {
  return stageRecord('copy', input.trace, input);
}

export function observeOverlayDispatch(input: DesktopStageObservation): StageRecord {
  return stageRecord('transport', null, input);
}

export function observeDashboardStage(
  stage: DashboardStage,
  input: DesktopStageObservation,
): StageRecord {
  return stageRecord(stage, null, input);
}
