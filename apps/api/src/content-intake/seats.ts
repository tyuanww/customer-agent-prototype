import { createSeatPasswordFile, seatPasswordFilePath, type SeatPasswordFile } from './seat-password-file.js';
import type { IntakePool, IntakeTransaction } from './transaction.js';

/**
 * Seat administration, forwarded to the privileged owner functions in migration 0067.
 *
 * This module holds no identity write of its own. `backend_identity.create_seat` and its siblings
 * are SECURITY DEFINER and owned by the cluster owner, which is the only role holding INSERT on
 * `subject_bindings` and `role_rules`. Forwarding is the whole job here.
 *
 * Two things this layer still owns, because they are not database state:
 *
 *   * the password entry, which lives in the identity server's file
 *   * the tenant, app and department the operator works in, which the API takes from its own
 *     configuration rather than from the request, so a caller cannot choose which home a seat
 *     lands in
 */
export type SeatView = Readonly<{
  displayName: string;
  username: string;
  post: string;
  enabled: boolean;
}>;

/** The refusal vocabulary these routes use. They sit outside the frozen OpenAPI bundle, the same
 *  way `GET /v1/auth/job` does, so the reasons are theirs and not the intake enum's. Every value
 *  here is something an operator can act on; anything else stays an internal failure. */
export const SEAT_REASONS = Object.freeze([
  'SEAT_INPUT_INVALID', 'SEAT_USERNAME_INVALID', 'SEAT_DISPLAY_NAME_INVALID',
  'SEAT_POST_INVALID', 'SEAT_PASSWORD_INVALID', 'SEAT_ROLE_NOT_IN_CEILING',
  'SEAT_HOME_INVALID', 'SEAT_HOME_UNKNOWN', 'SEAT_EXISTS',
  'SEAT_DISPLAY_NAME_TAKEN', 'SEAT_NOT_FOUND', 'SEAT_FORBIDDEN',
] as const);
export type SeatReason = (typeof SEAT_REASONS)[number];

export class SeatRefusal extends Error {
  constructor(readonly reason: SeatReason) { super(reason); }
}

const POSTS: readonly string[] = Object.freeze(['客服', '客服主管']);
const ACTIONABLE = new Set<string>(SEAT_REASONS);
const USERNAME = /^[A-Za-z0-9_-]{1,64}$/;

/** A database refusal that names a cause the operator can fix is re-raised as a SeatRefusal. A
 *  constraint violation or a permission error is not: reporting one of those as "wrong input"
 *  would send the operator chasing the wrong thing. */
function translated(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error) {
    const failure = error as { code?: string; message?: string };
    if (failure.code === 'ZA001' || failure.code === 'ZA003') {
      const reason = typeof failure.message === 'string' ? failure.message.split('\n')[0]!.trim() : '';
      if (ACTIONABLE.has(reason)) throw new SeatRefusal(reason as SeatReason);
    }
  }
  throw error;
}

function keysOnly(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SeatRefusal('SEAT_INPUT_INVALID');
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new SeatRefusal('SEAT_INPUT_INVALID');
  return record;
}

function usernameOf(value: unknown): string {
  if (typeof value !== 'string') throw new SeatRefusal('SEAT_USERNAME_INVALID');
  const trimmed = value.trim();
  if (!USERNAME.test(trimmed)) throw new SeatRefusal('SEAT_USERNAME_INVALID');
  return trimmed;
}

function passwordOf(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) {
    throw new SeatRefusal('SEAT_PASSWORD_INVALID');
  }
  return value;
}

export type SeatService = Readonly<{
  list: (actorId: string) => Promise<readonly SeatView[]>;
  create: (actorId: string, input: unknown) => Promise<SeatView>;
  reset: (actorId: string, input: unknown) => Promise<{ username: string }>;
  disable: (actorId: string, input: unknown) => Promise<{ username: string }>;
}>;

