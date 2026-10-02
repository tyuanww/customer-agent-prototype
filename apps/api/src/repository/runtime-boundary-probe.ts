import { CONTRACT_PROVENANCE } from '@customer-agent/contracts';
import type { QueryResultRow } from 'pg';
import {
  ANNOUNCE_FUNCTION_GRANTS,
  ANNOUNCE_RELATION_GRANTS,
  LEGACY_PUBLIC_SCHEMA_V17_PREFIX,
  OPS_FUNCTION_GRANTS,
  opsLoopCommentCarriesDatabaseVersion,
} from '../features/announce-ops-boundary.js';
import {
  CONTENT_COLUMN_GRANTS,
  CONTENT_FUNCTION_GRANTS,
  CONTENT_RELATION_GRANTS,
} from '../features/content-runtime.js';
import {
  SEARCH_BOUNDARY_FUNCTIONS,
  SEARCH_BOUNDARY_MANIFEST_SHA256,
  SEARCH_BOUNDARY_MANIFEST_SIZE,
  SEARCH_BOUNDARY_VIEWS,
  SEARCH_FUNCTION_GRANTS,
  SEARCH_RELATION_GRANTS,
} from '../features/search-runtime.js';
import type {
  RuntimeFunctionGrant,
  RuntimeRelationGrant,
} from '../ports/runtime-grants.js';

/**
 * Single-statement runtime boundary proof.
 *
 * Search, content, and announce/ops own their grant lists. This module owns
 * the proof that those grants, the runtime role, and the search dependency
 * manifest are true in one query. Policy reads reuse that statement so they
 * cannot race a weaker check.
 *
 * Iteration, notice, policy-flag, idempotency, and rate-limit grants stay here.
 * More than one feature uses them, and no single feature may drop them.
 *
 * Stays in apps/api. The statement is the customer-agent schema ACL, not a
 * generic Postgres readiness framework.
 */

const SHARED_RELATION_GRANTS = Object.freeze([
  ['app_users', 'SELECT'],
  ['privacy_notices', 'SELECT'],
  ['notice_decisions', 'SELECT'],
  ['iteration_tasks', 'SELECT'],
  ['iteration_task_status_audits', 'SELECT'],
  ['policy_flags', 'SELECT'],
  ['notice_decisions', 'INSERT'],
  ['iteration_tasks', 'INSERT'],
] as const satisfies readonly RuntimeRelationGrant[]);

const SHARED_FUNCTION_GRANTS = Object.freeze([
  'public.start_iteration_task(text,integer,text,text)',
  'public.close_iteration_task(text,integer,text,text,text,text)',
  'public.rate_limit_take(text,double precision,double precision,double precision)',
  'public.idempotency_lookup(text,text,text,text,text)',
  'public.idempotency_request_hash_version(text,text,text)',
  'public.idempotency_claim(text,text,text,text,text,text,integer)',
  'public.idempotency_complete(text,text,text,bigint,integer,jsonb,boolean)',
  'public.idempotency_heartbeat(text,text,text,bigint,integer)',
] as const satisfies readonly RuntimeFunctionGrant[]);

export const RUNTIME_RELATION_GRANTS = Object.freeze([
  ...SHARED_RELATION_GRANTS,
  ...SEARCH_RELATION_GRANTS,
  ...CONTENT_RELATION_GRANTS,
  ...ANNOUNCE_RELATION_GRANTS,
]);

export const RUNTIME_COLUMN_GRANTS = CONTENT_COLUMN_GRANTS;

export const RUNTIME_FUNCTION_GRANTS = Object.freeze([
  ...CONTENT_FUNCTION_GRANTS,
  ...SEARCH_FUNCTION_GRANTS,
  ...ANNOUNCE_FUNCTION_GRANTS,
  ...SHARED_FUNCTION_GRANTS,
  ...OPS_FUNCTION_GRANTS,
]);

const RELATION_NAME = /^[a-z_][a-z0-9_]*$/;
const FUNCTION_SIGNATURE = /^[a-z_][a-z0-9_.]*\([a-z0-9_,[\] ]+\)$/;

function assertToken(value: string, pattern: RegExp, label: string): void {
  if (!pattern.test(value)) {
    throw new Error(`Unsafe runtime grant ${label}`);
  }
}

function renderRelationGrants(): string {
  return RUNTIME_RELATION_GRANTS.map(([relation, privilege]) => {
    assertToken(relation, RELATION_NAME, 'relation');
    assertToken(privilege, /^(SELECT|INSERT)$/, 'privilege');
    return `      ('${relation}', '${privilege}')`;
  }).join(',\n');
}

function renderColumnGrants(): string {
  return RUNTIME_COLUMN_GRANTS.map(([relation, column, privilege]) => {
    assertToken(relation, RELATION_NAME, 'relation');
    assertToken(column, RELATION_NAME, 'column');
    assertToken(privilege, /^SELECT$/, 'privilege');
    return `      ('${relation}', '${column}', '${privilege}')`;
  }).join(',\n');
}

function renderFunctionGrants(grants: readonly RuntimeFunctionGrant[] = RUNTIME_FUNCTION_GRANTS): string {
  return grants.map((signature) => {
    assertToken(signature, FUNCTION_SIGNATURE, 'function');
    return `      ('${signature}')`;
  }).join(',\n');
}

