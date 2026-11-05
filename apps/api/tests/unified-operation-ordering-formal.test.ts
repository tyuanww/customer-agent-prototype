import { describe, expect, it } from 'vitest';
import {
  exploreOperationOrdering,
  type OperationOrderingMode,
} from '../../../.cursor/skills/verify-unified-operation-ordering/models/operation-ordering.mjs';

const CONTROLS: ReadonlyArray<readonly [OperationOrderingMode, string]> = [
  ['skip-authorization-check', 'accept_without_authorization'],
  ['ignore-epoch', 'sessionEpoch_mismatch_not_rejected'],
  ['ignore-request-hash', 'requestHash_mismatch_not_rejected'],
  ['skip-recovery-lookup', 'recovery_invented_success'],
];

describe('formal unified operation ordering', () => {
  it('exhausts authorization, revocation, retry, unknown commit, recovery, and terminal ordering', () => {
    const result = exploreOperationOrdering();
    expect(result.violation, result.path?.join(' -> ')).toBeNull();
    expect(result.reachedStates).toEqual([
      'accepted',
      'cancelled',
      'committed',
      'expired',
      'failed',
      'running',
      'unknown',
    ]);
    expect(result.witnesses).toEqual({
      acceptedBeforeRevocation: true,
      admissionDeniedAfterRevocation: true,
      admittedWriteAfterRevocation: true,
      unknownRetained: true,
      recoveryStayedUnknown: true,
      replayReturnedOriginalReceipt: true,
    });
    expect(result.states).toBeGreaterThan(0);
    expect(result.edges).toBeGreaterThan(result.states);
  });

  it.each(CONTROLS)('detects the deliberately broken %s control', (mode, expected) => {
    const result = exploreOperationOrdering(mode);
    expect(result.violation, result.path?.join(' -> ')).toBe(expected);
    expect(result.path).not.toBeNull();
  });
});
