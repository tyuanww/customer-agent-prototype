import fastify, { type FastifyInstance } from 'fastify';
import { parseContractSchema } from '@customer-agent/contracts';
import { registerAuthRoutes } from './auth-routes.js';
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
import type { ApiRuntimeConfig } from './runtime-config.js';
import type {
  ServiceReadinessChecks,
  ServiceRepository,
} from './service-repository.js';
import { registerSearchRoute, type SearchRouteDependencies } from './search-routes.js';

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

export function createApiApp(
  config: ApiRuntimeConfig,
  repository: ServiceRepository,
  diagnosticSink: ApiRuntimeDiagnosticSink = reportApiRuntimeDiagnostic,
  authService: AuthService = createMockAuthService(),
  policyAdminRepository: PolicyAdminRepository = createUnavailablePolicyAdminRepository(),
  searchDependencies?: SearchRouteDependencies,
): FastifyInstance {
  const app = fastify({
    bodyLimit: HTTP_JSON_BODY_MAX_BYTES,
    exposeHeadRoutes: false,
    logger: false,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isRequestBodyValidationError(error)) return sendValidationError(reply);
    try {
      diagnosticSink(createApiRuntimeDiagnostic('API_REQUEST_FAILED', error));
    } catch {
      // Diagnostics are observational; a broken sink must not replace the
      // stable, secretless HTTP failure contract.
    }
    return sendInternalError(reply);
  });

  app.addHook('onClose', async () => {
    authService.close();
    await Promise.all([repository.close(), policyAdminRepository.close()]);
  });

  registerAuthRoutes(app, authService);
  registerPolicyReadRoute(app, config, repository, authService);
  registerPolicyWriteRoute(app, policyAdminRepository, authService);
  registerSearchRoute(app, authService, searchDependencies);

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
    const composedChecks = Object.freeze({
      database: checks.database,
      schema: checks.schema,
      auth: authService.readiness(),
      storage: checks.storage,
      content: checks.content,
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
