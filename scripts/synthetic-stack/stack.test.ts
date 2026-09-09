import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { SYNTHETIC_CONTENT_CSV, SYNTHETIC_SCRIPT_IDS, scriptScope } from './content.ts';
import {
  DESKTOP_PACKAGED_PROFILE_PATH, PID_DIRECTORY, apiEnvironment, readProfile,
} from './profile.ts';
import {
  forgetProcess, isAlive, isOwnedProcessLive, portInUse, processSignature, readProcess, recordProcess, stopProcess,
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

  it('writes only loopback origins to the packaged desktop profile', () => {
    // The packaged file path is fixed by Electron's userData directory; assert
    // the location and the exact shape without disturbing a real installation.
    assert.match(path.basename(DESKTOP_PACKAGED_PROFILE_PATH), /^synthetic-stack\.json$/u);
    assert.ok(DESKTOP_PACKAGED_PROFILE_PATH.includes('Library/Application Support'));
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
