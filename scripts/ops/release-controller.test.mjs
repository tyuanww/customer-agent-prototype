import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { assertCandidateRuntimeUnchanged, assertControllerArtifactIsolation, readCandidateRelease } from './backup-set.mjs';
import { parseOptions } from './customer-agent-production-release.mjs';
import { readServiceStartup, ROLLBACK_PROTOCOL_CAPABILITIES, ROLLBACK_RUNTIME_SCOPE } from './release-proof.mjs';
import { PG_PORT, stackPortPairForRoot } from '../synthetic-stack/profile.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const packages = ['contracts', 'retrieval-core', 'job-roster', 'unified-contracts', 'content-intake', 'database']
  .map(name => `packages/${name}`).concat('apps/api');
const gitEnvironment = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
const digest = value => createHash('sha256').update(value).digest('hex');

function write(root, relative, bytes) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return file;
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: gitEnvironment });
}

function commit(root) {
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'synthetic controller artifact');
  return git(root, 'rev-parse', 'HEAD').trim();
}

function migration(position) {
  return { position, id: `${String(position).padStart(4, '0')}_fixture`, sha256: String(position).repeat(64),
    contract_set_id: 'synthetic-controller', source_git_sha: 'c'.repeat(40), source_schema_sha256: 'd'.repeat(64) };
}

function setVersion(root, version, count) {
  write(root, 'VERSION', `${version}\n`);
  write(root, 'apps/desktop/package.json', JSON.stringify({ version, type: 'module' }));
  const migrations = Array.from({ length: count }, (_, index) => migration(index + 1));
  write(root, 'packages/database/migrations/manifest.generated.json', JSON.stringify({ migrations }));
  const catalogue = migrations.map(row => ({ position: row.position, id: row.id, sha256: row.sha256,
    contractSetId: row.contract_set_id, sourceGitSha: row.source_git_sha, sourceSchemaSha256: row.source_schema_sha256 }));
  write(root, 'packages/database/src/generated/migrations.generated.ts',
    `export const generatedMigrationCatalogue = ${JSON.stringify({ migrations: catalogue })};\n`);
}

