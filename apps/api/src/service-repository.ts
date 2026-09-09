import { performance } from 'node:perf_hooks';
import { CONTRACT_PROVENANCE, type components } from '@customer-agent/contracts';
import { Client, Pool, type PoolClient, type QueryResultRow } from 'pg';
import {
  createApiRuntimeDiagnostic,
  reportApiRuntimeDiagnostic,
  type ApiRuntimeDiagnosticCode,
  type ApiRuntimeDiagnosticSink,
} from './runtime-diagnostics.js';
import type { ApiDatabaseBootstrapConfig } from './runtime-config.js';
import {
  createEventRepository,
  type EventRepository,
  type PreparedAdoptionOperation,
  type PreparedEscalationOperation,
} from './event-repository.js';
import type { PreparedSearchOperation } from './search-routes.js';
import {
  createSearchRepository,
  type SearchRepositoryRequest,
  type SearchRepositoryResult,
} from './search-repository.js';
import {
  createContentImportRepository,
  type ContentImportRepository,
} from './content-import-repository.js';

export type ServiceReadinessChecks = components['schemas']['ReadyChecks'];
export type ServicePolicyFlags = Readonly<Omit<components['schemas']['PolicyResponse'], 'auth_mode'>>;

export type ServiceRepository = Readonly<{
  readiness: () => Promise<ServiceReadinessChecks>;
  readPolicyFlags: () => Promise<ServicePolicyFlags | null>;
  searchCandidates: (request: SearchRepositoryRequest) => Promise<SearchRepositoryResult>;
  executeSearch: EventRepository['executeSearch'];
  recordAdoption: (request: PreparedAdoptionOperation) => ReturnType<EventRepository['recordAdoption']>;
  recordEscalation: (request: PreparedEscalationOperation) => ReturnType<EventRepository['recordEscalation']>;
  contentImport: ContentImportRepository;
  close: () => Promise<void>;
}>;

type RuntimePool = Pick<Pool, 'query' | 'connect' | 'end' | 'on'>;
type RuntimeClock = () => number;

class RuntimePoolClient extends Client {
  readonly runtimeConnectionStartedAt = performance.now();
}

/** Internal deterministic test seam for pg-pool's late-connect race guard. */
export function runtimeConnectionExceededDeadline(
  startedAt: number,
  timeoutMs: number,
  now = performance.now(),
): boolean {
  return now - startedAt >= timeoutMs;
}

function verifyRuntimeConnectionDeadline(
  client: PoolClient,
  timeoutMs: number,
  now: number,
  done: (error?: Error) => void,
): void {
  const startedAt = Reflect.get(client, 'runtimeConnectionStartedAt');
  if (typeof startedAt !== 'number'
    || runtimeConnectionExceededDeadline(startedAt, timeoutMs, now)) {
    done(new Error('Runtime database connection exceeded its configured deadline'));
    return;
  }
  done();
}

/** Internal deterministic test seam for the exact callback passed to pg-pool. */
export function createRuntimePoolVerify(
  timeoutMs: number,
  now: RuntimeClock = () => performance.now(),
): (client: PoolClient, done: (error?: Error) => void) => void {
  return (client, done) => verifyRuntimeConnectionDeadline(client, timeoutMs, now(), done);
}

interface RuntimeSchemaProbeRow extends QueryResultRow {
  database_probe: number;
  server_version_num: number;
  schema_comment: string;
  repository_boundary_present: boolean;
  runtime_identity_safe: boolean;
  runtime_effective_acl_safe: boolean;
  runtime_search_boundary_safe: boolean;
}

interface RuntimePolicyFlagsRow extends QueryResultRow, ServicePolicyFlags {}

