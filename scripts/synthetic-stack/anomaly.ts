/**
 * Controlled business-anomaly injection for the synthetic stack.
 *
 * These commands exist so the failure paths in the macOS goal can be exercised
 * on real hardware, one at a time, against the real chain — not simulated in a
 * unit test:
 *
 *   source-suspend   suspend an authoritative source, so search must refuse
 *   session-revoke   revoke every active session, so the client must re-login
 *
 * Both use the governed entrypoints the real operator path uses (owner-only,
 * audited). Neither writes business content directly.
 *
 * IMPORTANT — suspension is intentionally irreversible in the frozen schema:
 * `authoritative_source_suspensions` has an immutability trigger and no release
 * column, so a suspended source stays suspended for the life of the database.
 * To return the stack to a healthy state after `source-suspend`, rebuild it:
 *
 *   node scripts/synthetic-stack/stack.ts destroy && node scripts/synthetic-stack/stack.ts start
 *
 * The command prints that instruction so the recovery path is never guessed.
 */
import { Client } from 'pg';
import { DATABASE_NAME, PG_PORT, PG_SOCKET_DIRECTORY } from './profile.ts';

const OWNER_USER_ID = 'usr_synthetic_owner';
const OWNER_ROLE = 'owner';

function adminClient(): Client {
  return new Client({ host: PG_SOCKET_DIRECTORY, port: PG_PORT, user: 'stack_owner', database: DATABASE_NAME });
}

export type AnomalyResult = Readonly<{ action: string; detail: string; recovery: string }>;

const REBUILD = 'node scripts/synthetic-stack/stack.ts destroy && node scripts/synthetic-stack/stack.ts start';

/** Suspend one seeded source so the runtime search gate must refuse it. */
export async function suspendSource(sourceVersionId: string): Promise<AnomalyResult> {
  const client = adminClient();
  await client.connect();
  try {
    const exists = await client.query(
      'SELECT 1 FROM public.authoritative_source_versions WHERE source_version_id = $1', [sourceVersionId],
    );
    if (exists.rowCount === 0) {
      const known = await client.query('SELECT source_version_id FROM public.authoritative_source_versions ORDER BY source_version_id');
      throw new Error(`Unknown source_version_id ${sourceVersionId}. Known: ${known.rows.map((row) => String(row.source_version_id)).join(', ')}`);
    }
    await client.query(
      "SELECT public.suspend_authoritative_source($1,'SOURCE_REVOKED','EVD-STACK-ANOMALY',$2,$3)",
      [sourceVersionId, OWNER_USER_ID, OWNER_ROLE],
    );
    return Object.freeze({
      action: 'source-suspend',
      detail: `${sourceVersionId} suspended; search must now refuse candidates from it`,
      recovery: `Suspension is permanent for this database. To restore: ${REBUILD}`,
    });
  } finally {
    await client.end();
  }
}

/** Revoke all product sessions so the next authenticated call must fail. */
export async function revokeSessions(): Promise<AnomalyResult> {
  const client = adminClient();
  await client.connect();
  try {
    const revoked = await client.query(
      `UPDATE backend_identity.sessions SET revoked_at = clock_timestamp()
       WHERE revoked_at IS NULL RETURNING token_hash`,
    );
    return Object.freeze({
      action: 'session-revoke',
      detail: `${String(revoked.rowCount ?? 0)} session(s) revoked; the client must return to the login state`,
      recovery: 'Log in again in the client (合成登录). No stack rebuild needed.',
    });
  } finally {
    await client.end();
  }
}

/** Report the anomaly-relevant state so a human can confirm what is set. */
export async function anomalyStatus(): Promise<readonly string[]> {
  const client = adminClient();
  await client.connect();
  try {
    const lines: string[] = [];
    const suspensions = await client.query(
      `SELECT source_version_id, reason_code FROM public.authoritative_source_suspensions
       ORDER BY source_version_id`,
    );
    lines.push(suspensions.rowCount === 0
      ? 'suspended sources: none'
      : `suspended sources: ${suspensions.rows.map((row) => `${String(row.source_version_id)}(${String(row.reason_code)})`).join(', ')}`);
    const sessions = await client.query('SELECT count(*)::int AS n FROM backend_identity.sessions WHERE revoked_at IS NULL');
    lines.push(`active sessions: ${String(sessions.rows[0]?.n ?? 0)}`);
    const releases = await client.query('SELECT release_id, release_seq FROM public.content_releases ORDER BY release_seq DESC LIMIT 3');
    lines.push(`recent releases: ${releases.rows.map((row) => `${String(row.release_id)}#${String(row.release_seq)}`).join(', ')}`);
    return Object.freeze(lines);
  } finally {
    await client.end();
  }
}
