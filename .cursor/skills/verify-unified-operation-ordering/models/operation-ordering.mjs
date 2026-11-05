import {
  OPERATION_TRANSITIONS,
  classifyOperationReuse,
  parseOperationEnvelope,
  parseOperationStatus,
} from '../../../../packages/unified-contracts/dist/index.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const CREATED_AT = '2026-11-05T08:00:00Z';
const UPDATED_AT = '2026-11-05T08:00:01Z';
const CANCELLATION_DEADLINE = '2026-11-05T08:03:00Z';
const RECOVERY_DEADLINE = '2026-11-05T08:05:00Z';

const envelope = (overrides = {}) => parseOperationEnvelope({
  operationId: 'operation-1',
  actor: { userId: 'user-owner', sessionEpoch: 7 },
  command: 'publish',
  requestHash: HASH_A,
  idempotencyKey: 'idempotency-1',
  expectedVersion: 3,
  accessRevision: 12,
  cancellation: { mode: 'before-commit', deadline: CANCELLATION_DEADLINE },
  createdAt: CREATED_AT,
  recoveryDeadline: RECOVERY_DEADLINE,
  ...overrides,
});

export const OPERATION_FIXTURES = Object.freeze({
  original: envelope(),
  otherActor: envelope({ actor: { userId: 'user-other', sessionEpoch: 7 } }),
  otherCommand: envelope({ command: 'query' }),
  otherRequest: envelope({ requestHash: HASH_B }),
  oldEpoch: envelope({ actor: { userId: 'user-owner', sessionEpoch: 6 } }),
});

const initialState = Object.freeze({
  requestObserved: false,
  authorization: 'none',
  revoked: false,
  accepted: false,
  acceptedBeforeRevocation: false,
  operationState: null,
  effects: 0,
  durable: 'none',
  reported: 'none',
  statusLookup: false,
  recoveryAttempted: false,
  duplicateReplay: false,
  receiptReturned: null,
  mismatchChecks: Object.freeze({
    actor: false,
    command: false,
    requestHash: false,
    sessionEpoch: false,
  }),
});

function stateKey(state) {
  return [
    state.requestObserved ? '1' : '0',
    state.authorization,
    state.revoked ? '1' : '0',
    state.accepted ? '1' : '0',
    state.acceptedBeforeRevocation ? '1' : '0',
    state.operationState ?? '-',
    String(state.effects),
    state.durable,
    state.reported,
    state.statusLookup ? '1' : '0',
    state.recoveryAttempted ? '1' : '0',
    state.duplicateReplay ? '1' : '0',
    state.receiptReturned ?? '-',
    Object.values(state.mismatchChecks).map(value => value ? '1' : '0').join(''),
  ].join('|');
}

function next(name, state, violation = null) {
  return Object.freeze({ name, state: Object.freeze(state), violation });
}

function moveByContract(name, state, target, patch = {}, violation = null) {
  const legal = OPERATION_TRANSITIONS[state.operationState] ?? [];
  if (!legal.includes(target)) {
    throw new Error(`contract rejected ${state.operationState ?? 'initial'} -> ${target}`);
  }
  return next(name, { ...state, ...patch, operationState: target }, violation);
}

function receiptFor(state) {
  if (state.operationState === 'committed') {
    return { kind: 'committed', committedAt: UPDATED_AT, resultRef: 'release-1' };
  }
  if (state.operationState === 'failed') {
    return { kind: 'failed', failedAt: UPDATED_AT, failureCode: 'SYNTHETIC_FAILURE' };
  }
  if (state.operationState === 'cancelled') {
    return { kind: 'cancelled', cancelledAt: UPDATED_AT };
  }
  if (state.operationState === 'expired') {
    return { kind: 'expired', expiredAt: UPDATED_AT };
  }
  return null;
}

function statusFor(state) {
  return {
    operationId: 'operation-1',
    userId: 'user-owner',
    sessionEpoch: 7,
    command: 'publish',
    state: state.operationState,
    updatedAt: UPDATED_AT,
    recoveryDeadline: RECOVERY_DEADLINE,
    receipt: receiptFor(state),
  };
}

