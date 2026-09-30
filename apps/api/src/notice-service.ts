import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { parseContractSchema } from '@customer-agent/contracts';
import type { components } from '@customer-agent/contracts/generated';
import type { AuthenticatedUser } from './auth-service.js';

type CurrentNoticeResponse = components['schemas']['CurrentNoticeResponse'];
type NoticeDecisionResponse = components['schemas']['NoticeDecisionResponse'];
type NoticeDecision = components['schemas']['NoticeDecision'];

export type NoticeFailure = Readonly<{
  ok: false;
  code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'CONFLICT' | 'OVERLOADED' | 'INTERNAL';
}>;

export type NoticeService = Readonly<{
  current: (actor: AuthenticatedUser) => Promise<Readonly<{ ok: true; response: CurrentNoticeResponse }> | NoticeFailure>;
  recordDecision: (request: Readonly<{
    actor: AuthenticatedUser;
    version: string;
    decision: NoticeDecision;
    idempotencyKey: string;
  }>) => Promise<Readonly<{ ok: true; response: NoticeDecisionResponse }> | NoticeFailure>;
  /**
   * True when the current notice version has been ACCEPTED by this user. Used by the
   * collection write path: pilot_recorded requires server-side proof of acceptance, and
   * the frozen contract says an unavailable check must fail closed.
   */
  hasAcceptedCurrentNotice: (client: PoolClient, userId: string) => Promise<boolean>;
  close: () => Promise<void>;
}>;

interface NoticeRow extends QueryResultRow {
  notice_version: string;
  notice_text: string;
  content_hash: string;
  published_at: Date;
  decision: string | null;
  decided_at: Date | null;
}

interface DecisionRow extends QueryResultRow {
  notice_version: string;
  decision: string;
  decided_at: Date;
}

const failure = (code: NoticeFailure['code']): NoticeFailure => Object.freeze({ ok: false, code });

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function createNoticeServiceForPool(
  pool: Pick<Pool, 'connect' | 'end'>,
  ownsPool: boolean,
): NoticeService {
  /**
   * Runs as app_runtime. 0008 already grants it SELECT on privacy_notices and
   * SELECT+INSERT on notice_decisions, so no new capability role is needed; the
   * append-only audit shape is enforced by the table itself (decision is written
   * once per user/version and a differing decision is rejected with 409).
   */
  async function asRuntime<T>(work: (client: PoolClient) => Promise<T>): Promise<T | null> {
    const client = await pool.connect().catch(() => null);
    if (client === null) return null;
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_runtime');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      broken = true;
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release(broken);
    }
  }

  return Object.freeze({
    async current(actor) {
      try {
        const result = await asRuntime(async (client) => client.query<NoticeRow>(`
          SELECT n.notice_version, n.notice_text, n.content_hash, n.published_at,
                 d.decision, d.decided_at
          FROM public.privacy_notices n
          LEFT JOIN public.notice_decisions d
            ON d.notice_version = n.notice_version AND d.user_id = $1
          WHERE n.status = 'current'
        `, [actor.user_id]));
        if (result === null) return failure('OVERLOADED');
        const row = result.rows[0];
        // No current notice is a real state, not an error: nobody has published the
        // text yet. The client must then show nothing and pilot_recorded stays closed.
        if (row === undefined) return failure('NOT_FOUND');
        return Object.freeze({
          ok: true as const,
          response: parseContractSchema('CurrentNoticeResponse', {
            notice: {
              version: row.notice_version,
              content: row.notice_text,
              content_hash: row.content_hash,
              published_at: iso(row.published_at) as string,
            },
            decision: (row.decision as NoticeDecision | null) ?? null,
            decided_at: iso(row.decided_at),
          }),
        });
      } catch {
        return failure('INTERNAL');
      }
    },

    async recordDecision({ actor, version, decision }) {
      try {
        const result = await asRuntime(async (client) => {
          // Idempotency needs no separate key table here: notice_decisions is keyed by
          // (notice_version, user_id), so the audit row IS the idempotency record. A
          // replay of the same decision returns the first terminal state; a different
          // decision for the same version is refused rather than overwriting evidence.
          const current = await client.query<{ notice_version: string }>(
            "SELECT notice_version FROM public.privacy_notices WHERE status = 'current'",
          );
          const currentVersion = current.rows[0]?.notice_version;
          if (currentVersion === undefined || currentVersion !== version) {
            return Object.freeze({ kind: 'not_found' as const });
          }

          const existing = await client.query<DecisionRow>(
            'SELECT notice_version, decision, decided_at FROM public.notice_decisions WHERE notice_version = $1 AND user_id = $2',
            [version, actor.user_id],
          );
          const prior = existing.rows[0];
          if (prior !== undefined) {
            return prior.decision === decision
              ? Object.freeze({ kind: 'existing' as const, row: prior })
              : Object.freeze({ kind: 'conflict' as const });
          }

          const inserted = await client.query<DecisionRow>(`
            INSERT INTO public.notice_decisions(notice_version, user_id, decision, decision_source)
            VALUES ($1, $2, $3, 'first_run_prompt')
            RETURNING notice_version, decision, decided_at
          `, [version, actor.user_id, decision]);
          const row = inserted.rows[0];
          if (row === undefined) return Object.freeze({ kind: 'conflict' as const });
          return Object.freeze({ kind: 'inserted' as const, row });
        });

        if (result === null) return failure('OVERLOADED');
        if (result.kind === 'not_found') return failure('NOT_FOUND');
        if (result.kind === 'conflict') return failure('CONFLICT');
        const row = result.row as DecisionRow;
        const response = parseContractSchema('NoticeDecisionResponse', {
          ok: true,
          version,
          decision: row.decision as NoticeDecision,
          decided_at: iso(row.decided_at) as string,
        });
        return Object.freeze({ ok: true as const, response });
      } catch {
        return failure('INTERNAL');
      }
    },

    async hasAcceptedCurrentNotice(client, userId) {
      const rows = await client.query<{ accepted: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM public.privacy_notices n
          JOIN public.notice_decisions d
            ON d.notice_version = n.notice_version AND d.user_id = $1
          WHERE n.status = 'current' AND d.decision = 'accepted'
        ) AS accepted
      `, [userId]);
      return rows.rows[0]?.accepted === true;
    },

    close: () => (ownsPool ? pool.end() : Promise.resolve()),
  });
}
