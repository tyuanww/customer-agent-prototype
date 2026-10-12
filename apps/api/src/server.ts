import { createProductAuthService } from './product-auth-service.js';
import { createFeishuIdentityProvider } from './feishu-identity-provider.js';
import { createWorkforceIdentityProvider } from './workforce-identity-provider.js';
import { createSyntheticIdentityProvider } from './synthetic-identity-provider.js';
import { createContentObjectStore } from './content-object-store.js';
import { createIntakePurposePool } from './content-intake/runtime-pool.js';
import { createApiRuntimeDiagnostic, reportApiRuntimeDiagnostic } from './runtime-diagnostics.js';
import { createContentImportService } from './content-import-service.js';
import { createContentReviewService } from './content-review-service.js';
import { createContentReleaseServiceForPool } from './content-release-service.js';
import { createAnnounceServiceForPool } from './announce-service.js';
import { createIterationTaskRepository } from './iteration-task-repository.js';
import { createOpsLoopRepository } from './ops-loop-repository.js';
import { createNoticeServiceForPool } from './notice-service.js';
import { sharedPolicyAdminPool } from './policy-admin-repository.js';
import type { FastifyInstance } from 'fastify';
import { createApiApp } from './app.js';
import { reviewLoginPort, startReviewLoginServer } from './review-login-server.js';
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
  sharedRuntimePool,
  type ServiceRepository,
} from './service-repository.js';

function intakeRoutes(
  auth: Awaited<ReturnType<typeof createProductAuthService>> | undefined,
  objectStoreDir: string | undefined,
) {
  const business = process.env.INTAKE_BUSINESS_DATABASE_URL;
  const usage = process.env.INTAKE_USAGE_DATABASE_URL;
  const worker = process.env.INTAKE_WORKER_DATABASE_URL;
  if (!business && !usage && !worker) return undefined;
  if (auth?.kind !== 'product' || objectStoreDir === undefined || !business || !usage || !worker) {
    throw new Error('Intake HTTP pools are incomplete');
  }
  const report = (error: unknown): void => {
    try { reportApiRuntimeDiagnostic(createApiRuntimeDiagnostic('DATABASE_IDLE_CLIENT_FAILED', error)); } catch { /* observational */ }
  };
  const pool = (connectionString: string, purpose: 'business' | 'usage' | 'worker') => createIntakePurposePool(
    { connectionString, max: 2, connectionTimeoutMillis: 2_000 }, purpose, report,
  );
  return {
    business: pool(business, 'business'),
    usage: pool(usage, 'usage'),
    worker: pool(worker, 'worker'),
    store: createContentObjectStore(objectStoreDir),
  };
}

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
        if ((config.authMode === 'feishu') !== (bootstrap.productIdentity.kind === 'feishu')) {
          throw new Error('Product identity bootstrap is incomplete');
        }
        const callback = `http://${config.host}:${config.port}/v1/auth/callback`;
        const provider = bootstrap.productIdentity.kind === 'feishu'
          ? (bootstrap.productIdentity.providerOrigin
            ? createWorkforceIdentityProvider(bootstrap.productIdentity.feishu, bootstrap.productIdentity.providerOrigin, callback)
            : createFeishuIdentityProvider(bootstrap.productIdentity.feishu))
          : createSyntheticIdentityProvider(bootstrap.productIdentity.providerOrigin, callback);
        auth = await createProductAuthService(bootstrap.productIdentity.database, provider, config.authMode);
      }
      try {
        const contentImport = bootstrap.objectStoreDir === undefined ? undefined : {
          service: createContentImportService(
            createContentObjectStore(bootstrap.objectStoreDir),
            repository.contentImport,
            bootstrap.idempotencyHmac,
            bootstrap.logHash,
          ),
        };
        const contentReview = bootstrap.contentReview === undefined ? undefined : {
          service: createContentReviewService(bootstrap.contentReview.database),
        };
        const adminPool = sharedPolicyAdminPool(policyAdminRepository);
        const contentRelease = adminPool === undefined ? undefined : {
          service: createContentReleaseServiceForPool(
            adminPool, bootstrap.idempotencyHmac, bootstrap.logHash, false,
          ),
        };
        const runtimePool = sharedRuntimePool(repository);
        const announce = runtimePool === undefined ? undefined : {
          service: createAnnounceServiceForPool(runtimePool, bootstrap.logHash, false),
        };
        const iterationTasks = runtimePool === undefined ? undefined : {
          repository: createIterationTaskRepository(runtimePool),
          idempotencyHmac: bootstrap.idempotencyHmac,
        };
        const opsLoop = runtimePool === undefined ? undefined : {
          repository: createOpsLoopRepository(runtimePool),
          idempotencyHmac: bootstrap.idempotencyHmac,
        };
        const notice = runtimePool === undefined ? undefined : {
          service: createNoticeServiceForPool(runtimePool, false),
        };
        const intake = intakeRoutes(auth, bootstrap.objectStoreDir);
        const app = createApiApp(config, repository, undefined, auth, policyAdminRepository,
          { operation: { execute: (request) => repository.executeSearch(request) },
            logHash: bootstrap.logHash, idempotencyHmac: bootstrap.idempotencyHmac,
            // Reads the acceptance proof on the same runtime pool the collection write
            // uses, so a user who accepted cannot be judged differently by two paths.
            ...(notice === undefined ? {} : {
              hasAcceptedCurrentNotice: (userId: string) => runtimePool === undefined
                ? Promise.resolve(false)
                : (async () => {
                  const client = await runtimePool.connect();
                  try {
                    await client.query('SET LOCAL ROLE app_runtime');
                    return await notice.service.hasAcceptedCurrentNotice(client, userId);
                  } finally { client.release(); }
                })(),
            }) },
          { repository, idempotencyHmac: bootstrap.idempotencyHmac },
          contentImport, contentReview, contentRelease, announce, iterationTasks, opsLoop,
          { logHash: bootstrap.logHash },
          notice,
          intake);
        const environment = options.environment ?? process.env;
        const reviewPort = reviewLoginPort(environment, config.port);
        if (config.profile === 'formal-dev' && auth?.kind === 'product' && reviewPort !== undefined) {
          const reviewLogin = await startReviewLoginServer(
            (bindingId) => auth.issueBoundSession(bindingId),
            reviewPort,
          );
          app.addHook('onClose', async () => {
            await new Promise<void>((resolve, reject) => {
              reviewLogin.close((error) => error ? reject(error) : resolve());
            });
          });
        }
        return app;
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