function classification(mode, kind) {
  const original = OPERATION_FIXTURES.original;
  if (kind === 'actor') return classifyOperationReuse(original, OPERATION_FIXTURES.otherActor);
  if (kind === 'command') return classifyOperationReuse(original, OPERATION_FIXTURES.otherCommand);
  if (kind === 'requestHash') {
    const actual = classifyOperationReuse(original, OPERATION_FIXTURES.otherRequest);
    return mode === 'ignore-request-hash' ? 'replay' : actual;
  }
  const actual = classifyOperationReuse(original, OPERATION_FIXTURES.oldEpoch);
  return mode === 'ignore-epoch' ? 'replay' : actual;
}

function actions(mode, state) {
  const result = [];
  if (!state.requestObserved) {
    result.push(next('observeRequest', { ...state, requestObserved: true }));
  }
  if (state.requestObserved && state.authorization === 'none') {
    result.push(next('checkAuthorization', {
      ...state,
      authorization: state.revoked ? 'denied' : 'allowed',
    }));
  }
  if (!state.revoked && state.requestObserved) {
    result.push(next('revokeAuthorization', { ...state, revoked: true }));
  }
  if (state.requestObserved && !state.accepted && state.operationState === null) {
    const admitted = state.authorization === 'allowed' && !state.revoked;
    const skippedAuthorization = mode === 'skip-authorization-check';
    const acceptedAfterRevocation = mode === 'accept-after-revocation'
      && state.revoked
      && state.authorization === 'allowed';
    if (admitted || skippedAuthorization || acceptedAfterRevocation) {
      const violation = skippedAuthorization
        ? 'accept_without_authorization'
        : acceptedAfterRevocation ? 'accept_after_revocation' : null;
      result.push(next('acceptCommand', {
        ...state,
        accepted: true,
        acceptedBeforeRevocation: !state.revoked,
        operationState: 'accepted',
      }, violation));
    }
  }
  if (state.operationState === 'accepted') {
    result.push(moveByContract('startRunning', state, 'running'));
    result.push(moveByContract('failAccepted', state, 'failed', {
      durable: 'failed',
      reported: 'failure',
      receiptReturned: 'failed-receipt',
    }));
    result.push(moveByContract('cancelAccepted', state, 'cancelled', {
      durable: 'cancelled',
      reported: 'cancelled',
      receiptReturned: 'cancelled-receipt',
    }));
    result.push(moveByContract('unknownBeforeWrite', state, 'unknown', {
      reported: 'unknown',
    }));
  }
  if (state.operationState === 'running' && state.effects === 0) {
    const admitted = state.authorization === 'allowed';
    if (mode === 'skip-authorization-check' || admitted) {
      result.push(next('writeEffect', {
        ...state,
        effects: 1,
      }, admitted ? null : 'write_without_authorization'));
    }
  }
  if (state.operationState === 'running' && state.effects === 1) {
    result.push(moveByContract('commitKnown', state, 'committed', {
      durable: 'committed',
      reported: 'success',
      receiptReturned: 'original-receipt',
    }));
    result.push(moveByContract('commitUnknownWithReceipt', state, 'unknown', {
      durable: 'committed',
      reported: 'unknown',
    }));
    result.push(moveByContract('commitUnknownAfterEffect', state, 'unknown', {
      durable: 'none',
      reported: 'unknown',
    }));
  }
  if (state.operationState === 'running' && state.effects === 0) {
    result.push(moveByContract('failRunning', state, 'failed', {
      durable: 'failed',
      reported: 'failure',
      receiptReturned: 'failed-receipt',
    }));
    result.push(moveByContract('cancelRunning', state, 'cancelled', {
      durable: 'cancelled',
      reported: 'cancelled',
      receiptReturned: 'cancelled-receipt',
    }));
    result.push(moveByContract('commitUnknownWithoutReceipt', state, 'unknown', {
      durable: 'none',
      reported: 'unknown',
    }));
  }
  if (state.operationState === 'unknown') {
    if (state.durable === 'committed') {
      result.push(moveByContract('readCommittedReceipt', state, 'committed', {
        reported: 'success',
        statusLookup: true,
        receiptReturned: 'original-receipt',
      }));
    } else if (state.durable === 'failed') {
      result.push(moveByContract('readFailedReceipt', state, 'failed', {
        reported: 'failure',
        statusLookup: true,
        receiptReturned: 'failed-receipt',
      }));
    } else {
      result.push(next('readUnknownStatus', { ...state, statusLookup: true }));
      if (state.statusLookup && state.effects === 1) {
        result.push(moveByContract('readDurableReceipt', state, 'committed', {
          durable: 'committed',
          reported: 'success',
          receiptReturned: 'original-receipt',
        }));
      }
    }
    result.push(moveByContract('expireUnknown', state, 'expired', {
      durable: 'expired',
      reported: 'expired',
      receiptReturned: 'expired-receipt',
    }));
    if (!state.recoveryAttempted) {
      const shouldInventSuccess = mode === 'skip-recovery-lookup'
        && state.effects === 1
        && state.durable !== 'committed';
      if (state.durable === 'committed') {
        result.push(moveByContract('recoverUnknown', state, 'committed', {
          recoveryAttempted: true,
          statusLookup: true,
          reported: 'success',
          receiptReturned: 'original-receipt',
        }));
      } else {
        result.push(next('recoverUnknown', {
          ...state,
          recoveryAttempted: true,
          statusLookup: true,
          reported: shouldInventSuccess ? 'success' : 'unknown',
          receiptReturned: shouldInventSuccess ? 'invented-receipt' : null,
        }, shouldInventSuccess ? 'recovery_invented_success' : null));
      }
    }
  }
  for (const duplicateState of ['accepted', 'running', 'unknown']) {
    if (state.operationState === duplicateState && !state.duplicateReplay) {
      result.push(next('duplicateSubmit', { ...state, duplicateReplay: true }));
    }
  }
  if (state.operationState === 'committed' && state.durable === 'committed' && !state.duplicateReplay) {
    const reuse = classifyOperationReuse(OPERATION_FIXTURES.original, OPERATION_FIXTURES.original);
    result.push(next('duplicateSubmit', {
      ...state,
      duplicateReplay: true,
      receiptReturned: reuse === 'replay' ? 'original-receipt' : 'invented-receipt',
    }, reuse === 'replay' ? null : 'duplicate_not_replayed'));
  }
  if (mode === 'duplicate-effect' && state.duplicateReplay
    && state.operationState === 'running' && state.effects === 1) {
    result.push(next('duplicateWriteEffect', {
      ...state,
      effects: 2,
    }, 'duplicate_committed_effect'));
  }
  if (state.operationState !== null) {
    for (const kind of ['actor', 'command', 'requestHash', 'sessionEpoch']) {
      if (state.mismatchChecks[kind]) continue;
      const actual = classification(mode, kind);
      const expected = kind === 'sessionEpoch' ? 'stale-session' : 'conflict';
      result.push(next(`rejectMismatched${kind[0].toUpperCase()}${kind.slice(1)}`, {
        ...state,
        mismatchChecks: { ...state.mismatchChecks, [kind]: true },
      }, actual === expected ? null : `${kind}_mismatch_not_rejected`));
    }
  }
  return result;
}

