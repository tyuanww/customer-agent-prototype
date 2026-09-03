import fastify, { type FastifyInstance } from 'fastify';
import { parseContractSchema } from '@customer-agent/contracts';
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
): FastifyInstance {
  const app = fastify({
    exposeHeadRoutes: false,
    logger: false,
  });

  app.addHook('onClose', async () => repository.close());

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
    const ready = allChecksReady(checks);
    const payload = parseContractSchema(ready ? 'ReadyResponse' : 'NotReadyResponse', {
      status: ready ? 'ready' : 'not_ready',
      checks,
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
