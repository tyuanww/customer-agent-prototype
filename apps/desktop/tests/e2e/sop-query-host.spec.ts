import { test } from '@playwright/test';
import { runSopQueryProbe, type SopSyntheticProbe } from '../support/sop-query-probe';

/** Uses a caller-owned synthetic host. No response, identity or database mocks. */
test('external synthetic host reaches the shipped SOP window and clipboard', async () => {
  const raw = process.env.CUSTOMER_AGENT_SOP_SYNTHETIC_PROBE;
  test.skip(!raw, 'Requires an explicitly supplied running synthetic host');
  await runSopQueryProbe(JSON.parse(raw!) as SopSyntheticProbe);
});
