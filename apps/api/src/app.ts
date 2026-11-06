import { IdentityFailure } from './product-auth-service.js';
import { registerProductAuthRoutes, sendIdentityFailure } from './product-auth-routes.js';
import fastify, { type FastifyInstance } from 'fastify';
import { parseContractSchema } from '@customer-agent/contracts';
import { registerAuthRoutes } from './auth-routes.js';
import { readAuthorizationActions, readStoredRosterPermission } from './project-roster-login.js';
import {
  createMockAuthService,
  type AuthService,
} from './auth-service.js';
import {
  isRequestBodyValidationError,
  sendInternalError,
  sendValidationError,
} from './contract-http-errors.js';
import { HTTP_JSON_BODY_MAX_BYTES } from './request-boundary.js';
import {
  createUnavailablePolicyAdminRepository,
  type PolicyAdminRepository,
} from './policy-admin-repository.js';
import { registerPolicyReadRoute, registerPolicyWriteRoute } from './policy-routes.js';
import {
  createApiRuntimeDiagnostic,
  reportApiRuntimeDiagnostic,
  type ApiRuntimeDiagnosticSink,
} from './runtime-diagnostics.js';
import {
  currentRequestActorHash,
  formatApiAccessLog,
  reportApiAccessLog,
  runWithRequestContext,
  type ApiAccessLogSink,
} from './request-log.js';
import { NOTICE_VERSION_MAX_LENGTH, registerNoticeRoutes, type NoticeRouteDependencies } from './notice-routes.js';
import type { ApiRuntimeConfig } from './runtime-config.js';
import type {
  ServiceReadinessChecks,
  ServiceRepository,
} from './service-repository.js';
import { registerSearchRoute, type SearchRouteDependencies } from './search-routes.js';
import { registerEventRoutes, type EventRouteDependencies } from './event-routes.js';
import { registerContentImportRoutes, type ContentImportRouteDependencies } from './content-import-routes.js';
import { registerContentReviewRoutes, type ContentReviewRouteDependencies } from './content-review-routes.js';
import { registerContentReleaseRoutes, type ContentReleaseRouteDependencies } from './content-release-routes.js';
import { registerAnnounceRoutes, type AnnounceRouteDependencies } from './announce-routes.js';
import { registerIterationTaskRoutes, type IterationTaskRouteDependencies } from './iteration-task-routes.js';
import { registerOpsLoopRoutes, type OpsLoopRouteDependencies } from './ops-loop-routes.js';
import { contentIntakeManagementRoutes } from './content-intake/management-http.js';
import { contentIntakeUsageRoutes } from './content-intake/usage-http.js';
import { createContentIntakeService } from './content-intake/service.js';
import { syntheticPrincipalLabels } from './content-intake/synthetic-principal-labels.js';
import type { ContentObjectStore } from './content-object-store.js';
import type { IntakePurposePool } from './content-intake/runtime-pool.js';
import { installAccessAdmission } from './access/admission.js';
import { createBoundedDenialAudit, type AccessDenialAudit } from './access/audit.js';
import { createDatabaseAccessEvaluator } from './access/database.js';
import {
  createMockAccessEvaluator,
  createUnavailableAccessEvaluator,
  type AccessEvaluator,
} from './access/evaluator.js';
import { registerAccessRoutes } from './access/routes.js';
import type { ApiQueryRuntime } from './integration/query-runtime.js';

const NOT_READY_CHECKS = Object.freeze({
  database: 'not_ready',
  schema: 'not_ready',
  auth: 'not_ready',
  storage: 'not_ready',
  content: 'not_ready',
} satisfies ServiceReadinessChecks);

function allChecksReady(checks: ServiceReadinessChecks): boolean {
  return Object.values(checks).every((status) => status === 'ok');
}

/** Every optional dependency is named at the call site. Fourteen of them could be reached
 *  only by position, so a caller that needed the last one had to spell `undefined` eleven
 *  times, and inserting a parameter silently re-bound every argument after it. */
