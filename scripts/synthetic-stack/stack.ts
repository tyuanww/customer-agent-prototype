#!/usr/bin/env node
/**
 * Local synthetic stack for the macOS client.
 *
 *   node scripts/synthetic-stack/stack.ts start     prepare + start + seed + verify
 *   node scripts/synthetic-stack/stack.ts start --no-seed
 *       prepare + start only, leaving the synthetic catalog out. Use this for a
 *       stack that serves a real catalog: the demo CSV must never be imported
 *       into it. Skips the seed and the search self-check that asserts it.
 *       Implied, and not needed, when content.env names its own database - a
 *       stack that declares a real database is never seeded, so `restart` cannot
 *       re-enter the seed path just because the flag was left off the command.
 *   node scripts/synthetic-stack/stack.ts start --foreground --no-seed
 *       production mode: keep identity, API and worker attached to this process;
 *       an unexpected child exit fails the service so systemd can restart the group.
 *   node scripts/synthetic-stack/stack.ts start --existing-database [--foreground]
 *       verify the existing applied prefix and start services with existing roles
 *       and configuration. Profile, migrations, bindings and grants are retained.
 *       --runtime-release <absolute-release> pins a clean SHA-named release's
 *       API, identity and worker entries under this controller's supervision.
 *   node scripts/synthetic-stack/stack.ts stop      stop the processes this stack owns
 *   node scripts/synthetic-stack/stack.ts restart
 *   node scripts/synthetic-stack/stack.ts status    report readiness of each piece
 *   node scripts/synthetic-stack/stack.ts destroy   stop, then remove the isolated cluster
 *   node scripts/synthetic-stack/stack.ts desktop           print the desktop client env for this stack
 *   node scripts/synthetic-stack/stack.ts packaged-profile  write/print userData synthetic-stack.json path
 *   node scripts/synthetic-stack/stack.ts anomaly           status | session-revoke | source-suspend <id>
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
 *
 * Stack-root env files, all optional, each with one job:
 *   feishu.env   Feishu OAuth client and role bindings (flips AUTH_MODE to feishu)
 *   content.env  the content constants a real catalog needs; DATABASE_NAME too
 *   api.env      portable production secrets (profile name, HMAC material).
 *                Derived values - DSNs, paths, ports - are refused, not merged.
 */
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogReferences } from '../../apps/desktop/src/shared/synthetic-catalog.ts';
import { SYNTHETIC_SCRIPT_IDS } from './content.ts';
import { bootstrapDatabase, seedFeishuBindings } from './bootstrap.ts';
import { bindMenokinTestIdentities } from './menokin-test-binding.ts';
import {
  DATABASE_NAME, LOG_DIRECTORY, OBJECT_STORE_DIRECTORY, PG_PORT, PG_SOCKET_DIRECTORY,
  PROFILE_FILE, STACK_ROOT, SYNTHETIC_IDENTITIES, ensureStackDirectories,
  loadApiStackConfig, loadContentStackConfig, loadFeishuStackConfig,
  readProfile, shouldSeedSyntheticCatalog, stackEnvironmentForRoot, stackPortPairForRoot,
  stackApiEnvironment, validateStackDatabaseConfig, writeDesktopPackagedProfile, writeProfile,
} from './profile.ts';
import type { ContentStackConfig, StackProfile } from './profile.ts';
import {
  SyntheticCluster, clusterVersionText, ensureDatabase, ensureLoginRoles, writeClusterMarker,
} from './postgres.ts';
import {
  forgetProcess, isOwnedProcessLive, portInUse, processCommandLine, readProcess, recordProcess, stopProcess, waitForHttp,
} from './process.ts';
import { loginAs, seedContentIfMissing } from './seed.ts';
import { anomalyStatus, revokeSessions, suspendSource } from './anomaly.ts';
import { identityProcessEnvironment } from './identity-admission.ts';
import { verifyAppliedDatabaseMigrations } from '../../packages/database/dist/index.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FOREGROUND_PROCESS_NAME = 'stack-foreground';

