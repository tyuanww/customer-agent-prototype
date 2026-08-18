import { describe, expect, it } from 'vitest';
import { queryHandoffGeometry } from '../../src/shared/fox-motion';
import { IDENTITY_FOX_VISUAL_TRANSFORM } from '../../src/shared/overlay-events';
import {
  COPY_FEEDBACK_MS,
  SEARCH_FEEDBACK_MS,
  maxContentBottom,
  queryFoxVisualState,
  queryHandoffCssVars,
  queryShellClassName,
  resultCopyRankFromKey,
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
