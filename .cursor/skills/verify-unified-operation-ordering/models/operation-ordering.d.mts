export type OperationOrderingMode =
  | 'correct'
  | 'skip-authorization-check'
  | 'ignore-epoch'
  | 'ignore-request-hash'
  | 'skip-recovery-lookup';

export type OperationOrderingResult = Readonly<{
  mode: OperationOrderingMode;
  states: number;
  edges: number;
  reachedStates: readonly string[];
  witnesses: Readonly<{
    acceptedBeforeRevocation: boolean;
    admissionDeniedAfterRevocation: boolean;
    admittedWriteAfterRevocation: boolean;
    unknownRetained: boolean;
    recoveryStayedUnknown: boolean;
    replayReturnedOriginalReceipt: boolean;
  }>;
  path: readonly string[] | null;
  violation: string | null;
  state: Readonly<Record<string, unknown>> | null;
}>;

export const OPERATION_FIXTURES: Readonly<Record<string, unknown>>;
export function exploreOperationOrdering(mode?: OperationOrderingMode): OperationOrderingResult;
