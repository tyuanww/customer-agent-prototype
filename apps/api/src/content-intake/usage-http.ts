import type { FastifyPluginAsync } from 'fastify';
import type { ProductAuthService } from '../auth-service.js';
import type { createContentIntakeService } from './service.js';
import { intakeFailure, intakeHttpBoundary, intakePageQuery, sendIntake } from './http-boundary.js';

/** Sealed adapter: the isolated synthetic host explicitly registers these query
 * routes. Production app/server factories do not register it or acquire new ACL.
 * Authenticated DTO identity is retained (no spread/clone); the usage service
 * locks and rechecks its private session binding in each transaction.
 */
export const contentIntakeUsageRoutes: FastifyPluginAsync<{
  auth: ProductAuthService;
  usage: Pick<ReturnType<typeof createContentIntakeService>, 'issueEntitlement' | 'snapshot' | 'preview' | 'authorizations' | 'sources' | 'vocabulary' | 'shopDirectory'>;
  report?: (diagnosticId: string, error: unknown) => void;
}> = async (app, { auth, usage, report }) => {
  const actor = intakeHttpBoundary(app, auth, report);
  app.get('/v1/intake/sources/:sourceId/vocabulary', { exposeHeadRoute: false }, async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    return sendIntake(reply, await usage.vocabulary(actor(request), sourceId, intakePageQuery(request)), 'IntakeVocabularyList');
  });
  app.get('/v1/intake/preview', { exposeHeadRoute: false }, async (request, reply) => {
    const result = await usage.preview(actor(request), request.query);
    if (!result.ok) return intakeFailure(reply, result.code, result.reason);
    reply.header('cache-control', 'private, no-store');
    return reply.send(result.value);
  });
  app.post('/v1/intake/entitlements', { bodyLimit: 65_536 }, async (request, reply) => {
    if (Object.keys(request.query as object).length) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    return sendIntake(reply, await usage.issueEntitlement(actor(request), request.body), 'IntakeEntitlement');
  });
  for (const [path, method, schema] of [
    ['shop-directory', 'shopDirectory', 'IntakeShopDirectory'],
    ['snapshot', 'snapshot', 'IntakeSnapshot'],
    ['authorization', 'authorizations', 'IntakeAuthorization'],
    ['sources', 'sources', 'IntakeSourceList'],
  ] as const) app.get(`/v1/intake/${path}`, { exposeHeadRoute: false }, async (request, reply) => {
    return sendIntake(reply, await usage[method](actor(request), intakePageQuery(request)), schema);
  });
};
