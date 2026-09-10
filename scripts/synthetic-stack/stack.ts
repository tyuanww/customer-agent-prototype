#!/usr/bin/env node
/**
 * Local synthetic stack for the macOS client.
 *
 *   node scripts/synthetic-stack/stack.ts start     prepare + start + seed + verify
 *   node scripts/synthetic-stack/stack.ts stop      stop the processes this stack owns
 *   node scripts/synthetic-stack/stack.ts restart
 *   node scripts/synthetic-stack/stack.ts status    report readiness of each piece
 *   node scripts/synthetic-stack/stack.ts destroy   stop, then remove the isolated cluster
 *   node scripts/synthetic-stack/stack.ts desktop   print the desktop client env for this stack
 *   node scripts/synthetic-stack/stack.ts anomaly   status | session-revoke | source-suspend <id>
 *
 * Full M3 check (separate entry): node scripts/synthetic-stack/anomaly-check.ts
 *
 * Ownership rules this command enforces:
 *   - It never touches the user's existing PostgreSQL installation or any
 *     process it did not start (see process.ts).
 *   - It fails closed on a busy port instead of moving to another one, because
 *     the desktop client reads the resolved origins from profile.json.
 *   - Re-running `start` on a running stack reports what is already up and only
 *     starts what is missing.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogReferences } from '../../apps/desktop/src/shared/synthetic-catalog.ts';
import { SYNTHETIC_SCRIPT_IDS } from './content.ts';
import { bootstrapDatabase } from './bootstrap.ts';
import {
  DATABASE_NAME, LOG_DIRECTORY, OBJECT_STORE_DIRECTORY, PG_PORT, PG_SOCKET_DIRECTORY,
  PREFERRED_PORTS, PROFILE_FILE, SYNTHETIC_IDENTITIES, apiEnvironment, ensureStackDirectories,
  readProfile, writeDesktopPackagedProfile, writeProfile,
} from './profile.ts';
import {
  SyntheticCluster, clusterVersionText, ensureDatabase, ensureLoginRoles, writeClusterMarker,
} from './postgres.ts';
import {
  forgetProcess, isOwnedProcessLive, portInUse, readProcess, recordProcess, stopProcess, waitForHttp,
} from './process.ts';
import { loginAs, seedContentIfMissing } from './seed.ts';
import { anomalyStatus, revokeSessions, suspendSource } from './anomaly.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_ENTRY = path.join(repositoryRoot, 'apps/api/dist/main.js');
const WORKER_ENTRY = path.join(repositoryRoot, 'apps/api/dist/content-worker-main.js');
const IDENTITY_ENTRY = fileURLToPath(new URL('./identity-provider.ts', import.meta.url));

function log(message: string): void {
  console.info(`[stack] ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function spawnLogged(name: string, command: string, args: readonly string[], environment: NodeJS.ProcessEnv): number {
  ensureStackDirectories();
  const out = openSync(path.join(LOG_DIRECTORY, `${name}.log`), 'a');
  try {
    const child = spawn(command, [...args], {
      cwd: repositoryRoot,
      env: environment,
      stdio: ['ignore', out, out],
      detached: true,
    });
    if (child.pid === undefined) fail(`${name}: spawn produced no pid`);
    child.unref();
    recordProcess(name, child.pid, `${command} ${args.join(' ')}`);
    return child.pid;
  } finally {
    closeSync(out);
  }
}

async function readJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  const value: unknown = await response.json().catch(() => ({}));
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function requireDist(): void {
  for (const entry of [API_ENTRY, WORKER_ENTRY]) {
    if (!existsSync(entry)) {
      fail(`Missing ${path.relative(repositoryRoot, entry)}. Run: pnpm build:services`);
    }
  }
}

async function resolvePort(name: keyof typeof PREFERRED_PORTS): Promise<number> {
  const port = PREFERRED_PORTS[name];
  if (await portInUse(port)) {
    fail(
      `Port ${String(port)} (${name}) is already in use. Stop the process using it, or set `
      + `CUSTOMER_AGENT_STACK_ROOT to run a second stack with different ports.`,
    );
  }
  return port;
}

async function resolveProfile({ reuse }: { reuse: boolean }): Promise<StackProfile> {
  const existing = readProfile();
  if (reuse && existing) return existing;
  const apiPort = await resolvePort('api');
  const identityPort = await resolvePort('identity');
  return Object.freeze({
    version: 1,
    createdAt: new Date().toISOString(),
    stackRoot: path.dirname(PROFILE_FILE),
    apiOrigin: `http://127.0.0.1:${String(apiPort)}`,
    identityOrigin: `http://127.0.0.1:${String(identityPort)}`,
    apiPort,
    identityPort,
    databaseName: DATABASE_NAME,
    pgPort: PG_PORT,
    pgSocketDirectory: PG_SOCKET_DIRECTORY,
    objectStoreDirectory: OBJECT_STORE_DIRECTORY,
    clientId: 'desk_synthetic_stack_client',
  });
}

function liveProcessNames(): readonly string[] {
  return ['identity', 'api', 'worker'].filter((name) => {
    const record = readProcess(name);
    return record !== undefined && isOwnedProcessLive(record);
  });
}

async function startProcesses(profile: StackProfile): Promise<string[]> {
  const started: string[] = [];
  const live = new Set(liveProcessNames());
  const spawned: string[] = [];
  /** A failed start must not leave the pieces it just launched behind. */
  const cleanup = async (): Promise<void> => {
    for (const name of spawned.reverse()) {
      const result = await stopProcess(name).catch((error: unknown) => `${name}: cleanup failed (${String(error)})`);
      log(result);
    }
  };

  try {
    if (!live.has('identity')) {
      const pid = spawnLogged('identity', process.execPath, [IDENTITY_ENTRY, String(profile.identityPort)],
        { PATH: process.env.PATH });
      spawned.push('identity');
      started.push(`identity pid ${String(pid)}`);
    } else {
      started.push('identity already running');
    }
    await waitForHttp(`${profile.identityOrigin}/health`, { timeoutMs: 15_000 });

    const environment = apiEnvironment(profile, {
      CONTENT_INTENT_TAXONOMY_VERSION: 'itax_synthetic_stack_v1',
      CONTENT_INTENT_ID: 'intent_synthetic_stack_shipping',
      CONTENT_REVIEW_LEAD_SUBJECT: 'synthetic_coach',
      CONTENT_REVIEW_MANAGER_SUBJECT: 'synthetic_owner',
      CONTENT_REVIEW_EVIDENCE_ID: 'EVD-STACK-REVIEW-001',
    });

    if (!live.has('api')) {
      const pid = spawnLogged('api', process.execPath, [API_ENTRY], environment);
      spawned.push('api');
      started.push(`api pid ${String(pid)}`);
    } else {
      started.push('api already running');
    }
    await waitForHttp(`${profile.apiOrigin}/health`, { timeoutMs: 30_000 });

    if (!live.has('worker')) {
      const pid = spawnLogged('worker', process.execPath, [WORKER_ENTRY], environment);
      spawned.push('worker');
      started.push(`worker pid ${String(pid)}`);
    } else {
      started.push('worker already running');
    }
    return started;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Wait for every readiness check to be `ok`, with a locatable failure reason. */
async function waitReady(apiOrigin: string, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const body = await readJson(`${apiOrigin}/ready`);
      last = JSON.stringify(body);
      const checks = body.checks;
      if (body.status === 'ready' && checks !== null && typeof checks === 'object'
        && Object.values(checks).every((value) => value === 'ok')) return body;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
  fail(`API never became ready: ${last}`);
}

async function verifySearch(apiOrigin: string): Promise<readonly string[]> {
  const token = await loginAs(apiOrigin, 'synthetic_agent');
  const cases: readonly (readonly [string, 'category' | 'sku' | null, string | null, string])[] = [
    ['什么时候发货', null, null, 'storewide presale'],
    ['洁面怎么用', 'category', 'cat_cleanser', 'category scope'],
    ['澄芽氨基酸洁面怎么用', 'sku', 'sku_chengyajiemian', 'sku scope'],
  ];
  const hits: string[] = [];
  for (const [queryText, productContextType, productContextRef, label] of cases) {
    const response = await fetch(`${apiOrigin}/v1/search`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query_id: crypto.randomUUID(),
        parent_query_id: null,
        interaction_reason: 'original',
        query_text: queryText,
        collection_mode: 'synthetic',
        detected_platform: 'qianniu',
        platform: 'qianniu',
        platform_source: 'manual',
        product_context_type: productContextType,
        product_context_ref: productContextRef,
        top_k: 3,
      }),
    });
    const body: Record<string, unknown> = await response.json().catch(() => ({}));
    if (response.status !== 200 || body.hit_status !== 'hit') {
      fail(`search self-check failed for ${label} (${queryText}): HTTP ${String(response.status)} ${JSON.stringify(body)}`);
    }
    hits.push(`${label}: ${String((Array.isArray(body.candidates) ? body.candidates.length : 0))} candidates`);
  }
  return Object.freeze(hits);
}

