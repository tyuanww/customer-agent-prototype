import { describe, expect, it } from 'vitest';
import { DASHBOARD_MANIFEST } from '../../src/renderer/data/dashboard-manifest';
import { SYNTHETIC_SCRIPTS } from '../../src/renderer/data/synthetic-scripts';
import { SYNTHETIC_DEVELOPMENT_BASELINE } from '../fixtures/synthetic-development-baseline';

const FORBIDDEN_REAL_PILOT_IDENTIFIERS = [/menokin/i, /达肤妍/i] as const;

describe('synthetic content boundary', () => {
  it('keeps the frozen development contract and runtime fixtures free of real pilot names', () => {
    const serializedSyntheticContent = JSON.stringify({
      developmentBaseline: SYNTHETIC_DEVELOPMENT_BASELINE,
      dashboardManifest: DASHBOARD_MANIFEST,
      runtimeScripts: SYNTHETIC_SCRIPTS,
    });

    for (const forbiddenIdentifier of FORBIDDEN_REAL_PILOT_IDENTIFIERS) {
      expect(serializedSyntheticContent).not.toMatch(forbiddenIdentifier);
    }
  });
});