function compile(root, directories = packages) {
  const compiler = path.join(repositoryRoot, 'packages/database/node_modules/typescript/bin/tsc');
  for (const directory of directories) {
    execFileSync(process.execPath, [compiler, '-p', `${directory}/tsconfig.build.json`],
      { cwd: root, env: gitEnvironment, stdio: 'pipe' });
  }
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'release-controller-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const seed = path.join(root, 'seed');
  write(seed, '.gitignore', '**/dist/\n**/node_modules/\n');
  write(seed, 'package.json', '{"private":true,"type":"module"}\n');
  write(seed, 'README.md', 'Synthetic controller fixture.\n');
  copyFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml'), path.join(seed, 'pnpm-lock.yaml'));
  const scope = path.join(seed, 'node_modules/@customer-agent');
  mkdirSync(scope, { recursive: true });
  for (const dependency of ['@types', 'vitest']) {
    symlinkSync(path.join(repositoryRoot, 'packages/database/node_modules', dependency),
      path.join(seed, 'node_modules', dependency), 'dir');
  }
  for (const directory of packages) {
    for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json']) {
      write(seed, `${directory}/${file}`, readFileSync(path.join(repositoryRoot, directory, file)));
    }
    write(seed, `${directory}/src/index.ts`, 'export const fixture = true;\n');
    symlinkSync(path.relative(scope, path.join(seed, directory)), path.join(scope, path.basename(directory)), 'dir');
  }
  write(seed, 'packages/database/src/verifier.ts', 'export const verifier = true;\n');
  for (const file of ['scripts/synthetic-stack/profile.ts', 'apps/desktop/src/shared/runtime-ports.ts']) {
    write(seed, file, readFileSync(path.join(repositoryRoot, file)));
  }
  write(seed, 'scripts/synthetic-stack/stack.ts', 'import "./profile.ts";\n');
  for (const [file, names] of [['runtime-config', 'parseApiRuntimeConfig, parseApiPrivateBootstrapConfig'],
    ['runtime-config/database', 'postgresLoginName, postgresDatabaseTarget']]) {
    const parser = pathToFileURL(path.join(repositoryRoot, `apps/api/dist/${file}.js`)).href;
    write(seed, `apps/api/src/${file}.ts`,
      `const parser: string = ${JSON.stringify(parser)};\nexport const { ${names} } = await import(parser);\n`);
  }
  setVersion(seed, '0.3.42', 1);
  compile(seed);
  git(seed, 'init', '-q');
  const previousSha = commit(seed);
  const previousRoot = path.join(root, 'releases', previousSha);
  mkdirSync(path.dirname(previousRoot));
  renameSync(seed, previousRoot);
  cpSync(previousRoot, seed, { recursive: true, verbatimSymlinks: true });
  setVersion(seed, '0.3.43', 2);
  compile(seed, ['packages/database']);
  const sha = commit(seed);
  const candidateRoot = path.join(root, 'releases', sha);
  renameSync(seed, candidateRoot);
  const controllerRoot = path.join(root, 'controllers', sha);
  cpSync(candidateRoot, controllerRoot, { recursive: true, verbatimSymlinks: true });
  const controllerObjects = path.join(controllerRoot, '.git/objects');
  rmSync(controllerObjects, { recursive: true });
  symlinkSync(path.join(candidateRoot, '.git/objects'), controllerObjects, 'dir');
  const readme = path.join(controllerRoot, 'README.md');
  rmSync(readme);
  linkSync(path.join(candidateRoot, 'README.md'), readme);
  const stackRoot = path.join(root, 'stack');
  mkdirSync(stackRoot);
  const ports = stackPortPairForRoot(stackRoot);
  write(stackRoot, 'profile.json', JSON.stringify({ version: 1, createdAt: '2026-11-12T00:00:00Z', stackRoot,
    databaseName: 'synthetic_controller', apiOrigin: `http://127.0.0.1:${ports.api}`,
    identityOrigin: `http://127.0.0.1:${ports.identity}`, apiPort: ports.api, identityPort: ports.identity,
    pgPort: PG_PORT, pgSocketDirectory: path.join(stackRoot, 'data/pg15-socket'),
    objectStoreDirectory: path.join(stackRoot, 'objects'), clientId: 'synthetic-controller' }));
  const original = Buffer.from('# synthetic private bytes\r\nCUSTOMER_AGENT_BUILD_VERSION=0.3.42\r\nCUSTOMER_AGENT_QUERY_MODE=intake-compat\r\n');
  const envFile = path.join(stackRoot, 'api.env');
  writeFileSync(envFile, original, { mode: 0o600 });
  symlinkSync(previousRoot, path.join(root, 'current'), 'dir');
  mkdirSync(path.join(root, 'release-evidence'), { mode: 0o700 });
  const evidenceFile = path.join(root, 'release-evidence/restore.json');
  const tenant = { schema: 'customer-agent-production-intake-tenancy/v1', ok: true, status: 'ready', blockers: [],
    activeBatchCount: 0, historicalDefaultBatchCount: 0 };
  const tenantFile = write(root, 'release-evidence/tenant.json', JSON.stringify(tenant));
  const options = parseOptions(['--root', root, '--stack-root', stackRoot, '--environment', 'test', '--sha', sha,
    '--expected-version', '0.3.43', '--backup-evidence', evidenceFile, '--tenant-report', tenantFile,
    '--controller-release', controllerRoot, '--unit', 'synthetic-controller.service']);
  return { root, candidateRoot, controllerRoot, previousRoot, stackRoot, envFile, evidenceFile, original, tenant, options };
}