async function commandStart(): Promise<void> {
  requireDist();
  ensureStackDirectories();
  const profile = await resolveProfile({ reuse: true });
  writeProfile(profile);
  const packagedProfilePath = writeDesktopPackagedProfile(profile);
  log(`stack root: ${profile.stackRoot}`);
  log(`api origin: ${profile.apiOrigin}  identity origin: ${profile.identityOrigin}`);
  log(`packaged desktop profile: ${packagedProfilePath}`);

  const cluster = new SyntheticCluster();
  cluster.ensureRunning();
  writeClusterMarker();
  log(`postgres: running (version ${clusterVersionText()}, socket ${cluster.socket})`);

  const admin = cluster.connect('postgres');
  await admin.connect();
  try { log(await ensureDatabase(cluster)); } finally { await admin.end(); }

  const database = cluster.connect();
  await database.connect();
  try {
    for (const step of await bootstrapDatabase(database)) log(step);
  } finally { await database.end(); }

  log(await ensureLoginRoles(cluster));

  for (const step of await startProcesses(profile)) log(step);
  const ready = await waitReady(profile.apiOrigin);
  log(`ready: ${JSON.stringify(ready.checks)}`);

  const seeded = await seedContentIfMissing(profile.apiOrigin, { log });
  if (seeded === 'already_seeded') {
    log('seed: already published');
  } else {
    log(`seeded ${String(seeded.scriptCount)} scripts into release ${seeded.releaseId} (seq ${String(seeded.releaseSeq)})`);
  }

  for (const result of await verifySearch(profile.apiOrigin)) log(`search ok — ${result}`);
  log('catalog references: ' + catalogReferences().join(', '));
  log(`seed script ids: ${SYNTHETIC_SCRIPT_IDS.join(', ')}`);
  log(`identity bindings: ${SYNTHETIC_IDENTITIES.map((identity) => identity.bindingId).join(', ')}`);
  log('');
  log('Stack is up. Launch the desktop client with:');
  log(`  ${desktopCommand(profile)}`);
}

