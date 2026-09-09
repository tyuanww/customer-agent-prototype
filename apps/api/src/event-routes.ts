import {
  parseContractSchema,
  validateContractSchema,
  type components,
} from '@customer-agent/contracts';
import type { FastifyInstance } from 'fastify';
import { authenticateRequestHeaders, type AuthService } from './auth-service.js';
import { sendOverloaded, sendUnauthorized, sendValidationError } from './contract-http-errors.js';
import type {
  EventRepository,
  PreparedAdoptionOperation,
  PreparedEscalationOperation,
} from './event-repository.js';
import { prepareIdempotencyHashes, type CanonicalJsonValue } from './idempotency.js';
import { sendOperationFailure } from './operation-result.js';
import type { ApiHmacKeyRing } from './runtime-config.js';

type AdoptionEventRequest = components['schemas']['AdoptionEventRequest'];
type EscalationRequest = components['schemas']['EscalationRequest'];

export type EventRouteDependencies = Readonly<{
  repository: Pick<EventRepository, 'recordAdoption' | 'recordEscalation'>;
  idempotencyHmac: ApiHmacKeyRing;
}>;

function idempotencyKey(value: string | readonly string[] | undefined): string | null {
  if (typeof value !== 'string' || value.length > 255 || value.trim().length === 0) return null;
  return value;
}

function adoptionBody(event: AdoptionEventRequest): CanonicalJsonValue {
  return {
    query_id: event.query_id,
    outcome: event.outcome,
    chosen_rank: event.chosen_rank,
    chosen_script_id: event.chosen_script_id,
    push_method: event.push_method,
  };
}

function escalationBody(event: EscalationRequest): CanonicalJsonValue {
  return { query_id: event.query_id, action: event.action };
}

export function registerEventRoutes(
  app: FastifyInstance,
  authService: AuthService,
  dependencies?: EventRouteDependencies,
): void {
  app.post('/v1/events/adoption', async (request, reply) => {
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    const key = idempotencyKey(request.headers['idempotency-key']);
    if (key === null) return sendValidationError(reply);
    const contract = validateContractSchema('AdoptionEventRequest', request.body);
    if (!contract.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);

    const prepared = Object.freeze({
      actor,
      idempotencyKey: key,
      requestHashes: prepareIdempotencyHashes(adoptionBody(contract.value), dependencies.idempotencyHmac),
      event: contract.value,
    }) satisfies PreparedAdoptionOperation;
    const result = await dependencies.repository.recordAdoption(prepared);
    if (!result.ok) return sendOperationFailure(reply, result);
    reply.header('cache-control', 'no-store');
    return parseContractSchema('AdoptionEventResponse', {
      ok: true,
      query_id: result.response.query_id,
    });
  });

  app.post('/v1/events/escalate', async (request, reply) => {
    const actor = await authenticateRequestHeaders(authService, request.headers);
    if (actor === null) return sendUnauthorized(reply);
    const key = idempotencyKey(request.headers['idempotency-key']);
    if (key === null) return sendValidationError(reply);
    const contract = validateContractSchema('EscalationRequest', request.body);
    if (!contract.ok) return sendValidationError(reply);
    if (dependencies === undefined) return sendOverloaded(reply);

    const prepared = Object.freeze({
      actor,
      idempotencyKey: key,
      requestHashes: prepareIdempotencyHashes(escalationBody(contract.value), dependencies.idempotencyHmac),
      event: contract.value,
    }) satisfies PreparedEscalationOperation;
    const result = await dependencies.repository.recordEscalation(prepared);
    if (!result.ok) return sendOperationFailure(reply, result);
    reply.header('cache-control', 'no-store');
    return parseContractSchema('EscalationResponse', {
      escalate_id: result.response.escalate_id,
      query_id: result.response.query_id,
      action: result.response.action,
    });
  });
}
