const initial = Object.freeze({
  started: false,
  administration: null,
  revoked: false,
  identityWritten: false,
  passwordWritten: false,
});

function key(state) {
  return [
    state.started ? '1' : '0',
    state.administration ?? '-',
    state.revoked ? '1' : '0',
    state.identityWritten ? '1' : '0',
    state.passwordWritten ? '1' : '0',
  ].join('|');
}

function transition(name, next, violation = null) {
  return { name, next: Object.freeze(next), violation };
}

function actions(mode, state) {
  const result = [];
  if (!state.started) {
    result.push(transition('startRequest', { ...state, started: true }));
  }
  if (state.started && state.administration === null) {
    result.push(transition('checkAdministration', {
      ...state,
      administration: state.revoked ? 'denied' : 'allowed',
    }));
  }
  if (state.started && !state.revoked) {
    result.push(transition('revokeAdministration', { ...state, revoked: true }));
  }

  const mayWriteIdentity = mode !== 'write-before-check'
    ? state.administration === 'allowed'
    : state.administration === null;
  if (mode === 'no-check' && state.started && !state.identityWritten) {
    result.push(transition('writeIdentity',
      { ...state, identityWritten: true },
      state.started && state.administration !== 'allowed' ? 'write_without_admin_check' : null));
  } else if (mode === 'request-time' && state.started && state.administration === 'allowed' && !state.identityWritten) {
    result.push(transition('writeIdentity', { ...state, identityWritten: true }));
  } else if (state.started && mayWriteIdentity && !state.identityWritten) {
    const violation = mode === 'write-before-check'
      ? 'write_before_admin_check'
      : state.revoked ? 'write_identity_after_revoke' : null;
    result.push(transition('writeIdentity', { ...state, identityWritten: true }, violation));
  }

  if (state.identityWritten && !state.passwordWritten) {
    result.push(transition('writePassword',
      { ...state, passwordWritten: true },
      mode === 'strict' && state.revoked ? 'write_password_after_revoke' : null));
  }
  return result;
}

export function exploreSeatRevocation(mode = 'strict') {
  const queue = [{ state: initial, path: [] }];
  const seen = new Set([key(initial)]);
  let states = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    states += 1;
    for (const action of actions(mode, current.state)) {
      const path = [...current.path, action.name];
      if (action.violation !== null) {
        return Object.freeze({
          mode,
          states,
          path: Object.freeze(path),
          violation: action.violation,
          state: action.next,
        });
      }
      const nextKey = key(action.next);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      queue.push({ state: action.next, path });
    }
  }

  return Object.freeze({ mode, states, path: null, violation: null, state: null });
}
