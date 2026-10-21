import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthorizationFixture, type AuthorizationFixture } from './support/authorization-sources-fixture.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

/** PR-D unit: a grant issuer must already reach every source it hands out. A source outside
 * that set rejects the batch, and an issuer whose own facts have closed cannot issue at all. */
describe.skipIf(!enabled)('a grant issuer is checked against its own source set', () => {
  let fixture: AuthorizationFixture;

  beforeEach(async () => { fixture = await createAuthorizationFixture('grant_issuer_deadline'); }, 120_000);
  afterEach(async () => { await fixture?.close(); }, 60_000);

  it('rejects a grant source outside the issuer set and a stale issuer', async () => {
    expect(await fixture.grantRejection('director', 'signer', 'source-missing')).toBe('SCOPE_DENIED');
    // The same issuer handing out a source it does hold is not a scope denial. It may still
    // fail a later check, which is why this asserts the reason and not success.
    expect(await fixture.grantRejection('director', 'signer', 'source-a')).not.toBe('SCOPE_DENIED');
    // A closed facts window is a different refusal than "you do not reach that source".
    expect(await fixture.grantRejection('stale', 'director', 'source-a')).toBe('ORG_FACTS_UNAVAILABLE');
  });
});
