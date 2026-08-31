import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SCRIPTS } from '../../src/renderer/data/synthetic-scripts';
import { searchScripts } from '../../src/renderer/features/search/search-service';
import {
  SYNTHETIC_DEVELOPMENT_BASELINE,
  materializeSyntheticDevelopmentQuery,
} from '../fixtures/synthetic-development-baseline';

const BASELINE_NOW = new Date('2026-08-30T12:00:00+08:00');

describe('synthetic development baseline', () => {
  it('freezes exactly 20 positive, 12 safety-negative, and 18 robustness cases', () => {
    expect(SYNTHETIC_DEVELOPMENT_BASELINE).toHaveLength(50);
    expect(new Set(SYNTHETIC_DEVELOPMENT_BASELINE.map((item) => item.id)).size).toBe(50);
    expect(SYNTHETIC_DEVELOPMENT_BASELINE.filter((item) => item.stratum === 'positive')).toHaveLength(20);
    expect(SYNTHETIC_DEVELOPMENT_BASELINE.filter((item) => item.stratum === 'safety_negative')).toHaveLength(12);
    expect(SYNTHETIC_DEVELOPMENT_BASELINE.filter((item) => item.stratum === 'robustness')).toHaveLength(18);
  });

  it('contains only synthetic fixtures and never treats copy as send', () => {
    const serialized = JSON.stringify(SYNTHETIC_DEVELOPMENT_BASELINE);
    expect(serialized).not.toContain('达肤妍');
    expect(serialized).not.toMatch(/真实客户|手机号1\d{10}|订单号/i);
    expect(serialized).not.toMatch(/已发送|已采纳|已解决/);
  });

  it.each(SYNTHETIC_DEVELOPMENT_BASELINE)('$id returns the frozen local-search outcome', (testCase) => {
    const query = materializeSyntheticDevelopmentQuery(testCase);
    const outcome = searchScripts(query, SYNTHETIC_SCRIPTS, BASELINE_NOW);
    expect(outcome.status).toBe(testCase.expectedStatus);

    if (testCase.expectedStatus === 'hit') {
      expect(outcome.status).toBe('hit');
      if (outcome.status === 'hit') {
        expect(outcome.results[0]?.scriptId).toBe(testCase.expectedTopScriptId);
        if (testCase.humanAction === 'manual_review') {
          const fixture = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === testCase.expectedTopScriptId);
          expect(fixture?.riskLevel === 'medium' || fixture?.riskLevel === 'high').toBe(true);
        }
      }
    }

    if (testCase.expectedStatus === 'invalid') {
      expect(outcome).toEqual({ status: 'invalid', reason: testCase.expectedInvalidReason });
    }
  });
});
