import { createHash } from 'node:crypto';

/** Job fact for the desktop rights table. Absence is unresolved, never a guessed title. */
export type FeishuJobSnapshot = Readonly<{
  title: string;
  directory: readonly { readonly name: string; readonly enabled: boolean }[];
}>;

const TENANT_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const JOBS_URL = 'https://open.feishu.cn/open-apis/contact/v3/job_titles';
/** Feishu allows 10 job-title list calls per minute. Pages are 50 rows and must stay in order. */
const PAGE_BUDGET = 8;
const PAGE_LIMIT = 40;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const snapshots = new Map<string, FeishuJobSnapshot>();
const pendingTitles = new Map<string, string>();
const sessionSubjects = new Map<string, string>();
const directory: {
  rows: { name: string; enabled: boolean }[];
  pageToken: string;
  pages: number;
  done: boolean;
  failed: boolean;
  calls: number[];
} = { rows: [], pageToken: '', pages: 0, done: false, failed: false, calls: [] };
let chain: Promise<unknown> = Promise.resolve();
let warming = false;

export function resetFeishuJobObservationForTests(): void {
  snapshots.clear();
  pendingTitles.clear();
  sessionSubjects.clear();
  directory.rows = [];
  directory.pageToken = '';
  directory.pages = 0;
  directory.done = false;
  directory.failed = false;
  directory.calls = [];
  warming = false;
  chain = Promise.resolve();
}

export function subjectHash(openId: string): string {
  return createHash('sha256').update(openId).digest('hex');
}

export function rememberJobSnapshot(openId: string, snapshot: FeishuJobSnapshot): void {
  snapshots.set(subjectHash(openId), snapshot);
}

export function forgetJobSnapshot(openId: string): void {
  const hash = subjectHash(openId);
  snapshots.delete(hash);
  pendingTitles.delete(hash);
}

export function bindSessionSubject(token: string, hash: string): void {
  sessionSubjects.set(createHash('sha256').update(token).digest('hex'), hash);
}

export function jobForToken(token: string): FeishuJobSnapshot | null {
  const hash = sessionSubjects.get(createHash('sha256').update(token).digest('hex'));
  if (!hash) return null;
  const existing = snapshots.get(hash);
  if (existing) return existing;
  const title = pendingTitles.get(hash);
  if (!title || !directory.done) return null;
  const snapshot = publish(hash, title);
  return snapshot;
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

function publish(hash: string, title: string): FeishuJobSnapshot {
  const snapshot: FeishuJobSnapshot = {
    title,
    directory: directory.rows.map((row) => ({ name: row.name, enabled: row.enabled })),
  };
  snapshots.set(hash, snapshot);
  pendingTitles.delete(hash);
  return snapshot;
}

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function rateSlot(now: number): boolean {
  directory.calls = directory.calls.filter((call) => now - call < RATE_WINDOW_MS);
  return directory.calls.length < RATE_LIMIT;
}

function rateWaitMs(now: number): number {
  directory.calls = directory.calls.filter((call) => now - call < RATE_WINDOW_MS);
  const oldest = directory.calls[0];
  if (oldest === undefined || directory.calls.length < RATE_LIMIT) return 0;
  return Math.max(0, oldest + RATE_WINDOW_MS - now) + 50;
}

type WalkStep = 'done' | 'partial' | 'rate' | 'failed';

async function pullPages(
  fetchImpl: typeof fetch,
  headers: Readonly<{ authorization: string }>,
  budget: number,
): Promise<WalkStep> {
  if (directory.done) return 'done';
  if (directory.failed) return 'failed';
  for (let step = 0; step < budget; step += 1) {
    const now = Date.now();
    if (!rateSlot(now)) return 'rate';
    const url = new URL(JOBS_URL);
    url.searchParams.set('page_size', '50');
    if (directory.pageToken) url.searchParams.set('page_token', directory.pageToken);
    directory.calls.push(now);
    const jobsResponse = await fetchImpl(url.href, { method: 'GET', redirect: 'error', headers });
    const jobsBody = record(await jobsResponse.json().catch(() => null));
    const rateLimited = jobsResponse.status === 429 || jobsBody?.code === 99991400;
    if (rateLimited) return 'rate';
    if (!jobsResponse.ok || !jobsBody || jobsBody.code !== 0) {
      directory.failed = true;
      return 'failed';
    }
    const data = record(jobsBody.data);
    const items = data && Array.isArray(data.items) ? data.items : null;
    if (!data || !items) {
      directory.failed = true;
      return 'failed';
    }
    for (const item of items) {
      const row = record(item);
      const name = row ? text(row.name, 64) : '';
      if (!name) continue;
      directory.rows.push({ name, enabled: row?.status === true });
    }
    directory.pages += 1;
    if (data.has_more !== true) {
      directory.done = true;
      directory.pageToken = '';
      return 'done';
    }
    if (directory.pages >= PAGE_LIMIT || typeof data.page_token !== 'string' || data.page_token.length === 0) {
      directory.failed = true;
      console.info('[api] feishu job directory stopped before the list ended');
      return 'failed';
    }
    directory.pageToken = data.page_token;
  }
  return 'partial';
}

async function tenantToken(
  config: Readonly<{ clientId: string; clientSecret: string }>,
  fetchImpl: typeof fetch,
): Promise<string> {
  const tokenResponse = await fetchImpl(TENANT_TOKEN_URL, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: config.clientId, app_secret: config.clientSecret }),
  });
  const tokenBody = record(await readJson(tokenResponse));
  return tokenBody && tokenBody.code === 0 ? text(tokenBody.tenant_access_token, 4096) : '';
}

