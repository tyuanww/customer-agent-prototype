import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Client, ClientConfig } from 'pg';
import { Pg15Harness } from '../src/testkit/index.js';
import { applyDatabaseMigrations } from '../src/index.js';

/**
 * Property: `authorization_sources` and `authorization_deadline` must agree.
 *
 * Four product doors ask one question in two shapes. The search door and the workbench
 * button bits read the set (`authorization_sources`); the intake query surface that the
 * shipped capsule actually calls reads the deadline (`authorization_deadline`, in
 * apps/api/src/content-intake/usage.ts). A drift between the two means one door serves a
 * source that another door refuses, for the same principal, action and instant.
 *
 * The assertion compares membership only, never the returned timestamp: the set emits one
 * row per grant while the deadline collapses a principal's grants into the latest expiry,
 * so the values legitimately differ while the yes/no answer must not.
 *
 * Runs only against a disposable PG15 cluster.
 */
const enabled = process.env.CUSTOMER_AGENT_DB_PG15_INTEGRATION === '1';

const TENANT = 'tenant-agreement';
const APP = 'app-agreement';
const BRAND = 'brand-agreement';
const DEPARTMENT = 'dept-agreement';
const JOB = 'job-agreement';
const ACTOR = 'prn-agreement-actor';
const USER = 'usr-agreement-actor';
// A business grant must name a different issuer than its recipient, so the issuer is its
// own principal. Its own facts window is irrelevant here: the functions judge the recipient.
const ISSUER = 'prn-agreement-issuer';
const ISSUER_USER = 'usr-agreement-issuer';

/** Scopes and sources every generated case is asserted over. A source in the second scope
 * exercises a grant that names a source outside the scope it was granted on. */
const UNIVERSE = Object.freeze([
  { scope: 'scope-agreement-a', domain: 'product', sources: ['source-agreement-a', 'source-agreement-b'] as const },
  { scope: 'scope-agreement-b', domain: 'campaign', sources: ['source-agreement-c'] as const },
]);

/** Every action the contract defines. The two functions admit them in two ceiling bands
 *  (query-only for agent/enabler, all for the rest), so leaving four out would leave the
 *  band boundary untested for the exact actions that differ. */
const ACTIONS = ['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback'] as const;
type Action = (typeof ACTIONS)[number];

/** A grant is generated in the vocabulary of the two functions, so a counterexample reads
 * as "a null-source publish grant that had already expired" rather than as five columns. */
type GrantSpec = Readonly<{
  action: Action;
  /** `null` grants the whole scope; a name grants that one source. */
  source: 'null' | 'source-agreement-a' | 'source-agreement-b' | 'source-agreement-c';
  kind: 'business' | 'allocation';
  startsOffsetMs: number;
  expiresOffsetMs: number;
  revoked: boolean;
  /** A parented grant authorizes only while it keeps a steward. Without this dimension the
   *  generated business rows always carried one, so the predicate could be inverted or
   *  deleted without the property noticing. */
  hasSteward: boolean;
  /** Revokes the parent allocation after the child is inserted, which is the second
   *  revocation shape: the child keeps its steward while its parent is dead. */
  parentRevoked: boolean;
}>;

type CaseSpec = Readonly<{
  factsEnabled: boolean;
  factsCheckedOffsetMs: number;
  factsValidOffsetMs: number;
  role: 'director' | 'agent' | 'lead' | 'enabler' | 'manager' | 'supervisor' | 'engineer' | null;
  grants: readonly GrantSpec[];
  /** When false the grant carries no policy version, so a query grant is not live. */
  policyCurrent: boolean;
  /** When false the grant carries no store-set version, so a query grant is not live. */
  storeSetCurrent: boolean;
  /** When false the store set lists no source, so a query grant is not live. */
  memberListed: boolean;
}>;

const secondsArb = (min: number, max: number) => fc.integer({ min, max });

const grantArb: fc.Arbitrary<GrantSpec> = fc.record({
  action: fc.constantFrom(...ACTIONS),
  source: fc.constantFrom('null', 'source-agreement-a', 'source-agreement-b', 'source-agreement-c'),
  kind: fc.constantFrom('business', 'allocation'),
  startsOffsetMs: secondsArb(-120, 30).map(seconds => seconds * 1_000),
  expiresOffsetMs: secondsArb(-30, 240).map(seconds => seconds * 1_000),
  revoked: fc.boolean(),
  hasSteward: fc.boolean(),
  parentRevoked: fc.boolean(),
});

