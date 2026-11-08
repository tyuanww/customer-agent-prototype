import type { FastifyRequest } from 'fastify';
import {
  authenticateRequestHeaders,
  type AuthenticatedUser,
  type AuthService,
} from '../auth-service.js';
import type { AccessEvaluation } from './evaluator.js';
import type { AccessProfile, RoutePolicy } from './policy.js';

export type AccessRequestContext = Readonly<{
  actor: AuthenticatedUser;
  evaluation: AccessEvaluation | null;
  policy: RoutePolicy;
  profile: AccessProfile;
}>;

const contexts = new WeakMap<FastifyRequest, AccessRequestContext>();

export function setAccessRequestContext(request: FastifyRequest, context: AccessRequestContext): void {
  contexts.set(request, context);
}

export function accessRequestContext(request: FastifyRequest): AccessRequestContext {
  const context = contexts.get(request);
  if (!context) throw new Error('ACCESS_REQUEST_CONTEXT_MISSING');
  return context;
}

/** Route handlers use the actor already authenticated by admission. Isolated
 * plugin tests retain the same behavior by authenticating once when no context
 * exists. */
export function requestActor(
  request: FastifyRequest,
  authService: AuthService,
): Promise<AuthenticatedUser | null> {
  const context = contexts.get(request);
  return context ? Promise.resolve(context.actor) : authenticateRequestHeaders(authService, request.headers);
}
