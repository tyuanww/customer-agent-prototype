#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requiredOptions = ['config', 'token-file', 'document', 'original', 'artifact', 'source-version', 'expected-version', 'operation-id'];
const fileOptions = ['config', 'token-file', 'document', 'original', 'artifact'];
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const safeCode = /^[A-Z][A-Z0-9_]{0,63}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

class CommandFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new CommandFailure(code);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      requireCondition(options.apply === undefined, 'ARGUMENT_INVALID');
      options.apply = true;
      continue;
    }
    requireCondition(argument.startsWith('--') && requiredOptions.includes(argument.slice(2)), 'ARGUMENT_INVALID');
    const key = argument.slice(2);
    requireCondition(options[key] === undefined && index + 1 < argv.length && !argv[index + 1].startsWith('--'), 'ARGUMENT_INVALID');
    options[key] = argv[++index];
  }
  requireCondition(requiredOptions.every(key => typeof options[key] === 'string' && options[key].length > 0), 'ARGUMENT_REQUIRED');
  requireCondition(fileOptions.every(key => path.isAbsolute(options[key])), 'ABSOLUTE_PATH_REQUIRED');
  requireCondition(/^(0|[1-9][0-9]*)$/.test(options['expected-version']), 'VERSION_INVALID');
  const expectedVersion = Number(options['expected-version']);
  requireCondition(Number.isSafeInteger(expectedVersion), 'VERSION_INVALID');
  requireCondition(identifier.test(options['operation-id']) && /^[A-Za-z0-9._:-]{1,128}$/.test(options['source-version']), 'ARGUMENT_INVALID');
  return { ...options, expectedVersion, apply: options.apply === true };
}

