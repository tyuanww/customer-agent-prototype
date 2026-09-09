import { createHash as sha, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Client } from 'pg';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const apiDirectory = fileURLToPath(new URL('..', import.meta.url));
const HMAC_KEYS = JSON.stringify({ 'hmac-idempotency-v1': 'synthetic-t6-idempotency-material-0001' });
const LOG_HASH_KEY = 'synthetic-t6-log-hash-material-00000001';
const INTENT = Object.freeze({ version: 'itax_synthetic_t6_v1', id: 'intent_synthetic_t6_shipping' });
const BINDINGS = Object.freeze([
  { domain: 'aftersale', source_version_id: 'srcv_t6_aftersale_v1', source_ref: 'SRC-T6-AFTERSALE' },
  { domain: 'campaign', source_version_id: 'srcv_t6_campaign_v1', source_ref: 'SRC-T6-CAMPAIGN' },
  { domain: 'presale', source_version_id: 'srcv_t6_presale_v1', source_ref: 'SRC-T6-PRESALE' },
  { domain: 'product', source_version_id: 'srcv_t6_product_v1', source_ref: 'SRC-T6-PRODUCT' },
] as const);
const CSV = Buffer.from([
  'script_id,category,title,answer_text,source_version_id,source_ref,question_text,risk_level,has_conflict',
  'shipping-001,presale,发货时效,您好订单将在付款后发出,srcv_t6_presale_v1,SRC-T6-PRESALE,什么时候发货,high,false',
  '',
].join('\n'));
const verifier = 'v'.repeat(43);
const challenge = sha('sha256').update(verifier).digest('base64url');
const CLIENT_ID = 'mac-cs-t6-001';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve) => { server.close(() => resolve()); });
  if (address.port < 1024) return freePort();
  return address.port;
}

function waitForListening(
  child: ChildProcess,
  output: { stdout: string; stderr: string },
  timeoutMs = 15_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error(`API startup timeout stdout=${output.stdout} stderr=${output.stderr}`));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(deadline);
      reject(new Error(`API exited code=${String(code)} signal=${String(signal)} stderr=${output.stderr}`));
    };
    const inspect = () => {
      const match = output.stdout.match(/\[api\] listening at (http:\/\/127\.0\.0\.1:\d+)/);
      if (!match?.[1]) return;
      clearTimeout(deadline);
      child.stdout?.off('data', inspect);
      child.off('exit', onExit);
      resolve(match[1]);
    };
    child.stdout?.on('data', inspect);
    child.once('exit', onExit);
    inspect();
  });
}

