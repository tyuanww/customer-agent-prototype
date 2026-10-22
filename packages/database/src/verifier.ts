import { createHash } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { withExclusiveDatabaseClient } from './client.js';
import { databaseDiagnostic, DatabaseMigrationError } from './errors.js';
import { generatedMigrationCatalogue } from './generated/migrations.generated.js';
import { inspectMigrationCatalogue } from './planner.js';
import type { DatabaseClient, DatabaseQueryClient, DatabaseVerificationReport, ExecutableMigrationCatalogue } from './types.js';

interface InventoryRow extends QueryResultRow {
  tables: number;
  views: number;
  functions: number;
  pgcrypto: string | null;
  pg_trgm: string | null;
}

interface RoleRow extends QueryResultRow {
  total: number;
  safe: number;
  memberships: number;
}

interface ManifestRow extends QueryResultRow {
  manifest: string;
  entries: number;
}

interface CommentRow extends QueryResultRow {
  schema_comment: string | null;
}

interface ShapeRow extends QueryResultRow {
  missing_tables: string;
  missing_views: string;
  missing_functions: string;
  missing_function_signatures: string;
  unsafe_view_owners: string;
  search_projection: string;
}

interface SeedRow extends QueryResultRow {
  policy_keys: string[];
  enabled_count: number;
}

const REQUIRED_TABLES = Object.freeze([
  'app_users', 'privacy_notices', 'notice_decisions', 'authoritative_source_versions',
  'authoritative_source_suspensions', 'intent_taxonomy_versions', 'intent_taxonomy_entries',
  'intent_taxonomy_mappings', 'scripts', 'script_questions', 'query_events',
  'semantic_source_assets', 'candidate_impressions', 'adoption_events', 'escalate_actions',
  'iteration_tasks', 'iteration_task_status_audits', 'work_order_import_batches',
  'work_order_records', 'work_order_export_audits', 'change_audits', 'import_batches',
  'content_quality_review_plans', 'content_quality_review_evidence', 'content_review_decisions',
  'import_batch_source_bindings', 'staging_scripts', 'content_releases', 'release_source_bindings',
  'release_items', 'content_current', 'announcements', 'snapshot_offline_leases',
  'source_denial_audits', 'client_sync_state', 'policy_flags', 'idempotency_keys',
  'rate_limit_buckets', 'outbox_jobs', 'rewrite_logs',
  'owner_acceptance_records', 'owner_acceptance_revocations',
  'source_snapshot_revisions',
]);
const REQUIRED_VIEWS = Object.freeze([
  'v_release_source_gate', 'v_scripts_recommendable',
  // 0018 owner read surface. Owned by cs_ai_definer and the only thing app_owner_read
  // may read, so they are part of the verified shape, not an optional extra.
  'vw_owner_asked_questions', 'vw_owner_shown_scripts',
  'vw_owner_unmatched_questions', 'vw_owner_agent_daily',
]);
const REQUIRED_FUNCTION_SIGNATURES = Object.freeze([
  'publish_content_release(text,text,text,text,text)',
  'rollback_content_release(text,text,text,text,text)',
  'enqueue_content_import(text,text,text,text,bigint,jsonb,text,text)',
  'enqueue_work_order_import(text,text,text,text,text,text,bigint,text,timestamp with time zone,timestamp with time zone,text,text)',
  'search_recommendable_scripts(text,text,text)',
  'issue_snapshot_offline_lease(text,text,integer)',
  'validate_snapshot_offline_lease(text,text,text,text)',
  'read_snapshot_page(text,text,text,text,text,integer)',
  'record_source_denial_audit(text,text,text,text,text,text,text,text,text,text)',
  'record_runtime_source_denial_audit(text,text,text,text,text,text,text,text,text,text)',
  'record_admin_source_denial_audit(text,text,text,text,text,text,text,text,text,text)',
  'record_content_review_decision(text,text,text,text,text,text,text,text,timestamp with time zone,text)',
  'freeze_content_quality_review_plan(text,text,bigint,text,text,text,timestamp with time zone,integer,integer,integer,text,text,text,jsonb)',
  'record_content_quality_review_evidence(text,integer,integer,integer,integer,integer,integer,integer,integer,text,text,text)',
  'finalize_content_import_validation(text,text,bigint,text,text,jsonb,jsonb)',
  'finalize_work_order_import_validation(text,text,bigint,text,text,jsonb,integer,jsonb)',
  'record_org_reviewed_quality_evidence(text,text,bigint,text,text,jsonb)',
  'finalize_org_reviewed_import_validation(text,text,bigint,text,jsonb)',
  'advance_source_snapshots(jsonb,text,text,text)',
  'restore_source_snapshots(text)',
  'assert_no_in_flight_content_import(text)',
  'cancel_actor_in_flight_imports(text,text)',
  'trg_restore_snapshots_on_import_failed()',
]);
const REQUIRED_FUNCTIONS = Object.freeze(
  REQUIRED_FUNCTION_SIGNATURES.map((signature) => signature.slice(0, signature.indexOf('('))),
);
const REQUIRED_SCHEMA_COMMENT_FRAGMENTS = Object.freeze([
  'schema.v1.17',
  'synthetic backend development only',
  'runtime activation and production NOT_CERTIFIED',
]);
const REQUIRED_POLICY_KEYS = Object.freeze([
  'auto_send',
  'autofill_adapter',
  'llm_ranker',
  'metrics_experimental_kpi',
  'rewrite',
]);
// 0017_rollback_previous_target adds resolve_previous_content_release; the +1 on each
// manifest below is that one function and its single GRANT to app_content_admin. The
// trigger manifest is unchanged. Recompute all four together when a later overlay lands.
// P2 adds sealed content_intake storage: include its ACL, functions and triggers
// in the same exact manifests, even before any application role is permitted.
//
// 0018_owner_read_views adds the app_owner_read role, four vw_owner_* views, and — the
// part that is easy to miss — SELECT on four base tables for cs_ai_definer. A view runs
// with its owner's privileges, so without those grants selecting the view fails with
// 42501 even when the role holds the view. That is why the ACL entry count moves by more
// than the four views: the definer's new table grants are part of it too.
// 0022 adds five private policy/trigger functions and eight privileges only for cs_ai_definer.
// 0023 adds two sealed quality tables, two private functions and three triggers; ACL stays identical.
// 0024 adds one sealed native publication function, with unchanged ACL and table shapes.
// 0025 adds immutable usage contexts and three private guards; the ACL is unchanged.
// 0026 adds one discovery index and its five columns to the object manifest only.
// 0027 adds a private rollback review lineage, two guards and three private functions.
// The legacy non-login definer receives SELECT on that table only to refuse unsafe inheritance.
// 0028 adds the complete family guard and publication trigger, and grants the
// non-login definer candidate SELECT only to refuse legacy family inheritance.
// 0029 adds the private capacity journal and two accounting indexes, no ACL change.
// 0030 replaces the private authorization_deadline body only. No new table and no application-role ACL.
// 0031 adds immutable policy/confirmation columns, composite foreign keys and shape constraints.
// 0032 replaces five private publishing/lineage functions; ACL and triggers stay identical.
// 0033 adds the approved NOLOGIN runtime capabilities, organization/locked directory
// protocols and the companion ACL after all existing product function bodies.
// The original app_* roles still do not gain content_intake access. Runtime
// LOGIN memberships are checked separately from immutable object ACLs.
// Trigger definitions include WHEN and deferrability: same-transaction organization
// evidence must not be weakened without failing this exact verifier.
// Domain USAGE adds four existing default PUBLIC entries, not schema/table access.
// Their CHECKs and full definitions are separate from table constraints and columns.
// 0034 adds five invoker format functions (default PUBLIC EXECUTE remains
// behind the sealed schema), four INSERT guards, and CSV input constraints.
// No table grants, runtime roles or existing function bodies change.
// 0035 adds exactly eight helper EXECUTEs to the NOLOGIN function owner.
// Objects, function bodies/security attributes and triggers remain unchanged.
// 0036 adds three SOP media tables. Their owner manifest is separate from the
// consumed 0035 prefix, which the legacy CHECK step still verifies.
const EXPECTED_ACL_MANIFEST_ENTRIES = 550;
const EXPECTED_ACL_MANIFEST_SHA256 = '7890fde2f2bf59f2a941aa020864951091a8eef73e8010d869e14054fcefa38d';
const EXPECTED_OBJECT_MANIFEST_ENTRIES = 3090;
const EXPECTED_OBJECT_MANIFEST_SHA256 = 'c31a0c03694ec13c86ba15eb596c6b47c5164335712d839bc53cc0fb40e0de03';
const EXPECTED_SUCCESSOR_TABLES = 100;
const EXPECTED_V127_OBJECT_MANIFEST_ENTRIES = 3213;
const EXPECTED_V127_OBJECT_MANIFEST_SHA256 = '4cb53a4767692dadf2127fbecb12c0f0a37b886880a47c593fdb4e48a8597990';
const EXPECTED_FUNCTION_SECURITY_ENTRIES = 255;
const EXPECTED_FUNCTION_SECURITY_SHA256 = '51ec728928940da3bbd28767d8727727518574d124c24330e64eb5189a38d26b';
const EXPECTED_V127_FUNCTION_SECURITY_ENTRIES = 257;
const EXPECTED_V127_FUNCTION_SECURITY_SHA256 = 'f077ee5d6f3bfb460f7fa2dbf6c503d03723a242404e6b8031a3b7f5b56b1d6b';
const EXPECTED_TRIGGER_MANIFEST_ENTRIES = 109;
const EXPECTED_TRIGGER_MANIFEST_SHA256 = '97259c3711dd67a7b8cab797fe5d667518f9778cf5a1276f17969c060c5e9505';
const READINESS_TRIGGER_ENTRIES = 112;
const READINESS_TRIGGER_SHA256 = '16f2dfb6b2e98e3921d0ad5d452c737d6883723744966535be6b235a0574e28a';
const IMPORT_BATCH_TRIGGER_PREFIXES = Object.freeze([
  'public.import_batches|backend_review_sync_wait_on_batch_failed|backend_review.sync_wait_on_batch_failed()|17|',
  'public.import_batches|import_batches_restore_snapshots|public.trg_restore_snapshots_on_import_failed()|17|',
]);
const READINESS_FORMAT_FUNCTIONS = Object.freeze([
  'content_intake.candidate_format_guard()',
  'content_intake.input_format_matches(text,text,text,text,text)',
  'content_intake.input_object_format_guard()',
  'content_intake.parse_format_guard()',
  'content_intake.source_format_guard()',
]);
const READINESS_PREDICATE_ROLES = Object.freeze(['intake_business', 'intake_worker', 'intake_runtime_fn_owner']);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function explainImportBatchEnablement(manifest: string): Readonly<{ sha256: string; disabledTriggers: readonly string[] }> {
  const disabledTriggers: string[] = [];
  const rewritten = manifest.split('\n').map((entry) => {
    for (const prefix of IMPORT_BATCH_TRIGGER_PREFIXES) {
      const marker = `${prefix}D|definition=`;
      if (!entry.startsWith(marker)) continue;
      disabledTriggers.push(prefix.split('|')[1] ?? prefix);
      return `${prefix}O|definition=${entry.slice(marker.length)}`;
    }
    return entry;
  }).sort().join('\n');
  return Object.freeze({ sha256: sha256(rewritten), disabledTriggers: Object.freeze(disabledTriggers) });
}