function readRegularFile(filename, maximumBytes, privateFile = false) {
  const before = lstatSync(filename);
  requireCondition(before.isFile() && !before.isSymbolicLink(), 'FILE_INVALID');
  const descriptor = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    requireCondition(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino, 'FILE_CHANGED');
    requireCondition(opened.size > 0 && opened.size <= maximumBytes, 'FILE_LIMIT');
    requireCondition(!privateFile || (opened.mode & 0o077) === 0, 'PRIVATE_FILE_REQUIRED');
    const bytes = readFileSync(descriptor);
    requireCondition(bytes.length === opened.size && bytes.length <= maximumBytes, 'FILE_CHANGED');
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

async function loadApiModule(relativePath) {
  return import(pathToFileURL(path.join(repositoryRoot, 'apps/api/dist', relativePath)).href);
}

async function parseConfiguration(filename) {
  const bytes = readRegularFile(filename, 32 * 1024, true);
  const value = JSON.parse(bytes.toString('utf8'));
  requireCondition(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'authDatabase,authMode,businessDatabase'
    && ['mock', 'feishu'].includes(value.authMode)
    && typeof value.authDatabase === 'string' && typeof value.businessDatabase === 'string', 'CONFIG_INVALID');
  const { parseDatabaseConfig, postgresDatabaseTarget, postgresLoginName } = await loadApiModule('runtime-config/database.js');
  const environment = { AUTH_DATABASE_URL: value.authDatabase, BUSINESS_DATABASE_URL: value.businessDatabase };
  const issues = [];
  const authDatabase = parseDatabaseConfig(environment, { connectionString: 'AUTH_DATABASE_URL', defaultPoolMax: 1 }, issues);
  const businessDatabase = parseDatabaseConfig(environment, { connectionString: 'BUSINESS_DATABASE_URL', defaultPoolMax: 1 }, issues);
  requireCondition(issues.length === 0 && authDatabase && businessDatabase, 'CONFIG_INVALID');
  requireCondition(postgresDatabaseTarget(value.authDatabase) === postgresDatabaseTarget(value.businessDatabase)
    && postgresLoginName(value.authDatabase) !== postgresLoginName(value.businessDatabase), 'DATABASE_TARGET_INVALID');
  return { authMode: value.authMode, authDatabase, businessDatabase };
}

async function createRuntime(configuration, token) {
  const [{ createProductAuthService }, { createIntakePurposePool }, { createIntakeTransactions },
    { createOwnerReviewedSopQueryFactWriter }, { withIntakeView }] = await Promise.all([
    loadApiModule('product-auth-service.js'), loadApiModule('content-intake/runtime-pool.js'),
    loadApiModule('content-intake/transaction.js'), loadApiModule('sop-owner-reviewed-query-facts.js'),
    loadApiModule('content-intake/contract-view.js'),
  ]);
  const unavailableProvider = {
    authorizeUrl() { throw new CommandFailure('LOGIN_DISABLED'); },
    async exchange() { throw new CommandFailure('LOGIN_DISABLED'); },
    close() {},
  };
  const auth = await createProductAuthService(configuration.authDatabase, unavailableProvider, configuration.authMode);
  let pool;
  try {
    const actor = await auth.authenticate({ authorization: `Bearer ${token}` });
    requireCondition(actor !== null, 'SESSION_UNAVAILABLE');
    pool = createIntakePurposePool({
      connectionString: configuration.businessDatabase.connectionString,
      max: 1,
      connectionTimeoutMillis: configuration.businessDatabase.connectionTimeoutMs,
      statement_timeout: 5000,
      query_timeout: 6000,
      idle_in_transaction_session_timeout: 5000,
      application_name: 'cs-ai-owner-reviewed-sop-facts',
    }, 'business');
    const writer = createOwnerReviewedSopQueryFactWriter(createIntakeTransactions(pool, undefined, { requireProductSession: true }));
    return {
      write: input => withIntakeView('resource-disable', () => writer.write(actor, input)),
      async close() {
        const closed = await Promise.allSettled([pool.end(), Promise.resolve(auth.close())]);
        requireCondition(closed.every(result => result.status === 'fulfilled'), 'CLEANUP_FAILED');
      },
    };
  } catch (error) {
    await Promise.allSettled([pool?.end(), Promise.resolve(auth.close())]);
    throw error;
  }
}

function failureOutput(error, stage, commit) {
  const code = error instanceof CommandFailure ? error.code : 'COMMAND_FAILED';
  return { status: 'FAILED', stage, code, commit };
}

/** The default path validates exact reviewed files before any credential or database access. */
export async function runOwnerReviewedSopFactsCommand(argv, { runtimeFactory = createRuntime } = {}) {
  let stage = 'arguments';
  let runtime;
  let commit = 'not_attempted';
  let output;
  let exitCode = 1;
  try {
    const options = parseArguments(argv);
    stage = 'files';
    const bytes = readRegularFile(options.document, 1_048_576);
    const originalSha256 = sha256(readRegularFile(options.original, 10 * 1024 * 1024));
    const artifactSha256 = sha256(readRegularFile(options.artifact, 10 * 1024 * 1024));
    const { parseOwnerReviewedSopFacts } = await loadApiModule('sop-owner-reviewed-query-facts.js');
    const source = { version: options['source-version'], bytes };
    const parsed = parseOwnerReviewedSopFacts(source);
    requireCondition(parsed.originalSha256 === originalSha256 && parsed.artifactSha256 === artifactSha256, 'FILE_HASH_MISMATCH');
    const metadata = { sourceSha256: parsed.sourceSha256, originalSha256, artifactSha256, entryCount: parsed.document.permissions.length };
    if (!options.apply) return { exitCode: 0, output: { status: 'FILES_VALIDATED', databaseChecked: false, writeExecuted: false, ...metadata } };
    stage = 'configuration';
    const configuration = await parseConfiguration(options.config);
    let token = readRegularFile(options['token-file'], 128, true).toString('utf8').replace(/[\r\n]+$/, '');
    requireCondition(/^[A-Za-z0-9_-]{43}$/.test(token), 'TOKEN_INVALID');
    stage = 'session';
    runtime = await runtimeFactory(configuration, token);
    token = '';
    stage = 'apply';
    commit = 'unknown';
    const result = await runtime.write({ operationId: options['operation-id'], expectedVersion: options.expectedVersion, source });
    requireCondition(result && typeof result.ok === 'boolean', 'RESULT_INVALID');
    if (result.ok) {
      requireCondition(Number.isSafeInteger(result.value) && result.value > 0, 'RESULT_INVALID');
      commit = 'committed';
      output = { status: 'APPLIED', commit, factVersion: result.value, ...metadata };
      exitCode = 0;
    } else {
      commit = ['rolled_back', 'unknown'].includes(result.commit) ? result.commit : 'unknown';
      output = { status: 'FAILED', stage, code: safeCode.test(result.code) ? result.code : 'COMMAND_FAILED',
        reason: safeCode.test(result.reason) ? result.reason : 'COMMIT_UNKNOWN', commit };
      if (/^intake_[0-9a-f-]{36}$/.test(result.diagnosticId)) output.diagnosticId = result.diagnosticId;
    }
  } catch (error) {
    output = failureOutput(error, stage, commit);
  } finally {
    if (runtime) {
      try { await runtime.close(); }
      catch {
        output = { ...output, cleanup: 'failed' };
        exitCode = 1;
      }
    }
  }
  return { exitCode, output };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runOwnerReviewedSopFactsCommand(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.output)}\n`);
  process.exitCode = result.exitCode;
}
