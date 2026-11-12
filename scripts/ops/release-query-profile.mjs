import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stackApiEnvironment } from '../synthetic-stack/profile.ts';

/** Reads exact bytes from a bounded private file without exposing its secrets in evidence. */
export function readCandidateApiEnvironment(file) {
  if (!path.isAbsolute(file)) throw new Error('CANDIDATE_API_ENV_INVALID');
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(descriptor);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || (info.mode & 0o400) === 0
      || info.size < 1 || info.size > 1024 * 1024) throw new Error('CANDIDATE_API_ENV_INVALID');
    const bytes = readFileSync(descriptor);
    if (bytes.length < 1 || bytes.length > 1024 * 1024) throw new Error('CANDIDATE_API_ENV_INVALID');
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch {
    throw new Error('CANDIDATE_API_ENV_INVALID');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function resolveReleaseEnvironment(releaseRoot, stackRoot, candidateApiEnv) {
  const candidateEnvironment = candidateApiEnv === undefined ? undefined : readCandidateApiEnvironment(candidateApiEnv);
  const stack = await import(pathToFileURL(path.join(releaseRoot, 'scripts/synthetic-stack/profile.ts')).href);
  const profileFile = path.join(stackRoot, 'profile.json');
  const profile = stack.parseStackProfile(JSON.parse(readFileSync(profileFile, 'utf8')), stackRoot, profileFile);
  const content = stack.loadContentStackConfig(path.join(stackRoot, 'content.env'));
  const feishu = stack.loadFeishuStackConfig(path.join(stackRoot, 'feishu.env'));
  const apiConfig = candidateEnvironment === undefined
    ? stack.loadApiStackConfig(path.join(stackRoot, 'api.env'))
    : stack.parseApiEnvFile(candidateEnvironment.bytes.toString('utf8'));
  // Legacy releases predate the shared stack export and still use these source rules.
  const compose = stack.stackApiEnvironment ?? stackApiEnvironment;
  const environment = compose({ profile, content, feishu, apiConfig });
  return { environment: Object.freeze(environment), candidateEnvironment };
}

/** Builds the private startup environment and its public binding from one file snapshot. */
export async function readReleaseStartupConfiguration(releaseRoot, stackRoot, candidateApiEnv) {
  const [configuration, api, database] = await Promise.all([
    resolveReleaseEnvironment(releaseRoot, stackRoot, candidateApiEnv),
    import(pathToFileURL(path.join(releaseRoot, 'apps/api/dist/runtime-config.js')).href),
    import(pathToFileURL(path.join(releaseRoot, 'apps/api/dist/runtime-config/database.js')).href),
  ]);
  const { environment, candidateEnvironment } = configuration;
  if (candidateEnvironment && readCandidateApiEnvironment(candidateApiEnv).sha256 !== candidateEnvironment.sha256) {
    throw new Error('CANDIDATE_API_ENV_CHANGED');
  }
  const runtime = api.parseApiRuntimeConfig(environment);
  const bootstrap = api.parseApiPrivateBootstrapConfig(environment);
  const mode = bootstrap.query?.mode ?? 'unified';
  if (mode !== 'unified' && mode !== 'intake-compat'
    || environment.CUSTOMER_AGENT_QUERY_MODE !== undefined && environment.CUSTOMER_AGENT_QUERY_MODE !== mode) {
    throw new Error('QUERY_PROFILE_MODE_INVALID');
  }
  const pools = {
    runtime: bootstrap.runtimeDatabase, admin: bootstrap.policyAdminDatabase,
    auth: bootstrap.productIdentity?.database, review: bootstrap.contentReview?.database,
    worker: bootstrap.contentWorker?.database,
    intakeBusiness: bootstrap.query?.intake?.business,
    intakeUsage: bootstrap.query?.intake?.usage,
    intakeWorker: bootstrap.query?.intake?.worker,
  };
  const identities = Object.entries(pools).map(([purpose, config]) => ({
    purpose,
    ...(config === undefined ? { configured: false } : {
      configured: true,
      login: database.postgresLoginName(config.connectionString),
      target: database.postgresDatabaseTarget(config.connectionString),
      poolMax: config.poolMax,
      connectionTimeoutMs: config.connectionTimeoutMs,
      readinessTimeoutMs: config.readinessTimeoutMs,
    }),
  }));
  const binding = {
    mode, profile: runtime.profile, authMode: runtime.authMode, sessionMode: runtime.sessionMode,
    host: runtime.host, port: runtime.port, objectStoreDir: bootstrap.objectStoreDir,
    productIdentity: bootstrap.productIdentity === undefined ? undefined : {
      kind: bootstrap.productIdentity.kind,
      providerOrigin: bootstrap.productIdentity.providerOrigin,
      ...(bootstrap.productIdentity.kind === 'feishu' ? {
        clientId: bootstrap.productIdentity.feishu.clientId,
        redirectUri: bootstrap.productIdentity.feishu.redirectUri,
      } : {}),
    },
    identities,
  };
  const queryProfile = Object.freeze({
    mode,
    ...(candidateEnvironment === undefined ? {} : { apiEnvSha256: candidateEnvironment.sha256 }),
    configurationSha256: createHash('sha256').update(JSON.stringify(binding)).digest('hex'),
    intakeLogins: bootstrap.query?.intake === undefined ? null : Object.freeze({
      business: database.postgresLoginName(bootstrap.query.intake.business.connectionString),
      usage: database.postgresLoginName(bootstrap.query.intake.usage.connectionString),
      worker: database.postgresLoginName(bootstrap.query.intake.worker.connectionString),
    }),
  });
  return Object.freeze({ environment, queryProfile });
}

/** Projects non-secret capability, target and pool identities for release evidence. */
export async function readReleaseQueryProfile(releaseRoot, stackRoot, candidateApiEnv) {
  return (await readReleaseStartupConfiguration(releaseRoot, stackRoot, candidateApiEnv)).queryProfile;
}
