import {
  createPasswordAccountFile, seatAccountFilePath, seatBindingId, seatUserId, seatUsername,
  type PasswordAccountFile,
} from './seat-accounts.js';
import { clock, IntakeRejection, lockProductSession, type IntakePool, type IntakeTransaction } from './transaction.js';
import type { AuthenticatedUser } from '../auth-service.js';

/**
 * Seat administration on the server, replacing the desktop app spawning a local script.
 *
 * A seat is three rows plus one password file entry, and the four must agree or the account is
 * broken in a way nobody can see from the UI:
 *
 *   subject_bindings  lets the password exchange produce a binding at all
 *   principals        gives the binding a principal, which authorization reads
 *   seat_posts        records the post the operator assigned, which login turns into facts
 *   role_rules        maps that post to the role the ceiling checks
 *
 * `project_seat_login` renews the facts on every login from `seat_posts`, so the five-minute
 * window is no longer a five-minute account.
 *
 * No grant is written here. What a seat may reach stays the operator's decision, taken through
 * the ordinary grant path, so creating a seat cannot quietly hand out authority.
 */
export const SEAT_POSTS = Object.freeze({
  客服: Object.freeze({ jobId: 'job-seat', role: 'agent' as const, sessionRole: 'agent' as const }),
  客服主管: Object.freeze({ jobId: 'job-seat-supervisor', role: 'supervisor' as const, sessionRole: 'coach' as const }),
});
export type SeatPost = keyof typeof SEAT_POSTS;

export type SeatView = Readonly<{
  displayName: string;
  username: string;
  post: SeatPost | null;
  enabled: boolean;
}>;

const TENANT = 'tenant-menokin';
const APP = 'app-customer-agent';
const DEPARTMENT = 'dept-menokin';
const IDENTITY_SCOPE = 'confirmed-synthetic';

export function isSeatPost(value: unknown): value is SeatPost {
  return typeof value === 'string' && value in SEAT_POSTS;
}

type SeatCommand = Readonly<{ username: string }>;

type CreateSeat = SeatCommand & Readonly<{ displayName: string; password: string; post: SeatPost }>;
type ResetSeat = SeatCommand & Readonly<{ password: string }>;

/** Every seat input problem is the same public refusal: the request is malformed. Naming a
 *  field distinction here would tell an unauthorised caller which field to try next. */
function invalid(): IntakeRejection {
  return new IntakeRejection('FILE_INVALID', 'VALIDATION');
}

export type SeatService = Readonly<{
  list: (actor: AuthenticatedUser) => Promise<readonly SeatView[]>;
  create: (actor: AuthenticatedUser, input: unknown) => Promise<SeatView>;
  reset: (actor: AuthenticatedUser, input: unknown) => Promise<SeatCommand>;
  disable: (actor: AuthenticatedUser, input: unknown) => Promise<SeatCommand>;
}>;

function parseCommand<T extends SeatCommand>(input: unknown, keys: readonly string[]): T {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw invalid();
  const username = seatUsername(record.username);
  if (!username) throw invalid();
  return { ...record, username } as T;
}