function log(message: string): void {
  console.info(`[stack] ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}

type ProcessLaunchMode = 'detached' | 'foreground';
type DatabaseStartMode = 'prepare' | 'existing-database';

type ChildExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}>;

type SpawnedProcess = Readonly<{
  name: string;
  pid: number;
  child: ChildProcess;
  exited: Promise<ChildExit>;
}>;

type StartProcessesResult = Readonly<{
  messages: readonly string[];
  children: readonly SpawnedProcess[];
  ready: Record<string, unknown>;
}>;

function spawnLogged(
  name: string,
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  mode: ProcessLaunchMode,
  runtimeRoot: string,
): SpawnedProcess {
  ensureStackDirectories();
  const out = openSync(path.join(LOG_DIRECTORY, `${name}.log`), 'a');
  try {
    const child = spawn(command, [...args], {
      cwd: runtimeRoot,
      env: environment,
      stdio: ['ignore', out, out],
      detached: mode === 'detached',
    });
    if (child.pid === undefined) fail(`${name}: spawn produced no pid`);
    const exited = new Promise<ChildExit>((resolve) => {
      let settled = false;
      const settle = (result: ChildExit): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      child.once('error', (error: Error) => {
        log(`${name} process error: ${error.message}`);
        settle({ code: null, signal: null, error });
      });
      child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        settle({ code, signal });
      });
    });
    if (mode === 'detached') child.unref();
    try {
      recordProcess(name, child.pid, `${command} ${args.join(' ')}`);
    } catch (error) {
      child.kill('SIGTERM');
      throw error;
    }
    return Object.freeze({ name, pid: child.pid, child, exited });
  } finally {
    closeSync(out);
  }
}

async function readJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  const value: unknown = await response.json().catch(() => ({}));
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function requireDist(runtimeRoot: string): void {
  for (const relative of ['apps/api/dist/main.js', 'apps/api/dist/content-worker-main.js']) {
    const entry = path.join(runtimeRoot, relative);
    if (!existsSync(entry)) {
      fail(`Missing ${relative}. Run: pnpm build:services`);
    }
  }
}

/** The publisher binds build fingerprints and keeps the release immutable.
 * Selecting application entries directly preserves existing authorizations
 * while this controller pins the resolved runtime path for every child. */
function resolveRuntimeRoot(requested: string | undefined): string {
  if (requested === undefined) return repositoryRoot;
  if (!path.isAbsolute(requested)) fail('--runtime-release requires an absolute release path');
  const root = realpathSync(requested);
  if (!lstatSync(root).isDirectory()) fail('Runtime release must be a directory');
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('GIT_')) delete environment[key];
  }
  Object.assign(environment, {
    GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: root,
  });
  const git = (...args: string[]): string => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', env: environment, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const sha = git('rev-parse', '--verify', 'HEAD^{commit}');
  if (!/^[0-9a-f]{40}$/u.test(sha) || path.basename(root) !== sha
    || realpathSync(git('rev-parse', '--show-toplevel')) !== root) {
    fail('Runtime release directory must match its full Git SHA');
  }
  if (git('status', '--porcelain=v1', '--untracked-files=all').length > 0) fail('Runtime release must be clean');
  for (const relative of [
    'apps/api/dist/main.js', 'apps/api/dist/content-worker-main.js',
    'scripts/synthetic-stack/identity-provider.ts', 'scripts/synthetic-stack/password-identity-server.ts',
  ]) {
    const entry = path.join(root, relative);
    if (!existsSync(entry) || !lstatSync(entry).isFile() || realpathSync(entry) !== entry) {
      fail(`Runtime release entry must be a regular file inside the release: ${relative}`);
    }
  }
  const pending = [path.join(root, 'apps/api')];
  const visited = new Set<string>();
  for (const directory of pending) {
    if (visited.has(directory)) continue;
    visited.add(directory);
    const metadata: unknown = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (metadata === null || typeof metadata !== 'object') fail('Runtime package metadata is invalid');
    if (!('dependencies' in metadata)) continue;
    const dependencies = metadata.dependencies;
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) fail('Runtime dependencies are invalid');
    const require = createRequire(path.join(directory, 'package.json'));
    for (const name of Object.keys(dependencies)) {
      if (!name.startsWith('@customer-agent/')) continue;
      if (!/^@customer-agent\/[a-z0-9][a-z0-9-]*$/u.test(name)) fail('Runtime workspace dependency name is invalid');
      const target = path.join(root, 'packages', name.slice('@customer-agent/'.length));
      const searchRoot = require.resolve.paths(name)?.find((entry) => existsSync(path.join(entry, name)));
      if (!searchRoot || !existsSync(target) || realpathSync(target) !== target
        || realpathSync(path.join(searchRoot, name)) !== target) {
        fail(`Runtime workspace dependency escapes its release: ${name}`);
      }
      pending.push(target);
    }
  }
  log(`runtime release: ${root} (Git ${sha})`);
  return root;
}

async function resolvePort(port: number, name: 'api' | 'identity'): Promise<number> {
  if (await portInUse(port)) {
    const environment = stackEnvironmentForRoot(STACK_ROOT);
    const recovery = environment === 'synthetic-local'
      ? ' Stop the process using it, or point CUSTOMER_AGENT_STACK_ROOT at a different path, which shifts both ports.'
      : ' Stop the process registered for this environment; managed test and production ports must not be shifted.';
    fail(
      `Port ${String(port)} (${name}, ${environment}) is already in use.${recovery}`,
    );
  }
  return port;
}

async function resolveProfile(content: ContentStackConfig | undefined, { reuse }: { reuse: boolean }): Promise<StackProfile> {
  const existing = readProfile();
  const environment = stackEnvironmentForRoot(STACK_ROOT);
  validateStackDatabaseConfig({ stackRoot: STACK_ROOT, content, profile: existing });
  if (existing && reuse) return existing;
  const rootEnvironment = environment;
  const rootPorts = stackPortPairForRoot(STACK_ROOT);
  const apiPort = await resolvePort(rootPorts.api, 'api');
  const identityPort = await resolvePort(rootPorts.identity, 'identity');
  return Object.freeze({
    version: 1,
    environment: rootEnvironment,
    createdAt: new Date().toISOString(),
    stackRoot: path.dirname(PROFILE_FILE),
    apiOrigin: `http://127.0.0.1:${String(apiPort)}`,
    identityOrigin: `http://127.0.0.1:${String(identityPort)}`,
    apiPort,
    identityPort,
    databaseName: content?.databaseName ?? DATABASE_NAME,
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

function foregroundSupervisorLive(): boolean {
  const record = readProcess(FOREGROUND_PROCESS_NAME);
  if (record === undefined) return false;
  if (isOwnedProcessLive(record)) return true;
  forgetProcess(FOREGROUND_PROCESS_NAME);
  return false;
}

function claimForegroundSupervisor(): void {
  if (foregroundSupervisorLive()) fail('foreground supervisor is already running');
  const command = processCommandLine(process.pid)
    ?? [process.execPath, ...process.argv.slice(1)].join(' ');
  recordProcess(FOREGROUND_PROCESS_NAME, process.pid, command);
}

async function startProcesses(
  profile: StackProfile,
  content: ContentStackConfig | undefined,
  mode: ProcessLaunchMode,
  runtimeRoot: string,
): Promise<StartProcessesResult> {
  const messages: string[] = [];
  const live = new Set(liveProcessNames());
  const spawned: string[] = [];
  const children: SpawnedProcess[] = [];
  if (runtimeRoot !== repositoryRoot) {
    for (const name of live) {
      const command = readProcess(name)?.command;
      if (!command?.startsWith(`${process.execPath} ${runtimeRoot}${path.sep}`)) {
        fail(`Existing ${name} process belongs to another runtime release; stop it before changing releases`);
      }
    }
  }
  if (mode === 'detached' && foregroundSupervisorLive()) {
    messages.push('foreground supervisor already running; leaving child ownership to systemd');
    for (const name of ['identity', 'api', 'worker']) {
      messages.push(live.has(name) ? `${name} already running` : `${name} restart delegated to systemd`);
    }
    return Object.freeze({ messages: Object.freeze(messages), children: Object.freeze(children), ready: await waitReady(profile.apiOrigin) });
  }
  if (mode === 'foreground' && live.size > 0) {
    fail(`foreground start cannot adopt existing processes: ${[...live].sort().join(', ')}`);
  }
  /** A failed start must not leave the pieces it just launched behind. */
  const cleanup = async (): Promise<void> => {
    for (const name of spawned.reverse()) {
      const result = await stopProcess(name).catch((error: unknown) => `${name}: cleanup failed (${String(error)})`);
      log(result);
    }
  };

  try {
    const feishu = loadFeishuStackConfig();
    // Both override files are read before anything is spawned, so a rejected
    // api.env fails the start outright instead of leaving identity behind.
    const apiConfig = loadApiStackConfig();
    const environment = stackApiEnvironment({ profile, content, feishu, apiConfig });
    const identityEntry = path.join(runtimeRoot, 'scripts/synthetic-stack', feishu ? 'password-identity-server.ts' : 'identity-provider.ts');
    if (!live.has('identity')) {
      // Both identity servers resolve the accounts file from STACK_ROOT, which defaults
      // to ~/.customer-agent-synthetic-stack. Passing it explicitly matters when the
      // operator set CUSTOMER_AGENT_STACK_ROOT: the child would otherwise look in the
      // default home path (and, with no fallback password, refuse to start).
      const processInfo = spawnLogged('identity', process.execPath, [identityEntry, String(profile.identityPort)],
        identityProcessEnvironment(process.env, STACK_ROOT), mode, runtimeRoot);
      if (mode === 'foreground') children.push(processInfo);
      spawned.push('identity');
      messages.push(`identity pid ${String(processInfo.pid)}${feishu ? ' (password)' : ''}`);
    } else {
      messages.push('identity already running');
    }
    await waitForHttp(`${profile.identityOrigin}/health`, { timeoutMs: 15_000 });
    if (feishu) messages.push(`feishu: ${feishu.clientId} → ${feishu.redirectUri}`);
    // Key names only: an operator checking "did production config land" needs the
    // list, and none of these keys' names are secret.
    if (apiConfig) messages.push(`api.env: ${Object.keys(apiConfig).sort().join(', ')}`);

    if (!live.has('api')) {
      const processInfo = spawnLogged('api', process.execPath, [path.join(runtimeRoot, 'apps/api/dist/main.js')], environment, mode, runtimeRoot);
      if (mode === 'foreground') children.push(processInfo);
      spawned.push('api');
      messages.push(`api pid ${String(processInfo.pid)}`);
    } else {
      messages.push('api already running');
    }
    await waitForHttp(`${profile.apiOrigin}/health`, { timeoutMs: 30_000 });

    if (!live.has('worker')) {
      const processInfo = spawnLogged('worker', process.execPath, [path.join(runtimeRoot, 'apps/api/dist/content-worker-main.js')], environment, mode, runtimeRoot);
      if (mode === 'foreground') children.push(processInfo);
      spawned.push('worker');
      messages.push(`worker pid ${String(processInfo.pid)}`);
    } else {
      messages.push('worker already running');
    }
    const ready = await waitReady(profile.apiOrigin);
    return Object.freeze({ messages: Object.freeze(messages), children: Object.freeze(children), ready });
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function superviseForegroundProcesses(children: readonly SpawnedProcess[]): Promise<never> {
  if (children.length === 0) {
    return new Promise<never>(() => undefined);
  }
  const firstExit = await Promise.race(children.map(async (processInfo) => ({
    processInfo,
    exit: await processInfo.exited,
  })));
  const detail = firstExit.exit.error
    ? `error: ${firstExit.exit.error.message}`
    : `code=${String(firstExit.exit.code)} signal=${String(firstExit.exit.signal)}`;
  log(`foreground child ${firstExit.processInfo.name} exited (${detail}); stopping the remaining stack`);
  for (const processInfo of [...children].reverse()) {
    const result = await stopProcess(processInfo.name).catch((error: unknown) => `${processInfo.name}: cleanup failed (${String(error)})`);
    log(result);
  }
  throw new Error(`foreground child ${firstExit.processInfo.name} exited unexpectedly`);
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

async function runStart(foreground: boolean, databaseMode: DatabaseStartMode, runtimeRoot: string): Promise<void> {
  requireDist(runtimeRoot);
  // Read once: `resolveProfile` needs the database name and `stackApiEnvironment`
  // needs the content constants, and two reads could disagree if the file
  // changed between them - the profile would end up naming one catalog while the
  // overrides came from another.
  const content = loadContentStackConfig();
  // A stack that serves a real catalog must not import the demo CSV. On a freshly
  // prepared database the "already published" probe finds nothing, so the seed
  // would publish synthetic scripts as the live catalog. Everything that asserts
  // that catalog - the search self-check and the summary lines - goes with it.
  const noSeed = databaseMode === 'existing-database' || !shouldSeedSyntheticCatalog(process.argv, content?.databaseName);
  const skipReason = databaseMode === 'existing-database' ? '--existing-database'
    : process.argv.includes('--no-seed') ? '--no-seed' : 'content.env names its own database';
  const existingProfile = readProfile();
  if (databaseMode === 'existing-database' && !existingProfile) fail(`no profile at ${PROFILE_FILE}; existing-database requires a provisioned stack`);
  const profile = existingProfile ?? await resolveProfile(content, { reuse: true });
  validateStackDatabaseConfig({ stackRoot: STACK_ROOT, content, profile });
  if (databaseMode === 'prepare') writeProfile(profile);
  log(`stack root: ${profile.stackRoot}`);
  log(`api origin: ${profile.apiOrigin}  identity origin: ${profile.identityOrigin}`);
  if (databaseMode === 'prepare' && profile.environment !== 'production') {
    const packagedProfilePath = writeDesktopPackagedProfile(profile);
    log(`packaged desktop profile: ${packagedProfilePath}`);
  }

  const cluster = new SyntheticCluster();
  if (databaseMode === 'existing-database') {
    const marker = path.join(cluster.data, 'SYNTHETIC-STACK-MARKER');
    if (cluster.state() === 'absent' || !existsSync(marker)
      || !lstatSync(marker).isFile() || lstatSync(marker).isSymbolicLink()
      || !readFileSync(marker, 'utf8').startsWith('This PostgreSQL 15 cluster belongs to scripts/synthetic-stack.\n')) {
      fail('existing-database requires an existing stack-owned PostgreSQL cluster');
    }
  }
  cluster.ensureRunning();
  if (databaseMode === 'prepare') writeClusterMarker();
  log(`postgres: running (version ${clusterVersionText()}, socket ${cluster.socket})`);

  if (databaseMode === 'prepare') {
    const admin = cluster.connect('postgres');
    await admin.connect();
    try { log(await ensureDatabase(cluster, profile.databaseName)); } finally { await admin.end(); }
  }

  const database = cluster.connect(profile.databaseName);
  await database.connect();
  try {
    if (databaseMode === 'existing-database') {
      const report = await verifyAppliedDatabaseMigrations(database);
      const manifest: unknown = JSON.parse(readFileSync(
        path.join(runtimeRoot, 'packages/database/migrations/manifest.generated.json'), 'utf8'));
      if (manifest === null || typeof manifest !== 'object' || !('migrations' in manifest)
        || !Array.isArray(manifest.migrations) || manifest.migrations.length < 1
        || manifest.migrations.some((row: unknown, index: number) => row === null || typeof row !== 'object'
          || !('position' in row) || row.position !== index + 1)) {
        fail('Runtime release migration manifest is invalid');
      }
      if (report.migrationCount < manifest.migrations.length) {
        fail(`Runtime release requires ${String(manifest.migrations.length)} migrations; applied database has ${String(report.migrationCount)}`);
      }
      log(`applied database prefix: ${String(report.migrationCount)} (${report.status})`);
    } else {
      for (const step of await bootstrapDatabase(database, { syntheticReferenceData: !noSeed })) log(step);
      const feishu = loadFeishuStackConfig();
      if (feishu) log(await seedFeishuBindings(database, feishu.bindings));
      if (profile.databaseName !== 'customer_agent_formal') log(await bindMenokinTestIdentities(database, profile.databaseName));
    }
  } finally { await database.end(); }

  if (databaseMode === 'prepare') log(await ensureLoginRoles(cluster, profile.databaseName));

  const processes = await startProcesses(profile, content, foreground ? 'foreground' : 'detached', runtimeRoot);
  for (const step of processes.messages) log(step);
  log(`ready: ${JSON.stringify(processes.ready.checks)}`);

  if (noSeed) {
    log(`seed: skipped (${skipReason}); this stack serves a real catalog`);
    log(`search self-check skipped (${skipReason})`);
  } else {
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
  }
  log('');
  log('Stack is up. Launch the desktop client with:');
  log(`  ${desktopCommand(profile)}`);
  if (foreground) {
    log('Foreground supervisor is active; an unexpected child exit will fail this service.');
    await superviseForegroundProcesses(processes.children);
  }
}

async function commandStart(databaseMode: DatabaseStartMode, runtimeRoot: string): Promise<void> {
  const foreground = process.argv.includes('--foreground');
  if (!foreground) {
    await runStart(false, databaseMode, runtimeRoot);
    return;
  }
  claimForegroundSupervisor();
  try {
    await runStart(true, databaseMode, runtimeRoot);
  } finally {
    forgetProcess(FOREGROUND_PROCESS_NAME);
  }
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
  if (stackEnvironmentForRoot(STACK_ROOT) === 'production') {
    fail('Production stack destroy is disabled');
  }
  for (const name of ['worker', 'api', 'identity']) log(await stopProcess(name));
  log(new SyntheticCluster().destroy());
  for (const name of ['worker', 'api', 'identity']) forgetProcess(name);
  log('Isolated synthetic cluster removed. The user PostgreSQL installation was never touched.');
}

function commandDesktop(): void {
  const profile = readProfile();
  if (!profile) fail(`no profile at ${PROFILE_FILE}; run "start" first`);
  if (profile.environment === 'production') fail('Production stack has no desktop development handoff');
  writeDesktopPackagedProfile(profile);
  process.stdout.write(`${desktopCommand(profile)}\n`);
}

function commandPackagedProfile(): void {
  const profile = readProfile();
  if (!profile) fail(`no profile at ${PROFILE_FILE}; run "start" first`);
  if (profile.environment === 'production') fail('Production stack cannot write a synthetic desktop profile');
  process.stdout.write(`${writeDesktopPackagedProfile(profile)}\n`);
}

async function commandMigrate(): Promise<void> {
  if (!readProfile()) fail(`no profile at ${PROFILE_FILE}; run "start" first`);
  const profile = await resolveProfile(undefined, { reuse: true });
  const cluster = new SyntheticCluster();
  if (cluster.state() !== 'running') {
    fail('postgres is not running; migrate leaves the cluster stopped');
  }
  if (profile.databaseName === 'customer_agent_formal') fail('migrate refuses the formal catalog');
  const database = cluster.connect(profile.databaseName);
  await database.connect();
  try {
    for (const step of await bootstrapDatabase(database, { syntheticReferenceData: false })) log(step);
  } finally {
    await database.end();
  }
  log('migrate finished');
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
  const existingDatabase = process.argv.includes('--existing-database');
  if (existingDatabase && command !== 'start') fail('--existing-database is only supported by start');
  let runtimeRelease: string | undefined;
  if (command === 'start' || command === 'restart') {
    const allowed = new Set(['--no-seed', '--foreground', '--existing-database']);
    const options = process.argv.slice(3)[Symbol.iterator]();
    for (const option of options) {
      if (option === '--runtime-release') {
        const value = options.next().value;
        if (!existingDatabase || runtimeRelease !== undefined || !value || value.startsWith('--')) {
          fail('--runtime-release requires --existing-database and exactly one release path');
        }
        runtimeRelease = value;
        continue;
      }
      if (!allowed.has(option)) fail(`Unknown start option: ${option}`);
    }
  } else if (process.argv.includes('--runtime-release')) {
    fail('--runtime-release is only supported by start --existing-database');
  }
  const runtimeRoot = resolveRuntimeRoot(runtimeRelease);
  const databaseMode = existingDatabase ? 'existing-database' : 'prepare';
  switch (command) {
    case 'start': await commandStart(databaseMode, runtimeRoot); break;
    case 'stop': await commandStop(); break;
    case 'restart': await commandStop(); await commandStart(databaseMode, runtimeRoot); break;
    case 'status': await commandStatus(); break;
    case 'destroy': await commandDestroy(); break;
    case 'desktop': commandDesktop(); break;
    case 'packaged-profile': commandPackagedProfile(); break;
    case 'migrate': await commandMigrate(); break;
    case 'anomaly': await commandAnomaly(process.argv[3]); break;
    default:
      fail('Usage: node scripts/synthetic-stack/stack.ts <start [--no-seed] [--foreground] [--existing-database [--runtime-release <absolute-release>]]|stop|restart|status|destroy|desktop|packaged-profile|migrate|anomaly>');
  }
}

void main().catch((error: unknown) => {
  console.error(`[stack] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