export function createSeatService(
  pool: IntakePool,
  passwordFile: SeatPasswordFile,
  home: Readonly<{ tenantId: string; appId: string; departmentId: string }>,
): SeatService {
  async function rows<T>(sql: string, values: readonly unknown[]): Promise<T[]> {
    const client = await pool.connect();
    const transaction = client as unknown as IntakeTransaction;
    let failed = false;
    try {
      const result = await transaction.query(sql, values as unknown[]);
      return result.rows as T[];
    } catch (error) {
      failed = true;
      translated(error);
    } finally {
      client.release(failed);
    }
  }

  async function requireAdministrator(actorId: string): Promise<void> {
    const found = await rows<{ allowed: boolean }>(
      'SELECT content_intake.seat_administration_allowed($1) AS allowed', [actorId]);
    if (found[0]?.allowed !== true) throw new SeatRefusal('SEAT_FORBIDDEN');
  }

  async function list(): Promise<readonly SeatView[]> {
    const found = await rows<{ out_username: string; out_display_name: string; out_post: string; out_enabled: boolean }>(
      'SELECT * FROM backend_identity.list_seats($1,$2)', [home.tenantId, home.appId]);
    return Object.freeze(found.map((row) => Object.freeze({
      displayName: row.out_display_name,
      username: row.out_username,
      post: row.out_post,
      enabled: row.out_enabled,
    })));
  }

  return Object.freeze({
    async list(actorId) {
      await requireAdministrator(actorId);
      return list();
    },

    async create(actorId, input) {
      await requireAdministrator(actorId);
      const record = keysOnly(input, ['displayName', 'username', 'password', 'post']);
      const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : '';
      if (displayName.length < 1 || displayName.length > 256) throw new SeatRefusal('SEAT_DISPLAY_NAME_INVALID');
      const username = usernameOf(record.username);
      const post = typeof record.post === 'string' && POSTS.includes(record.post) ? record.post : null;
      if (!post) throw new SeatRefusal('SEAT_POST_INVALID');
      const password = passwordOf(record.password);

      const created = await rows<{ out_job_id: string }>(
        'SELECT * FROM backend_identity.create_seat($1,$2,$3,$4,$5,$6,$7)',
        [username, displayName, post, home.tenantId, home.appId, home.departmentId, actorId]);
      if (!created[0]) throw new SeatRefusal('SEAT_INPUT_INVALID');

      // The identity rows are committed first. A crash here leaves a seat that exists and cannot
      // log in, which the list shows and a reset repairs; the reverse order would leave a working
      // password for a binding that was rolled back.
      passwordFile.upsert(username, `synthetic_seat_${username}`, password);
      return Object.freeze({ displayName, username, post, enabled: true });
    },

    async reset(actorId, input) {
      await requireAdministrator(actorId);
      // The HTTP route puts the path username into this object after rejecting a body copy.
      // Dropping it here made every reset look like a bad request.
      const record = keysOnly(input, ['username', 'password']);
      const username = usernameOf(record.username);
      const password = passwordOf(record.password);
      // Reset writes no database state, so existence comes from the list the operator reads.
      if (!(await list()).some((seat) => seat.username === username)) throw new SeatRefusal('SEAT_NOT_FOUND');
      passwordFile.upsert(username, `synthetic_seat_${username}`, password);
      return { username };
    },

    async disable(actorId, input) {
      await requireAdministrator(actorId);
      const record = keysOnly(input, ['username']);
      const username = usernameOf(record.username);
      await rows('SELECT backend_identity.disable_seat($1,$2,$3)', [username, home.tenantId, home.appId]);
      return { username };
    },
  });
}

/** The tenant and app are the API's own configuration, never a request field. */
export function seatHome(env: Readonly<Record<string, string | undefined>>): { tenantId: string; appId: string; departmentId: string } {
  const tenantId = env.SEAT_TENANT_ID?.trim() || env.ROSTER_TENANT_ID?.trim() || '';
  const appId = env.SEAT_APP_ID?.trim() || env.ROSTER_APP_ID?.trim() || '';
  const departmentId = env.SEAT_DEPARTMENT_ID?.trim() || 'dept-menokin';
  if (!tenantId || !appId) throw new Error('seat home is not configured');
  return { tenantId, appId, departmentId };
}

export function createSeatServiceFromEnv(
  pool: IntakePool,
  stackRoot: string,
  env: Readonly<Record<string, string | undefined>>,
): SeatService {
  return createSeatService(pool, createSeatPasswordFile(seatPasswordFilePath(stackRoot)), seatHome(env));
}
