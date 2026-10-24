import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ProductAuthService } from '../auth-service.js';
import { intakeHttpBoundary } from './http-boundary.js';
import { SEAT_REASONS, SeatRefusal, type SeatService, type SeatReason } from './seats.js';

/**
 * Seat administration routes.
 *
 * They sit outside the frozen OpenAPI bundle, the same way `GET /v1/auth/job` does, because adding
 * operations to that bundle is a separate reviewed change. The envelope matches the intake error
 * shape so the desktop's existing parser reads it, but the reason vocabulary is this route's own:
 * every value in `SEAT_REASONS` is something the operator can act on, and the frozen enum has no
 * words for "that login name is taken".
 *
 * Responses carry no password material and no principal ids. The operator sees a display name, a
 * login name, a post and whether the account is enabled.
 */
const noQuery = (request: FastifyRequest) => Object.keys(request.query as object).length === 0;
const jsonOnly = (request: FastifyRequest) => (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json';

const STATUS: Readonly<Record<SeatReason, number>> = Object.freeze({
  SEAT_INPUT_INVALID: 400,
  SEAT_USERNAME_INVALID: 400,
  SEAT_DISPLAY_NAME_INVALID: 400,
  SEAT_POST_INVALID: 400,
  SEAT_PASSWORD_INVALID: 400,
  SEAT_ROLE_NOT_IN_CEILING: 409,
  SEAT_HOME_INVALID: 400,
  SEAT_HOME_UNKNOWN: 409,
  SEAT_EXISTS: 409,
  SEAT_DISPLAY_NAME_TAKEN: 409,
  SEAT_NOT_FOUND: 404,
  SEAT_FORBIDDEN: 403,
});

function seatFailure(reply: FastifyReply, reason: SeatReason, diagnosticId: string = randomUUID()) {
  return reply.code(STATUS[reason]).send({
    error: {
      code: reason === 'SEAT_NOT_FOUND' ? 'NOT_FOUND' : reason === 'SEAT_FORBIDDEN' ? 'FORBIDDEN' : 'VALIDATION',
      message: reason,
      details: { reason, diagnosticId },
    },
  });
}

const KNOWN = new Set<string>(SEAT_REASONS);

export const contentIntakeSeatRoutes: FastifyPluginAsync<{
  auth: ProductAuthService;
  seats: SeatService;
  report?: (diagnosticId: string, error: unknown) => void;
}> = async (app, { auth, seats, report }) => {
  const actor = intakeHttpBoundary(app, auth, report);

  const respond = async (reply: FastifyReply, run: () => Promise<unknown>) => {
    try {
      return reply.code(200).send(await run());
    } catch (error) {
      if (error instanceof SeatRefusal && KNOWN.has(error.reason)) return seatFailure(reply, error.reason);
      throw error;
    }
  };

  app.get('/v1/intake/seats', { exposeHeadRoute: false }, async (request, reply) => {
    if (!noQuery(request)) return seatFailure(reply, 'SEAT_INPUT_INVALID');
    const who = actor(request);
    return respond(reply, async () => ({ seats: await seats.list(who.user_id) }));
  });

  app.post('/v1/intake/seats', { bodyLimit: 8_192 }, async (request, reply) => {
    if (!noQuery(request) || !jsonOnly(request)) return seatFailure(reply, 'SEAT_INPUT_INVALID');
    const who = actor(request);
    return respond(reply, async () => ({ seat: await seats.create(who.user_id, request.body) }));
  });

  app.post('/v1/intake/seats/:username/password', { bodyLimit: 8_192 }, async (request, reply) => {
    if (!noQuery(request) || !jsonOnly(request)) return seatFailure(reply, 'SEAT_INPUT_INVALID');
    const who = actor(request);
    const username = (request.params as { username: string }).username;
    const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
    // The path decides which seat; a body `username` would be a second, silently ignored answer.
    if ('username' in body) return seatFailure(reply, 'SEAT_INPUT_INVALID');
    return respond(reply, async () => ({ reset: await seats.reset(who.user_id, { ...body, username }) }));
  });

  app.delete('/v1/intake/seats/:username', { exposeHeadRoute: false }, async (request, reply) => {
    if (!noQuery(request)) return seatFailure(reply, 'SEAT_INPUT_INVALID');
    const who = actor(request);
    const username = (request.params as { username: string }).username;
    return respond(reply, async () => ({ disabled: await seats.disable(who.user_id, { username }) }));
  });
};
