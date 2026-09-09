import { createProductAuthService } from './product-auth-service.js';
import { createSyntheticIdentityProvider } from './synthetic-identity-provider.js';
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
) => FastifyInstance | Promise<FastifyInstance>;
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
    async (config, repository, policyAdminRepository, bootstrap) => {
      let auth;
      if (config.sessionMode === 'product') {
        if (!bootstrap.productIdentity || config.port === 0) throw new Error('Product identity bootstrap is incomplete');
        auth = await createProductAuthService(bootstrap.productIdentity.database,
          createSyntheticIdentityProvider(bootstrap.productIdentity.providerOrigin,
            `http://${config.host}:${config.port}/v1/auth/callback`));
      }
      try {
        return createApiApp(config, repository, undefined, auth, policyAdminRepository,
          { operation: { execute: (request) => repository.executeSearch(request) },
            logHash: bootstrap.logHash, idempotencyHmac: bootstrap.idempotencyHmac },
          { repository, idempotencyHmac: bootstrap.idempotencyHmac });
      } catch (error) {
        await auth?.close();
        throw error;
      }
    },
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
    const builtApp = await buildApp(config, repository, policyAdminRepository, bootstrap);
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