const EXPECTED_SCHEMA_PREFIX = `CS-AI-C11 ${CONTRACT_PROVENANCE.database_version};`;
const EXPECTED_SEARCH_BOUNDARY_MANIFEST_SHA256 = 'cf33ad08f0e6ef34dfa6f212e69aaac151a69603d69ee52db32c9e7bd02333ec';
const RUNTIME_SCHEMA_PROBE = `
  WITH expected_runtime_relation_acl(relation_name, privilege_type) AS (
    VALUES
      ('app_users', 'SELECT'),
      ('query_events', 'SELECT'),
      ('candidate_impressions', 'SELECT'),
      ('adoption_events', 'SELECT'),
      ('escalate_actions', 'SELECT'),
      ('privacy_notices', 'SELECT'),
      ('notice_decisions', 'SELECT'),
      ('iteration_tasks', 'SELECT'),
      ('iteration_task_status_audits', 'SELECT'),
      ('work_order_import_batches', 'SELECT'),
      ('work_order_records', 'SELECT'),
      ('work_order_export_audits', 'SELECT'),
      ('client_sync_state', 'SELECT'),
      ('policy_flags', 'SELECT'),
      ('query_events', 'INSERT'),
      ('candidate_impressions', 'INSERT'),
      ('adoption_events', 'INSERT'),
      ('escalate_actions', 'INSERT'),
      ('notice_decisions', 'INSERT'),
      ('iteration_tasks', 'INSERT')
  ),
  expected_runtime_column_acl(relation_name, column_name, privilege_type) AS (
    VALUES
      ('authoritative_source_versions', 'tenant_id', 'SELECT'),
      ('authoritative_source_versions', 'source_version_id', 'SELECT'),
      ('authoritative_source_versions', 'source_ref', 'SELECT'),
      ('authoritative_source_versions', 'domain', 'SELECT'),
      ('authoritative_source_versions', 'snapshot_sha256', 'SELECT'),
      ('authoritative_source_versions', 'use_class', 'SELECT'),
      ('authoritative_source_suspensions', 'source_version_id', 'SELECT'),
      ('authoritative_source_suspensions', 'reason_code', 'SELECT'),
      ('authoritative_source_suspensions', 'suspended_at', 'SELECT')
  ),
  expected_runtime_function_acl(signature) AS (
    VALUES
      ('public.enqueue_content_import(text,text,text,text,bigint,jsonb,text,text)'),
      ('public.enqueue_work_order_import(text,text,text,text,text,text,bigint,text,timestamptz,timestamptz,text,text)'),
      ('public.cancel_content_import(text,text,text,text)'),
      ('public.start_iteration_task(text,integer,text,text)'),
      ('public.close_iteration_task(text,integer,text,text,text,text)'),
      ('public.record_work_order_export(text,text,text,text,text[],integer,text,text)'),
      ('public.record_runtime_source_denial_audit(text,text,text,text,text,text,text,text,text,text)'),
      ('public.issue_snapshot_offline_lease(text,text,integer)'),
      ('public.validate_snapshot_offline_lease(text,text,text,text)'),
      ('public.read_current_announcement_with_lease(text,text,integer)'),
      ('public.read_snapshot_page(text,text,text,text,text,integer)'),
      ('public.read_content_import_status(text,text,text)'),
      ('public.read_content_import_preview(text,text,text,text,integer)'),
      ('public.search_recommendable_scripts(text,text,text)'),
      ('public.ack_client_release(text,text,text,bigint,text)'),
      ('public.rate_limit_take(text,double precision,double precision,double precision)'),
      ('public.idempotency_lookup(text,text,text,text,text)'),
      ('public.idempotency_request_hash_version(text,text,text)'),
      ('public.idempotency_claim(text,text,text,text,text,text,integer)'),
      ('public.idempotency_complete(text,text,text,bigint,integer,jsonb,boolean)'),
      ('public.idempotency_heartbeat(text,text,text,bigint,integer)')
  ),
  expected_search_functions(signature) AS (
    VALUES
      ('public.search_recommendable_scripts(text,text,text)'),
      ('public.content_scope_matches(text[],text,text[],text,text,text)'),
      ('public.content_questions_source_assets_are_active(jsonb)'),
      ('public.content_questions_are_valid(jsonb)'),
      ('public.content_question_hash(jsonb)'),
      ('public.content_public_questions(jsonb)'),
      ('public.jsonb_jcs(jsonb)'),
      ('public.content_utc_timestamp_text(timestamp with time zone)'),
      ('public.digest(bytea,text)'),
      ('public.owner_acceptance_release_ready(text)'),
      ('public.owner_acceptance_active_record(text,text,text)'),
      ('public.owner_acceptance_sources_ready(text,jsonb)'),
      ('public.owner_acceptance_instant(jsonb)')
  ),
  guarded_user_schemas AS (
    SELECT oid, nspname, nspowner, nspacl
    FROM pg_catalog.pg_namespace
    WHERE nspname <> 'information_schema'
      AND nspname !~ '^pg_'
  ),
  search_dependency_manifest(entry) AS (
    SELECT
      'function|' || expected.signature || '|' ||
      CASE
        WHEN expected.signature = 'public.digest(bytea,text)' THEN '<extension-owner>'
        ELSE owner_role.rolname
      END || '|' ||
      pg_catalog.pg_get_functiondef(procedure.oid)
    FROM expected_search_functions expected
    JOIN pg_catalog.pg_proc procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    JOIN pg_catalog.pg_roles owner_role
      ON owner_role.oid = procedure.proowner
    UNION ALL
    SELECT
      'view|public.' || relation.relname || '|' || owner_role.rolname || '|' ||
      coalesce(pg_catalog.array_to_string(relation.reloptions, ','), '') || '|' ||
      pg_catalog.pg_get_viewdef(relation.oid, true)
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles owner_role
      ON owner_role.oid = relation.relowner
    WHERE namespace.nspname = 'public'
      AND relation.relkind = 'v'
      AND relation.relname IN ('v_release_source_gate', 'v_scripts_recommendable')
  )
  SELECT
    1::integer AS database_probe,
    pg_catalog.current_setting('server_version_num')::integer AS server_version_num,
    coalesce(
      pg_catalog.obj_description('public'::pg_catalog.regnamespace, 'pg_namespace'),
      ''
    ) AS schema_comment,
    pg_catalog.to_regprocedure(
      'public.search_recommendable_scripts(text,text,text)'
    ) IS NOT NULL
      AS repository_boundary_present,
    coalesce(
      (
        SELECT
          login.rolcanlogin
          AND NOT login.rolsuper
          AND NOT login.rolcreatedb
          AND NOT login.rolcreaterole
          AND NOT login.rolreplication
          AND NOT login.rolbypassrls
          AND NOT runtime_role.rolcanlogin
          AND NOT runtime_role.rolsuper
          AND NOT runtime_role.rolcreatedb
          AND NOT runtime_role.rolcreaterole
          AND NOT runtime_role.rolreplication
          AND NOT runtime_role.rolbypassrls
          AND NOT definer_role.rolcanlogin
          AND NOT definer_role.rolsuper
          AND NOT definer_role.rolcreatedb
          AND NOT definer_role.rolcreaterole
          AND NOT definer_role.rolreplication
          AND NOT definer_role.rolbypassrls
          AND pg_catalog.current_setting('session_replication_role') = 'origin'
          AND session_user = current_user
          AND pg_catalog.pg_has_role(session_user, runtime_role.oid, 'MEMBER')
          AND NOT runtime_membership.admin_option
          AND NOT pg_catalog.pg_has_role(session_user, definer_role.oid, 'MEMBER')
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_roles unexpected_role
            WHERE unexpected_role.oid <> login.oid
              AND unexpected_role.rolname <> 'app_runtime'
              AND pg_catalog.pg_has_role(
                session_user,
                unexpected_role.oid,
                'MEMBER'
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_auth_members definer_member
            WHERE definer_member.roleid = definer_role.oid
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_auth_members login_member
            WHERE login_member.roleid = login.oid
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_parameter_acl parameter_acl
            JOIN LATERAL pg_catalog.aclexplode(parameter_acl.paracl) acl ON true
            WHERE acl.grantee IN (0, login.oid, runtime_role.oid, definer_role.oid)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_roles unexpected_definer_role
            WHERE unexpected_definer_role.oid <> definer_role.oid
              AND pg_catalog.pg_has_role(
                definer_role.oid,
                unexpected_definer_role.oid,
                'MEMBER'
              )
          )
        FROM pg_catalog.pg_roles login
        CROSS JOIN pg_catalog.pg_roles runtime_role
        CROSS JOIN pg_catalog.pg_roles definer_role
        JOIN pg_catalog.pg_auth_members runtime_membership
          ON runtime_membership.member = login.oid
          AND runtime_membership.roleid = runtime_role.oid
        WHERE login.rolname = session_user
          AND runtime_role.rolname = 'app_runtime'
          AND definer_role.rolname = 'cs_ai_definer'
      ),
      false
    ) AS runtime_identity_safe,
    coalesce(
      (
        SELECT
          NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_database guarded_database
            LEFT JOIN LATERAL pg_catalog.aclexplode(guarded_database.datacl) acl ON true
            WHERE guarded_database.datname = pg_catalog.current_database()
              AND (
                guarded_database.datdba IN (login.oid, runtime_role.oid, definer_role.oid)
                OR (
                  acl.grantee IN (login.oid, runtime_role.oid, definer_role.oid)
                  AND acl.privilege_type IN ('CREATE', 'TEMPORARY')
                )
                OR (
                  acl.grantee = 0
                  AND acl.privilege_type = 'CREATE'
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM guarded_user_schemas guarded_schema
            LEFT JOIN LATERAL pg_catalog.aclexplode(guarded_schema.nspacl) acl ON true
            WHERE guarded_schema.nspowner IN (login.oid, runtime_role.oid, definer_role.oid)
                OR acl.grantee = login.oid
                OR (
                  guarded_schema.nspname = 'public'
                  AND acl.privilege_type = 'CREATE'
                  AND acl.grantee <> guarded_schema.nspowner
                )
                OR (
                  acl.grantee = 0
                  AND (
                    guarded_schema.nspname <> 'public'
                    OR acl.privilege_type <> 'USAGE'
                    OR acl.is_grantable
                  )
                )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM guarded_user_schemas guarded_schema
            JOIN LATERAL pg_catalog.aclexplode(guarded_schema.nspacl) acl ON true
            WHERE acl.grantee = runtime_role.oid
              AND (
                guarded_schema.nspname <> 'public'
                OR acl.privilege_type <> 'USAGE'
                OR acl.is_grantable
              )
          )
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace public_schema
            JOIN LATERAL pg_catalog.aclexplode(public_schema.nspacl) acl ON true
            WHERE public_schema.nspname = 'public'
              AND acl.grantee = runtime_role.oid
              AND acl.privilege_type = 'USAGE'
              AND NOT acl.is_grantable
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class guarded_relation
            JOIN guarded_user_schemas guarded_schema
              ON guarded_schema.oid = guarded_relation.relnamespace
            LEFT JOIN LATERAL pg_catalog.aclexplode(guarded_relation.relacl) acl ON true
            WHERE guarded_relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
              AND (
                guarded_relation.relowner IN (login.oid, runtime_role.oid)
                OR acl.grantee IN (0, login.oid)
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class guarded_relation
            JOIN guarded_user_schemas guarded_schema
              ON guarded_schema.oid = guarded_relation.relnamespace
            JOIN LATERAL pg_catalog.aclexplode(guarded_relation.relacl) acl ON true
            WHERE guarded_relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
              AND acl.grantee = runtime_role.oid
              AND (
                acl.is_grantable
                OR NOT EXISTS (
                  SELECT 1
                  FROM expected_runtime_relation_acl expected
                  WHERE guarded_schema.nspname = 'public'
                    AND expected.relation_name = guarded_relation.relname
                    AND expected.privilege_type = acl.privilege_type
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM expected_runtime_relation_acl expected
            WHERE NOT EXISTS (
              SELECT 1
              FROM pg_catalog.pg_class guarded_relation
              JOIN pg_catalog.pg_namespace guarded_schema
                ON guarded_schema.oid = guarded_relation.relnamespace
              JOIN LATERAL pg_catalog.aclexplode(guarded_relation.relacl) acl ON true
              WHERE guarded_schema.nspname = 'public'
                AND guarded_relation.relname = expected.relation_name
                AND acl.grantee = runtime_role.oid
                AND acl.privilege_type = expected.privilege_type
                AND NOT acl.is_grantable
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_attribute guarded_column
            JOIN pg_catalog.pg_class guarded_relation
              ON guarded_relation.oid = guarded_column.attrelid
            JOIN guarded_user_schemas guarded_schema
              ON guarded_schema.oid = guarded_relation.relnamespace
            JOIN LATERAL pg_catalog.aclexplode(guarded_column.attacl) acl ON true
            WHERE guarded_column.attnum > 0
              AND NOT guarded_column.attisdropped
              AND acl.grantee IN (0, login.oid)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_attribute guarded_column
            JOIN pg_catalog.pg_class guarded_relation
              ON guarded_relation.oid = guarded_column.attrelid
            JOIN guarded_user_schemas guarded_schema
              ON guarded_schema.oid = guarded_relation.relnamespace
            JOIN LATERAL pg_catalog.aclexplode(guarded_column.attacl) acl ON true
            WHERE guarded_column.attnum > 0
              AND NOT guarded_column.attisdropped
              AND acl.grantee = runtime_role.oid
              AND (
                acl.is_grantable
                OR NOT EXISTS (
                  SELECT 1
                  FROM expected_runtime_column_acl expected
                  WHERE guarded_schema.nspname = 'public'
                    AND expected.relation_name = guarded_relation.relname
                    AND expected.column_name = guarded_column.attname
                    AND expected.privilege_type = acl.privilege_type
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM expected_runtime_column_acl expected
            WHERE NOT EXISTS (
              SELECT 1
              FROM pg_catalog.pg_attribute guarded_column
              JOIN pg_catalog.pg_class guarded_relation
                ON guarded_relation.oid = guarded_column.attrelid
              JOIN pg_catalog.pg_namespace guarded_schema
                ON guarded_schema.oid = guarded_relation.relnamespace
              JOIN LATERAL pg_catalog.aclexplode(guarded_column.attacl) acl ON true
              WHERE guarded_schema.nspname = 'public'
                AND guarded_relation.relname = expected.relation_name
                AND guarded_column.attname = expected.column_name
                AND guarded_column.attnum > 0
                AND NOT guarded_column.attisdropped
                AND acl.grantee = runtime_role.oid
                AND acl.privilege_type = expected.privilege_type
                AND NOT acl.is_grantable
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc guarded_procedure
            JOIN guarded_user_schemas guarded_schema
              ON guarded_schema.oid = guarded_procedure.pronamespace
            LEFT JOIN LATERAL pg_catalog.aclexplode(
              coalesce(
                guarded_procedure.proacl,
                pg_catalog.acldefault('f', guarded_procedure.proowner)
              )
            ) acl ON true
            WHERE (
                guarded_procedure.proowner IN (login.oid, runtime_role.oid)
                OR acl.grantee IN (0, login.oid)
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc guarded_procedure
            JOIN guarded_user_schemas guarded_schema
              ON guarded_schema.oid = guarded_procedure.pronamespace
            JOIN LATERAL pg_catalog.aclexplode(
              coalesce(
                guarded_procedure.proacl,
                pg_catalog.acldefault('f', guarded_procedure.proowner)
              )
            ) acl ON true
            WHERE acl.grantee = runtime_role.oid
              AND (
                acl.privilege_type <> 'EXECUTE'
                OR acl.is_grantable
                OR NOT EXISTS (
                  SELECT 1
                  FROM expected_runtime_function_acl expected
                  WHERE guarded_procedure.oid = pg_catalog.to_regprocedure(expected.signature)
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM expected_runtime_function_acl expected
            WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_proc guarded_procedure
                JOIN LATERAL pg_catalog.aclexplode(
                  coalesce(
                    guarded_procedure.proacl,
                    pg_catalog.acldefault('f', guarded_procedure.proowner)
                  )
                ) acl ON true
                WHERE guarded_procedure.oid = pg_catalog.to_regprocedure(expected.signature)
                  AND acl.grantee = runtime_role.oid
                  AND acl.privilege_type = 'EXECUTE'
                  AND NOT acl.is_grantable
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_type guarded_type
            JOIN guarded_user_schemas guarded_schema
              ON guarded_schema.oid = guarded_type.typnamespace
            WHERE guarded_type.typowner IN (login.oid, runtime_role.oid)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_default_acl guarded_default
            LEFT JOIN pg_catalog.pg_namespace guarded_schema
              ON guarded_schema.oid = guarded_default.defaclnamespace
            JOIN LATERAL pg_catalog.aclexplode(guarded_default.defaclacl) acl ON true
            WHERE (
                guarded_default.defaclnamespace = 0
                OR EXISTS (
                  SELECT 1
                  FROM guarded_user_schemas user_schema
                  WHERE user_schema.oid = guarded_default.defaclnamespace
                )
              )
              AND acl.grantee IN (0, login.oid, runtime_role.oid)
          )
        FROM pg_catalog.pg_roles login
        CROSS JOIN pg_catalog.pg_roles runtime_role
        CROSS JOIN pg_catalog.pg_roles definer_role
        WHERE login.rolname = session_user
          AND runtime_role.rolname = 'app_runtime'
          AND definer_role.rolname = 'cs_ai_definer'
      ),
      false
    ) AS runtime_effective_acl_safe,
    coalesce(
      (
        SELECT
          procedure.prosecdef
          AND NOT procedure.proleakproof
          AND procedure.prokind = 'f'
          AND procedure.provolatile = 's'
          AND owner_role.rolname = 'cs_ai_definer'
          AND procedure.proconfig = ARRAY[
            'search_path=pg_catalog, public, pg_temp'
          ]::text[]
          AND (
            SELECT pg_catalog.count(*) = 15
              AND pg_catalog.encode(
                pg_catalog.sha256(
                  pg_catalog.convert_to(
                    pg_catalog.string_agg(entry, E'\\n' ORDER BY entry),
                    'UTF8'
                  )
                ),
                'hex'
              ) = '${EXPECTED_SEARCH_BOUNDARY_MANIFEST_SHA256}'
            FROM search_dependency_manifest
          )
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc extension_function
            JOIN pg_catalog.pg_depend extension_dependency
              ON extension_dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
              AND extension_dependency.objid = extension_function.oid
              AND extension_dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
              AND extension_dependency.deptype = 'e'
            JOIN pg_catalog.pg_extension trusted_extension
              ON trusted_extension.oid = extension_dependency.refobjid
              AND trusted_extension.extname = 'pgcrypto'
            WHERE extension_function.oid = pg_catalog.to_regprocedure(
                'public.digest(bytea,text)'
              )
              AND extension_function.proowner = trusted_extension.extowner
          )
          AND pg_catalog.has_function_privilege(
            session_user,
            procedure.oid,
            'EXECUTE'
          )
          AND (
            SELECT
              pg_catalog.count(*) = 1
              AND pg_catalog.bool_and(
                acl.grantee = runtime_role.oid
                AND acl.privilege_type = 'EXECUTE'
                AND NOT acl.is_grantable
              )
            FROM pg_catalog.aclexplode(
              coalesce(
                procedure.proacl,
                pg_catalog.acldefault('f', procedure.proowner)
              )
            ) acl
            WHERE acl.grantee <> procedure.proowner
          )
        FROM pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_roles owner_role
          ON owner_role.oid = procedure.proowner
        JOIN pg_catalog.pg_roles runtime_role
          ON runtime_role.rolname = 'app_runtime'
        WHERE procedure.oid = pg_catalog.to_regprocedure(
          'public.search_recommendable_scripts(text,text,text)'
        )
      ),
      false
    ) AS runtime_search_boundary_safe
`;

