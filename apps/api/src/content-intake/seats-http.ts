import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ProductAuthService } from '../auth-service.js';
import { intakeFailure, intakeHttpBoundary } from './http-boundary.js';
import { IntakeRejection } from './transaction.js';
import type { SeatService } from './seats.js';

/**
 * Seat administration routes.
 *
 * These sit outside the frozen OpenAPI bundle, the same way `GET /v1/auth/job` does, because
 * the contract is frozen and adding operations there is a separate reviewed change. Payloads
 * are therefore validated here by hand, and the shapes stay small enough to read.
 *
 * Responses carry no password material and no principal ids: the operator sees a name, a
 * username, a post and whether the account is enabled.
 */
const noQuery = (request: FastifyRequest) => Object.keys(request.query as object).length === 0;
const jsonOnly = (request: FastifyRequest) => (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json';

export const contentIntakeSeatRoutes: FastifyPluginAsync<{
  auth: ProductAuthService;
  seats: SeatService;
  report?: (diagnosticId: string, error: unknown) => void;
}> = async (app, { auth, seats, report }) => {
  const actor = intakeHttpBoundary(app, auth, report);
  const respond = async (reply: Parameters<typeof intakeFailure>[0], run: () => Promise<unknown>) => {
    try {
      return reply.code(200).send(await run());
    } catch (error) {
      if (error instanceof IntakeRejection) return intakeFailure(reply, error.code, error.reason);
      throw error;
    }
  };

  app.get('/v1/intake/seats', { exposeHeadRoute: false }, async (request, reply) => {
    if (!noQuery(request)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    return respond(reply, async () => ({ seats: await seats.list(actor(request)) }));
  });

  app.post('/v1/intake/seats', { bodyLimit: 8_192 }, async (request, reply) => {
    if (!noQuery(request) || !jsonOnly(request)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    return respond(reply, async () => ({ seat: await seats.create(actor(request), request.body) }));
  });

  app.post('/v1/intake/seats/:username/password', { bodyLimit: 8_192 }, async (request, reply) => {
    if (!noQuery(request) || !jsonOnly(request)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    const username = (request.params as { username: string }).username;
    return respond(reply, async () => {
      const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
      return { reset: await seats.reset(actor(request), { ...body, username }) };
    });
  });

  app.delete('/v1/intake/seats/:username', { exposeHeadRoute: false }, async (request, reply) => {
    if (!noQuery(request)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    const username = (request.params as { username: string }).username;
    return respond(reply, async () => ({ disabled: await seats.disable(actor(request), { username }) }));
  });
};
