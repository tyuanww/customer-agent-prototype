import fastify, { type FastifyInstance } from 'fastify';
import { parseContractSchema } from '@customer-agent/contracts';
import type { ApiRuntimeConfig } from './runtime-config.js';

export function createApiApp(config: ApiRuntimeConfig): FastifyInstance {
  const app = fastify({
    exposeHeadRoutes: false,
    logger: false,
  });

  app.get('/health', async (_request, reply) => {
    const payload = parseContractSchema('HealthResponse', {
      status: 'ok',
      service: 'cs-ai-api',
      version: config.buildVersion,
    });
    reply.header('cache-control', 'no-store');
    return payload;
  });

  return app;
}