async function verifyQuery<Row extends QueryResultRow>(
  client: DatabaseQueryClient,
  sql: string,
  values?: unknown[],
) {
  try {
    return values ? await client.query<Row>(sql, values) : await client.query<Row>(sql);
  } catch (error) {
    const diagnostic = databaseDiagnostic(error);
    throw new DatabaseMigrationError(
      'MIGRATION_VERIFY_FAILED',
      'Database migration verification query failed',
      {
        cause: error,
        ...(diagnostic.code === undefined ? {} : { databaseCode: diagnostic.code }),
        ...(diagnostic.detail === undefined ? {} : { databaseDetail: diagnostic.detail }),
      },
    );
  }
}

async function verifyCatalogueState(
  client: DatabaseQueryClient,
  catalogue: ExecutableMigrationCatalogue,
  expectedAcl: Readonly<{ entries: number; sha256: string }>,
  expectedInventory: Readonly<{ tables: number; functions: number; objectEntries: number; objectSha256: string; functionEntries: number; functionSha256: string; triggerEntries?: number; triggerSha256?: string }> = {
    tables: 97,
    functions: 255,
    objectEntries: EXPECTED_OBJECT_MANIFEST_ENTRIES,
    objectSha256: EXPECTED_OBJECT_MANIFEST_SHA256,
    functionEntries: EXPECTED_FUNCTION_SECURITY_ENTRIES,
    functionSha256: EXPECTED_FUNCTION_SECURITY_SHA256,
  },
  schemaCommentFragments: readonly string[] = REQUIRED_SCHEMA_COMMENT_FRAGMENTS,
): Promise<DatabaseVerificationReport> {
  const migrationStatus = await inspectMigrationCatalogue(client, catalogue);
  if (migrationStatus.state !== 'COMPLETE') {
    throw new DatabaseMigrationError(
      'MIGRATION_VERIFY_FAILED',
      `Database migration ledger is ${migrationStatus.state.toLowerCase()}, not complete`,
    );
  }

  const inventoryResult = await verifyQuery<InventoryRow>(client, `
      SELECT
        (SELECT count(*)::int FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname IN ('public','backend_identity','backend_review','content_intake','intake_organization','intake_runtime') AND relation.relkind IN ('r','p')) AS tables,
        (SELECT count(*)::int FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname IN ('public','backend_identity','backend_review','content_intake','intake_organization','intake_runtime') AND relation.relkind='v') AS views,
        (SELECT count(*)::int FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname IN ('public','backend_identity','backend_review','content_intake','intake_organization','intake_runtime')) AS functions,
        (SELECT extversion FROM pg_catalog.pg_extension WHERE extname='pgcrypto') AS pgcrypto,
        (SELECT extversion FROM pg_catalog.pg_extension WHERE extname='pg_trgm') AS pg_trgm
    `);
  // Fixed capability roles are immutable. Environment LOGIN membership is a
  // separate input: only one direct, non-admin capability grant is permitted,
  // without INHERIT or high-power role attributes. Owners never admit members.
  const roleResult = await verifyQuery<RoleRow>(client, `
    WITH required_roles(name, runtime, permits_environment_member) AS (VALUES
      ('cs_ai_definer',false,false), ('app_runtime',false,false),
      ('app_content_admin',false,false), ('app_import_worker',false,false),
      ('app_work_order_worker',false,false), ('app_owner_acceptance_registrar',false,false),
      ('app_backend_auth',false,false), ('app_backend_review',false,false),
      ('app_backend_worker',false,false), ('app_owner_read',false,false),
      ('intake_runtime_fn_owner',true,false), ('intake_directory_fn_owner',true,false),
      ('intake_usage',true,true), ('intake_business',true,true),
      ('intake_worker',true,true), ('intake_org_writer',true,true),
      ('intake_directory_key_operator',true,true)
    ),
    production_login(member_name, granted_name, must_inherit) AS (VALUES
      ('stack_runtime','app_runtime',true),
      ('stack_content_admin','app_content_admin',true),
      ('stack_backend_auth','app_backend_auth',false),
      ('stack_backend_review','app_backend_review',false),
      ('stack_backend_worker','app_backend_worker',false)
    )
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE NOT role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolcreatedb
        AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls
        AND (NOT required.runtime OR NOT role.rolinherit))::int AS safe,
      (SELECT count(*)::int
       FROM pg_catalog.pg_auth_members membership
       JOIN pg_catalog.pg_roles member_role ON member_role.oid=membership.member
       JOIN pg_catalog.pg_roles granted_role ON granted_role.oid=membership.roleid
       LEFT JOIN required_roles member_required ON member_required.name=member_role.rolname
       LEFT JOIN required_roles granted_required ON granted_required.name=granted_role.rolname
       WHERE (member_required.name IS NOT NULL OR granted_required.name IS NOT NULL)
         AND NOT (member_required.name IS NULL AND COALESCE(granted_required.permits_environment_member,false)
           AND member_role.rolcanlogin AND NOT member_role.rolinherit AND NOT member_role.rolsuper
           AND NOT member_role.rolcreatedb AND NOT member_role.rolcreaterole
           AND NOT member_role.rolreplication AND NOT member_role.rolbypassrls
           AND NOT membership.admin_option
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members extra
             WHERE extra.member=membership.member AND extra.roleid<>membership.roleid))
         AND NOT EXISTS (
           SELECT 1 FROM production_login expected
           WHERE expected.member_name=member_role.rolname
             AND expected.granted_name=granted_role.rolname
             AND member_required.name IS NULL
             AND member_role.rolcanlogin
             AND member_role.rolinherit=expected.must_inherit
             AND NOT member_role.rolsuper
             AND NOT member_role.rolcreatedb
             AND NOT member_role.rolcreaterole
             AND NOT member_role.rolreplication
             AND NOT member_role.rolbypassrls
             AND NOT membership.admin_option
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members extra
               WHERE extra.member=membership.member AND extra.roleid<>membership.roleid))) AS memberships
    FROM required_roles required
    JOIN pg_catalog.pg_roles role ON role.rolname=required.name
  `);
  const aclResult = await verifyQuery<ManifestRow>(client, `
    WITH acl_entries(entry) AS (
      SELECT format(
        'schema|%s|%s|%s|%s',
        namespace.nspname,
        COALESCE(grantee.rolname, 'PUBLIC'),
        acl.privilege_type,
        acl.is_grantable
      )
      FROM pg_catalog.pg_namespace namespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
      ) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
      WHERE namespace.nspname IN ('public','customer_agent_meta','backend_identity','backend_review','content_intake','intake_organization','intake_runtime')
        AND acl.grantee <> namespace.nspowner

      UNION ALL

      SELECT format(
        'relation|%s.%s|%s|%s|%s|%s',
        namespace.nspname,
        relation.relname,
        relation.relkind,
        COALESCE(grantee.rolname, 'PUBLIC'),
        acl.privilege_type,
        acl.is_grantable
      )
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(
        relation.relacl,
        acldefault(
          CASE WHEN relation.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,
          relation.relowner
        )
      )) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
      WHERE namespace.nspname IN ('public','customer_agent_meta','backend_identity','backend_review','content_intake','intake_organization','intake_runtime')
        AND relation.relkind IN ('r','p','v','m','S','f')
        AND acl.grantee <> relation.relowner

      UNION ALL

      SELECT format(
        'column|%s.%s.%s|%s|%s|%s',
        namespace.nspname,
        relation.relname,
        attribute.attname,
        COALESCE(grantee.rolname, 'PUBLIC'),
        acl.privilege_type,
        acl.is_grantable
      )
      FROM pg_catalog.pg_attribute attribute
      JOIN pg_catalog.pg_class relation ON relation.oid=attribute.attrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
      CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
      WHERE namespace.nspname IN ('public','customer_agent_meta','backend_identity','backend_review','content_intake','intake_organization','intake_runtime')
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND acl.grantee <> relation.relowner

      UNION ALL

      SELECT format(
        'function|%s.%s(%s)|%s|%s|%s',
        namespace.nspname,
        procedure.proname,
        pg_get_function_identity_arguments(procedure.oid),
        COALESCE(grantee.rolname, 'PUBLIC'),
        acl.privilege_type,
        acl.is_grantable
      )
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
      WHERE namespace.nspname IN ('public','customer_agent_meta','backend_identity','backend_review','content_intake','intake_organization','intake_runtime')
        AND acl.grantee <> procedure.proowner

      UNION ALL

      SELECT format(
        'domain|%s.%s|%s|%s|%s',
        namespace.nspname,
        type_object.typname,
        COALESCE(grantee.rolname, 'PUBLIC'),
        acl.privilege_type,
        acl.is_grantable
      )
      FROM pg_catalog.pg_type type_object
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=type_object.typnamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(type_object.typacl, acldefault('T', type_object.typowner))
      ) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
      WHERE namespace.nspname IN ('public','customer_agent_meta','backend_identity','backend_review','content_intake','intake_organization','intake_runtime')
        AND type_object.typtype='d' AND acl.grantee <> type_object.typowner

      UNION ALL

      SELECT format(
        'default|owner=%s|schema=%s|type=%s|grantee=%s|%s|%s',
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END,
        COALESCE(namespace.nspname, '<global>'),
        default_acl.defaclobjtype,
        COALESCE(grantee.rolname, 'PUBLIC'),
        acl.privilege_type,
        acl.is_grantable
      )
      FROM pg_catalog.pg_default_acl default_acl
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=default_acl.defaclrole
      LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.oid=default_acl.defaclnamespace
      CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
    )
    SELECT
      COALESCE(string_agg(entry, E'\\n' ORDER BY entry), '') AS manifest,
      count(*)::int AS entries
    FROM acl_entries
  `);
  const objectResult = await verifyQuery<ManifestRow>(client, `
    WITH user_namespaces AS (
      SELECT namespace.oid, namespace.nspname, namespace.nspowner
      FROM pg_catalog.pg_namespace namespace
      WHERE namespace.nspname NOT IN ('pg_catalog','information_schema')
        AND namespace.nspname !~ '^pg_(toast|temp)(_|$)'
    ), object_entries(entry) AS (
      SELECT format(
        'schema|%s|owner=%s',
        namespace.nspname,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM user_namespaces namespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=namespace.nspowner

      UNION ALL

      SELECT format(
        'relation|%s.%s|kind=%s|persistence=%s|rls=%s|force_rls=%s|replica_identity=%s|owner=%s|definition=%s',
        namespace.nspname,
        relation.relname,
        relation.relkind,
        relation.relpersistence,
        relation.relrowsecurity,
        relation.relforcerowsecurity,
        relation.relreplident,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END,
        CASE
          WHEN relation.relkind IN ('v','m') THEN pg_catalog.pg_get_viewdef(relation.oid, false)
          WHEN relation.relkind IN ('i','I') THEN pg_catalog.pg_get_indexdef(relation.oid)
          ELSE ''
        END
      )
      FROM pg_catalog.pg_class relation
      JOIN user_namespaces namespace ON namespace.oid=relation.relnamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=relation.relowner

      UNION ALL

      SELECT format(
        'column|%s.%s.%s|number=%s|type=%s|not_null=%s|identity=%s|generated=%s|collation=%s|default=%s',
        namespace.nspname,
        relation.relname,
        attribute.attname,
        attribute.attnum,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
        attribute.attnotnull,
        attribute.attidentity,
        attribute.attgenerated,
        COALESCE(collation_object.collname, '<default>'),
        COALESCE(pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid), '<none>')
      )
      FROM pg_catalog.pg_attribute attribute
      JOIN pg_catalog.pg_class relation ON relation.oid=attribute.attrelid
      JOIN user_namespaces namespace ON namespace.oid=relation.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef attribute_default
        ON attribute_default.adrelid=attribute.attrelid AND attribute_default.adnum=attribute.attnum
      LEFT JOIN pg_catalog.pg_collation collation_object ON collation_object.oid=attribute.attcollation
      WHERE attribute.attnum > 0 AND NOT attribute.attisdropped

      UNION ALL

      SELECT format(
        'constraint|%s.%s.%s|type=%s|deferrable=%s|deferred=%s|validated=%s|definition=%s',
        namespace.nspname,
        relation.relname,
        constraint_object.conname,
        constraint_object.contype,
        constraint_object.condeferrable,
        constraint_object.condeferred,
        constraint_object.convalidated,
        pg_catalog.pg_get_constraintdef(constraint_object.oid, false)
      )
      FROM pg_catalog.pg_constraint constraint_object
      JOIN pg_catalog.pg_class relation ON relation.oid=constraint_object.conrelid
      JOIN user_namespaces namespace ON namespace.oid=relation.relnamespace

      UNION ALL

      -- DOMAIN constraints have conrelid=0; table constraints cannot cover them.
      SELECT format(
        'domain_constraint|%s.%s.%s|type=%s|validated=%s|definition=%s',
        namespace.nspname,
        type_object.typname,
        constraint_object.conname,
        constraint_object.contype,
        constraint_object.convalidated,
        pg_catalog.pg_get_constraintdef(constraint_object.oid, false)
      )
      FROM pg_catalog.pg_constraint constraint_object
      JOIN pg_catalog.pg_type type_object ON type_object.oid=constraint_object.contypid
      JOIN user_namespaces namespace ON namespace.oid=type_object.typnamespace

      UNION ALL

      SELECT format(
        'domain|%s.%s|base=%s|not_null=%s|collation=%s|default=%s',
        namespace.nspname,
        type_object.typname,
        pg_catalog.format_type(type_object.typbasetype, type_object.typtypmod),
        type_object.typnotnull,
        COALESCE(collation_namespace.nspname || '.' || collation_object.collname, '<none>'),
        COALESCE(pg_catalog.pg_get_expr(type_object.typdefaultbin, 0), '<none>')
      )
      FROM pg_catalog.pg_type type_object
      JOIN user_namespaces namespace ON namespace.oid=type_object.typnamespace
      LEFT JOIN pg_catalog.pg_collation collation_object ON collation_object.oid=type_object.typcollation
      LEFT JOIN pg_catalog.pg_namespace collation_namespace ON collation_namespace.oid=collation_object.collnamespace
      WHERE type_object.typtype='d'

      UNION ALL

      SELECT format(
        'sequence|%s.%s|start=%s|increment=%s|min=%s|max=%s|cache=%s|cycle=%s',
        namespace.nspname,
        relation.relname,
        sequence_object.seqstart,
        sequence_object.seqincrement,
        sequence_object.seqmin,
        sequence_object.seqmax,
        sequence_object.seqcache,
        sequence_object.seqcycle
      )
      FROM pg_catalog.pg_sequence sequence_object
      JOIN pg_catalog.pg_class relation ON relation.oid=sequence_object.seqrelid
      JOIN user_namespaces namespace ON namespace.oid=relation.relnamespace

      UNION ALL

      SELECT format(
        'policy|%s.%s.%s|permissive=%s|command=%s|roles=%s|using=%s|check=%s',
        namespace.nspname,
        relation.relname,
        row_policy.polname,
        row_policy.polpermissive,
        row_policy.polcmd,
        COALESCE(policy_roles.roles, ''),
        COALESCE(pg_catalog.pg_get_expr(row_policy.polqual, row_policy.polrelid), ''),
        COALESCE(pg_catalog.pg_get_expr(row_policy.polwithcheck, row_policy.polrelid), '')
      )
      FROM pg_catalog.pg_policy row_policy
      JOIN pg_catalog.pg_class relation ON relation.oid=row_policy.polrelid
      JOIN user_namespaces namespace ON namespace.oid=relation.relnamespace
      CROSS JOIN LATERAL (
        SELECT string_agg(COALESCE(role.rolname, 'PUBLIC'), ',' ORDER BY COALESCE(role.rolname, 'PUBLIC')) AS roles
        FROM unnest(row_policy.polroles::oid[]) role_id(oid)
        LEFT JOIN pg_catalog.pg_roles role ON role.oid=role_id.oid
      ) policy_roles

      UNION ALL

      SELECT format(
        'function|%s.%s(%s)|kind=%s|owner=%s',
        namespace.nspname,
        procedure.proname,
        pg_get_function_identity_arguments(procedure.oid),
        procedure.prokind,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_proc procedure
      JOIN user_namespaces namespace ON namespace.oid=procedure.pronamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=procedure.proowner

      UNION ALL

      SELECT format(
        'type|%s.%s|kind=%s|category=%s|owner=%s',
        namespace.nspname,
        type_object.typname,
        type_object.typtype,
        type_object.typcategory,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_type type_object
      JOIN user_namespaces namespace ON namespace.oid=type_object.typnamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=type_object.typowner

      UNION ALL

      SELECT format(
        'operator|%s.%s(%s,%s)|owner=%s',
        namespace.nspname,
        operator_object.oprname,
        pg_catalog.format_type(operator_object.oprleft, NULL),
        pg_catalog.format_type(operator_object.oprright, NULL),
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_operator operator_object
      JOIN user_namespaces namespace ON namespace.oid=operator_object.oprnamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=operator_object.oprowner

      UNION ALL

      SELECT format(
        'collation|%s.%s|provider=%s|deterministic=%s|owner=%s',
        namespace.nspname,
        collation_object.collname,
        collation_object.collprovider,
        collation_object.collisdeterministic,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_collation collation_object
      JOIN user_namespaces namespace ON namespace.oid=collation_object.collnamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=collation_object.collowner

      UNION ALL

      SELECT format(
        'conversion|%s.%s|owner=%s',
        namespace.nspname,
        conversion_object.conname,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_conversion conversion_object
      JOIN user_namespaces namespace ON namespace.oid=conversion_object.connamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=conversion_object.conowner

      UNION ALL

      SELECT format(
        'statistics|%s.%s|kind=%s|owner=%s',
        namespace.nspname,
        statistic_object.stxname,
        array_to_string(statistic_object.stxkind, ','),
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_statistic_ext statistic_object
      JOIN user_namespaces namespace ON namespace.oid=statistic_object.stxnamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=statistic_object.stxowner

      UNION ALL

      SELECT format(
        'extension|%s|version=%s|schema=%s|relocatable=%s|owner=%s',
        extension.extname,
        extension.extversion,
        namespace.nspname,
        extension.extrelocatable,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_extension extension
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=extension.extnamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=extension.extowner
      WHERE extension.extname <> 'plpgsql'

      UNION ALL

      SELECT format(
        'event_trigger|%s|event=%s|enabled=%s|function=%s|owner=%s',
        event_trigger.evtname,
        event_trigger.evtevent,
        event_trigger.evtenabled,
        event_trigger.evtfoid::regprocedure::text,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_event_trigger event_trigger
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=event_trigger.evtowner

      UNION ALL

      SELECT format(
        'publication|%s|all=%s|insert=%s|update=%s|delete=%s|truncate=%s|via_root=%s|owner=%s',
        publication.pubname,
        publication.puballtables,
        publication.pubinsert,
        publication.pubupdate,
        publication.pubdelete,
        publication.pubtruncate,
        publication.pubviaroot,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_publication publication
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=publication.pubowner

      UNION ALL

      SELECT format(
        'fdw|%s|owner=%s',
        wrapper.fdwname,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_foreign_data_wrapper wrapper
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=wrapper.fdwowner

      UNION ALL

      SELECT format(
        'server|%s|fdw=%s|owner=%s',
        server.srvname,
        wrapper.fdwname,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_foreign_server server
      JOIN pg_catalog.pg_foreign_data_wrapper wrapper ON wrapper.oid=server.srvfdw
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=server.srvowner

      UNION ALL

      SELECT format(
        'cast|%s->%s|context=%s|method=%s',
        pg_catalog.format_type(cast_object.castsource, NULL),
        pg_catalog.format_type(cast_object.casttarget, NULL),
        cast_object.castcontext,
        cast_object.castmethod
      )
      FROM pg_catalog.pg_cast cast_object
      WHERE cast_object.oid >= 16384

      UNION ALL

      SELECT format(
        'language|%s|trusted=%s|owner=%s',
        language_object.lanname,
        language_object.lanpltrusted,
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END
      )
      FROM pg_catalog.pg_language language_object
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=language_object.lanowner
      WHERE language_object.lanname NOT IN ('internal','c','sql','plpgsql')
    )
    SELECT
      COALESCE(string_agg(entry, E'\\n' ORDER BY entry), '') AS manifest,
      count(*)::int AS entries
    FROM object_entries
  `);
  const functionSecurityResult = await verifyQuery<ManifestRow>(client, `
    WITH function_entries(entry) AS (
      SELECT format(
        '%s.%s(%s)|owner=%s|returns=%s|language=%s|kind=%s|security_definer=%s|leakproof=%s|strict=%s|volatility=%s|parallel=%s|config=%s|defaults=%s|binary=%s|source=%s',
        namespace.nspname,
        procedure.proname,
        pg_get_function_identity_arguments(procedure.oid),
        CASE WHEN owner_role.rolname=current_user THEN '<migration_owner>' ELSE owner_role.rolname END,
        pg_catalog.format_type(procedure.prorettype, NULL),
        language_object.lanname,
        procedure.prokind,
        procedure.prosecdef,
        procedure.proleakproof,
        procedure.proisstrict,
        procedure.provolatile,
        procedure.proparallel,
        COALESCE(array_to_string(procedure.proconfig, ','), '<null>'),
        COALESCE(pg_catalog.pg_get_expr(procedure.proargdefaults, 0), '<none>'),
        COALESCE(procedure.probin, '<null>'),
        procedure.prosrc
      )
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=procedure.proowner
      JOIN pg_catalog.pg_language language_object ON language_object.oid=procedure.prolang
      WHERE namespace.nspname IN ('public','backend_identity','backend_review','content_intake','intake_organization','intake_runtime')
    )
    SELECT
      COALESCE(string_agg(entry, E'\\n' ORDER BY entry), '') AS manifest,
      count(*)::int AS entries
    FROM function_entries
  `);
  const triggerResult = await verifyQuery<ManifestRow>(client, `
    WITH trigger_entries(entry) AS (
      SELECT format(
        '%s.%s|%s|%s.%s(%s)|%s|%s|definition=%s',
        table_namespace.nspname,
        relation.relname,
        trigger.tgname,
        function_namespace.nspname,
        procedure.proname,
        pg_get_function_identity_arguments(procedure.oid),
        trigger.tgtype,
        trigger.tgenabled,
        pg_catalog.pg_get_triggerdef(trigger.oid, false)
      )
      FROM pg_catalog.pg_trigger trigger
      JOIN pg_catalog.pg_class relation ON relation.oid=trigger.tgrelid
      JOIN pg_catalog.pg_namespace table_namespace ON table_namespace.oid=relation.relnamespace
      JOIN pg_catalog.pg_proc procedure ON procedure.oid=trigger.tgfoid
      JOIN pg_catalog.pg_namespace function_namespace ON function_namespace.oid=procedure.pronamespace
      WHERE table_namespace.nspname IN ('public','backend_identity','backend_review','content_intake','intake_organization','intake_runtime') AND NOT trigger.tgisinternal
    )
    SELECT
      COALESCE(string_agg(entry, E'\\n' ORDER BY entry), '') AS manifest,
      count(*)::int AS entries
    FROM trigger_entries
  `);
  const commentResult = await verifyQuery<CommentRow>(client, `
      SELECT obj_description('public'::regnamespace, 'pg_namespace') AS schema_comment
    `);
  const shapeResult = await verifyQuery<ShapeRow>(client, `
    SELECT
      (SELECT coalesce(string_agg(name, ',' ORDER BY name), '')
         FROM unnest($1::text[]) required(name)
        WHERE to_regclass('public.' || name) IS NULL) AS missing_tables,
      (SELECT coalesce(string_agg(name, ',' ORDER BY name), '')
         FROM unnest($2::text[]) required(name)
        WHERE to_regclass('public.' || name) IS NULL) AS missing_views,
      (SELECT coalesce(string_agg(name, ',' ORDER BY name), '')
         FROM unnest($3::text[]) required(name)
        WHERE NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_proc procedure
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
          WHERE namespace.nspname='public' AND procedure.proname=required.name
        )) AS missing_functions,
      (SELECT coalesce(string_agg(signature, ',' ORDER BY signature), '')
         FROM unnest($4::text[]) required(signature)
        WHERE to_regprocedure('public.' || signature) IS NULL) AS missing_function_signatures,
      (SELECT coalesce(string_agg(name, ',' ORDER BY name), '')
         FROM unnest($2::text[]) required(name)
         JOIN pg_catalog.pg_class relation ON relation.oid=to_regclass('public.' || required.name)
         JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=relation.relowner
        WHERE owner_role.rolname <> 'cs_ai_definer') AS unsafe_view_owners,
      pg_get_function_result(
        'public.search_recommendable_scripts(text,text,text)'::regprocedure
      ) AS search_projection
  `, [
    [...REQUIRED_TABLES],
    [...REQUIRED_VIEWS],
    [...REQUIRED_FUNCTIONS],
    [...REQUIRED_FUNCTION_SIGNATURES],
  ]);
  const seedResult = await verifyQuery<SeedRow>(client, `
    SELECT
      array_agg(flag_key ORDER BY flag_key) AS policy_keys,
      count(*) FILTER (WHERE flag_value)::int AS enabled_count
    FROM public.policy_flags
  `);

  const inventory = inventoryResult.rows[0];
  const roles = roleResult.rows[0];
  const acl = aclResult.rows[0];
  const objects = objectResult.rows[0];
  const functionSecurity = functionSecurityResult.rows[0];
  const trigger = triggerResult.rows[0];
  const schemaComment = commentResult.rows[0]?.schema_comment ?? '';
  const shape = shapeResult.rows[0];
  const seed = seedResult.rows[0];
  const failures: string[] = [];
  let triggerFingerprint: DatabaseVerificationReport['triggerFingerprint'];
  if (!inventory || inventory.tables !== expectedInventory.tables || inventory.views !== 7 || inventory.functions !== expectedInventory.functions || !inventory.pgcrypto || !inventory.pg_trgm) {
    failures.push(`object or extension inventory [${inventory?.tables ?? 'missing'}/${inventory?.views ?? 'missing'}/${inventory?.functions ?? 'missing'}]`);
  }
  if (!roles || roles.total !== 17 || roles.safe !== 17 || roles.memberships !== 0) {
    failures.push('capability role safety');
  }
  if (!acl || acl.entries !== expectedAcl.entries || sha256(acl.manifest) !== expectedAcl.sha256) {
    failures.push(`exact schema/relation/column/function/default ACL manifest [${acl?.entries ?? 'missing'}:${acl ? sha256(acl.manifest) : 'missing'}]`);
  }
  if (
    !objects
    || objects.entries !== expectedInventory.objectEntries
    || sha256(objects.manifest) !== expectedInventory.objectSha256
  ) {
    failures.push(`exact database object/owner manifest [${objects?.entries ?? 'missing'}:${objects ? sha256(objects.manifest) : 'missing'}]`);
  }
  if (
    !functionSecurity
    || functionSecurity.entries !== expectedInventory.functionEntries
    || sha256(functionSecurity.manifest) !== expectedInventory.functionSha256
  ) {
    failures.push(`exact function definition/owner/security manifest [${functionSecurity?.entries ?? 'missing'}:${functionSecurity ? sha256(functionSecurity.manifest) : 'missing'}]`);
  }
  const expectedTriggerEntries = expectedInventory.triggerEntries ?? EXPECTED_TRIGGER_MANIFEST_ENTRIES;
  const expectedTriggerSha = expectedInventory.triggerSha256 ?? EXPECTED_TRIGGER_MANIFEST_SHA256;
  const acceptsNamedDisabledImportBatchTriggers = (
    expectedTriggerEntries === EXPECTED_TRIGGER_MANIFEST_ENTRIES
    && expectedTriggerSha === EXPECTED_TRIGGER_MANIFEST_SHA256
  ) || (
    expectedTriggerEntries === READINESS_TRIGGER_ENTRIES
    && expectedTriggerSha === READINESS_TRIGGER_SHA256
  );
  const triggerSha = trigger ? sha256(trigger.manifest) : '';
  if (trigger && trigger.entries === expectedTriggerEntries && triggerSha === expectedTriggerSha) {
    if (acceptsNamedDisabledImportBatchTriggers) {
      triggerFingerprint = Object.freeze({
        entries: trigger.entries,
        sha256: triggerSha,
        frozenSha256: expectedTriggerSha,
        difference: 'none',
        disabledTriggers: Object.freeze([]),
      });
    }
  } else {
    const explained = trigger && acceptsNamedDisabledImportBatchTriggers
      ? explainImportBatchEnablement(trigger.manifest)
      : null;
    if (
      trigger
      && explained
      && trigger.entries === expectedTriggerEntries
      && explained.disabledTriggers.length > 0
      && explained.sha256 === expectedTriggerSha
    ) {
      triggerFingerprint = Object.freeze({
        entries: trigger.entries,
        sha256: triggerSha,
        frozenSha256: expectedTriggerSha,
        difference: 'import_batches_tgenabled',
        disabledTriggers: explained.disabledTriggers,
      });
    } else {
      failures.push(`exact trigger table/function/event/enabled/definition manifest [${trigger?.entries ?? 'missing'}:${trigger ? triggerSha : 'missing'}]`);
    }
  }
  if (schemaCommentFragments.some((fragment) => !schemaComment.includes(fragment))) {
    failures.push('schema evidence-boundary comment');
  }
  if (
    !shape
    || shape.missing_tables
    || shape.missing_views
    || shape.missing_functions
    || shape.missing_function_signatures
    || shape.unsafe_view_owners
    || !shape.search_projection.includes('questions jsonb')
    || !shape.search_projection.includes('search_document tsvector')
    || !shape.search_projection.includes('search_fallback_text text')
  ) {
    failures.push('required object/signature or view-owner shape');
  }
  if (
    !seed
    || seed.enabled_count !== 0
    || JSON.stringify(seed.policy_keys) !== JSON.stringify(REQUIRED_POLICY_KEYS)
  ) {
    failures.push('Phase1 policy seed inventory');
  }
  if (failures.length > 0) {
    throw new DatabaseMigrationError(
      'MIGRATION_VERIFY_FAILED',
      `Database migration verification failed: ${failures.join(', ')}`,
    );
  }
  if (!inventory || !roles || !acl || !objects || !functionSecurity || !trigger || !inventory.pgcrypto || !inventory.pg_trgm) {
    throw new DatabaseMigrationError(
      'MIGRATION_VERIFY_FAILED',
      'Database migration verification produced an incomplete result',
    );
  }

  return Object.freeze({
    status: 'PASS',
    migrationCount: migrationStatus.applied.length,
    inventory: Object.freeze({
      tables: inventory.tables,
      views: inventory.views,
      functions: inventory.functions,
      pgcrypto: inventory.pgcrypto,
      pgTrgm: inventory.pg_trgm,
    }),
    capabilityRoles: Object.freeze({ total: roles.total, safe: roles.safe, memberships: roles.memberships }),
    acl: Object.freeze({
      runtimeReleaseItemsRead: false,
      runtimeBackingViewRead: false,
      runtimeControlledSearchExecute: true,
      publicLedgerSchemaUsage: false,
      publicLedgerRead: false,
    }),
    phase1PolicyHardOff: true,
    compatibility: migrationStatus.compatibility,
    ...(triggerFingerprint === undefined ? {} : { triggerFingerprint }),
  });
}