// Policy is business-visible runtime data. Prove the same identity, schema and
// ACL boundary in the same statement so a red readiness probe cannot be raced
// or bypassed by a separately over-privileged runtime query.
const RUNTIME_POLICY_FLAGS_READ = `
  WITH runtime_boundary AS MATERIALIZED (
    ${RUNTIME_SCHEMA_PROBE}
  )
  SELECT
    COALESCE((SELECT flag_value FROM public.policy_flags WHERE flag_key = 'rewrite'), FALSE) AS rewrite,
    COALESCE((SELECT flag_value FROM public.policy_flags WHERE flag_key = 'auto_send'), FALSE) AS auto_send,
    COALESCE((SELECT flag_value FROM public.policy_flags WHERE flag_key = 'autofill_adapter'), FALSE) AS autofill_adapter,
    COALESCE((SELECT flag_value FROM public.policy_flags WHERE flag_key = 'llm_ranker'), FALSE) AS llm_ranker,
    COALESCE((SELECT flag_value FROM public.policy_flags WHERE flag_key = 'metrics_experimental_kpi'), FALSE) AS metrics_experimental_kpi
  FROM runtime_boundary
  WHERE runtime_boundary.database_probe = 1
    AND runtime_boundary.server_version_num / 10000 = 15
    AND runtime_boundary.schema_comment LIKE ($1 || '%')
    AND runtime_boundary.repository_boundary_present
    AND runtime_boundary.runtime_identity_safe
    AND runtime_boundary.runtime_effective_acl_safe
    AND runtime_boundary.runtime_search_boundary_safe
`;

