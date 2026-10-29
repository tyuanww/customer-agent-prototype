import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectObservations,
  parseClientProfile,
  parseListeners,
  parseProfile,
  parseSystemctlShow,
  validateConsistency,
} from './production-consistency.mjs';

const script = fileURLToPath(new URL('./production-consistency.mjs', import.meta.url));
const SHA = 'a'.repeat(40);
const RELEASE = `/srv/customer-agent/releases/${SHA}`;
const STACK = '/srv/customer-agent/stack';
const API_ORIGIN = 'https://api.example.test';
const IDENTITY_ORIGIN = 'https://identity.example.test';
const UNIT = 'customer-agent-stack.service';

function readyProbe() {
  return {
    status: 200,
    json: {
      status: 'ready',
      checks: {
        database: 'ok',
        schema: 'ok',
        auth: 'ok',
        storage: 'ok',
        content: 'ok',
      },
    },
  };
}

function healthyIdentityProbe() {
  return { status: 200, json: { ok: true, kind: 'password' } };
}

function validObservation() {
  return {
    current: {
      isSymlink: true,
      releasePath: RELEASE,
      gitHead: SHA,
      gitClean: true,
    },
    profile: {
      stackRootPath: STACK,
      profileDirectoryPath: STACK,
      apiOrigin: 'http://127.0.0.1:43115',
      identityOrigin: 'http://127.0.0.1:43116',
      apiPort: 43115,
      identityPort: 43116,
      databaseName: 'customer_agent_formal',
    },
    units: [{
      loadState: 'loaded',
      activeState: 'active',
      subState: 'running',
      workingDirectoryPath: RELEASE,
      processCwdPath: RELEASE,
      stackRootPath: STACK,
    }, {
      loadState: 'loaded',
      activeState: 'active',
      subState: 'running',
      workingDirectoryPath: RELEASE,
      processCwdPath: RELEASE,
      stackRootPath: STACK,
    }],
    versions: {
      versionFile: '0.3.35',
      packageVersion: '0.3.35',
    },
    listeners: [{
      host: '127.0.0.1',
      port: 43115,
    }, {
      host: '127.0.0.1',
      port: 43116,
    }],
    client: {
      mode: 'product-remote',
      apiOrigin: API_ORIGIN,
      identityOrigin: IDENTITY_ORIGIN,
    },
    expected: {
      apiOrigin: API_ORIGIN,
      identityOrigin: IDENTITY_ORIGIN,
    },
    probes: {
      localApiHealth: {
        status: 200,
        json: { status: 'ok', service: 'cs-ai-api', version: '0.3.35' },
      },
      publicApiReady: readyProbe(),
      publicIdentityHealth: healthyIdentityProbe(),
    },
    profileConfigSha256: 'b'.repeat(64),
    clientConfigSha256: 'c'.repeat(64),
  };
}

test('the validator accepts the same configuration entry across multiple observed units', () => {
  const report = validateConsistency(validObservation());
  assert.equal(report.ok, true);
  assert.equal(report.checks.sameObservedConfigurationEntry, true);
  assert.equal(report.limits.productionUnitUniquenessProven, false);
  assert.equal(report.limits.databaseUniquenessProven, false);
  assert.deepEqual(report.versions, {
    file: '0.3.35',
    package: '0.3.35',
    apiHealth: '0.3.35',
  });
});

test('the report has no paths, origins, database names, or raw configuration', () => {
  const serialized = JSON.stringify(validateConsistency(validObservation()));
  assert.doesNotMatch(serialized, /customer-agent\/releases|customer-agent\/stack/u);
  assert.doesNotMatch(serialized, /example\.test|127\.0\.0\.1/u);
  assert.doesNotMatch(serialized, /customer_agent_formal/u);
  assert.doesNotMatch(serialized, /apiOrigin|identityOrigin|databaseName/u);
});