// The ACL successor changes no objects, function bodies or triggers. Reuse the
// full verifier with its exact frozen predecessor ledger and ACL, so a matching
// ledger alone cannot authorize granting capabilities to a drifted installation.
export function legacyCheckPredecessorCatalogue(): ExecutableMigrationCatalogue {
  const predecessor = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.find(
    prior => prior.contractSetId === 'cs-ai-c11-openapi-1.22.0-schema-1.24-adbc7b1ce251',
  );
  if (!predecessor || predecessor.migrationCount !== 34) {
    throw new DatabaseMigrationError('MIGRATION_CATALOGUE_INVALID', 'Frozen CSV predecessor is required for the legacy CHECK ACL upgrade');
  }
  return { ...generatedMigrationCatalogue, ...predecessor,
    compatibility: { ...generatedMigrationCatalogue.compatibility,
      priorReviewedUpgrades: generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.filter(prior => prior.migrationCount < 34) },
    migrations: generatedMigrationCatalogue.migrations.slice(0, 34),
  };
}

export function verifyLegacyCheckPredecessor(client: DatabaseQueryClient): Promise<DatabaseVerificationReport> {
  return verifyCatalogueState(client, legacyCheckPredecessorCatalogue(), {
    entries: 542, sha256: '95c8860d441fdb7429364476c09938e1935f8aa5383a9743a84b89399ff8f6b5',
  });
}