export type ApiAppOptions = Readonly<{
  config: ApiRuntimeConfig;
  repository: ServiceRepository;
  diagnosticSink?: ApiRuntimeDiagnosticSink | undefined;
  authService?: AuthService | undefined;
  policyAdminRepository?: PolicyAdminRepository | undefined;
  searchDependencies?: SearchRouteDependencies | undefined;
  eventDependencies?: EventRouteDependencies | undefined;
  contentImportDependencies?: ContentImportRouteDependencies | undefined;
  contentReviewDependencies?: ContentReviewRouteDependencies | undefined;
  contentReleaseDependencies?: ContentReleaseRouteDependencies | undefined;
  announceDependencies?: AnnounceRouteDependencies | undefined;
  iterationTaskDependencies?: IterationTaskRouteDependencies | undefined;
  opsLoopDependencies?: OpsLoopRouteDependencies | undefined;
  accessLog?: Readonly<{
    logHash: Readonly<{ version: string; key: string }>;
    sink?: ApiAccessLogSink;
  }> | undefined;
  noticeDependencies?: NoticeRouteDependencies | undefined;
  intakeDependencies?: Readonly<{
    business: IntakePurposePool;
    usage: IntakePurposePool;
    worker: IntakePurposePool;
    store: ContentObjectStore;
  }> | undefined;
  accessEvaluator?: AccessEvaluator | undefined;
  accessDenialAudit?: AccessDenialAudit | undefined;
  queryRuntime?: Pick<ApiQueryRuntime, 'afterReleaseMutation' | 'readiness' | 'close'> | undefined;
  testPublicRoutes?: readonly string[] | undefined;
}>;

export function createApiApp(options: ApiAppOptions): FastifyInstance {
  return assembleApiApp(options, false);
}

/** Internal fixture entry: callers must supply isolated synthetic dependencies. Not exported by the public API. */
export function createSyntheticTestApiApp(options: ApiAppOptions): FastifyInstance {
  if (options.config.profile !== 'test') throw new Error('Synthetic fixture requires the test profile');
  return assembleApiApp(options, true);
}

