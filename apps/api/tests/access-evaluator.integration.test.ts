import type { Client, PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changeGrant, readGrant } from '../src/content-intake/authority.js';
import { createIntakePurposePool, type IntakePurposePool } from '../src/content-intake/runtime-pool.js';
import { principal, type IntakeTransaction } from '../src/content-intake/transaction.js';
import { createDatabaseAccessEvaluator } from '../src/access/database.js';
import {
  projectAdminAccess,
  projectDashboardSettings,
  projectQueryAccess,
  type AccessEvaluator,
} from '../src/access/evaluator.js';
import {
  createAuthorizationFixture,
  type AuthorizationFixture,
} from './support/authorization-sources-fixture.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

function transaction(client: Client | PoolClient): IntakeTransaction {
  return Object.assign(client, {
    validUntil() {},
    beforeCommit() {},
  }) as IntakeTransaction;
}

describe.skipIf(!enabled)('database AccessEvaluator', () => {
  let fixture: AuthorizationFixture;
  let pool: IntakePurposePool;
  let evaluator: AccessEvaluator;

  beforeEach(async () => {
    fixture = await createAuthorizationFixture('access_evaluator');
    await fixture.admin.query('BEGIN');
    try {
      await fixture.admin.query("CREATE ROLE access_evaluator_business LOGIN NOINHERIT");
      await fixture.admin.query('GRANT intake_business TO access_evaluator_business');
      await fixture.admin.query('COMMIT');
    } catch (error) {
      await fixture.admin.query('ROLLBACK');
      throw error;
    }
    pool = createIntakePurposePool({
      ...fixture.database.config,
      user: 'access_evaluator_business',
      max: 8,
    }, 'business');
    evaluator = createDatabaseAccessEvaluator(pool);
  }, 120_000);

  afterEach(async () => {
    await pool?.end();
    await fixture?.close();
  }, 60_000);

  async function revoke(principalId: string, grantId: string): Promise<void> {
    const client = await pool.connect();
    const tx = transaction(client);
    let failed = false;
    try {
      await client.query('BEGIN');
      const issuer = await principal(tx, { id: principalId });
      const grant = await readGrant(tx, grantId);
      await changeGrant(tx, issuer, grantId, {
        operationId: `revoke-${grantId}`,
        expectedVersion: grant.version,
        change: 'revoke',
        stewardPrincipalId: null,
        reason: '合成撤权',
      });
      await client.query('COMMIT');
    } catch (error) {
      failed = true;
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release(failed);
    }
  }

  it('projects current query, settings, and administrator views from one snapshot', async () => {
    const director = await evaluator.evaluate('user-director');
    expect(director.decision).not.toBeNull();
    expect(projectQueryAccess(director.decision!).scopes.map((entry) =>
      entry.scope.kind === 'source' ? entry.scope.sourceId : entry.scope.kind))
      .toEqual(['source-a', 'source-b']);
    expect(projectDashboardSettings(director.decision!)).toMatchObject({
      grants: 'closed',
      accounts: 'closed',
    });

    const signer = await evaluator.evaluate('user-signer');
    expect(signer.decision).not.toBeNull();
    const settings = projectDashboardSettings(signer.decision!);
    expect(settings).toMatchObject({ grants: 'open', accounts: 'open' });
    const admin = projectAdminAccess(signer.decision!);
    expect(admin.role).toBe('director');
    expect(admin.grants.scopes.length).toBeGreaterThan(0);
    expect(admin.accounts.state).toBe('open');
    expect(JSON.stringify(projectQueryAccess(signer.decision!))).not.toContain('accounts');
    expect((await evaluator.evaluate('user-signer', [])).accessRevision)
      .toBe(signer.accessRevision);
    expect((await evaluator.evaluate('user-signer', ['query'])).accessRevision)
      .toBe(signer.accessRevision);

    const agent = await evaluator.evaluate('user-agent');
    expect(projectQueryAccess(agent.decision!).scopes).toHaveLength(1);
    const noPublish = await evaluator.evaluate('user-agent');
    expect(noPublish.decision?.allowedScopes.some((scope) => scope.actions.includes('publish')))
      .toBe(false);
    expect(noPublish.denyReason).toBeNull();
  });

  it('changes access revision on revocation and denies every concurrent evaluation after it', async () => {
    const before = await evaluator.evaluate('user-director');
    await revoke('signer', 'grant-query-a');
    const after = await evaluator.evaluate('user-director');
    expect(after.accessRevision).not.toBe(before.accessRevision);
    expect(projectQueryAccess(after.decision!).scopes.map((entry) =>
      entry.scope.kind === 'source' ? entry.scope.sourceId : entry.scope.kind))
      .toEqual(['source-b']);

    await revoke('signer', 'grant-query-b');
    const revoked = await fixture.admin.query<{ revoked_at: Date | null }>(
      "SELECT revoked_at FROM content_intake.grants WHERE grant_id IN ('grant-query-a','grant-query-b') ORDER BY grant_id",
    );
    expect(revoked.rows.every((row) => row.revoked_at !== null)).toBe(true);
    const concurrent = await Promise.all(
      Array.from({ length: 20 }, () => evaluator.evaluate('user-director')),
    );
    expect(new Set(concurrent.map((entry) => entry.accessRevision)).size).toBe(1);
    for (const entry of concurrent) {
      expect(projectQueryAccess(entry.decision!, entry.actionReasons.query)).toMatchObject({
        state: 'denied',
        scopes: [],
        denyReason: 'REVOKED_GRANT',
      });
    }
  });

  it('reports an expired grant and advances the access revision without exposing source rows', async () => {
    await fixture.admin.query('BEGIN');
    try {
      await fixture.admin.query(`INSERT INTO backend_identity.subject_bindings(
          binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ('expired-director','synthetic','tenant-menokin','expired-director',
          'user-expired',repeat('11',32),true,'owner')`);
      await fixture.admin.query(`INSERT INTO content_intake.principals(
          principal_id,user_id,tenant_id,app_id,identity_scope,person_key,current_facts_version)
        VALUES ('expired-director','user-expired','tenant-menokin','app-customer-agent',
          'confirmed-synthetic','expired-director',1)`);
      await fixture.admin.query(`INSERT INTO content_intake.principal_facts(
          principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
        VALUES ('expired-director',1,ARRAY['dept-a'],'job-director',true,
          statement_timestamp()-interval '1 second',statement_timestamp()+interval '3 minutes',
          repeat('11',32))`);
      await fixture.admin.query('COMMIT');
    } catch (error) {
      await fixture.admin.query('ROLLBACK');
      throw error;
    }
    const before = await evaluator.evaluate('user-expired', ['query']);
    await fixture.admin.query('BEGIN');
    try {
      await fixture.admin.query(`INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
          starts_at,expires_at,reason,parent_grant_id,policy_version,store_set_version,steward_id)
        VALUES ('grant-query-expired','business','signer','expired-director',
          'tenant-menokin','app-customer-agent','scope-product','source-a','query',
          clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',
          '合成过期查询。','grant-alloc-query',3,1,'signer')`);
      await fixture.admin.query('COMMIT');
    } catch (error) {
      await fixture.admin.query('ROLLBACK');
      throw error;
    }

    const expired = await evaluator.evaluate('user-expired', ['query']);
    expect(expired.accessRevision).not.toBe(before.accessRevision);
    expect(projectQueryAccess(expired.decision!, expired.actionReasons.query)).toMatchObject({
      state: 'denied',
      scopes: [],
      denyReason: 'EXPIRED_GRANT',
    });
    expect(JSON.stringify(projectQueryAccess(expired.decision!, expired.actionReasons.query)))
      .not.toContain('source-a');
  });

  it('distinguishes expired facts, ambiguous roles, and a live query outside the store set', async () => {
    const stale = await evaluator.evaluate('user-stale');
    expect(stale.decision).toBeNull();
    expect(stale.denyReason).toBe('EXPIRED_FACTS');

    await fixture.admin.query('BEGIN');
    try {
      await fixture.admin.query(`INSERT INTO content_intake.role_rules(
          tenant_id,app_id,department_id,job_id,policy_version,role)
        VALUES ('tenant-menokin','app-customer-agent','dept-b','job-agent',1,'lead')`);
      await fixture.admin.query(`INSERT INTO content_intake.principal_facts(
          principal_id,facts_version,department_ids,job_id,enabled,checked_at,valid_until,facts_digest)
        VALUES ('agent',2,ARRAY['dept-a','dept-b'],'job-agent',true,
          statement_timestamp()-interval '1 second',statement_timestamp()+interval '3 minutes',repeat('ef',32))`);
      await fixture.admin.query(`UPDATE content_intake.principals
        SET current_facts_version=2 WHERE principal_id='agent'`);
      await fixture.admin.query('COMMIT');
    } catch (error) {
      await fixture.admin.query('ROLLBACK');
      throw error;
    }
    const ambiguous = await evaluator.evaluate('user-agent');
    expect(ambiguous.decision).toBeNull();
    expect(ambiguous.denyReason).toBe('AMBIGUOUS_ROLE');

    await fixture.admin.query('BEGIN');
    try {
      await fixture.admin.query("SET CONSTRAINTS ALL DEFERRED");
      await fixture.admin.query(`INSERT INTO content_intake.scopes(
          scope_id,tenant_id,app_id,brand_id,domain)
        VALUES ('scope-product-c','tenant-menokin','app-customer-agent','brand-b','product')`);
      await fixture.admin.query(`INSERT INTO content_intake.sources(
          source_id,scope_id,current_mapping_version,mode)
        VALUES ('source-c','scope-product-c',1,'v2-preview')`);
      await fixture.admin.query(`INSERT INTO content_intake.source_mappings(
          source_id,version,template_version,rule_version,mapping_version,structure_digest)
        VALUES ('source-c',1,'faq-p1.1','intake-p1.1','faq-map',repeat('12',32))`);
      await fixture.admin.query(`INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,
          starts_at,expires_at,reason,steward_id)
        VALUES ('grant-alloc-query-c','allocation','signer','signer','tenant-menokin',
          'app-customer-agent','scope-product-c','query',clock_timestamp()-interval '2 minutes',
          clock_timestamp()+interval '2 days','分配集合外查询。','signer')`);
      await fixture.admin.query(`INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
          starts_at,expires_at,reason,parent_grant_id,policy_version,store_set_version,steward_id)
        SELECT 'grant-query-c','business','signer','director','tenant-menokin','app-customer-agent',
          'scope-product-c','source-c','query',clock_timestamp()-interval '1 minute',
          clock_timestamp()+interval '5 minutes','集合外查询。','grant-alloc-query-c',
          policy.version,store.version,'signer'
        FROM content_intake.policy_versions policy
        CROSS JOIN content_intake.store_set_current store
        WHERE policy.tenant_id='tenant-menokin' AND policy.app_id='app-customer-agent'
          AND store.tenant_id='tenant-menokin' AND store.app_id='app-customer-agent'`);
      await fixture.admin.query('COMMIT');
    } catch (error) {
      await fixture.admin.query('ROLLBACK');
      throw error;
    }
    await revoke('signer', 'grant-query-a');
    await revoke('signer', 'grant-query-b');
    const liveSources = await fixture.admin.query<{ source_id: string }>(
      `SELECT source_id FROM content_intake.authorization_sources('director','query',clock_timestamp())
       ORDER BY source_id`,
    );
    expect(liveSources.rows).toEqual([]);
    const outside = await evaluator.evaluate('user-director');
    expect(outside.decision).not.toBeNull();
    expect(projectQueryAccess(outside.decision!, outside.actionReasons.query).denyReason)
      .toBe('SOURCE_OUTSIDE_SET');
  });
});