const caseArb: fc.Arbitrary<CaseSpec> = fc.record({
  factsEnabled: fc.boolean(),
  // A window that opens late or closes early is the interesting case, so both ends move.
  factsCheckedOffsetMs: secondsArb(-280, 20).map(seconds => seconds * 1_000),
  factsValidOffsetMs: secondsArb(-60, 290).map(seconds => seconds * 1_000),
  // role_rules is keyed by (tenant, app, department, job), so a job carries at most one
  // current role. Zero roles is the interesting case: the ceiling then rejects every action.
  // Every role the ceiling mentions. supervisor and engineer were missing, and they are
  // exactly the roles the two functions band differently from the rest.
  role: fc.option(fc.constantFrom('director', 'agent', 'lead', 'enabler', 'manager', 'supervisor', 'engineer'), { nil: null }),
  grants: fc.array(grantArb, { maxLength: 4 }),
  policyCurrent: fc.boolean(),
  storeSetCurrent: fc.boolean(),
  memberListed: fc.boolean(),
}).map(spec => {
  // Stay inside the facts table's own contract: valid_until > checked_at and at most five
  // minutes after it. A generator that inserts a row the schema forbids proves nothing.
  const checked = spec.factsCheckedOffsetMs;
  const valid = Math.min(Math.max(spec.factsValidOffsetMs, checked + 1_000), checked + 295_000);
  return { ...spec, factsValidOffsetMs: valid };
});

/** The scope a named source belongs to, so a grant can be placed on the scope its source
 * lives in or, for the cross-scope case, on the other one. */
function scopeOfSource(source: string): string {
  for (const entry of UNIVERSE) if ((entry.sources as readonly string[]).includes(source)) return entry.scope;
  return UNIVERSE[0]!.scope;
}