function desktopCommand(profile: StackProfile): string {
  return [
    `CUSTOMER_AGENT_DESKTOP_API_ORIGIN=${profile.apiOrigin}`,
    `CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN=${profile.identityOrigin}`,
    'pnpm dev',
  ].join(' ');
}

async function commandStop(): Promise<void> {
  const results: string[] = [];
  for (const name of ['worker', 'api', 'identity']) results.push(await stopProcess(name));
  const cluster = new SyntheticCluster();
  results.push(cluster.stop());
  for (const result of results) log(result);
  log('Stopped. The isolated cluster and its seeded data are retained; use "destroy" to remove them.');
}

async function commandStatus(): Promise<void> {
  const profile = readProfile();
  if (!profile) { log(`no profile at ${PROFILE_FILE}; run "start" first`); return; }
  log(`profile: ${PROFILE_FILE}`);
  log(`api origin: ${profile.apiOrigin}  identity origin: ${profile.identityOrigin}`);
  for (const name of ['identity', 'api', 'worker']) {
    const record = readProcess(name);
    if (!record) { log(`${name}: not recorded`); continue; }
    log(`${name}: pid ${String(record.pid)} ${isOwnedProcessLive(record) ? 'running' : 'NOT running (stale record)'}`);
  }
  const cluster = new SyntheticCluster();
  log(`postgres: ${cluster.state()} (version ${clusterVersionText()})`);
  try {
    const health = await readJson(`${profile.apiOrigin}/health`);
    log(`api /health: ${JSON.stringify(health)}`);
    const ready = await readJson(`${profile.apiOrigin}/ready`);
    log(`api /ready: ${JSON.stringify(ready)}`);
  } catch (error) {
    log(`api probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    log(`identity /health: ${JSON.stringify(await readJson(`${profile.identityOrigin}/health`))}`);
  } catch (error) {
    log(`identity probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function commandDestroy(): Promise<void> {
  for (const name of ['worker', 'api', 'identity']) log(await stopProcess(name));
  log(new SyntheticCluster().destroy());
  for (const name of ['worker', 'api', 'identity']) forgetProcess(name);
  log('Isolated synthetic cluster removed. The user PostgreSQL installation was never touched.');
}

function commandDesktop(): void {
  const profile = readProfile();
  if (!profile) fail(`no profile at ${PROFILE_FILE}; run "start" first`);
  process.stdout.write(`${desktopCommand(profile)}\n`);
}

/**
 * Anomaly commands for the M3 verification pass. They report what changed and
 * how to get back to a healthy stack, so a human never has to guess the
 * recovery path. The source id is argv[4] because argv[3] is the subcommand.
 */
async function commandAnomaly(action: string | undefined): Promise<void> {
  const profile = readProfile();
  if (!profile) fail(`no profile at ${PROFILE_FILE}; run "start" first`);
  if (action === 'status') {
    for (const line of await anomalyStatus()) log(line);
    return;
  }
  if (action === 'source-suspend') {
    const sourceVersionId = process.argv[4];
    if (!sourceVersionId) fail('Usage: stack.ts anomaly source-suspend <source_version_id>');
    const result = await suspendSource(sourceVersionId);
    log(`${result.action}: ${result.detail}`);
    log(`recovery: ${result.recovery}`);
    return;
  }
  if (action === 'session-revoke') {
    const result = await revokeSessions();
    log(`${result.action}: ${result.detail}`);
    log(`recovery: ${result.recovery}`);
    return;
  }
  fail('Usage: stack.ts anomaly <status|source-suspend <id>|session-revoke>');
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case 'start': await commandStart(); break;
    case 'stop': await commandStop(); break;
    case 'restart': await commandStop(); await commandStart(); break;
    case 'status': await commandStatus(); break;
    case 'destroy': await commandDestroy(); break;
    case 'desktop': commandDesktop(); break;
    case 'anomaly': await commandAnomaly(process.argv[3]); break;
    default:
      fail('Usage: node scripts/synthetic-stack/stack.ts <start|stop|restart|status|destroy|desktop|anomaly>');
  }
}

void main().catch((error: unknown) => {
  console.error(`[stack] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
