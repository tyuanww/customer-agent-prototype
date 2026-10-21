import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthorizationFixture, type AuthorizationFixture } from './support/authorization-sources-fixture.js';
import { previewGrants } from '../src/content-intake/authority.js';
import { IntakeRejection, principal } from '../src/content-intake/transaction.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

/** A grant issuer must already reach every source it hands out. A source outside
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

  it('rejects a missing parent action even when the same source is reachable for another action', async () => {
    // The director holds publish on this scope and no import. Granting the same source under
    // publish passes the source-set check; switching only the action to import empties the
    // issuer's import set, so the same source is now outside it.
    const attempt = async (action: 'publish' | 'import'): Promise<string> => {
      const client = fixture.intakeClient();
      const issuer = await principal(client, { id: 'director' });
      const recipient = await principal(client, { id: 'signer' });
      const policy = await fixture.admin.query<{ version: string }>(
        'SELECT version::text AS version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2',
        [issuer.tenantId, issuer.appId]);
      try {
        await previewGrants(client, issuer, {
          operationId: `grant-${action}-probe`,
          issuerFactsVersion: issuer.factsVersion,
          policyVersion: Number(policy.rows[0]?.version),
          items: [{
            kind: 'business',
            recipientPrincipalId: recipient.id,
            recipientFactsVersion: recipient.factsVersion,
            action,
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
            reason: '合成授权',
          }],
        });
        return 'accepted';
      } catch (error) {
        return error instanceof IntakeRejection ? error.reason : 'error';
      }
    };

    expect(await attempt('publish')).not.toBe('SCOPE_DENIED');
    expect(await attempt('import')).toBe('SCOPE_DENIED');
  });
});

/** The two "leave alone" clauses of PR-D. They are read from source text because the property
 * is about which call does not exist, which no runtime fixture can observe: a login that
 * silently started creating grants would still pass every runtime test above. */
describe('login authority stays on the roster function', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('never calls bootstrapRootAllocation outside its own definition', () => {
    const authority = read('../src/content-intake/authority.ts');
    expect(authority).toContain('export async function bootstrapRootAllocation(');
    // Every other product file must leave it alone. Scanning the list explicitly keeps this
    // honest about its own scope instead of pretending to cover the whole tree.
    for (const file of ['../src/project-roster-login.ts', '../src/auth-routes.ts', '../src/product-auth-routes.ts']) {
      expect(read(file), `${file} must not call bootstrapRootAllocation`).not.toContain('bootstrapRootAllocation');
    }
  });

  it('issues query only, through issue_roster_query with no action argument', () => {
    const login = read('../src/project-roster-login.ts');
    const calls = login.match(/issue_roster_query\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(1);
    // Three positional arguments mean the function has no action parameter, so login cannot
    // ask it for publish, import or rollback even if a caller wanted to.
    expect(calls[0]).toBe('issue_roster_query($1,$2,$3)');
  });

  it('creates no grant and no grant batch from any login route', () => {
    for (const file of ['../src/project-roster-login.ts', '../src/auth-routes.ts', '../src/product-auth-routes.ts']) {
      const source = read(file);
      expect(source, `${file} must not insert grants`).not.toContain('INSERT INTO content_intake.grants');
      expect(source, `${file} must not issue a grant batch`).not.toContain('grantBatch');
      expect(source, `${file} must not call createGrants`).not.toContain('createGrants');
    }
  });
});

/** The plan keeps SOP upload and the policy switches on the session role instead of the new
 * source set. That is a deliberate exception, so it gets a lock: if someone routes them through
 * authorization_sources later, this fails and the plan has to be revisited on purpose. */
describe('SOP upload and policy switches stay on the session role', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

  const segmentOf = (source: string, start: string, end: string): string => {
    const from = source.indexOf(start);
    expect(from, `${start} must exist`).toBeGreaterThanOrEqual(0);
    const to = source.indexOf(end, from + start.length);
    expect(to, `${end} must follow ${start}`).toBeGreaterThan(from);
    return source.slice(from, to);
  };

  it('still refuses an SOP upload from a session that is not a coach or an owner', () => {
    const routes = read('../src/ops-loop-routes.ts');
    // A session role check, not a source-set read: the plan did not move this door.
    const upload = segmentOf(routes, "scope.post('/v1/sop/import'", "}, { bodyLimit:");
    expect(upload).toContain('isCoachOrOwner(actor.role)');
    expect(upload).not.toContain('authorization_sources');
  });

  it('keeps the SOP catalog and the policy switches off the source set', () => {
    const routes = read('../src/ops-loop-routes.ts');
    const catalog = segmentOf(routes, "app.get('/v1/sop/catalog'", "app.register(async (scope)");
    expect(catalog).toContain('isCoachOrOwner(actor.role)');
    // Policy writes are owner-only. Asserting the whole route file keeps this cheap and makes
    // any future source-set read in this file fail loudly.
    expect(routes).not.toContain('authorization_sources');
    expect(read('../src/policy-routes.ts')).not.toContain('authorization_sources');
  });
});
