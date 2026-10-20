import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations, applyMigrationCatalogue } from '../src/runner.js';
import { Pg15Harness } from '../src/testkit/index.js';
import { legacyCheckPredecessorCatalogue, verifyDatabaseMigrations, verifyLegacyCheckPredecessor } from '../src/verifier.js';

// Explicit opt-in keeps the normal package unit command independent of local PG.
// This fixture owns its cluster; no environment database or credentials are used.
describe.runIf(process.env.CUSTOMER_AGENT_DB_PG15_INTEGRATION === '1')('runtime verifier PostgreSQL 15', () => {
  let harness: Pg15Harness;
  let client: Client;
  beforeAll(async () => {
    harness = new Pg15Harness();
    harness.start();
    client = await harness.connect(harness.createDatabase('runtime_verifier').config);
    await applyDatabaseMigrations(client);
  }, 60_000);
  afterAll(async () => { await client?.end(); harness?.stop(); }, 60_000);

  it('verifies the actual 41-migration installation with both new schemas and all 17 sealed roles', async () => {
    expect(await verifyDatabaseMigrations(client)).toMatchObject({
      status: 'PASS', migrationCount: 49,
      inventory: { tables: 108, views: 7, functions: 276 },
      capabilityRoles: { total: 17, safe: 17, memberships: 0 },
    });
  });

  it('accepts separate low-power environment LOGINs with exactly one capability and actual SET ROLE admission', async () => {
    const pairs = [
      ['usage', 'intake_usage'], ['business', 'intake_business'], ['worker', 'intake_worker'],
      ['organization', 'intake_org_writer'], ['directory-key', 'intake_directory_key_operator'],
    ] as const;
    for (let index = 0; index < pairs.length; index += 1) {
      await client.query(`CREATE ROLE runtime_fixture_${index} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT ${pairs[index]![1]} TO runtime_fixture_${index}`);
    }
    try {
      expect((await verifyDatabaseMigrations(client)).status).toBe('PASS');
      const database = (await client.query<{ name: string }>('SELECT current_database() AS name')).rows[0]!.name;
      for (let index = 0; index < pairs.length; index += 1) {
        const connected = await harness.connect({ host: harness.socket, port: harness.port, database, user: `runtime_fixture_${index}` });
        try {
          await connected.query(`SET ROLE ${pairs[index]![1]}`);
          await connected.query('SELECT intake_runtime.assert_purpose($1)', [pairs[index]![0]]);
          await expect(connected.query('SET ROLE intake_runtime_fn_owner')).rejects.toMatchObject({ code: '42501' });
        } finally { await connected.end(); }
      }
    } finally {
      for (let index = 0; index < pairs.length; index += 1) await client.query(`DROP ROLE runtime_fixture_${index}`);
    }
  });

  it.each([
    ['legacy helper removed', 'REVOKE EXECUTE ON FUNCTION public.content_question_hash(jsonb) FROM intake_runtime_fn_owner'],
    ['legacy helper leaked to business', 'GRANT EXECUTE ON FUNCTION public.content_question_hash(jsonb) TO intake_business'],
    ['legacy helper grant option', 'GRANT EXECUTE ON FUNCTION public.content_question_hash(jsonb) TO intake_runtime_fn_owner WITH GRANT OPTION'],
    ['CSV guard removed', 'DROP TRIGGER candidate_format ON content_intake.candidate_versions'],
    ['CSV checker weakened', "CREATE OR REPLACE FUNCTION content_intake.input_format_matches(p_template text,p_rule text,p_mapping text,p_structure text,p_mime text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS 'SELECT true'"],
    ['organization table grant', 'GRANT SELECT ON intake_organization.bindings TO PUBLIC'],
    ['runtime schema grant', 'GRANT USAGE ON SCHEMA intake_runtime TO PUBLIC'],
    ['new organization column', 'ALTER TABLE intake_organization.observations ADD COLUMN injected boolean'],
    ['runtime function security', 'ALTER FUNCTION intake_runtime.assert_purpose(text) SECURITY DEFINER'],
    ['runtime function owner', 'ALTER FUNCTION intake_runtime.assert_purpose(text) OWNER TO intake_usage'],
    ['capability LOGIN', 'ALTER ROLE intake_usage LOGIN'],
    ['capability inheritance', 'ALTER ROLE intake_business INHERIT'],
    ['capability replication', 'ALTER ROLE intake_org_writer REPLICATION'],
    ['capability upper membership', 'GRANT intake_business TO intake_usage'],
    ['function owner member', 'CREATE ROLE runtime_bad LOGIN NOINHERIT; GRANT intake_runtime_fn_owner TO runtime_bad'],
    ['environment INHERIT', 'CREATE ROLE runtime_bad LOGIN INHERIT; GRANT intake_usage TO runtime_bad'],
    ['environment high power', 'CREATE ROLE runtime_bad LOGIN NOINHERIT REPLICATION; GRANT intake_usage TO runtime_bad'],
    ['environment admin option', 'CREATE ROLE runtime_bad LOGIN NOINHERIT; GRANT intake_usage TO runtime_bad WITH ADMIN OPTION'],
    ['environment multiple capabilities', 'CREATE ROLE runtime_bad LOGIN NOINHERIT; GRANT intake_usage,intake_business TO runtime_bad'],
    ['environment unrelated membership', 'CREATE ROLE runtime_bad LOGIN NOINHERIT; CREATE ROLE runtime_extra; GRANT intake_usage,runtime_extra TO runtime_bad'],
    ['NOLOGIN intermediate member', 'CREATE ROLE runtime_bad NOLOGIN NOINHERIT; GRANT intake_usage TO runtime_bad'],
    ['legacy capability membership still sealed', 'CREATE ROLE runtime_bad LOGIN NOINHERIT; GRANT app_runtime TO runtime_bad'],
    ['evidence WHEN predicate', `DROP TRIGGER organization_fact_evidence ON content_intake.principal_facts;
      CREATE CONSTRAINT TRIGGER organization_fact_evidence AFTER INSERT ON content_intake.principal_facts
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (false)
      EXECUTE FUNCTION intake_organization.fact_evidence_required()`],
    ['evidence deferrability', `DROP TRIGGER organization_fact_evidence ON content_intake.principal_facts;
      CREATE CONSTRAINT TRIGGER organization_fact_evidence AFTER INSERT ON content_intake.principal_facts
      NOT DEFERRABLE FOR EACH ROW WHEN (current_user='intake_org_writer')
      EXECUTE FUNCTION intake_organization.fact_evidence_required()`],
  ])('rejects %s drift', async (_name, sql) => {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await expect(verifyDatabaseMigrations(client)).rejects.toMatchObject({ code: 'MIGRATION_VERIFY_FAILED' });
    } finally { await client.query('ROLLBACK'); }
  });

  it('accepts the five production logins and the import-batch trigger flags on the 0035 predecessor', async () => {
    // Roles are cluster-wide. This check needs its own cluster so the 41-migration fixture stays sealed.
    const local = new Pg15Harness();
    let predecessor: Client | undefined;
    try {
      local.start();
      predecessor = await local.connect(local.createDatabase('legacy_predecessor').config);
      await applyMigrationCatalogue(predecessor, legacyCheckPredecessorCatalogue());
      for (const [login, capability, inherit] of [
        ['stack_runtime', 'app_runtime', 'INHERIT'],
        ['stack_content_admin', 'app_content_admin', 'INHERIT'],
        ['stack_backend_auth', 'app_backend_auth', 'NOINHERIT'],
        ['stack_backend_review', 'app_backend_review', 'NOINHERIT'],
        ['stack_backend_worker', 'app_backend_worker', 'NOINHERIT'],
      ] as const) {
        await predecessor.query(`CREATE ROLE ${login} LOGIN ${inherit}`);
        await predecessor.query(`GRANT ${capability} TO ${login}`);
      }
      expect(await verifyLegacyCheckPredecessor(predecessor)).toMatchObject({
        status: 'PASS',
        migrationCount: 34,
        capabilityRoles: { total: 17, safe: 17, memberships: 0 },
        triggerFingerprint: {
          entries: 109,
          sha256: '97259c3711dd67a7b8cab797fe5d667518f9778cf5a1276f17969c060c5e9505',
          difference: 'none',
          disabledTriggers: [],
        },
      });
      await predecessor.query('ALTER TABLE public.import_batches DISABLE TRIGGER backend_review_sync_wait_on_batch_failed');
      await predecessor.query('ALTER TABLE public.import_batches DISABLE TRIGGER import_batches_restore_snapshots');
      expect(await verifyLegacyCheckPredecessor(predecessor)).toMatchObject({
        status: 'PASS',
        capabilityRoles: { memberships: 0 },
        triggerFingerprint: {
          entries: 109,
          sha256: '650390f58729bcd850bc65150f5f5152da7acdb20bb2b0e7a2884e342757bb21',
          frozenSha256: '97259c3711dd67a7b8cab797fe5d667518f9778cf5a1276f17969c060c5e9505',
          difference: 'import_batches_tgenabled',
          disabledTriggers: [
            'backend_review_sync_wait_on_batch_failed',
            'import_batches_restore_snapshots',
          ],
        },
      });
      await predecessor.query('CREATE ROLE runtime_bad LOGIN NOINHERIT');
      await predecessor.query('GRANT app_runtime TO runtime_bad');
      await expect(verifyLegacyCheckPredecessor(predecessor)).rejects.toThrow(/capability role safety/);
    } finally {
      await predecessor?.end();
      local.stop();
    }
  }, 180_000);

  it('accepts the two disabled import-batch triggers on the 112-entry readiness fingerprint and leaves them disabled', async () => {
    const local = new Pg15Harness();
    let readiness: Client | undefined;
    try {
      local.start();
      readiness = await local.connect(local.createDatabase('readiness_disabled_triggers').config);
      await applyDatabaseMigrations(readiness);
      await readiness.query('ALTER TABLE public.import_batches DISABLE TRIGGER backend_review_sync_wait_on_batch_failed');
      await readiness.query('ALTER TABLE public.import_batches DISABLE TRIGGER import_batches_restore_snapshots');
      expect(await verifyDatabaseMigrations(readiness)).toMatchObject({
        status: 'PASS',
        migrationCount: 49,
        triggerFingerprint: {
          entries: 112,
          frozenSha256: '16f2dfb6b2e98e3921d0ad5d452c737d6883723744966535be6b235a0574e28a',
          difference: 'import_batches_tgenabled',
          disabledTriggers: [
            'backend_review_sync_wait_on_batch_failed',
            'import_batches_restore_snapshots',
          ],
        },
      });
      const flags = await readiness.query<{ tgname: string; tgenabled: string }>(
        `SELECT trigger.tgname, trigger.tgenabled::text AS tgenabled
           FROM pg_catalog.pg_trigger trigger
           JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relname = 'import_batches'
            AND NOT trigger.tgisinternal
            AND trigger.tgname IN (
              'backend_review_sync_wait_on_batch_failed',
              'import_batches_restore_snapshots'
            )
          ORDER BY trigger.tgname`,
      );
      expect(flags.rows).toEqual([
        { tgname: 'backend_review_sync_wait_on_batch_failed', tgenabled: 'D' },
        { tgname: 'import_batches_restore_snapshots', tgenabled: 'D' },
      ]);
      await readiness.query('ALTER TABLE content_intake.publications DISABLE TRIGGER publication_family_guard');
      await expect(verifyDatabaseMigrations(readiness)).rejects.toThrow(/exact trigger table\/function\/event\/enabled\/definition manifest/);
    } finally {
      await readiness?.end();
      local.stop();
    }
  }, 180_000);
});
