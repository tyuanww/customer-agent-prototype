import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { components } from '@customer-agent/contracts/sop-unified';
import type { AuthenticatedUser, AuthService } from './auth-service.js';
import { SOP_CONTRACT_SET } from './content-intake/contract-view.js';
import { intakeFailure, intakeHttpBoundary, sendIntake } from './content-intake/http-boundary.js';
import type { IntakeResult } from './content-intake/transaction.js';

type C = components['schemas'];
export type SopMediaResource = {
  kind: 'media'; releaseId: string; objectId: string; query: unknown; continuationHeaders: readonly string[];
};
export type SopContinuationResource = { kind: 'check' | 'renew' | 'close'; body: unknown } | SopMediaResource;
export type SopCheckResult = { kind: 'opened'; receipt: C['IntakeSopContinuationReceipt'] } | { kind: 'checked' };

/** The domain owner authenticates the original ProductSession and authorizes the
 * addressed resource before negotiation. Its commands repeat that authorization
 * and select the exact deployed view before protected reads or state changes. */
export type SopContinuationOperations = {
  negotiate(actor: AuthenticatedUser, resource: SopContinuationResource): Promise<IntakeResult<true>>;
  check(actor: AuthenticatedUser, raw: unknown): Promise<IntakeResult<SopCheckResult>>;
  renew(actor: AuthenticatedUser, raw: unknown): Promise<IntakeResult<C['IntakeSopContinuationReceipt']>>;
  close(actor: AuthenticatedUser, raw: unknown): Promise<IntakeResult<null>>;
  media(actor: AuthenticatedUser, resource: SopMediaResource): Promise<IntakeResult<C['IntakeSopMediaPayload']>>;
};

function mediaResource(request: FastifyRequest): SopMediaResource {
  const { releaseId, mediaObjectId } = request.params as { releaseId: string; mediaObjectId: string };
  const continuationHeaders: string[] = [];
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    if (request.raw.rawHeaders[index]?.toLowerCase() === 'x-sop-continuation') continuationHeaders.push(request.raw.rawHeaders[index + 1] ?? '');
  }
  return { kind: 'media', releaseId, objectId: mediaObjectId, query: request.query, continuationHeaders };
}
function addressedResource(request: FastifyRequest): SopContinuationResource {
  if (request.method === 'GET') return mediaResource(request);
  const path = request.routeOptions.url;
  if (path === '/v1/intake/sop/continuations/renew') return { kind: 'renew', body: request.body };
  if (path === '/v1/intake/sop/continuations/close') return { kind: 'close', body: request.body };
  return { kind: 'check', body: request.body };
}
function complete(reply: FastifyReply) {
  return reply.header('X-Intake-Contract-Set', SOP_CONTRACT_SET).code(204).send();
}
type Failure = Exclude<IntakeResult<unknown>, { ok: true }>;
function protocolFailure(failure: Failure): Failure {
  if (failure.code === 'INTERNAL_ERROR' || failure.reason === 'ORG_FACTS_UNAVAILABLE') return { ...failure, code: 'OVERLOADED' };
  if (failure.code !== 'FORBIDDEN') return failure;
  if (failure.reason === 'LEASE_EXPIRED') return { ...failure, code: 'CONFLICT' };
  return { ...failure, code: 'NOT_FOUND', reason: 'SCOPE_DENIED' };
}
function failed(reply: FastifyReply, result: Failure) {
  const failure = protocolFailure(result);
  return intakeFailure(reply, failure.code, failure.reason, failure.diagnosticId);
}

/** Four frozen v11 operations. Registration is explicit in the capability host.
 * The adapter owns framing, status and schema boundaries, never active progress. */
export const sopContinuationRoutes: FastifyPluginAsync<{
  auth: AuthService;
  continuation: SopContinuationOperations;
  report?: (diagnosticId: string, error: unknown) => void;
}> = async (app, { auth, continuation, report }) => {
  const actor = intakeHttpBoundary(app, auth, report, async (who, request) => {
    const result = await continuation.negotiate(who, addressedResource(request));
    return result.ok ? result : protocolFailure(result);
  });
  const command = { bodyLimit: 8192, config: { intakeGraphOnly: true as const } };
  app.post('/v1/intake/sop/check', command, async (request, reply) => {
    if (Object.keys(request.query as object).length) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    const result = await continuation.check(actor(request), request.body);
    if (!result.ok) return failed(reply, result);
    return result.value.kind === 'opened'
      ? sendIntake(reply, { ok: true, value: result.value.receipt }, 'IntakeSopContinuationReceipt') : complete(reply);
  });
  app.post('/v1/intake/sop/continuations/renew', command, async (request, reply) => {
    if (Object.keys(request.query as object).length) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    const result = await continuation.renew(actor(request), request.body);
    return result.ok ? sendIntake(reply, result, 'IntakeSopContinuationReceipt') : failed(reply, result);
  });
  app.post('/v1/intake/sop/continuations/close', command, async (request, reply) => {
    if (Object.keys(request.query as object).length) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    const result = await continuation.close(actor(request), request.body);
    return result.ok ? complete(reply) : failed(reply, result);
  });
  app.get('/v1/intake/sop/releases/:releaseId/media/:mediaObjectId', {
    exposeHeadRoute: false, config: { intakeGraphOnly: true, intakeLeaseExpiredStatus: 410 },
  }, async (request, reply) => {
    const result = await continuation.media(actor(request), mediaResource(request));
    return result.ok ? sendIntake(reply, result, 'IntakeSopMediaPayload') : failed(reply, result);
  });
};