/**
 * One process walks the job-title dictionary from the saved page token.
 * A login does not wait for the whole dictionary. Rights stay off until the walk ends.
 */
export function startFeishuJobDirectoryWarm(
  config: Readonly<{ clientId: string; clientSecret: string }>,
  fetchImpl: typeof fetch = fetch,
): void {
  if (warming || directory.done || directory.failed) return;
  warming = true;
  void (async () => {
    try {
      const token = await tenantToken(config, fetchImpl);
      if (!token) {
        directory.failed = true;
        return;
      }
      const headers = { authorization: `Bearer ${token}` };
      while (!directory.done && !directory.failed) {
        const step = await exclusive(() => pullPages(fetchImpl, headers, PAGE_BUDGET));
        if (step === 'done' || step === 'failed' || directory.done || directory.failed) break;
        if (step === 'rate') {
          const wait = rateWaitMs(Date.now());
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
    } catch {
      directory.failed = true;
    } finally {
      warming = false;
    }
  })();
}

/**
 * App-identity read of one person's job title.
 * `pending` means the title is saved and the dictionary walk has not finished.
 * Any missing scope, transport error, or blank title returns null.
 * The caller keeps the login.
 */
export async function readFeishuJobSnapshot(
  openId: string,
  config: Readonly<{ clientId: string; clientSecret: string }>,
  fetchImpl: typeof fetch,
): Promise<FeishuJobSnapshot | 'pending' | null> {
  const token = await tenantToken(config, fetchImpl);
  if (!token) return null;
  const headers = { authorization: `Bearer ${token}` };
  const userResponse = await fetchImpl(
    `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,
    { method: 'GET', redirect: 'error', headers },
  );
  const userBody = record(await readJson(userResponse));
  if (!userBody || userBody.code !== 0) return null;
  const userData = record(userBody.data);
  const user = userData ? record(userData.user) : null;
  const title = user ? text(user.job_title, 64) : '';
  const hash = subjectHash(openId);
  if (!title) {
    pendingTitles.delete(hash);
    snapshots.delete(hash);
    return null;
  }
  pendingTitles.set(hash, title);
  snapshots.delete(hash);
  if (!warming && !directory.done && !directory.failed) {
    await exclusive(() => pullPages(fetchImpl, headers, PAGE_BUDGET));
  }
  if (directory.failed) return null;
  if (!directory.done) return 'pending';
  return publish(hash, title);
}
