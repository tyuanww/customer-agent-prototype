import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createIdentityProvider } from './identity-provider.ts';
import { buildAccount, isAdmittedHost, loadPasswordAccounts } from './identity-admission.ts';
import { SYNTHETIC_CONTENT_CSV, SYNTHETIC_SCRIPT_IDS, scriptScope } from './content.ts';
import {
  DEFAULT_STACK_ROOT,
  DESKTOP_APP_NAME,
  defaultDesktopUserDataDirectory,
  desktopPackagedProfilePath,
  PID_DIRECTORY, PREFERRED_PORTS, STACK_ROOT, apiEnvironment, loadApiStackConfig, loadContentStackConfig,
  mergeStackOverrides, parseApiEnvFile, parseContentEnvFile, parseFeishuEnvFile,
  readProfile, shouldSeedSyntheticCatalog, stackPortOffset,
} from './profile.ts';
import {
  forgetProcess, isAlive, isOwnedProcessLive, pidIsAlive, portInUse, processCommandLine,
  processSignature, readProcess, recordProcess, stopProcess,
} from './process.ts';
import { catalogReferences, isCatalogReference } from '../../apps/desktop/src/shared/synthetic-catalog.ts';


describe('synthetic seed content', () => {
  it('declares a scope for every row that the catalog can label', () => {
    const header = SYNTHETIC_CONTENT_CSV.toString('utf8').split('\n')[0]!.split(',');
    const refIndex = header.indexOf('product_scope_refs');
    const typeIndex = header.indexOf('product_scope_type');
    assert.notEqual(refIndex, -1);
    assert.notEqual(typeIndex, -1);
    for (const scriptId of SYNTHETIC_SCRIPT_IDS) {
      const scope = scriptScope(scriptId);
      if (scope.type === 'storewide') {
        assert.equal(scope.refs.length, 0, `${scriptId} storewide must not carry refs`);
        continue;
      }
      assert.ok(scope.refs.length > 0, `${scriptId} ${scope.type} must carry refs`);
      for (const reference of scope.refs) {
        assert.ok(isCatalogReference(reference), `${scriptId} references an unknown catalog id: ${reference}`);
      }
    }
  });

  it('keeps every catalog reference contract-safe', () => {
    const references = catalogReferences();
    for (const reference of references) assert.match(reference, /^[A-Za-z0-9_-]{1,128}$/);
    assert.equal(new Set(references).size, references.length);
  });

  it('marks campaign rows with a bounded window', () => {
    const lines = SYNTHETIC_CONTENT_CSV.toString('utf8').trim().split('\n');
    const header = lines[0]!.split(',');
    const categoryIndex = header.indexOf('category');
    const toIndex = header.indexOf('effective_to');
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      if (cells[categoryIndex] !== 'campaign') continue;
      assert.notEqual(cells[toIndex], '', `campaign row ${cells[0]} needs effective_to`);
    }
  });
});

