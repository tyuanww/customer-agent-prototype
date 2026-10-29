import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations, applyMigrationPrefix } from '../src/index.js';
import { Pg15Harness } from '../src/testkit/index.js';

const enabled = process.env.CUSTOMER_AGENT_DB_PG15_INTEGRATION === '1';

const TENANT = 'tenant-lifecycle';
const APP = 'app-lifecycle';
const BRAND = 'brand-lifecycle';
const SCOPE = 'scope-lifecycle';
const OTHER_SCOPE = 'scope-lifecycle-other';
const SOURCE = 'source-lifecycle';
const SIBLING = 'source-lifecycle-sibling';
const OTHER_SOURCE = 'source-lifecycle-other';
const MAPPING_VERSION = 1;
const SOURCE_DIGEST = '4e042c857f9bb13d37496c5e1aad0d8cd3ca5f614bacf657e49f755555295024';
const ACTIONS = [
  'query',
  'content-manage',
  'import',
  'source-confirm',
  'review',
  'publish',
  'candidate-cancel',
  'rollback',
] as const;
type Action = (typeof ACTIONS)[number];

type PrincipalSpec = Readonly<{
  id: string;
  role: 'director' | 'manager' | 'supervisor' | 'lead' | 'engineer' | 'agent' | 'enabler';
  enabled?: boolean;
  checkedOffsetMs?: number;
  validOffsetMs?: number;
  identityScope?: string;
  personKey?: string;
}>;

type World = Readonly<{
  at: Date;
  policyVersion: string;
  storeSetVersion: string;
}>;

type Decision = Readonly<{
  deadline: string | null;
  sources: string | null;
}>;

type GrantSpec = Readonly<{
  id: string;
  kind: 'business' | 'allocation' | 'delegation';
  issuerId: string;
  recipientId: string;
  scopeId?: string;
  sourceId?: string | null;
  action: Action;
  startsAt: Date;
  expiresAt: Date;
  parentGrantId?: string | null;
  stewardId?: string | null;
  policyVersion?: string | null;
  storeSetVersion?: string | null;
}>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function rosterSignerId(): string {
  return (`sys_query_${sha256(`${TENANT}:${APP}`)}`).slice(0, 72);
}