const V127_INVENTORY = Object.freeze({ tables: EXPECTED_SUCCESSOR_TABLES, functions: 257,
  objectEntries: EXPECTED_V127_OBJECT_MANIFEST_ENTRIES, objectSha256: EXPECTED_V127_OBJECT_MANIFEST_SHA256,
  functionEntries: EXPECTED_V127_FUNCTION_SECURITY_ENTRIES, functionSha256: EXPECTED_V127_FUNCTION_SECURITY_SHA256 });
const READINESS_INVENTORY = Object.freeze({ tables: 104, functions: 270,
  objectEntries: 3319, objectSha256: '527586edd3e6ce1bc42018fef37429f64f9e5e9c1281eef4a6624f141d5b8e65',
  functionEntries: 270, functionSha256: '78cd2e22d8eee25b1f75da542b79f2a6e9da0c4ff77bdf4deaa51354c6dd562e',
  triggerEntries: READINESS_TRIGGER_ENTRIES, triggerSha256: READINESS_TRIGGER_SHA256 });

/** Physical checks and receipt verification share the 0040 transaction. These
 * fingerprints come from the exact approved upgrade on isolated PG15, not the
 * cumulative schema, which is not an executable bootstrap. */
export function verifyRepairSuccessor(client: DatabaseQueryClient, catalogue: ExecutableMigrationCatalogue): Promise<DatabaseVerificationReport> {
  const repairCatalogue = catalogue.migrations.length > 40
    ? { ...catalogue, migrations: catalogue.migrations.slice(0, 40),
      compatibility: { ...catalogue.compatibility, readinessSuccessor: null } }
    : catalogue;
  if (repairCatalogue.migrations.length !== 40
    || repairCatalogue.compatibility.repairSuccessor?.sourceSchemaSha256 !== 'c676b8a580e51f6a0cc2ce0b25919fb9aec2b5e470076461131ea233972e6c69') {
    throw new DatabaseMigrationError('MIGRATION_CATALOGUE_INVALID', 'Exact approved repair successor required');
  }
  return verifyCatalogueState(client, repairCatalogue, {
    entries: 573, sha256: '73ef57b18fc9ae2a5b5f99f50b7dd35bf5dd70829c6d97d2355ec65a86debd6e',
  }, { tables: 104, functions: 270,
    objectEntries: 3319, objectSha256: '527586edd3e6ce1bc42018fef37429f64f9e5e9c1281eef4a6624f141d5b8e65',
    functionEntries: 270, functionSha256: '78cd2e22d8eee25b1f75da542b79f2a6e9da0c4ff77bdf4deaa51354c6dd562e',
    triggerEntries: READINESS_TRIGGER_ENTRIES, triggerSha256: READINESS_TRIGGER_SHA256,
  });
}

