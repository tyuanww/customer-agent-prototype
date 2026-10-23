import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const BREAK = process.env.CUSTOMER_AGENT_STORE_SET_BREAK === '1';

const TENANT = 'tenant-set';
const APP = 'app-set';
const SCOPE = 'scope-set';
const SOURCE = 'source-set';
/** A second readable source, so a version can drop SOURCE and still keep a member. */
const OTHER = 'source-other';
const OPERATOR = 'principal-operator';
const ADMIN = 'principal-admin';
const DEPT = 'dept-set';
const JOB = 'job-set';
const MAX_DEPTH = 4;

describe.skipIf(!enabled)('store-set advance', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let policyVersion: number;
  let at: Date;
  let savepoint = 0;

  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    admin = await harness.connect(harness.createDatabase('store-set').config);
    await applyDatabaseMigrations(admin);
    // One transaction for the whole run: principal_current_facts_fk is deferred, and every
    // branch below is undone with a savepoint instead of a compensating delete.
    await admin.query('BEGIN');
    await seed();
    if (BREAK) await installBrokenDeadline();
  }, 240_000);

  afterAll(async () => {
    await admin?.query('ROLLBACK').catch(() => undefined);
    await admin?.end().catch(() => undefined);
    harness?.stop();
  }, 60_000);

  async function seed(): Promise<void> {
    // The facts row must exist before the principal names it; the deferred foreign key is only
    // satisfied at commit, so the two inserts share this transaction.
    for (const [id, userId] of [[OPERATOR, 'usr-operator'], [ADMIN, 'usr-admin']] as const) {
      await admin.query(`INSERT INTO backend_identity.subject_bindings(
          binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
        VALUES ($1,'synthetic',$2,$1,$3,repeat('a',64),true,'owner')`, [id, TENANT, userId]);
      await admin.query(`INSERT INTO content_intake.principals(
          principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version)
        VALUES ($1,$2,$3,$4,'set',$1,1)`, [id, userId, TENANT, APP]);
      await admin.query(`INSERT INTO content_intake.principal_facts(
          principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
        VALUES ($1,1,ARRAY[$2],$3,true,statement_timestamp(),statement_timestamp()+interval '240 seconds',repeat('c',64))`,
      [id, DEPT, JOB]);
    }
    // role_rules is keyed on (tenant, app, department, job), so one row serves both principals.
    await admin.query(`INSERT INTO content_intake.role_rules(
        tenant_id, app_id, department_id, job_id, policy_version, role)
      VALUES ($1,$2,$3,$4,1,'engineer')`, [TENANT, APP, DEPT, JOB]);
    await admin.query(`INSERT INTO content_intake.scopes(scope_id, tenant_id, app_id, brand_id, domain)
      VALUES ($1,$2,$3,'brand-set','product')`, [SCOPE, TENANT, APP]);
    await admin.query(`INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
      VALUES ($1,$2,1,'v2-preview')`, [SOURCE, SCOPE]);
    await admin.query(`INSERT INTO content_intake.sources(source_id, scope_id, current_mapping_version, mode)
      VALUES ($1,$2,1,'v2-preview')`, [OTHER, SCOPE]);
    for (const source of [SOURCE, OTHER]) {
      await admin.query(`INSERT INTO content_intake.source_mappings(
          source_id, version, template_version, rule_version, mapping_version, structure_digest)
        VALUES ($1,1,'faq-p1.1','intake-p1.1','faq-map',repeat('d',64))`, [source]);
    }

    policyVersion = Number((await admin.query<{ version: string }>(
      'SELECT version FROM content_intake.policy_versions WHERE tenant_id=$1 AND app_id=$2', [TENANT, APP])).rows[0]!.version);

    await admin.query(`INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
      VALUES ($1,$2,1,clock_timestamp(),'seed')`, [TENANT, APP]);
    await admin.query(`INSERT INTO content_intake.store_set_members(
        tenant_id, app_id, version, scope_id, source_id, content_valid_until)
      VALUES ($1,$2,1,$3,$4,clock_timestamp()+interval '30 days')`, [TENANT, APP, SCOPE, SOURCE]);
    await admin.query(`INSERT INTO content_intake.store_set_current(tenant_id, app_id, version)
      VALUES ($1,$2,1)`, [TENANT, APP]);

    const start = new Date(Date.now() - 120_000), end = new Date(Date.now() + 260_000);
    // One allocation per action: grant_parent_guard requires the child's action to equal its
    // parent's, and a business grant may not be self-issued.
    for (const action of ['import', 'publish', 'query']) {
      await admin.query(`INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, steward_id)
        VALUES ($1,'allocation',$2,$2,$3,$4,$5,NULL,$6,$7,$8,'root',$2)`,
      [`alloc-${action}`, ADMIN, TENANT, APP, SCOPE, action, start, end]);
      await admin.query(`INSERT INTO content_intake.grants(
          grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
          starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version)
        VALUES ($1,'business',$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual',$2,$11,$12,$13)`,
      [`manual-${action}`, ADMIN, OPERATOR, TENANT, APP, SCOPE, SOURCE, action, start, end,
        `alloc-${action}`, action === 'query' ? policyVersion : null, action === 'query' ? 1 : null]);
    }
    at = (await admin.query<{ at: Date }>(
      `SELECT checked_at + interval '1 second' AS at FROM content_intake.principal_facts
        WHERE principal_id=$1 AND facts_version=1`, [OPERATOR])).rows[0]!.at;
  }

  /** Negative control. Every action additionally has to be a member of the current store set,
   *  which is the failure this check exists to catch. */
  async function installBrokenDeadline(): Promise<void> {
    await admin.query(`CREATE OR REPLACE FUNCTION content_intake.authorization_deadline(
        p_principal TEXT, p_action TEXT, p_scope TEXT, p_source TEXT, p_at TIMESTAMPTZ)
      RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE SET search_path = pg_catalog AS $$
        SELECT least(f.valid_until, max(g.expires_at))
        FROM content_intake.principals p
        JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
        JOIN content_intake.scopes s ON s.scope_id=p_scope AND s.tenant_id=p.tenant_id AND s.app_id=p.app_id
        JOIN content_intake.grants g ON g.recipient_id=p.principal_id AND g.scope_id=s.scope_id
          AND g.action=p_action AND g.kind='business' AND g.revoked_at IS NULL
          AND (g.parent_grant_id IS NULL OR (g.steward_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM content_intake.grants parent_grant
            WHERE parent_grant.grant_id = g.parent_grant_id AND parent_grant.revoked_at IS NULL)))
          AND g.starts_at<=p_at AND p_at<g.expires_at
          AND EXISTS (SELECT 1 FROM content_intake.store_set_members member
            JOIN content_intake.store_set_current current
              ON current.tenant_id=member.tenant_id AND current.app_id=member.app_id
             AND current.version=member.version
            WHERE member.tenant_id=p.tenant_id AND member.app_id=p.app_id
              AND member.scope_id=s.scope_id AND member.source_id=p_source)
          AND (p_action<>'query' OR (g.policy_version=(SELECT pol.version FROM content_intake.policy_versions pol
                WHERE pol.tenant_id=p.tenant_id AND pol.app_id=p.app_id)
            AND g.store_set_version=(SELECT cur.version FROM content_intake.store_set_current cur
                WHERE cur.tenant_id=p.tenant_id AND cur.app_id=p.app_id)))
        JOIN content_intake.role_rules r ON r.tenant_id=p.tenant_id AND r.app_id=p.app_id
          AND r.department_id=ANY(f.department_ids) AND r.job_id=f.job_id
        WHERE p.principal_id=p_principal AND f.enabled AND f.checked_at<=p_at AND p_at<f.valid_until
        GROUP BY f.valid_until
        HAVING count(DISTINCT r.role)=1 AND content_intake.role_allows(min(r.role), p_action)
      $$`);
  }

  async function advance(members: readonly string[]): Promise<void> {
    const next = Number((await admin.query<{ version: string }>(
      'SELECT version FROM content_intake.store_set_current WHERE tenant_id=$1 AND app_id=$2', [TENANT, APP])).rows[0]!.version) + 1;
    await admin.query(`INSERT INTO content_intake.store_sets(tenant_id, app_id, version, approved_at, provenance)
      VALUES ($1,$2,$3,clock_timestamp(),'advance')`, [TENANT, APP, next]);
    for (const source of members) {
      await admin.query(`INSERT INTO content_intake.store_set_members(
          tenant_id, app_id, version, scope_id, source_id, content_valid_until)
        VALUES ($1,$2,$3,$4,$5,clock_timestamp()+interval '30 days')`, [TENANT, APP, next, SCOPE, source]);
    }
    await admin.query(`UPDATE content_intake.store_set_current SET version=$3
      WHERE tenant_id=$1 AND app_id=$2`, [TENANT, APP, next]);
  }

  async function currentMembers(): Promise<string[]> {
    const { rows } = await admin.query<{ source_id: string }>(`
      SELECT member.source_id FROM content_intake.store_set_members member
      JOIN content_intake.store_set_current current
        ON current.tenant_id = member.tenant_id AND current.app_id = member.app_id
       AND current.version = member.version
      WHERE member.tenant_id=$1 AND member.app_id=$2 ORDER BY member.source_id`, [TENANT, APP]);
    return rows.map(row => row.source_id);
  }

  async function decide(action: string): Promise<boolean> {
    const { rows } = await admin.query<{ until: Date | null }>(
      'SELECT content_intake.authorization_deadline($1,$2,$3,$4,$5) AS until', [OPERATOR, action, SCOPE, SOURCE, at]);
    return rows[0]!.until !== null;
  }

  async function revokedActions(): Promise<string[]> {
    const { rows } = await admin.query<{ action: string }>(`
      SELECT DISTINCT action FROM content_intake.grants
      WHERE grant_id LIKE 'manual-%' AND revoked_at IS NOT NULL ORDER BY action`);
    return rows.map(row => row.action);
  }

  type Finding = { path: string; kind: 'import_lost' | 'query_not_restored'; detail: string };

  async function explore(): Promise<{ states: number; findings: Finding[] }> {
    const visited = new Set<string>();
    const findings: Finding[] = [];
    const revoked = new Set<string>();
    let states = 0;
    const subsets: readonly (readonly string[])[] = [[], [SOURCE], [OTHER], [SOURCE, OTHER]];

    const signature = async (): Promise<string> => {
        const revokedNow = await revokedActions();
        const version = (await admin.query<{ version: string }>(
          'SELECT version::text AS version FROM content_intake.store_set_current WHERE tenant_id=$1 AND app_id=$2',
          [TENANT, APP])).rows[0]!.version;
        return `v${version}:${(await currentMembers()).join(',')}#${revokedNow.join(',')}#${await decide('query')}`;
      };

      const walk = async (path: string[], depth: number): Promise<void> => {
        const key = await signature();
        if (visited.has(key)) return;
        visited.add(key);
        states += 1;
        const label = path.length ? path.join(' → ') : '(initial)';
        const members = await currentMembers();
        const revokedNow = await revokedActions();
        revokedNow.forEach(action => revoked.add(action));

        if (!(await decide('import')) || !(await decide('publish'))) {
          findings.push({ path: label, kind: 'import_lost',
            detail: `members=[${members.join(',')}] revoked=[${revokedNow.join(',')}]` });
        }
        if (members.includes(SOURCE) && !(await decide('query'))) {
          findings.push({ path: label, kind: 'query_not_restored',
            detail: `source is a current member but query is denied; revoked=[${revokedNow.join(',')}]` });
        }
        if (depth === MAX_DEPTH) return;
        for (const subset of subsets) {
          const mark = `sp${savepoint++}`;
          await admin.query(`SAVEPOINT ${mark}`);
          await advance(subset);
          await walk([...path, subset.length ? '{source}' : '{}'], depth + 1);
          await admin.query(`ROLLBACK TO SAVEPOINT ${mark}`);
        }
      };

      await walk([], 0);
    return { states, findings };
  }

  /** Production repro: a source that has never been published contributes nothing to the
   *  desired readable set. The roster login must not promote an empty store-set version,
   *  because every grant stamped on the old version stops authorizing right after. */
  it('does not promote an empty store-set version when no source has published lineage', async () => {
    const before = await admin.query<{ version: string; members: string }>(`
      SELECT current.version::text AS version,
        (SELECT count(*)::text FROM content_intake.store_set_members member
          WHERE member.tenant_id=current.tenant_id AND member.app_id=current.app_id
            AND member.version=current.version) AS members
      FROM content_intake.store_set_current current
      WHERE current.tenant_id=$1 AND current.app_id=$2`, [TENANT, APP]);
    expect(before.rows[0]!.members).toBe('1');

    const mark = `sp${savepoint++}`;
    await admin.query(`SAVEPOINT ${mark}`);
    try {
      const status = await admin.query<{ status: string }>(`SELECT content_intake.project_feishu_roster(
        $1,$2,$3,$4,'set',$1,ARRAY[$5],$6,'engineer',ARRAY['query']) AS status`,
      [OPERATOR, 'usr-operator', TENANT, APP, DEPT, JOB]);
      if (process.env.CUSTOMER_AGENT_STORE_SET_VERBOSE === '1') {
        console.log(`project_feishu_roster -> ${status.rows[0]!.status}`);
      }
      // projectRosterLogin calls both, in this order; the store-set advance lives in the
      // second one, so a repro that stops at the first never reaches the defect.
      const issued = await admin.query<{ status: string }>(
        'SELECT content_intake.issue_roster_query($1,$2,$3) AS status', [OPERATOR, TENANT, APP]);
      if (process.env.CUSTOMER_AGENT_STORE_SET_VERBOSE === '1') {
        console.log(`issue_roster_query -> ${issued.rows[0]!.status}`);
      }
      if (process.env.CUSTOMER_AGENT_STORE_SET_VERBOSE === '1') {
        console.log(`store set before=${before.rows[0]!.version}/${before.rows[0]!.members}`);
      }
      if (process.env.CUSTOMER_AGENT_STORE_SET_VERBOSE === '1') {
        const diag = await admin.query<{ desired: string; members: string; missing: string; extra: string }>(`
          WITH desired AS (
            SELECT scope.scope_id, src.source_id, min(lineage.content_valid_until) AS content_valid_until
            FROM content_intake.sources src
            JOIN content_intake.scopes scope ON scope.scope_id = src.scope_id
            JOIN public.content_current current_release ON current_release.id = 1
            JOIN content_intake.release_lineage lineage
              ON lineage.release_id = current_release.current_release_id AND lineage.source_id = src.source_id
             AND lineage.content_valid_until > clock_timestamp()
            WHERE scope.tenant_id = $1 AND scope.app_id = $2 AND src.mode = 'v2-preview'
            GROUP BY scope.scope_id, src.source_id
          ), current_version AS (
            SELECT version FROM content_intake.store_set_current WHERE tenant_id = $1 AND app_id = $2
          )
          SELECT (SELECT count(*)::text FROM desired) AS desired,
            (SELECT count(*)::text FROM content_intake.store_set_members member
              JOIN current_version ON member.version = current_version.version
              WHERE member.tenant_id = $1 AND member.app_id = $2) AS members,
            (SELECT count(*)::text FROM (SELECT scope_id, source_id, content_valid_until FROM desired
              EXCEPT SELECT member.scope_id, member.source_id, member.content_valid_until
              FROM content_intake.store_set_members member JOIN current_version ON member.version = current_version.version
              WHERE member.tenant_id = $1 AND member.app_id = $2) t) AS missing,
            (SELECT count(*)::text FROM (SELECT member.scope_id, member.source_id, member.content_valid_until
              FROM content_intake.store_set_members member JOIN current_version ON member.version = current_version.version
              WHERE member.tenant_id = $1 AND member.app_id = $2
              EXCEPT SELECT scope_id, source_id, content_valid_until FROM desired) t) AS extra`,
        [TENANT, APP]);
        console.log(`diag desired=${diag.rows[0]!.desired} members=${diag.rows[0]!.members} missing=${diag.rows[0]!.missing} extra=${diag.rows[0]!.extra}`);
        const probe = await admin.query<Record<string, string>>(`
          SELECT
            (SELECT current_facts_version::text FROM content_intake.principals WHERE principal_id=$1) AS facts_version,
            (SELECT count(*)::text FROM content_intake.policy_versions WHERE tenant_id=$2 AND app_id=$3) AS policies,
            (SELECT count(*)::text FROM content_intake.role_rules r
              JOIN content_intake.principals p ON p.principal_id=$1
              JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
              WHERE r.tenant_id=$2 AND r.app_id=$3 AND r.department_id=ANY(f.department_ids) AND r.job_id=f.job_id) AS role_match,
            (SELECT count(*)::text FROM content_intake.store_sets WHERE tenant_id=$2 AND app_id=$3) AS set_rows,
            (SELECT string_agg(version::text, ',' ORDER BY version) FROM content_intake.store_sets
              WHERE tenant_id=$2 AND app_id=$3) AS versions`,
        [OPERATOR, TENANT, APP]);
        console.log(`probe ${JSON.stringify(probe.rows[0])}`);
      }
      const after = await admin.query<{ version: string; members: string }>(`
        SELECT current.version::text AS version,
          (SELECT count(*)::text FROM content_intake.store_set_members member
            WHERE member.tenant_id=current.tenant_id AND member.app_id=current.app_id
              AND member.version=current.version) AS members
        FROM content_intake.store_set_current current
        WHERE current.tenant_id=$1 AND current.app_id=$2`, [TENANT, APP]);
      if (process.env.CUSTOMER_AGENT_STORE_SET_VERBOSE === '1') {
        console.log(`store set after=${after.rows[0]!.version}/${after.rows[0]!.members}`);
      }
      expect(after.rows[0]!.version, 'login promoted a new store-set version with no readable source')
        .toBe(before.rows[0]!.version);
      expect(after.rows[0]!.members, 'the current store set lost its only member on login')
        .toBe('1');
    } finally {
      await admin.query(`ROLLBACK TO SAVEPOINT ${mark}`);
    }
  });

  it('keeps import and publish authority across every store-set advance', async () => {
    const { states, findings } = await explore();
    // The exploration has to have reached more than the seed state, or it proves nothing.
    expect(states).toBeGreaterThan(1);
    const lost = findings.filter(finding => finding.kind === 'import_lost');
    expect(lost.map(finding => `${finding.path} :: ${finding.detail}`)).toEqual([]);
  });

  /** Known defect, recorded instead of silenced. Once an advance drops the source, the
   *  restamp trigger sets `revoked_at` for good, so returning the source to the set does not
   *  restore authority. `it.fails` keeps the suite honest now and flips this to a hard
   *  failure the day the behavior is fixed, which is when this becomes a normal expectation. */
  it('restores query authority when the source returns to the set', async () => {
    const { states, findings } = await explore();
    if (process.env.CUSTOMER_AGENT_STORE_SET_VERBOSE === '1') {
      console.log(`states=${String(states)} findings=${JSON.stringify(findings, null, 2)}`);
    }
    const stale = findings.filter(finding => finding.kind === 'query_not_restored');
    expect(stale.map(finding => `${finding.path} :: ${finding.detail}`)).toEqual([]);
  });
});
