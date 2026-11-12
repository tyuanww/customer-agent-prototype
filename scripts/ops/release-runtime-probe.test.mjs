import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { probeCandidateRuntime } from './release-runtime-probe.mjs';

const DATABASE = { host: '127.0.0.1', port: 54329, database: 'restored_candidate' };
const SCOPE = 'candidate-query-runtime-readonly-initialization';
const MODULES = {
  'content-intake/runtime-pool.js': `
    import { config, event, failAt } from '../fixture.js';
    export function createIntakePurposePool(connection, purpose, report) {
      event('pool.create', { connection, purpose });
      failAt('pool.' + purpose);
      const pool = {
        purpose,
        async connect() {
          if (!config.intakeProbe) throw new Error('UNEXPECTED_DIRECT_CONNECT');
          event('pool.connect', { purpose });
          return { release() { event('pool.release', { purpose }); } };
        },
        async end() {
          event('pool.end', { purpose });
          await Promise.resolve();
          failAt('end.' + purpose);
          if (config.idleFailure === purpose) report(new Error('IDLE_CONNECTION_FAILED'));
        },
      };
      if (config.missingPoolMethod) delete pool[config.missingPoolMethod];
      return pool;
    }
  `,
  'integration/access.js': `
    import { config, event, failAt } from '../fixture.js';
    export function createPostgresAccessEvaluator(pool) {
      event('access.create', { purpose: pool.purpose });
      failAt('access');
      const access = {
        pool,
        async evaluate() { throw new Error('UNEXPECTED_ACTOR_EVALUATION'); },
      };
      if (config.invalidAccess) delete access.evaluate;
      return access;
    }
  `,
  'integration/intake-readiness.js': `
    import { config, event, failAt } from '../fixture.js';
    export async function inspectCurrentIntakeRelease(pool) {
      event('intake.inspect', { purpose: pool.purpose });
      failAt('intake');
      return config.invalidIntake ? null : { releaseId: 'release-synthetic', validUntil: Date.now() + 60000 };
    }
  `,
  'integration/release.js': `
    import { config, event, failAt } from '../fixture.js';
    export function createPostgresQueryReleaseLoader(pool) {
      event('release.create', { purpose: pool.purpose });
      failAt('release');
      if (config.invalidLoader) return {};
      const loader = async () => {
        event('release.load');
        failAt('load');
      };
      loader.pool = pool;
      return loader;
    }
  `,
  'integration/query-runtime.js': `
    import { config, event, failAt } from '../fixture.js';
    export function createApiQueryRuntime(options) {
      event('runtime.create', {
        accessPurpose: options.access.pool.purpose,
        loaderPurpose: options.loader.pool.purpose,
        distinctPools: options.access.pool !== options.loader.pool,
      });
      failAt('runtime');
      if (typeof options.observer.record !== 'function'
        || typeof options.onActivationFailure !== 'function') {
        throw new Error('RUNTIME_CALLBACKS_MISSING');
      }
      const runtime = {
        async initialize() {
          event('runtime.initialize');
          failAt('initialize');
          try {
            await options.loader();
          } catch (error) {
            options.onActivationFailure(error);
            return false;
          }
          if (config.undefinedInitialize) return undefined;
          return Object.hasOwn(config, 'initializeReturn') ? config.initializeReturn : true;
        },
        readiness() {
          event('runtime.readiness');
          failAt('readiness');
          if (config.undefinedReadiness) return undefined;
          return Object.hasOwn(config, 'readinessReturn') ? config.readinessReturn : 'ok';
        },
        async close() {
          event('runtime.close');
          await Promise.resolve();
          failAt('close');
        },
        async search() { throw new Error('UNEXPECTED_BUSINESS_QUERY'); },
      };
      if (config.missingRuntimeMethod) delete runtime[config.missingRuntimeMethod];
      return runtime;
    }
  `,
};