describe('stack profile', () => {
  it('builds loopback-only API environment with distinct login roles', () => {
    const profile = {
      version: 1, createdAt: new Date().toISOString(), stackRoot: '/tmp/stack',
      apiOrigin: 'http://127.0.0.1:43100', identityOrigin: 'http://127.0.0.1:43101',
      apiPort: 43100, identityPort: 43101, databaseName: 'db', pgPort: 43199,
      pgSocketDirectory: '/tmp/socket', objectStoreDirectory: '/tmp/objects', clientId: 'desk_x',
    } as const;
    const environment = apiEnvironment(profile);
    assert.equal(environment.CUSTOMER_AGENT_PROFILE, 'formal-dev');
    assert.equal(environment.CUSTOMER_AGENT_API_HOST, '127.0.0.1');
    assert.equal(environment.SYNTHETIC_IDENTITY_PROVIDER_ORIGIN, 'http://127.0.0.1:43101');
    const logins = ['DATABASE_URL', 'CONTENT_ADMIN_DATABASE_URL', 'AUTH_DATABASE_URL', 'CONTENT_REVIEW_DATABASE_URL', 'CONTENT_WORKER_DATABASE_URL']
      .map((key) => new URL(String(environment[key])).username);
    assert.equal(new Set(logins).size, logins.length, 'each pool must use its own login role');
    assert.ok(logins.every((login) => login.startsWith('stack_')));
    assert.notEqual(environment.IDEMPOTENCY_HMAC_KEYS, undefined);
    assert.notEqual(environment.LOG_HASH_KEY, undefined);
  });

  it('enables Feishu OAuth while keeping the loopback password origin', () => {
    const profile = {
      version: 1, createdAt: new Date().toISOString(), stackRoot: '/tmp/stack',
      apiOrigin: 'http://127.0.0.1:43100', identityOrigin: 'http://127.0.0.1:43101',
      apiPort: 43100, identityPort: 43101, databaseName: 'db', pgPort: 43199,
      pgSocketDirectory: '/tmp/socket', objectStoreDirectory: '/tmp/objects', clientId: 'desk_x',
    } as const;
    const feishu = parseFeishuEnvFile([
      'AUTH_MODE=feishu',
      'FEISHU_APP_ID=cli_aaaaaaaaaaaaaaaa',
      'FEISHU_APP_SECRET=test-feishu-secret-material-0001',
      'FEISHU_REDIRECT_URI=https://oauth.test.invalid/v1/auth/callback',
      'FEISHU_BINDINGS=ou_abcdef:agent',
    ].join('\n'));
    const environment = apiEnvironment(profile, {}, feishu);
    assert.equal(environment.AUTH_MODE, 'feishu');
    assert.equal(environment.SYNTHETIC_IDENTITY_PROVIDER_ORIGIN, 'http://127.0.0.1:43101');
    assert.equal(environment.FEISHU_APP_ID, 'cli_aaaaaaaaaaaaaaaa');
  });

  it('writes only loopback origins to the packaged desktop profile', () => {
    // The packaged file path is fixed by Electron's userData directory; assert
    // the location and the exact shape without disturbing a real installation.
    const packagedPath = desktopPackagedProfilePath();
    assert.match(path.basename(packagedPath), /^synthetic-stack\.json$/u);
    assert.ok(packagedPath.includes('客服话术浮窗 Demo'));
    if (process.platform === 'darwin') {
      assert.ok(packagedPath.includes('Library/Application Support'));
    } else if (process.platform === 'win32') {
      assert.ok(packagedPath.includes('AppData'));
    } else {
      assert.ok(packagedPath.includes('.config'));
    }
    const source = readFileSync(new URL('./profile.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export function writeDesktopPackagedProfile');
    assert.notEqual(start, -1);
    // Bound the slice at the next top-level declaration so unrelated helpers
    // (which legitimately build DSNs) are not mistaken for profile content.
    const rest = source.slice(start);
    const end = rest.indexOf('\nexport function apiEnvironment');
    const written = end === -1 ? rest : rest.slice(0, end);
    for (const key of ['mode', 'apiOrigin', 'identityOrigin']) assert.ok(written.includes(key), `packaged profile must carry ${key}`);
    for (const forbidden of ['access_token', 'DATABASE_URL', 'IDEMPOTENCY_HMAC', 'LOG_HASH_KEY']) {
      assert.equal(written.includes(forbidden), false, `packaged profile must not carry ${forbidden}`);
    }
    const stack = readFileSync(new URL('./stack.ts', import.meta.url), 'utf8');
    const desktop = stack.slice(stack.indexOf('function commandDesktop()'));
    assert.ok(desktop.includes('writeDesktopPackagedProfile(profile)'), 'desktop handoff must refresh the packaged profile');
    assert.ok(stack.includes("case 'packaged-profile': commandPackagedProfile()"), 'packaged-profile must print the userData file path');
    assert.ok(stack.includes('<start|stop|restart|status|destroy|desktop|packaged-profile|anomaly>'));
    assert.ok(written.includes('desktopPackagedProfilePath()'), 'packaged profile path must be resolved at write time');
  });

  it('follows Electron Linux userData, including XDG_CONFIG_HOME', () => {
    const linuxHome = '/home/operator';
    assert.equal(
      defaultDesktopUserDataDirectory({ platform: 'linux', home: linuxHome, env: {} }),
      path.join(linuxHome, '.config', DESKTOP_APP_NAME),
    );
    assert.equal(
      desktopPackagedProfilePath({
        platform: 'linux',
        home: linuxHome,
        env: { XDG_CONFIG_HOME: '/var/xdg' },
      }),
      path.join('/var/xdg', DESKTOP_APP_NAME, 'synthetic-stack.json'),
    );
    assert.equal(
      desktopPackagedProfilePath({
        platform: 'linux',
        home: linuxHome,
        env: {
          XDG_CONFIG_HOME: '/var/xdg',
          CUSTOMER_AGENT_DESKTOP_USERDATA: '/tmp/explicit-userdata',
        },
      }),
      path.join('/tmp/explicit-userdata', 'synthetic-stack.json'),
    );
  });

  it('rejects a profile file that is not the current version or root', () => {
    const file = new URL('./profile.ts', import.meta.url);
    // PROFILE_FILE resolves once at import time, so assert the parser contract
    // directly: an unknown version or a foreign stack root must not be adopted.
    const source = readFileSync(file, 'utf8');
    assert.ok(source.includes('profile.version !== 1'), 'profile reader must reject other versions');
    assert.ok(source.includes('profile.stackRoot !== STACK_ROOT'), 'profile reader must reject a foreign root');
    assert.equal(readProfile()?.version === 1 || readProfile() === undefined, true);
  });
});

describe('process ownership', () => {
  it('records and re-reads the current process signature', () => {
    const name = `probe-${String(process.pid)}`;
    const record = recordProcess(name, process.pid, 'node --test');
    try {
      assert.equal(record.pid, process.pid);
      assert.equal(isOwnedProcessLive(record), true);
      assert.deepEqual(readProcess(name)?.signature, processSignature(process.pid));
    } finally {
      forgetProcess(name);
    }
    assert.equal(readProcess(name), undefined);
  });

  it('refuses to signal a stale record instead of killing an unrelated pid', async () => {
    // PID_DIRECTORY is resolved at import time, so this exercises the real
    // directory with a name no other test or run uses.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(PID_DIRECTORY, { recursive: true, mode: 0o700 });
    const name = `ghost-${String(process.pid)}`;
    // pid 1 exists but its signature will never match a forged record, so the
    // stop path must drop the record and leave the process alone.
    const forged = { name, pid: 1, signature: 'not-a-real-signature', startedAt: '', command: '' };
    writeFileSync(path.join(PID_DIRECTORY, `${name}.json`), JSON.stringify(forged));
    assert.equal(isAlive(1), true);
    const result = await stopProcess(name);
    assert.match(result, /no longer matches/);
    assert.equal(readProcess(name), undefined);
    assert.equal(isAlive(1), true, 'an unrelated process must not be signalled');
  });

  it('reports a free and a busy loopback port', async () => {
    const { createServer } = await import('node:net');
    const free = createServer();
    await new Promise<void>((resolve) => { free.listen(0, '127.0.0.1', resolve); });
    const freeAddress = free.address();
    assert.ok(freeAddress !== null && typeof freeAddress === 'object');
    const freePort = freeAddress.port;
    await new Promise<void>((resolve) => { free.close(() => resolve()); });
    assert.equal(await portInUse(freePort), false);

    const busy = createServer();
    await new Promise<void>((resolve) => { busy.listen(0, '127.0.0.1', resolve); });
    const busyAddress = busy.address();
    assert.ok(busyAddress !== null && typeof busyAddress === 'object');
    assert.equal(await portInUse(busyAddress.port), true);
    await new Promise<void>((resolve) => { busy.close(() => resolve()); });
  });

  it('rejects an unsafe process name', () => {
    assert.throws(() => recordProcess('../escape', process.pid, 'x'), /Unsafe process name/);
  });

  it('keeps the marker file out of the seed path', () => {
    // Guard against accidentally writing stack state into the repository.
    assert.equal(existsSync(path.join(process.cwd(), 'profile.json')), false);
  });
});

describe('anomaly checks', () => {
  it('refuses to put non-Latin-1 text into an Authorization header', async () => {
    const { requireHeaderByteString } = await import('./header-bytes.ts');
    assert.doesNotThrow(() => requireHeaderByteString('token', 'a'.repeat(43)));
    assert.throws(() => requireHeaderByteString('token', '什么时候发货'), /U\+4ec0/);
  });

  it('keeps rollback staleness on the desktop adapter, not raw adoption HTTP', () => {
    const check = readFileSync(new URL('./anomaly-check.ts', import.meta.url), 'utf8');
    const adapter = readFileSync(new URL('../../apps/desktop/tests/unit/stack-desktop-adapter.ts', import.meta.url), 'utf8');
    const rollback = readFileSync(new URL('../../apps/desktop/tests/unit/stack-anomaly-rollback.test.ts', import.meta.url), 'utf8');
    assert.match(adapter, /ProductSearch/);
    assert.match(adapter, /ProductAnnounce/);
    assert.match(check, /stack-anomaly-rollback\.test\.ts/);
    assert.match(rollback, /code: 'STALE'/);
    assert.match(rollback, /CUSTOMER_AGENT_STACK_ANOMALY/);
    assert.equal(rollback.includes("fetch(`${profile.apiOrigin}/v1/events/adoption`"), false);
    assert.equal(check.includes("search(await loginAs"), false);
  });

  it('reads the source-suspend id from argv[4]', () => {
    const source = readFileSync(new URL('./stack.ts', import.meta.url), 'utf8');
    assert.match(source, /sourceVersionId = process\.argv\[4\]/);
    assert.match(source, /case 'anomaly': await commandAnomaly\(process\.argv\[3\]\)/);
  });
});

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => { if (error) reject(error); else resolve(port); });
    });
    server.on('error', reject);
  });
}

