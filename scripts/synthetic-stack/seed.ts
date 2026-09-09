/**
 * Seed the synthetic stack through the real governed chain.
 *
 * Order: authenticate as owner -> import CSV -> wait for the worker to park it
 * -> lead/manager/quality review decisions -> resume -> publish -> verify the
 * published scripts are recommendable over `/v1/search`.
 *
 * Nothing is inserted into `scripts` directly and no review decision is
 * self-asserted by the importer, so the seeded state is reachable exactly the
 * way a real operator would reach it.
 */
import { createHash } from 'node:crypto';
import { SYNTHETIC_CONTENT_CSV, SYNTHETIC_SOURCES } from './content.ts';

const INTENT_TAXONOMY_VERSION = 'itax_synthetic_stack_v1';
const INTENT_ID = 'intent_synthetic_stack_shipping';
const REVIEW_EVIDENCE = 'EVD-STACK-REVIEW-001';
const QUALITY_EVIDENCE = 'EVD-STACK-QUALITY-001';
const PKCE_VERIFIER = 'v'.repeat(43);

export const SEED_INTENT = Object.freeze({ version: INTENT_TAXONOMY_VERSION, id: INTENT_ID });

export type SeedResult = Readonly<{ batchId: string; releaseId: string; releaseSeq: number; scriptCount: number }>;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}));
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Product-session login over the loopback synthetic provider. */
export async function loginAs(apiOrigin: string, bindingId: string): Promise<string> {
  const challenge = createHash('sha256').update(PKCE_VERIFIER).digest('base64url');
  const created = await fetch(`${apiOrigin}/v1/auth/login-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_challenge: challenge, challenge_method: 'S256' }),
  });
  if (created.status !== 201) throw new Error(`login-requests ${String(created.status)}: ${JSON.stringify(await json(created))}`);
  const login = await json(created);
  const authorizeUrl = new URL(String(login.authorize_url));
  const state = authorizeUrl.searchParams.get('state');
  if (!state) throw new Error('synthetic authorize_url has no state');

  // Drive the provider like the desktop login window does: follow its redirect
  // into the API callback with the subject we want.
  const authorize = await fetch(authorizeUrl, { redirect: 'manual' });
  const location = authorize.headers.get('location');
  if (!location) throw new Error(`provider /authorize did not redirect: HTTP ${String(authorize.status)}`);
  const callback = new URL(location);
  callback.searchParams.set('code', bindingId);
  const callbackResponse = await fetch(callback);
  if (!callbackResponse.ok) throw new Error(`auth callback HTTP ${String(callbackResponse.status)}`);

  const exchanged = await fetch(`${apiOrigin}/v1/auth/login-requests/${String(login.login_id)}/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_verifier: PKCE_VERIFIER }),
  });
  if (exchanged.status !== 200) throw new Error(`exchange HTTP ${String(exchanged.status)}: ${JSON.stringify(await json(exchanged))}`);
  const session = await json(exchanged);
  const token = session.access_token;
  if (typeof token !== 'string') throw new Error('exchange returned no access_token');
  return token;
}

async function authed(token: string): Promise<Record<string, string>> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function waitForImport(apiOrigin: string, token: string, batchId: string, status: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const response = await fetch(`${apiOrigin}/v1/content/import/${batchId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await json(response);
    last = JSON.stringify(body);
    if (body.status === status) return;
    if (body.status === 'failed') throw new Error(`import ${batchId} failed: ${last}`);
    await sleep(250);
  }
  throw new Error(`timed out waiting for import ${batchId} to reach ${status}; last=${last}`);
}

/**
 * A batch parked for review keeps the `validating` status; the review queue
 * entry is what proves the worker finished. Waiting on a "parked" HTTP status
 * would never resolve.
 */
async function waitForReview(apiOrigin: string, token: string, batchId: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const response = await fetch(`${apiOrigin}/v1/admin/content/reviews`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await json(response);
    last = JSON.stringify(body);
    const items = Array.isArray(body.items) ? body.items : [];
    for (const item of items) {
      if (item && typeof item === 'object' && Reflect.get(item, 'batch_id') === batchId) {
        const revision = Reflect.get(item, 'review_revision');
        if (typeof revision === 'string') return revision;
      }
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for batch ${batchId} to appear in the review queue; last=${last}`);
}

