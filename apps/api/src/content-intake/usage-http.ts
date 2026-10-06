import type { FastifyPluginAsync } from 'fastify';
import type { ProductAuthService } from '../auth-service.js';
import type { createContentIntakeService } from './service.js';
import { intakeFailure, intakeHttpBoundary, intakePageQuery, sendIntake } from './http-boundary.js';

/** Sealed adapter: the isolated synthetic host explicitly registers these four
 * routes. Production app/server factories do not register it or acquire new ACL.
 * Authenticated DTO identity is retained (no spread/clone); the usage service
 * locks and rechecks its private session binding in each transaction.
 */
export const contentIntakeUsageRoutes: FastifyPluginAsync<{
  auth: ProductAuthService;
  usage: Pick<ReturnType<typeof createContentIntakeService>, 'issueEntitlement' | 'snapshot' | 'authorizations' | 'sources'>;
  report?: (diagnosticId: string, error: unknown) => void;
}> = async (app, { auth, usage, report }) => {
  const actor = intakeHttpBoundary(app, auth, report);
  app.post('/v1/intake/entitlements', { bodyLimit: 65_536 }, async (request, reply) => {
    if (Object.keys(request.query as object).length) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    return sendIntake(reply, await usage.issueEntitlement(actor(request), request.body), 'IntakeEntitlement');
  });
  for (const [path, method, schema] of [
    ['snapshot', 'snapshot', 'IntakeSnapshot'],
    ['authorization', 'authorizations', 'IntakeAuthorization'],
    ['sources', 'sources', 'IntakeSourceList'],
  ] as const) app.get(`/v1/intake/${path}`, { exposeHeadRoute: false }, async (request, reply) => {
    return sendIntake(reply, await usage[method](actor(request), intakePageQuery(request)), schema);
  });
};
