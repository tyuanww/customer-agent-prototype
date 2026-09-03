import type { FastifyInstance } from 'fastify';
import { parseContractSchema, validateContractSchema } from '@customer-agent/contracts';
import {
  authenticateRequestHeaders,
  type AuthService,
} from './auth-service.js';
import {
  sendForbiddenOrPolicyDenied,
  sendInternalError,
  sendOverloaded,
  sendUnauthorized,
  sendValidationError,
} from './contract-http-errors.js';
import type { PolicyAdminRepository } from './policy-admin-repository.js';
import { authorizePolicyUpdate } from './policy-rules.js';
import type { ApiRuntimeConfig } from './runtime-config.js';
import type { ServiceRepository } from './service-repository.js';

export function registerPolicyReadRoute(
  app: FastifyInstance,
  config: ApiRuntimeConfig,
  repository: ServiceRepository,
  authService: AuthService,
): void {
  app.get('/v1/policy', async (request, reply) => {
    const actor = authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);

    const flags = await repository.readPolicyFlags();
    if (flags === null) return sendOverloaded(reply);

    const payload = parseContractSchema('PolicyResponse', {
      rewrite: flags.rewrite,
      auto_send: flags.auto_send,
      autofill_adapter: flags.autofill_adapter,
      llm_ranker: flags.llm_ranker,
      metrics_experimental_kpi: flags.metrics_experimental_kpi,
      auth_mode: config.authMode,
    });
    reply.header('cache-control', 'no-store');
    return payload;
  });
}

function hasExactUpdateShape(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3
    && keys[0] === 'adr_id'
    && keys[1] === 'flag_key'
    && keys[2] === 'flag_value';
}

function validIdempotencyKey(value: string | readonly string[] | undefined): boolean {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 255
    && value.trim() === value;
}

export function registerPolicyWriteRoute(
  app: FastifyInstance,
  repository: PolicyAdminRepository,
  authService: AuthService,
): void {
  app.post('/v1/policy/flags', async (request, reply) => {
    const actor = authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    if (!validIdempotencyKey(request.headers['idempotency-key'])
      || !hasExactUpdateShape(request.body)) {
      return sendValidationError(reply);
    }
    const requestContract = validateContractSchema('PolicyFlagUpdateRequest', request.body);
    if (!requestContract.ok) return sendValidationError(reply);

    const decision = authorizePolicyUpdate(actor, requestContract.value);
    if (!decision.allowed) {
      return sendForbiddenOrPolicyDenied(
        reply,
        decision.code,
        decision.code === 'POLICY_DENIED'
          ? {
              reason: 'PHASE1_HARD_OFF',
              flag_key: requestContract.value.flag_key,
              requested_value: requestContract.value.flag_value,
            }
          : undefined,
      );
    }

    const result = await repository.setPolicyFlag(actor, requestContract.value);
    if (!result.ok) {
      if (result.code === 'VALIDATION') return sendValidationError(reply);
      if (result.code === 'FORBIDDEN' || result.code === 'POLICY_DENIED') {
        return sendForbiddenOrPolicyDenied(reply, result.code);
      }
      if (result.code === 'OVERLOADED') return sendOverloaded(reply);
      return sendInternalError(reply);
    }

    reply.header('cache-control', 'no-store');
    return parseContractSchema('PolicyFlagUpdateResponse', {
      ok: true,
      flag_key: requestContract.value.flag_key,
      flag_value: requestContract.value.flag_value,
    });
  });
}
