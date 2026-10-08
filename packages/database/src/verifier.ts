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
const EXPECTED_ACL_MANIFEST_ENTRIES = 550;
const EXPECTED_ACL_MANIFEST_SHA256 = '7890fde2f2bf59f2a941aa020864951091a8eef73e8010d869e14054fcefa38d';
const EXPECTED_OBJECT_MANIFEST_ENTRIES = 3090;
const EXPECTED_OBJECT_MANIFEST_SHA256 = 'c31a0c03694ec13c86ba15eb596c6b47c5164335712d839bc53cc0fb40e0de03';
const EXPECTED_FUNCTION_SECURITY_ENTRIES = 255;
const EXPECTED_FUNCTION_SECURITY_SHA256 = '51ec728928940da3bbd28767d8727727518574d124c24330e64eb5189a38d26b';
const EXPECTED_TRIGGER_MANIFEST_ENTRIES = 109;
const EXPECTED_TRIGGER_MANIFEST_SHA256 = '97259c3711dd67a7b8cab797fe5d667518f9778cf5a1276f17969c060c5e9505';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
  if (!inventory || inventory.tables !== 97 || inventory.views !== 7 || inventory.functions !== 255 || !inventory.pgcrypto || !inventory.pg_trgm) {
    failures.push('object or extension inventory');
  }
  if (!roles || roles.total !== 17 || roles.safe !== 17 || roles.memberships !== 0) {
    failures.push('capability role safety');
  }
  if (!acl || acl.entries !== expectedAcl.entries || sha256(acl.manifest) !== expectedAcl.sha256) {
    failures.push(`exact schema/relation/column/function/default ACL manifest [${acl?.entries ?? 'missing'}:${acl ? sha256(acl.manifest) : 'missing'}]`);
  }
  if (
    !objects
    || objects.entries !== EXPECTED_OBJECT_MANIFEST_ENTRIES
    || sha256(objects.manifest) !== EXPECTED_OBJECT_MANIFEST_SHA256
  ) {
    failures.push(`exact database object/owner manifest [${objects?.entries ?? 'missing'}:${objects ? sha256(objects.manifest) : 'missing'}]`);
  }
  if (
    !functionSecurity
    || functionSecurity.entries !== EXPECTED_FUNCTION_SECURITY_ENTRIES
    || sha256(functionSecurity.manifest) !== EXPECTED_FUNCTION_SECURITY_SHA256
  ) {
    failures.push(`exact function definition/owner/security manifest [${functionSecurity?.entries ?? 'missing'}:${functionSecurity ? sha256(functionSecurity.manifest) : 'missing'}]`);
  }
  if (
    !trigger
    || trigger.entries !== EXPECTED_TRIGGER_MANIFEST_ENTRIES
    || sha256(trigger.manifest) !== EXPECTED_TRIGGER_MANIFEST_SHA256
  ) {
    failures.push(`exact trigger table/function/event/enabled/definition manifest [${trigger?.entries ?? 'missing'}:${trigger ? sha256(trigger.manifest) : 'missing'}]`);
  }
  if (REQUIRED_SCHEMA_COMMENT_FRAGMENTS.some((fragment) => !schemaComment.includes(fragment))) {
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
  });
}

// The ACL successor changes no objects, function bodies or triggers. Reuse the
// full verifier with its exact frozen predecessor ledger and ACL, so a matching
// ledger alone cannot authorize granting capabilities to a drifted installation.
export function verifyLegacyCheckPredecessor(client: DatabaseQueryClient): Promise<DatabaseVerificationReport> {
  const predecessor = generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.find(
    prior => prior.contractSetId === 'cs-ai-c11-openapi-1.22.0-schema-1.24-adbc7b1ce251',
  );
  if (!predecessor || predecessor.migrationCount !== 34) {
    throw new DatabaseMigrationError('MIGRATION_CATALOGUE_INVALID', 'Frozen CSV predecessor is required for the legacy CHECK ACL upgrade');
  }
  const catalogue = { ...generatedMigrationCatalogue, ...predecessor,
    compatibility: { ...generatedMigrationCatalogue.compatibility,
      priorReviewedUpgrades: generatedMigrationCatalogue.compatibility.priorReviewedUpgrades.filter(prior => prior.migrationCount < 34) },
    migrations: generatedMigrationCatalogue.migrations.slice(0, 34),
  };
  return verifyCatalogueState(client, catalogue, {
    entries: 542, sha256: '95c8860d441fdb7429364476c09938e1935f8aa5383a9743a84b89399ff8f6b5',
  });
}

export function verifyMigrationCatalogue(client: DatabaseQueryClient): Promise<DatabaseVerificationReport> {
  return verifyCatalogueState(client, generatedMigrationCatalogue, {
    entries: EXPECTED_ACL_MANIFEST_ENTRIES, sha256: EXPECTED_ACL_MANIFEST_SHA256,
  });
}

export function verifyDatabaseMigrations(client: DatabaseClient): Promise<DatabaseVerificationReport> {
  return withExclusiveDatabaseClient(client, verifyMigrationCatalogue);
}
