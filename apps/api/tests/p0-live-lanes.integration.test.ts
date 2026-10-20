import { execFileSync } from 'node:child_process';
import type { Client, ClientConfig } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations, applyMigrationPrefix } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { forgetJobSnapshot, rememberJobSnapshot } from '../src/feishu-job-snapshot.js';
import { projectRosterLogin, rosterPreparation, rosterPrincipalId } from '../src/project-roster-login.js';
import { publishLineage, seedLibrary } from './support/roster-library.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const seat = 'ou_rosterseat01';
const rounds = 5;
const samplesPerRound = 40;

function remember(openId: string, title: string) {
  rememberJobSnapshot(openId, { title, directory: [{ name: title, enabled: true }], departmentIds: ['dept-a'] });
}

function applyPrefix(client: Client) {
  return applyMigrationPrefix(client, 45);
}

async function seedEngineer(client: Client) {
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO backend_identity.subject_bindings
      (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ('engineer','synthetic','tenant-a','engineer','user-engineer',repeat('ab',32),true,'owner')`);
    await client.query(`INSERT INTO content_intake.principals
      VALUES ('engineer','user-engineer','tenant-a','app-a','confirmed-synthetic','engineer',1,0)`);
    await client.query(`INSERT INTO content_intake.principal_facts
      VALUES ('engineer',1,ARRAY['dept-a'],'job-engineer',true,
        statement_timestamp()-interval '1 second', statement_timestamp()+interval '4 minutes', repeat('a',64))`);
    await client.query(`INSERT INTO content_intake.role_rules
      VALUES ('tenant-a','app-a','dept-a','job-engineer',1,'engineer')`);
    await client.query(`INSERT INTO content_intake.scopes
      VALUES ('scope-a','tenant-a','app-a','brand-a','shop-a','product')`);
    await client.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode)
      VALUES ('source-a','scope-a',1,'v2-preview')`);
    await client.query(`INSERT INTO content_intake.source_mappings
      VALUES ('source-a',1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function deadline(client: Client, principal: string, action: string) {
  const row = await client.query<{ until: Date | null }>(
    `SELECT content_intake.authorization_deadline($1,$2,'scope-a','source-a',clock_timestamp()) AS until`,
    [principal, action]);
  return row.rows[0]?.until ?? null;
}

async function liveGrants(client: Client) {
  return client.query<{ action: string; parent_grant_id: string | null; issuer_scope: string }>(`
    SELECT g.action, g.parent_grant_id, p.identity_scope AS issuer_scope
    FROM content_intake.grants g
    JOIN content_intake.principals p ON p.principal_id = g.issuer_id
    WHERE g.recipient_id = $1 AND g.kind = 'business' AND g.revoked_at IS NULL
    ORDER BY g.action`, [rosterPrincipalId(seat)]);
}

describe.skipIf(!enabled)('P0 live lanes', () => {
  const clusters: Pg15Harness[] = [];
  const clients: Client[] = [];
  const configs: ClientConfig[] = [];
  afterEach(async () => {
    forgetJobSnapshot(seat);
    for (const client of clients) await client.end().catch(() => undefined);
    for (const cluster of clusters) cluster.stop();
    clients.length = 0;
    clusters.length = 0;
    configs.length = 0;
  }, 60_000);

  async function open(name: string) {
    const harness = new Pg15Harness();
    harness.start();
    clusters.push(harness);
    const database = harness.createDatabase(name);
    configs.push(database.config);
    const client = await harness.connect(database.config);
    clients.push(client);
    return client;
  }

  async function reconnect() {
    const harness = clusters.at(-1);
    const config = configs.at(-1);
    if (!harness || !config) throw new Error('no cluster');
    const client = await harness.connect(config);
    clients.push(client);
    return client;
  }

  it('lane 1 trunk prefix allows an engineer query with no business grant and head does not', async () => {
    const trunk = await open('lane1_trunk');
    const head = await open('lane1_head');
    try {
      await applyPrefix(trunk);
      await seedEngineer(trunk);
      const signer = await trunk.query(`SELECT to_regprocedure('content_intake.issue_roster_query(text,text,text)') AS proc`);
      expect(signer.rows[0]?.proc).toBeNull();
      expect(await deadline(trunk, 'engineer', 'query')).not.toBeNull();
      await applyDatabaseMigrations(head);
      await seedEngineer(head);
      expect(await deadline(head, 'engineer', 'query')).toBeNull();
    } finally {
      await trunk.end();
      await head.end();
    }
  }, 120_000);

  it('lane 2 mapped login records facts and a system issuer', async () => {
    const client = await open('lane2_mapped');
    try {
      await seedLibrary(client, true);
      await publishLineage(client);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('projected');
      await client.query('RESET ROLE');
      const facts = await client.query(`SELECT 1 FROM content_intake.principal_facts WHERE principal_id = $1`, [rosterPrincipalId(seat)]);
      expect(facts.rowCount).toBe(1);
      expect((await liveGrants(client)).rows).toEqual([
        { action: 'query', parent_grant_id: null, issuer_scope: 'content-intake-system' },
      ]);
    } finally { await client.end(); }
  }, 120_000);

  it('lane 3 unknown job creates no principal, facts, or grant', async () => {
    const client = await open('lane3_unknown');
    try {
      await seedLibrary(client);
      await client.query('SET ROLE intake_business');
      remember(seat, '服务赋能师');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('unmatched');
      await client.query('RESET ROLE');
      const people = await client.query(`SELECT count(*)::int AS count FROM content_intake.principals WHERE principal_id = $1`, [rosterPrincipalId(seat)]);
      const facts = await client.query(`SELECT count(*)::int AS count FROM content_intake.principal_facts WHERE principal_id = $1`, [rosterPrincipalId(seat)]);
      const grants = await client.query(`SELECT count(*)::int AS count FROM content_intake.grants WHERE recipient_id = $1`, [rosterPrincipalId(seat)]);
      expect(people.rows[0]?.count).toBe(0);
      expect(facts.rows[0]?.count).toBe(0);
      expect(grants.rows[0]?.count).toBe(0);
    } finally { await client.end(); }
  }, 120_000);

  it('lane 4 an already expired system query grant leaves the deadline empty', async () => {
    const client = await open('lane4_expired');
    try {
      await seedLibrary(client, false);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      await client.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,parent_grant_id)
        SELECT 'grant-expired-query','business',principal_id,$1,'tenant-a','app-a','scope-a','source-a','query',
          clock_timestamp()-interval '1 hour', clock_timestamp()-interval '1 minute','职位名单系统签发。',NULL
        FROM content_intake.principals
        WHERE identity_scope = 'content-intake-system' AND person_key = 'query-signer'`, [rosterPrincipalId(seat)]);
      const stored = await client.query<{ expired: boolean }>(
        `SELECT expires_at < clock_timestamp() AS expired FROM content_intake.grants WHERE grant_id = 'grant-expired-query'`);
      expect(stored.rows[0]?.expired).toBe(true);
      expect(await deadline(client, rosterPrincipalId(seat), 'query')).toBeNull();
    } finally { await client.end(); }
  }, 120_000);

  it('lane 5 revoking the system query grant closes the deadline', async () => {
    const client = await open('lane5_revoked');
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('projected');
      await client.query('RESET ROLE');
      expect(await deadline(client, rosterPrincipalId(seat), 'query')).not.toBeNull();
      await client.query(`UPDATE content_intake.grants
        SET version = version + 1, last_change_reason = '撤销。', revoked_at = clock_timestamp()
        WHERE recipient_id = $1 AND kind = 'business' AND action = 'query' AND revoked_at IS NULL`, [rosterPrincipalId(seat)]);
      expect(await deadline(client, rosterPrincipalId(seat), 'query')).toBeNull();
    } finally { await client.end(); }
  }, 120_000);

  it('lane 6 a matched login with no live allocation still receives the system query', async () => {
    const client = await open('lane6_no_allocation');
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('projected');
      await client.query('RESET ROLE');
      const allocations = await client.query(`SELECT count(*)::int AS count FROM content_intake.grants
        WHERE kind = 'allocation' AND expires_at > clock_timestamp() AND revoked_at IS NULL`);
      expect(allocations.rows[0]?.count).toBe(0);
      expect((await liveGrants(client)).rows).toEqual([
        { action: 'query', parent_grant_id: null, issuer_scope: 'content-intake-system' },
      ]);
    } finally { await client.end(); }
  }, 120_000);

  it('lane 7 no published lineage creates no grant and keeps the fixed sentence', async () => {
    const client = await open('lane7_no_content');
    try {
      await seedLibrary(client, false);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      expect((await liveGrants(client)).rows).toEqual([]);
      expect(rosterPreparation('registered')).toEqual({
        state: 'pending', reason: 'registered', message: '没有权限，请找人开通。',
      });
    } finally { await client.end(); }
  }, 120_000);

  it('lane 8 a query-only principal cannot publish', async () => {
    const client = await open('lane8_publish');
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('projected');
      await client.query('RESET ROLE');
      expect(await deadline(client, rosterPrincipalId(seat), 'publish')).toBeNull();
      await expect(client.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,parent_grant_id)
        SELECT 'grant-publish','business',principal_id,$1,'tenant-a','app-a','scope-a','source-a','publish',
          clock_timestamp(), clock_timestamp()+interval '1 hour','职位名单系统签发。',NULL
        FROM content_intake.principals
        WHERE identity_scope = 'content-intake-system' AND person_key = 'query-signer'`,
      [rosterPrincipalId(seat)])).rejects.toMatchObject({ message: 'GRANT_PARENT_MISMATCH' });
    } finally { await client.end(); }
  }, 120_000);

  it('lane 9 a query-only principal cannot import', async () => {
    const client = await open('lane9_import');
    try {
      await seedLibrary(client, false);
      await publishLineage(client);
      await client.query('SET ROLE intake_business');
      remember(seat, '客服坐席');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('projected');
      await client.query('RESET ROLE');
      expect(await deadline(client, rosterPrincipalId(seat), 'import')).toBeNull();
      await expect(client.query(`
        INSERT INTO content_intake.grants(
          grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,parent_grant_id)
        SELECT 'grant-import','business',principal_id,$1,'tenant-a','app-a','scope-a','source-a','import',
          clock_timestamp(), clock_timestamp()+interval '1 hour','职位名单系统签发。',NULL
        FROM content_intake.principals
        WHERE identity_scope = 'content-intake-system' AND person_key = 'query-signer'`,
      [rosterPrincipalId(seat)])).rejects.toMatchObject({ message: 'GRANT_PARENT_MISMATCH' });
    } finally { await client.end(); }
  }, 120_000);

  it('lane 10 a new connection still sees the database grant', async () => {
    const first = await open('lane10_restart');
    await seedLibrary(first, false);
    await publishLineage(first);
    await first.query('SET ROLE intake_business');
    remember(seat, '客服坐席');
    await expect(projectRosterLogin(first, seat)).resolves.toBe('projected');
    await first.query('RESET ROLE');
    await first.end();
    const second = await reconnect();
    expect((await liveGrants(second)).rows).toEqual([
      { action: 'query', parent_grant_id: null, issuer_scope: 'content-intake-system' },
    ]);
    expect(await deadline(second, rosterPrincipalId(seat), 'query')).not.toBeNull();
  }, 120_000);

  it('measures authorization_deadline on the trunk prefix and the head', async () => {
    const uptime = execFileSync('uptime', { encoding: 'utf8' }).trim();
    const cores = execFileSync('sysctl', ['-n', 'hw.ncpu'], { encoding: 'utf8' }).trim();
    const claim = '本测量只计本机 Postgres 上 authorization_deadline 的往返。没有约定的 p95 预算。预期限制是本地往返。';
    console.log(JSON.stringify({ claim, uptime, cores }));
    const trunk = await open('perf_trunk');
    const head = await open('perf_head');
    let errors = 0;
    const trunkRounds: number[] = [];
    const headRounds: number[] = [];
    try {
      await applyPrefix(trunk);
      await seedEngineer(trunk);
      await applyDatabaseMigrations(head);
      await seedEngineer(head);
      for (let i = 0; i < 15; i += 1) {
        await deadline(trunk, 'engineer', 'query');
        await deadline(head, 'engineer', 'query');
      }
      for (let round = 0; round < rounds; round += 1) {
        trunkRounds.push(await sample(trunk, true));
        headRounds.push(await sample(head, false));
      }
    } finally {
      await trunk.end();
      await head.end();
    }
    console.log(JSON.stringify({
      errors,
      trunkMs: summarize(trunkRounds),
      headMs: summarize(headRounds),
    }));
    expect(errors).toBe(0);

    async function sample(client: Client, expectOpen: boolean) {
      const elapsed: number[] = [];
      for (let i = 0; i < samplesPerRound; i += 1) {
        const started = performance.now();
        const until = await deadline(client, 'engineer', 'query');
        elapsed.push(performance.now() - started);
        if ((until !== null) !== expectOpen) errors += 1;
      }
      return median(elapsed);
    }
  }, 180_000);
});

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

function summarize(values: number[]) {
  return {
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    rounds: values,
  };
}