function invariant(state) {
  if (state.accepted && state.authorization !== 'allowed') return 'accepted_without_authorization';
  if (state.accepted && !state.acceptedBeforeRevocation) return 'accept_after_revocation';
  if (state.effects > 0 && (!state.accepted || state.authorization !== 'allowed')) {
    return 'write_without_authorization';
  }
  if (state.effects > 1) return 'duplicate_committed_effect';
  if (state.operationState === 'unknown'
    && ['success', 'failure', 'cancelled', 'expired'].includes(state.reported)) {
    return 'unresolved_unknown_reported_terminal';
  }
  if (state.recoveryAttempted && state.reported === 'success'
    && state.durable !== 'committed') return 'recovery_invented_success';
  if (state.operationState === 'committed'
    && (state.durable !== 'committed' || state.effects !== 1)) return 'committed_without_effect';
  if (state.duplicateReplay && state.effects > 1) return 'duplicate_committed_effect';
  const duplicateReceipt = Object.freeze({
    committed: 'original-receipt',
    failed: 'failed-receipt',
    cancelled: 'cancelled-receipt',
    expired: 'expired-receipt',
  });
  if (state.duplicateReplay
    && Object.hasOwn(duplicateReceipt, state.operationState)
    && state.receiptReturned !== duplicateReceipt[state.operationState]) {
    return 'duplicate_effect_or_receipt_drift';
  }
  return null;
}

function validateReachableStatus(state) {
  if (state.operationState === null) return;
  parseOperationStatus(statusFor(state));
}

/**
 * Exhaustively visits every finite state reachable by the monotonic operation
 * events. The public transition graph and reuse classifier come from ARC-01;
 * the model owns only event ordering and the invariant checks around them.
 */