describe.skipIf(!enabled)('authorization_sources agrees with authorization_deadline', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let database: Readonly<{ name: string; config: ClientConfig }>;
  let at: Date;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    database = harness.createDatabase('set_agreement');
    admin = await harness.connect(database.config);
    await applyDatabaseMigrations(admin);
    // One instant, shared by the seeded windows and both function calls, so the only
    // variable in a counterexample is the grant shape.
    const now = await admin.query<{ at: Date }>('SELECT clock_timestamp() AS at');
    at = new Date(now.rows[0]!.at.toISOString());
  }, 120_000);

  afterAll(async () => {
    await admin?.end();
    harness?.stop();
  }, 60_000);

  async function runCase(spec: CaseSpec): Promise<readonly string[]> {
    const client = await harness.connect(database.config);
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await client.query(
        `INSERT INTO backend_identity.subject_bindings(
           binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
         VALUES ('binding-agreement', 'synthetic', $1, 'binding-agreement', $2, repeat('ab',32), true, 'owner')
         ON CONFLICT (binding_id) DO NOTHING`, [TENANT, USER]);
      for (const entry of UNIVERSE) {
        await client.query(
          `INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id, brand_id, shop_id, domain)
           VALUES ($1, $2, $3, $4, NULL, $5) ON CONFLICT (scope_id) DO NOTHING`,
          [entry.scope, TENANT, APP, BRAND, entry.domain]);
        for (const source of entry.sources) {
          await client.query(
            `INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
             VALUES ($1, $2, 1, 'v2-preview') ON CONFLICT (source_id) DO NOTHING`,
            [source, entry.scope]);
        }
      }
      await client.query(
        `INSERT INTO content_intake.policy_versions(tenant_id, app_id, version)
         VALUES ($1, $2, 1) ON CONFLICT (tenant_id, app_id) DO NOTHING`, [TENANT, APP]);

      // Principal, facts and role rules. Inserting a role rule records a policy-history row
      // and bumps the current version, so the grant stamp is read after this block.
      const checkedAt = new Date(at.getTime() + spec.factsCheckedOffsetMs);
      const validUntil = new Date(at.getTime() + spec.factsValidOffsetMs);
      await client.query(
        `INSERT INTO backend_identity.subject_bindings(
           binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
         VALUES ('binding-agreement-issuer', 'synthetic', $1, 'binding-agreement-issuer', $2, repeat('ab',32), true, 'owner')
         ON CONFLICT (binding_id) DO NOTHING`, [TENANT, ISSUER_USER]);
      for (const [principalId, userId] of [[ACTOR, USER], [ISSUER, ISSUER_USER]] as const) {
        await client.query(
          `INSERT INTO content_intake.principals(
             principal_id, user_id, tenant_id, app_id, identity_scope, person_key,
             current_facts_version, revocation_generation)
           VALUES ($1, $2, $3, $4, 'confirmed-synthetic', $1, 1, 0)`, [principalId, userId, TENANT, APP]);
        await client.query(
          `INSERT INTO content_intake.principal_facts(
             principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
           VALUES ($1, 1, ARRAY[$2]::text[], $3, $4, $5, $6, repeat('ab',32))`,
          [principalId, DEPARTMENT, JOB, spec.factsEnabled, checkedAt, validUntil]);
      }
      if (spec.role !== null) {
        await client.query(
          `INSERT INTO content_intake.role_rules(tenant_id, app_id, department_id, job_id, policy_version, role)
           VALUES ($1, $2, $3, $4, 1, $5)`, [TENANT, APP, DEPARTMENT, JOB, spec.role]);
      }

      const policy = await client.query<{ version: string }>(
        `SELECT version::text AS version FROM content_intake.policy_versions
         WHERE tenant_id = $1 AND app_id = $2`, [TENANT, APP]);
      const currentPolicy = policy.rows[0]?.version ?? null;

      // Store set: the query branch reads the current version, its members, and the grant's
      // stamped version. Any of the three missing makes a query grant not live.
      await client.query(
        `INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
         VALUES ($1, $2, 1, clock_timestamp(), 'agreement') ON CONFLICT DO NOTHING`, [TENANT, APP]);
      await client.query(
        `INSERT INTO content_intake.store_set_current(tenant_id, app_id, version)
         VALUES ($1, $2, 1) ON CONFLICT (tenant_id, app_id) DO UPDATE SET version = 1`, [TENANT, APP]);
      if (spec.memberListed) {
        for (const entry of UNIVERSE) {
          for (const source of entry.sources) {
            await client.query(
              `INSERT INTO content_intake.store_set_members(
                 tenant_id, app_id, version, scope_id, source_id, content_valid_until)
               VALUES ($1, $2, 1, $3, $4, clock_timestamp() + interval '1 day')
               ON CONFLICT DO NOTHING`, [TENANT, APP, entry.scope, source]);
          }
        }
      }

      let index = 0;
      for (const grant of spec.grants) {
        index += 1;
        const scope = grant.source === 'null' ? UNIVERSE[0]!.scope : scopeOfSource(grant.source);
        // A grant that names a source in the other scope is allowed by the table and is
        // exactly the case a door could disagree about.
        const startsAt = new Date(at.getTime() + grant.startsOffsetMs);
        const expiresAt = new Date(at.getTime() + grant.expiresOffsetMs);
        if (expiresAt <= startsAt) continue;
        // A business grant has to hang off an allocation with the same issuer, scope and
        // action, a null-or-equal source, a wider window and no revocation. The functions
        // ignore allocation rows, so this parent exists only to satisfy the table's guard.
        const parentId = grant.kind === 'business' ? `alloc-agreement-${index}` : null;
        if (parentId !== null) {
          await client.query(
            `INSERT INTO content_intake.grants(
               grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id,
               action, starts_at, expires_at, reason, steward_id)
             VALUES ($1, 'allocation', $2, $2, $3, $4, $5, NULL, $6, $7, $8, 'agreement parent', $2)`,
            [parentId, ISSUER, TENANT, APP, scope, grant.action,
              new Date(startsAt.getTime() - 60_000), new Date(expiresAt.getTime() + 60_000)]);
        }
        await client.query(
          `INSERT INTO content_intake.grants(
             grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id,
             action, starts_at, expires_at, revoked_at, reason, steward_id, parent_grant_id,
             policy_version, store_set_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'agreement case', $16, $15, $13, $14)`,
          [`grant-agreement-${index}`, grant.kind, ISSUER, ACTOR, TENANT, APP, scope,
            grant.source === 'null' ? null : grant.source, grant.action, startsAt, expiresAt,
            grant.revoked ? new Date(at.getTime() - 1_000) : null,
            grant.action === 'query' && spec.policyCurrent ? currentPolicy : null,
            grant.action === 'query' && spec.storeSetCurrent ? '1' : null,
            parentId, grant.hasSteward ? ISSUER : null]);
        // Revoking the parent after the child exists is the only way to reach the "child keeps
        // its steward, parent is dead" state: the insert guard requires a live parent.
        if (parentId !== null && grant.parentRevoked) {
          await client.query(
            `UPDATE content_intake.grants SET revoked_at=$2, version=version+1,
               last_change_reason='agreement parent revoke' WHERE grant_id=$1`,
            [parentId, new Date(at.getTime() - 1_500)]);
        }
      }

      // Compare over the whole universe, for every action, at the one instant.
      const found: string[] = [];
      for (const action of ACTIONS) {
        const set = await client.query<{ scope_id: string; source_id: string; valid_until: Date }>(
          `SELECT scope_id, source_id, valid_until FROM content_intake.authorization_sources($1, $2, $3)`,
          [ACTOR, action, at]);
        // The deadline collapses a principal's grants into one expiry while the set emits a row
        // per grant, so the two timestamps are compared through the same reduction the callers
        // use: max over the set. Without this the property would pass while the set ignored a
        // grant's expiry, which is how every consumer bounds a lease.
        const expiries = new Map<string, number>();
        for (const row of set.rows) {
          const key = `${row.scope_id}\u0000${row.source_id}`;
          expiries.set(key, Math.max(expiries.get(key) ?? 0, new Date(row.valid_until).getTime()));
        }
        for (const entry of UNIVERSE) {
          for (const source of entry.sources) {
            const deadline = await client.query<{ until: Date | null }>(
              `SELECT content_intake.authorization_deadline($1, $2, $3, $4, $5) AS until`,
              [ACTOR, action, entry.scope, source, at]);
            const until = deadline.rows[0]?.until;
            const live = until !== null && until !== undefined;
            const key = `${entry.scope}\u0000${source}`;
            const inSet = expiries.has(key);
            if (live && inSet && expiries.get(key) !== new Date(until).getTime()) {
              const shape = spec.grants.map(g => `${g.kind}/${g.action}/${g.source}`
                + `${g.revoked ? '/revoked' : ''}`
                + `${g.hasSteward ? '' : '/no-steward'}`
                + `${g.parentRevoked ? '/parent-revoked' : ''}`).join(', ') || 'no grants';
              found.push(`${action} ${key.replace('\u0000', '/')}: deadline until`
                + ` ${new Date(until).toISOString()} set until`
                + ` ${new Date(expiries.get(key)!).toISOString()} [${shape}]`);
            }
            if (live !== inSet) {
              const shape = spec.grants.map(g => `${g.kind}/${g.action}/${g.source}`
                + `${g.revoked ? '/revoked' : ''}`
                + `${g.hasSteward ? '' : '/no-steward'}`
                + `${g.parentRevoked ? '/parent-revoked' : ''}`).join(', ') || 'no grants';
              found.push(`${action} ${entry.scope}/${source}: deadline=${live ? 'live' : 'null'}`
                + ` set=${inSet ? 'present' : 'absent'} [${shape}]`
                + ` facts=${spec.factsEnabled ? 'enabled' : 'disabled'}`
                + ` role=${spec.role ?? 'none'}`);
            }
          }
        }
      }
      return found;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }

  /** One deterministic case the falsification test can also use: a live publish grant that
   * names a single source, so the other source in the same scope must stay invisible. */
  async function seedSingleSourceCase(client: Client, at: Date): Promise<void> {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query(
      `INSERT INTO backend_identity.subject_bindings(
         binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
       VALUES ('binding-agreement', 'synthetic', $1, 'binding-agreement', $2, repeat('ab',32), true, 'owner')`,
      [TENANT, USER]);
    await client.query(
      `INSERT INTO backend_identity.subject_bindings(
         binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
       VALUES ('binding-agreement-issuer', 'synthetic', $1, 'binding-agreement-issuer', $2, repeat('ab',32), true, 'owner')`,
      [TENANT, ISSUER_USER]);
    for (const entry of UNIVERSE) {
      await client.query(
        `INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id, brand_id, shop_id, domain)
         VALUES ($1, $2, $3, $4, NULL, $5)`, [entry.scope, TENANT, APP, BRAND, entry.domain]);
      for (const source of entry.sources) {
        await client.query(
          `INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
           VALUES ($1, $2, 1, 'v2-preview')`, [source, entry.scope]);
      }
    }
    await client.query(
      `INSERT INTO content_intake.policy_versions(tenant_id, app_id, version) VALUES ($1, $2, 1)`,
      [TENANT, APP]);
    for (const [principalId, userId] of [[ACTOR, USER], [ISSUER, ISSUER_USER]] as const) {
      await client.query(
        `INSERT INTO content_intake.principals(
           principal_id, user_id, tenant_id, app_id, identity_scope, person_key,
           current_facts_version, revocation_generation)
         VALUES ($1, $2, $3, $4, 'confirmed-synthetic', $1, 1, 0)`, [principalId, userId, TENANT, APP]);
      await client.query(
        `INSERT INTO content_intake.principal_facts(
           principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
         VALUES ($1, 1, ARRAY[$2]::text[], $3, true, $4, $5, repeat('ab',32))`,
        [principalId, DEPARTMENT, JOB, new Date(at.getTime() - 1_000), new Date(at.getTime() + 240_000)]);
    }
    await client.query(
      `INSERT INTO content_intake.role_rules(tenant_id, app_id, department_id, job_id, policy_version, role)
       VALUES ($1, $2, $3, $4, 1, 'director')`, [TENANT, APP, DEPARTMENT, JOB]);
    await client.query(
      `INSERT INTO content_intake.grants(
         grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, action,
         starts_at, expires_at, reason, steward_id)
       VALUES ('alloc-single', 'allocation', $1, $1, $2, $3, $4, 'publish', $5, $6, 'parent', $1)`,
      [ISSUER, TENANT, APP, UNIVERSE[0]!.scope,
        new Date(at.getTime() - 60_000), new Date(at.getTime() + 300_000)]);
    await client.query(
      `INSERT INTO content_intake.grants(
         grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
         starts_at, expires_at, reason, steward_id, parent_grant_id)
       VALUES ('grant-single', 'business', $1, $2, $3, $4, $5, 'source-agreement-a', 'publish',
         $6, $7, 'single source', $1, 'alloc-single')`,
      [ISSUER, ACTOR, TENANT, APP, UNIVERSE[0]!.scope,
        new Date(at.getTime() - 30_000), new Date(at.getTime() + 240_000)]);
  }

  /** The answers for one (scope, source, action): does the deadline see it, does the set. */
  async function answers(client: Client, action: Action, scope: string, source: string) {
    const deadline = await client.query<{ until: Date | null }>(
      `SELECT content_intake.authorization_deadline($1, $2, $3, $4, $5) AS until`,
      [ACTOR, action, scope, source, at]);
    const set = await client.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM content_intake.authorization_sources($1, $2, $3)
         WHERE scope_id = $4 AND source_id = $5) AS present`,
      [ACTOR, action, at, scope, source]);
    return { live: deadline.rows[0]?.until != null, present: set.rows[0]?.present === true };
  }

  it('sees a named source and not its sibling, so the property is not vacuous', async () => {
    const client = await harness.connect(database.config);
    try {
      await seedSingleSourceCase(client, at);
      // Both functions must say yes to the named source ...
      await expect(answers(client, 'publish', UNIVERSE[0]!.scope, 'source-agreement-a'))
        .resolves.toEqual({ live: true, present: true });
      // ... and no to the sibling the grant does not name.
      await expect(answers(client, 'publish', UNIVERSE[0]!.scope, 'source-agreement-b'))
        .resolves.toEqual({ live: false, present: false });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }, 120_000);

  it('fails when the set function drifts from the deadline', async () => {
    // A check nobody has seen fail proves nothing. Replace the set function with a variant
    // that ignores the grant's source for non-query actions — the exact drift this property
    // exists to catch — confirm the property reports it, then restore the real body and
    // confirm it reports nothing again.
    const client = await harness.connect(database.config);
    const original = await client.query<{ definition: string }>(
      `SELECT pg_catalog.pg_get_functiondef(
         'content_intake.authorization_sources(text,text,timestamptz)'::pg_catalog.regprocedure) AS definition`);
    // A named-source publish grant on a scope that holds two sources. The deadline answers
    // "named source only"; a set that ignores the source answers for both.
    const spec: CaseSpec = {
      factsEnabled: true, factsCheckedOffsetMs: -1_000, factsValidOffsetMs: 240_000,
      role: 'director',
      grants: [{
        action: 'publish', source: 'source-agreement-a', kind: 'business',
        startsOffsetMs: -30_000, expiresOffsetMs: 180_000, revoked: false,
        hasSteward: true, parentRevoked: false,
      }],
      policyCurrent: true, storeSetCurrent: true, memberListed: true,
    };
    try {
      await expect(runCase(spec)).resolves.toEqual([]);

      await client.query(`
        CREATE OR REPLACE FUNCTION content_intake.authorization_sources(
          p_principal TEXT, p_action TEXT, p_at TIMESTAMPTZ
        ) RETURNS TABLE (
          scope_id content_intake.identifier,
          source_id content_intake.identifier,
          policy_version content_intake.version,
          store_set_version content_intake.version,
          valid_until TIMESTAMPTZ
        ) LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
          SELECT s.scope_id, expanded.source_id, g.policy_version, g.store_set_version,
            least(f.valid_until, g.expires_at)
          FROM content_intake.principals p
          JOIN content_intake.principal_facts f
            ON f.principal_id = p.principal_id AND f.facts_version = p.current_facts_version
          JOIN content_intake.grants g
            ON g.recipient_id = p.principal_id AND g.action = p_action AND g.kind = 'business'
            AND g.revoked_at IS NULL AND g.starts_at <= p_at AND p_at < g.expires_at
          JOIN content_intake.scopes s
            ON s.scope_id = g.scope_id AND s.tenant_id = p.tenant_id AND s.app_id = p.app_id
          JOIN LATERAL (
            -- DRIFT: the grant's source is ignored for every action.
            SELECT src.source_id FROM content_intake.sources src WHERE src.scope_id = s.scope_id
          ) expanded ON TRUE
          WHERE p.principal_id = p_principal AND f.enabled
            AND f.checked_at <= p_at AND p_at < f.valid_until
        $$`);

      const broken = await runCase(spec);
      expect(broken.length, 'the drifted function must produce a disagreement').toBeGreaterThan(0);
      expect(broken.join('\n')).toContain('source-agreement-b');
    } finally {
      if (original.rows[0]?.definition) await client.query(original.rows[0].definition);
      await client.end();
    }
    // Restored: the same case agrees again, so the failure above was the drift, not noise.
    await expect(runCase(spec)).resolves.toEqual([]);
  }, 180_000);

  it('fails when the set function drops the parent-liveness check', async () => {
    // The steward and parent dimensions exist because a revocation can leave a child with a
    // live steward under a dead parent. Prove the property sees that drift: take the real
    // definition, remove the parent clause, and require a disagreement naming the shape.
    const client = await harness.connect(database.config);
    const original = await client.query<{ definition: string }>(
      `SELECT pg_catalog.pg_get_functiondef(
         'content_intake.authorization_sources(text,text,timestamptz)'::pg_catalog.regprocedure) AS definition`);
    const parentClause = /AND \(g\.parent_grant_id IS NULL OR \(g\.steward_id IS NOT NULL AND EXISTS \([\s\S]*?revoked_at IS NULL\)\)\)/;
    const real = original.rows[0]?.definition ?? '';
    if (!parentClause.test(real)) throw new Error('the installed function no longer carries the parent clause');
    // A parented grant whose parent is revoked, keeping its steward: the state a second
    // revocation leaves behind.
    const spec: CaseSpec = {
      factsEnabled: true, factsCheckedOffsetMs: -1_000, factsValidOffsetMs: 240_000,
      role: 'director',
      grants: [{
        action: 'publish', source: 'source-agreement-a', kind: 'business',
        startsOffsetMs: -30_000, expiresOffsetMs: 180_000, revoked: false,
        hasSteward: true, parentRevoked: true,
      }],
      policyCurrent: true, storeSetCurrent: true, memberListed: true,
    };
    try {
      await expect(runCase(spec)).resolves.toEqual([]);
      await client.query(real.replace(parentClause, 'AND (g.parent_grant_id IS NULL OR g.steward_id IS NOT NULL)'));
      const broken = await runCase(spec);
      expect(broken.length, 'dropping the parent check must produce a disagreement').toBeGreaterThan(0);
      expect(broken.join('\n')).toContain('parent-revoked');
    } finally {
      if (real) await client.query(real);
      await client.end();
    }
    await expect(runCase(spec)).resolves.toEqual([]);
  }, 180_000);

  it('reports no disagreement for any generated grant shape', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (spec) => {
        const found = await runCase(spec);
        // fast-check shrinks a failure to the smallest grant set that still disagrees, so
        // the message names the shape rather than a 40-line dump.
        expect(found, found.join('\n')).toEqual([]);
      }),
      { numRuns: 40 },
    );
  }, 600_000);
});
