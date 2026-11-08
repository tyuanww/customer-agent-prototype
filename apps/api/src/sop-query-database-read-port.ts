import type { PoolClient, QueryResultRow } from 'pg';
import type { SopQueryFailureCode, SopQueryReadPort } from './sop-query-operation.js';
import { isSopQueryReadResult } from './sop-query-validation.js';

/** Candidate SQL boundary. The function belongs to the uninstalled v1.30
 * storage candidate, so this port is deliberately not registered by the API factory. */
export const SOP_QUERY_READ_SQL = `SELECT content_intake.read_sop_query(
  $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::uuid
) AS value`;

type QueryRow = QueryResultRow & { value: unknown };
type QueryClient = Pick<PoolClient, 'query'>;

type ReadInput = Parameters<SopQueryReadPort['read']>[0];

function failure(code: SopQueryFailureCode): Readonly<{ ok: false; code: SopQueryFailureCode }> {
  return { ok: false, code };
}

function databaseFailure(error: unknown): SopQueryFailureCode {
  if (!error || typeof error !== 'object') return 'SOP_UNAVAILABLE';
  const message = Reflect.get(error, 'message');
  const detail = Reflect.get(error, 'detail');
  const reason = `${String(message)} ${String(detail)}`;
  if (reason.includes('SCOPE_DENIED')) return 'SCOPE_DENIED';
  if (reason.includes('IDEMPOTENCY_CONFLICT')) return 'IDEMPOTENCY_CONFLICT';
  if (reason.includes('SOP_BLOCKED')) return 'SOP_BLOCKED';
  if (reason.includes('SOP_STALE') || reason.includes('STALE_RELEASE')) return 'SOP_STALE';
  return 'SOP_UNAVAILABLE';
}

function queryValues(input: ReadInput): unknown[] {
  const { actor, request, session_token_hash: sessionTokenHash } = input;
  return [
    actor.user_id,
    sessionTokenHash,
    request.sop_group,
    request.shop_id,
    request.product_context?.type ?? null,
    request.product_context?.ref ?? null,
    request.query_text,
    request.context_generation,
    request.request_id,
  ];
}
/** Reads only the server-owned result union. Request identity is attached by the
 * operation owner after this port returns, so SQL cannot spoof it. */
export function createSopQueryDatabaseReadPort(client: QueryClient): SopQueryReadPort {
  return {
    async read(input) {
      if (input.session_token_hash === null) return failure('SCOPE_DENIED');
      try {
        const result = await client.query<QueryRow>(SOP_QUERY_READ_SQL, queryValues(input));
        const value = result.rows[0]?.value;
        return isSopQueryReadResult(value) ? value : failure('SOP_UNAVAILABLE');
      } catch (error) {
        return failure(databaseFailure(error));
      }
    },
  };
}