export function verifyRepairPredecessor(client: DatabaseQueryClient, catalogue: ExecutableMigrationCatalogue): Promise<DatabaseVerificationReport> {
  const predecessor = { ...catalogue, migrations: catalogue.migrations.slice(0, 39),
    compatibility: { ...catalogue.compatibility, repairSuccessor: null } };
  if (predecessor.migrations.length !== 39) throw new DatabaseMigrationError('MIGRATION_CATALOGUE_INVALID', 'Repair predecessor requires 39 migrations');
  return verifyCatalogueState(client, predecessor, {
    entries: EXPECTED_ACL_MANIFEST_ENTRIES, sha256: EXPECTED_ACL_MANIFEST_SHA256,
  }, V127_INVENTORY);
}

/**
 * 0041 is a deliberately narrow ACL/marker delta over the fully verified 0040
 * state. The runner verifies that full predecessor before applying the SQL;
 * this post-check proves the delta did not widen application authority or
 * leave any of the five invoker predicates executable by PUBLIC.
 */
const OCCUPIED_DOMAIN_MIGRATION_ID = '0042_intake_occupied_domain_publish';
const DEFAULT_TENANT_MIGRATION_ID = '0043_intake_publish_default_tenant';
const ROLE_DEFAULT_MIGRATION_ID = '0044_intake_role_defaults';
const FROZEN_OCCUPIED_SHA256 = 'c692968890cef90c1f72651901a326a8e816347992c7795d58f56cbcc31d6f37';
const OCCUPIED_FUNCTION_SHA256 = '57466bc6aee6b73f01f8ba3afdddedf47be12da01b0c5cc1da33be87578c4663';
const DEFAULT_TENANT_FUNCTION_SHA256 = 'b92de7433f8efba4373d3936032ff285796b45e92756e1b03fe65eac96fc946c';
const ROLE_DEFAULT_FUNCTION_SHA256 = '65548958ec226c44b349c65657bade31590730cb7051341d89922bca85792ea3';
const ROLE_DEFAULT_OBJECT_SHA256 = '32011d2d8211bd9a2a85516c877cbd6965dd444f39bcfd5c3f3b30760db99fbd';
const FEISHU_ADMIT_OBJECT_SHA256 = '5651482547b91105ddbd2d458c27a2ecc3de1a4f45f9fa712d638a78624447b2';
const FEISHU_ADMIT_FUNCTION_SHA256 = '11ab6026e5cbb12efd50d1a60c0374d16bd4bb35fe12235fe5c159a9d33e59f1';
const FEISHU_ADMIT_ACL_SHA256 = '8b0b1f969ffa87f15a0c0d9598a71e3c2df3fd8ecec27b15a11d55b0d27c6088';
const ROSTER_PROJECTION_OBJECT_SHA256 = '1ae078512ece64522a84cc2c79bdb0595de404239835221502dcfbc3d859fd69';
const ROSTER_PROJECTION_FUNCTION_SHA256 = '9581791ce9ae915100ffffe10cd104d4521ee1880dee099eb7813894e770139c';
const ROSTER_PROJECTION_ACL_SHA256 = 'c754efe402f9b860a6962ca800ab4317525d99ff80a1de7ebdf3f31cf19435d2';
const QUERY_SIGNER_OBJECT_SHA256 = 'a77e7e553551d0dbc8858dec34bc0dc15efac61a9f080b95e4a029e8d64d610e';
const QUERY_SIGNER_FUNCTION_SHA256 = 'e6650197736d220fdad210d5d00652dcbccf65fcc69fc6ec38ac7d633c182fa3';
const QUERY_SIGNER_ACL_SHA256 = '87f2fcf485dd05546eb9914d7a717b5a28f07da17cf35e25b9cdd73b1af611d8';
const READINESS_SUFFIX = [
  { length: 42, index: 41, id: OCCUPIED_DOMAIN_MIGRATION_ID, sha256: FROZEN_OCCUPIED_SHA256 },
  { length: 43, index: 42, id: DEFAULT_TENANT_MIGRATION_ID },
  { length: 44, index: 43, id: ROLE_DEFAULT_MIGRATION_ID },
  { length: 45, index: 44, id: '0045_feishu_agent_admit' },
  { length: 46, index: 45, id: '0046_project_feishu_roster' },
  { length: 47, index: 46, id: '0047_roster_query_signer' },
  { length: 48, index: 47, id: '0048_roster_store_set' },
  { length: 49, index: 48, id: '0049_roster_lifecycle' },
  { length: 50, index: 49, id: '0050_authorization_sources' },
  { length: 51, index: 50, id: '0051_publish_source_set' },
  { length: 52, index: 51, id: '0052_import_source_set' },
  { length: 53, index: 52, id: '0053_search_source_set' },
  { length: 54, index: 53, id: '0054_legacy_batch_owner_only' },
  { length: 55, index: 54, id: '0055_grant_steward_required' },
  { length: 56, index: 55, id: '0056_cancel_import_owner_only' },
  { length: 57, index: 56, id: '0057_role_ceiling' },
] as const;
const READINESS_INVENTORY_BY_LENGTH: Partial<Record<number, {
  tables?: number;
  functions?: number;
  objectEntries?: number;
  objectSha256?: string;
  functionEntries?: number;
  functionSha256?: string;
}>> = {
  42: { functionSha256: OCCUPIED_FUNCTION_SHA256 },
  43: { functionSha256: DEFAULT_TENANT_FUNCTION_SHA256 },
  44: { objectEntries: 3318, objectSha256: ROLE_DEFAULT_OBJECT_SHA256, functionSha256: ROLE_DEFAULT_FUNCTION_SHA256 },
  45: { functions: 271, objectEntries: 3319, objectSha256: FEISHU_ADMIT_OBJECT_SHA256, functionEntries: 271, functionSha256: FEISHU_ADMIT_FUNCTION_SHA256 },
  46: { functions: 272, objectEntries: 3320, objectSha256: ROSTER_PROJECTION_OBJECT_SHA256, functionEntries: 272, functionSha256: ROSTER_PROJECTION_FUNCTION_SHA256 },
  47: { functions: 273, objectEntries: 3321, objectSha256: QUERY_SIGNER_OBJECT_SHA256, functionEntries: 273, functionSha256: QUERY_SIGNER_FUNCTION_SHA256 },
  48: { tables: 107, functions: 273, objectEntries: 3364, objectSha256: 'b6a14c317e821cd7d323a0523602c2e3acd66c10268613eefaadb0800d9558bf', functionEntries: 273, functionSha256: '38c0cddbc0dc081266bcb9dfa51d115f32c06478497d8a2a95a12784bc88dad3' },
  49: { tables: 108, functions: 276, objectEntries: 3378, objectSha256: 'c90722894d60eb2ecafe756b4127ecbd5153cc0630cfb4af99b4feb52683f6eb', functionEntries: 276, functionSha256: '97cd623f1005c0e70d315eb42449fb238ed69cde85666fa2fe23a900963aa4d6' },
  50: { tables: 108, functions: 277, objectEntries: 3379, objectSha256: 'dbdc7ee8aff2ddd132569a733025f51dbe0fee3067e2eb824e8da386e43cd81a', functionEntries: 277, functionSha256: '0de1a50d5d1ffc621f222ff0eb63c437a8087260e649c7f2c193264df4a82291' },
  51: { tables: 108, functions: 277, objectEntries: 3379, objectSha256: 'befac3ed07875074d7e9422df3488940da9bfacc6caa4b35a6efebae235558f5', functionEntries: 277, functionSha256: '68d973edff9f17b88be896e0a1e0513acf2e3b486629dc7e167531ad60d257c6' },
  52: { tables: 108, functions: 277, objectEntries: 3379, objectSha256: '29f296ccc99ecdd706af218a9de865e54bad1952870cad455d91d0b2d7e9ad85', functionEntries: 277, functionSha256: '192b36277ae85b55b3d19324253aa3367e565b8fcea0069283d3f5768fba9752' },
  53: { tables: 108, functions: 278, objectEntries: 3380, objectSha256: 'ba3fe81a507f5721e47f5891763c149cfb70259205cf6675b44d1e21975a9c69', functionEntries: 278, functionSha256: '61eb92ef2dfc405f8066f0e521e7df6dd023599e4bb96fabacf762f0ef19261b' },
  // 0054 replaces four function bodies in place plus a column-level SELECT grant, so the ACL
  // count moves (607 -> 609) while the table and function counts do not.
  54: { tables: 108, functions: 278, objectEntries: 3380, objectSha256: 'ba3fe81a507f5721e47f5891763c149cfb70259205cf6675b44d1e21975a9c69', functionEntries: 278, functionSha256: '319665ff714e5f52cafacf2348685c6ad400dbc32f9b12440e8418b682e530fe' },
  // 0055 replaces the two decision functions in place, so only their digest moves.
  55: { tables: 108, functions: 278, objectEntries: 3380, objectSha256: 'ba3fe81a507f5721e47f5891763c149cfb70259205cf6675b44d1e21975a9c69', functionEntries: 278, functionSha256: '8aa046bcb3454577967e09bc335ee1967c211ec9b30baedf7313036b0ca88612' },
  // 0056 replaces one function body in place.
  56: { tables: 108, functions: 278, objectEntries: 3380, objectSha256: 'ba3fe81a507f5721e47f5891763c149cfb70259205cf6675b44d1e21975a9c69', functionEntries: 278, functionSha256: '8ba5e6ed481ffcd41c47aa2d7754c0b9070f709641f87fd696cadf71ad82c1e3' },
  // 0057 adds the ceiling table and four predicate functions, and the revoke takes the
  // implicit PUBLIC execute off them. Measured after this migration.
  57: { tables: 109, functions: 282, objectEntries: 3397, objectSha256: 'f8e9ab2d5c0d812e47b8c0389ef116364a24b3ea93c3c0975aaa826a23e0e18b', functionEntries: 282, functionSha256: 'ec51c4a71ecd49c0cc7b6601d9237c191c713a43af6d11597d1c62cd8cc70828' },
};
const READINESS_ACL_BY_LENGTH: Partial<Record<number, { entries: number; sha256: string }>> = {
  45: { entries: 572, sha256: FEISHU_ADMIT_ACL_SHA256 },
  46: { entries: 573, sha256: ROSTER_PROJECTION_ACL_SHA256 },
  47: { entries: 574, sha256: QUERY_SIGNER_ACL_SHA256 },
  48: { entries: 577, sha256: '1b5a521c21b28ecafd4bc80aa948eba059a2cefee02f47a2a6279f1c541178a2' },
  49: { entries: 580, sha256: 'b504cc0440d50a6d9648296ae29c18bf00caf1e7a700ce667c8540fc5c5741fd' },
  50: { entries: 584, sha256: 'd8f6db8cf446132e074a1f4eba46756974ee86ad982bc1fc46c700a29290d7fc' },
  51: { entries: 591, sha256: '46fc06421140bf3a1544b7eb8f8c5d46adf6e5cd2aa4f66e06ea7903baac2f76' },
  52: { entries: 606, sha256: 'da8436f3126bc9f745ae992ac1022f0674a74be468ca7205688a382ba9075a33' },
  53: { entries: 606, sha256: '4956bfcbd9b0594f418b06774f4e899bae71fea4aa3cd9fa5e223f1ac14844e7' },
  54: { entries: 609, sha256: '712de21df06cff230ccf04637d94f167f76613d2143707df04482aa4dc07d7c1' },
  55: { entries: 609, sha256: '712de21df06cff230ccf04637d94f167f76613d2143707df04482aa4dc07d7c1' },
  56: { entries: 609, sha256: '712de21df06cff230ccf04637d94f167f76613d2143707df04482aa4dc07d7c1' },
  // Measured after 0057: the four grants add 26 entries, the PUBLIC revokes take 3 off per
  // function for the ones PUBLIC held, and the net is 609 -> 635.
  57: { entries: 635, sha256: 'fcd0569419e5925d538f8a55711c2ae4c67c6d1cbd0c426bd88ea2b2f10bc165' },
};

