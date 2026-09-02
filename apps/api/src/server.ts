import type { FastifyInstance } from 'fastify';
import { createApiApp } from './app.js';
import {
  parseApiRuntimeConfig,
  type ApiRuntimeConfig,
  type ApiRuntimeEnvironment,
} from './runtime-config.js';

export type StartedApi = Readonly<{
  address: string;
  close: () => Promise<void>;
  config: ApiRuntimeConfig;
}>;

type ApiAppFactory = (config: ApiRuntimeConfig) => FastifyInstance;
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
): Promise<StartedApi> {
  // Configuration is resolved before constructing Fastify so rejected profiles
  // cannot register routes, bind a socket, or start background work.
  const config = parseApiRuntimeConfig(options.environment ?? process.env);
  const app = buildApp(config);
  try {
    const address = await app.listen({ host: config.host, port: config.port });
    return Object.freeze({
      address,
      close: () => app.close(),
      config,
    });
  } catch (error: unknown) {
    // Preserve the original startup error; close is only best-effort cleanup of
    // a partially initialized local host and must not replace the root cause.
    await app.close().catch(() => undefined);
    throw error;
  }
}