function assembleApiApp(options: ApiAppOptions, allowUnscopedLegacyOps: boolean): FastifyInstance {
  const { config, repository } = options;
  const diagnosticSink = options.diagnosticSink ?? reportApiRuntimeDiagnostic;
  const providedAuthService = options.authService;
  const policyAdminRepository = options.policyAdminRepository ?? createUnavailablePolicyAdminRepository();
  const searchDependencies = options.searchDependencies;
  const eventDependencies = options.eventDependencies;
  const contentImportDependencies = options.contentImportDependencies;
  const contentReviewDependencies = options.contentReviewDependencies;
  const contentReleaseDependencies = options.contentReleaseDependencies;
  const announceDependencies = options.announceDependencies;
  const iterationTaskDependencies = options.iterationTaskDependencies;
  const opsLoopDependencies = options.opsLoopDependencies;
  const accessLog = options.accessLog;
  const noticeDependencies = options.noticeDependencies;
  const intakeDependencies = options.intakeDependencies;
  if (options.testPublicRoutes !== undefined && config.profile !== 'test') {
    throw new Error('Test-only public routes require the test profile');
  }
  const accessEvaluator = options.accessEvaluator
    ?? (authServiceKind(options) === 'mock'
      ? createMockAccessEvaluator()
      : intakeDependencies === undefined
        ? createUnavailableAccessEvaluator()
        : createDatabaseAccessEvaluator(intakeDependencies.business));
  if (config.sessionMode === 'product' && providedAuthService?.kind !== 'product') {
    throw new Error('Product session mode requires explicit identity service');
  }
  if (config.sessionMode !== 'product' && providedAuthService?.kind === 'product') {
    throw new Error('Product identity cannot be installed in mock session mode');
  }
  const authService = providedAuthService ?? createMockAuthService();
  const app = fastify({
    bodyLimit: HTTP_JSON_BODY_MAX_BYTES,
    // Fastify defaults to 100, which would reject a contract-valid 128-byte
    // notice version before the route can validate it. Leave one extra byte so
    // the route returns its stable 400 contract for the first invalid length.
    routerOptions: { maxParamLength: NOTICE_VERSION_MAX_LENGTH + 1 },
    exposeHeadRoutes: false,
    logger: false,
  });

  const accessDenialAudit = options.accessDenialAudit ?? createBoundedDenialAudit({
    maxEntries: 256,
    windowMs: 30_000,
    write: (entry) => {
      console.info(JSON.stringify({
        event: 'access_denied',
        route: entry.route,
        reason: entry.reason,
        accessRevision: entry.accessRevision,
      }));
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof IdentityFailure) return sendIdentityFailure(reply, error);
    if (isRequestBodyValidationError(error)) return sendValidationError(reply);
    try {
      diagnosticSink(createApiRuntimeDiagnostic('API_REQUEST_FAILED', error));
    } catch {
      // Diagnostics are observational; a broken sink must not replace the
      // stable, secretless HTTP failure contract.
    }
    return sendInternalError(reply);
  });

  if (accessLog !== undefined) {
    const sink = accessLog.sink ?? reportApiAccessLog;
    const startedAt = new WeakMap<object, number>();
    // onRequest opens the context so it is still active in onResponse; ALS does not
    // carry a store across hook boundaries on its own.
    app.addHook('onRequest', (request, _reply, done) => {
      startedAt.set(request, performance.now());
      runWithRequestContext(request.id, accessLog.logHash, () => { done(); });
    });
    app.addHook('onResponse', async (request, reply) => {
      const started = startedAt.get(request);
      sink(formatApiAccessLog({
        requestId: request.id,
        // Hashed, never the raw subject id. 'anonymous' when nothing authenticated.
        userId: currentRequestActorHash() ?? 'anonymous',
        path: request.routeOptions.url ?? '<unmatched>',
        method: request.method,
        statusCode: reply.statusCode,
        durationMs: started === undefined ? 0 : Math.max(0, Math.round(performance.now() - started)),
      }));
    });
  }

  installAccessAdmission(app, {
    authService,
    evaluator: accessEvaluator,
    profile: authService.kind,
    denialAudit: accessDenialAudit,
    ...(options.testPublicRoutes === undefined ? {} : {
      additionalPublicRoutes: options.testPublicRoutes,
    }),
  });
  registerAccessRoutes(app, accessEvaluator, authService);

  if (options.queryRuntime !== undefined) {
    const queryRuntime = options.queryRuntime;
    app.addHook('onResponse', async (request, reply) => {
      if (!isSuccessfulReleaseMutation(request.method, request.routeOptions.url, reply.statusCode)) return;
      try {
        await queryRuntime.afterReleaseMutation();
      } catch {
        // The release mutation already committed. Query runtime failures make
        // the active release unavailable instead of changing the HTTP result.
      }
    });
  }

  app.addHook('onClose', async () => {
    const results = await Promise.allSettled([
      () => options.queryRuntime?.close(),
      () => authService.close(), () => repository.close(), () => policyAdminRepository.close(),
      () => contentReviewDependencies?.service.close(),
      () => contentReleaseDependencies?.service.close(),
      () => announceDependencies?.service.close(),
    ].map(close => Promise.resolve().then(close)));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'API resource shutdown failed');
  });

  registerAuthRoutes(app, authService, intakeDependencies ? async (userId) => {
    const client = await intakeDependencies.business.connect();
    try { return await readStoredRosterPermission(client, userId); }
    finally { client.release(); }
  } : undefined, intakeDependencies ? async (user) => {
    const client = await intakeDependencies.business.connect();
    try { return await readAuthorizationActions(client, user); }
    finally { client.release(); }
  } : undefined);
  registerNoticeRoutes(app, authService, noticeDependencies);
  if (authService.kind === 'product') registerProductAuthRoutes(app, authService);
  registerPolicyReadRoute(app, config, repository, authService);
  registerPolicyWriteRoute(app, policyAdminRepository, authService);
  registerSearchRoute(app, authService, searchDependencies);
  registerEventRoutes(app, authService, eventDependencies);
  registerContentImportRoutes(app, authService, contentImportDependencies);
  registerContentReviewRoutes(app, authService, contentReviewDependencies);
  registerContentReleaseRoutes(app, authService, contentReleaseDependencies);
  registerAnnounceRoutes(app, authService, announceDependencies);
  // Legacy statistics, tasks, SOP nodes and script mutations lack an enforceable shop/app scope.
  // Only the explicit synthetic fixture may exercise them; a profile alone cannot.
  registerIterationTaskRoutes(app, authService, iterationTaskDependencies, allowUnscopedLegacyOps);
  registerOpsLoopRoutes(app, authService, opsLoopDependencies, allowUnscopedLegacyOps);
  if (intakeDependencies && authService.kind === 'product') {
    const report = (_diagnosticId: string, error: unknown): void => {
      try { diagnosticSink(createApiRuntimeDiagnostic('API_REQUEST_FAILED', error)); } catch { /* observational */ }
    };
    const usage = createContentIntakeService(
      intakeDependencies.usage, intakeDependencies.store, report, undefined, { requireProductSession: true },
    );
    void app.register(contentIntakeUsageRoutes, { auth: authService, usage, report });
    void app.register(contentIntakeManagementRoutes, {
      auth: authService,
      pool: intakeDependencies.business,
      store: intakeDependencies.store,
      terminalPool: intakeDependencies.worker,
      principalLabels: syntheticPrincipalLabels,
      report,
    });
    app.addHook('onClose', async () => {
      await Promise.all([
        intakeDependencies.business.end(),
        intakeDependencies.usage.end(),
        intakeDependencies.worker.end(),
      ]);
    });
  }

  app.get('/health', async (_request, reply) => {
    const payload = parseContractSchema('HealthResponse', {
      status: 'ok',
      service: 'cs-ai-api',
      version: config.buildVersion,
    });
    reply.header('cache-control', 'no-store');
    return payload;
  });

  app.get('/ready', async (_request, reply) => {
    const checks = await repository.readiness().catch((error: unknown) => {
      try {
        diagnosticSink(createApiRuntimeDiagnostic(
          'READINESS_REPOSITORY_CONTRACT_FAILED',
          error,
        ));
      } catch {
        // Reporting is observational and must not turn fail-closed readiness
        // into an error response that bypasses the stable contract.
      }
      return NOT_READY_CHECKS;
    });
    const storage = contentImportDependencies === undefined
      ? checks.storage
      : await contentImportDependencies.service.readiness().catch(() => 'not_ready' as const);
    const announcedContent = announceDependencies === undefined
      ? checks.content
      : await announceDependencies.service.readiness().catch(() => 'not_ready' as const);
    const content = announcedContent === 'ok'
      && (options.queryRuntime?.readiness() ?? 'ok') === 'ok'
      ? 'ok'
      : 'not_ready';
    const composedChecks = Object.freeze({
      database: checks.database,
      schema: checks.schema,
      auth: authService.readiness(),
      storage: storage === 'ok' ? 'ok' : 'not_ready',
      content: content === 'ok' ? 'ok' : 'not_ready',
    }) satisfies ServiceReadinessChecks;
    const ready = allChecksReady(composedChecks);
    const payload = parseContractSchema(ready ? 'ReadyResponse' : 'NotReadyResponse', {
      status: ready ? 'ready' : 'not_ready',
      checks: composedChecks,
    });
    reply.header('cache-control', 'no-store');
    if (!ready) {
      reply.header('retry-after', '1');
      reply.code(503);
    }
    return payload;
  });

  return app;
}

function isSuccessfulReleaseMutation(method: string, route: string | undefined, statusCode: number): boolean {
  if (method.toUpperCase() !== 'POST' || statusCode < 200 || statusCode >= 300 || route === undefined) return false;
  return route === '/v1/content/publish'
    || route === '/v1/content/rollback'
    || route === '/v1/content/rollback-previous'
    || route === '/v1/intake/candidates/:candidateId/versions/:version/publish'
    || route === '/v1/intake/rollback';
}

function authServiceKind(options: ApiAppOptions): 'mock' | 'product' {
  return options.authService?.kind ?? 'mock';
}
