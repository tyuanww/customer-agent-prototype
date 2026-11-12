import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { applyMigrationPrefix, verifyAppliedDatabaseMigrations } from '../../packages/database/dist/index.js';
import { buildAccount } from './identity-admission.ts';
import { SYNTHETIC_SCRIPT_IDS } from './content.ts';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const entry = fileURLToPath(new URL('./stack.ts', import.meta.url));

function launch(args: string[], environment: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [entry, ...args], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  return { child, exited, output: () => output };
}

async function waitFor(predicate: () => boolean, description: () => string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(description());
    await delay(100);
  }
}

function runtimeFixture(parent: string): string {
  const candidate = path.join(parent, 'candidate');
  mkdirSync(candidate);
  const packages = ['contracts', 'retrieval-core', 'job-roster', 'unified-contracts', 'content-intake', 'database']
    .map((name) => `packages/${name}`).concat('apps/api');
  const archive = execFileSync('git', ['archive', 'HEAD',
    '.gitignore', 'package.json', 'VERSION', 'scripts/synthetic-stack',
    'apps/desktop/src/shared/runtime-ports.ts', 'apps/desktop/src/shared/synthetic-catalog.ts',
    'packages/database/migrations/manifest.generated.json',
    ...packages.map((directory) => `${directory}/package.json`),
  ], { cwd: repository, maxBuffer: 8 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', candidate], { input: archive });
  writeFileSync(path.join(candidate, 'scripts/synthetic-stack/stack.ts'), 'throw new Error("release bootstrap must never execute");\n');
  for (const directory of packages) {
    cpSync(path.join(repository, directory, 'dist'), path.join(candidate, directory, 'dist'), { recursive: true });
  }
  for (const directory of ['', ...packages]) {
    const source = path.join(repository, directory, 'node_modules');
    const target = path.join(candidate, directory, 'node_modules');
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source).filter((name) => !name.startsWith('.'))) {
      if (name === '@customer-agent') {
        mkdirSync(path.join(target, name));
        for (const dependency of readdirSync(path.join(source, name))) {
          symlinkSync(path.relative(path.join(target, name), path.join(candidate, 'packages', dependency)), path.join(target, name, dependency), 'dir');
        }
      } else {
        symlinkSync(realpathSync(path.join(source, name)), path.join(target, name), 'dir');
      }
    }
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', candidate, ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8',
  }).trim();
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Synthetic test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'runtime fixture');
  const release = path.join(parent, git('rev-parse', 'HEAD'));
  renameSync(candidate, release);
  return release;
}