function renderSearchBoundaryFunctions(): string {
  return renderFunctionGrants(SEARCH_BOUNDARY_FUNCTIONS);
}

function renderSearchBoundaryViews(): string {
  return SEARCH_BOUNDARY_VIEWS.map((view) => {
    assertToken(view, RELATION_NAME, 'view');
    return `'${view}'`;
  }).join(', ');
}

export const RUNTIME_SCHEMA_PROBE_SQL = `
  WITH expected_runtime_relation_acl(relation_name, privilege_type) AS (
    VALUES
${renderRelationGrants()}
  ),
  expected_runtime_column_acl(relation_name, column_name, privilege_type) AS (
    VALUES
${renderColumnGrants()}
  ),
  expected_runtime_function_acl(signature) AS (
    VALUES
${renderFunctionGrants()}
  ),
  expected_search_functions(signature) AS (
    VALUES
${renderSearchBoundaryFunctions()}
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
      AND relation.relname IN (${renderSearchBoundaryViews()})
  )
  SELECT
    1::integer AS database_probe,
    pg_catalog.current_setting('server_version_num')::integer AS server_version_num,
    coalesce(
      pg_catalog.obj_description('public'::pg_catalog.regnamespace, 'pg_namespace'),
      ''
    ) AS schema_comment,
    coalesce(
      (
        SELECT pg_catalog.obj_description(namespace.oid, 'pg_namespace')
        FROM pg_catalog.pg_namespace namespace
        WHERE namespace.nspname = 'ops_loop'
      ),
      ''
    ) AS ops_loop_comment,
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
                guarded_schema.nspname NOT IN ('public', 'ops_loop')
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
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace ops_loop_schema
            JOIN LATERAL pg_catalog.aclexplode(ops_loop_schema.nspacl) acl ON true
            WHERE ops_loop_schema.nspname = 'ops_loop'
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
            SELECT pg_catalog.count(*) = ${SEARCH_BOUNDARY_MANIFEST_SIZE}
              AND pg_catalog.encode(
                pg_catalog.sha256(
                  pg_catalog.convert_to(
                    pg_catalog.string_agg(entry, E'\\n' ORDER BY entry),
                    'UTF8'
                  )
                ),
                'hex'
              ) = '${SEARCH_BOUNDARY_MANIFEST_SHA256}'
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
`

export const RUNTIME_POLICY_FLAGS_SQL = `
  WITH runtime_boundary AS MATERIALIZED (
    ${RUNTIME_SCHEMA_PROBE_SQL}
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
    AND (
      runtime_boundary.schema_comment LIKE ($1 || '%')
      OR (
        runtime_boundary.schema_comment LIKE ($2 || '%')
        AND position($3 in runtime_boundary.ops_loop_comment) > 0
      )
    )
    AND runtime_boundary.repository_boundary_present
    AND runtime_boundary.runtime_identity_safe
    AND runtime_boundary.runtime_effective_acl_safe
    AND runtime_boundary.runtime_search_boundary_safe
`

const EXPECTED_SCHEMA_PREFIX = `CS-AI-C11 ${CONTRACT_PROVENANCE.database_version};`;

export interface RuntimeSchemaProbeRow extends QueryResultRow {
  database_probe: number;
  server_version_num: number;
  schema_comment: string;
  ops_loop_comment: string;
  repository_boundary_present: boolean;
  runtime_identity_safe: boolean;
  runtime_effective_acl_safe: boolean;
  runtime_search_boundary_safe: boolean;
}

function schemaEvidenceMatches(
  row: Pick<RuntimeSchemaProbeRow, 'schema_comment' | 'ops_loop_comment'>,
): boolean {
  if (row.schema_comment.startsWith(EXPECTED_SCHEMA_PREFIX)) return true;
  return row.schema_comment.startsWith(LEGACY_PUBLIC_SCHEMA_V17_PREFIX)
    && opsLoopCommentCarriesDatabaseVersion(
      row.ops_loop_comment,
      CONTRACT_PROVENANCE.database_version,
    );
}

export function interpretRuntimeSchemaRow(row: RuntimeSchemaProbeRow | undefined): Readonly<{
  database: 'ok' | 'not_ready';
  schema: 'ok' | 'not_ready';
}> {
  if (row?.database_probe !== 1) {
    return Object.freeze({ database: 'not_ready', schema: 'not_ready' });
  }
  const schemaReady = Math.trunc(row.server_version_num / 10_000) === 15
    && schemaEvidenceMatches(row)
    && row.repository_boundary_present
    && row.runtime_identity_safe
    && row.runtime_effective_acl_safe
    && row.runtime_search_boundary_safe;
  return Object.freeze({
    database: 'ok',
    schema: schemaReady ? 'ok' : 'not_ready',
  });
}

export function runtimePolicyFlagParameters(): [string, string, string] {
  return [
    EXPECTED_SCHEMA_PREFIX,
    LEGACY_PUBLIC_SCHEMA_V17_PREFIX,
    CONTRACT_PROVENANCE.database_version,
  ];
}
