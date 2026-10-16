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
 * App-identity read of one person's job title and the enabled directory.
 * Any missing scope, transport error, or blank title returns null.
 * The caller keeps the login.
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
  const headers = { authorization: `Bearer ${tenantToken}` };
  const userResponse = await fetchImpl(
    `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,
    { method: 'GET', redirect: 'error', headers },
  );
  const userBody = record(await readJson(userResponse));
  const userData = userBody ? record(userBody.data) : null;
  const user = userData ? record(userData.user) : null;
  const title = user ? text(user.job_title, 64) : '';
  if (!title) return null;
  const directory: { name: string; enabled: boolean }[] = [];
  let pageToken = '';
  for (let page = 0; page < 4; page += 1) {
    const url = new URL('https://open.feishu.cn/open-apis/contact/v3/job_titles');
    url.searchParams.set('page_size', '50');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const jobsResponse = await fetchImpl(url.href, { method: 'GET', redirect: 'error', headers });
    const jobsBody = record(await readJson(jobsResponse));
    const data = jobsBody ? record(jobsBody.data) : null;
    const items = data && Array.isArray(data.items) ? data.items : null;
    if (!items) return null;
    for (const item of items) {
      const row = record(item);
      const name = row ? text(row.name, 64) : '';
      if (!name) continue;
      directory.push({ name, enabled: row?.status === true });
      if (directory.length >= 200) break;
    }
    const more = data?.has_more === true && typeof data.page_token === 'string';
    if (!more || directory.length >= 200) break;
    pageToken = data.page_token as string;
  }
  return { title, directory };
}