function freezeChecks(
  database: ServiceReadinessChecks['database'],
  schema: ServiceReadinessChecks['schema'],
): ServiceReadinessChecks {
  // The repository only proves database/schema. App composition replaces auth,
  // storage and content with their owners; unwired owners stay not_ready.
  return Object.freeze({
    database,
    schema,
    auth: 'not_ready',
    storage: 'not_ready',
    content: 'not_ready',
  });
}

class PostgresServiceRepository implements ServiceRepository {
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private readonly searchRepository: ReturnType<typeof createSearchRepository>;
  private readonly eventRepository: EventRepository;
  readonly contentImport: ContentImportRepository;
  private activeProbe: Readonly<{
    operation: Promise<ServiceReadinessChecks>;
    response: Promise<ServiceReadinessChecks>;
  }> | null = null;

  constructor(
    private readonly pool: RuntimePool,
    private readonly readinessTimeoutMs: number,
    private readonly diagnosticSink: ApiRuntimeDiagnosticSink,
    private readonly now: RuntimeClock,
  ) {
    this.searchRepository = createSearchRepository(this.pool);
    this.eventRepository = createEventRepository(this.pool, undefined, this.diagnosticSink);
    this.contentImport = createContentImportRepository(this.pool, this.diagnosticSink);
    // node-postgres emits idle-client failures on Pool itself. Consume the event
    // so it cannot crash the process. pg-pool already evicts that idle client;
    // the next readiness request must run a fresh probe instead of inventing a
    // one-request outage after the failed client has gone.
    this.pool.on('error', (error) => {
      this.report('DATABASE_IDLE_CLIENT_FAILED', error);
    });
  }

