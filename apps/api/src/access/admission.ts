import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth-service.js';
import { authenticateRequestHeaders } from '../auth-service.js';
import {
  sendForbiddenOrPolicyDenied,
  sendOverloaded,
  sendUnauthorized,
} from '../contract-http-errors.js';
import { setAccessRequestContext } from './context.js';
import type { AccessDenialAudit } from './audit.js';
import {
  evaluationDenyReason,
  evaluationAllows,
  type AccessEvaluator,
} from './evaluator.js';
import {
  ACCESS_PUBLIC_ROUTES,
  policyForRoute,
  routeKey,
  type AccessProfile,
  type RoutePolicy,
} from './policy.js';

export type AccessAdmissionOptions = Readonly<{
  authService: AuthService;
  evaluator: AccessEvaluator;
  profile: AccessProfile;
  denialAudit?: AccessDenialAudit;
  assertPublicRoutes?: boolean;
  additionalPublicRoutes?: readonly string[];
}>;

function publicRoute(
  method: string,
  path: string,
  profile: AccessProfile,
  additional: readonly string[],
): boolean {
  const key = routeKey(method, path);
  return ACCESS_PUBLIC_ROUTES[profile].includes(key) || additional.includes(key);
}

/**
 * Installs admission before any route registration. Unknown routes fail during
 * registration, and public routes are accepted only through the literal profile
 * allowlist. The request decision is reused by projection handlers.
 */
export function installAccessAdmission(
  app: FastifyInstance,
  options: AccessAdmissionOptions,
): void {
  const registered = new Set<string>();
  const seenPublic = new Set<string>();
  const additionalPublicRoutes = options.additionalPublicRoutes ?? [];

  app.addHook('onRoute', (route) => {
    for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
      const key = routeKey(method, route.url);
      if (registered.has(key)) throw new Error(`ACCESS_ROUTE_REGISTRATION_DUPLICATE: ${key}`);
      registered.add(key);
      if (publicRoute(method, route.url, options.profile, additionalPublicRoutes)) {
        seenPublic.add(key);
        continue;
      }
      policyForRoute(method, route.url, options.profile);
    }
  });

  app.addHook('onReady', async () => {
    if (options.assertPublicRoutes === false) return;
    const stale = [...ACCESS_PUBLIC_ROUTES[options.profile], ...additionalPublicRoutes]
      .filter((entry) => !seenPublic.has(entry));
    if (stale.length > 0) throw new Error(`ACCESS_PUBLIC_ROUTE_STALE: ${stale.join(',')}`);
  });

  app.addHook('onRequest', async (request, reply) => {
    const method = request.method.toUpperCase();
    const path = request.routeOptions.url;
    if (!path) return;
    if (publicRoute(method, path, options.profile, additionalPublicRoutes)) return;

    const policy: RoutePolicy = policyForRoute(method, path, options.profile);
    if (policy.kind === 'token') return;
    const actor = await authenticateRequestHeaders(options.authService, request.headers);
    if (!actor) return sendUnauthorized(reply);
    if (policy.kind === 'session') {
      setAccessRequestContext(request, {
        actor,
        evaluation: null,
        policy,
        profile: options.profile,
      });
      return;
    }

    let evaluation;
    try {
      evaluation = await options.evaluator.evaluate(actor.user_id, policy.anyOf);
    } catch {
      return sendOverloaded(reply);
    }
    setAccessRequestContext(request, {
      actor,
      evaluation,
      policy,
      profile: options.profile,
    });
    if (evaluationAllows(evaluation, policy.anyOf)) return;
    options.denialAudit?.record({
      actorUserId: actor.user_id,
      route: routeKey(method, path),
      accessRevision: evaluation.accessRevision,
      reason: evaluationDenyReason(evaluation, policy.anyOf),
    });
    return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
  });
}
