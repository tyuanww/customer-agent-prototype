import { Pool, type QueryResultRow } from 'pg';
import type { components } from '@customer-agent/contracts/generated';
import {
  createApiRuntimeDiagnostic,
  reportApiRuntimeDiagnostic,
  type ApiRuntimeDiagnosticSink,
} from './runtime-diagnostics.js';
import type { ApiDatabaseBootstrapConfig } from './runtime-config.js';

type UserClaims = components['schemas']['UserClaims'];
type PolicyFlagUpdateRequest = components['schemas']['PolicyFlagUpdateRequest'];
type PolicyAdminPool = Pick<Pool, 'query' | 'end' | 'on'>;

export type PolicyAdminFailureCode =
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'POLICY_DENIED'
  | 'OVERLOADED'
  | 'INTERNAL';

export type PolicyAdminUpdateResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: PolicyAdminFailureCode }>;

export type PolicyAdminRepository = Readonly<{
  setPolicyFlag: (
    actor: UserClaims,
    update: PolicyFlagUpdateRequest,
  ) => Promise<PolicyAdminUpdateResult>;
  close: () => Promise<void>;
}>;

interface PolicyUpdateRow extends QueryResultRow {
  updated: boolean;
}

const SET_POLICY_FLAG = `
  WITH roles AS MATERIALIZED (
    SELECT
      login.oid AS login_oid,
      login.rolcanlogin AS login_can_login,
      login.rolsuper AS login_super,
      login.rolcreatedb AS login_create_db,
      login.rolcreaterole AS login_create_role,
      login.rolreplication AS login_replication,
      login.rolbypassrls AS login_bypass_rls,
      capability.oid AS capability_oid,
      capability.rolcanlogin AS capability_can_login,
      capability.rolsuper AS capability_super,
      capability.rolcreatedb AS capability_create_db,
      capability.rolcreaterole AS capability_create_role,
      capability.rolreplication AS capability_replication,
      capability.rolbypassrls AS capability_bypass_rls,
      definer.oid AS definer_oid,
      definer.rolcanlogin AS definer_can_login,
      definer.rolsuper AS definer_super,
      definer.rolcreatedb AS definer_create_db,
      definer.rolcreaterole AS definer_create_role,
      definer.rolreplication AS definer_replication,
      definer.rolbypassrls AS definer_bypass_rls
    FROM pg_catalog.pg_roles login
    CROSS JOIN pg_catalog.pg_roles capability
    CROSS JOIN pg_catalog.pg_roles definer
    WHERE login.rolname = session_user
      AND capability.rolname = 'app_content_admin'
      AND definer.rolname = 'cs_ai_definer'
  ), policy_function AS MATERIALIZED (
    SELECT
      policy_proc.oid,
      policy_proc.proowner,
      policy_proc.prosecdef,
      policy_proc.provolatile,
      policy_proc.proconfig,
      policy_proc.proacl
    FROM pg_catalog.pg_proc policy_proc
    WHERE policy_proc.oid = pg_catalog.to_regprocedure(
      'public.set_policy_flag(text,boolean,text,text,text)'
    )
  ), identity AS MATERIALIZED (
    SELECT
      current_user = session_user
      AND roles.login_can_login
      AND NOT roles.login_super
      AND NOT roles.login_create_db
      AND NOT roles.login_create_role
      AND NOT roles.login_replication
      AND NOT roles.login_bypass_rls
      AND NOT roles.capability_can_login
      AND NOT roles.capability_super
      AND NOT roles.capability_create_db
      AND NOT roles.capability_create_role
      AND NOT roles.capability_replication
      AND NOT roles.capability_bypass_rls
      AND NOT roles.definer_can_login
      AND NOT roles.definer_super
      AND NOT roles.definer_create_db
      AND NOT roles.definer_create_role
      AND NOT roles.definer_replication
      AND NOT roles.definer_bypass_rls
      AND pg_catalog.current_setting('session_replication_role') = 'origin'
      AND pg_catalog.pg_has_role(session_user, roles.capability_oid, 'MEMBER')
      AND NOT pg_catalog.pg_has_role(session_user, 'app_runtime', 'MEMBER')
      AND (
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            membership.roleid = roles.capability_oid
            AND NOT membership.admin_option
          )
        FROM pg_catalog.pg_auth_members membership
        WHERE membership.member = roles.login_oid
      )
      AND (
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            membership.member = roles.login_oid
            AND NOT membership.admin_option
          )
        FROM pg_catalog.pg_auth_members membership
        WHERE membership.roleid = roles.capability_oid
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles unexpected_role
        WHERE unexpected_role.oid NOT IN (roles.login_oid, roles.capability_oid)
          AND pg_catalog.pg_has_role(session_user, unexpected_role.oid, 'MEMBER')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members membership
        WHERE membership.roleid = roles.login_oid
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members membership
        WHERE membership.member = roles.capability_oid
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members membership
        WHERE membership.roleid = roles.definer_oid
           OR membership.member = roles.definer_oid
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_parameter_acl parameter_acl
        JOIN LATERAL pg_catalog.aclexplode(parameter_acl.paracl) acl ON true
        WHERE acl.grantee IN (
          0,
          roles.login_oid,
          roles.capability_oid,
          roles.definer_oid
        )
      )
      AND policy_function.proowner = roles.definer_oid
      AND policy_function.prosecdef
      AND policy_function.provolatile = 'v'
      AND policy_function.proconfig = ARRAY[
        'search_path=pg_catalog, public, pg_temp'
      ]::text[]
      AND (
        SELECT pg_catalog.count(*) = 2
          AND pg_catalog.bool_and(
            acl.privilege_type = 'EXECUTE'
            AND NOT acl.is_grantable
            AND acl.grantee IN (roles.definer_oid, roles.capability_oid)
          )
          AND pg_catalog.count(*) FILTER (
            WHERE acl.grantee = roles.definer_oid
          ) = 1
          AND pg_catalog.count(*) FILTER (
            WHERE acl.grantee = roles.capability_oid
          ) = 1
        FROM pg_catalog.aclexplode(policy_function.proacl) acl
      )
      -- md5(text) is a built-in available to the low-privilege login. Here it
      -- is a deterministic drift fingerprint, not a password primitive.
      AND pg_catalog.md5(
        pg_catalog.pg_get_functiondef(policy_function.oid)
      ) = '147b780f84b193d86da32679943dc70b' AS safe
    FROM roles
    CROSS JOIN policy_function
  ), applied AS MATERIALIZED (
    SELECT public.set_policy_flag($1, $2, $3, $4, $5)
    FROM identity
    WHERE safe
  )
  SELECT pg_catalog.count(*) = 1 AS updated FROM applied
`;

