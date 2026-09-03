import type { FastifyInstance } from 'fastify';
import { createApiApp } from './app.js';
import {
  parseApiPrivateBootstrapConfig,
  parseApiRuntimeConfig,
  type ApiDatabaseBootstrapConfig,
  type ApiPrivateBootstrapConfig,
  type ApiRuntimeConfig,
  type ApiRuntimeEnvironment,
} from './runtime-config.js';
import {
  createPolicyAdminRepository,
  type PolicyAdminRepository,
} from './policy-admin-repository.js';
import {
  createServiceRepository,
  type ServiceRepository,
} from './service-repository.js';
import { createUnavailableSearchOperation } from './search-routes.js';

export type StartedApi = Readonly<{
  address: string;
  close: () => Promise<void>;
  config: ApiRuntimeConfig;
}>;

type ApiAppFactory = (
  config: ApiRuntimeConfig,
  repository: ServiceRepository,
  policyAdminRepository: PolicyAdminRepository,
  bootstrap: ApiPrivateBootstrapConfig,
) => FastifyInstance;
type ServiceRepositoryFactory = (
  config: ApiDatabaseBootstrapConfig,
) => ServiceRepository;
type PolicyAdminRepositoryFactory = (
  config: ApiDatabaseBootstrapConfig,
) => PolicyAdminRepository;
export type StartApiOptions = Readonly<{
  environment?: ApiRuntimeEnvironment;
}>;

export async function startApi(
  options: StartApiOptions = {},
): Promise<StartedApi> {
  return startApiWithFactory(
    options,
    (config, repository, policyAdminRepository, bootstrap) => createApiApp(
      config,
      repository,
      undefined,
      undefined,
      policyAdminRepository,
      {
        operation: createUnavailableSearchOperation(),
        logHash: bootstrap.logHash,
      },
    ),
  );
}

// Internal test seam. It is deliberately absent from the package entrypoint so
// product callers cannot replace the route owner or bypass createApiApp.
export async function startApiWithFactory(
  options: StartApiOptions,
  buildApp: ApiAppFactory,
  buildRepository: ServiceRepositoryFactory = createServiceRepository,
  buildPolicyAdminRepository: PolicyAdminRepositoryFactory = createPolicyAdminRepository,
): Promise<StartedApi> {
  // Configuration is resolved before constructing Fastify so rejected profiles
  // cannot register routes, bind a socket, or start background work.
  const environment = options.environment ?? process.env;
  const config = parseApiRuntimeConfig(environment);
  const bootstrap = parseApiPrivateBootstrapConfig(environment);
  let repository: ServiceRepository | undefined;
  let policyAdminRepository: PolicyAdminRepository | undefined;
  let app: FastifyInstance | undefined;
  try {
    repository = buildRepository(bootstrap.runtimeDatabase);
    policyAdminRepository = buildPolicyAdminRepository(bootstrap.policyAdminDatabase);
    const builtApp = buildApp(config, repository, policyAdminRepository, bootstrap);
    app = builtApp;
    const address = await builtApp.listen({ host: config.host, port: config.port });
    return Object.freeze({
      address,
      close: () => builtApp.close(),
      config,
    });
  } catch (error: unknown) {
    // Preserve the original startup error; close is only best-effort cleanup of
    // a partially initialized local host and must not replace the root cause.
    await app?.close().catch(() => undefined);
    // A custom test/build seam may not have registered createApiApp's onClose.
    // close() is idempotent, so this also safely covers partial construction.
    await repository?.close().catch(() => undefined);
    await policyAdminRepository?.close().catch(() => undefined);
    throw error;
  }
}