  async searchCandidates(request: SearchRepositoryRequest): Promise<SearchRepositoryResult> {
    if (this.closed) {
      throw Object.assign(new Error('Runtime repository is closed'), { code: '08003' });
    }
    return this.searchRepository.search(request);
  }

  async executeSearch(request: PreparedSearchOperation) {
    if (this.closed) return Object.freeze({ ok: false as const, code: 'OVERLOADED' as const });
    return this.eventRepository.executeSearch(request);
  }

  async recordAdoption(request: PreparedAdoptionOperation) {
    if (this.closed) return Object.freeze({ ok: false as const, code: 'OVERLOADED' as const });
    return this.eventRepository.recordAdoption(request);
  }

  async recordEscalation(request: PreparedEscalationOperation) {
    if (this.closed) return Object.freeze({ ok: false as const, code: 'OVERLOADED' as const });
    return this.eventRepository.recordEscalation(request);
  }

  readiness(): Promise<ServiceReadinessChecks> {
    if (this.closed) return Promise.resolve(freezeChecks('not_ready', 'not_ready'));
    if (this.activeProbe !== null) return this.activeProbe.response;

    const startedAt = this.now();
    let deadlineReported = false;
    const deadlineFailure = (): ServiceReadinessChecks => {
      if (!deadlineReported) {
        deadlineReported = true;
        this.report('DATABASE_READINESS_DEADLINE_EXCEEDED');
      }
      return freezeChecks('not_ready', 'not_ready');
    };
    const operation = this.executeProbe();
    const checkedOperation = operation.then((checks) => (
      runtimeConnectionExceededDeadline(startedAt, this.readinessTimeoutMs, this.now())
        ? deadlineFailure()
        : checks
    ));
    let deadline: ReturnType<typeof setTimeout>;
    const bounded = new Promise<ServiceReadinessChecks>((resolve) => {
      deadline = setTimeout(() => {
        resolve(deadlineFailure());
      }, this.readinessTimeoutMs);
      deadline.unref?.();
    });
    const response = Promise.race([checkedOperation, bounded]);
    this.activeProbe = Object.freeze({ operation, response });
    void operation.finally(() => {
      clearTimeout(deadline);
      if (this.activeProbe?.operation === operation) this.activeProbe = null;
    });
    return response;
  }