export async function verifyReadinessSuccessor(
  client: DatabaseQueryClient,
  catalogue: ExecutableMigrationCatalogue,
): Promise<DatabaseVerificationReport> {
  const length = catalogue.migrations.length;
  const suffixOk = READINESS_SUFFIX.filter((step) => step.length <= length).every((step) => {
    const migration = catalogue.migrations[step.index];
    return migration?.id === step.id && (!('sha256' in step) || migration.sha256 === step.sha256);
  });
  const knownLength = length === 41 || READINESS_SUFFIX.some((step) => step.length === length);
  if (!knownLength || !suffixOk
    || catalogue.migrations[40]?.id !== '0041_intake_readiness_v1_29'
    || catalogue.compatibility.readinessSuccessor?.sourceSchemaSha256 !== '04b30ed1c5f9c01d99fd2a4912d809aa66a7c7764b0a2f3a0bb060c535804771') {
    throw new DatabaseMigrationError('MIGRATION_CATALOGUE_INVALID', 'Exact approved readiness successor required');
  }
  const inventory = { ...READINESS_INVENTORY, ...READINESS_INVENTORY_BY_LENGTH[length] };
  const base = await verifyCatalogueState(client, catalogue,
    READINESS_ACL_BY_LENGTH[length] ?? { entries: 571, sha256: '04f03f0b0245f97c6b5948a57d3535c258e099dcde1b9a3378521bff4ba4e00c' },
  inventory, ['schema.v1.29', 'runtime activation and production NOT_CERTIFIED']);
  const marker = await verifyQuery<{ schema_comment: string | null }>(client,
    `SELECT pg_catalog.obj_description('public'::pg_catalog.regnamespace, 'pg_namespace') AS schema_comment`);
  const publicExec = await verifyQuery<{ signature: string; public_exec: boolean }>(client, `
    SELECT p.oid::regprocedure::text AS signature,
      EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      ) AS public_exec
    FROM pg_catalog.pg_proc p
    WHERE p.oid = ANY($1::regprocedure[])
    ORDER BY 1`, [READINESS_FORMAT_FUNCTIONS]);
  const predicateExec = await verifyQuery<{ role_name: string; allowed: boolean; grantable: boolean }>(client, `
    SELECT r.rolname AS role_name,
      pg_catalog.has_function_privilege(r.rolname, $1, 'EXECUTE') AS allowed,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        WHERE p.oid = $2::regprocedure AND a.grantee = r.oid AND a.privilege_type = 'EXECUTE' AND a.is_grantable
      ) AS grantable
    FROM pg_catalog.pg_roles r
    WHERE r.rolname = ANY($3::text[])
    ORDER BY 1`, [READINESS_FORMAT_FUNCTIONS[1], READINESS_FORMAT_FUNCTIONS[1], READINESS_PREDICATE_ROLES]);
  const failures: string[] = [];
  if (marker.rows[0]?.schema_comment !== 'CS-AI-C11 schema.v1.29; content-intake readiness successor; runtime activation and production NOT_CERTIFIED') {
    failures.push('schema version marker');
  }
  if (publicExec.rows.length !== READINESS_FORMAT_FUNCTIONS.length || publicExec.rows.some(row => row.public_exec)) {
    failures.push('PUBLIC EXECUTE removed from all readiness predicates');
  }
  const expected = new Set(READINESS_PREDICATE_ROLES);
  if (predicateExec.rows.length !== expected.size
    || predicateExec.rows.some(row => !expected.has(row.role_name) || !row.allowed || row.grantable)) {
    failures.push('predicate EXECUTE role boundary');
  }
  if (failures.length > 0) {
    throw new DatabaseMigrationError('MIGRATION_VERIFY_FAILED', `Readiness successor verification failed: ${failures.join(', ')}`);
  }
  return Object.freeze({ ...base, migrationCount: catalogue.migrations.length });
}

