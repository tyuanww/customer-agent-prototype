import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  sendForbiddenOrPolicyDenied,
  sendUnauthorized,
} from '../contract-http-errors.js';
import type { AuthService } from '../auth-service.js';
import { accessRequestContext, requestActor } from './context.js';
import {
  projectAdminAccess,
  projectDashboardSettings,
  projectQueryAccess,
  type AccessEvaluation,
  type AccessEvaluator,
  type DashboardSettingsView,
  type QueryAccessView,
} from './evaluator.js';

function deniedExpiry(evaluation: AccessEvaluation): string {
  return new Date(Date.parse(evaluation.snapshot.resolvedAt) + 1_000).toISOString();
}

function deniedQuery(evaluation: AccessEvaluation): QueryAccessView {
  return {
    state: 'denied',
    scopes: [],
    accessRevision: evaluation.accessRevision,
    factsVersion: evaluation.snapshot.factsVersion ?? 1,
    revocationGeneration: evaluation.snapshot.revocationGeneration,
    policyVersion: evaluation.snapshot.policyVersion ?? 1,
    storeSetVersion: evaluation.snapshot.storeSetVersion ?? 1,
    expiresAt: deniedExpiry(evaluation),
    denyReason: evaluation.denyReason ?? 'POLICY_DENIED',
  };
}

function deniedSettings(evaluation: AccessEvaluation): DashboardSettingsView {
  return {
    state: 'closed',
    grants: 'closed',
    accounts: 'closed',
    accessRevision: evaluation.accessRevision,
    expiresAt: deniedExpiry(evaluation),
    denyReason: evaluation.denyReason ?? 'POLICY_DENIED',
  };
}

export function registerAccessRoutes(
  app: FastifyInstance,
  evaluator: AccessEvaluator,
  fallbackAuth?: AuthService,
): void {
  async function actorFor(request: FastifyRequest, reply: FastifyReply) {
    try {
      return accessRequestContext(request).actor;
    } catch {
      const actor = fallbackAuth ? await requestActor(request, fallbackAuth) : null;
      if (!actor) sendUnauthorized(reply);
      return actor;
    }
  }

  app.get('/v1/access/query', { exposeHeadRoute: false }, async (request, reply) => {
    const actor = await actorFor(request, reply);
    if (!actor) return;
    const evaluation = await evaluator.evaluate(actor.user_id, ['query']);
    return evaluation.decision
      ? projectQueryAccess(evaluation.decision, evaluation.actionReasons.query)
      : deniedQuery(evaluation);
  });

  app.get('/v1/access/settings', { exposeHeadRoute: false }, async (request, reply) => {
    const actor = await actorFor(request, reply);
    if (!actor) return;
    const evaluation = await evaluator.evaluate(actor.user_id, []);
    return evaluation.decision
      ? projectDashboardSettings(
        evaluation.decision,
        evaluation.actionReasons['grants-manage'] ?? evaluation.actionReasons['accounts-manage'],
      )
      : deniedSettings(evaluation);
  });

  app.get('/v1/access/admin', { exposeHeadRoute: false }, async (request, reply) => {
    const context = accessRequestContext(request);
    const evaluation = context.evaluation
      ?? await evaluator.evaluate(context.actor.user_id, ['grants-manage', 'accounts-manage']);
    if (!evaluation.decision || evaluation.decision.state !== 'allowed') {
      return sendForbiddenOrPolicyDenied(reply, 'FORBIDDEN');
    }
    return projectAdminAccess(evaluation.decision);
  });
}