const mutations = [
  ['a non-symlink current path fails', (value) => { value.current.isSymlink = false; }, 'currentIsSymlink'],
  ['a dirty release fails', (value) => { value.current.gitClean = false; }, 'gitWorktreeClean'],
  ['an inactive unit fails', (value) => { value.units[0].activeState = 'inactive'; }, 'observedUnitsLoaded'],
  ['a stopped unit fails', (value) => { value.units[1].subState = 'exited'; }, 'observedUnitsRunning'],
  ['a systemd cwd mismatch fails', (value) => { value.units[0].workingDirectoryPath = '/srv/other'; }, 'systemdWorkingDirectoriesMatchCurrent'],
  ['a process cwd mismatch fails', (value) => { value.units[1].processCwdPath = '/srv/other'; }, 'processWorkingDirectoriesMatchCurrent'],
  ['a profile outside its file directory fails', (value) => { value.profile.stackRootPath = '/srv/other'; }, 'profileStackRootMatchesProfileFile'],
  ['different observed stack roots fail', (value) => { value.units[1].stackRootPath = '/srv/other'; }, 'observedUnitsUseSameStackRoot'],
  ['a wildcard listener fails', (value) => { value.listeners[0].host = '0.0.0.0'; }, 'apiListenerLoopbackOnly'],
  ['a missing identity listener fails', (value) => { value.listeners.pop(); }, 'identityListenerLoopbackOnly'],
  ['a current target basename mismatch fails', (value) => { value.current.releasePath = '/srv/release'; }, 'currentTargetNameMatchesGitHead'],
  ['an invalid database name fails', (value) => { value.profile.databaseName = 'not-a-database'; }, 'profileDatabaseNameValid'],
  ['a VERSION mismatch fails', (value) => { value.versions.packageVersion = '0.3.34'; }, 'versionFileMatchesPackage'],
  ['an API health version mismatch fails', (value) => { value.probes.localApiHealth.json.version = '0.3.34'; }, 'apiHealthVersionMatchesTree'],
  ['local API liveness failure fails', (value) => { value.probes.localApiHealth.status = 503; }, 'localApiHealthReady'],
  ['public API not-ready fails', (value) => { value.probes.publicApiReady.json.status = 'not_ready'; }, 'publicApiReady'],
  ['public identity failure fails', (value) => { value.probes.publicIdentityHealth.json.ok = false; }, 'publicIdentityHealthy'],
  ['a client API origin mismatch fails', (value) => { value.client.apiOrigin = 'https://other.example.test'; }, 'clientApiOriginMatchesExpected'],
  ['a client identity origin mismatch fails', (value) => { value.client.identityOrigin = 'https://other.example.test'; }, 'clientIdentityOriginMatchesExpected'],
];

for (const [name, mutate, check] of mutations) {
  test(name, () => {
    const observation = validObservation();
    mutate(observation);
    const report = validateConsistency(observation);
    assert.equal(report.ok, false);
    assert.equal(report.checks[check], false);
  });
}

test('profile parsing uses the fields written by the existing stack', () => {
  const profile = parseProfile({
    version: 1,
    createdAt: '2026-10-28T00:00:00.000Z',
    stackRoot: STACK,
    apiOrigin: 'http://127.0.0.1:43115',
    identityOrigin: 'http://127.0.0.1:43116',
    apiPort: 43115,
    identityPort: 43116,
    databaseName: 'customer_agent_formal',
    pgPort: 43199,
    pgSocketDirectory: `${STACK}/pg/socket`,
    objectStoreDirectory: `${STACK}/objects`,
    clientId: 'synthetic-client',
  });
  assert.deepEqual(profile, {
    stackRoot: STACK,
    apiOrigin: 'http://127.0.0.1:43115',
    identityOrigin: 'http://127.0.0.1:43116',
    apiPort: 43115,
    identityPort: 43116,
    databaseName: 'customer_agent_formal',
  });
});

test('profile parsing rejects remote or mismatched local origins', () => {
  const base = {
    version: 1,
    stackRoot: STACK,
    apiOrigin: 'http://127.0.0.1:43115',
    identityOrigin: 'http://127.0.0.1:43116',
    apiPort: 43115,
    identityPort: 43116,
    databaseName: 'customer_agent_formal',
  };
  for (const profile of [
    { ...base, apiOrigin: API_ORIGIN },
    { ...base, identityOrigin: base.apiOrigin },
    { ...base, apiPort: 43116 },
    { ...base, databaseName: 'not-a-database' },
  ]) {
    assert.throws(() => parseProfile(profile), /PROFILE_INVALID/u);
  }
});

test('client parsing accepts only distinct public HTTPS product-remote origins', () => {
  assert.deepEqual(parseClientProfile({
    mode: 'product-remote',
    apiOrigin: API_ORIGIN,
    identityOrigin: IDENTITY_ORIGIN,
  }), {
    mode: 'product-remote',
    apiOrigin: API_ORIGIN,
    identityOrigin: IDENTITY_ORIGIN,
  });

  for (const client of [
    { mode: 'synthetic-local', apiOrigin: API_ORIGIN, identityOrigin: IDENTITY_ORIGIN },
    { mode: 'product-remote', apiOrigin: 'http://api.example.test', identityOrigin: IDENTITY_ORIGIN },
    { mode: 'product-remote', apiOrigin: API_ORIGIN, identityOrigin: API_ORIGIN },
    { mode: 'product-remote', apiOrigin: `${API_ORIGIN}/path`, identityOrigin: IDENTITY_ORIGIN },
  ]) {
    assert.throws(() => parseClientProfile(client), /CLIENT_PROFILE_INVALID/u);
  }
});