describe('synthetic identity password', () => {
  it('grants a seeded binding and rejects unknown credentials without enumerating', async () => {
    const port = await freeLoopbackPort();
    // The provider no longer has a built-in password; it reads the account file. Pass
    // it explicitly: the module-level default is fixed at import time, so an
    // environment variable set inside a test would have no effect.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'identity-accounts-'));
    const password = 'probe-password-not-a-default';
    const accountsFile = path.join(dir, 'password-accounts.json');
    writeFileSync(accountsFile, JSON.stringify([
      buildAccount('synthetic_agent', 'synthetic_agent', password),
      buildAccount('synthetic_owner', 'synthetic_owner', password),
    ]));
    try {
      const provider = createIdentityProvider({ port, accountsFile });
      const origin = await provider.listen();
      try {
        const ok = await fetch(`${origin}/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'synthetic_agent', password }),
        });
        assert.equal(ok.status, 200);
        assert.deepEqual(await ok.json(), { code: 'synthetic_agent' });
        const ownerResponse = await fetch(`${origin}/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'synthetic_owner', password }),
        });
        assert.equal(ownerResponse.status, 200);
        assert.deepEqual(await ownerResponse.json(), { code: 'synthetic_owner' });
        const bad = await fetch(`${origin}/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'synthetic_agent', password: 'wrong' }),
        });
        assert.equal(bad.status, 401);
        assert.deepEqual(await bad.json(), { error: 'invalid_credentials' });
        const unknown = await fetch(`${origin}/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'not_a_subject', password }),
        });
        assert.equal(unknown.status, 401);
        assert.deepEqual(await unknown.json(), { error: 'invalid_credentials' });
      } finally {
        await provider.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no longer accepts the historical hardcoded password', async () => {
    const port = await freeLoopbackPort();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'identity-accounts-'));
    const accountsFile = path.join(dir, 'password-accounts.json');
    writeFileSync(accountsFile, JSON.stringify([
      buildAccount('synthetic_owner', 'synthetic_owner', 'a-random-one-off-password'),
    ]));
    try {
      const provider = createIdentityProvider({ port, accountsFile });
      const origin = await provider.listen();
      try {
        // This is the string the previous version shipped as a default for every
        // subject, including owner. It must now be rejected.
        const response = await fetch(`${origin}/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'synthetic_owner', password: 'synthetic-password' }),
        });
        assert.equal(response.status, 401);
      } finally {
        await provider.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to start when the account file is absent, instead of seeding a default', async () => {
    const port = await freeLoopbackPort();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'identity-accounts-'));
    try {
      assert.throws(
        () => createIdentityProvider({ port, accountsFile: path.join(dir, 'absent.json') }),
        /identity accounts file is missing/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('identity admission', () => {
  it('admits loopback Host headers and rejects a public one', () => {
    for (const host of ['127.0.0.1', '127.0.0.1:43101', 'localhost:43101', '[::1]:43101']) {
      assert.equal(isAdmittedHost(host), true, `${host} should be admitted`);
    }
    // The tunnel forwards the public hostname; this is the request the old
    // remoteAddress-only check let straight through.
    assert.equal(isAdmittedHost('agent-pass.jianghua.site'), false);
    assert.equal(isAdmittedHost('agent-pass.jianghua.site:443'), false);
    assert.equal(isAdmittedHost(undefined), false);
    assert.equal(isAdmittedHost(''), false);
  });

  it('permits an extra hostname only when explicitly configured', () => {
    const environment = { CUSTOMER_AGENT_IDENTITY_ALLOWED_HOSTS: 'probe.example.test' };
    assert.equal(isAdmittedHost('probe.example.test', environment), true);
    assert.equal(isAdmittedHost('probe.example.test:443', environment), true);
    assert.equal(isAdmittedHost('agent-pass.jianghua.site', environment), false);
  });

  it('refuses to load accounts from a missing file instead of seeding a default', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'identity-accounts-'));
    try {
      assert.throws(
        () => loadPasswordAccounts(path.join(dir, 'absent.json')),
        /identity accounts file is missing/,
      );
      const empty = path.join(dir, 'empty.json');
      writeFileSync(empty, '[]');
      assert.throws(() => loadPasswordAccounts(empty), /contains no usable account/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('stack content env', () => {
  it('reads a real deployment database name and content constants', () => {
    const config = parseContentEnvFile([
      'DATABASE_NAME=customer_agent_formal',
      'CONTENT_INTENT_TAXONOMY_VERSION=itax_prod_v1',
      'CONTENT_INTENT_ID=intent_prod_shipping',
      'CONTENT_REVIEW_EVIDENCE_ID=EVD-PROD-001',
    ].join('\n'));
    assert.equal(config.databaseName, 'customer_agent_formal');
    assert.equal(config.intentTaxonomyVersion, 'itax_prod_v1');
    assert.equal(config.intentId, 'intent_prod_shipping');
    assert.equal(config.reviewEvidenceId, 'EVD-PROD-001');
  });

  it('treats an absent file as "use the synthetic defaults"', () => {
    assert.equal(loadContentStackConfig(path.join(tmpdir(), 'no-such-stack-content.env')), undefined);
  });

  it('fails closed on a present but invalid file rather than falling back', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stack-content-env-'));
    const file = path.join(directory, 'content.env');
    writeFileSync(file, 'DATABASE_NAME=customer_agent_formal\nCONTENT_INTENT_TAXONOMY_VERSION=\n');
    // A quiet fallback would leave the stack filing reviews under `synthetic_coach`.
    assert.throws(
      () => loadContentStackConfig(file),
      /content\.env: CONTENT_INTENT_TAXONOMY_VERSION must not be empty/u,
    );
  });

  it('rejects a misspelled key instead of ignoring it', () => {
    assert.throws(
      () => parseContentEnvFile('DATABASE_NAM=customer_agent_formal'),
      /content\.env: unknown key DATABASE_NAM/u,
    );
  });

  it('rejects duplicate keys and a non-identifier database name', () => {
    assert.throws(
      () => parseContentEnvFile('CONTENT_INTENT_ID=a\nCONTENT_INTENT_ID=b'),
      /content\.env: duplicate CONTENT_INTENT_ID/u,
    );
    assert.throws(
      () => parseContentEnvFile('DATABASE_NAME=Customer-Agent'),
      /content\.env: DATABASE_NAME must be a lower-case SQL identifier/u,
    );
  });

  it('keeps two stacks off each other\'s ports, not merely on different offsets', () => {
    // The same offset is added to every preferred port and those ports are one
    // apart, so an offset that is not a multiple of the span interleaves two
    // stacks. Offsets 75 and 76 - which `/tmp/stack-0` and `/tmp/stack-1` used to
    // produce - put one stack's `identity` port and the next stack's `api` port
    // on 43176. The old test only asserted that the offset was stable and in
    // range, which is exactly what made it pass while the collision was real.
    assert.equal(stackPortOffset(DEFAULT_STACK_ROOT), 0, 'the default root keeps the ports it has always used');
    // A root has to resolve to the same ports before profile.json exists and
    // after it is deleted, so the offset cannot be random.
    assert.equal(stackPortOffset('/tmp/second-stack'), stackPortOffset('/tmp/second-stack'));

    const span = Math.max(...Object.values(PREFERRED_PORTS)) - Math.min(...Object.values(PREFERRED_PORTS)) + 1;
    const offsets = new Set<number>();
    for (let i = 0; i < 400; i++) offsets.add(stackPortOffset(`/tmp/stack-${String(i)}`));
    assert.ok(offsets.size > 10, `expected several distinct offsets, got ${String(offsets.size)}`);
    for (const offset of offsets) {
      assert.equal(offset % span, 0, `offset ${String(offset)} must be a multiple of the ${String(span)}-port span`);
    }
    const claimed = new Map<number, number>();
    for (const offset of offsets) {
      for (const port of Object.values(PREFERRED_PORTS)) {
        const previous = claimed.get(port + offset);
        assert.equal(
          previous,
          undefined,
          `port ${String(port + offset)} is claimed by both offset ${String(previous)} and offset ${String(offset)}`,
        );
        claimed.set(port + offset, offset);
      }
    }
  });
});

describe('stack production env', () => {
  it('reads the portable secrets a production stack cannot invent', () => {
    const config = parseApiEnvFile([
      'CUSTOMER_AGENT_PROFILE=production',
      'CUSTOMER_AGENT_BUILD_VERSION=0.3.25',
      'IDEMPOTENCY_HMAC_KEYS={"hmac-idempotency-v1":"material"}',
      'LOG_HASH_KEY=material',
    ].join('\n'));
    assert.equal(config.CUSTOMER_AGENT_PROFILE, 'production');
    assert.equal(config.CUSTOMER_AGENT_BUILD_VERSION, '0.3.25');
    assert.equal(config.LOG_HASH_KEY, 'material');
  });

  it('treats an absent file as "run with the synthetic secrets"', () => {
    assert.equal(loadApiStackConfig(path.join(tmpdir(), 'no-such-api.env')), undefined);
  });

  it('refuses every value the stack root can derive instead of merging it', () => {
    // Carrying another machine's api.env over is the deploy step most likely to
    // happen, and the damage is uneven: a wrong socket directory fails loudly,
    // but a stale object store directory keeps accepting uploads somewhere
    // nobody looks. Each of these must be a start-time error naming the key.
    const derived = [
      'PATH=/usr/bin',
      'CUSTOMER_AGENT_API_HOST=127.0.0.1',
      'CUSTOMER_AGENT_API_PORT=43110',
      'DATABASE_URL=postgresql://stack_runtime@localhost/db',
      'CONTENT_ADMIN_DATABASE_URL=postgresql://stack_content_admin@localhost/db',
      'AUTH_DATABASE_URL=postgresql://stack_backend_auth@localhost/db',
      'CONTENT_REVIEW_DATABASE_URL=postgresql://stack_backend_review@localhost/db',
      'CONTENT_WORKER_DATABASE_URL=postgresql://stack_backend_worker@localhost/db',
      'SYNTHETIC_IDENTITY_PROVIDER_ORIGIN=http://127.0.0.1:43101',
      'CONTENT_OBJECT_STORE_DIR=/Users/someone/.customer-agent-formal/objects',
      'AUTH_MODE=feishu',
      'FEISHU_APP_ID=cli_aaaaaaaa',
      'FEISHU_APP_SECRET=secret-material',
      'FEISHU_REDIRECT_URI=https://agent-auth.jianghua.site/v1/auth/callback',
      'FEISHU_BINDINGS=ou_aaaaaa:owner',
      'NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem',
    ];
    for (const line of derived) {
      const key = line.slice(0, line.indexOf('='));
      assert.throws(
        () => parseApiEnvFile(line),
        new RegExp(`api\\.env: ${key} is derived from the stack root`, 'u'),
        `${key} must be refused`,
      );
    }
  });

  it('fails closed on an empty value and a malformed profile name', () => {
    assert.throws(() => parseApiEnvFile('LOG_HASH_KEY='), /api\.env: LOG_HASH_KEY must not be empty/u);
    assert.throws(
      () => parseApiEnvFile('CUSTOMER_AGENT_PROFILE=Production'),
      /api\.env: CUSTOMER_AGENT_PROFILE must be a lower-case profile name/u,
    );
    assert.throws(
      () => parseApiEnvFile('LOG_HASH_KEY=a\nLOG_HASH_KEY=b'),
      /api\.env: duplicate LOG_HASH_KEY/u,
    );
  });

  it('lets a portable key replace the synthetic constant', () => {
    // The synthetic defaults are non-secret local material. A production stack
    // that silently kept them would write idempotency and log-hash rows under
    // keys the migrated data was not hashed with.
    const profile = {
      version: 1 as const, createdAt: '2026-09-29T00:00:00.000Z', stackRoot: DEFAULT_STACK_ROOT,
      apiOrigin: 'http://127.0.0.1:43100', identityOrigin: 'http://127.0.0.1:43101',
      apiPort: 43100, identityPort: 43101, databaseName: 'customer_agent_formal', pgPort: 43199,
      pgSocketDirectory: '/tmp/socket', objectStoreDirectory: '/tmp/objects', clientId: 'desk_x',
    };
    const environment = apiEnvironment(profile, parseApiEnvFile('LOG_HASH_KEY=real-material'));
    assert.equal(environment.LOG_HASH_KEY, 'real-material');
    // The DSN still comes from the profile, never from the file.
    assert.match(String(environment.DATABASE_URL), /host=%2Ftmp%2Fsocket&port=43199/u);
  });

  it('refuses a key set in both api.env and content.env', () => {
    // Merge order alone would decide it, and the losing value would look applied.
    assert.throws(
      () => mergeStackOverrides({ CONTENT_INTENT_ID: 'a' }, { CONTENT_INTENT_ID: 'b' }),
      /api\.env and content\.env both set CONTENT_INTENT_ID/u,
    );
    const merged = mergeStackOverrides({ CONTENT_INTENT_ID: 'a' }, { LOG_HASH_KEY: 'b' });
    assert.deepEqual(merged, { CONTENT_INTENT_ID: 'a', LOG_HASH_KEY: 'b' });
  });
});

describe('stack profile reuse', () => {
  const freshFile = (): string => path.join(mkdtempSync(path.join(tmpdir(), 'stack-profile-')), 'profile.json');
  const wellFormed = {
    version: 1 as const,
    createdAt: '2026-09-30T00:00:00.000Z',
    stackRoot: STACK_ROOT,
    apiOrigin: 'http://127.0.0.1:43100',
    identityOrigin: 'http://127.0.0.1:43101',
    apiPort: 43100,
    identityPort: 43101,
    databaseName: 'customer_agent_formal',
    pgPort: 43199,
    pgSocketDirectory: '/tmp/socket',
    objectStoreDirectory: '/tmp/objects',
    clientId: 'desk_x',
  };

  it('adopts a profile it can use', () => {
    const file = freshFile();
    writeFileSync(file, JSON.stringify(wellFormed));
    assert.equal(readProfile(file)?.databaseName, 'customer_agent_formal');
  });

  it('refuses a profile whose database name would reach CREATE DATABASE', () => {
    // Only the first `start` builds a profile; every one after it reuses this
    // file. The name is interpolated into `CREATE DATABASE` and concatenated
    // into five DSNs, and the same name IS validated when it comes from
    // content.env - so leaving this path unchecked put the guard on the
    // one-time entrance instead of the one that runs every day.
    for (const databaseName of [undefined, '', 'Customer-Agent', 'x; DROP DATABASE y', 42]) {
      const profile: Record<string, unknown> = { ...wellFormed };
      if (databaseName === undefined) delete profile.databaseName;
      else profile.databaseName = databaseName;
      const file = freshFile();
      writeFileSync(file, JSON.stringify(profile));
      assert.equal(readProfile(file), undefined, `must refuse databaseName ${JSON.stringify(databaseName)}`);
    }
  });
});

describe('stack seed policy', () => {
  it('never seeds a stack that declares its own database', () => {
    // `--no-seed` describes the stack, not the invocation. The systemd unit
    // passes it, but a person repairing the stack types `restart` - and the
    // import publishes the demo catalog as the live one when the database has
    // nothing published yet.
    assert.equal(shouldSeedSyntheticCatalog([], undefined), true, 'a plain synthetic stack still seeds');
    assert.equal(shouldSeedSyntheticCatalog(['start', '--no-seed'], undefined), false);
    assert.equal(shouldSeedSyntheticCatalog(['start'], 'customer_agent_formal'), false);
    assert.equal(shouldSeedSyntheticCatalog(['restart'], 'customer_agent_formal'), false);
  });
});

describe('stack database wiring', () => {
  it('never falls back to the module constant for the database name', () => {
    // connect() used to default to DATABASE_NAME, so a stack whose content.env
    // set DATABASE_NAME created one database and then connected to another.
    // Rehearsing on the Mac could not see it: there the two names are equal, and
    // only a real override exposes it. Nothing in scripts/ is typechecked, so a
    // missing argument would not have been caught either.
    const postgres = readFileSync(new URL('./postgres.ts', import.meta.url), 'utf8');
    assert.equal(/connect\(database = DATABASE_NAME/u.test(postgres), false, 'connect must not default to the constant');
    assert.equal(
      /export async function ensureDatabase\(cluster: SyntheticCluster, database = /u.test(postgres),
      false,
      'ensureDatabase must not default to the constant',
    );

    const stack = readFileSync(new URL('./stack.ts', import.meta.url), 'utf8');
    assert.equal(/cluster\.connect\(\)/u.test(stack), false, 'every connection must name its database');
    assert.ok(
      stack.includes('ensureLoginRoles(cluster, profile.databaseName)'),
      'the role bootstrap must use the resolved name too',
    );
  });
});

describe('stack production wiring', () => {
  it('applies api.env, because stack.ts is the production entry point', () => {
    // R2 made stack.ts the production entry and retired formal-dev-up.mjs, which
    // was the only reader of api.env. Without this the stack can only ever come
    // up on AUTH_MODE=mock with the synthetic HMAC material - which looks like a
    // working stack and hashes production rows under keys nothing else shares.
    const stack = readFileSync(new URL('./stack.ts', import.meta.url), 'utf8');
    assert.ok(stack.includes('loadApiStackConfig()'), 'start must read api.env');
    assert.ok(
      stack.includes('mergeStackOverrides(contentOverrides(content, feishu), apiConfig ?? {})'),
      'both override files must be merged through the clash check',
    );
    // content.env is read once and threaded through: two reads could disagree if
    // the file changed between them, leaving the profile naming one catalog and
    // the overrides coming from another.
    assert.equal(
      (stack.match(/loadContentStackConfig\(\)/gu) ?? []).length,
      1,
      'content.env must be read exactly once per run',
    );
    assert.ok(
      stack.includes('shouldSeedSyntheticCatalog(process.argv, content?.databaseName)'),
      'the seed decision must come from the stack, not only from the flag',
    );
  });
});

describe('stack start modes', () => {
  it('can start without importing the synthetic catalog', () => {
    // Serving a real catalog must not import the demo CSV: on a freshly prepared
    // database the "already published" probe finds nothing, so the seed would
    // publish synthetic scripts as the live catalog. stack.ts runs main() at
    // import time, so this asserts on its source rather than calling it.
    const stack = readFileSync(new URL('./stack.ts', import.meta.url), 'utf8');
    assert.ok(stack.includes('--no-seed'), 'start must accept --no-seed');
    assert.ok(stack.includes('seed: skipped'), 'the skip must be visible in the start log');
    assert.ok(
      stack.includes('search self-check skipped'),
      'the search self-check asserts the seeded catalog, so it has to be skipped too',
    );
  });
});

describe('process identity survives a clock correction', () => {
  // Reproduces the failure measured on the deploy host: lstart is recomputed on
  // every call, so once NTP steps the clock the recorded signature never matches
  // again (43 minutes apart there). stop then removed the pid file WITHOUT
  // signalling, leaving the old process running and making the next start trip the
  // port guard. The command line does not drift, so it is the fallback identity.
  it('treats a record as live when the signature drifted but the command line matches', () => {
    const name = `drift-${String(process.pid)}`;
    const live = processCommandLine(process.pid);
    assert.ok(live !== undefined, 'the test process must have a readable command line');
    const record = Object.freeze({
      name,
      pid: process.pid,
      // A signature that can never match, standing in for the post-clock-step value.
      signature: 'Tue Sep 29 23:48:15 2026   99999',
      startedAt: '',
      command: live,
    });
    assert.equal(isOwnedProcessLive(record), true);
    assert.equal(pidIsAlive(record), true);
  });

  it('still refuses a record whose pid belongs to a different command', () => {
    // pid 1 exists but never runs our command, so this must stay false. This is the
    // property the signature check existed for: a reused pid must not be ours.
    const record = Object.freeze({
      name: 'foreign',
      pid: 1,
      signature: 'Tue Sep 29 23:48:15 2026   1',
      startedAt: '',
      command: '/usr/bin/definitely-not-this-process --x',
    });
    assert.equal(isAlive(1), true);
    assert.equal(pidIsAlive(record), false);
  });

  it('does not claim ownership when the record carries no command line', () => {
    // An older record without a usable command must not be adopted by the fallback:
    // with no way to verify, the conservative answer is "not ours".
    const record = Object.freeze({
      name: 'no-command', pid: 1, signature: 'never-matches', startedAt: '', command: '',
    });
    assert.equal(pidIsAlive(record), false);
  });
});
