import { createHash } from 'node:crypto';
import { Pool, type Client, type DatabaseError, type QueryResultRow } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generatedMigrationCatalogue } from '../src/generated/migrations.generated.js';
import { inspectDatabaseMigrations } from '../src/planner.js';
import { applyDatabaseMigrations, applyMigrationCatalogue } from '../src/runner.js';
import type {
  DatabaseQueryClient,
  ExecutableDatabaseMigration,
  ExecutableMigrationCatalogue,
} from '../src/types.js';
import { verifyDatabaseMigrations } from '../src/verifier.js';
import { Pg15Harness } from '../src/testkit/index.js';
import { familyCatalog, type FamilyEntry } from './support/family-catalog.js';

interface CountRow extends QueryResultRow { count: number }
interface TextRow extends QueryResultRow { value: string }

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function expectSqlState(
  client: Client,
  sql: string,
  expectedCode: string,
  expectedDetail?: string,
  role?: string,
): Promise<void> {
  await client.query('BEGIN');
  try {
    if (role) await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(sql);
    throw new Error(`Expected SQLSTATE ${expectedCode}`);
  } catch (error) {
    const databaseError = error as DatabaseError;
    expect(databaseError.code).toBe(expectedCode);
    if (expectedDetail) expect(databaseError.detail).toBe(expectedDetail);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function runAsRole(client: Client, role: string, sql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function syntheticMigration(id: string, sql: string): ExecutableDatabaseMigration {
  const baseline = generatedMigrationCatalogue.migrations[0];
  if (!baseline) throw new Error('Generated migration catalogue has no baseline provenance');
  const normalized = `-- GENERATED FILE. DEV-M0-W4 synthetic transaction rehearsal only.\n${sql.trim()}\n`;
  return Object.freeze({
    position: 2,
    id,
    sha256: sha256(normalized),
    bytes: Buffer.byteLength(normalized),
    contractSetId: baseline.contractSetId,
    sourceGitSha: baseline.sourceGitSha,
    sourceSchemaSha256: baseline.sourceSchemaSha256,
    sourceRanges: Object.freeze([]),
    sql: normalized,
  });
}

function rehearsalCatalogue(second: ExecutableDatabaseMigration): ExecutableMigrationCatalogue {
  const first = generatedMigrationCatalogue.migrations[0];
  if (!first) throw new Error('Generated migration catalogue has no 0001');
  return Object.freeze({
    ...generatedMigrationCatalogue,
    contractSetId: first.contractSetId,
    sourceGitSha: first.sourceGitSha,
    sourceSchemaSha256: first.sourceSchemaSha256,
    compatibility: Object.freeze({ current: 'N', priorSignedBaseline: null, priorReviewedUpgrades: Object.freeze([]) }),
    migrations: Object.freeze([first, second]),
  });
}

function v112BaselineCatalogue(): ExecutableMigrationCatalogue {
  const prior = generatedMigrationCatalogue.compatibility.priorSignedBaseline;
  if (!prior) throw new Error('Generated migration catalogue has no v1.12 baseline');
  return Object.freeze({
    schema: 'customer-agent-database-migrations/v2',
    contractSetId: prior.contractSetId,
    sourceGitSha: prior.sourceGitSha,
    sourceSchemaSha256: prior.sourceSchemaSha256,
    compatibility: Object.freeze({ current: 'N', priorSignedBaseline: null, priorReviewedUpgrades: Object.freeze([]) }),
    migrations: Object.freeze(
      generatedMigrationCatalogue.migrations.slice(0, prior.migrationCount),
    ),
  });
}

function v113ReviewedCatalogue(): ExecutableMigrationCatalogue {
  const prior = generatedMigrationCatalogue.compatibility.priorSignedBaseline;
  const reviewed = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades[0];
  if (!prior || !reviewed) throw new Error('Generated migration catalogue has no v1.13 reviewed upgrade');
  return Object.freeze({
    schema: 'customer-agent-database-migrations/v2',
    contractSetId: reviewed.contractSetId,
    sourceGitSha: reviewed.sourceGitSha,
    sourceSchemaSha256: reviewed.sourceSchemaSha256,
    compatibility: Object.freeze({
      current: 'N',
      priorSignedBaseline: Object.freeze({ ...prior }),
      priorReviewedUpgrades: Object.freeze([]),
    }),
    migrations: Object.freeze(
      generatedMigrationCatalogue.migrations.slice(0, reviewed.migrationCount),
    ),
  });
}

async function expectVerificationFailureAfterMutation(client: Client, sql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await expect(verifyDatabaseMigrations(client)).rejects.toMatchObject({
      code: 'MIGRATION_VERIFY_FAILED',
    });
  } finally {
    await client.query('ROLLBACK');
  }
}

// Reconstruct the exact pre-intake catalogue provenance, including partial
// product overlays; truncating the new catalogue would falsely relabel old SQL.
function frozenIntakePrefix(count: number) {
  const prior=generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.find(p => p.migrationCount >= count)!;
  return {...generatedMigrationCatalogue,...prior,
    compatibility:{...generatedMigrationCatalogue.compatibility,
      priorReviewedUpgrades:generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.filter(p => p.migrationCount < count)},
    migrations:generatedMigrationCatalogue.migrations.slice(0,count)};
}

describe.sequential('PostgreSQL 15 immutable migration gate', () => {
  // Registrar role is intentionally fail-closed on reuse: each test owns its cluster.
  let harness: Pg15Harness;
  beforeEach(() => { harness = new Pg15Harness(); harness.start(); }, 60_000);
  afterEach(() => harness.stop(), 60_000);

  it('upgrades the exact thirty-row ledger with only direct storage and runtime overlays', async () => {
    const database = harness.createDatabase('direct_upgrade'); const client = await harness.connect(database.config);
    try {
      await applyMigrationCatalogue(client, frozenIntakePrefix(30));
      const before = (await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
      expect((await applyDatabaseMigrations(client)).applied.map(m => m.id)).toEqual(['0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations WHERE position<=30 ORDER BY position')).rows).toEqual(before);
      expect((await verifyDatabaseMigrations(client)).status).toBe('PASS');
      for (const role of ['app_runtime','app_content_admin','app_import_worker','app_backend_auth','app_backend_review','app_backend_worker']) {
        await expectSqlState(client, "SELECT content_intake.publish_candidate('synthetic','{}'::jsonb,null)", '42501', undefined, role);
      }
    } finally { await client.end(); }
  });

  it('upgrades the exact 28-row prefix with only the private capacity ledger and no application access', async () => {
    const database=harness.createDatabase('capacity_upgrade');const client=await harness.connect(database.config);
    try {
      await applyMigrationCatalogue(client,frozenIntakePrefix(28));
      const before=await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position');
      expect((await applyDatabaseMigrations(client)).applied.map(m=>m.id)).toEqual(['0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations WHERE position<=28 ORDER BY position')).rows).toEqual(before.rows);
      for(const role of ['app_runtime','app_content_admin','app_import_worker','app_backend_auth','app_backend_review','app_backend_worker']) {
        await expectSqlState(client,'SELECT * FROM content_intake.object_reservations','42501',undefined,role);
      }
      await expectVerificationFailureAfterMutation(client,'GRANT SELECT ON content_intake.object_reservations TO app_runtime');
    } finally {await client.end();}
  });

  it('upgrades the unchanged 27-row prefix and keeps family policy private', async () => {
    const database=harness.createDatabase('family_upgrade'); const client=await harness.connect(database.config);
    try {
      await applyMigrationCatalogue(client,frozenIntakePrefix(27));
      const before=await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position');
      const definition=(await client.query<{definition:string}>("SELECT pg_get_functiondef('content_intake.publish_candidate(text,jsonb,jsonb)'::regprocedure) definition")).rows[0]!.definition;
      await client.query(definition.replace('BEGIN\n','BEGIN\n  -- simulated predecessor drift\n'));
      await expect(applyDatabaseMigrations(client)).rejects.toThrow(/Migration 0028_intake_family failed/);
      expect((await client.query("SELECT to_regprocedure('content_intake.assert_family_catalog(text)') guard")).rows[0].guard).toBeNull();
      await client.query(definition);
      expect((await applyDatabaseMigrations(client)).applied.map(m=>m.id)).toEqual(['0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations WHERE position<=27 ORDER BY position')).rows).toEqual(before.rows);
      for (const role of ['app_runtime','app_content_admin','app_import_worker','app_backend_auth','app_backend_review','app_backend_worker']) {
        await expectSqlState(client,"SELECT content_intake.assert_family_catalog('missing')",'42501',undefined,role);
      }
      await expectVerificationFailureAfterMutation(client,'GRANT EXECUTE ON FUNCTION content_intake.assert_family_catalog(TEXT) TO app_runtime');
      await expectVerificationFailureAfterMutation(client,'ALTER TABLE content_intake.publications DISABLE TRIGGER publication_family_guard');
      await expectVerificationFailureAfterMutation(client,'ALTER FUNCTION content_intake.assert_family_catalog(TEXT) SECURITY DEFINER');
    } finally { await client.end(); }
  });

  it('checks explicit roots and all three applicability dimensions on the complete catalog', async () => {
    const database=harness.createDatabase('family_policy'); const client=await harness.connect(database.config);
    const root:FamilyEntry={source:'brand-source',id:'root'};
    const child:FamilyEntry={source:'shop-source',id:'child',shop:'shop-one',familySourceId:root.source,familyBusinessEntryId:root.id};
    const second:FamilyEntry={...child,source:'other-source',id:'second'};
    const cases:readonly [string,FamilyEntry[],boolean][] = [
      ['root and override',[root,child],true],
      ['same title no relation',[root,{...child,familySourceId:null,familyBusinessEntryId:null},second],true],
      ['two shop overrides',[root,child,second],false],
      ['different shops',[root,child,{...second,shop:'shop-two'}],true],
      ['disjoint products',[root,{...child,products:['p1']},{...second,products:['p2']}],true],
      ['disjoint scenarios',[root,{...child,scenarios:['s1']},{...second,scenarios:['s2']}],true],
      ['wildcard intersects',[root,child,{...second,products:['p2'],scenarios:['s2']}],false],
      ['half-open adjacency',[root,{...child,to:'2026-02-01T00:00:00Z'},{...second,from:'2026-02-01T00:00:00Z'}],true],
      ['brand mandatory',[{...root,brandNonOverridable:true},child],false],
      ['brand mandatory outside products',[{...root,brandNonOverridable:true,products:['p1']},{...child,products:['p2']}],true],
      ['shop cannot mandate',[root,{...child,brandNonOverridable:true}],false],
      ['root missing',[child],false],
      ['root disabled',[{...root,operation:'disable'},child],false],
      ['both disabled tombstones',[{...root,operation:'disable'},{...child,operation:'disable'}],true],
      ['root in other brand',[root,{...child,brand:'other-brand'}],false],
      ['root in other tenant',[root,{...child,tenant:'other-tenant'}],false],
      ['root in other app',[root,{...child,app:'other-app'}],false],
      ['root in other domain',[root,{...child,domain:'campaign'}],false],
      ['root is shop',[{...root,shop:'shop-two'},child],false],
      ['root has parent',[{...root,familySourceId:child.source,familyBusinessEntryId:child.id},child],false],
      ['incomplete key',[root,{...child,familyBusinessEntryId:null}],false],
      ['expired root remains structural',[{...root,to:'2025-02-01T00:00:00Z',from:'2025-01-01T00:00:00Z'},child],true],
    ];
    try {
      await applyDatabaseMigrations(client);
      for (const [label,entries,allowed] of cases) {
        await client.query('BEGIN');
        try {
          await familyCatalog(client,entries);
          const result=client.query("SELECT content_intake.assert_family_catalog('family-release')");
          if (allowed) await expect(result,label).resolves.toMatchObject({rowCount:1});
          else await expect(result,label).rejects.toMatchObject({code:'ZA003',message:'SOURCE_MISMATCH'});
        } finally { await client.query('ROLLBACK'); }
      }
      await client.query('BEGIN');
      try {
        await familyCatalog(client,[root,child]);
        await client.query('SET LOCAL ROLE cs_ai_definer');
        await expect(client.query("SELECT content_intake.inherit_legacy_catalog('family-release','next')"))
          .rejects.toMatchObject({code:'ZA003',message:'legacy publisher cannot inherit explicit family'});
      } finally { await client.query('ROLLBACK'); }
    } finally { await client.end(); }
  });

  it('validates 5000 entries with grouped expansion under a bounded PG budget', async () => {
    const database=harness.createDatabase('family_scale'); const client=await harness.connect(database.config);
    try {
      await applyDatabaseMigrations(client); await client.query('BEGIN');
      try {
        const entries:FamilyEntry[]=[];
        for(let i=0;i<2500;i++) entries.push({source:'brand-source',id:`root-${i}`},
          {source:'shop-source',id:`child-${i}`,shop:'shop-one',familySourceId:'brand-source',familyBusinessEntryId:`root-${i}`});
        await familyCatalog(client,entries);
        // Ten times as many historical entries must not be expanded by the guard.
        await client.query('SET LOCAL session_replication_role=replica');
        await client.query(`INSERT INTO content_intake.candidate_versions(candidate_id,version,source_id,scope_id,source_version,object_id,
          file_sha256,actor_id,base_release_id,canonical_encoding,canonical_material,material,risk,explicit_disable_count,state,created_at,updated_at)
          SELECT candidate_id,historical,source_id,scope_id,source_version,object_id,file_sha256,actor_id,base_release_id,
            canonical_encoding,canonical_material,material,risk,explicit_disable_count,'invalidated',created_at,updated_at
          FROM content_intake.candidate_versions CROSS JOIN generate_series(2,11) historical WHERE version=1`);
        await client.query('SET LOCAL session_replication_role=origin');
        await client.query("SET LOCAL statement_timeout='5s'");
        await expect(client.query("SELECT content_intake.assert_family_catalog('family-release')")).resolves.toMatchObject({rowCount:1});
      } finally { await client.query('ROLLBACK'); }
    } finally { await client.end(); }
  });

  it('keeps fifty usage-page guard checks on 5000 unassociated rows within five seconds', async () => {
    const database=harness.createDatabase('family_unassociated_pages');const client=await harness.connect(database.config);
    try {
      await applyDatabaseMigrations(client);await client.query('BEGIN');
      try {
        await familyCatalog(client,Array.from({length:5000},(_,i)=>({source:'brand-source',id:`entry-${i}`})));
        await client.query("SET LOCAL statement_timeout='5s'");
        // One statement budgets the complete repeated work, rather than granting
        // each page its own five seconds and hiding a fifty-fold regression.
        await expect(client.query(`DO $$ BEGIN FOR page IN 1..50 LOOP
          PERFORM content_intake.assert_family_catalog('family-release');
        END LOOP; END $$`)).resolves.toMatchObject({command:'DO'});
      } finally {await client.query('ROLLBACK');}
    } finally {await client.end();}
  });

  it.each(['products','scenarios','half-open-time'] as const)('validates a dense 5000-entry family with disjoint %s under five seconds', async dimension => {
    const database=harness.createDatabase(`family_dense_${dimension.replaceAll('-','_')}`); const client=await harness.connect(database.config);
    try {
      await applyDatabaseMigrations(client);await client.query('BEGIN');
      try {
        const entries:FamilyEntry[]=[{source:'brand-source',id:'root'}];
        for(let i=0;i<4999;i++) {
          const from=new Date(Date.UTC(2020,0,1)+i*60_000).toISOString(),to=new Date(Date.UTC(2020,0,1)+(i+1)*60_000).toISOString();
          entries.push({source:'shop-source',id:`child-${i}`,shop:'shop-one',familySourceId:'brand-source',familyBusinessEntryId:'root',
            ...(dimension==='products'?{products:[`product-${i}`],scenarios:['common-scenario']}
              :dimension==='scenarios'?{products:['common-product'],scenarios:[`scenario-${i}`]}:{from,to})});
        }
        await familyCatalog(client,entries);
        await client.query("SET LOCAL statement_timeout='5s'");
        await expect(client.query("SELECT content_intake.assert_family_catalog('family-release')")).resolves.toMatchObject({rowCount:1});
      } finally {await client.query('ROLLBACK');}
    } finally {await client.end();}
  });

  it('matches a fixed-seed pairwise applicability oracle across wildcard and interval-chain catalogs', async () => {
    const database=harness.createDatabase('family_oracle');const client=await harness.connect(database.config);
    let seed=0x5eed0028;
    const random=(limit:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
    const terms=(prefix:string)=>Array.from(new Set(Array.from({length:random(4)},()=>`${prefix}-${random(5)}`)));
    const overlaps=(a:FamilyEntry,b:FamilyEntry)=> {
      const intersects=(left:string[]=[],right:string[]=[])=>!left.length||!right.length||left.some(id=>right.includes(id));
      return intersects(a.products,b.products)&&intersects(a.scenarios,b.scenarios)
        && Math.max(Date.parse(a.from??'2026-01-01T00:00:00Z'),Date.parse(b.from??'2026-01-01T00:00:00Z'))
          <Math.min(a.to?Date.parse(a.to):Infinity,b.to?Date.parse(b.to):Infinity);
    };
    const allowed=(rows:FamilyEntry[])=> {
      const active=rows.filter(row=>row.operation!=='disable'&&row.familySourceId);
      return !active.some((a,i)=>{
        const root=rows.find(row=>row.source===a.familySourceId&&row.id===a.familyBusinessEntryId)!;
        return (root.brandNonOverridable&&overlaps(root,a))||active.slice(i+1).some(b=>
          a.familySourceId===b.familySourceId&&a.familyBusinessEntryId===b.familyBusinessEntryId&&a.shop===b.shop&&overlaps(a,b));
      });
    };
    const time=(n:number)=>new Date(Date.UTC(2026,0,1)+n*60_000).toISOString();
    const root:FamilyEntry={source:'brand-source',id:'root'};
    const child=(id:string,from:number,to:number,products:string[],scenarios:string[]):FamilyEntry=>({source:'shop-source',id,shop:'shop-one',
      familySourceId:root.source,familyBusinessEntryId:root.id,from:time(from),to:time(to),products,scenarios});
    // Long A bridges B/C; direct half-open adjacency alone cannot split that component.
    const matrices:FamilyEntry[][]=[
      [root,child('a',0,10,['p1'],[]),child('b',1,2,['p2'],[]),child('c',3,4,['p1'],[])],
      [root,child('a',0,2,[],[]),child('b',2,4,[],[]),child('c',4,6,[],[])],
      [root,child('a',0,10,['p1','p2'],['s1']),child('b',0,10,['p2','p3'],['s2'])],
      [root,child('a',0,10,[],['s1']),child('b',0,10,['p2'],['s1','s2'])],
      [root,child('a',0,10,['p1'],[]),child('b',0,10,[],['s2'])],
    ];
    for(let sample=0;sample<80;sample++) {
      const roots:FamilyEntry[]=[root,{...root,id:'root-two',brandNonOverridable:random(5)===0,products:terms('p'),scenarios:terms('s')}];
      const rows=[...roots];
      for(let n=0;n<2+random(12);n++) {
        const from=random(12),shop=`shop-${random(2)}`;
        rows.push({...child(`row-${n}`,from,from+1+random(8),terms('p'),terms('s')),source:`source-${shop}`,shop,
          familyBusinessEntryId:roots[random(2)]!.id,operation:random(8)===0?'disable':'upsert',...(random(6)===0?{to:null}:{})});
      }
      matrices.push(rows);
    }
    try {
      await applyDatabaseMigrations(client);
      for(const [index,rows] of matrices.entries()) {
        await client.query('BEGIN');
        try {
          await familyCatalog(client,rows);
          const result=client.query("SELECT content_intake.assert_family_catalog('family-release')");
          if(allowed(rows))await expect(result,`seed=0x5eed0028 matrix=${index}`).resolves.toMatchObject({rowCount:1});
          else await expect(result,`seed=0x5eed0028 matrix=${index}`).rejects.toMatchObject({code:'ZA003',message:'SOURCE_MISMATCH'});
        } finally {await client.query('ROLLBACK');}
      }
    } finally {await client.end();}
  });

  it('installs N from empty, verifies inventory/ACL, exposes stable SQLSTATE, and reruns as a no-op', async () => {
    const database = harness.createDatabase('clean_install');
    const client = await harness.connect(database.config);
    try {
      const fresh = await inspectDatabaseMigrations(client);
      expect(fresh.state).toBe('FRESH');
      expect(fresh.pending).toHaveLength(32);

      const applied = await applyDatabaseMigrations(client);
      expect(applied.before).toBe('FRESH');
      expect(applied.applied.map(({ id }) => id)).toEqual(
        generatedMigrationCatalogue.migrations.map(({ id }) => id),
      );
      expect(applied.after.state).toBe('COMPLETE');

      const report = await verifyDatabaseMigrations(client);
      expect(report).toMatchObject({
        status: 'PASS',
        migrationCount: 32,
        inventory: { tables: 86, views: 7, functions: 225 },
        capabilityRoles: { total: 10, safe: 10, memberships: 0 },
        phase1PolicyHardOff: true,
        compatibility: {
          priorUpgrade: 'SUPPORTED · immutable 9-migration baseline → 23-migration current suffix',
        },
      });

      const rerun = await applyDatabaseMigrations(client);
      expect(rerun.before).toBe('COMPLETE');
      expect(rerun.applied).toEqual([]);

      await client.query('CREATE ROLE w4_unprivileged NOLOGIN');
      try {
        await expectSqlState(client, 'CREATE TABLE public.w4_acl_probe(id integer)', '42501', undefined, 'app_runtime');
        await expectSqlState(client, 'UPDATE public.iteration_tasks SET status=status', '42501', undefined, 'app_runtime');
        await expectSqlState(client, 'SELECT * FROM public.release_items LIMIT 1', '42501', undefined, 'app_runtime');
        await expectSqlState(client, 'SELECT * FROM public.v_scripts_recommendable LIMIT 1', '42501', undefined, 'app_runtime');
        await expectSqlState(client, 'SELECT * FROM public.work_order_import_batches LIMIT 1', '42501', undefined, 'app_import_worker');
        await expectSqlState(client, 'SELECT * FROM public.import_batches LIMIT 1', '42501', undefined, 'app_work_order_worker');
        await expectSqlState(client, "SELECT public.outbox_complete('job','worker',1,'done','hash')", '42501', undefined, 'app_import_worker');
        await expectSqlState(client, "SELECT public.publish_content_release('default','release','owner','owner','EVD-W4')", '42501', undefined, 'w4_unprivileged');
      } finally {
        await client.query('DROP ROLE IF EXISTS w4_unprivileged');
      }

      for (const role of ['app_runtime','app_content_admin','app_import_worker','app_backend_auth','app_backend_review','app_backend_worker']) {
        await expectSqlState(client, 'SELECT * FROM content_intake.release_rollback_lineage', '42501', undefined, role);
        await expectSqlState(client, "SELECT content_intake.preview_rollback('actor','base','target')", '42501', undefined, role);
        await expectSqlState(client, "SELECT content_intake.execute_rollback('actor','{}','{}')", '42501', undefined, role);
      }
      await runAsRole(client, 'cs_ai_definer', 'SELECT * FROM content_intake.release_rollback_lineage');
      await expectSqlState(client, 'DELETE FROM content_intake.release_rollback_lineage', '42501', undefined, 'cs_ai_definer');

      await expectSqlState(client, "SELECT public.start_iteration_task('missing',1,'','coach')", 'ZA001', 'VALIDATION');
      await expectSqlState(client, "SELECT public.start_iteration_task('missing',1,'actor','coach')", 'ZA002', 'NOT_FOUND');
      await expectSqlState(client, "SELECT public.start_iteration_task('missing',1,'actor','agent')", 'ZA005', 'FORBIDDEN');
      await expectSqlState(client, "SELECT public.set_policy_flag('rewrite',TRUE,'actor','owner','ADR-W4')", 'ZA004', 'POLICY_DENIED');
      await expectSqlState(client, "SELECT public.idempotency_heartbeat('scope','key','worker',1,60)", 'ZA006', 'IDEMPOTENCY_LEASE_LOST');

      const denialKey = `sda_${'a'.repeat(64)}`;
      const denialCall = (reason: string) => `SELECT public.record_runtime_source_denial_audit(
        '${denialKey}','announce_ack','${reason}','${'b'.repeat(64)}','hmac-v1','agent',NULL,NULL,NULL,'diag_${'c'.repeat(32)}'
      )`;
      await runAsRole(client, 'app_runtime', denialCall('OFFLINE_LEASE_INVALID'));
      await runAsRole(client, 'app_runtime', denialCall('OFFLINE_LEASE_INVALID'));
      await expectSqlState(client, denialCall('OFFLINE_LEASE_EXPIRED'), 'ZA003', 'IDEMPOTENCY_BODY_MISMATCH', 'app_runtime');

      await expectSqlState(
        client,
        "INSERT INTO public.app_users(user_id,role) VALUES ('w4-invalid-role','invalid')",
        '23514',
      );
      await expectSqlState(
        client,
        "INSERT INTO public.privacy_notices(notice_version,notice_text,content_hash,status,published_at) VALUES ('w4-invalid','notice',repeat('a',64),'current',NULL)",
        '23514',
      );

      const locker = await harness.connect(database.config);
      try {
        await locker.query('SELECT pg_advisory_lock($1::integer, $2::integer)', [1_129_531_209, 4]);
        await expect(applyDatabaseMigrations(client, { lockTimeoutMs: 75 })).rejects.toMatchObject({
          code: 'MIGRATION_LOCK_TIMEOUT',
        });
      } finally {
        await locker.query('SELECT pg_advisory_unlock($1::integer, $2::integer)', [1_129_531_209, 4]);
        await locker.end();
      }

      await client.query('BEGIN');
      try {
        await client.query("UPDATE customer_agent_meta.schema_migrations SET migration_sha256=repeat('0',64) WHERE position=1");
        await expect(inspectDatabaseMigrations(client)).rejects.toMatchObject({ code: 'MIGRATION_LEDGER_DRIFT' });
      } finally {
        await client.query('ROLLBACK');
      }
    } finally {
      await client.end();
    }
  }, 180_000);

  it.each([
    { version: 'usage', contractSetId: 'cs-ai-c11-openapi-1.17.0-schema-1.21-53906e302288', sourceGitSha: '53906e302288fe0fb70e58b24a40088ecbbd3ef6' },
    { version: 'quality', contractSetId: 'cs-ai-c11-openapi-1.18.0-schema-1.21-18297cf802b1', sourceGitSha: '18297cf802b195d8ff4e9f625143e50bff169418' },
  ])('upgrades the existing 26-row $version ledger with the rollback and family overlays', async prior => {
    const database = harness.createDatabase(`${prior.version}_wire_only`);
    const client = await harness.connect(database.config);
    try {
      const predecessors = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades;
      const priorIndex = predecessors.findIndex(p => p.contractSetId === prior.contractSetId);
      const oldCatalogue = { ...generatedMigrationCatalogue, migrations: generatedMigrationCatalogue.migrations.slice(0,26), contractSetId: prior.contractSetId,
        sourceGitSha: prior.sourceGitSha, sourceSchemaSha256: '5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013',
        compatibility: { ...generatedMigrationCatalogue.compatibility,
          priorReviewedUpgrades: priorIndex < 0 ? predecessors : predecessors.slice(0, priorIndex) } };
      expect((await applyMigrationCatalogue(client, oldCatalogue)).applied).toHaveLength(26);
      const ledger = (await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
      expect((await inspectDatabaseMigrations(client)).state).toBe('PARTIAL');
      expect((await applyDatabaseMigrations(client)).applied.map(m=>m.id)).toEqual(['0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations WHERE position<=26 ORDER BY position')).rows).toEqual(ledger);
    } finally { await client.end(); }
  }, 60_000);

  it('upgrades an exact v1.12 ledger prefix through the immutable v1.13/v1.14 suffix', async () => {
    const database = harness.createDatabase('upgrade_v1_12_to_v1_14');
    const client = await harness.connect(database.config);
    try {
      const baseline = await applyMigrationCatalogue(client, v112BaselineCatalogue());
      expect(baseline.applied).toHaveLength(9);
      const beforeProjection = await client.query<TextRow>(`
        SELECT pg_get_function_result(
          'public.search_recommendable_scripts(text,text,text)'::regprocedure
        ) AS value
      `);
      expect(beforeProjection.rows[0]?.value).not.toContain('questions jsonb');

      const pending = await inspectDatabaseMigrations(client);
      expect(pending.state).toBe('PARTIAL');
      expect(pending.pending.map(({ id }) => id)).toEqual([
        '0010_search_projection_v1_13',
        '0011_search_no_hit_context_v1_14',
        '0012_owner_acceptance_v1_15',
        '0013_backend_identity_content_v1_16',
      '0014_release_deferred_guard_v1_17',
      '0015_ops_loop_v1_18', '0016_office_owner_publish',
      '0017_rollback_previous_target',
      '0018_owner_read_views',
      '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication',
      ]);

      const upgraded = await applyDatabaseMigrations(client);
      expect(upgraded.applied.map(({ id }) => id)).toEqual([
        '0010_search_projection_v1_13',
        '0011_search_no_hit_context_v1_14',
        '0012_owner_acceptance_v1_15',
        '0013_backend_identity_content_v1_16',
      '0014_release_deferred_guard_v1_17',
      '0015_ops_loop_v1_18', '0016_office_owner_publish',
      '0017_rollback_previous_target',
      '0018_owner_read_views',
      '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication',
      ]);
      const afterProjection = await client.query<TextRow>(`
        SELECT pg_get_function_result(
          'public.search_recommendable_scripts(text,text,text)'::regprocedure
        ) AS value
      `);
      expect(afterProjection.rows[0]?.value).toContain('questions jsonb');
      expect(afterProjection.rows[0]?.value).toContain('is_candidate boolean');
      await expect(verifyDatabaseMigrations(client)).resolves.toMatchObject({
        status: 'PASS',
        migrationCount: 32,
      });
    } finally {
      await client.end();
    }
  }, 120_000);

  it('upgrades v1.16 with the deferred guard and ops-loop migrations and rejects privilege drift', async () => {
    const database = harness.createDatabase('upgrade_closure');
    const client = await harness.connect(database.config);
    try {
      const reviewed = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades[3]!;
      const baseline = { ...v113ReviewedCatalogue(), ...reviewed,
        compatibility: { ...generatedMigrationCatalogue.compatibility,
          priorReviewedUpgrades: generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.slice(0, 3) },
        migrations: generatedMigrationCatalogue.migrations.slice(0, 13) };
      await applyMigrationCatalogue(client, baseline);
      const upgraded = await applyDatabaseMigrations(client);
      expect(upgraded.applied.map(({ id }) => id)).toEqual([
        '0014_release_deferred_guard_v1_17',
        '0015_ops_loop_v1_18', '0016_office_owner_publish',
        '0017_rollback_previous_target',
        '0018_owner_read_views',
        '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication',
      ]);
      expect((await verifyDatabaseMigrations(client)).status).toBe('PASS');
      await expectSqlState(client, 'SELECT * FROM release_source_bindings', '42501', undefined, 'app_content_admin');
      await expectVerificationFailureAfterMutation(client, 'ALTER FUNCTION public.trg_release_source_set_complete() SECURITY INVOKER');
      await expectVerificationFailureAfterMutation(client, 'GRANT SELECT ON public.release_source_bindings TO app_content_admin');
    } finally { await client.end(); }
  });

  it('upgrades the shipped nineteen-migration prefix and keeps P2 storage sealed', async () => {
    const database = harness.createDatabase('upgrade_content_intake');
    const client = await harness.connect(database.config);
    try {
      const reviewed = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades[5]!;
      const baseline = { ...v113ReviewedCatalogue(), ...reviewed,
        compatibility: { ...generatedMigrationCatalogue.compatibility,
          priorReviewedUpgrades: generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.slice(0, 5) },
        migrations: generatedMigrationCatalogue.migrations.slice(0, 19) };
      await applyMigrationCatalogue(client, baseline);
      const before = await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position');
      const upgraded = await applyDatabaseMigrations(client);
      expect(upgraded.applied.map(({ id }) => id)).toEqual(['0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      const after = await client.query('SELECT * FROM customer_agent_meta.schema_migrations WHERE position <= 19 ORDER BY position');
      expect(after.rows).toEqual(before.rows);
      expect((await verifyDatabaseMigrations(client)).status).toBe('PASS');
      for (const role of ['app_runtime', 'app_content_admin', 'app_import_worker', 'app_backend_auth', 'app_backend_review', 'app_backend_worker', 'app_owner_read']) {
        await expectSqlState(client, 'SELECT * FROM content_intake.principals', '42501', undefined, role);
        await expectSqlState(client, "SELECT content_intake.guard_legacy_write('batch',NULL)", '42501', undefined, role);
        await expectSqlState(client, "SELECT content_intake.inherit_legacy_catalog('old','new')", '42501', undefined, role);
      }
      await expectVerificationFailureAfterMutation(client, 'GRANT USAGE ON SCHEMA content_intake TO app_runtime');
      await expectVerificationFailureAfterMutation(client, 'GRANT SELECT ON content_intake.principals TO app_runtime');
      await expectVerificationFailureAfterMutation(client, 'ALTER FUNCTION content_intake.immutable_history() SECURITY DEFINER');
      await expectVerificationFailureAfterMutation(client, 'ALTER TABLE content_intake.principals DISABLE TRIGGER USER');
      // DOMAIN checks live on pg_constraint.contypid, not a table's conrelid.
      // Dropping one must be caught even though the columns keep the same type name.
      await expectSqlState(client, 'SELECT (-1)::content_intake.version', '23514');
      await expectVerificationFailureAfterMutation(client, 'ALTER DOMAIN content_intake.version DROP CONSTRAINT version_check');
      await expectVerificationFailureAfterMutation(client, 'ALTER DOMAIN content_intake.generation SET DEFAULT 1');
      await expectVerificationFailureAfterMutation(client, 'ALTER DOMAIN content_intake.version SET NOT NULL');
      await expectVerificationFailureAfterMutation(client, 'GRANT USAGE ON TYPE content_intake.version TO app_runtime');
    } finally { await client.end(); }
  });

  it('appends discovery and rollback to the exact 25-row ledger and detects index drift', async () => {
    const database = harness.createDatabase('discovery_prefix'), client = await harness.connect(database.config);
    try {
      await applyMigrationCatalogue(client, frozenIntakePrefix(25));
      const before = (await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
      expect((await applyDatabaseMigrations(client)).applied.map(m => m.id)).toEqual(['0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations WHERE position<=25 ORDER BY position')).rows).toEqual(before);
      expect((await verifyDatabaseMigrations(client)).status).toBe('PASS');
      await expectVerificationFailureAfterMutation(client,'DROP INDEX content_intake.grants_recipient_scope_source');
    } finally { await client.end(); }
  });

  it('upgrades the approved 24-row ledger and verifies private context constraints', async () => {
    const database=harness.createDatabase('usage_prefix');const client=await harness.connect(database.config);
    try {
      await applyMigrationCatalogue(client,frozenIntakePrefix(24));
      const before=(await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
      expect((await applyDatabaseMigrations(client)).applied.map(m=>m.id)).toEqual(['0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations WHERE position<=24 ORDER BY position')).rows).toEqual(before);
      expect((await verifyDatabaseMigrations(client)).status).toBe('PASS');
      for(const role of ['app_runtime','app_content_admin','app_import_worker','app_backend_auth','app_backend_review','app_backend_worker','app_owner_read']) {
        await expectSqlState(client,'SELECT * FROM content_intake.entitlement_contexts','42501',undefined,role);
        await expectSqlState(client,"SELECT content_intake.selection_ids_valid(ARRAY[]::text[])",'42501',undefined,role);
      }
      await expectVerificationFailureAfterMutation(client,'ALTER TABLE content_intake.entitlement_contexts DISABLE TRIGGER entitlement_context_binding');
      await expectVerificationFailureAfterMutation(client,'ALTER TABLE content_intake.entitlements DISABLE TRIGGER entitlement_context_required');
      await expectVerificationFailureAfterMutation(client,'ALTER FUNCTION content_intake.entitlement_context_guard() SECURITY DEFINER');
      await expectVerificationFailureAfterMutation(client,'GRANT SELECT ON content_intake.entitlement_contexts TO app_runtime');
    } finally {await client.end();}
  });

  it('appends the native publisher and usage context to the exact 23-row ledger and keeps every application pool sealed', async () => {
    const database=harness.createDatabase('publication_prefix');const client=await harness.connect(database.config);
    try {
      await applyMigrationCatalogue(client,frozenIntakePrefix(23));
      const before=(await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
      expect((await applyDatabaseMigrations(client)).applied.map(m=>m.id)).toEqual(['0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations WHERE position<=23 ORDER BY position')).rows).toEqual(before);
      for (const role of ['app_runtime','app_content_admin','app_import_worker','app_backend_auth','app_backend_review','app_backend_worker']) {
        await expectSqlState(client,"SELECT content_intake.publish_candidate('synthetic','{}','{}')",'42501',undefined,role);
      }
      await expectVerificationFailureAfterMutation(client,'ALTER FUNCTION content_intake.publish_candidate(TEXT,JSONB,JSONB) SECURITY DEFINER');
      await expectVerificationFailureAfterMutation(client,'GRANT EXECUTE ON FUNCTION content_intake.publish_candidate(TEXT,JSONB,JSONB) TO app_runtime');
    } finally { await client.end(); }
  });

  it('appends sealed quality storage without rewriting the 22-row ledger or opening application access', async () => {
    const database = harness.createDatabase('quality_prefix');
    const client = await harness.connect(database.config);
    try {
      await applyMigrationCatalogue(client,frozenIntakePrefix(22));
      const before = (await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
      const upgraded = await applyDatabaseMigrations(client);
      expect(upgraded.applied.map(m => m.id)).toEqual(['0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations WHERE position<=22 ORDER BY position')).rows).toEqual(before);
      for (const role of ['app_runtime','app_content_admin','app_import_worker','app_backend_review','app_backend_worker']) {
        await expectSqlState(client,'SELECT * FROM content_intake.quality_plans','42501',undefined,role);
        await expectSqlState(client,"SELECT content_intake.quality_state('synthetic',1)",'42501',undefined,role);
      }
      await expectVerificationFailureAfterMutation(client,'GRANT SELECT ON content_intake.quality_rounds TO app_runtime');
      await expectVerificationFailureAfterMutation(client,'ALTER TABLE content_intake.quality_rounds DISABLE TRIGGER quality_round_guard');
      await expectVerificationFailureAfterMutation(client,'ALTER FUNCTION content_intake.quality_state(TEXT,BIGINT) SECURITY DEFINER');
    } finally { await client.end(); }
  });

  it.each([false,true])('appends the fence to the exact 21-row ledger; predecessor drift=%s', async drift => {
    const database = harness.createDatabase('fence_prefix');
    const client = await harness.connect(database.config);
    try {
      await applyMigrationCatalogue(client,frozenIntakePrefix(21));
      const before = (await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
      const identities = () => client.query(`SELECT oid,proname,proowner,proacl FROM pg_proc
        WHERE oid IN ('public.publish_content_release(text,text,text,text,text)'::regprocedure,
          'public.rollback_content_release(text,text,text,text,text)'::regprocedure) ORDER BY proname`);
      const functions = (await identities()).rows;
      if (drift) {
        await client.query(`DO $$ DECLARE body TEXT; definition TEXT; BEGIN
          SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc
            WHERE oid='public.publish_content_release(text,text,text,text,text)'::regprocedure;
          EXECUTE replace(definition,body,body || chr(10) || '-- synthetic unexpected edit');
        END $$`);
        await expect(applyDatabaseMigrations(client)).rejects.toThrow(/Migration 0022_intake_legacy_fence failed/);
        expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows).toEqual(before);
        expect((await client.query("SELECT to_regprocedure('content_intake.guard_legacy_write(text,text)') AS helper")).rows[0].helper).toBeNull();
      } else {
        const result = await applyDatabaseMigrations(client);
        expect(result.applied.map(m => m.id)).toEqual(['0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
        expect((await client.query('SELECT * FROM customer_agent_meta.schema_migrations WHERE position<=21 ORDER BY position')).rows).toEqual(before);
        expect((await identities()).rows).toEqual(functions);
      }
    } finally { await client.end(); }
  });

  it('upgrades v1.17 with only the ops-loop migration', async () => {
    const database = harness.createDatabase('upgrade_ops_loop');
    const client = await harness.connect(database.config);
    try {
      const reviewed = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades[4]!;
      const baseline = { ...v113ReviewedCatalogue(), ...reviewed,
        compatibility: { ...generatedMigrationCatalogue.compatibility,
          priorReviewedUpgrades: generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.slice(0, 4) },
        migrations: generatedMigrationCatalogue.migrations.slice(0, 14) };
      await applyMigrationCatalogue(client, baseline);
      const upgraded = await applyDatabaseMigrations(client);
      expect(upgraded.applied.map(({ id }) => id)).toEqual(['0015_ops_loop_v1_18', '0016_office_owner_publish', '0017_rollback_previous_target', '0018_owner_read_views', '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      expect((await verifyDatabaseMigrations(client)).status).toBe('PASS');
      await expectSqlState(client, 'SELECT * FROM ops_loop.inaccuracy_reports', '42501', undefined, 'app_runtime');
    } finally { await client.end(); }
  });

  it('upgrades the exact v1.15 ledger with only the backend migration', async () => {
    const database = harness.createDatabase('upgrade_backend');
    const client = await harness.connect(database.config);
    try {
      const reviewed = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades[2]!;
      const baseline = { ...v113ReviewedCatalogue(), ...reviewed,
        compatibility: { ...generatedMigrationCatalogue.compatibility,
          priorReviewedUpgrades: generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.slice(0, 2) },
        migrations: generatedMigrationCatalogue.migrations.slice(0, 12) };
      await applyMigrationCatalogue(client, baseline);
      expect((await inspectDatabaseMigrations(client)).pending.map(({ id }) => id))
        .toEqual(['0013_backend_identity_content_v1_16', '0014_release_deferred_guard_v1_17', '0015_ops_loop_v1_18', '0016_office_owner_publish', '0017_rollback_previous_target', '0018_owner_read_views', '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      const upgraded = await applyDatabaseMigrations(client);
      expect(upgraded.applied.map(({ id }) => id)).toEqual(['0013_backend_identity_content_v1_16', '0014_release_deferred_guard_v1_17', '0015_ops_loop_v1_18', '0016_office_owner_publish', '0017_rollback_previous_target', '0018_owner_read_views', '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      expect((await verifyDatabaseMigrations(client)).status).toBe('PASS');
      await expectSqlState(client, 'SELECT * FROM backend_identity.sessions', '42501', undefined, 'app_backend_auth');
      await expectSqlState(client, 'SELECT * FROM backend_review.waits', '42501', undefined, 'app_backend_review');
    } finally { await client.end(); }
  });

  it('upgrades v1.14 with only the atomic owner suffix and denies registrar/runtime privilege drift', async () => {
    const database = harness.createDatabase('upgrade_owner');
    const client = await harness.connect(database.config);
    try {
      const reviewed = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades[1]!;
      const baseline = { ...v113ReviewedCatalogue(), ...reviewed,
        compatibility: { ...generatedMigrationCatalogue.compatibility,
          priorReviewedUpgrades: generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.slice(0, 1) },
        migrations: generatedMigrationCatalogue.migrations.slice(0, 11) };
      await applyMigrationCatalogue(client, baseline);
      const plan = await inspectDatabaseMigrations(client);
      expect(plan.pending.map(({ id }) => id)).toEqual(['0012_owner_acceptance_v1_15', '0013_backend_identity_content_v1_16', '0014_release_deferred_guard_v1_17', '0015_ops_loop_v1_18', '0016_office_owner_publish', '0017_rollback_previous_target', '0018_owner_read_views', '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      await client.query('CREATE ROLE app_owner_acceptance_registrar NOLOGIN');
      await expect(applyDatabaseMigrations(client)).rejects.toMatchObject({ code: 'MIGRATION_APPLY_FAILED' });
      expect((await inspectDatabaseMigrations(client)).applied).toHaveLength(11);
      expect((await client.query("SELECT to_regclass('public.owner_acceptance_records') AS relation")).rows[0].relation).toBeNull();
      await client.query('DROP ROLE app_owner_acceptance_registrar');
      await applyDatabaseMigrations(client);
      expect((await verifyDatabaseMigrations(client)).migrationCount).toBe(32);
      await expectSqlState(client, 'SELECT * FROM owner_acceptance_records', '42501', undefined, 'app_runtime');
      await expectSqlState(client, "SELECT register_owner_acceptance('synthetic','{}','bad','bad')", '42501', undefined, 'app_runtime');
      await expectVerificationFailureAfterMutation(client, 'ALTER ROLE app_owner_acceptance_registrar LOGIN');
      await expectVerificationFailureAfterMutation(client, 'ALTER ROLE app_backend_auth LOGIN');
      await expectVerificationFailureAfterMutation(client, 'GRANT SELECT ON backend_identity.sessions TO app_runtime');
      await expectVerificationFailureAfterMutation(client, 'ALTER TABLE backend_identity.sessions DISABLE TRIGGER USER');
      await expectVerificationFailureAfterMutation(client, 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA backend_review TO PUBLIC');
      await expectVerificationFailureAfterMutation(client, 'GRANT app_owner_acceptance_registrar TO app_runtime');
      await expectVerificationFailureAfterMutation(client, 'GRANT SELECT ON owner_acceptance_records TO app_runtime');
      await expectVerificationFailureAfterMutation(client, 'ALTER TABLE release_items DISABLE TRIGGER owner_acceptance_storage_guard');
    } finally { await client.end(); }
  });

  it('upgrades an exact v1.13 ledger prefix with only the immutable v1.14 suffix', async () => {
    const database = harness.createDatabase('upgrade_v1_13_to_v1_14');
    const client = await harness.connect(database.config);
    try {
      const v113 = await applyMigrationCatalogue(client, v113ReviewedCatalogue());
      expect(v113.applied).toHaveLength(10);
      const beforeNoHitContext = await client.query<TextRow>(`
        SELECT pg_get_function_result(
          'public.search_recommendable_scripts(text,text,text)'::regprocedure
        ) AS value
      `);
      expect(beforeNoHitContext.rows[0]?.value).not.toContain('is_candidate boolean');

      const pending = await inspectDatabaseMigrations(client);
      expect(pending.state).toBe('PARTIAL');
      expect(pending.pending.map(({ id }) => id)).toEqual(['0011_search_no_hit_context_v1_14', '0012_owner_acceptance_v1_15', '0013_backend_identity_content_v1_16', '0014_release_deferred_guard_v1_17', '0015_ops_loop_v1_18', '0016_office_owner_publish', '0017_rollback_previous_target', '0018_owner_read_views', '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);

      const upgraded = await applyDatabaseMigrations(client);
      expect(upgraded.applied.map(({ id }) => id)).toEqual(['0011_search_no_hit_context_v1_14', '0012_owner_acceptance_v1_15', '0013_backend_identity_content_v1_16', '0014_release_deferred_guard_v1_17', '0015_ops_loop_v1_18', '0016_office_owner_publish', '0017_rollback_previous_target', '0018_owner_read_views', '0019_candidate_client_snapshot', '0020_coach_publish_v1_19', '0021_content_intake_v1_20', '0022_intake_legacy_fence', '0023_intake_quality', '0024_intake_publication', '0025_intake_usage_v1_21', '0026_intake_discovery_index', '0027_intake_rollback', '0028_intake_family', '0029_intake_capacity', '0030_intake_role_ceiling', '0031_intake_direct_v1_22', '0032_intake_direct_publication']);
      const afterNoHitContext = await client.query<TextRow>(`
        SELECT pg_get_function_result(
          'public.search_recommendable_scripts(text,text,text)'::regprocedure
        ) AS value
      `);
      expect(afterNoHitContext.rows[0]?.value).toContain('is_candidate boolean');
      await expect(verifyDatabaseMigrations(client)).resolves.toMatchObject({
        status: 'PASS',
        migrationCount: 32,
      });
    } finally {
      await client.end();
    }
  }, 120_000);

  it('rolls back an interrupted synthetic backfill and safely retries the same migration id', async () => {
    const database = harness.createDatabase('backfill_retry');
    const client = await harness.connect(database.config);
    try {
      const migration = syntheticMigration('0002_synthetic_backfill', `
        SET LOCAL search_path = public, pg_catalog, pg_temp;
        CREATE TABLE public.w4_synthetic_backfill(id integer PRIMARY KEY, value text NOT NULL);
        INSERT INTO public.w4_synthetic_backfill VALUES (1,'a'),(2,'b'),(3,'c');
        DO $synthetic_retry$
        BEGIN
          IF current_setting('customer_agent.synthetic_failpoint', true) = 'on' THEN
            PERFORM 1 / 0;
          END IF;
        END
        $synthetic_retry$;
      `);
      await client.query("SELECT set_config('customer_agent.synthetic_failpoint','on',false)");
      await expect(applyMigrationCatalogue(client, rehearsalCatalogue(migration))).rejects.toMatchObject({
        code: 'MIGRATION_APPLY_FAILED',
        migrationId: '0002_synthetic_backfill',
        databaseCode: '22012',
      });
      const afterFailure = await client.query<CountRow>(`
        SELECT count(*)::int AS count FROM customer_agent_meta.schema_migrations
      `);
      expect(afterFailure.rows[0]?.count).toBe(1);
      const absent = await client.query<TextRow>(`
        SELECT COALESCE(to_regclass('public.w4_synthetic_backfill')::text, '') AS value
      `);
      expect(absent.rows[0]?.value).toBe('');

      await client.query("SELECT set_config('customer_agent.synthetic_failpoint','off',false)");
      const retried = await applyMigrationCatalogue(client, rehearsalCatalogue(migration));
      expect(retried.applied.map(({ id }) => id)).toEqual(['0002_synthetic_backfill']);
      const reconciliation = await client.query<{ count: number; hash: string } & QueryResultRow>(`
        SELECT count(*)::int AS count,
               encode(digest(string_agg(id::text || ':' || value, ',' ORDER BY id), 'sha256'), 'hex') AS hash
        FROM public.w4_synthetic_backfill
      `);
      expect(reconciliation.rows[0]).toEqual({
        count: 3,
        hash: sha256('1:a,2:b,3:c'),
      });
    } finally {
      await client.end();
    }
  }, 120_000);

  it('keeps DDL and its immutable ledger row atomic when the ledger insert fails', async () => {
    const database = harness.createDatabase('ledger_atomicity');
    const client = await harness.connect(database.config);
    try {
      const migration = syntheticMigration('0002_ledger_atomicity', `
        SET LOCAL search_path = public, pg_catalog, pg_temp;
        CREATE TABLE public.w4_ledger_atomicity(id integer PRIMARY KEY);
        INSERT INTO public.w4_ledger_atomicity VALUES (1);
      `);
      const catalogue = rehearsalCatalogue(migration);
      await applyMigrationCatalogue(client, Object.freeze({
        ...catalogue,
        migrations: Object.freeze([catalogue.migrations[0]!]),
      }));
      await client.query(`
        CREATE FUNCTION customer_agent_meta.reject_second_ledger_row()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.position = 2 THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='synthetic ledger rejection';
          END IF;
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER reject_second_ledger_row
          BEFORE INSERT ON customer_agent_meta.schema_migrations
          FOR EACH ROW EXECUTE FUNCTION customer_agent_meta.reject_second_ledger_row();
      `);

      await expect(applyMigrationCatalogue(client, catalogue)).rejects.toMatchObject({
        code: 'MIGRATION_APPLY_FAILED',
        migrationId: '0002_ledger_atomicity',
        databaseCode: '23514',
      });
      const failedState = await client.query<CountRow>(`
        SELECT count(*)::int AS count FROM customer_agent_meta.schema_migrations
      `);
      expect(failedState.rows[0]?.count).toBe(1);
      const absent = await client.query<TextRow>(`
        SELECT COALESCE(to_regclass('public.w4_ledger_atomicity')::text, '') AS value
      `);
      expect(absent.rows[0]?.value).toBe('');

      await client.query(`
        DROP TRIGGER reject_second_ledger_row ON customer_agent_meta.schema_migrations;
        DROP FUNCTION customer_agent_meta.reject_second_ledger_row();
      `);
      const retried = await applyMigrationCatalogue(client, catalogue);
      expect(retried.applied.map(({ id }) => id)).toEqual(['0002_ledger_atomicity']);
    } finally {
      await client.end();
    }
  }, 120_000);

  it('reconciles an unknown COMMIT acknowledgement from the immutable ledger on a new session', async () => {
    const database = harness.createDatabase('commit_unknown');
    const firstClient = await harness.connect(database.config);
    let disconnected = false;
    const faultClient = {
      query: async (text: string, values?: unknown[]) => {
        if (disconnected) {
          throw Object.assign(new Error('synthetic connection loss'), { code: '08006' });
        }
        const result = await firstClient.query(text, values);
        if (text === 'COMMIT') {
          disconnected = true;
          await firstClient.end();
          throw Object.assign(new Error('synthetic acknowledgement loss after COMMIT'), { code: '08006' });
        }
        return result;
      },
    } as unknown as DatabaseQueryClient;

    await expect(applyMigrationCatalogue(faultClient, generatedMigrationCatalogue)).rejects.toMatchObject({
      code: 'MIGRATION_COMMIT_UNKNOWN',
      migrationId: '0001_extensions',
      databaseCode: '08006',
    });

    const recoveryClient = await harness.connect(database.config);
    try {
      const recovered = await inspectDatabaseMigrations(recoveryClient);
      expect(recovered.state).toBe('PARTIAL');
      expect(recovered.applied.map(({ id }) => id)).toEqual(['0001_extensions']);
      const resumed = await applyDatabaseMigrations(recoveryClient);
      expect(resumed.applied).toHaveLength(generatedMigrationCatalogue.migrations.length - 1);
      expect(resumed.after.state).toBe('COMPLETE');
    } finally {
      await recoveryClient.end();
    }
  }, 120_000);

  it('serializes two independent fresh clients and applies the catalogue exactly once', async () => {
    const database = harness.createDatabase('concurrent_clients');
    const firstClient = await harness.connect(database.config);
    const pool = new Pool({ ...database.config, max: 1 });
    const secondClient = await pool.connect();
    try {
      const results = await Promise.all([
        applyDatabaseMigrations(firstClient),
        applyDatabaseMigrations(secondClient),
      ]);
      expect(results.map(({ applied }) => applied.length).sort((left, right) => left - right)).toEqual([0, 32]);
      expect(results.every(({ after }) => after.state === 'COMPLETE')).toBe(true);
      const ledger = await firstClient.query<CountRow>(`
        SELECT count(*)::int AS count FROM customer_agent_meta.schema_migrations
      `);
      expect(ledger.rows[0]?.count).toBe(32);
    } finally {
      await firstClient.end();
      secondClient.release();
      await pool.end();
    }
  }, 120_000);

  it('rejects concurrent control-plane operations on the same client session', async () => {
    const database = harness.createDatabase('same_client_busy');
    const client = await harness.connect(database.config);
    try {
      const first = applyDatabaseMigrations(client);
      expect(() => applyDatabaseMigrations(client)).toThrowError(
        expect.objectContaining({ code: 'MIGRATION_CLIENT_BUSY' }),
      );
      await expect(first).resolves.toMatchObject({ after: { state: 'COMPLETE' } });
    } finally {
      await client.end();
    }
  }, 120_000);

  it('rejects ACL, function-security, trigger-mode, and policy-key drift by exact manifest', async () => {
    const database = harness.createDatabase('verification_mutations');
    const client = await harness.connect(database.config);
    try {
      await applyDatabaseMigrations(client);
      for (const mutation of [
        'GRANT SELECT ON public.scripts TO PUBLIC',
        'GRANT EXECUTE ON FUNCTION public.rate_limit_take(TEXT,DOUBLE PRECISION,DOUBLE PRECISION,DOUBLE PRECISION) TO PUBLIC',
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC',
        'ALTER TABLE public.scripts OWNER TO app_runtime',
        'ALTER FUNCTION public.rate_limit_take(TEXT,DOUBLE PRECISION,DOUBLE PRECISION,DOUBLE PRECISION) OWNER TO app_runtime',
        'ALTER FUNCTION public.publish_content_release(TEXT,TEXT,TEXT,TEXT,TEXT) RESET ALL',
        `CREATE OR REPLACE FUNCTION public.content_text_array_is_nonblank_unique(p_values TEXT[])
          RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE
          SET search_path = pg_catalog, public, pg_temp AS $$ SELECT TRUE $$`,
        'ALTER TABLE public.release_items ENABLE REPLICA TRIGGER release_items_immutable',
        'ALTER TABLE public.scripts ENABLE ROW LEVEL SECURITY',
        "ALTER TABLE public.app_users ALTER COLUMN display_name SET DEFAULT 'changed'",
        "CREATE TYPE public.w4_untracked_enum AS ENUM ('new')",
        'CREATE SCHEMA w4_untracked_schema',
        "DELETE FROM public.policy_flags WHERE flag_key='rewrite'; INSERT INTO public.policy_flags(flag_key,flag_value) VALUES ('bogus_w4',FALSE)",
      ]) {
        await expectVerificationFailureAfterMutation(client, mutation);
      }
      await expect(verifyDatabaseMigrations(client)).resolves.toMatchObject({ status: 'PASS' });
    } finally {
      await client.end();
    }
  }, 120_000);

  it.each([
    ['table', 'CREATE TABLE public.untracked_table(id integer)'],
    ['enum', "CREATE TYPE public.untracked_state AS ENUM ('new')"],
    ['schema', 'CREATE SCHEMA untracked_namespace'],
  ])('refuses to adopt an untracked database containing a %s', async (label, sql) => {
    const database = harness.createDatabase(`untracked_${label}`);
    const client = await harness.connect(database.config);
    try {
      await client.query(sql);
      await expect(inspectDatabaseMigrations(client)).rejects.toMatchObject({
        code: 'MIGRATION_UNTRACKED_SCHEMA',
      });
    } finally {
      await client.end();
    }
  }, 120_000);
});