test('systemd parsing extracts selected properties without retaining unrelated environment values', () => {
  const parsed = parseSystemctlShow([
    'LoadState=loaded',
    'ActiveState=active',
    'SubState=running',
    'MainPID=4242',
    `WorkingDirectory=${RELEASE}`,
    `Environment=CUSTOMER_AGENT_STACK_ROOT=${STACK} UNRELATED_SECRET=synthetic-placeholder`,
    '',
  ].join('\n'));
  assert.deepEqual(parsed, {
    loadState: 'loaded',
    activeState: 'active',
    subState: 'running',
    mainPid: 4242,
    workingDirectory: RELEASE,
    stackRoot: STACK,
  });
  assert.equal(Object.hasOwn(parsed, 'UNRELATED_SECRET'), false);
});

test('listener parsing recognizes wildcard exposure', () => {
  const listeners = parseListeners([
    'LISTEN 0 4096 127.0.0.1:43115 0.0.0.0:*',
    'LISTEN 0 4096 0.0.0.0:43116 0.0.0.0:*',
    '',
  ].join('\n'));
  assert.deepEqual(listeners, [
    { host: '127.0.0.1', port: 43115 },
    { host: '0.0.0.0', port: 43116 },
  ]);
});

test('collection reads real fixture state instead of trusting a self-reported profile', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'production-consistency-'));
  try {
    const releasePath = path.join(root, 'releases', SHA);
    const stackRoot = path.join(root, 'stack');
    const clientFile = path.join(root, 'synthetic-stack.json');
    const current = path.join(root, 'current');
    mkdirSync(path.join(releasePath, 'apps/desktop'), { recursive: true });
    mkdirSync(stackRoot);
    writeFileSync(path.join(releasePath, 'VERSION'), '0.3.35\n');
    writeFileSync(path.join(releasePath, 'apps/desktop/package.json'), JSON.stringify({ version: '0.3.35' }));
    writeFileSync(path.join(stackRoot, 'profile.json'), JSON.stringify({
      version: 1,
      stackRoot,
      apiOrigin: 'http://127.0.0.1:43115',
      identityOrigin: 'http://127.0.0.1:43116',
      apiPort: 43115,
      identityPort: 43116,
      databaseName: 'customer_agent_formal',
    }));
    writeFileSync(clientFile, JSON.stringify({
      mode: 'product-remote',
      apiOrigin: API_ORIGIN,
      identityOrigin: IDENTITY_ORIGIN,
    }));
    symlinkSync(releasePath, current);

    const observedCommands = [];
    const runCommand = (command, args) => {
      observedCommands.push([command, ...args]);
      if (command === 'git' && args.includes('rev-parse')) return SHA;
      if (command === 'git' && args.includes('status')) return '';
      if (command === 'systemctl') {
        return [
          'LoadState=loaded',
          'ActiveState=active',
          'SubState=running',
          'MainPID=4242',
          `WorkingDirectory=${current}`,
          `Environment=CUSTOMER_AGENT_STACK_ROOT=${stackRoot}`,
        ].join('\n');
      }
      if (command === 'ss') {
        return [
          'LISTEN 0 4096 127.0.0.1:43115 0.0.0.0:*',
          'LISTEN 0 4096 127.0.0.1:43116 0.0.0.0:*',
        ].join('\n');
      }
      throw new Error('unexpected synthetic command');
    };
    const fetchJson = async (url) => {
      if (url.endsWith('/ready')) return readyProbe();
      if (url.startsWith('http://127.0.0.1:43115/')) {
        return {
          status: 200,
          json: { status: 'ok', service: 'cs-ai-api', version: '0.3.35' },
        };
      }
      return healthyIdentityProbe();
    };

    const observation = await collectObservations({
      current,
      profile: path.join(stackRoot, 'profile.json'),
      units: [UNIT],
      clientProfile: clientFile,
      expected: { apiOrigin: API_ORIGIN, identityOrigin: IDENTITY_ORIGIN },
    }, {
      runCommand,
      fetchJson,
      readProcessCwd: () => realpathSync.native(releasePath),
    });
    const report = validateConsistency(observation);
    assert.equal(report.ok, true, JSON.stringify(report.checks));
    assert.equal(report.gitHead, SHA);
    assert.match(report.profileConfigSha256, /^[0-9a-f]{64}$/u);
    assert.match(report.clientConfigSha256, /^[0-9a-f]{64}$/u);
    assert.deepEqual(observedCommands.map(([command]) => command), ['git', 'git', 'systemctl', 'ss']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the CLI exposes usage and rejects incomplete collection arguments with a safe code', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /production-consistency\.mjs/u);
  assert.match(help.stdout, /does not change files, services, databases, or remote configuration/u);

  const invalid = spawnSync(process.execPath, [script, '--current', '/only-one-argument'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.deepEqual(JSON.parse(invalid.stdout), { ok: false, error: 'INVALID_ARGUMENTS' });
});

test('the implementation contains no production URL or secret fixture', () => {
  const implementation = readFileSync(script, 'utf8');
  assert.doesNotMatch(implementation, /jianghua\.site|https:\/\/[a-z0-9.-]+\.(?:com|cn|site)/iu);
  assert.doesNotMatch(implementation, /clientSecret|api[_-]?key|password\s*[:=]/iu);
});
