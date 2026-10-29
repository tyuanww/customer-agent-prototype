import type { FastifyPluginAsync } from 'fastify';
import type { ProductAuthService } from '../auth-service.js';
import type { createContentIntakeService } from './service.js';
import { intakeFailure, intakeHttpBoundary, intakePageQuery, sendIntake } from './http-boundary.js';

/** Caller owns the service and pools. Explicit synthetic registration only. */
export const contentIntakeGrantRoutes: FastifyPluginAsync<{
  auth: ProductAuthService;
  service: Pick<ReturnType<typeof createContentIntakeService>, 'grants' | 'previewGrants' | 'grantBatch' | 'changeGrant'>;
  report?: (diagnosticId: string, error: unknown) => void;
}> = async (app, { auth, service, report }) => {
  const actor = intakeHttpBoundary(app, auth, report);
  app.get('/v1/intake/grants', { exposeHeadRoute: false }, async (request, reply) => {
    return sendIntake(reply, await service.grants(actor(request), intakePageQuery(request)), 'IntakeGrantList');
  });
  for (const [path, method] of [['/v1/intake/grants/preview','previewGrants'],['/v1/intake/grants','grantBatch']] as const) {
    app.post(path, { bodyLimit: 65_536 }, async (request,reply) => {
      if (Object.keys(request.query as object).length || (request.headers['content-type'] ?? '').split(';')[0]?.trim() !== 'application/json') return intakeFailure(reply,'VALIDATION','FILE_INVALID');
      return sendIntake(reply, await service[method](actor(request),request.body),'IntakeGrantList');
    });
  }
  app.patch('/v1/intake/grants/:grantId', { bodyLimit: 16_384 }, async (request,reply) => {
    if (Object.keys(request.query as object).length || (request.headers['content-type'] ?? '').split(';')[0]?.trim() !== 'application/json') return intakeFailure(reply,'VALIDATION','FILE_INVALID');
    return sendIntake(reply, await service.changeGrant(actor(request),(request.params as {grantId:string}).grantId,request.body),'IntakeGrant');
  });
};
