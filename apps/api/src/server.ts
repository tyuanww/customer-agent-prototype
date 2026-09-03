import type { FastifyInstance } from 'fastify';
import { createApiApp } from './app.js';
import {
  parseApiDatabaseBootstrapConfig,
  parseApiRuntimeConfig,
  type ApiDatabaseBootstrapConfig,
  type ApiRuntimeConfig,
  type ApiRuntimeEnvironment,
} from './runtime-config.js';
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
) => FastifyInstance;
type ServiceRepositoryFactory = (
  config: ApiDatabaseBootstrapConfig,
) => ServiceRepository;
export type StartApiOptions = Readonly<{
  environment?: ApiRuntimeEnvironment;
}>;

export async function startApi(
  options: StartApiOptions = {},
): Promise<StartedApi> {
  return startApiWithFactory(options, createApiApp);
}

// Internal test seam. It is deliberately absent from the package entrypoint so
// product callers cannot replace the route owner or bypass createApiApp.
export async function startApiWithFactory(
  options: StartApiOptions,
  buildApp: ApiAppFactory,
  buildRepository: ServiceRepositoryFactory = createServiceRepository,
): Promise<StartedApi> {
  // Configuration is resolved before constructing Fastify so rejected profiles
  // cannot register routes, bind a socket, or start background work.
  const environment = options.environment ?? process.env;
  const config = parseApiRuntimeConfig(environment);
  const database = parseApiDatabaseBootstrapConfig(environment);
  const repository = buildRepository(database);
  let app: FastifyInstance | undefined;
  try {
    const builtApp = buildApp(config, repository);
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
    await repository.close().catch(() => undefined);
    throw error;
  }
}
