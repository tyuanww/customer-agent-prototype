import { describe, expect, it } from 'vitest';
import { INTAKE_FULL_CHECK_LIMIT, intakeQualityTargets } from '../src/content-intake/quality.js';
import { qualityTargets } from '../src/content-normalize.js';

/** The intake policy is its own thing: the legacy CSV chain stays pinned by the
 * `quality_plan_initial_target` CHECK in 0004, so relaxing intake must not move it. */
describe('intake quality sampling', () => {
  it('checks a small catalog in full', () => {
    for (const count of [0, 1, 3, 20, INTAKE_FULL_CHECK_LIMIT]) {
      expect(intakeQualityTargets(count)).toEqual({ initial: count, expanded: count });
    }
  });

  it('bounds the sample for a 266-row SOP workbook instead of demanding every row', () => {
    expect(intakeQualityTargets(266)).toEqual({ initial: 100, expanded: 100 });
  });

  it('never asks the expanded phase for fewer items than the initial phase', () => {
    for (const count of [101, 150, 266, 400, 500, 501, 999, 1000, 5000]) {
      const targets = intakeQualityTargets(count);
      expect(targets.expanded).toBeGreaterThanOrEqual(targets.initial);
      expect(targets.initial).toBeGreaterThanOrEqual(1);
      expect(targets.expanded).toBeLessThanOrEqual(count);
    }
  });

  it('matches the previous behaviour above five hundred rows', () => {
    for (const count of [501, 700, 1000, 3000, 5000]) {
      expect(intakeQualityTargets(count)).toEqual(qualityTargets(count));
    }
  });

  it('leaves the legacy batch policy unchanged', () => {
    // 266 legacy rows must still be fully checked; 0004 CHECKs that value.
    expect(qualityTargets(266)).toEqual({ initial: 266, expanded: 266 });
    expect(qualityTargets(500)).toEqual({ initial: 500, expanded: 500 });
  });
});