const TRANSIENT_DRIVER_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOENT',
  'EPIPE',
  'ETIMEDOUT',
]);

const TRANSIENT_DRIVER_MESSAGES = new Set([
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
  'Cannot use a pool after calling end on the pool',
  'Connection terminated',
  'Connection terminated due to connection timeout',
  'Connection terminated unexpectedly',
  'Query read timeout',
  'timeout exceeded when trying to connect',
]);

function databaseFailureCode(error: unknown): PolicyAdminFailureCode {
  if (error === null || typeof error !== 'object') return 'INTERNAL';
  const code = Reflect.get(error, 'code');
  const detail = Reflect.get(error, 'detail');
  const message = Reflect.get(error, 'message');
  if (code === 'ZA001' && detail === 'VALIDATION') return 'VALIDATION';
  if (code === 'ZA004' && detail === 'POLICY_DENIED') return 'POLICY_DENIED';
  if ((code === 'ZA005' && detail === 'FORBIDDEN') || code === '42501') return 'FORBIDDEN';
  if (
    typeof code === 'string'
    && (
      code.startsWith('08')
      || code.startsWith('53')
      || code === '55P03'
      || code === '57014'
      || code === '57P01'
      || code === '57P02'
      || code === '57P03'
      || TRANSIENT_DRIVER_CODES.has(code)
    )
  ) {
    return 'OVERLOADED';
  }
  if (typeof message === 'string' && TRANSIENT_DRIVER_MESSAGES.has(message)) return 'OVERLOADED';
  return 'INTERNAL';
}

class PostgresPolicyAdminRepository implements PolicyAdminRepository {
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(
    private readonly pool: PolicyAdminPool,
    private readonly diagnosticSink: ApiRuntimeDiagnosticSink,
  ) {
    this.pool.on('error', (error) => {
      this.report('POLICY_ADMIN_IDLE_CLIENT_FAILED', error);
    });
  }

  async setPolicyFlag(
    actor: UserClaims,
    update: PolicyFlagUpdateRequest,
  ): Promise<PolicyAdminUpdateResult> {
    if (this.closed) return Object.freeze({ ok: false, code: 'OVERLOADED' });
    try {
      const result = await this.pool.query<PolicyUpdateRow>(SET_POLICY_FLAG, [
        update.flag_key,
        update.flag_value,
        actor.user_id,
        actor.role,
        update.adr_id,
      ]);
      if (this.closed) return Object.freeze({ ok: false, code: 'OVERLOADED' });
      if (result.rows[0]?.updated !== true) {
        return Object.freeze({ ok: false, code: 'FORBIDDEN' });
      }
      return Object.freeze({ ok: true });
    } catch (error: unknown) {
      this.report('POLICY_ADMIN_WRITE_FAILED', error);
      return Object.freeze({ ok: false, code: databaseFailureCode(error) });
    }
  }

  close(): Promise<void> {
    if (this.closePromise === null) {
      this.closed = true;
      this.closePromise = this.pool.end();
    }
    return this.closePromise;
  }

  private report(
    code: 'POLICY_ADMIN_IDLE_CLIENT_FAILED' | 'POLICY_ADMIN_WRITE_FAILED',
    error?: unknown,
  ): void {
    try {
      this.diagnosticSink(createApiRuntimeDiagnostic(code, error));
    } catch {
      // Diagnostics are observational and cannot change authorization or persistence.
    }
  }
}

export function createPolicyAdminRepository(
  config: ApiDatabaseBootstrapConfig,
  diagnosticSink: ApiRuntimeDiagnosticSink = reportApiRuntimeDiagnostic,
): PolicyAdminRepository {
  return createPolicyAdminRepositoryForPool(new Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    query_timeout: config.readinessTimeoutMs,
    statement_timeout: config.readinessTimeoutMs,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'cs-ai-api-policy-admin',
    maxLifetimeSeconds: 300,
  }), diagnosticSink);
}

/** Internal deterministic test seam; not exported from the package entrypoint. */
export function createPolicyAdminRepositoryForPool(
  pool: PolicyAdminPool,
  diagnosticSink: ApiRuntimeDiagnosticSink = () => undefined,
): PolicyAdminRepository {
  return new PostgresPolicyAdminRepository(pool, diagnosticSink);
}

export function createUnavailablePolicyAdminRepository(): PolicyAdminRepository {
  return Object.freeze({
    setPolicyFlag: async () => Object.freeze({ ok: false, code: 'OVERLOADED' }),
    close: async () => undefined,
  });
}