export function createSeatService(pool: IntakePool, passwordFile: PasswordAccountFile): SeatService {
  /** Every command runs inside one transaction that first locks the caller's product session
   *  and re-checks seat administration, so a revoked operator loses the door immediately. */
  async function withSeatAuthority<T>(actor: AuthenticatedUser, work: (client: IntakeTransaction, at: number) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let failed = false;
    try {
      await client.query('BEGIN');
      const transaction = client as unknown as IntakeTransaction;
      transaction.validUntil = (deadline: number) => { void deadline; };
      transaction.beforeCommit = (check: () => Promise<void>) => { void check; };
      await lockProductSession(transaction, actor);
      const now = await clock(transaction);
      const allowed = await transaction.query<{ allowed: boolean }>(
        `SELECT content_intake.may_administer_seats(
           (SELECT principal_id FROM content_intake.principals WHERE user_id = $1 LIMIT 1), $2::timestamptz) AS allowed`,
        [actor.user_id, new Date(now)],
      );
      if (allowed.rows[0]?.allowed !== true) throw new IntakeRejection('SCOPE_DENIED', 'FORBIDDEN');
      const value = await work(transaction, now);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      failed = true;
      try { await client.query('ROLLBACK'); } catch { /* the original error is the one to keep */ }
      throw error;
    } finally {
      client.release(failed);
    }
  }

  async function readSeats(client: IntakeTransaction): Promise<readonly SeatView[]> {
    const rows = await client.query<{
      principal_id: string; user_id: string; subject: string; enabled: boolean; job_id: string | null;
    }>(`
      SELECT person.principal_id, person.user_id, binding.subject, binding.enabled, post.job_id
        FROM backend_identity.subject_bindings binding
        JOIN content_intake.principals person ON person.user_id = binding.user_id
        LEFT JOIN content_intake.seat_posts post ON post.principal_id = person.principal_id
       WHERE person.tenant_id = $1 AND person.app_id = $2
         AND person.identity_scope = $3
       ORDER BY binding.binding_id`, [TENANT, APP, IDENTITY_SCOPE]);
    const byJob = new Map<string, SeatPost>(Object.entries(SEAT_POSTS).map(([post, value]) => [value.jobId, post as SeatPost]));
    return Object.freeze(rows.rows.map((row) => Object.freeze({
      displayName: row.subject,
      username: row.principal_id.startsWith('seat_') ? row.principal_id.slice('seat_'.length) : row.user_id,
      post: row.job_id ? byJob.get(row.job_id) ?? null : null,
      enabled: row.enabled,
    })));
  }

  return Object.freeze({
    async list(actor) {
      return withSeatAuthority(actor, (client) => readSeats(client));
    },

    async create(actor, input) {
      const command = parseCommand<CreateSeat>(input, ['displayName', 'username', 'password', 'post']);
      const displayName = typeof command.displayName === 'string' ? command.displayName.trim() : '';
      if (displayName.length < 1 || displayName.length > 256) throw invalid();
      if (!isSeatPost(command.post)) throw invalid();
      if (typeof command.password !== 'string' || command.password.length < 8 || command.password.length > 256) {
        throw invalid();
      }
      const post = SEAT_POSTS[command.post];
      const bindingId = seatBindingId(command.username);
      const userId = seatUserId(command.username);
      const principalId = `seat_${command.username}`;

      const view = await withSeatAuthority(actor, async (client) => {
        await client.query(`
          INSERT INTO backend_identity.subject_bindings(
            binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
          VALUES ($1, 'synthetic', 'synthetic-tenant', $2, $3, encode(sha256(convert_to($1, 'UTF8')), 'hex'), true, $4)
          ON CONFLICT (binding_id) DO UPDATE
            SET subject = EXCLUDED.subject, user_id = EXCLUDED.user_id,
                enabled = true, role = EXCLUDED.role
          WHERE backend_identity.subject_bindings.provider = 'synthetic'`,
        [bindingId, displayName, userId, post.sessionRole]);

        await client.query(`
          INSERT INTO content_intake.principals(
            principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version)
          VALUES ($1, $2, $3, $4, $5, $6, 0)
          ON CONFLICT (principal_id) DO UPDATE
            SET user_id = EXCLUDED.user_id, tenant_id = EXCLUDED.tenant_id, app_id = EXCLUDED.app_id
          WHERE content_intake.principals.identity_scope = EXCLUDED.identity_scope`,
        [principalId, userId, TENANT, APP, IDENTITY_SCOPE, `seat-${command.username}`]);

        await client.query(`
          INSERT INTO content_intake.seat_posts(
            principal_id, tenant_id, app_id, department_id, job_id, assigned_by)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (principal_id) DO UPDATE
            SET department_id = EXCLUDED.department_id, job_id = EXCLUDED.job_id,
                assigned_at = clock_timestamp(), assigned_by = EXCLUDED.assigned_by`,
        [principalId, TENANT, APP, DEPARTMENT, post.jobId, actor.user_id]);

        // The rule is shared by every seat on the same post, so a conflict is not an error.
        await client.query(`
          INSERT INTO content_intake.role_rules(tenant_id, app_id, department_id, job_id, policy_version, role)
          VALUES ($1, $2, $3, $4,
            (SELECT version FROM content_intake.policy_versions WHERE tenant_id = $1 AND app_id = $2), $5)
          ON CONFLICT DO NOTHING`,
        [TENANT, APP, DEPARTMENT, post.jobId, post.role]);

        return Object.freeze({
          displayName, username: command.username, post: command.post, enabled: true,
        }) satisfies SeatView;
      });

      // After the commit: a password with no rows behind it can log in and do nothing, while
      // rows with no password are inert. Writing the file second keeps the failure visible.
      passwordFile.upsert(command.username, bindingId, command.password);
      return view;
    },

    async reset(actor, input) {
      const command = parseCommand<ResetSeat>(input, ['username', 'password']);
      if (typeof command.password !== 'string' || command.password.length < 8 || command.password.length > 256) {
        throw invalid();
      }
      const bindingId = seatBindingId(command.username);
      await withSeatAuthority(actor, async (client) => {
        const found = await client.query<{ enabled: boolean }>(
          `SELECT enabled FROM backend_identity.subject_bindings WHERE binding_id = $1 AND provider = 'synthetic'`,
          [bindingId]);
        if (!found.rows[0]) throw invalid();
      });
      passwordFile.upsert(command.username, bindingId, command.password);
      return { username: command.username };
    },

    async disable(actor, input) {
      const command = parseCommand<SeatCommand>(input, ['username']);
      const bindingId = seatBindingId(command.username);
      await withSeatAuthority(actor, async (client) => {
        const updated = await client.query(
          `UPDATE backend_identity.subject_bindings SET enabled = false
            WHERE binding_id = $1 AND provider = 'synthetic' AND enabled
            RETURNING binding_id`, [bindingId]);
        if (updated.rowCount === 0) {
          const present = await client.query(
            `SELECT 1 FROM backend_identity.subject_bindings WHERE binding_id = $1 AND provider = 'synthetic'`,
            [bindingId]);
          // Already disabled is a success: the caller's intent is met and retrying is safe.
          if (!present.rows[0]) throw invalid();
        }
      });
      // A disabled binding already fails the exchange, so the password need not be removed. It
      // stays so re-enabling the same seat does not require a new password.
      return { username: command.username };
    },
  });
}

export function createSeatServiceFromEnv(pool: IntakePool, stackRoot: string): SeatService {
  return createSeatService(pool, createPasswordAccountFile(seatAccountFilePath(stackRoot)));
}
