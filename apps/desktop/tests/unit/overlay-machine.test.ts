import { describe, expect, it } from 'vitest';
import {
  OVERLAY_CONTENT_PHASES,
  isOverlayContentPhase,
  isOverlayPhase,
  shouldExpandPanel,
} from '../../src/shared/overlay-machine';

describe('overlay content projection', () => {
  it('recognizes every declared content phase and the parked legacy phase', () => {
    for (const phase of OVERLAY_CONTENT_PHASES) {
      expect(isOverlayContentPhase(phase)).toBe(true);
      expect(isOverlayPhase(phase)).toBe(true);
    }
    expect(isOverlayPhase('FOX_IDLE')).toBe(true);
    expect(isOverlayPhase('opening')).toBe(false);
  });

  it('expands only content-bearing query phases', () => {
    expect(shouldExpandPanel('SEARCH_INPUT')).toBe(false);
    expect(shouldExpandPanel('RESULTS')).toBe(true);
    expect(shouldExpandPanel('EMPTY')).toBe(true);
    expect(shouldExpandPanel('ERROR')).toBe(true);
    expect(shouldExpandPanel('COPIED')).toBe(true);
    expect(shouldExpandPanel('FOX_IDLE')).toBe(false);
  });
});
