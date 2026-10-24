import type { QueryResultRow } from 'pg';
import { IdentityFailure } from './product-auth-service.js';

// Feishu open_id to an existing binding. The callback does not choose a principal.
export type AttachFeishuLoginStatus =
  | 'attached'
  | 'already-attached'
  | 'already-split'
  | 'principal-missing'
  | 'login-invalid';

export type AttachFeishuLoginRequest = Readonly<{
  openId: string;
  principalId: string;
}>;

type AuthQuery = <Row extends QueryResultRow>(
  sql: string,
  values?: unknown[],
) => Promise<readonly Row[]>;

type BusinessClient = {
  query: <T extends QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: T[] }>;
};

const ATTACH_STATUSES: readonly AttachFeishuLoginStatus[] = [
  'attached',
  'already-attached',
  'already-split',
  'principal-missing',
  'login-invalid',
];

export function parseAttachFeishuLoginStatus(value: string): AttachFeishuLoginStatus {
  if ((ATTACH_STATUSES as readonly string[]).includes(value)) return value as AttachFeishuLoginStatus;
  throw new Error('attach status invalid');
}

export async function establishFeishuLogin(
  query: AuthQuery,
  loginId: string,
  openId: string,
): Promise<string> {
  const rows = await query<{ binding_id: string }>(
    'SELECT backend_identity.establish_feishu_login($1,$2) AS binding_id',
    [loginId, openId],
  );
  const bindingId = rows[0]?.binding_id;
  if (typeof bindingId !== 'string' || bindingId.length === 0) {
    throw new IdentityFailure('DEPENDENCY_UNAVAILABLE');
  }
  return bindingId;
}

export async function attachFeishuLogin(
  client: BusinessClient,
  request: AttachFeishuLoginRequest,
): Promise<AttachFeishuLoginStatus> {
  const result = await client.query<{ status: string }>(
    'SELECT backend_identity.attach_feishu_login($1,$2) AS status',
    [request.openId, request.principalId],
  );
  return parseAttachFeishuLoginStatus(result.rows[0]?.status ?? '');
}
