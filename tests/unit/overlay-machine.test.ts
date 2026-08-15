import { describe, expect, it } from 'vitest';
import { reduceOverlay, shouldExpandPanel } from '../../src/shared/overlay-machine';

describe('overlay state machine', () => {
  it('opens from the idle fox into the search capsule', () => {
    expect(reduceOverlay('FOX_IDLE', { type: 'OPEN' })).toBe('SEARCH_INPUT');
    expect(reduceOverlay('FOX_IDLE', { type: 'TOGGLE' })).toBe('SEARCH_INPUT');
  });

  it('collapses from any open phase back to the fox', () => {
    for (const phase of ['SEARCH_INPUT', 'RESULTS', 'EMPTY', 'ERROR', 'COPIED'] as const) {
      expect(reduceOverlay(phase, { type: 'DISMISS' })).toBe('FOX_IDLE');
      expect(reduceOverlay(phase, { type: 'TOGGLE' })).toBe('FOX_IDLE');
    }
  });

  it('keeps a blank query in SEARCH_INPUT instead of fabricating results', () => {
    expect(reduceOverlay('SEARCH_INPUT', { type: 'QUERY_BLANK' })).toBe('SEARCH_INPUT');
    expect(shouldExpandPanel('SEARCH_INPUT')).toBe(false);
  });

  it('moves a successful query to RESULTS and a miss to EMPTY', () => {
    expect(reduceOverlay('SEARCH_INPUT', { type: 'QUERY_HIT' })).toBe('RESULTS');
    expect(reduceOverlay('SEARCH_INPUT', { type: 'QUERY_EMPTY' })).toBe('EMPTY');
    expect(reduceOverlay('SEARCH_INPUT', { type: 'QUERY_ERROR' })).toBe('ERROR');
    expect(shouldExpandPanel('RESULTS')).toBe(true);
    expect(shouldExpandPanel('EMPTY')).toBe(true);
  });

  it('only marks COPIED after results, then dismisses to the fox', () => {
    expect(reduceOverlay('RESULTS', { type: 'COPIED' })).toBe('COPIED');
    expect(reduceOverlay('SEARCH_INPUT', { type: 'COPIED' })).toBe('SEARCH_INPUT');
    expect(reduceOverlay('COPIED', { type: 'DISMISS' })).toBe('FOX_IDLE');
    expect(reduceOverlay('COPIED', { type: 'RETRY' })).toBe('RESULTS');
  });

  it('ignores search events while idle', () => {
    expect(reduceOverlay('FOX_IDLE', { type: 'QUERY_HIT' })).toBe('FOX_IDLE');
    expect(reduceOverlay('FOX_IDLE', { type: 'QUERY_EMPTY' })).toBe('FOX_IDLE');
  });
});
