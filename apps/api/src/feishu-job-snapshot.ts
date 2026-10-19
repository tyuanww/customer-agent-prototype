import { createHash } from 'node:crypto';

/** Job fact for the desktop rights table. Absence is unresolved, never a guessed title. */
export type FeishuJobSnapshot = Readonly<{
  title: string;
  directory: readonly { readonly name: string; readonly enabled: boolean }[];
}>;

const TENANT_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const snapshots = new Map<string, FeishuJobSnapshot>();
const sessionSubjects = new Map<string, string>();

export function subjectHash(openId: string): string {
  return createHash('sha256').update(openId).digest('hex');
}

export function rememberJobSnapshot(openId: string, snapshot: FeishuJobSnapshot): void {
  snapshots.set(subjectHash(openId), snapshot);
}

export function forgetJobSnapshot(openId: string): void {
  snapshots.delete(subjectHash(openId));
}

export function snapshotForOpenId(openId: string): FeishuJobSnapshot | null {
  return snapshots.get(subjectHash(openId)) ?? null;
}

export function bindSessionSubject(token: string, hash: string): void {
  sessionSubjects.set(createHash('sha256').update(token).digest('hex'), hash);
}

export function jobForToken(token: string): FeishuJobSnapshot | null {
  const hash = sessionSubjects.get(createHash('sha256').update(token).digest('hex'));
  if (!hash) return null;
  return snapshots.get(hash) ?? null;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) return null;
  return response.json();
}

/**
 * Collects the person's Feishu job title.
 * The desktop table decides which collected names have rights.
 * A blank title or a failed read returns null. The caller keeps the login.
 */
export async function readFeishuJobSnapshot(
  openId: string,
  config: Readonly<{ clientId: string; clientSecret: string }>,
  fetchImpl: typeof fetch,
): Promise<FeishuJobSnapshot | null> {
  const tokenResponse = await fetchImpl(TENANT_TOKEN_URL, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: config.clientId, app_secret: config.clientSecret }),
  });
  const tokenBody = record(await readJson(tokenResponse));
  const tenantToken = tokenBody && tokenBody.code === 0 ? text(tokenBody.tenant_access_token, 4096) : '';
  if (!tenantToken) return null;
  const userResponse = await fetchImpl(
    `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,
    { method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${tenantToken}` } },
  );
  const userBody = record(await readJson(userResponse));
  if (!userBody || userBody.code !== 0) return null;
  const userData = record(userBody.data);
  const user = userData ? record(userData.user) : null;
  const title = user ? text(user.job_title, 64) : '';
  if (!title) return null;
  return { title, directory: [{ name: title, enabled: true }] };
}