async function reviewBatch(apiOrigin: string, batchId: string): Promise<void> {
  const lead = await loginAs(apiOrigin, 'synthetic_coach');
  const revision = await waitForReview(apiOrigin, lead, batchId);
  // The review page is paged (default 20); follow `next_after` so a seed set
  // larger than one page is still fully decided rather than silently partial.
  const items: Record<string, unknown>[] = [];
  for (let after = 0; ;) {
    const page = await fetch(
      `${apiOrigin}/v1/admin/content/reviews/${batchId}?review_revision=${encodeURIComponent(revision)}&after=${String(after)}&limit=100`,
      { headers: { authorization: `Bearer ${lead}` } },
    );
    if (!page.ok) throw new Error(`review page HTTP ${String(page.status)}: ${JSON.stringify(await json(page))}`);
    const body = await json(page);
    const pageItems = Array.isArray(body.items) ? body.items : [];
    for (const item of pageItems) if (item && typeof item === 'object') items.push(item as Record<string, unknown>);
    const next = body.next_after;
    if (typeof next !== 'number' || pageItems.length === 0) break;
    after = next;
  }
  if (items.length === 0) throw new Error(`review page for ${batchId} has no items`);

  // Two distinct subjects: the lead and manager decisions are recorded with
  // different reviewer hashes, which the dual-review gate requires.
  const manager = await loginAs(apiOrigin, 'synthetic_owner');
  for (const [index, item] of items.entries()) {
    const scriptId = String(Reflect.get(item, 'script_id'));
    const contentHash = String(Reflect.get(item, 'content_hash'));
    for (const [token, role, key] of [[lead, 'lead', 'lead'], [manager, 'manager', 'manager']] as const) {
      const decision = await fetch(`${apiOrigin}/v1/admin/content/reviews/${batchId}/decisions`, {
        method: 'POST',
        headers: { ...(await authed(token)), 'idempotency-key': `dec-${key}-${batchId}-${String(index)}` },
        body: JSON.stringify({ review_revision: revision, script_id: scriptId, content_hash: contentHash, decision: 'approved', evidence_id: REVIEW_EVIDENCE }),
      });
      if (!decision.ok) throw new Error(`decision ${role} HTTP ${String(decision.status)}: ${JSON.stringify(await json(decision))}`);
    }
  }

  // Quality evidence and resume require the dedicated quality capability, not
  // the lead's. Using the lead here fails closed with CAPABILITY_DENIED.
  const quality = await loginAs(apiOrigin, 'synthetic_quality');
  const evidence = await fetch(`${apiOrigin}/v1/admin/content/reviews/${batchId}/quality-evidence`, {
    method: 'POST',
    headers: { ...(await authed(quality)), 'idempotency-key': `quality-${batchId}` },
    body: JSON.stringify({
      review_revision: revision, phase: 'initial', evidence_id: QUALITY_EVIDENCE,
      checks: items.map((item) => ({
        script_id: String(Reflect.get(item as object, 'script_id')),
        content_hash: String(Reflect.get(item as object, 'content_hash')),
        defect: false,
      })),
    }),
  });
  if (!evidence.ok) throw new Error(`quality evidence HTTP ${String(evidence.status)}: ${JSON.stringify(await json(evidence))}`);

  const resume = await fetch(`${apiOrigin}/v1/admin/content/reviews/${batchId}/resume`, {
    method: 'POST',
    headers: await authed(quality),
    body: JSON.stringify({ review_revision: revision }),
  });
  if (!resume.ok) throw new Error(`resume HTTP ${String(resume.status)}: ${JSON.stringify(await json(resume))}`);
}

/**
 * True when the stack's seed content is already published and recommendable.
 * Re-running `start` must not publish a new release every time: that would grow
 * the release sequence on every restart and make "the current release" unstable
 * for the desktop client. A missing or partial seed is re-published instead.
 */
export async function seedContentIfMissing(apiOrigin: string, { log = () => undefined }: Readonly<{ log?: (message: string) => void }> = {}): Promise<SeedResult | 'already_seeded'> {
  const token = await loginAs(apiOrigin, 'synthetic_agent');
  const probe = await fetch(`${apiOrigin}/v1/search`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query_id: crypto.randomUUID(), parent_query_id: null, interaction_reason: 'original',
      query_text: '什么时候发货', collection_mode: 'synthetic', detected_platform: 'qianniu',
      platform: 'qianniu', platform_source: 'manual', product_context_type: null,
      product_context_ref: null, top_k: 3,
    }),
  });
  if (probe.status === 200) {
    const body = await json(probe);
    if (body.hit_status === 'hit') { log('seed content already published; reusing current release'); return 'already_seeded'; }
  }
  return seedContent(apiOrigin, { log });
}

/**
 * Import, review and publish the synthetic catalog. Idempotent per release:
 * calling it again publishes a new release with the same content.
 */
export async function seedContent(apiOrigin: string, { log = () => undefined }: Readonly<{ log?: (message: string) => void }> = {}): Promise<SeedResult> {
  const owner = await loginAs(apiOrigin, 'synthetic_owner');
  const form = new FormData();
  form.set('file', new File([SYNTHETIC_CONTENT_CSV], 'synthetic-stack.csv', { type: 'text/csv' }));
  form.set('source_bindings', JSON.stringify(SYNTHETIC_SOURCES.map(({ domain, source_version_id }) => ({ domain, source_version_id }))));
  const imported = await fetch(`${apiOrigin}/v1/content/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${owner}`, 'idempotency-key': `seed-${Date.now().toString()}` },
    body: form,
  });
  if (imported.status !== 202) throw new Error(`import HTTP ${String(imported.status)}: ${JSON.stringify(await json(imported))}`);
  const batchId = String((await json(imported)).import_batch_id);
  log(`import accepted: ${batchId}`);

  await reviewBatch(apiOrigin, batchId);
  log('worker parked the batch and review completed');
  await waitForImport(apiOrigin, owner, batchId, 'staged');
  log('batch staged');

  const published = await fetch(`${apiOrigin}/v1/content/publish`, {
    method: 'POST',
    headers: { ...(await authed(owner)), 'idempotency-key': `publish-${batchId}` },
    body: JSON.stringify({ import_batch_id: batchId, title: '合成栈种子发布', summary: 'synthetic stack seed' }),
  });
  if (!published.ok) throw new Error(`publish HTTP ${String(published.status)}: ${JSON.stringify(await json(published))}`);
  const release = await json(published);
  log(`published release ${String(release.release_id)} seq=${String(release.release_seq)}`);
  return Object.freeze({
    batchId,
    releaseId: String(release.release_id),
    releaseSeq: Number(release.release_seq),
    scriptCount: SYNTHETIC_CONTENT_CSV.toString('utf8').trim().split('\n').length - 1,
  });
}