  async readPolicyFlags(): Promise<ServicePolicyFlags | null> {
    if (this.closed) return null;
    try {
      const result = await this.pool.query<RuntimePolicyFlagsRow>(
        RUNTIME_POLICY_FLAGS_READ,
        [EXPECTED_SCHEMA_PREFIX],
      );
      if (this.closed) return null;
      const row = result.rows[0];
      if (!row || row.rewrite !== false || row.auto_send !== false) {
        this.report('POLICY_READ_FAILED');
        return null;
      }
      return Object.freeze({
        rewrite: false,
        auto_send: false,
        autofill_adapter: row.autofill_adapter,
        llm_ranker: row.llm_ranker,
        metrics_experimental_kpi: row.metrics_experimental_kpi,
      });
    } catch (error: unknown) {
      this.report('POLICY_READ_FAILED', error);
      return null;
    }
  }

  private async executeProbe(): Promise<ServiceReadinessChecks> {
    try {
      const result = await this.pool.query<RuntimeSchemaProbeRow>(RUNTIME_SCHEMA_PROBE);
      if (this.closed) return freezeChecks('not_ready', 'not_ready');
      const row = result.rows[0];
      if (row?.database_probe !== 1) return freezeChecks('not_ready', 'not_ready');
      const schema = Math.trunc(row.server_version_num / 10_000) === 15
        && row.schema_comment.startsWith(EXPECTED_SCHEMA_PREFIX)
        && row.repository_boundary_present
        && row.runtime_identity_safe
        && row.runtime_effective_acl_safe
        && row.runtime_search_boundary_safe
        ? 'ok'
        : 'not_ready';
      return freezeChecks('ok', schema);
    } catch (error: unknown) {
      this.report('DATABASE_READINESS_PROBE_FAILED', error);
      return freezeChecks('not_ready', 'not_ready');
    }
  }