test('existing database CLI enforces the runtime schema floor and preserves state through supervision', {
  skip: process.env.CUSTOMER_AGENT_STACK_PG15_INTEGRATION !== '1', timeout: 240_000,
}, async (t) => {
  const root = realpathSync(mkdtempSync('/tmp/stack-existing-'));
  const previousRoot = process.env.CUSTOMER_AGENT_STACK_ROOT;
  process.env.CUSTOMER_AGENT_STACK_ROOT = root;
  const { SyntheticCluster, ensureDatabase, ensureLoginRoles, writeClusterMarker } = await import('./postgres.ts');
  const { PG_PORT, stackPortPairForRoot, writeProfile } = await import('./profile.ts');
  const { readProcess, stopProcess, isOwnedProcessLive } = await import('./process.ts');
  const cluster = new SyntheticCluster();
  const ports = stackPortPairForRoot(root);
  const profile = {
    version: 1 as const, environment: 'synthetic-local' as const, createdAt: new Date().toISOString(), stackRoot: root,
    apiOrigin: `http://127.0.0.1:${ports.api}`, identityOrigin: `http://127.0.0.1:${ports.identity}`,
    apiPort: ports.api, identityPort: ports.identity, databaseName: 'existing_synthetic_test', pgPort: PG_PORT,
    pgSocketDirectory: cluster.socket, objectStoreDirectory: path.join(root, 'objects'), clientId: 'existing_synthetic_test',
  };
  const desktop = path.join(root, 'desktop');
  const environment = { ...process.env, CUSTOMER_AGENT_STACK_ROOT: root, CUSTOMER_AGENT_DESKTOP_USERDATA: desktop };
  writeProfile(profile);
  mkdirSync(desktop);
  const desktopFile = path.join(desktop, 'synthetic-stack.json');
  writeFileSync(desktopFile, '{"mode":"synthetic-offline"}\n');
  writeFileSync(path.join(root, 'api.env'), 'CUSTOMER_AGENT_QUERY_MODE=intake-compat\n');
  const profileBefore = readFileSync(path.join(root, 'profile.json'));
  const desktopBefore = readFileSync(desktopFile);
  let admin: ReturnType<typeof cluster.connect> | undefined;
  let supervisor: ReturnType<typeof launch> | undefined;
  const run = async (...args: string[]) => {
    const process = launch(args, environment);
    const status = await process.exited;
    return { status, output: process.output() };
  };
  const assertNoChildren = () => {
    for (const name of ['identity', 'api', 'worker', 'stack-foreground']) {
      const record = readProcess(name);
      assert.ok(!record || !isOwnedProcessLive(record), `${name} still running`);
    }
  };
  try {
    await t.test('missing PG is rejected without initialization', async () => {
      const result = await run('start', '--existing-database');
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /existing stack-owned PostgreSQL cluster/u);
      assert.equal(existsSync(path.join(cluster.data, 'PG_VERSION')), false);
    });
    cluster.ensureRunning();
    writeClusterMarker();
    await t.test('missing database is rejected without creation', async () => {
      const result = await run('start', '--existing-database');
      assert.equal(result.status, 1, result.output);
      const owner = cluster.connect('postgres');
      await owner.connect();
      try {
        assert.equal((await owner.query('SELECT 1 FROM pg_database WHERE datname=$1', [profile.databaseName])).rowCount, 0);
      } finally { await owner.end(); }
    });
    await ensureDatabase(cluster, profile.databaseName);
    admin = cluster.connect(profile.databaseName);
    await admin.connect();
    await applyMigrationPrefix(admin, 81);
    await ensureLoginRoles(cluster, profile.databaseName);
    const { seedIntakeSyntheticHost } = await import('../../apps/api/tests/support/intake-synthetic-seed.ts');
    await seedIntakeSyntheticHost(admin);
    await admin.query("UPDATE content_intake.grants SET version=version+1, revoked_at=clock_timestamp(), last_change_reason='synthetic retained revocation' WHERE grant_id='business-agent-query'");
    await admin.query(`INSERT INTO backend_identity.subject_bindings
      (binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
      VALUES ('synthetic_agent','synthetic','retained-test','synthetic_agent','retained-agent',repeat('a',64),false,'agent')`);
    await t.test('a runtime requiring later migrations is rejected before launching children', async () => {
      assert.ok(admin);
      const before = (await admin.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
      const result = await run('start', '--existing-database');
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /Runtime release requires 88 migrations; applied database has 81/u);
      assertNoChildren();
      assert.deepEqual((await admin.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows, before);
    });
    await applyMigrationPrefix(admin, 88);
    const bindingsBefore = (await admin.query('SELECT * FROM backend_identity.subject_bindings ORDER BY binding_id')).rows;
    const ledgerBefore = (await admin.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows;
    const grantsBefore = (await admin.query('SELECT * FROM content_intake.grants ORDER BY grant_id')).rows;
    const rolesBefore = (await admin.query('SELECT rolname,rolcanlogin,rolinherit FROM pg_roles ORDER BY rolname')).rows;
    const assertRetained = async () => {
      assert.ok(admin);
      assert.deepEqual((await admin.query('SELECT * FROM backend_identity.subject_bindings ORDER BY binding_id')).rows, bindingsBefore);
      assert.deepEqual((await admin.query('SELECT * FROM customer_agent_meta.schema_migrations ORDER BY position')).rows, ledgerBefore);
      assert.deepEqual((await admin.query('SELECT * FROM content_intake.grants ORDER BY grant_id')).rows, grantsBefore);
      assert.deepEqual((await admin.query('SELECT rolname,rolcanlogin,rolinherit FROM pg_roles ORDER BY rolname')).rows, rolesBefore);
      assert.deepEqual(readFileSync(path.join(root, 'profile.json')), profileBefore);
      assert.deepEqual(readFileSync(desktopFile), desktopBefore);
    };
    await t.test('identity startup failure cleans newly launched processes', async () => {
      const result = await run('start', '--existing-database');
      assert.equal(result.status, 1, result.output);
      assertNoChildren();
      await assertRetained();
    });
    writeFileSync(path.join(root, 'password-accounts.json'), JSON.stringify([buildAccount('agent', 'synthetic_agent', 'synthetic-password-unique')]));
    const release = runtimeFixture(root);
    const current = path.join(root, 'current');
    symlinkSync(release, current, 'dir');
    await t.test('default runtime starts from the stopped existing PG without modifying retained state', async () => {
      await admin?.end();
      admin = undefined;
      cluster.stop();
      const result = await run('start', '--existing-database');
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /applied database prefix: 88 \(PASS\)/u);
      assert.equal((await fetch(`${profile.apiOrigin}/ready`)).status, 200);
      for (const name of ['identity', 'api', 'worker']) {
        const record = readProcess(name);
        assert.ok(record && isOwnedProcessLive(record));
        assert.ok(record.command.includes(repository.slice(0, -1)));
      }
      admin = cluster.connect(profile.databaseName);
      await admin.connect();
      await assertRetained();
      const identities = ['identity', 'api', 'worker'].map((name) => readProcess(name)?.pid);
      const repeated = await run('start', '--existing-database');
      assert.equal(repeated.status, 0, repeated.output);
      assert.deepEqual(['identity', 'api', 'worker'].map((name) => readProcess(name)?.pid), identities);
      const differentRuntime = await run('start', '--existing-database', '--runtime-release', current);
      assert.equal(differentRuntime.status, 1, differentRuntime.output);
      assert.match(differentRuntime.output, /belongs to another runtime release/u);
      assert.deepEqual(['identity', 'api', 'worker'].map((name) => readProcess(name)?.pid), identities);
      await assertRetained();
      for (const name of ['worker', 'api', 'identity']) await stopProcess(name);
    });
    await t.test('selected runtime entries run under the new foreground controller and child exit fails the service', async () => {
      supervisor = launch(['start', '--existing-database', '--runtime-release', current, '--foreground'], environment);
      await waitFor(() => supervisor?.output().includes('Foreground supervisor is active') === true || supervisor?.child.exitCode !== null,
        () => supervisor?.output() ?? 'supervisor missing');
      assert.equal(supervisor.child.exitCode, null, supervisor.output());
      assert.equal((await fetch(`${profile.apiOrigin}/ready`)).status, 200);
      for (const name of ['identity', 'api', 'worker']) {
        const record = readProcess(name);
        assert.ok(record && isOwnedProcessLive(record));
        assert.ok(record.command.startsWith(`${process.execPath} ${release}/`), record.command);
      }
      await assertRetained();
      await stopProcess('worker');
      assert.equal(await supervisor.exited, 1, supervisor.output());
      assert.match(supervisor.output(), /foreground child worker exited/u);
      supervisor = undefined;
      assertNoChildren();
      await assertRetained();
    });
    await t.test('unknown ledger and physical drift fail before launching runtime children', async () => {
      assert.ok(admin);
      await admin.query("UPDATE customer_agent_meta.schema_migrations SET migration_sha256=repeat('0',64) WHERE position=81");
      const result = await run('start', '--existing-database');
      assert.equal(result.status, 1, result.output);
      assertNoChildren();
      assert.equal((await admin.query('SELECT migration_sha256 FROM customer_agent_meta.schema_migrations WHERE position=81')).rows[0]?.migration_sha256, '0'.repeat(64));
      await admin.query('UPDATE customer_agent_meta.schema_migrations SET migration_sha256=$1 WHERE position=81', [ledgerBefore.find(row => row.position === 81)?.migration_sha256]);
      await admin.query('REVOKE EXECUTE ON FUNCTION public.content_question_hash(jsonb) FROM intake_runtime_fn_owner');
      const drift = await run('start', '--existing-database');
      assert.equal(drift.status, 1, drift.output);
      assertNoChildren();
      await admin.query('GRANT EXECUTE ON FUNCTION public.content_question_hash(jsonb) TO intake_runtime_fn_owner');
      assert.equal((await verifyAppliedDatabaseMigrations(admin)).migrationCount, 88);
    });
    await t.test('dirty and incomplete releases fail before launching children', async () => {
      const tracked = path.join(release, 'VERSION');
      const original = readFileSync(tracked);
      writeFileSync(tracked, 'dirty\n');
      const dirty = await run('start', '--existing-database', '--runtime-release', current);
      assert.equal(dirty.status, 1, dirty.output);
      assert.match(dirty.output, /Runtime release must be clean/u);
      writeFileSync(tracked, original);
      const main = path.join(release, 'apps/api/dist/main.js');
      renameSync(main, `${main}.retained`);
      const missing = await run('start', '--existing-database', '--runtime-release', current);
      assert.equal(missing.status, 1, missing.output);
      assert.match(missing.output, /Runtime release entry must be a regular file/u);
      renameSync(`${main}.retained`, main);
      assertNoChildren();
      await assertRetained();
    });
    await t.test('mismatched Git identity, symlinked entry and foreign workspace dependency fail closed', async () => {
      const wrongName = path.join(root, 'wrong-release-name');
      renameSync(release, wrongName);
      const wrongGit = await run('start', '--existing-database', '--runtime-release', wrongName);
      assert.equal(wrongGit.status, 1, wrongGit.output);
      assert.match(wrongGit.output, /Runtime release directory must match its full Git SHA/u);
      renameSync(wrongName, release);
      const main = path.join(release, 'apps/api/dist/main.js');
      renameSync(main, `${main}.retained`);
      symlinkSync(path.join(repository, 'apps/api/dist/main.js'), main);
      const link = await run('start', '--existing-database', '--runtime-release', current);
      assert.equal(link.status, 1, link.output);
      assert.match(link.output, /Runtime release entry must be a regular file/u);
      rmSync(main);
      renameSync(`${main}.retained`, main);
      const dependency = path.join(release, 'apps/api/node_modules/@customer-agent/contracts');
      renameSync(dependency, `${dependency}.retained`);
      symlinkSync(path.join(repository, 'packages/contracts'), dependency, 'dir');
      const foreign = await run('start', '--existing-database', '--runtime-release', current);
      assert.equal(foreign.status, 1, foreign.output);
      assert.match(foreign.output, /Runtime workspace dependency escapes its release/u);
      rmSync(dependency);
      renameSync(`${dependency}.retained`, dependency);
      assertNoChildren();
      await assertRetained();
    });
  } finally {
    for (const name of ['worker', 'api', 'identity']) await stopProcess(name);
    if (supervisor) {
      supervisor.child.kill('SIGTERM');
      await supervisor.exited;
    }
    await admin?.end();
    cluster.stop();
    rmSync(root, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.CUSTOMER_AGENT_STACK_ROOT;
    else process.env.CUSTOMER_AGENT_STACK_ROOT = previousRoot;
  }
});

test('normal start and restart retain their preparation defaults', {
  skip: process.env.CUSTOMER_AGENT_STACK_PG15_INTEGRATION !== '1', timeout: 180_000,
}, async () => {
  const root = realpathSync(mkdtempSync('/tmp/stack-prepare-'));
  const environment = { ...process.env, CUSTOMER_AGENT_STACK_ROOT: root, CUSTOMER_AGENT_DESKTOP_USERDATA: path.join(root, 'desktop') };
  writeFileSync(path.join(root, 'password-accounts.json'), JSON.stringify([
    ...['agent', 'coach', 'quality', 'owner'].map((role) => buildAccount(role, `synthetic_${role}`, 'synthetic-normal-start-password')),
  ]));
  const run = async (...args: string[]) => {
    const process = launch(args, environment);
    return { status: await process.exited, output: process.output() };
  };
  try {
    const first = await run('start');
    assert.equal(first.status, 0, first.output);
    assert.ok(first.output.includes(`seeded ${SYNTHETIC_SCRIPT_IDS.length} scripts`), first.output);
    assert.ok(existsSync(path.join(root, 'profile.json')));
    assert.ok(existsSync(path.join(root, 'desktop/synthetic-stack.json')));
    const restart = await run('restart');
    assert.equal(restart.status, 0, restart.output);
    assert.match(restart.output, /seed: already published/u);
    assert.match(restart.output, /ready:/u);
  } finally {
    const stopped = await run('stop');
    assert.equal(stopped.status, 0, stopped.output);
    rmSync(root, { recursive: true, force: true });
  }
});
