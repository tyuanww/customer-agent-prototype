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

describe.sequential('PostgreSQL 15 immutable migration gate', () => {
  // Registrar role is intentionally fail-closed on reuse: each test owns its cluster.
  let harness: Pg15Harness;
  beforeEach(() => { harness = new Pg15Harness(); harness.start(); }, 60_000);
  afterEach(() => harness.stop(), 60_000);

  it('installs N from empty, verifies inventory/ACL, exposes stable SQLSTATE, and reruns as a no-op', async () => {
    const database = harness.createDatabase('clean_install');
    const client = await harness.connect(database.config);
    try {
      const fresh = await inspectDatabaseMigrations(client);
      expect(fresh.state).toBe('FRESH');
      expect(fresh.pending).toHaveLength(14);

      const applied = await applyDatabaseMigrations(client);
      expect(applied.before).toBe('FRESH');
      expect(applied.applied.map(({ id }) => id)).toEqual(
        generatedMigrationCatalogue.migrations.map(({ id }) => id),
      );
      expect(applied.after.state).toBe('COMPLETE');

      const report = await verifyDatabaseMigrations(client);
      expect(report).toMatchObject({
        status: 'PASS',
        migrationCount: 14,
        inventory: { tables: 49, views: 2, functions: 181 },
        capabilityRoles: { total: 9, safe: 9, memberships: 0 },
        phase1PolicyHardOff: true,
        compatibility: {
          priorUpgrade: 'SUPPORTED · immutable 9-migration baseline → 5-migration current suffix',
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
      ]);

      const upgraded = await applyDatabaseMigrations(client);
      expect(upgraded.applied.map(({ id }) => id)).toEqual([
        '0010_search_projection_v1_13',
        '0011_search_no_hit_context_v1_14',
        '0012_owner_acceptance_v1_15',
        '0013_backend_identity_content_v1_16',
      '0014_release_deferred_guard_v1_17',
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
        migrationCount: 14,
      });
    } finally {
      await client.end();
    }
  }, 120_000);

  it('upgrades v1.16 with only the deferred guard migration and rejects privilege drift', async () => {
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
      expect(upgraded.applied.map(({ id }) => id)).toEqual(['0014_release_deferred_guard_v1_17']);
      expect((await verifyDatabaseMigrations(client)).status).toBe('PASS');
      await expectSqlState(client, 'SELECT * FROM release_source_bindings', '42501', undefined, 'app_content_admin');
      await expectVerificationFailureAfterMutation(client, 'ALTER FUNCTION public.trg_release_source_set_complete() SECURITY INVOKER');
      await expectVerificationFailureAfterMutation(client, 'GRANT SELECT ON public.release_source_bindings TO app_content_admin');
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
        .toEqual(['0013_backend_identity_content_v1_16', '0014_release_deferred_guard_v1_17']);
      const upgraded = await applyDatabaseMigrations(client);
      expect(upgraded.applied.map(({ id }) => id)).toEqual(['0013_backend_identity_content_v1_16', '0014_release_deferred_guard_v1_17']);
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
      expect(plan.pending.map(({ id }) => id)).toEqual(['0012_owner_acceptance_v1_15', '0013_backend_identity_content_v1_16', '0014_release_deferred_guard_v1_17']);
      await client.query('CREATE ROLE app_owner_acceptance_registrar NOLOGIN');
      await expect(applyDatabaseMigrations(client)).rejects.toMatchObject({ code: 'MIGRATION_APPLY_FAILED' });
      expect((await inspectDatabaseMigrations(client)).applied).toHaveLength(11);
      expect((await client.query("SELECT to_regclass('public.owner_acceptance_records') AS relation")).rows[0].relation).toBeNull();
      await client.query('DROP ROLE app_owner_acceptance_registrar');
      await applyDatabaseMigrations(client);
      expect((await verifyDatabaseMigrations(client)).migrationCount).toBe(14);
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
      expect(pending.pending.map(({ id }) => id)).toEqual(['0011_search_no_hit_context_v1_14', '0012_owner_acceptance_v1_15', '0013_backend_identity_content_v1_16', '0014_release_deferred_guard_v1_17']);

      const upgraded = await applyDatabaseMigrations(client);
      expect(upgraded.applied.map(({ id }) => id)).toEqual(['0011_search_no_hit_context_v1_14', '0012_owner_acceptance_v1_15', '0013_backend_identity_content_v1_16', '0014_release_deferred_guard_v1_17']);
      const afterNoHitContext = await client.query<TextRow>(`
        SELECT pg_get_function_result(
          'public.search_recommendable_scripts(text,text,text)'::regprocedure
        ) AS value
      `);
      expect(afterNoHitContext.rows[0]?.value).toContain('is_candidate boolean');
      await expect(verifyDatabaseMigrations(client)).resolves.toMatchObject({
        status: 'PASS',
        migrationCount: 14,
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
      expect(resumed.applied).toHaveLength(13);
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
      expect(results.map(({ applied }) => applied.length).sort((left, right) => left - right)).toEqual([0, 14]);
      expect(results.every(({ after }) => after.state === 'COMPLETE')).toBe(true);
      const ledger = await firstClient.query<CountRow>(`
        SELECT count(*)::int AS count FROM customer_agent_meta.schema_migrations
      `);
      expect(ledger.rows[0]?.count).toBe(14);
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
