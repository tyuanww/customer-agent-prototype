import { describe, expect, it } from 'vitest';
import { evaluateNAcceptance } from '../evaluate.js';

const enabled = process.env.CUSTOMER_AGENT_SEARCH_DECISION_FULL_ACCEPTANCE === '1';

describe.skipIf(!enabled)('N-case full acceptance', () => {
  it('writes n-acceptance.json and exits non-zero when any N case fails', async () => {
    const payload = await evaluateNAcceptance();
    if (payload.failed.length > 0) {
      throw new Error(`n ${payload.failed.length}/${payload.totals.n}: ${payload.failed.join(', ')}`);
    }
    expect(payload.failed).toEqual([]);
  });
});