async function loadHarness(relative, append, transform = source => source) {
  const target = new URL(relative, import.meta.url);
  target.searchParams.set('controller-test', '1');
  const hook = registerHooks({ load(url, context, nextLoad) {
    if (url !== target.href) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(target), 'utf8');
    return { format: 'module', source: `${transform(source)}\n${append}`, shortCircuit: true };
  } });
  try { return await import(target.href); } finally { hook.deregister(); }
}

const producer = await loadHarness('./backup-set.mjs', `
  const actualApplyCandidateRelease = applyCandidateRelease;
  export function useTestTransport(transport, dependencies) {
    verifyBackupSet = transport.verifyBackupSet;
    extractObjectArchive = async () => {};
    createScratchCluster = () => ({ socket: '/synthetic-socket', port: 43199, owner: 'synthetic', started: false });
    run = () => '';
    verifyRestoredDatabase = transport.verifyRestoredDatabase;
    writeEvidence = transport.writeEvidence;
    applyCandidateRelease = (...args) => actualApplyCandidateRelease(...args, dependencies);
  }
`);
const consumer = await loadHarness('./customer-agent-production-release.mjs', `
  let readServiceStartup = actualReadServiceStartup;
  export function useTestStartup(observe) { readServiceStartup = observe; }
  export { defaultDependencies };
`, source => {
  assert.equal(source.includes('assertControllerBinding, readServiceStartup,'), true);
  return source.replace('assertControllerBinding, readServiceStartup,',
    'assertControllerBinding, readServiceStartup as actualReadServiceStartup,');
});

test('first restart losing candidate dist restores the previous release within the same invocation', async t => {
  const f = fixture(t);
  const { observe, properties } = startup(f);
  await rehearse(f, observe);
  const observations = [];
  consumer.useTestStartup((expected, execute, read, settings) => {
    const result = observe(expected, execute, read, settings);
    observations.push({ declarationOnly: settings.declarationOnly, active: properties.ActiveState,
      current: realpathSync(path.join(f.root, 'current')), env: readFileSync(f.envFile) });
    return result;
  });
  const defaults = consumer.defaultDependencies(f.options);
  let count = 1;
  let restarts = 0;
  const failure = Object.assign(new Error('synthetic first restart failed'), { code: 'SYNTHETIC_RESTART_FAILED' });
  const candidateDist = path.join(f.candidateRoot, 'apps/api/dist');
  await assert.rejects(() => consumer.runProductionRelease({ ...f.options, apply: true }, { ...defaults,
    inspectTenancy: async () => f.tenant,
    inspectDatabase: async (_profile, next) => next.manifest.slice(0, count).map(row => row.id),
    inspectContentFingerprint: async () => 'f'.repeat(64),
    applyDatabase: async (_profile, next) => {
      count = next.manifest.length;
      return { verifierStatus: 'PASS', appliedIds: next.manifest.slice(1).map(row => row.id),
        finalIds: next.manifest.map(row => row.id) };
    },
    verifyRollbackDatabase: async () => {},
    restartService: async () => {
      restarts += 1;
      if (restarts === 1) {
        assert.equal(realpathSync(path.join(f.root, 'current')), f.candidateRoot);
        rmSync(candidateDist, { recursive: true });
        Object.assign(properties, { MainPID: '0', ActiveState: 'failed' });
        throw failure;
      }
      assert.equal(existsSync(candidateDist), false);
      assert.equal(realpathSync(path.join(f.root, 'current')), f.previousRoot);
      assert.deepEqual(readFileSync(f.envFile), f.original);
      Object.assign(properties, { MainPID: '123', ActiveState: 'active' });
    },
    waitForReady: async (_profile, version) => assert.equal(version, '0.3.42'),
  }), error => {
    assert.equal(error, failure);
    return true;
  });
  assert.equal(restarts, 2);
  assert.equal(count, 2);
  assert.equal(existsSync(candidateDist), false);
  assert.equal(realpathSync(path.join(f.root, 'current')), f.previousRoot);
  assert.deepEqual(readFileSync(f.envFile), f.original);
  assert.deepEqual(observations.at(-1), { declarationOnly: false, active: 'active',
    current: f.previousRoot, env: f.original });
  const state = JSON.parse(readFileSync(f.options.stateFile));
  assert.equal(state.status, 'rolled_back');
  assert.equal(state.apiEnvBackup, null);
  assert.equal(existsSync(path.join(f.root, 'deploy.lock')), false);
});

