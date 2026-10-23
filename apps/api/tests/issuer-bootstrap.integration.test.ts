import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthorizationFixture, type AuthorizationFixture } from './support/authorization-sources-fixture.js';
import { createGrants } from '../src/content-intake/authority.js';
import { IntakeRejection, principal, type IntakeTransaction } from '../src/content-intake/transaction.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

/**
 * The permission line rests on one chain working: a principal given a root allocation by a
 * controlled bootstrap can hand a business action to somebody else, and loses that power the
 * moment its facts window closes.
 *
 * Two grants are needed and they play different roles, which is easy to get wrong.
 * `authorization_sources` reads only business grants, so the allocation proves the issuer may
 * delegate while the issuer's own business grant decides which sources it may delegate. A
 * principal holding an allocation but no business grant on a source is refused with
 * SCOPE_DENIED, not GRANT_AUTHORITY_DENIED.
 *
 * The allocation is written the way `scripts/ops/bootstrap-issuer-authority.mjs` writes it in
 * production: issuer, recipient and steward all the same principal, no parent.
 */
describe.skipIf(!enabled)('a bootstrapped root allocation makes its holder a real issuer', () => {
  let fixture: AuthorizationFixture;
  let admin: IntakeTransaction;

  beforeEach(async () => {
    fixture = await createAuthorizationFixture('issuer_bootstrap');
    admin = fixture.intakeClient();
    // The shared fixture's allocations carry a NULL steward, which parentAuthority will not
    // accept, and a version guard rejects rewriting them. Insert a root allocation instead.
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
        starts_at, expires_at, reason, steward_id)
      VALUES ('grant-root-bootstrap','allocation','signer','signer','tenant-menokin',
        'app-customer-agent','scope-product',NULL,'query',
        clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 day',
        '根授权：由 bootstrap 写入。','signer')`);
    // What the issuer may delegate, held the way a real operator holds it: somebody else gave
    // it to them. `grants_check2` forbids a business grant whose issuer is its recipient, so
    // this cannot be signed by the issuer no matter how the bootstrap is arranged. The
    // fixture's own grants carry a stale policy version, so they expand to no sources and
    // would not do; the versions are read here instead of hardcoded because the fixture's
    // policy row does not stay at 1.
    await admin.query(`INSERT INTO content_intake.grants(
        grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
        starts_at, expires_at, reason, policy_version, store_set_version, steward_id)
      VALUES ('grant-signer-query-a','business','director','signer','tenant-menokin',
        'app-customer-agent','scope-product','source-a','query',
        clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour',
        '签发人被授予的查询权。',
        (SELECT version FROM content_intake.policy_versions
          WHERE tenant_id='tenant-menokin' AND app_id='app-customer-agent'),
        (SELECT version FROM content_intake.store_set_current
          WHERE tenant_id='tenant-menokin' AND app_id='app-customer-agent'),
        'director')`);
  }, 180_000);
  afterEach(async () => { await fixture?.close(); }, 60_000);

  const grant = async (issuerId: string, recipientId: string) => {
    const client = fixture.intakeClient();
    const issuer = await principal(client, { id: issuerId });
    const recipient = await principal(client, { id: recipientId });
    const policy = await client.query<{ version: string }>(
      'SELECT version::text AS version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2',
      [issuer.tenantId, issuer.appId],
    );
    return createGrants(client, issuer, {
      operationId: `bootstrap-proof-${issuerId}-${recipientId}`,
      issuerFactsVersion: issuer.factsVersion,
      policyVersion: Number(policy.rows[0]?.version),
      items: [{
        kind: 'business',
        recipientPrincipalId: recipient.id,
        recipientFactsVersion: recipient.factsVersion,
        action: 'query',
        scope: {
          tenantId: issuer.tenantId,
          appId: issuer.appId,
          brandId: 'brand-a',
          shopId: null,
          domain: 'product',
          sourceId: 'source-a',
        },
        startsAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        reason: '合成授权：验证根授权持有人可以签发。',
      }],
    });
  };

  it('lets the root allocation holder hand the action to somebody else', async () => {
    // The source set is what makes the delegation legal, so assert it separately from the
    // grant. A batch that fails for any reason would otherwise leave this unobserved.
    const probe = await admin.query<{ source_id: string }>(
      "SELECT source_id FROM content_intake.authorization_sources('signer','query',clock_timestamp())");
    expect(probe.rows.map((item) => item.source_id)).toEqual(['source-a']);
    const result = await grant('signer', 'agent');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'business', action: 'query', recipientPrincipalId: 'agent' });
    expect(result.items[0]?.issuerPrincipalId).toBe('signer');
    // Read the row back by the id the call returned. The fixture already holds a business
    // query grant for the same recipient and source, so a count by shape cannot say which
    // write this was.
    const stored = await admin.query<{ recipient_id: string; issuer_id: string }>(
      `SELECT recipient_id, issuer_id FROM content_intake.grants
        WHERE grant_id = $1 AND revoked_at IS NULL`, [result.items[0]?.grantId]);
    expect(stored.rows).toEqual([{ recipient_id: 'agent', issuer_id: 'signer' }]);
  });

  it('takes the power away again when the issuer facts window closes', async () => {
    // Facts are append-only, so expiry is a new version whose window has already passed. The
    // five minute cap means an expired window is written the same way a live one is.
    await admin.query(`INSERT INTO content_intake.principal_facts(
        principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
      VALUES ('signer',2,ARRAY['dept-a'],'job-director',true,
        statement_timestamp() - interval '10 minutes', statement_timestamp() - interval '5 minutes', repeat('cd',32))`);
    await admin.query("UPDATE content_intake.principals SET current_facts_version = 2 WHERE principal_id = 'signer'");
    await expect(grant('signer', 'agent')).rejects.toBeInstanceOf(IntakeRejection);
  });
});
