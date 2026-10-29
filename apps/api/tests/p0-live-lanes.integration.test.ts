import { availableParallelism, uptime } from 'node:os';
import type { Client, ClientConfig } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations, applyMigrationPrefix } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { forgetJobSnapshot, rememberJobSnapshot } from '../src/feishu-job-snapshot.js';
import { projectRosterLogin, rosterPrincipalId } from '../src/project-roster-login.js';
import { publishLineage, seedLibrary } from './support/roster-library.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const seat = 'ou_rosterseat01';
const rounds = 5;
const samplesPerRound = 40;

function remember(title: string) {
  rememberJobSnapshot(seat, {
    title,
    directory: [{ name: title, enabled: true }],
    departmentIds: ['dept-a'],
  });
}

async function ensureStoreSet(client: Client): Promise<void> {
  await client.query(`INSERT INTO content_intake.store_sets(
    tenant_id,app_id,version,approved_at,provenance)
    VALUES ('tenant-a','app-a',1,clock_timestamp(),'p0-live-test')
    ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO content_intake.store_set_current(tenant_id,app_id,version)
    VALUES ('tenant-a','app-a',1)
    ON CONFLICT (tenant_id,app_id) DO UPDATE SET version=EXCLUDED.version`);
  await client.query(`INSERT INTO content_intake.store_set_members(
    tenant_id,app_id,version,scope_id,source_id,content_valid_until)
    VALUES ('tenant-a','app-a',1,'scope-a','source-a',clock_timestamp()+interval '1 day')
    ON CONFLICT DO NOTHING`);
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
        statement_timestamp()-interval '1 second',statement_timestamp()+interval '4 minutes',repeat('a',64))`);
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

async function deadline(client: Client, principal: string) {
  return (await client.query<{ until: Date | null }>(
    `SELECT content_intake.authorization_deadline(
      $1,'query','scope-a','source-a',clock_timestamp()) AS until`,
    [principal],
  )).rows[0]?.until ?? null;
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

  it('preserves the historical prefix check that removed role-only query authority', async () => {
    const trunk = await open('lane1_trunk');
    const head = await open('lane1_head');
    await applyMigrationPrefix(trunk, 45);
    await seedEngineer(trunk);
    expect(await deadline(trunk, 'engineer')).not.toBeNull();
    await applyDatabaseMigrations(head);
    await seedEngineer(head);
    expect(await deadline(head, 'engineer')).toBeNull();
  }, 120_000);

  it('records matched Feishu identity facts without issuing a query grant', async () => {
    const client = await open('lane2_manual');
    await seedLibrary(client, false);
    await publishLineage(client);
    await client.query('SET ROLE intake_business');
    remember('客服坐席');
    await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
    await client.query('RESET ROLE');
    expect((await client.query(
      `SELECT 1 FROM content_intake.principal_facts WHERE principal_id=$1`,
      [rosterPrincipalId(seat)],
    )).rowCount).toBe(1);
    expect((await client.query(
      `SELECT 1 FROM content_intake.grants
       WHERE recipient_id=$1 AND kind='business'`,
      [rosterPrincipalId(seat)],
    )).rowCount).toBe(0);
  }, 120_000);

  it('rejects an unknown job without creating principal, facts or grants', async () => {
    const client = await open('lane3_unknown');
    await seedLibrary(client, false);
    await client.query('SET ROLE intake_business');
    remember('服务赋能师');
    await expect(projectRosterLogin(client, seat)).resolves.toBe('unmatched');
    await client.query('RESET ROLE');
    for (const table of ['principals', 'principal_facts', 'grants']) {
      const key = table === 'grants' ? 'recipient_id' : 'principal_id';
      expect((await client.query(
        `SELECT 1 FROM content_intake.${table} WHERE ${key}=$1`,
        [rosterPrincipalId(seat)],
      )).rowCount).toBe(0);
    }
  }, 120_000);

  it('keeps a manual grant across reconnect and does not revive it after revoke', async () => {
    const first = await open('lane4_reconnect');
    await seedLibrary(first, true);
    await publishLineage(first);
    await ensureStoreSet(first);
    remember('客服坐席');
    await first.query('SET ROLE intake_business');
    await expect(projectRosterLogin(first, seat)).resolves.toBe('registered');
    await first.query('RESET ROLE');
    const inserted = await first.query(`INSERT INTO content_intake.grants(
      grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,
      starts_at,expires_at,reason,parent_grant_id,steward_id,policy_version,store_set_version)
      SELECT 'grant-reconnect','business',parent.recipient_id,$1,parent.tenant_id,parent.app_id,
        parent.scope_id,'source-a',parent.action,parent.starts_at,parent.expires_at-interval '1 second',
        '人工查询。',parent.grant_id,parent.recipient_id,policy.version,current_set.version
      FROM content_intake.grants parent
      JOIN content_intake.policy_versions policy
        ON policy.tenant_id=parent.tenant_id AND policy.app_id=parent.app_id
      JOIN content_intake.store_set_current current_set
        ON current_set.tenant_id=parent.tenant_id AND current_set.app_id=parent.app_id
      WHERE parent.grant_id='root-query'`,
    [rosterPrincipalId(seat)]);
    expect(inserted.rowCount, 'manual grant must exist').toBe(1);
    await first.end();

    const second = await reconnect();
    expect(await deadline(second, rosterPrincipalId(seat))).not.toBeNull();
    await second.query(`UPDATE content_intake.grants
      SET version=version+1,last_change_reason='人工撤销。',revoked_at=clock_timestamp()
      WHERE grant_id='grant-reconnect'`);
    await second.query('SET ROLE intake_business');
    await expect(projectRosterLogin(second, seat)).resolves.toBe('registered');
    await second.query('RESET ROLE');
    expect(await deadline(second, rosterPrincipalId(seat))).toBeNull();
  }, 120_000);

  it('measures authorization_deadline across prefix and head without a latency budget', async () => {
    console.log(JSON.stringify({
      claim: '本测量只计本机 Postgres 上 authorization_deadline 的往返。没有约定的 p95 预算。',
      uptimeSeconds: uptime(),
      cores: availableParallelism(),
    }));
    const trunk = await open('perf_trunk');
    const head = await open('perf_head');
    await applyMigrationPrefix(trunk, 45);
    await seedEngineer(trunk);
    await applyDatabaseMigrations(head);
    await seedEngineer(head);
    for (let index = 0; index < 15; index += 1) {
      await deadline(trunk, 'engineer');
      await deadline(head, 'engineer');
    }
    let errors = 0;
    const trunkRounds: number[] = [];
    const headRounds: number[] = [];
    for (let round = 0; round < rounds; round += 1) {
      trunkRounds.push(await sample(trunk, true));
      headRounds.push(await sample(head, false));
    }
    expect(errors).toBe(0);
    console.log(JSON.stringify({
      errors,
      trunkMs: summarize(trunkRounds),
      headMs: summarize(headRounds),
    }));

    async function sample(client: Client, expectOpen: boolean) {
      const elapsed: number[] = [];
      for (let index = 0; index < samplesPerRound; index += 1) {
        const started = performance.now();
        const until = await deadline(client, 'engineer');
        elapsed.push(performance.now() - started);
        if ((until !== null) !== expectOpen) errors += 1;
      }
      return median(elapsed);
    }
  }, 180_000);
});

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function summarize(values: number[]) {
  return {
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    rounds: values,
  };
}