  private report(code: ApiRuntimeDiagnosticCode, error?: unknown): void {
    try {
      this.diagnosticSink(createApiRuntimeDiagnostic(code, error));
    } catch {
      // Diagnostics are observational; a broken sink must not change readiness
      // or expose the raw failure through a secondary exception.
    }
  }

  close(): Promise<void> {
    if (this.closePromise === null) {
      this.closed = true;
      this.closePromise = this.pool.end();
    }
    return this.closePromise;
  }
}

export function createServiceRepository(
  config: ApiDatabaseBootstrapConfig,
  diagnosticSink: ApiRuntimeDiagnosticSink = reportApiRuntimeDiagnostic,
): ServiceRepository {
  return createServiceRepositoryForPool(new Pool({
    Client: RuntimePoolClient,
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    query_timeout: config.readinessTimeoutMs,
    statement_timeout: config.readinessTimeoutMs,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'cs-ai-api',
    maxLifetimeSeconds: 300,
    verify: createRuntimePoolVerify(config.connectionTimeoutMs),
  }), {
    readinessTimeoutMs: config.readinessTimeoutMs,
    diagnosticSink,
  });
}

/** Internal deterministic test seam; not exported from the package entrypoint. */
const sharedRuntimePools = new WeakMap<ServiceRepository, Pool>();

export function createServiceRepositoryForPool(
  pool: RuntimePool,
  options: Readonly<{
    readinessTimeoutMs?: number;
    diagnosticSink?: ApiRuntimeDiagnosticSink;
    now?: RuntimeClock;
  }> = {},
): ServiceRepository {
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 2_000;
  if (!Number.isSafeInteger(readinessTimeoutMs) || readinessTimeoutMs <= 0) {
    throw new RangeError('readinessTimeoutMs must be a positive integer');
  }
  const repository = new PostgresServiceRepository(
    pool,
    readinessTimeoutMs,
    options.diagnosticSink ?? (() => undefined),
    options.now ?? (() => performance.now()),
  );
  if (pool instanceof Pool) sharedRuntimePools.set(repository, pool);
  return repository;
}

/** Shared app_runtime pool. Announce/current/snapshot/ack reuse it instead of opening another pool. */
export function sharedRuntimePool(repository: ServiceRepository): Pool | undefined {
  return sharedRuntimePools.get(repository);
}