function startup(f) {
  const argv = [process.execPath, path.join(f.controllerRoot, 'scripts/synthetic-stack/stack.ts'),
    'start', '--foreground', '--existing-database', '--runtime-release', path.join(f.root, 'current')];
  const properties = { ExecStart: `{ path=${argv[0]} ; argv[]=${argv.join(' ')} ; ignore_errors=no ; pid=123 ; code=(null) ; status=0/0 }`,
    Environment: `CUSTOMER_AGENT_STACK_ROOT=${f.stackRoot}`, EnvironmentFiles: `${f.envFile} (ignore_errors=no)`,
    Type: 'simple', RemainAfterExit: 'no', Restart: 'always', MainPID: '123', ActiveState: 'active' };
  const execute = () => Object.entries(properties).map(([name, value]) => `${name}=${value}\n`).join('');
  const read = file => {
    if (file === '/proc/123/cmdline') return Buffer.from(`${argv.join('\0')}\0`);
    if (file === '/proc/123/environ') return Buffer.from(`${properties.Environment}\0`);
    return readFileSync(file);
  };
  const observe = (expected, _execute, _read, settings) => readServiceStartup(expected, execute, read, settings);
  consumer.useTestStartup(observe);
  return { observe, properties };
}

async function rehearse(f, observe, candidateApiEnv) {
  let count = 1;
  const raw = JSON.parse(readFileSync(path.join(f.candidateRoot, 'packages/database/migrations/manifest.generated.json')));
  const manifest = { backupId: 'synthetic-controller-backup', snapshotAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    application: { productVersion: '0.3.42', gitSha: path.basename(f.previousRoot) }, tooling: { sha256: 'a'.repeat(64) },
    objects: [], database: { databaseOwner: 'synthetic', aclFingerprint: 'a'.repeat(64), migrations: raw.migrations.slice(0, 1).map(row => ({
      position: row.position, migrationId: row.id, sha256: row.sha256, contractSetId: row.contract_set_id,
      sourceGitSha: row.source_git_sha, sourceSchemaSha256: row.source_schema_sha256,
    })) } };
  const generated = await import(pathToFileURL(path.join(f.candidateRoot, 'packages/database/dist/generated/migrations.generated.js')));
  producer.useTestTransport({
    verifyBackupSet: async () => ({ directory: f.root, manifest, manifestSha256: 'b'.repeat(64) }),
    verifyRestoredDatabase: async () => ({ objectCount: 0, receiptCount: 0, unreferencedObjectCount: 0,
      verifier: { status: 'PASS' }, verifierMode: 'synthetic-transport' }),
    writeEvidence: evidence => write(f.root, path.relative(f.root, f.evidenceFile), JSON.stringify(evidence)),
  }, {
    client: { connect: async () => {}, end: async () => {}, query: async () => ({ rows: [{ fingerprint: 'f'.repeat(64) }] }) },
    modules: [{ applyMigrationPrefix: async (_client, target) => {
      const applied = raw.migrations.slice(count, target); count = target; return { applied };
    }, verifyAppliedDatabaseMigrations: async () => ({ status: 'PASS', migrationCount: count }) }, {}, generated],
    probeRollback: async (_config, _release, migrationCount) => ({ migrationCount, status: 'PASS', code: null, capability: 'applied-prefix' }),
    probeRollbackRuntime: async ({ release, queryProfile, migrationCount }) => ({ status: 'PASS', code: null,
      scope: ROLLBACK_RUNTIME_SCOPE, migrationCount, queryMode: queryProfile.mode,
      protocolCapabilities: { ...ROLLBACK_PROTOCOL_CAPABILITIES }, applicationGitSha: release.gitSha,
      runtimeBuildSha256: release.runtimeBuildSha256, version: release.version,
      configurationSha256: queryProfile.configurationSha256, apiEnvSha256: queryProfile.apiEnvSha256 }),
    probeRuntime: async ({ queryProfile }) => ({ status: 'PASS', code: null, queryMode: queryProfile.mode,
      configurationSha256: queryProfile.configurationSha256, scope: 'candidate-intake-catalog-readonly-gates' }),
  });
  return producer.restoreDrill({ backupSet: f.root, pgBin: '/synthetic-pg15', candidateRelease: f.candidateRoot,
    rollbackRelease: f.previousRoot, candidateStackRoot: f.stackRoot, controllerRelease: f.controllerRoot,
    unit: f.options.unit, readServiceStartup: observe, ...(candidateApiEnv ? { candidateApiEnv } : {}) });
}

