import { describe, expect, it } from 'vitest';
import { queryHandoffGeometry } from '../../src/shared/fox-motion';
import { IDENTITY_FOX_VISUAL_TRANSFORM } from '../../src/shared/overlay-events';
import { PRODUCT_ERRORS } from '../../src/shared/product-session';
import {
  COPY_FEEDBACK_MS,
  SEARCH_FEEDBACK_MS,
  SESSION_NOTICE_TEXT,
  maxContentBottom,
  queryFoxVisualState,
  queryHandoffCssVars,
  queryShellClassName,
  resultCopyRankFromKey,
  sessionNoticeForResult,
} from '../../src/renderer/features/search/query-view';

describe('query view leaves', () => {
  it('keeps the search and copy feedback timings', () => {
    expect(SEARCH_FEEDBACK_MS).toBe(280);
    expect(COPY_FEEDBACK_MS).toBe(900);
  });

  it('maps fox visual state without changing business priority', () => {
    expect(queryFoxVisualState(true, 'SEARCH_INPUT')).toBe('SEARCHING');
    expect(queryFoxVisualState(true, 'RESULTS')).toBe('SEARCHING');
    expect(queryFoxVisualState(false, 'RESULTS')).toBe('RESULTS');
    expect(queryFoxVisualState(false, 'EMPTY')).toBe('EMPTY');
    expect(queryFoxVisualState(false, 'COPIED')).toBe('COPIED');
    expect(queryFoxVisualState(false, 'SEARCH_INPUT')).toBe('IDLE');
    expect(queryFoxVisualState(false, 'ERROR')).toBe('IDLE');
  });

  it('builds the same shell class tokens as the previous inline list', () => {
    expect(queryShellClassName({
      expanded: false,
      parked: true,
      opening: false,
      closing: false,
      layoutReady: true,
    })).toBe('query-shell is-parked');
    expect(queryShellClassName({
      expanded: true,
      parked: false,
      opening: true,
      closing: false,
      layoutReady: false,
    })).toBe('query-shell is-expanded is-opening is-awaiting-layout');
  });

  it('preserves handoff CSS custom property names and fox translate math', () => {
    const geometry = queryHandoffGeometry(600, 88, 'left', 'none', { x: 44, y: 44 });
    const vars = queryHandoffCssVars({
      geometry,
      foxTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
      anchor: 'left',
    }) as Record<string, string | number>;
    expect(vars['--query-open-duration']).toBe('260ms');
    expect(vars['--query-close-duration']).toBe('200ms');
    expect(vars['--query-content-exit-duration']).toBe('110ms');
    expect(vars['--query-handoff-fox-a']).toBe(1);
    expect(vars['--query-handoff-fox-f']).toBe(0);
    expect(vars['--query-handoff-fox-translate-x']).toBe(
      `${geometry.clipLeft + 32 - 44}px`,
    );
    const right = queryHandoffCssVars({
      geometry,
      foxTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
      anchor: 'right',
    }) as Record<string, string | number>;
    expect(right['--query-handoff-fox-translate-x']).toBe(
      `${geometry.clipLeft + 32 - (600 - 44)}px`,
    );
  });

  it('accepts only digit ranks 1-3 from regular and numpad keys', () => {
    expect(resultCopyRankFromKey('Digit1', '1')).toBe(1);
    expect(resultCopyRankFromKey('Numpad2', '2')).toBe(2);
    expect(resultCopyRankFromKey('Digit3', '3')).toBe(3);
    expect(resultCopyRankFromKey('Digit4', '4')).toBeNull();
    expect(resultCopyRankFromKey('KeyA', 'a')).toBeNull();
  });

  it('takes the lowest content bottom from measured nodes', () => {
    expect(maxContentBottom([
      { getBoundingClientRect: () => ({ bottom: 120 }) },
      null,
      { getBoundingClientRect: () => ({ bottom: 188 }) },
    ])).toBe(188);
    expect(maxContentBottom([null, undefined])).toBe(0);
  });
});

describe('session notice projection', () => {
  const unsigned = {
    ok: true as const,
    enabled: true,
    signedIn: false,
    sessionEpoch: 1,
    userId: null,
    role: null,
    authMode: null,
    expiresAt: null,
  };
  const signedIn = {
    ...unsigned,
    signedIn: true,
    sessionEpoch: 4,
    userId: 'usr_synthetic_agent',
    role: 'agent' as const,
    authMode: 'mock' as const,
    expiresAt: '2026-09-10T12:00:00.000Z',
  };

  it('keeps restored signed-in sessions free of residual banners', () => {
    expect(sessionNoticeForResult({
      value: signedIn,
      source: 'status',
      wasSignedIn: false,
      previous: null,
    })).toBeNull();
  });

  it('shows success only for an explicit login, not for later status polls', () => {
    const success = sessionNoticeForResult({
      value: signedIn,
      source: 'login',
      wasSignedIn: false,
      previous: { kind: 'unsigned', text: SESSION_NOTICE_TEXT.unsigned },
    });
    expect(success).toEqual({ kind: 'success', text: SESSION_NOTICE_TEXT.success });
    expect(sessionNoticeForResult({
      value: signedIn,
      source: 'status',
      wasSignedIn: true,
      previous: success,
    })).toEqual(success);
  });

  it('keeps unsigned and logout wording distinct from expiry and failure', () => {
    expect(sessionNoticeForResult({
      value: unsigned,
      source: 'status',
      wasSignedIn: false,
      previous: null,
    })).toEqual({ kind: 'unsigned', text: SESSION_NOTICE_TEXT.unsigned });
    expect(sessionNoticeForResult({
      value: { ...unsigned, sessionEpoch: 5 },
      source: 'logout',
      wasSignedIn: true,
      previous: { kind: 'success', text: SESSION_NOTICE_TEXT.success },
    })).toEqual({ kind: 'unsigned', text: SESSION_NOTICE_TEXT.loggedOut });
    expect(sessionNoticeForResult({
      value: { ...unsigned, sessionEpoch: 6 },
      source: 'status',
      wasSignedIn: true,
      previous: { kind: 'success', text: SESSION_NOTICE_TEXT.success },
    })).toEqual({ kind: 'expired', text: SESSION_NOTICE_TEXT.expired });
  });

  it('maps login failure, restore unauthorized, and other status failures separately', () => {
    expect(sessionNoticeForResult({
      value: { ok: false, sessionEpoch: 2, code: 'UNAVAILABLE', message: PRODUCT_ERRORS.UNAVAILABLE },
      source: 'login',
      wasSignedIn: false,
      previous: { kind: 'unsigned', text: SESSION_NOTICE_TEXT.unsigned },
    })).toEqual({ kind: 'failed', text: PRODUCT_ERRORS.UNAVAILABLE });
    expect(sessionNoticeForResult({
      value: { ok: false, sessionEpoch: 1, code: 'UNAUTHORIZED', message: PRODUCT_ERRORS.UNAUTHORIZED },
      source: 'status',
      wasSignedIn: false,
      previous: null,
    })).toEqual({ kind: 'expired', text: SESSION_NOTICE_TEXT.expired });
    expect(sessionNoticeForResult({
      value: { ok: false, sessionEpoch: 3, code: 'UNAVAILABLE', message: PRODUCT_ERRORS.UNAVAILABLE },
      source: 'status',
      wasSignedIn: false,
      previous: null,
    })).toEqual({ kind: 'failed', text: PRODUCT_ERRORS.UNAVAILABLE });
  });
});