export function exploreOperationOrdering(mode = 'correct') {
  const queue = [{ state: initialState, path: [] }];
  const seen = new Set([stateKey(initialState)]);
  const states = new Set();
  const witnesses = {
    acceptedBeforeRevocation: false,
    admissionDeniedAfterRevocation: false,
    admittedWriteAfterRevocation: false,
    unknownRetained: false,
    recoveryStayedUnknown: false,
    replayReturnedOriginalReceipt: false,
    unknownAfterEffectWithoutDurability: false,
    recoveryStayedUnknownAfterEffect: false,
    duplicateAcceptedWithoutEffect: false,
    duplicateRunningWithoutEffect: false,
    duplicateUnknownWithoutEffect: false,
  };
  const witnessPaths = Object.fromEntries(
    Object.keys(witnesses).map(witness => [witness, null]),
  );
  let visited = 0;
  let edges = 0;

  function observeWitness(name, path, condition) {
    if (witnesses[name] || !condition) return;
    witnesses[name] = true;
    witnessPaths[name] = Object.freeze(path);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    visited += 1;
    if (current.state.operationState !== null) states.add(current.state.operationState);
    observeWitness('acceptedBeforeRevocation', current.path,
      current.state.revoked
      && current.state.accepted
      && current.state.acceptedBeforeRevocation
      && current.state.authorization === 'allowed');
    observeWitness('admissionDeniedAfterRevocation', current.path,
      current.state.revoked
      && !current.state.accepted
      && current.state.authorization === 'denied');
    observeWitness('admittedWriteAfterRevocation', current.path,
      current.state.revoked && current.state.effects === 1);
    observeWitness('unknownRetained', current.path,
      current.state.operationState === 'unknown' && current.state.reported === 'unknown');
    observeWitness('recoveryStayedUnknown', current.path,
      current.state.recoveryAttempted && current.state.operationState === 'unknown');
    observeWitness('replayReturnedOriginalReceipt', current.path,
      current.state.duplicateReplay && current.state.receiptReturned === 'original-receipt');
    observeWitness('unknownAfterEffectWithoutDurability', current.path,
      current.state.operationState === 'unknown'
      && current.state.effects === 1
      && current.state.durable === 'none');
    observeWitness('recoveryStayedUnknownAfterEffect', current.path,
      current.state.operationState === 'unknown'
      && current.state.effects === 1
      && current.state.durable === 'none'
      && current.state.recoveryAttempted
      && current.state.reported === 'unknown');
    observeWitness('duplicateAcceptedWithoutEffect', current.path,
      current.state.duplicateReplay
      && current.state.operationState === 'accepted'
      && current.state.effects === 0);
    observeWitness('duplicateRunningWithoutEffect', current.path,
      current.state.duplicateReplay
      && current.state.operationState === 'running'
      && current.state.effects <= 1);
    observeWitness('duplicateUnknownWithoutEffect', current.path,
      current.state.duplicateReplay
      && current.state.operationState === 'unknown'
      && current.state.effects <= 1);
    validateReachableStatus(current.state);
    const broken = invariant(current.state);
    if (broken !== null) {
      return Object.freeze({
        mode,
        states: visited,
        edges,
        reachedStates: Object.freeze([...states].sort()),
        witnesses: Object.freeze(witnesses),
        witnessPaths: Object.freeze(witnessPaths),
        path: Object.freeze(current.path),
        violation: broken,
        state: current.state,
      });
    }

    for (const action of actions(mode, current.state)) {
      edges += 1;
      const path = [...current.path, action.name];
      if (action.violation !== null) {
        return Object.freeze({
          mode,
          states: visited,
          edges,
          reachedStates: Object.freeze([...states].sort()),
          witnesses: Object.freeze(witnesses),
          witnessPaths: Object.freeze(witnessPaths),
          path: Object.freeze(path),
          violation: action.violation,
          state: action.state,
        });
      }
      const key = stateKey(action.state);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ state: action.state, path });
    }
  }

  return Object.freeze({
    mode,
    states: visited,
    edges,
    reachedStates: Object.freeze([...states].sort()),
    witnesses: Object.freeze(witnesses),
    witnessPaths: Object.freeze(witnessPaths),
    path: null,
    violation: null,
    state: null,
  });
}