test('controller artifacts, source integrity and controller-only proof work through release entry points', async t => {
  const f = fixture(t);
  const { observe, properties } = startup(f);
  let evidence;
  await t.test('restore producer accepts an independent same-SHA controller and emits the controller-only public profile', async () => {
    evidence = await rehearse(f, observe);
    assert.equal(evidence.status, 'PASS');
    assert.deepEqual(Object.keys(evidence.deploymentChecks.candidateQueryProfile).sort(), ['configurationSha256', 'intakeLogins', 'mode']);
    assert.equal(evidence.deploymentChecks.candidateApiEnvSha256, digest(f.original));
    assert.equal(evidence.deploymentChecks.controller.controllerRoot, f.controllerRoot);
    assert.equal(evidence.deploymentChecks.controller.controllerGitSha, path.basename(f.candidateRoot));
    assert.deepEqual(JSON.parse(readFileSync(f.evidenceFile)).deploymentChecks, evidence.deploymentChecks);
  });
  assert.ok(evidence, 'producer must emit consumable release evidence');
  const proof = evidence.deploymentChecks;
  const controller = { root: f.controllerRoot, gitSha: path.basename(f.controllerRoot), runtimeBuildSha256: proof.controller.controllerBuildSha256 };
  await t.test('physical isolation accepts shared locked tooling and Git objects, and rejects shared source and dist', async () => {
    const candidate = { root: f.candidateRoot, gitSha: path.basename(f.candidateRoot) };
    assert.doesNotThrow(() => assertControllerArtifactIsolation(controller, candidate));
    for (const relative of ['scripts/synthetic-stack/stack.ts', 'scripts/synthetic-stack/profile.ts', 'apps/api/dist/index.js']) {
      const file = path.join(f.controllerRoot, relative);
      const bytes = readFileSync(file);
      for (const link of [linkSync, symlinkSync]) {
        rmSync(file);
        link(path.join(f.candidateRoot, relative), file);
        assert.throws(() => assertControllerArtifactIsolation(controller, candidate));
        rmSync(file);
        writeFileSync(file, bytes);
      }
    }
    assert.throws(() => assertControllerArtifactIsolation(candidate, candidate), { code: 'CONTROLLER_ARTIFACT_SHARED' });
    const alias = path.join(f.root, 'candidate-alias');
    symlinkSync(f.candidateRoot, alias, 'dir');
    assert.throws(() => assertControllerArtifactIsolation({ ...controller, root: alias }, candidate),
      { code: 'CONTROLLER_ARTIFACT_SHARED' });
    await assert.rejects(() => consumer.defaultDependencies({ ...f.options, controllerRelease: alias })
      .readServiceStartupDeclaration(proof.controller), { code: 'RELEASE_INVALID' });
  });
  await t.test('restore producer rejects the candidate artifact as controller', async () => {
    await assert.rejects(() => rehearse({ ...f, controllerRoot: f.candidateRoot }, observe),
      { code: 'CONTROLLER_ARTIFACT_SHARED' });
    writeFileSync(f.evidenceFile, JSON.stringify(evidence));
  });
  await t.test('normal recovery controller admission rejects assume-unchanged and skip-worktree source tampering', async () => {
    for (const relative of ['scripts/synthetic-stack/stack.ts', 'scripts/synthetic-stack/profile.ts', 'apps/desktop/src/shared/runtime-ports.ts']) {
      const file = path.join(f.controllerRoot, relative);
      const bytes = readFileSync(file);
      for (const flag of ['assume-unchanged', 'skip-worktree']) {
        git(f.controllerRoot, 'update-index', `--${flag}`, relative);
        writeFileSync(file, Buffer.concat([bytes, Buffer.from('\n// hidden synthetic mutation\n')]));
        assert.equal(git(f.controllerRoot, 'status', '--porcelain=v1', '--untracked-files=no'), '');
        const dependencies = consumer.defaultDependencies(f.options);
        await assert.rejects(() => dependencies.readServiceStartupDeclaration(proof.controller), { code: 'CANDIDATE_RELEASE_INVALID' });
        writeFileSync(file, bytes);
        git(f.controllerRoot, 'update-index', `--no-${flag}`, relative);
      }
    }
    assert.doesNotThrow(() => assertCandidateRuntimeUnchanged(controller));
  });
  await t.test('default consumer rejects a shared candidate controller before external release mutation', async () => {
    const options = { ...f.options, controllerRelease: f.candidateRoot };
    const defaults = consumer.defaultDependencies(options);
    await assert.rejects(() => consumer.runProductionRelease(options, { ...defaults,
      readNext: async () => ({ root: f.candidateRoot, sha: path.basename(f.candidateRoot), version: '0.3.43',
        manifest: (await defaults.readCurrent()).manifest.concat({ ...migration(2), contractSetId: 'synthetic-controller',
          sourceGitSha: 'c'.repeat(40), sourceSchemaSha256: 'd'.repeat(64) }), runtimeBuildSha256: proof.runtimeBuildSha256 }),
      readHistoricalRelease: async () => ({ ...(await defaults.readCurrent()), runtimeBuildSha256: proof.rollbackBuildSha256 }),
    }), { code: 'CONTROLLER_ARTIFACT_SHARED' });
    assert.equal(existsSync(f.options.stateFile), false);
  });
  await t.test('producer proof is consumed by normal apply and keeps exact version-only replacement verification', async () => {
    let count = 1;
    const defaults = consumer.defaultDependencies(f.options);
    for (const relative of ['scripts/synthetic-stack/profile.ts', 'apps/api/dist/index.js']) {
      const file = path.join(f.controllerRoot, relative);
      const bytes = readFileSync(file);
      rmSync(file);
      linkSync(path.join(f.candidateRoot, relative), file);
      await assert.rejects(() => defaults.readNext(), { code: 'CONTROLLER_ARTIFACT_SHARED' });
      rmSync(file);
      writeFileSync(file, bytes);
    }
    const next = await defaults.readNext();
    const dependencies = { ...defaults, readNext: async () => next, inspectTenancy: async () => f.tenant,
      inspectDatabase: async () => next.manifest.slice(0, count).map(row => row.id),
      inspectContentFingerprint: async () => 'f'.repeat(64),
      applyDatabase: async () => { count = next.manifest.length; return { verifierStatus: 'PASS',
        appliedIds: next.manifest.slice(1).map(row => row.id), finalIds: next.manifest.map(row => row.id) }; },
      verifyRollbackDatabase: async () => {}, restartService: async () => {}, waitForReady: async () => {},
    };
    const result = await consumer.runProductionRelease({ ...f.options, apply: true }, dependencies);
    assert.equal(result.status, 'applied');
    const installed = Buffer.from(f.original.toString('utf8').replace(/^CUSTOMER_AGENT_BUILD_VERSION=.*$/mu, 'CUSTOMER_AGENT_BUILD_VERSION=0.3.43'));
    assert.deepEqual(readFileSync(f.envFile), installed);
    assert.equal(realpathSync(path.join(f.root, 'current')), f.candidateRoot);
    const state = JSON.parse(readFileSync(f.options.stateFile));
    assert.equal(state.status, 'complete');
    await defaults.verifyInstalledApiEnv(state.apiEnvBackup, proof.candidateApiEnvSha256, next.version);
    writeFileSync(f.envFile, Buffer.concat([installed, Buffer.from('# changed private bytes\n')]));
    await assert.rejects(() => defaults.verifyInstalledApiEnv(state.apiEnvBackup, proof.candidateApiEnvSha256, next.version),
      { code: 'CANDIDATE_API_ENV_CHANGED' });
    writeFileSync(f.envFile, installed);
  });
  await t.test('journal recovery uses the bound independent controller and never rebuilds the damaged candidate', async () => {
    const state = JSON.parse(readFileSync(f.options.stateFile));
    writeFileSync(f.options.stateFile, JSON.stringify({ ...state, status: 'rolling_back' }));
    write(f.candidateRoot, 'apps/api/dist/index.js', 'damaged candidate artifact\n');
    rmSync(f.evidenceFile);
    Object.assign(properties, { MainPID: '0', ActiveState: 'failed' });
    const defaults = consumer.defaultDependencies(f.options);
    let rebuiltCandidate = false;
    const result = await consumer.runProductionRelease({ ...f.options, apply: true }, { ...defaults,
      readNext: async () => { rebuiltCandidate = true; return readCandidateRelease(f.candidateRoot, { verifyRuntime: true }); },
      inspectDatabase: async (_profile, next) => next.manifest.map(row => row.id), verifyRollbackDatabase: async () => {},
      restartService: async () => Object.assign(properties, { MainPID: '123', ActiveState: 'active' }), waitForReady: async () => {},
    });
    assert.equal(result.status, 'rolled-back');
    assert.equal(rebuiltCandidate, false);
    assert.deepEqual(readFileSync(f.envFile), f.original);
    assert.equal(realpathSync(path.join(f.root, 'current')), f.previousRoot);
  });
  await t.test('explicit candidate environment keeps its full profile binding through producer and consumer', async () => {
    write(f.candidateRoot, 'apps/api/dist/index.js', readFileSync(path.join(f.previousRoot, 'apps/api/dist/index.js')));
    const bytes = Buffer.from('CUSTOMER_AGENT_BUILD_VERSION=0.3.43\nCUSTOMER_AGENT_QUERY_MODE=intake-compat\nDB_POOL_MAX=11\n');
    const candidateApiEnv = path.join(f.root, 'candidate-api.env');
    writeFileSync(candidateApiEnv, bytes, { mode: 0o600 });
    const explicit = await rehearse(f, observe, candidateApiEnv);
    assert.equal(explicit.deploymentChecks.candidateQueryProfile.apiEnvSha256, digest(bytes));
    assert.equal(explicit.deploymentChecks.candidateApiEnvSha256, digest(bytes));
    const options = { ...f.options, candidateApiEnv };
    const defaults = consumer.defaultDependencies(options);
    const next = await defaults.readNext();
    const previous = await defaults.readHistoricalRelease(path.basename(f.previousRoot), '0.3.42');
    const dependencies = { ...defaults, readNext: async () => next, readHistoricalRelease: async () => previous,
      inspectTenancy: async () => f.tenant, inspectDatabase: async () => [next.manifest[0].id],
      inspectContentFingerprint: async () => 'f'.repeat(64), waitForReady: async () => {},
    };
    assert.equal((await consumer.runProductionRelease(options, dependencies)).status, 'dry-run');
    writeFileSync(candidateApiEnv, Buffer.concat([bytes, Buffer.from('# different full bytes\n')]));
    await assert.rejects(() => consumer.runProductionRelease(options, dependencies), { code: 'RELEASE_QUERY_PROFILE_CHANGED' });
  });
});
