import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stackApiEnvironment } from '../synthetic-stack/profile.ts';

/** Resolves the candidate's actual stack configuration without starting services.
 * Credentials stay in memory. The fingerprint contains capability, target and
 * pool identities so restore evidence cannot be reused after a mode change. */
export async function readReleaseQueryProfile(releaseRoot, stackRoot) {
  const [stack, api, database] = await Promise.all([
    import(pathToFileURL(path.join(releaseRoot, 'scripts/synthetic-stack/profile.ts')).href),
    import(pathToFileURL(path.join(releaseRoot, 'apps/api/dist/runtime-config.js')).href),
    import(pathToFileURL(path.join(releaseRoot, 'apps/api/dist/runtime-config/database.js')).href),
  ]);
  const profileFile = path.join(stackRoot, 'profile.json');
  const profile = stack.parseStackProfile(JSON.parse(readFileSync(profileFile, 'utf8')), stackRoot, profileFile);
  const content = stack.loadContentStackConfig(path.join(stackRoot, 'content.env'));
  const feishu = stack.loadFeishuStackConfig(path.join(stackRoot, 'feishu.env'));
  const apiConfig = stack.loadApiStackConfig(path.join(stackRoot, 'api.env'));
  // Legacy releases predate the shared stack export and still use these source rules.
  const compose = stack.stackApiEnvironment ?? stackApiEnvironment;
  const environment = compose({ profile, content, feishu, apiConfig });
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
  return Object.freeze({
    mode,
    configurationSha256: createHash('sha256').update(JSON.stringify(binding)).digest('hex'),
    intakeLogins: bootstrap.query?.intake === undefined ? null : Object.freeze({
      business: database.postgresLoginName(bootstrap.query.intake.business.connectionString),
      usage: database.postgresLoginName(bootstrap.query.intake.usage.connectionString),
      worker: database.postgresLoginName(bootstrap.query.intake.worker.connectionString),
    }),
  });
}