describe.skipIf(!enabled)('backend runtime artifact chain', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let address = '';
  let api: ChildProcess;
  let worker: ChildProcess | undefined;
  let provider: ReturnType<typeof createServer>;
  const output = { stdout: '', stderr: '' };
  const workerOutput = { stdout: '', stderr: '' };
  let storeRoot = '';
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    if (!existsSync(path.join(apiDirectory, 'dist/main.js'))
      || !existsSync(path.join(apiDirectory, 'dist/content-worker-main.js'))) {
      execFileSync('pnpm', ['build'], { cwd: apiDirectory, stdio: 'pipe' });
    }
    harness = new Pg15Harness();
    harness.start();
    const db = harness.createDatabase('e2e');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    await admin.query(`
      CREATE ROLE t6_runtime LOGIN; GRANT app_runtime TO t6_runtime;
      CREATE ROLE t6_admin LOGIN; GRANT app_content_admin TO t6_admin;
      CREATE ROLE t6_auth LOGIN NOINHERIT; GRANT app_backend_auth TO t6_auth;
      CREATE ROLE t6_worker LOGIN NOINHERIT; GRANT app_backend_worker TO t6_worker;
      CREATE ROLE t6_review LOGIN NOINHERIT; GRANT app_backend_review TO t6_review;
    `);
    const socket = new URLSearchParams({ host: harness.socket, port: String(harness.port) });
    const conn = (user: string) => `postgresql://${user}@localhost/${db.name}?${socket}`;
    storeRoot = mkdtempSync(path.join(tmpdir(), 'ca-t6-store-'));
    const digest = sha('sha256').update(CSV).digest('hex');
    for (const binding of BINDINGS) {
      await admin.query(`
        INSERT INTO public.authoritative_source_versions(
          source_version_id, source_ref, domain, upstream_version, snapshot_sha256,
          use_class, owner_role, approval_evd, approved_by, approved_at, review_due_at
        ) VALUES ($1,$2,$3,'synthetic-t6',$4,'canonical','ROLE-CONTENT-LEAD','EVD-T6-SOURCE',
          'synthetic-owner', clock_timestamp() - interval '1 day', clock_timestamp() + interval '365 days')
      `, [binding.source_version_id, binding.source_ref, binding.domain, digest]);
    }
    await admin.query(`
      INSERT INTO public.intent_taxonomy_versions(intent_taxonomy_version, approval_evd, approved_by, approved_at)
      VALUES ($1,'EVD-T6-TAXONOMY','synthetic-owner', clock_timestamp())
    `, [INTENT.version]);
    await admin.query(`
      INSERT INTO public.intent_taxonomy_entries(intent_taxonomy_version, intent_id, label, lifecycle)
      VALUES ($1,$2,'合成发货', 'active')
    `, [INTENT.version, INTENT.id]);
    await admin.query("SELECT pg_catalog.set_config('app.semantic_asset_write', 'publish', false)");
    await admin.query(`
      INSERT INTO public.semantic_source_assets(
        source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version
      ) VALUES ('sa_shipping-001', 'manual', encode(sha256(convert_to('origin:shipping-001','UTF8')),'hex'), 'hmac-synthetic-v1')
    `);
    for (const [id, user, cap, role] of [
      ['synthetic_owner', 'usr_t6_owner', null, 'owner'],
      ['synthetic_lead', 'usr_t6_lead', 'content_review_lead', 'coach'],
      ['synthetic_manager', 'usr_t6_manager', 'content_review_manager', 'coach'],
      ['synthetic_quality', 'usr_t6_quality', 'content_quality_reviewer', 'coach'],
    ] as const) {
      await admin.query(`
        INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','synthetic-tenant',$1,$2,encode(sha256(convert_to($1,'UTF8')),'hex'),true,$3)
      `, [id, user, role]);
      if (cap) {
        await admin.query(`
          INSERT INTO backend_identity.capability_bindings(user_id,capability,enabled,evidence_id)
          VALUES ($1,$2,true,'EVD-T6-CAP')
        `, [user, cap]);
      }
    }
    provider = createServer((request, response) => {
      if (request.method !== 'POST' || request.url !== '/exchange') {
        response.writeHead(404);
        response.end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => { chunks.push(chunk as Buffer); });
      request.on('end', () => {
        let bindingId = '';
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { code?: unknown };
          bindingId = typeof parsed.code === 'string' ? parsed.code : '';
        } catch {
          bindingId = '';
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ provider: 'synthetic', binding_id: bindingId }));
      });
    });
    await new Promise<void>((resolve) => { provider.listen(0, '127.0.0.1', resolve); });
    const providerAddress = provider.address() as AddressInfo;
    const apiPort = await freePort();
    env = {
      PATH: process.env.PATH,
      CUSTOMER_AGENT_PROFILE: 'test',
      AUTH_MODE: 'mock',
      AUTH_SESSION_MODE: 'product',
      CUSTOMER_AGENT_API_PORT: String(apiPort),
      CUSTOMER_AGENT_BUILD_VERSION: 'synthetic-t6',
      DATABASE_URL: conn('t6_runtime'),
      CONTENT_ADMIN_DATABASE_URL: conn('t6_admin'),
      AUTH_DATABASE_URL: conn('t6_auth'),
      CONTENT_REVIEW_DATABASE_URL: conn('t6_review'),
      SYNTHETIC_IDENTITY_PROVIDER_ORIGIN: `http://127.0.0.1:${providerAddress.port}`,
      CONTENT_OBJECT_STORE_DIR: storeRoot,
      IDEMPOTENCY_HMAC_KEYS: HMAC_KEYS,
      IDEMPOTENCY_HMAC_CURRENT_VERSION: 'hmac-idempotency-v1',
      LOG_HASH_KEY,
      LOG_HASH_KEY_VERSION: 'hmac-log-v1',
      DB_CONNECTION_TIMEOUT_MS: '2000',
      DB_READINESS_TIMEOUT_MS: '3000',
    };
    api = spawn(process.execPath, ['dist/main.js'], {
      cwd: apiDirectory, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    api.stdout?.setEncoding('utf8');
    api.stderr?.setEncoding('utf8');
    api.stdout?.on('data', (chunk) => { output.stdout += chunk; });
    api.stderr?.on('data', (chunk) => { output.stderr += chunk; });
    address = await waitForListening(api, output);
    worker = spawnWorker(conn);
  }, 120_000);

  afterAll(async () => {
    worker?.kill('SIGTERM');
    api?.kill('SIGINT');
    await sleep(300);
    worker?.kill('SIGKILL');
    api?.kill('SIGKILL');
    provider?.close();
    await admin?.end();
    harness?.stop();
  }, 30_000);

  function spawnWorker(conn: (user: string) => string): ChildProcess {
    const child = spawn(process.execPath, ['dist/content-worker-main.js'], {
      cwd: apiDirectory,
      env: {
        ...env,
        CONTENT_WORKER_DATABASE_URL: conn('t6_worker'),
        CONTENT_INTENT_TAXONOMY_VERSION: INTENT.version,
        CONTENT_INTENT_ID: INTENT.id,
        CONTENT_REVIEW_LEAD_SUBJECT: 'synthetic_lead',
        CONTENT_REVIEW_MANAGER_SUBJECT: 'synthetic_manager',
        CONTENT_REVIEW_EVIDENCE_ID: 'EVD-T6-REVIEW-001',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { workerOutput.stdout += chunk; });
    child.stderr?.on('data', (chunk) => { workerOutput.stderr += chunk; });
    return child;
  }

  async function productToken(bindingId: string): Promise<string> {
    const created = await fetch(`${address}/v1/auth/login-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_challenge: challenge, challenge_method: 'S256' }),
    });
    expect(created.status).toBe(201);
    const login = await created.json() as { login_id: string; authorize_url: string };
    const state = new URL(login.authorize_url).searchParams.get('state');
    expect((await fetch(`${address}/v1/auth/callback?state=${state}&code=${bindingId}`)).status).toBe(200);
    const exchanged = await fetch(`${address}/v1/auth/login-requests/${login.login_id}/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_verifier: verifier }),
    });
    expect(exchanged.status).toBe(200);
    return (await exchanged.json() as { access_token: string }).access_token;
  }

  async function importCsv(token: string, key: string): Promise<string> {
    const form = new FormData();
    form.set('file', new File([CSV], 'a.csv', { type: 'text/csv' }));
    form.set('source_bindings', JSON.stringify(BINDINGS.map(({ domain, source_version_id }) => ({ domain, source_version_id }))));
    const imported = await fetch(`${address}/v1/content/import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      body: form,
    });
    expect(imported.status).toBe(202);
    return (await imported.json() as { import_batch_id: string }).import_batch_id;
  }

  async function waitStatus(token: string, batchId: string, status: string, timeoutMs = 20_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const response = await fetch(`${address}/v1/content/import/${batchId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.status === 200 && (await response.json() as { status: string }).status === status) return;
      await sleep(200);
    }
    throw new Error(`timed out waiting for ${status}`);
  }

  async function reviewToStaged(batchId: string): Promise<void> {
    const lead = await productToken('synthetic_lead');
    const manager = await productToken('synthetic_manager');
    const quality = await productToken('synthetic_quality');
    const listed = await fetch(`${address}/v1/admin/content/reviews`, { headers: { authorization: `Bearer ${lead}` } });
    const summary = ((await listed.json() as { items: { batch_id: string; review_revision: string }[] }).items)
      .find((item) => item.batch_id === batchId);
    expect(summary).toBeTruthy();
    const revision = summary!.review_revision;
    const page = await fetch(
      `${address}/v1/admin/content/reviews/${batchId}?review_revision=${revision}`,
      { headers: { authorization: `Bearer ${lead}` } },
    );
    const items = (await page.json() as { items: { script_id: string; content_hash: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    for (const [index, item] of items.entries()) {
      const decide = async (token: string, key: string) => fetch(
        `${address}/v1/admin/content/reviews/${batchId}/decisions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`, 'idempotency-key': key, 'content-type': 'application/json',
          },
          body: JSON.stringify({
            review_revision: revision, script_id: item.script_id, content_hash: item.content_hash,
            decision: 'approved', evidence_id: 'EVD-T6-REVIEW-001',
          }),
        },
      );
      expect((await decide(lead, `dec-lead-${batchId}-${index}`)).status).toBe(200);
      expect((await decide(manager, `dec-manager-${batchId}-${index}`)).status).toBe(200);
    }
    expect((await fetch(`${address}/v1/admin/content/reviews/${batchId}/quality-evidence`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${quality}`, 'idempotency-key': `qual-t6-${batchId}`, 'content-type': 'application/json',
      },
      body: JSON.stringify({
        review_revision: revision, phase: 'initial', evidence_id: 'EVD-T6-QUALITY-001',
        checks: items.map((item) => ({ script_id: item.script_id, content_hash: item.content_hash, defect: false })),
      }),
    })).status).toBe(200);
    expect((await fetch(`${address}/v1/admin/content/reviews/${batchId}/resume`, {
      method: 'POST',
      headers: { authorization: `Bearer ${quality}`, 'content-type': 'application/json' },
      body: JSON.stringify({ review_revision: revision }),
    })).status).toBe(200);
  }

  it('runs import-review-publish-read from dist processes, recovers a killed worker, and cancel does not stage', async () => {
    const owner = await productToken('synthetic_owner');
    const ready = await fetch(`${address}/ready`);
    expect(ready.status).toBe(200);

    const cancelledId = await importCsv(owner, 'idem-t6-cancel');
    expect((await fetch(`${address}/v1/content/import/${cancelledId}/cancel`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner}`, 'idempotency-key': 'cancel-t6', 'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 't6-cancel-race' }),
    })).status).toBe(200);
    await waitStatus(owner, cancelledId, 'failed');

    const batchId = await importCsv(owner, 'idem-t6-main');
    const leadForWait = await productToken('synthetic_lead');
    const parkedDeadline = Date.now() + 20_000;
    let parked = false;
    while (Date.now() < parkedDeadline) {
      const listed = await fetch(`${address}/v1/admin/content/reviews`, {
        headers: { authorization: `Bearer ${leadForWait}` },
      });
      const items = (await listed.json() as { items?: { batch_id: string }[] }).items ?? [];
      if (items.some((item) => item.batch_id === batchId)) {
        parked = true;
        break;
      }
      await sleep(200);
    }
    if (!parked) {
      const status = await fetch(`${address}/v1/content/import/${batchId}`, {
        headers: { authorization: `Bearer ${owner}` },
      });
      const reviews = await fetch(`${address}/v1/admin/content/reviews`, {
        headers: { authorization: `Bearer ${leadForWait}` },
      });
      const jobs = await admin.query('SELECT job_type, status, last_error FROM public.outbox_jobs');
      expect.fail(JSON.stringify({
        import: { status: status.status, body: await status.json() },
        reviews: { status: reviews.status, body: await reviews.json() },
        jobs: jobs.rows,
        worker: workerOutput,
        apiErr: output.stderr,
      }));
    }
    worker?.kill('SIGKILL');
    await sleep(400);
    const conn = (user: string) => String(env.DATABASE_URL).replace('t6_runtime@', `${user}@`);
    worker = spawnWorker(conn);
    await reviewToStaged(batchId);
    await waitStatus(owner, batchId, 'staged');

    const published = await fetch(`${address}/v1/content/publish`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner}`, 'idempotency-key': 'pub-t6', 'content-type': 'application/json',
      },
      body: JSON.stringify({ import_batch_id: batchId, title: '合成整链', summary: 'T6' }),
    });
    expect(published.status).toBe(200);
    let release = await published.json() as { release_id: string; release_seq: number };
    expect(release.release_seq).toBe(1);
    const firstRelease = release;
    const desktop = await connectDesktopAdapter(address);
    const firstSearch = await desktop.search.search(1, {
      sessionEpoch: desktop.epoch(), generation: 1, queryText: '什么时候发货', platform: 'qianniu',
      platformSource: 'manual', productContextType: null, productContextRef: null, parentQueryId: null,
    });
    expect(firstSearch).toMatchObject({ ok: true, hitStatus: 'hit', releaseId: firstRelease.release_id });
    if (!firstSearch.ok) throw new Error(JSON.stringify(firstSearch));
    const firstCandidate = firstSearch.candidates[0]!;
    const firstCopy = {
      sessionEpoch: desktop.epoch(), generation: 1, queryId: firstSearch.queryId, rank: firstCandidate.rank,
      scriptId: firstCandidate.script_id, scriptVersion: firstCandidate.script_version,
      contentHash: firstCandidate.content_hash, placeholderValues: {},
    };
    expect(await desktop.search.copy(1, firstCopy)).toMatchObject({ ok: true, copied: true });
    expect(desktop.clipboard.at(-1)).toContain('付款后发出');
    expect(JSON.stringify(desktop.session.view())).not.toContain('access_token');
    const repeated = await importCsv(owner, 'idem-t6-repeat');
    await expect.poll(async () => {
      const listed = await fetch(`${address}/v1/admin/content/reviews`, { headers: { authorization: `Bearer ${leadForWait}` } });
      const body = await listed.json() as { items: { batch_id: string }[] };
      return body.items.some(item => item.batch_id === repeated);
    }, { timeout: 20_000, interval: 200 }).toBe(true);
    await reviewToStaged(repeated);
    await waitStatus(owner, repeated, 'staged');
    const republished = await fetch(`${address}/v1/content/publish`, {
      method: 'POST', headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'pub-t6-repeat', 'content-type': 'application/json' },
      body: JSON.stringify({ import_batch_id: repeated, title: '再次导入', summary: 'synthetic repeat' }),
    });
    expect(republished.status).toBe(200);
    const secondRelease = await republished.json() as { release_id: string; release_seq: number };
    const rolledBack = await fetch(`${address}/v1/content/rollback`, {
      method: 'POST', headers: { authorization: `Bearer ${owner}`, 'idempotency-key': 'rollback-t6', 'content-type': 'application/json' },
      body: JSON.stringify({ target_release_id: firstRelease.release_id, title: '回退首版', summary: 'synthetic rollback' }),
    });
    expect(rolledBack.status).toBe(200);
    release = await rolledBack.json() as { release_id: string; release_seq: number };
    expect(release.release_seq).toBeGreaterThan(secondRelease.release_seq);
    expect(release.release_id).not.toBe(firstRelease.release_id);
    const replaced = await desktop.announce.refresh({ sessionEpoch: desktop.epoch(), generation: 2 });
    expect(replaced).toMatchObject({ ok: true, releaseId: release.release_id });
    expect(await desktop.search.copy(1, firstCopy)).toMatchObject({ code: 'STALE' });
    const secondSearch = await desktop.search.search(1, {
      sessionEpoch: desktop.epoch(), generation: 3, queryText: '什么时候发货', platform: 'qianniu',
      platformSource: 'manual', productContextType: null, productContextRef: null, parentQueryId: null,
    });
    expect(secondSearch).toMatchObject({ ok: true, hitStatus: 'hit', releaseId: release.release_id });
    const loggedOut = await desktop.session.logout();
    expect(loggedOut).toMatchObject({ ok: true, signedIn: false });
    expect(desktop.store()).toBeNull();

    const current = await fetch(`${address}/v1/announce/current`, {
      headers: { authorization: `Bearer ${owner}`, 'x-client-id': CLIENT_ID },
    });
    expect(current.status).toBe(200);
    const currentBody = await current.json() as {
      current_release_id: string;
      offline_lease: { token: string };
    };
    expect(currentBody.current_release_id).toBe(release.release_id);
    const snapshot = await fetch(
      `${address}/v1/announce/snapshot?release_id=${release.release_id}`,
      {
        headers: {
          authorization: `Bearer ${owner}`,
          'x-client-id': CLIENT_ID,
          'x-snapshot-lease': currentBody.offline_lease.token,
        },
      },
    );
    expect(snapshot.status).toBe(200);
    expect(((await snapshot.json()) as { items: unknown[] }).items.length).toBe(1);
    expect((await fetch(`${address}/v1/announce/ack`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        release_id: release.release_id,
        release_seq: release.release_seq,
        offline_lease_token: currentBody.offline_lease.token,
      }),
    })).status).toBe(200);
    const search = await fetch(`${address}/v1/search`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query_id: randomUUID(),
        parent_query_id: null,
        interaction_reason: 'original',
        query_text: '什么时候发货',
        collection_mode: 'synthetic',
        detected_platform: 'qianniu',
        platform: 'qianniu',
        platform_source: 'foreground_process',
        product_context_type: null,
        product_context_ref: null,
        top_k: 3,
      }),
    });
    expect(search.status).toBe(200);
    expect((await search.json() as { hit_status: string }).hit_status).toBe('hit');

    await admin.query(
      `SELECT public.suspend_authoritative_source($1,'SOURCE_REVOKED','EVD-T6-SUSPEND','usr_t6_owner','owner')`,
      [BINDINGS[0].source_version_id],
    );
    expect((await fetch(`${address}/v1/announce/current`, {
      headers: { authorization: `Bearer ${owner}`, 'x-client-id': CLIENT_ID },
    })).status).toBe(503);
  }, 180_000);
});

async function connectDesktopAdapter(origin: string) {
  const main = new URL('../../desktop/src/main/', import.meta.url);
  const [{ ProductHttp }, { ProductSession }, { ProductAnnounce }, { ProductSearch }] = await Promise.all([
    import(new URL('product-http.ts', main).href),
    import(new URL('product-session.ts', main).href),
    import(new URL('product-announce.ts', main).href),
    import(new URL('product-search.ts', main).href),
  ]);
  let stored: { access_token: string; expires_at: string } | null = null;
  const session = new ProductSession(new ProductHttp(origin), {
    read: () => stored, write: (value: { access_token: string; expires_at: string }) => { stored = value; },
    clear: () => { stored = null; },
  }, {
    async open(url: string) {
      const authorize = new URL(url);
      const redirect = authorize.searchParams.get('redirect_uri');
      const state = authorize.searchParams.get('state');
      if (!redirect || !state) throw new Error('synthetic login window missing callback');
      const callback = await fetch(`${redirect}?state=${encodeURIComponent(state)}&code=synthetic_owner`);
      if (!callback.ok) throw new Error(`synthetic callback ${String(callback.status)}`);
    },
  });
  const login = await session.login();
  if (!login.ok || !login.signedIn) throw new Error(JSON.stringify(login));
  const announce = new ProductAnnounce(session, `desk_${'c'.repeat(32)}`);
  const clipboard: string[] = [];
  const search = new ProductSearch(session, (text: string) => { clipboard.push(text); }, announce);
  const refreshed = await announce.refresh({ sessionEpoch: session.view().sessionEpoch, generation: 0 });
  if (!refreshed.ok) throw new Error(JSON.stringify(refreshed));
  return {
    session, announce, search, clipboard,
    epoch: () => session.view().sessionEpoch,
    store: () => stored,
  };
}
