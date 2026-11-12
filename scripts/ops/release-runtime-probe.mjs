import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCOPE = 'candidate-query-runtime-readonly-initialization';
const FIXED_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/u;
const SQLSTATE = /^[0-9A-Z]{5}$/u;

function failureCode(error, fallback) {
  if (typeof error?.message === 'string' && FIXED_CODE.test(error.message)) {
    return error.message;
  }
  if (typeof error?.code === 'string'
    && (ERROR_CODE.test(error.code) || SQLSTATE.test(error.code))) {
    return error.code;
  }
  return fallback;
}

function requireMethods(value, names, code) {
  if (names.some((name) => typeof value?.[name] !== 'function')) throw new Error(code);
}

/**
 * Runs the candidate's compiled Query initialization against an already restored,
 * migrated temporary database. The caller owns database preparation and removal.
 * Executes only initialization and readiness. Returns only status, code and scope.
 * The first failure wins, but every acquired resource is still closed before return.
 * @param {{ releaseRoot: string, database: { host: string, port: number, database: string } }} options
 * @returns {Promise<{ status: 'PASS' | 'FAIL', code: string | null, scope: string }>}
 */
export async function probeCandidateRuntime(options) {
  const cleanup = [];
  let code = null;
  let fallback = 'RUNTIME_PROBE_INPUT_INVALID';
  try {
    const { releaseRoot, database } = options ?? {};
    if (typeof releaseRoot !== 'string' || releaseRoot.trim() === ''
      || typeof database?.host !== 'string' || database.host.trim() === ''
      || typeof database.database !== 'string' || database.database.trim() === ''
      || !Number.isInteger(database.port) || database.port < 1 || database.port > 65535) {
      throw new Error('RUNTIME_PROBE_INPUT_INVALID');
    }

    fallback = 'RUNTIME_PROBE_MODULE_LOAD_FAILED';
    const dist = path.resolve(releaseRoot, 'apps/api/dist');
    const [poolModule, accessModule, releaseModule, runtimeModule] = await Promise.all([
      import(pathToFileURL(path.join(dist, 'content-intake/runtime-pool.js')).href),
      import(pathToFileURL(path.join(dist, 'integration/access.js')).href),
      import(pathToFileURL(path.join(dist, 'integration/release.js')).href),
      import(pathToFileURL(path.join(dist, 'integration/query-runtime.js')).href),
    ]);
    requireMethods(poolModule, ['createIntakePurposePool'], 'RUNTIME_PROBE_MODULE_INVALID');
    requireMethods(accessModule, ['createPostgresAccessEvaluator'], 'RUNTIME_PROBE_MODULE_INVALID');
    requireMethods(releaseModule, ['createPostgresQueryReleaseLoader'], 'RUNTIME_PROBE_MODULE_INVALID');
    requireMethods(runtimeModule, ['createApiQueryRuntime'], 'RUNTIME_PROBE_MODULE_INVALID');

    const reportFailure = (error) => { code ??= failureCode(error, 'RUNTIME_PROBE_INITIALIZE_FAILED'); };
    const config = {
      host: database.host,
      port: database.port,
      database: database.database,
      max: 1,
      connectionTimeoutMillis: 5_000,
      options: '-c default_transaction_read_only=on',
    };
    fallback = 'RUNTIME_PROBE_POOL_FAILED';
    const usage = poolModule.createIntakePurposePool(
      { ...config, user: 'stack_intake_usage' }, 'usage', reportFailure,
    );
    cleanup.push(() => usage.end());
    requireMethods(usage, ['connect', 'end'], 'RUNTIME_PROBE_POOL_INVALID');
    const business = poolModule.createIntakePurposePool(
      { ...config, user: 'stack_intake_business' }, 'business', reportFailure,
    );
    cleanup.push(() => business.end());
    requireMethods(business, ['connect', 'end'], 'RUNTIME_PROBE_POOL_INVALID');

    fallback = 'RUNTIME_PROBE_RUNTIME_FAILED';
    const access = accessModule.createPostgresAccessEvaluator(business);
    requireMethods(access, ['evaluate'], 'RUNTIME_PROBE_ACCESS_INVALID');
    const loader = releaseModule.createPostgresQueryReleaseLoader(usage);
    if (typeof loader !== 'function') throw new Error('RUNTIME_PROBE_LOADER_INVALID');
    const runtime = runtimeModule.createApiQueryRuntime({
      access,
      loader,
      observer: { record() {} },
      onActivationFailure: reportFailure,
    });
    cleanup.push(() => runtime.close());
    requireMethods(runtime, ['initialize', 'readiness', 'close'], 'RUNTIME_PROBE_RUNTIME_INVALID');

    fallback = 'RUNTIME_PROBE_INITIALIZE_FAILED';
    if (await runtime.initialize() !== true) {
      code ??= 'RUNTIME_PROBE_INITIALIZE_REJECTED';
    } else {
      fallback = 'RUNTIME_PROBE_READINESS_FAILED';
      if (await runtime.readiness() !== 'ok') code ??= 'RUNTIME_PROBE_NOT_READY';
    }
  } catch (error) {
    code ??= failureCode(error, fallback);
  } finally {
    for (const close of cleanup.reverse()) {
      try {
        await close();
      } catch (error) {
        code ??= failureCode(error, 'RUNTIME_PROBE_CLEANUP_FAILED');
      }
    }
  }
  return { status: code === null ? 'PASS' : 'FAIL', code, scope: SCOPE };
}
