import type { FastifyReply } from 'fastify';
import { parseContractSchema } from '@customer-agent/contracts';
import {
  sendConflict,
  sendForbiddenOrPolicyDenied,
  sendInternalError,
  sendNotFound,
  sendOverloaded,
  sendSourceGateNotReady,
  sendValidationError,
  type OperationFailureReason,
} from './contract-http-errors.js';

export type { OperationFailureReason } from './contract-http-errors.js';

export type OperationFailureCode =
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'POLICY_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SOURCE_GATE_NOT_READY'
  | 'OVERLOADED'
  | 'INTERNAL';

export type OperationResult<T> =
  | Readonly<{ ok: true; response: T }>
  | Readonly<{
    ok: false;
    code: OperationFailureCode;
    notice?: string;
    reason?: OperationFailureReason;
  }>;

export function sendOperationFailure(
  reply: FastifyReply,
  result: Readonly<{
    ok: false;
    code: OperationFailureCode;
    notice?: string;
    reason?: OperationFailureReason;
  }>,
): FastifyReply {
  if (result.code === 'VALIDATION') return sendValidationError(reply);
  if ((result.code === 'FORBIDDEN' || result.code === 'POLICY_DENIED') && result.notice) {
    // The source-set and facts refusals have their own sentences. Sending the generic copy
    // would tell the operator to ask for access when the real problem is a closed window.
    return reply.code(403).send(parseContractSchema('ForbiddenOrPolicyDeniedErrorEnvelope', {
      error: { code: result.code, message: result.notice },
    }));
  }
  if (result.code === 'FORBIDDEN' || result.code === 'POLICY_DENIED') {
    return sendForbiddenOrPolicyDenied(reply, result.code);
  }
  if (result.code === 'NOT_FOUND') return sendNotFound(reply);
  if (result.code === 'CONFLICT') return sendConflict(reply);
  if (result.code === 'SOURCE_GATE_NOT_READY') return sendSourceGateNotReady(reply);
  if (result.code === 'OVERLOADED') {
    return sendOverloaded(reply, result.reason === undefined
      ? { kind: 'generic' }
      : { kind: 'sop', reason: result.reason });
  }
  return sendInternalError(reply);
}