async function constrainedTransaction(client: Client, work: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  try {
    await work();
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function insertPrincipal(client: Client, at: Date, principal: PrincipalSpec): Promise<void> {
  await client.query(
    `INSERT INTO backend_identity.subject_bindings(
       binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
     VALUES ($1, 'synthetic', $2, $3, $4, $5, true, 'owner')`,
    [`binding-${principal.id}`, TENANT, principal.id, `user-${principal.id}`, sha256(principal.id)],
  );
  await client.query(
    `INSERT INTO content_intake.principals(
       principal_id, user_id, tenant_id, app_id, identity_scope, person_key,
       current_facts_version, revocation_generation)
     VALUES ($1, $2, $3, $4, $5, $6, 1, 0)`,
    [
      principal.id,
      `user-${principal.id}`,
      TENANT,
      APP,
      principal.identityScope ?? 'confirmed-synthetic',
      principal.personKey ?? principal.id,
    ],
  );
  await client.query(
    `INSERT INTO content_intake.principal_facts(
       principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
     VALUES ($1, 1, ARRAY[$2]::text[], $3, $4, $5, $6, $7)`,
    [
      principal.id,
      `department-${principal.id}`,
      `job-${principal.id}`,
      principal.enabled ?? true,
      new Date(at.getTime() + (principal.checkedOffsetMs ?? -1_000)),
      new Date(at.getTime() + (principal.validOffsetMs ?? 240_000)),
      sha256(`facts-${principal.id}`),
    ],
  );
  await client.query(
    `INSERT INTO content_intake.role_rules(
       tenant_id, app_id, department_id, job_id, policy_version, role)
     VALUES ($1, $2, $3, $4, 1, $5)`,
    [TENANT, APP, `department-${principal.id}`, `job-${principal.id}`, principal.role],
  );
}

async function seedWorld(client: Client, principals: readonly PrincipalSpec[]): Promise<World> {
  let world: World | undefined;
  await constrainedTransaction(client, async () => {
    const now = await client.query<{ at: Date }>('SELECT clock_timestamp() AS at');
    const at = new Date(now.rows[0]!.at.toISOString());
    await client.query(
      `INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id, brand_id, shop_id, domain)
       VALUES
         ($1, $3, $4, $5, NULL, 'product'),
         ($2, $3, $4, $5, NULL, 'campaign')`,
      [SCOPE, OTHER_SCOPE, TENANT, APP, BRAND],
    );
    await client.query(
      `INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
       VALUES
         ($1, $4, $6, 'legacy'),
         ($2, $4, $6, 'legacy'),
         ($3, $5, $6, 'legacy')`,
      [SOURCE, SIBLING, OTHER_SOURCE, SCOPE, OTHER_SCOPE, MAPPING_VERSION],
    );
    for (const sourceId of [SOURCE, SIBLING, OTHER_SOURCE]) {
      await client.query(
        `INSERT INTO content_intake.source_mappings(
           source_id, version, template_version, rule_version, mapping_version, structure_digest)
         VALUES ($1, $2, 'faq-p1.1', 'intake-p1.1', 'not-imported', $3)`,
        [sourceId, MAPPING_VERSION, SOURCE_DIGEST],
      );
    }
    await client.query(
      `INSERT INTO content_intake.policy_versions(tenant_id, app_id, version)
       VALUES ($1, $2, 1)`,
      [TENANT, APP],
    );
    await client.query(
      `INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
       VALUES ($1, $2, 1, $3, 'synthetic')`,
      [TENANT, APP, at],
    );
    await client.query(
      `INSERT INTO content_intake.store_set_current(tenant_id, app_id, version)
       VALUES ($1, $2, 1)`,
      [TENANT, APP],
    );
    await client.query(
      `INSERT INTO content_intake.store_set_members(
         tenant_id, app_id, version, scope_id, source_id, content_valid_until)
       VALUES
         ($1, $2, 1, $3, $4, $5::timestamptz + interval '1 hour'),
         ($1, $2, 1, $3, $6, $5::timestamptz + interval '1 hour'),
         ($1, $2, 1, $7, $8, $5::timestamptz + interval '1 hour')`,
      [TENANT, APP, SCOPE, SOURCE, at, SIBLING, OTHER_SCOPE, OTHER_SOURCE],
    );
    for (const principal of principals) await insertPrincipal(client, at, principal);
    const policy = await client.query<{ version: string }>(
      `SELECT version::text AS version
       FROM content_intake.policy_versions
       WHERE tenant_id = $1 AND app_id = $2`,
      [TENANT, APP],
    );
    world = {
      at,
      policyVersion: policy.rows[0]!.version,
      storeSetVersion: String(MAPPING_VERSION),
    };
  });
  if (!world) throw new Error('synthetic authorization world was not created');
  return world;
}

async function insertGrant(client: Client, grant: GrantSpec): Promise<void> {
  await client.query(
    `INSERT INTO content_intake.grants(
       grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id,
       action, starts_at, expires_at, reason, steward_id, parent_grant_id,
       policy_version, store_set_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      grant.id,
      grant.kind,
      grant.issuerId,
      grant.recipientId,
      TENANT,
      APP,
      grant.scopeId ?? SCOPE,
      grant.sourceId ?? null,
      grant.action,
      grant.startsAt,
      grant.expiresAt,
      `synthetic ${grant.kind} ${grant.id}`,
      grant.stewardId ?? null,
      grant.parentGrantId ?? null,
      grant.policyVersion ?? null,
      grant.storeSetVersion ?? null,
    ],
  );
}

async function revokeGrant(client: Client, grantId: string, at: Date): Promise<void> {
  await client.query(
    `UPDATE content_intake.grants
     SET revoked_at = $2, version = version + 1, last_change_reason = 'synthetic revocation'
     WHERE grant_id = $1`,
    [grantId, at],
  );
}

async function clearSteward(client: Client, grantId: string): Promise<void> {
  await client.query(
    `UPDATE content_intake.grants
     SET steward_id = NULL, version = version + 1, last_change_reason = 'synthetic steward clear'
     WHERE grant_id = $1`,
    [grantId],
  );
}

async function chainIds(
  client: Client,
  world: World,
  prefix: string,
  ids: Readonly<{ allocator: string; delegator: string; issuer: string; reader: string }>,
  withDelegation: boolean,
): Promise<Readonly<{ allocationId: string; delegationId: string | null; businessId: string }>> {
  const allocationId = `${prefix}-allocation`;
  await insertGrant(client, {
    id: allocationId,
    kind: 'allocation',
    issuerId: ids.allocator,
    recipientId: ids.delegator,
    sourceId: SOURCE,
    action: 'query',
    startsAt: new Date(world.at.getTime() - 60_000),
    expiresAt: new Date(world.at.getTime() + 210_000),
    stewardId: ids.allocator,
  });
  let parentGrantId = allocationId;
  let delegationId: string | null = null;
  if (withDelegation) {
    delegationId = `${prefix}-delegation`;
    await insertGrant(client, {
      id: delegationId,
      kind: 'delegation',
      issuerId: ids.delegator,
      recipientId: ids.issuer,
      sourceId: SOURCE,
      action: 'query',
      startsAt: new Date(world.at.getTime() - 45_000),
      expiresAt: new Date(world.at.getTime() + 190_000),
      parentGrantId: allocationId,
      stewardId: ids.delegator,
    });
    parentGrantId = delegationId;
  }
  const businessId = `${prefix}-business`;
  await insertGrant(client, {
    id: businessId,
    kind: 'business',
    issuerId: ids.issuer,
    recipientId: ids.reader,
    sourceId: SOURCE,
    action: 'query',
    startsAt: new Date(world.at.getTime() - 30_000),
    expiresAt: new Date(world.at.getTime() + 170_000),
    parentGrantId,
    stewardId: ids.issuer,
    policyVersion: world.policyVersion,
    storeSetVersion: world.storeSetVersion,
  });
  return { allocationId, delegationId, businessId };
}

async function insertDirectQueryGrant(
  client: Client,
  world: World,
  id: string,
  signerId: string,
  readerId: string,
  sourceId = SOURCE,
): Promise<void> {
  await insertGrant(client, {
    id,
    kind: 'business',
    issuerId: signerId,
    recipientId: readerId,
    sourceId,
    action: 'query',
    startsAt: new Date(world.at.getTime() - 30_000),
    expiresAt: new Date(world.at.getTime() + 120_000),
    policyVersion: world.policyVersion,
    storeSetVersion: world.storeSetVersion,
  });
}

async function decision(
  client: Client,
  principalId: string,
  action: Action,
  sourceId: string | null,
  at: Date,
  scopeId = SCOPE,
): Promise<Decision> {
  const deadline = await client.query<{ until: Date | null }>(
    `SELECT content_intake.authorization_deadline($1, $2, $3, $4, $5) AS until`,
    [principalId, action, scopeId, sourceId, at],
  );
  const sources = await client.query<{ valid_until: Date | null }>(
    `SELECT max(valid_until) AS valid_until
     FROM content_intake.authorization_sources($1, $2, $3)
     WHERE scope_id = $4 AND source_id = $5`,
    [principalId, action, at, scopeId, sourceId],
  );
  return {
    deadline: deadline.rows[0]?.until?.toISOString() ?? null,
    sources: sources.rows[0]?.valid_until?.toISOString() ?? null,
  };
}

async function expectRejected(
  client: Client,
  principalId: string,
  action: Action,
  sourceId: string | null,
  at: Date,
  scopeId = SCOPE,
): Promise<void> {
  await expect(decision(client, principalId, action, sourceId, at, scopeId)).resolves.toEqual({
    deadline: null,
    sources: null,
  });
}

async function expectSourcePresent(
  client: Client,
  principalId: string,
  action: Action,
  sourceId: string,
  at: Date,
): Promise<void> {
  const result = await decision(client, principalId, action, sourceId, at);
  expect(result.deadline).not.toBeNull();
  expect(result.sources).toBe(result.deadline);
}

async function expectRoleCanRead(
  client: Client,
  role: 'intake_usage' | 'intake_business' | 'intake_runtime_fn_owner' | 'intake_directory_fn_owner',
  principalId: string,
  at: Date,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    const deadline = await client.query<{ until: Date | null }>(
      `SELECT content_intake.authorization_deadline($1, 'query', $2, $3, $4) AS until`,
      [principalId, SCOPE, SOURCE, at],
    );
    const sources = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM content_intake.authorization_sources($1, 'query', $2)
       WHERE scope_id = $3 AND source_id = $4`,
      [principalId, at, SCOPE, SOURCE],
    );
    expect(deadline.rows[0]?.until).not.toBeNull();
    expect(sources.rows[0]?.count).toBe('1');
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

describe.skipIf(!enabled).sequential('authorization lifecycle on PostgreSQL 15', () => {
  let harness: Pg15Harness;

  beforeEach(() => {
    harness = new Pg15Harness();
    harness.start();
  }, 60_000);

  afterEach(() => harness.stop(), 60_000);

  async function migratedClient(label: string): Promise<Client> {
    const client = await harness.connect(harness.createDatabase(label).config);
    await applyDatabaseMigrations(client);
    return client;
  }

  it('checks every ancestor before a parented business grant authorizes', async () => {
    const client = await migratedClient('lifecycle_grandparent');
    try {
      const world = await seedWorld(client, [
        { id: 'chain-allocator', role: 'director' },
        { id: 'chain-delegator', role: 'manager' },
        { id: 'chain-issuer', role: 'engineer' },
        { id: 'chain-reader', role: 'agent' },
      ]);
      const chain = await chainIds(client, world, 'grandparent', {
        allocator: 'chain-allocator',
        delegator: 'chain-delegator',
        issuer: 'chain-issuer',
        reader: 'chain-reader',
      }, true);
      await expectSourcePresent(client, 'chain-reader', 'query', SOURCE, world.at);

      await constrainedTransaction(client, async () => {
        await revokeGrant(client, chain.allocationId, new Date(world.at.getTime() - 1_000));
      });
      await expectRejected(client, 'chain-reader', 'query', SOURCE, world.at);
    } finally {
      await client.end();
    }
  }, 180_000);

  it('rejects a revoked direct parent and a cleared required steward', async () => {
    const client = await migratedClient('lifecycle_parent_steward');
    try {
      const world = await seedWorld(client, [
        { id: 'parent-allocator', role: 'director' },
        { id: 'parent-issuer', role: 'engineer' },
        { id: 'parent-delegator', role: 'manager' },
        { id: 'parent-chain-issuer', role: 'engineer' },
        { id: 'parent-reader', role: 'agent' },
      ]);
      const parented = await chainIds(client, world, 'direct-parent', {
        allocator: 'parent-allocator',
        delegator: 'parent-issuer',
        issuer: 'parent-issuer',
        reader: 'parent-reader',
      }, false);
      await expectSourcePresent(client, 'parent-reader', 'query', SOURCE, world.at);
      await constrainedTransaction(client, async () => {
        await revokeGrant(client, parented.allocationId, new Date(world.at.getTime() - 1_000));
      });
      await expectRejected(client, 'parent-reader', 'query', SOURCE, world.at);

      const stewardGrant = await chainIds(client, world, 'steward-parent', {
        allocator: 'parent-allocator',
        delegator: 'parent-delegator',
        issuer: 'parent-chain-issuer',
        reader: 'parent-reader',
      }, true);
      await expectSourcePresent(client, 'parent-reader', 'query', SOURCE, world.at);
      await constrainedTransaction(client, async () => {
        await clearSteward(client, stewardGrant.businessId);
      });
      await expectRejected(client, 'parent-reader', 'query', SOURCE, world.at);

      await expect(
        client.query(
          `UPDATE content_intake.grants
           SET steward_id = $2, version = version + 1, last_change_reason = 'synthetic restore'
           WHERE grant_id = $1`,
          [stewardGrant.businessId, 'parent-issuer'],
        ),
      ).rejects.toMatchObject({ code: 'ZA003', message: 'GRANT_STEWARD_RESTORE_FORBIDDEN' });
    } finally {
      await client.end();
    }
  }, 180_000);

  it('uses the role ceiling for engineer and both query-only roles', async () => {
    const client = await migratedClient('lifecycle_roles');
    try {
      const world = await seedWorld(client, [
        { id: 'role-issuer', role: 'director' },
        { id: 'role-engineer', role: 'engineer' },
        { id: 'role-agent', role: 'agent' },
        { id: 'role-enabler', role: 'enabler' },
      ]);
      await constrainedTransaction(client, async () => {
        for (const action of ACTIONS) {
          const allocationParent = `role-${action}-allocation`;
          await insertGrant(client, {
            id: allocationParent,
            kind: 'allocation',
            issuerId: 'role-issuer',
            recipientId: 'role-issuer',
            sourceId: SOURCE,
            action,
            startsAt: new Date(world.at.getTime() - 60_000),
            expiresAt: new Date(world.at.getTime() + 180_000),
            stewardId: 'role-issuer',
          });
          await insertGrant(client, {
            id: `role-${action}-engineer`,
            kind: 'business',
            issuerId: 'role-issuer',
            recipientId: 'role-engineer',
            sourceId: SOURCE,
            action,
            startsAt: new Date(world.at.getTime() - 30_000),
            expiresAt: new Date(world.at.getTime() + 120_000),
            parentGrantId: allocationParent,
            stewardId: 'role-issuer',
            policyVersion: action === 'query' ? world.policyVersion : null,
            storeSetVersion: action === 'query' ? world.storeSetVersion : null,
          });
          for (const role of ['agent', 'enabler'] as const) {
            await insertGrant(client, {
              id: `role-${action}-${role}`,
              kind: 'business',
              issuerId: 'role-issuer',
              recipientId: `role-${role}`,
              sourceId: SOURCE,
              action,
              startsAt: new Date(world.at.getTime() - 30_000),
              expiresAt: new Date(world.at.getTime() + 120_000),
              parentGrantId: allocationParent,
              stewardId: 'role-issuer',
              policyVersion: action === 'query' ? world.policyVersion : null,
              storeSetVersion: action === 'query' ? world.storeSetVersion : null,
            });
          }
        }
      });

      for (const action of ACTIONS) {
        await expectSourcePresent(client, 'role-engineer', action, SOURCE, world.at);
        for (const role of ['agent', 'enabler'] as const) {
          if (action === 'query') {
            await expectSourcePresent(client, `role-${role}`, action, SOURCE, world.at);
          } else {
            await expectRejected(client, `role-${role}`, action, SOURCE, world.at);
          }
        }
      }
      const ceilings = await client.query<{
        query: boolean; import: boolean; publish: boolean; agent_publish: boolean;
      }>(`
        SELECT
          'query' = ANY(business_actions) AS query,
          'import' = ANY(business_actions) AS import,
          'publish' = ANY(business_actions) AS publish,
          (SELECT 'publish' = ANY(business_actions)
             FROM content_intake.role_ceiling WHERE role = 'agent') AS agent_publish
        FROM content_intake.role_ceiling
        WHERE role = 'engineer'`);
      expect(ceilings.rows).toEqual([{ query: true, import: true, publish: true, agent_publish: false }]);
    } finally {
      await client.end();
    }
  }, 180_000);

  it('rejects disabled and expired current facts', async () => {
    const client = await migratedClient('lifecycle_facts');
    try {
      const signer = rosterSignerId();
      const world = await seedWorld(client, [
        { id: signer, role: 'director', identityScope: 'content-intake-system', personKey: 'query-signer' },
        { id: 'facts-disabled', role: 'agent' },
        {
          id: 'facts-expired',
          role: 'agent',
          checkedOffsetMs: -120_000,
          validOffsetMs: -1,
        },
      ]);
      await constrainedTransaction(client, async () => {
        await insertDirectQueryGrant(client, world, 'facts-disabled-grant', signer, 'facts-disabled');
        await insertDirectQueryGrant(client, world, 'facts-expired-grant', signer, 'facts-expired');
      });
      await constrainedTransaction(client, async () => {
        await client.query(
          `INSERT INTO content_intake.principal_facts(
             principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
           VALUES ('facts-disabled', 2, ARRAY['department-facts-disabled']::text[],
             'job-facts-disabled', false, $1, $2, $3)`,
          [
            new Date(world.at.getTime() - 1_000),
            new Date(world.at.getTime() + 240_000),
            sha256('facts-disabled-v2'),
          ],
        );
        await client.query(
          `UPDATE content_intake.principals
           SET current_facts_version = 2
           WHERE principal_id = 'facts-disabled'`,
        );
      });
      await expectRejected(client, 'facts-disabled', 'query', SOURCE, world.at);
      await expectRejected(client, 'facts-expired', 'query', SOURCE, world.at);
    } finally {
      await client.end();
    }
  }, 180_000);

  it('accepts a full 24-hour facts window with inclusive start and exclusive expiry', async () => {
    const client = await migratedClient('lifecycle_facts_boundary');
    try {
      const day = 86_400_000;
      const world = await seedWorld(client, [
        { id: 'boundary-issuer', role: 'director' },
        { id: 'boundary-reader', role: 'engineer', checkedOffsetMs: 0, validOffsetMs: day },
      ]);
      await constrainedTransaction(client, async () => {
        await insertGrant(client, {
          id: 'boundary-import', kind: 'business', action: 'import',
          issuerId: 'boundary-issuer', recipientId: 'boundary-reader', sourceId: SOURCE,
          startsAt: new Date(world.at.getTime() - 60_000),
          expiresAt: new Date(world.at.getTime() + day + 60_000),
        });
      });
      await expectRejected(client, 'boundary-reader', 'import', SOURCE, new Date(world.at.getTime() - 1));
      await expectSourcePresent(client, 'boundary-reader', 'import', SOURCE, world.at);
      await expectSourcePresent(client, 'boundary-reader', 'import', SOURCE, new Date(world.at.getTime() + day - 1));
      await expectRejected(client, 'boundary-reader', 'import', SOURCE, new Date(world.at.getTime() + day));
      await expectRejected(client, 'boundary-reader', 'import', SOURCE, new Date(world.at.getTime() + day + 1));
    } finally {
      await client.end();
    }
  }, 180_000);

  it('invalidates a roster query grant on policy, store-set, and membership drift', async () => {
    const client = await migratedClient('lifecycle_query_versions');
    try {
      const signer = rosterSignerId();
      const world = await seedWorld(client, [
        { id: signer, role: 'director', identityScope: 'content-intake-system', personKey: 'query-signer' },
        { id: 'query-reader', role: 'agent' },
        { id: 'query-extra', role: 'agent' },
      ]);
      await constrainedTransaction(client, async () => {
        await insertDirectQueryGrant(client, world, 'query-version-grant', signer, 'query-reader');
      });
      await expectSourcePresent(client, 'query-reader', 'query', SOURCE, world.at);

      await client.query(
        `DELETE FROM content_intake.store_set_members
         WHERE tenant_id = $1 AND app_id = $2 AND version = 1
           AND scope_id = $3 AND source_id = $4`,
        [TENANT, APP, SCOPE, SOURCE],
      );
      await expectRejected(client, 'query-reader', 'query', SOURCE, world.at);
      await client.query(
        `INSERT INTO content_intake.store_set_members(
           tenant_id, app_id, version, scope_id, source_id, content_valid_until)
         VALUES ($1, $2, 1, $3, $4, $5::timestamptz + interval '1 hour')`,
        [TENANT, APP, SCOPE, SOURCE, world.at],
      );

      await expectSourcePresent(client, 'query-reader', 'query', SOURCE, world.at);
      await client.query('BEGIN');
      await client.query(
        `UPDATE content_intake.role_rules
         SET policy_version = policy_version + 1
         WHERE tenant_id = $1 AND app_id = $2
           AND department_id = 'department-query-extra' AND job_id = 'job-query-extra'`,
        [TENANT, APP],
      );
      await expectRejected(client, 'query-reader', 'query', SOURCE, world.at);
      await client.query('ROLLBACK');
      await expectSourcePresent(client, 'query-reader', 'query', SOURCE, world.at);

      await client.query(
        `INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
         VALUES ($1, $2, 2, $3, 'synthetic')`,
        [TENANT, APP, world.at],
      );
      await client.query(
        `INSERT INTO content_intake.store_set_members(
           tenant_id, app_id, version, scope_id, source_id, content_valid_until)
         VALUES ($1, $2, 2, $3, $4, $5::timestamptz + interval '1 hour')`,
        [TENANT, APP, SCOPE, SIBLING, world.at],
      );
      const advanced = await client.query(
        `UPDATE content_intake.store_set_current
         SET version = 2
         WHERE tenant_id = $1 AND app_id = $2`,
        [TENANT, APP],
      );
      expect(advanced.rowCount).toBe(1);
      await expectRejected(client, 'query-reader', 'query', SOURCE, world.at);
    } finally {
      await client.end();
    }
  }, 180_000);

  it('expands wildcard grants only to real sources in the granted scope', async () => {
    const client = await migratedClient('lifecycle_wildcard');
    try {
      const world = await seedWorld(client, [
        { id: 'wildcard-issuer', role: 'director' },
        { id: 'wildcard-reader', role: 'engineer' },
      ]);
      await constrainedTransaction(client, async () => {
        await insertGrant(client, {
          id: 'wildcard-import',
          kind: 'business',
          issuerId: 'wildcard-issuer',
          recipientId: 'wildcard-reader',
          sourceId: null,
          action: 'import',
          startsAt: new Date(world.at.getTime() - 30_000),
          expiresAt: new Date(world.at.getTime() + 120_000),
        });
      });
      await expectSourcePresent(client, 'wildcard-reader', 'import', SOURCE, world.at);
      await expectSourcePresent(client, 'wildcard-reader', 'import', SIBLING, world.at);
      await expectRejected(client, 'wildcard-reader', 'import', OTHER_SOURCE, world.at);
      await expectRejected(client, 'wildcard-reader', 'import', 'source-does-not-exist', world.at);
      await expectRejected(client, 'wildcard-reader', 'import', null, world.at);
      await expectRejected(client, 'wildcard-reader', 'import', OTHER_SOURCE, world.at, OTHER_SCOPE);
    } finally {
      await client.end();
    }
  }, 180_000);

  it('returns the maximum valid expiry for an exact source and bounds it by facts', async () => {
    const client = await migratedClient('lifecycle_deadline');
    try {
      const world = await seedWorld(client, [
        { id: 'deadline-issuer', role: 'director' },
        {
          id: 'deadline-reader',
          role: 'engineer',
          validOffsetMs: 150_000,
        },
      ]);
      const factsUntil = new Date(world.at.getTime() + 150_000).toISOString();
      await constrainedTransaction(client, async () => {
        for (const [id, sourceId, expiresOffsetMs] of [
          ['deadline-exact-short', SOURCE, 60_000],
          ['deadline-wildcard', null, 90_000],
          ['deadline-exact-long', SOURCE, 180_000],
        ] as const) {
          await insertGrant(client, {
            id,
            kind: 'business',
            issuerId: 'deadline-issuer',
            recipientId: 'deadline-reader',
            sourceId,
            action: 'import',
            startsAt: new Date(world.at.getTime() - 30_000),
            expiresAt: new Date(world.at.getTime() + expiresOffsetMs),
          });
        }
      });
      await expect(decision(client, 'deadline-reader', 'import', SOURCE, world.at)).resolves.toEqual({
        deadline: factsUntil,
        sources: factsUntil,
      });
      const sibling = await decision(client, 'deadline-reader', 'import', SIBLING, world.at);
      expect(sibling.deadline).toBe(new Date(world.at.getTime() + 90_000).toISOString());
      expect(sibling.sources).toBe(sibling.deadline);
    } finally {
      await client.end();
    }
  }, 180_000);

  it('keeps valid parentless query and import grants on their intended doors', async () => {
    const client = await migratedClient('lifecycle_direct');
    try {
      const signer = rosterSignerId();
      const world = await seedWorld(client, [
        { id: signer, role: 'director', identityScope: 'content-intake-system', personKey: 'query-signer' },
        { id: 'direct-query-reader', role: 'agent' },
        { id: 'direct-import-issuer', role: 'director' },
        { id: 'direct-import-reader', role: 'engineer' },
      ]);
      await constrainedTransaction(client, async () => {
        await insertDirectQueryGrant(client, world, 'direct-query', signer, 'direct-query-reader');
        await insertGrant(client, {
          id: 'direct-import',
          kind: 'business',
          issuerId: 'direct-import-issuer',
          recipientId: 'direct-import-reader',
          sourceId: SOURCE,
          action: 'import',
          startsAt: new Date(world.at.getTime() - 30_000),
          expiresAt: new Date(world.at.getTime() + 120_000),
        });
      });
      await expectSourcePresent(client, 'direct-query-reader', 'query', SOURCE, world.at);
      await expectSourcePresent(client, 'direct-import-reader', 'import', SOURCE, world.at);
      await expectRejected(client, 'direct-query-reader', 'import', SOURCE, world.at);
      await expectRejected(client, 'direct-import-reader', 'publish', SOURCE, world.at);
    } finally {
      await client.end();
    }
  }, 180_000);

  it('allows all four existing authorization callers to execute both functions', async () => {
    const client = await migratedClient('lifecycle_acl');
    try {
      const signer = rosterSignerId();
      const world = await seedWorld(client, [
        { id: signer, role: 'director', identityScope: 'content-intake-system', personKey: 'query-signer' },
        { id: 'acl-reader', role: 'agent' },
      ]);
      await constrainedTransaction(client, async () => {
        await insertDirectQueryGrant(client, world, 'acl-query', signer, 'acl-reader');
      });
      for (const role of [
        'intake_usage',
        'intake_business',
        'intake_runtime_fn_owner',
        'intake_directory_fn_owner',
      ] as const) {
        await expectRoleCanRead(client, role, 'acl-reader', world.at);
      }
      const publicAcl = await client.query<{ deadline: boolean; sources: boolean }>(`
        SELECT
          pg_catalog.has_function_privilege(
            'public',
            'content_intake.authorization_deadline(text,text,text,text,timestamptz)',
            'EXECUTE') AS deadline,
          pg_catalog.has_function_privilege(
            'public',
            'content_intake.authorization_sources(text,text,timestamptz)',
            'EXECUTE') AS sources`);
      expect(publicAcl.rows).toEqual([{ deadline: false, sources: false }]);
    } finally {
      await client.end();
    }
  }, 180_000);

  it('upgrades a committed 75 prefix and closes the grandfather revocation gap', async () => {
    const client = await harness.connect(harness.createDatabase('lifecycle_upgrade').config);
    try {
      await applyMigrationPrefix(client, 75);
      const world = await seedWorld(client, [
        { id: 'upgrade-allocator', role: 'director' },
        { id: 'upgrade-delegator', role: 'manager' },
        { id: 'upgrade-issuer', role: 'engineer' },
        { id: 'upgrade-reader', role: 'agent' },
      ]);
      const chain = await chainIds(client, world, 'upgrade', {
        allocator: 'upgrade-allocator',
        delegator: 'upgrade-delegator',
        issuer: 'upgrade-issuer',
        reader: 'upgrade-reader',
      }, true);
      await constrainedTransaction(client, async () => {
        await revokeGrant(client, chain.allocationId, new Date(world.at.getTime() - 1_000));
      });

      const inheritedDeadline = new Date(world.at.getTime() + 170_000).toISOString();
      await expect(decision(client, 'upgrade-reader', 'query', SOURCE, world.at)).resolves.toEqual({
        deadline: inheritedDeadline,
        sources: inheritedDeadline,
      });

      const applied = await applyDatabaseMigrations(client);
      expect(applied.applied.map(migration => migration.position)).toContain(76);
      await expectRejected(client, 'upgrade-reader', 'query', SOURCE, world.at);
    } finally {
      await client.end();
    }
  }, 240_000);
});
