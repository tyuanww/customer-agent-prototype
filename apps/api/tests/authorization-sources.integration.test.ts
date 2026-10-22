import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrants } from '../src/content-intake/authority.js';
import { principal } from '../src/content-intake/transaction.js';
import { createAuthorizationFixture, type AuthorizationFixture } from './support/authorization-sources-fixture.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

/** PR-B overlay unit: the set function itself, and the one property createGrants owes it.
 * Card-specific behaviour lives in publish-deadline, import-deadline, and
 * grant-issuer-deadline, so each card's unit box reads on its own file. */
describe.skipIf(!enabled)('authorization_sources returns one row per live grant source', () => {
  let fixture: AuthorizationFixture;

  beforeEach(async () => { fixture = await createAuthorizationFixture('authorization_sources'); }, 120_000);
  afterEach(async () => { await fixture?.close(); }, 60_000);

  it('keeps two query grants as two rows with their own deadlines', async () => {
    const rows = await fixture.sources('director', 'query');
    expect(rows.map(row => row.source_id)).toEqual(['source-a', 'source-b']);
    // The whole point of a set function: two grants with different windows stay two rows.
    expect(rows[0]?.valid_until.getTime()).not.toBe(rows[1]?.valid_until.getTime());
    expect(rows.every(row => row.policy_version === '3')).toBe(true);
  });

  it('expands a publish grant with no source across the scope', async () => {
    const rows = await fixture.sources('director', 'publish');
    expect(rows.map(row => row.source_id)).toEqual(['source-a', 'source-b']);
    // A non-query grant carries no policy version, so the row reports null rather than a guess.
    expect(rows.every(row => row.policy_version === null)).toBe(true);
  });

  it('drops an agent publish grant and a stale query grant', async () => {
    // The role ceiling keeps an agent to query, and an expired facts window removes the rest.
    expect(await fixture.sources('agent', 'publish')).toEqual([]);
    expect((await fixture.sources('agent', 'query')).map(row => row.source_id)).toEqual(['source-a']);
    expect(await fixture.sources('stale', 'query')).toEqual([]);
  });

  it('stamps a created query grant so the deadline keeps it live', async () => {
    const client = fixture.intakeClient();
    const issuer = await principal(client, { id: 'director' });
    const recipient = await principal(client, { id: 'signer' });
    const policy = await fixture.admin.query<{ version: string }>(
      'SELECT version::text AS version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2',
      [issuer.tenantId, issuer.appId]);
    await fixture.admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action, starts_at, expires_at, reason, steward_id)
      VALUES ('grant-alloc-director-query','allocation','signer','director',
        'tenant-menokin','app-customer-agent','scope-product','query',
        clock_timestamp()-interval '1 day', clock_timestamp()+interval '1 day', '分配查询。','signer')`);
    const created = await createGrants(client, issuer, {
      operationId: 'grant-created-query',
      issuerFactsVersion: issuer.factsVersion,
      policyVersion: Number(policy.rows[0]?.version),
      items: [{
        kind: 'business',
        recipientPrincipalId: recipient.id,
        recipientFactsVersion: recipient.factsVersion,
        action: 'query',
        scope: {
          tenantId: issuer.tenantId, appId: issuer.appId, brandId: 'brand-a',
          shopId: null, domain: 'product', sourceId: 'source-a',
        },
        startsAt: new Date(Date.now() - 30_000).toISOString(),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        reason: '合成授权',
      }],
    });
    expect(created.items).toHaveLength(1);
    expect(created.items[0]).toMatchObject({ action: 'query', recipientPrincipalId: 'signer' });
    // The insert has to carry the current policy and store set version, or the row stays dead
    // and the person who was just granted query access sees nothing.
    const live = await fixture.sources('signer', 'query');
    expect(live.map(row => row.source_id)).toEqual(['source-a']);
  });
});