async function fixture(t, config = {}) {
  const releaseRoot = await mkdtemp(path.join(tmpdir(), 'release-probe # '));
  t.after(() => rm(releaseRoot, { recursive: true, force: true }));
  const dist = path.join(releaseRoot, 'apps/api/dist');
  await mkdir(path.join(dist, 'content-intake'), { recursive: true });
  await mkdir(path.join(dist, 'integration'), { recursive: true });
  await writeFile(path.join(releaseRoot, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(dist, 'config.json'), JSON.stringify(config));
  await writeFile(path.join(dist, 'events.jsonl'), '');
  await writeFile(path.join(dist, 'fixture.js'), `
    import { appendFileSync, readFileSync } from 'node:fs';
    export const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
    export function event(name, fields = {}) {
      appendFileSync(new URL('./events.jsonl', import.meta.url), JSON.stringify({ name, ...fields }) + '\\n');
    }
    export function failAt(stage) {
      const failure = config.failures?.[stage];
      if (failure) throw Object.assign(new Error(failure.message), failure.code ? { code: failure.code } : {});
    }
  `);
  for (const [file, source] of Object.entries(MODULES)) {
    await writeFile(path.join(dist, file), source);
  }
  return {
    dist,
    options: { releaseRoot, database: DATABASE },
    async events() {
      const lines = (await readFile(path.join(dist, 'events.jsonl'), 'utf8')).trim();
      return lines === '' ? [] : lines.split('\n').map((line) => JSON.parse(line));
    },
  };
}

function failure(code) {
  return { status: 'FAIL', code, scope: SCOPE };
}

function cleanupEvents(events) {
  return events.filter(({ name }) => name === 'runtime.close' || name === 'pool.end');
}

const CLEANUP = [
  { name: 'runtime.close' },
  { name: 'pool.end', purpose: 'business' },
  { name: 'pool.end', purpose: 'usage' },
];

test('imports candidate ESM entry points, initializes with purpose pools, checks readiness, then drains resources', async (t) => {
  const candidate = await fixture(t);
  assert.deepEqual(await probeCandidateRuntime(candidate.options), { status: 'PASS', code: null, scope: SCOPE });
  const events = await candidate.events();
  assert.deepEqual(events.map(({ name }) => name), [
    'pool.create', 'pool.create', 'access.create', 'release.create', 'runtime.create',
    'runtime.initialize', 'release.load', 'runtime.readiness', 'runtime.close', 'pool.end', 'pool.end',
  ]);
  assert.deepEqual(events.slice(0, 2), ['usage', 'business'].map((purpose) => ({
    name: 'pool.create',
    purpose,
    connection: {
      ...DATABASE,
      max: 1,
      connectionTimeoutMillis: 5_000,
      options: '-c default_transaction_read_only=on',
      user: `stack_intake_${purpose}`,
    },
  })));
  assert.deepEqual(events[2], { name: 'access.create', purpose: 'business' });
  assert.deepEqual(events[3], { name: 'release.create', purpose: 'usage' });
  assert.deepEqual(events[4], {
    name: 'runtime.create', accessPurpose: 'business', loaderPurpose: 'usage', distinctPools: true,
  });
  assert.deepEqual(cleanupEvents(events), CLEANUP);
});

test('rejects every initialize result except boolean true and still closes the runtime', async (t) => {
  for (const value of [false, null, 1, 'true', {}]) {
    const candidate = await fixture(t, { initializeReturn: value });
    assert.deepEqual(await probeCandidateRuntime(candidate.options), failure('RUNTIME_PROBE_INITIALIZE_REJECTED'));
    const events = await candidate.events();
    assert.equal(events.some(({ name }) => name === 'runtime.readiness'), false);
    assert.deepEqual(cleanupEvents(events), CLEANUP);
  }
  const candidate = await fixture(t, { undefinedInitialize: true });
  assert.deepEqual(await probeCandidateRuntime(candidate.options), failure('RUNTIME_PROBE_INITIALIZE_REJECTED'));
});

test('requires readiness to return exactly ok', async (t) => {
  for (const value of ['not_ready', true, null, {}]) {
    const candidate = await fixture(t, { readinessReturn: value });
    assert.deepEqual(await probeCandidateRuntime(candidate.options), failure('RUNTIME_PROBE_NOT_READY'));
    assert.deepEqual(cleanupEvents(await candidate.events()), CLEANUP);
  }
  const candidate = await fixture(t, { undefinedReadiness: true });
  assert.deepEqual(await probeCandidateRuntime(candidate.options), failure('RUNTIME_PROBE_NOT_READY'));
});

test('preserves activation callback error codes and SQLSTATE without returning error details', async (t) => {
  for (const [error, expected] of [
    [{ message: 'RELEASE_INDEX_ITEM_GAP' }, 'RELEASE_INDEX_ITEM_GAP'],
    [{ message: 'INTAKE_RUNTIME_ROLE_BOUNDARY', code: '42501' }, 'INTAKE_RUNTIME_ROLE_BOUNDARY'],
    [{ message: 'private row subject token', code: '42P01' }, '42P01'],
    [{ message: 'private row subject token', code: 'P0001' }, 'P0001'],
    [{ message: 'private connection details', code: 'ECONNREFUSED' }, 'ECONNREFUSED'],
    [{ message: 'private row subject token', code: 'RELEASE_INDEX_FAILED' }, 'RELEASE_INDEX_FAILED'],
    [{ message: 'RELEASE_INDEX_ITEM_GAP private row subject token' }, 'RUNTIME_PROBE_INITIALIZE_FAILED'],
    [{ message: 'private row subject token', code: 'private subject' }, 'RUNTIME_PROBE_INITIALIZE_FAILED'],
  ]) {
    const candidate = await fixture(t, { failures: { load: error } });
    assert.deepEqual(await probeCandidateRuntime(candidate.options), failure(expected));
    assert.deepEqual(cleanupEvents(await candidate.events()), CLEANUP);
  }
});

test('cleans up acquisitions after factory failures and direct runtime exceptions', async (t) => {
  for (const stage of ['pool.usage', 'pool.business', 'access', 'release', 'runtime', 'initialize', 'readiness']) {
    const candidate = await fixture(t, { failures: { [stage]: { message: 'FACTORY_OR_RUNTIME_FAILED' } } });
    assert.deepEqual(await probeCandidateRuntime(candidate.options), failure('FACTORY_OR_RUNTIME_FAILED'));
    const expected = stage === 'pool.usage' ? []
      : stage === 'pool.business' ? CLEANUP.slice(2)
        : ['initialize', 'readiness'].includes(stage) ? CLEANUP : CLEANUP.slice(1);
    assert.deepEqual(cleanupEvents(await candidate.events()), expected);
  }
});

test('maps unstructured factory and runtime errors to stable stage codes', async (t) => {
  for (const [stage, expected] of [
    ['pool.business', 'RUNTIME_PROBE_POOL_FAILED'],
    ['runtime', 'RUNTIME_PROBE_RUNTIME_FAILED'],
    ['initialize', 'RUNTIME_PROBE_INITIALIZE_FAILED'],
    ['readiness', 'RUNTIME_PROBE_READINESS_FAILED'],
  ]) {
    const candidate = await fixture(t, { failures: { [stage]: { message: 'private details' } } });
    assert.deepEqual(await probeCandidateRuntime(candidate.options), failure(expected));
  }
});

test('cleanup failure prevents PASS and all remaining cleanup operations are awaited', async (t) => {
  for (const stage of ['close', 'end.business', 'end.usage']) {
    const candidate = await fixture(t, { failures: { [stage]: { message: 'private cleanup details' } } });
    assert.deepEqual(await probeCandidateRuntime(candidate.options), failure('RUNTIME_PROBE_CLEANUP_FAILED'));
    assert.deepEqual(cleanupEvents(await candidate.events()), CLEANUP);
  }
  const candidate = await fixture(t, { failures: {
    load: { message: 'RELEASE_INDEX_ITEM_GAP' },
    close: { message: 'RUNTIME_CLOSE_FAILED' },
    'end.business': { message: 'BUSINESS_CLOSE_FAILED' },
    'end.usage': { message: 'USAGE_CLOSE_FAILED' },
  } });
  assert.deepEqual(await probeCandidateRuntime(candidate.options), failure('RELEASE_INDEX_ITEM_GAP'));
  assert.deepEqual(cleanupEvents(await candidate.events()), CLEANUP);
});

test('an idle pool failure reported during cleanup prevents PASS', async (t) => {
  const candidate = await fixture(t, { idleFailure: 'usage' });
  assert.deepEqual(await probeCandidateRuntime(candidate.options), failure('IDLE_CONNECTION_FAILED'));
  assert.deepEqual(cleanupEvents(await candidate.events()), CLEANUP);
});

test('missing candidate modules or exports fail before any pool is created', async (t) => {
  for (const file of Object.keys(MODULES).filter(file => file !== 'integration/intake-readiness.js')) {
    const missing = await fixture(t);
    await rm(path.join(missing.dist, file));
    assert.deepEqual(await probeCandidateRuntime(missing.options), failure('ERR_MODULE_NOT_FOUND'));
    assert.deepEqual(await missing.events(), []);
    const invalid = await fixture(t);
    await writeFile(path.join(invalid.dist, file), 'export const missingFactory = true;');
    assert.deepEqual(await probeCandidateRuntime(invalid.options), failure('RUNTIME_PROBE_MODULE_INVALID'));
    assert.deepEqual(await invalid.events(), []);
  }
});

test('malformed candidate modules map to a stable load failure', async (t) => {
  const candidate = await fixture(t);
  await writeFile(path.join(candidate.dist, 'integration/query-runtime.js'), 'export {');
  assert.deepEqual(await probeCandidateRuntime(candidate.options), failure('RUNTIME_PROBE_MODULE_LOAD_FAILED'));
  assert.deepEqual(await candidate.events(), []);
});

test('missing returned methods fail closed while other acquired resources are released', async (t) => {
  for (const [config, expected, cleanup] of [
    [{ missingPoolMethod: 'connect' }, 'RUNTIME_PROBE_POOL_INVALID', CLEANUP.slice(2)],
    [{ missingPoolMethod: 'end' }, 'RUNTIME_PROBE_POOL_INVALID', []],
    [{ invalidAccess: true }, 'RUNTIME_PROBE_ACCESS_INVALID', CLEANUP.slice(1)],
    [{ invalidLoader: true }, 'RUNTIME_PROBE_LOADER_INVALID', CLEANUP.slice(1)],
    [{ missingRuntimeMethod: 'initialize' }, 'RUNTIME_PROBE_RUNTIME_INVALID', CLEANUP],
    [{ missingRuntimeMethod: 'readiness' }, 'RUNTIME_PROBE_RUNTIME_INVALID', CLEANUP],
    [{ missingRuntimeMethod: 'close' }, 'RUNTIME_PROBE_RUNTIME_INVALID', CLEANUP.slice(1)],
  ]) {
    const candidate = await fixture(t, config);
    assert.deepEqual(await probeCandidateRuntime(candidate.options), failure(expected));
    assert.deepEqual(cleanupEvents(await candidate.events()), cleanup);
  }
});

test('invalid input fails before loading modules or falling back to implicit PG settings', async () => {
  for (const options of [
    undefined, null, {}, { releaseRoot: ' ' },
    { releaseRoot: '/candidate', database: {} },
    ...[
      { host: '' }, { database: '' }, { port: 0 }, { port: 65536 }, { port: 1.5 }, { port: '5432' },
    ].map((override) => ({ releaseRoot: '/candidate', database: { ...DATABASE, ...override } })),
  ]) {
    assert.deepEqual(await probeCandidateRuntime(options), failure('RUNTIME_PROBE_INPUT_INVALID'));
  }
});

const QUERY_PROFILE = Object.freeze({
  mode: 'intake-compat', configurationSha256: 'a'.repeat(64),
  intakeLogins: { business: 'configured_business', usage: 'configured_usage', worker: 'configured_worker' },
});

test('intake compatibility probes the shared live catalog gates with configured purpose logins', async t => {
  const candidate = await fixture(t, { intakeProbe: true });
  const result = await probeCandidateRuntime({ ...candidate.options, queryProfile: QUERY_PROFILE });
  assert.deepEqual(result, {
    status: 'PASS', code: null, scope: 'candidate-intake-catalog-readonly-gates',
    queryMode: QUERY_PROFILE.mode, configurationSha256: QUERY_PROFILE.configurationSha256,
  });
  const events = await candidate.events();
  assert.deepEqual(events.filter(row => row.name === 'pool.create').map(row => row.connection.user),
    ['configured_usage', 'configured_business', 'configured_worker']);
  assert.deepEqual(events.filter(row => row.name === 'pool.connect').map(row => row.purpose), ['business', 'worker']);
  assert.equal(events.some(row => row.name === 'intake.inspect' && row.purpose === 'usage'), true);
  assert.equal(events.some(row => row.name === 'runtime.create'), false);
  assert.deepEqual(events.filter(row => row.name === 'pool.end').map(row => row.purpose), ['worker', 'business', 'usage']);
});

test('intake gate failure and malformed results prevent a passing restore probe', async t => {
  for (const [configuration, expected] of [
    [{ intakeProbe: true, failures: { intake: { message: 'SOURCE_MISMATCH' } } }, 'SOURCE_MISMATCH'],
    [{ intakeProbe: true, invalidIntake: true }, 'RUNTIME_PROBE_INTAKE_INVALID'],
  ]) {
    const candidate = await fixture(t, configuration);
    const result = await probeCandidateRuntime({ ...candidate.options, queryProfile: QUERY_PROFILE });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.code, expected);
    assert.equal((await candidate.events()).filter(row => row.name === 'pool.end').length, 3);
  }
});

test('malformed query profiles fail before acquiring pools', async t => {
  const candidate = await fixture(t);
  for (const queryProfile of [null, {}, { ...QUERY_PROFILE, mode: 'automatic' },
    { ...QUERY_PROFILE, configurationSha256: '' }, { ...QUERY_PROFILE, intakeLogins: null }]) {
    const result = await probeCandidateRuntime({ ...candidate.options, queryProfile });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.code, 'RUNTIME_PROBE_PROFILE_INVALID');
  }
  assert.deepEqual(await candidate.events(), []);
});

test('a missing intake reader fails compatibility and closes every purpose pool', async t => {
  const candidate = await fixture(t, { intakeProbe: true });
  await rm(path.join(candidate.dist, 'integration/intake-readiness.js'));
  const result = await probeCandidateRuntime({ ...candidate.options, queryProfile: QUERY_PROFILE });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.code, 'ERR_MODULE_NOT_FOUND');
  assert.equal((await candidate.events()).filter(row => row.name === 'pool.end').length, 3);
});
