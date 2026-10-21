import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { changeGrant, createGrants } from '../src/content-intake/authority.js';
import { IntakeRejection, principal, type IntakeTransaction, type Principal } from '../src/content-intake/transaction.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';

const TENANT = 'tenant-reach';
const APP = 'app-reach';
const SCOPE = 'scope-reach';
const SOURCE = 'source-reach';
const ACTION = 'publish' as const;
/** Bound on sequence length. The alphabet has five operations, so the worst case is
 *  1 + 5 + ... + 5^5 nodes; state deduplication collapses most of them. */
const MAX_DEPTH = 5;

type Tx = IntakeTransaction;

/** Drives `createGrants` / `changeGrant` through every operation sequence in the alphabet up
 *  to MAX_DEPTH, checking the invariants after each reachable state. Savepoints make the
 *  search cheap: one transaction, one rollback per branch. */
describe.skipIf(!enabled)('authorization reachability', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let tx: Tx;
  let policyVersion = 1;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    admin = await harness.connect(harness.createDatabase('reachability').config);
    await applyDatabaseMigrations(admin);
    tx = Object.assign(admin, { validUntil() { /* no transaction owner here */ }, beforeCommit() { /* unused */ } }) as Tx;
    await admin.query('BEGIN');
    await seed();
  }, 180_000);

  afterAll(async () => {
    await admin?.query('ROLLBACK').catch(() => undefined);
    await admin?.end();
    harness?.stop();
  }, 60_000);

  async function seed(): Promise<void> {
    for (const [id, role, job] of [['root', 'director', 'job-root'], ['issuer', 'director', 'job-director'],
      ['manager', 'manager', 'job-manager'], ['supervisor', 'supervisor', 'job-supervisor']] as const) {
      await admin.query(`INSERT INTO backend_identity.subject_bindings(
          binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
        VALUES ($1,'synthetic',$2,$1,$3,repeat('a',64),true,'owner')`, [id, TENANT, `usr_${id}`]);
      await admin.query(`INSERT INTO content_intake.principals(
          principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version)
        VALUES ($1,$2,$3,$4,'reach',$1,1)`, [id, `usr_${id}`, TENANT, APP]);
      await admin.query(`INSERT INTO content_intake.principal_facts(
          principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
        VALUES ($1,1,ARRAY['dept-reach'],$2,true,statement_timestamp()-interval '1 second',
          statement_timestamp()+interval '240 seconds',repeat('c',64))`, [id, job]);
      await admin.query(`INSERT INTO content_intake.role_rules(
          tenant_id, app_id, department_id, job_id, policy_version, role)
        VALUES ($1,$2,'dept-reach',$3,1,$4)`, [TENANT, APP, job, role]);
    }
    await admin.query(`INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id, brand_id, domain)
      VALUES ($1,$2,$3,'brand-reach','product')`, [SCOPE, TENANT, APP]);
    await admin.query(`INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
      VALUES ($1,$2,1,'v2-preview')`, [SOURCE, SCOPE]);
    await admin.query(`INSERT INTO content_intake.source_mappings(
        source_id, version, template_version, rule_version, mapping_version, structure_digest)
      VALUES ($1,1,'faq-p1.1','intake-p1.1','faq-map',repeat('d',64))`, [SOURCE]);

    // Controlled bootstrap: the state an operator starts from. Everything after this point
    // goes through the real entry points. Two constraints shape the set. The parent guard
    // requires parent.recipient = new.issuer, and a business grant cannot be self-issued, so
    // `root` issues both business grants off its own allocation. `issuer` holds its own
    // allocation (the authority to revoke) and the delegation (the authority to sign a child).
    const bootstrap: readonly (readonly [string, string, string, string, string | null, string])[] = [
      ['alloc-root', 'allocation', 'root', 'root', null, 'root'],
      ['biz-issuer', 'business', 'root', 'issuer', 'alloc-root', 'root'],
      ['biz-manager', 'business', 'root', 'manager', 'alloc-root', 'root'],
      ['alloc-issuer', 'allocation', 'issuer', 'issuer', null, 'issuer'],
      ['deleg-reach', 'delegation', 'issuer', 'manager', 'alloc-issuer', 'issuer'],
    ];
    // One instant for every row: a per-row clock_timestamp() leaves a child's window a
    // millisecond wider than its parent's, which the parent guard rejects.
    const start = new Date(Date.now() - 120_000), end = new Date(Date.now() + 260_000);
    for (const [id, kind, issuer, recipient, parent, steward] of bootstrap) {
      await admin.query(`INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, steward_id, parent_grant_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'bootstrap',$12,$13)`,
      [id, kind, issuer, recipient, TENANT, APP, SCOPE, SOURCE, ACTION, start, end, steward, parent]);
    }
    // The role_rules trigger owns the policy counter, so read the value rather than assume.
    policyVersion = Number((await admin.query<{ version: string }>(
      'SELECT version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2', [TENANT, APP])).rows[0]!.version);
  }

  const scopeRef = () => ({ tenantId: TENANT, appId: APP, brandId: 'brand-reach', shopId: null,
    domain: 'product' as const, sourceId: SOURCE });
  const iso = (offsetSeconds: number) => new Date(Date.now() + offsetSeconds * 1_000).toISOString();

  async function delegationId(): Promise<string | null> {
    const { rows } = await admin.query<{ grant_id: string }>(
      `SELECT grant_id FROM content_intake.grants WHERE kind='delegation' AND recipient_id='manager' AND revoked_at IS NULL`);
    return rows[0]?.grant_id ?? null;
  }
  async function childId(): Promise<string | null> {
    const { rows } = await admin.query<{ grant_id: string }>(
      `SELECT grant_id FROM content_intake.grants WHERE kind='business' AND recipient_id='supervisor'
         AND action=$1 AND revoked_at IS NULL ORDER BY grant_id LIMIT 1`, [ACTION]);
    return rows[0]?.grant_id ?? null;
  }

  const as = async (id: string): Promise<Principal> => principal(tx, { id });

  /** The five operations the operator can perform. Each drives a real entry point. */
  const OPS = [
    { name: 'grantChild', run: async () => {
      const manager = await as('manager');
      const supervisor = await as('supervisor');
      await createGrants(tx, manager, {
        operationId: `grant-child-${Date.now()}`, issuerFactsVersion: manager.factsVersion, policyVersion,
        items: [{ kind: 'business', recipientPrincipalId: 'supervisor', recipientFactsVersion: supervisor.factsVersion,
          action: ACTION, scope: scopeRef(), startsAt: iso(-20), expiresAt: iso(150), reason: 'reachability child' }],
      });
    } },
    { name: 'revokeDelegationNoSuccessor', run: async () => {
      const id = await delegationId();
      if (id === null) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
      const issuer = await as('issuer');
      await changeGrant(tx, issuer, id, { operationId: `revoke0-${Date.now()}`, expectedVersion: 1,
        change: 'revoke', stewardPrincipalId: null, reason: 'revoke without successor' });
    } },
    { name: 'revokeDelegationWithSuccessor', run: async () => {
      const id = await delegationId();
      if (id === null) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
      const issuer = await as('issuer');
      await changeGrant(tx, issuer, id, { operationId: `revoke1-${Date.now()}`, expectedVersion: 1,
        change: 'revoke', stewardPrincipalId: 'issuer', reason: 'revoke naming a successor' });
    } },
    { name: 'revokeChild', run: async () => {
      const id = await childId();
      if (id === null) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
      const issuer = await as('issuer');
      await changeGrant(tx, issuer, id, { operationId: `revokeChild-${Date.now()}`, expectedVersion: 1,
        change: 'revoke', stewardPrincipalId: null, reason: 'revoke the child' });
    } },
    { name: 'takeoverChild', run: async () => {
      const id = await childId();
      if (id === null) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
      const issuer = await as('issuer');
      await changeGrant(tx, issuer, id, { operationId: `takeover-${Date.now()}`, expectedVersion: 1,
        change: 'takeover', stewardPrincipalId: 'issuer', reason: 'take over the child' });
    } },
  ] as const;

  async function authorized(): Promise<boolean> {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM content_intake.authorization_sources('supervisor',$1,clock_timestamp())
        WHERE source_id=$2`, [ACTION, SOURCE]);
    return rows[0]!.n !== '0';
  }

  async function stateSignature(): Promise<string> {
    const { rows } = await admin.query<{ sig: string }>(`
      SELECT concat_ws('|',
        (SELECT coalesce(revoked_at::text,'live') || ':' || coalesce(steward_id,'-') || ':' || version
           FROM content_intake.grants WHERE kind='delegation' AND recipient_id='manager' ORDER BY grant_id LIMIT 1),
        (SELECT coalesce(max(concat_ws(':', coalesce(revoked_at::text,'live'), coalesce(steward_id,'-'), version)), 'none')
           FROM content_intake.grants WHERE kind='business' AND recipient_id='supervisor' AND action='publish')
      ) AS sig`);
    return rows[0]!.sig;
  }

  /** Checked after every reachable state. */
  async function assertInvariants(path: readonly string[]): Promise<void> {
    const label = path.join(' → ');
    const { rows: child } = await admin.query<{ parent_grant_id: string | null; steward_id: string | null; revoked_at: Date | null }>(
      `SELECT parent_grant_id, steward_id, revoked_at FROM content_intake.grants
        WHERE kind='business' AND recipient_id='supervisor' AND action=$1 AND revoked_at IS NULL
        ORDER BY grant_id LIMIT 1`, [ACTION]);
    const live = await authorized();

    // I1: authority never survives a revoked parent. A takeover writes steward_id directly,
    //     so this is where a resurrected child would show up.
    if (live) {
      const row = child[0];
      expect(row, `${label}: authorized without a live child row`).toBeDefined();
      expect(row!.steward_id, `${label}: authorized child has no steward`).not.toBeNull();
      if (row!.parent_grant_id !== null) {
        const { rows: parent } = await admin.query<{ revoked_at: Date | null }>(
          'SELECT revoked_at FROM content_intake.grants WHERE grant_id=$1', [row!.parent_grant_id]);
        expect(parent[0]!.revoked_at, `${label}: authorized under a revoked parent`).toBeNull();
      }
    }

    // I2: the two decision shapes agree at this state.
    const { rows: deadline } = await admin.query<{ until: Date | null }>(
      `SELECT content_intake.authorization_deadline('supervisor',$1,$2,$3,clock_timestamp()) AS until`,
      [ACTION, SCOPE, SOURCE]);
    expect(deadline[0]!.until !== null, `${label}: set says ${live}, deadline says ${deadline[0]!.until !== null}`)
      .toBe(live);

    // I4: revocation is terminal and versions only advance.
    const { rows: drift } = await admin.query<{ bad: string | null }>(`
      SELECT string_agg(grant_id || ':' || version, ',') AS bad FROM content_intake.grants
        WHERE (revoked_at IS NOT NULL AND revoked_at > clock_timestamp())
           OR version < 1 OR version > 20`);
    expect(drift[0]!.bad, `${label}: version or revocation drift`).toBeNull();
  }

  it('holds both invariants in every reachable state of the grant lifecycle', async () => {
    const visited = new Set<string>();
    let states = 0;
    let deepest = 0;
    let savepoint = 0;
    // Coverage of the interesting region. Without this a green run could mean the search
    // never entered the state the invariants exist to police.
    const seen = { authorized: false, revokedDelegation: false, orphanedSteward: false };
    const applicable = new Set<string>();

    const explore = async (path: string[], depth: number): Promise<void> => {
      const signature = await stateSignature();
      if (visited.has(signature)) return;
      visited.add(signature);
      states += 1;
      if (depth > deepest) deepest = depth;
      if (await authorized()) seen.authorized = true;
      const { rows: shape } = await admin.query<{ delegation_revoked: boolean; child_live: number; child_steward: string | null }>(`
        SELECT (SELECT count(*)::int FROM content_intake.grants
                  WHERE kind='delegation' AND recipient_id='manager' AND revoked_at IS NOT NULL) > 0 AS delegation_revoked,
               (SELECT count(*)::int FROM content_intake.grants
                  WHERE kind='business' AND recipient_id='supervisor' AND action='publish' AND revoked_at IS NULL) AS child_live,
               (SELECT steward_id FROM content_intake.grants
                  WHERE kind='business' AND recipient_id='supervisor' AND action='publish' AND revoked_at IS NULL
                  ORDER BY grant_id LIMIT 1) AS child_steward`);
      if (shape[0]!.delegation_revoked) seen.revokedDelegation = true;
      // The shape a takeover leaves behind: a child that kept its steward under a revoked parent.
      if (shape[0]!.child_live > 0 && shape[0]!.child_steward !== null && shape[0]!.delegation_revoked) {
        seen.orphanedSteward = true;
      }
      if (depth === MAX_DEPTH) return;
      for (const op of OPS) {
        const name = `reach_sp_${++savepoint}`;
        await admin.query(`SAVEPOINT ${name}`);
        let applied = false;
        try {
          await op.run();
          applied = true;
        } catch (error) {
          // A rejected operation means "not applicable in this state", not a violation.
          if (!(error instanceof IntakeRejection)) throw error;
        }
        if (applied) {
          applicable.add(op.name);
          await assertInvariants([...path, op.name]);
          await explore([...path, op.name], depth + 1);
        }
        await admin.query(`ROLLBACK TO SAVEPOINT ${name}`);
      }
    };

    await assertInvariants(['initial']);
    await explore(['initial'], 0);
    // The search must reach every region the invariants police, and every operation must be
    // applicable somewhere, or a green run would mean little.
    expect([...applicable].sort()).toEqual(['grantChild', 'revokeChild', 'revokeDelegationNoSuccessor',
      'revokeDelegationWithSuccessor', 'takeoverChild']);
    expect(seen, 'search did not reach the guarded region').toEqual({
      authorized: true, revokedDelegation: true, orphanedSteward: true,
    });
    // eslint-disable-next-line no-console
    console.log(`reachability: ${states} distinct states, deepest path ${deepest}`);
  }, 300_000);
});
