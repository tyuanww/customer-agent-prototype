import { createHash, randomBytes } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';
import { parseContractSchema } from '@customer-agent/contracts';
import { bearerToken, type ProductAuthService, type MockCredentials } from './auth-service.js';
import type { ApiDatabaseBootstrapConfig } from './runtime-config.js';

export class IdentityFailure extends Error {
  constructor(readonly reason: 'LOGIN_INVALID' | 'LOGIN_EXPIRED' | 'LOGIN_CONSUMED' | 'SESSION_INVALID' | 'CAPABILITY_DENIED' | 'DEPENDENCY_UNAVAILABLE' | 'RATE_LIMITED' | 'REQUEST_INVALID') {
    super(reason);
  }
}

/** A trusted synthetic provider owns code consumption; client inputs never select a DB role. */
export type SyntheticIdentityProvider = Readonly<{
  authorizeUrl: (state: string) => string;
  exchange: (code: string) => Promise<string>;
  close: () => void;
}>;

const randomToken = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function identityFailure(error: unknown): IdentityFailure {
  if (error instanceof IdentityFailure) return error;
  if (error !== null && typeof error === 'object') {
    const code = Reflect.get(error, 'code');
    const message = Reflect.get(error, 'message');
    if (['ZA001', 'ZA003', 'ZA005'].includes(String(code))
      && ['LOGIN_INVALID', 'LOGIN_EXPIRED', 'LOGIN_CONSUMED', 'SESSION_INVALID', 'CAPABILITY_DENIED'].includes(String(message))) {
      return new IdentityFailure(message as IdentityFailure['reason']);
    }
  }
  return new IdentityFailure('DEPENDENCY_UNAVAILABLE');
}

interface IdentityRow extends QueryResultRow { user_id: string; role: string; subject_hash: string }
interface ExpiryRow extends QueryResultRow { expires_at: Date | null }

/** Owns the narrow auth capability pool and persistent login/session lifecycle. */
export async function createProductAuthService(
  config: ApiDatabaseBootstrapConfig,
  provider: SyntheticIdentityProvider,
): Promise<ProductAuthService> {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: 3_000,
    query_timeout: 3_500,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'cs-ai-synthetic-product-auth',
    maxLifetimeSeconds: 300,
  });
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let healthy = false;
  pool.on('error', () => { healthy = false; });

  async function query<Row extends QueryResultRow>(sql: string, values: unknown[] = []) {
    if (closed) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
    try {
      const client = await pool.connect();
      let failed = false;
      try {
        await client.query('BEGIN');
        const admission = await client.query<{ allowed: boolean }>(`SELECT
          login.rolcanlogin AND NOT login.rolsuper AND NOT login.rolcreatedb
          AND NOT login.rolcreaterole AND NOT login.rolreplication AND NOT login.rolbypassrls
          AND NOT capability.rolcanlogin AND NOT capability.rolsuper
          AND NOT capability.rolcreatedb AND NOT capability.rolcreaterole
          AND NOT capability.rolreplication AND NOT capability.rolbypassrls
          AND pg_has_role(login.oid, capability.oid, 'MEMBER')
          AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=login.oid AND m.roleid<>capability.oid)
          AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=capability.oid)
          AS allowed FROM pg_roles login CROSS JOIN pg_roles capability
          WHERE login.rolname=current_user AND capability.rolname='app_backend_auth'`);
        if (admission.rows[0]?.allowed !== true) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
        await client.query('SET LOCAL ROLE app_backend_auth');
        const result = await client.query<Row>(sql, values);
        await client.query('COMMIT');
        healthy = true;
        if (closed) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
        return result.rows;
      } catch (error) {
        // Unknown COMMIT results are not retried; the one-time exchange ledger
        // decides the next request. Rollback is only connection cleanup.
        try { await client.query('ROLLBACK'); } catch { failed = true; }
        throw error;
      } finally { client.release(failed); }
    } catch (error) {
      const failure = identityFailure(error);
      if (failure.reason === 'DEPENDENCY_UNAVAILABLE') healthy = false;
      throw failure;
    }
  }

  try { await query('SELECT 1'); } catch (error) {
    provider.close();
    await pool.end();
    throw error;
  }

  return Object.freeze({
    kind: 'product' as const,
    async createLogin(challenge: string) {
      const loginId = `login_${randomToken()}`;
      const state = randomToken();
      // statement_timestamp precedes create_login's internal clock; advertise a
      // conservative deadline without SELECT privileges on private login rows.
      const rows = await query<ExpiryRow>(`SELECT backend_identity.create_login($1,$2,$3),
        statement_timestamp() + interval '5 minutes' AS expires_at`, [loginId, digest(state), challenge]);
      return parseContractSchema('LoginCreated', {
        login_id: loginId,
        authorize_url: provider.authorizeUrl(state),
        expires_at: rows[0]?.expires_at?.toISOString(),
      });
    },
    async callback(state: string, code: string | undefined) {
      const rows = await query<{ login_id: string }>('SELECT backend_identity.begin_callback($1) AS login_id', [state]);
      const loginId = rows[0]?.login_id;
      if (!loginId) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      // Commit state consumption before provider I/O. A crash leaves exchanging,
      // which expires; neither code nor state is silently retried.
      let binding: string | null = null;
      let providerFailure: IdentityFailure | undefined;
      if (code !== undefined) {
        try { binding = await provider.exchange(code); } catch (error) { providerFailure = identityFailure(error); }
      }
      await query('SELECT backend_identity.complete_callback($1,$2)', [loginId, binding]);
      if (providerFailure) throw providerFailure;
      if (binding === null) throw new IdentityFailure('LOGIN_INVALID');
    },
    async exchange(loginId: string, verifier: string) {
      const token = randomToken();
      const rows = await query<ExpiryRow>('SELECT backend_identity.exchange($1,$2,$3) AS expires_at', [loginId, verifier, token]);
      if (rows[0]?.expires_at === null) return null;
      if (!rows[0]?.expires_at) throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
      return parseContractSchema('LoginSession', {
        access_token: token, token_type: 'Bearer', expires_at: rows[0].expires_at.toISOString(),
      });
    },
    async authenticate(credentials: MockCredentials) {
      if (credentials.mockUser !== undefined || credentials.mockRole !== undefined
        || typeof credentials.authorization !== 'string') return null;
      const token = bearerToken(credentials.authorization);
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      try {
        const rows = await query<IdentityRow>('SELECT * FROM backend_identity.actor($1)', [token]);
        const actor = rows[0];
        if (!actor) return null;
        // auth_mode describes the synthetic identity source, not permission to
        // accept mock headers. Product-session routing is a separate boundary.
        return parseContractSchema('CurrentUserResponse', { user_id: actor.user_id, role: actor.role, auth_mode: 'mock' });
      } catch (error) {
        if (error instanceof IdentityFailure && error.reason === 'SESSION_INVALID') return null;
        throw error;
      }
    },
    async logout(token: string) {
      await query('SELECT backend_identity.logout($1)', [token]);
    },
    readiness: () => !closed && healthy ? 'ok' as const : 'not_ready' as const,
    close() {
      if (!closePromise) {
        closed = true;
        provider.close();
        closePromise = pool.end();
      }
      return closePromise;
    },
  });
}
