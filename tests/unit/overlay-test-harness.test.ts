import { afterEach, describe, expect, it } from 'vitest';
import { isTestHarnessEnabled } from '../../src/main/overlay-test-harness';

const originalDemo = process.env.DEMO_E2E;
const originalArgv = [...process.argv];

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_E2E;
  } else {
    process.env.DEMO_E2E = originalDemo;
  }
  process.argv = [...originalArgv];
});

describe('demo e2e harness flag', () => {
  it('turns on only for DEMO_E2E=1 or --demo-e2e', () => {
    delete process.env.DEMO_E2E;
    process.argv = ['node', 'main.js'];
    expect(isTestHarnessEnabled()).toBe(false);

    process.env.DEMO_E2E = '1';
    expect(isTestHarnessEnabled()).toBe(true);

    delete process.env.DEMO_E2E;
    process.argv = ['node', 'main.js', '--demo-e2e'];
    expect(isTestHarnessEnabled()).toBe(true);
  });
});