export function verifyMigrationCatalogue(client: DatabaseQueryClient): Promise<DatabaseVerificationReport> {
  if (generatedMigrationCatalogue.compatibility.readinessSuccessor) return verifyReadinessSuccessor(client, generatedMigrationCatalogue);
  if (generatedMigrationCatalogue.compatibility.repairSuccessor) return verifyRepairSuccessor(client, generatedMigrationCatalogue);
  return verifyCatalogueState(client, generatedMigrationCatalogue, {
    entries: EXPECTED_ACL_MANIFEST_ENTRIES, sha256: EXPECTED_ACL_MANIFEST_SHA256,
  }, V127_INVENTORY);
}

/** Check the ledger through an already-applied prefix. The additive successor is not applied yet. */
export function verifyMigrationPrefix(client: DatabaseQueryClient, migrationCount: number): Promise<DatabaseVerificationReport> {
  const catalogue = {
    ...generatedMigrationCatalogue,
    migrations: generatedMigrationCatalogue.migrations.slice(0, migrationCount),
    compatibility: { ...generatedMigrationCatalogue.compatibility, additiveSuccessor: null },
  };
  return verifyCatalogueState(client, catalogue, {
    entries: EXPECTED_ACL_MANIFEST_ENTRIES, sha256: EXPECTED_ACL_MANIFEST_SHA256,
  });
}

export function verifyDatabaseMigrations(client: DatabaseClient): Promise<DatabaseVerificationReport> {
  return withExclusiveDatabaseClient(client, verifyMigrationCatalogue);
}
