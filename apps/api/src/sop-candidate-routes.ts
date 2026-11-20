import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { SOP_CANDIDATE_CONTRACT_SET_ID, validateContractSchema } from '@customer-agent/contracts/sop-candidates';
import type { AuthenticatedUser, ProductAuthService } from './auth-service.js';
import { authenticateRequestHeaders } from './auth-service.js';
import { isRequestBodyValidationError } from './contract-http-errors.js';
import { type createSopCandidateOperation } from './sop-candidate-operation.js';
import { sendOperationFailure, sendSopError } from './sop-query-routes.js';

function exactContractHeader(request: FastifyRequest): boolean {
  const headers = request.raw.rawHeaders;
  let found = false;
  for (let index = 0; index < headers.length; index += 2) {
    if (headers[index]?.toLowerCase() !== 'x-intake-contract-set') continue;
    if (found || headers[index + 1] !== SOP_CANDIDATE_CONTRACT_SET_ID) return false;
    found = true;
  }
  return found;
}

export const sopCandidateRoutes: FastifyPluginAsync<{
  auth: ProductAuthService;
  operation: ReturnType<typeof createSopCandidateOperation>;
  report: (error: unknown) => void;
}> = async (app, { auth, operation, report }) => {
  const actors = new WeakMap<FastifyRequest, AuthenticatedUser>();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = await authenticateRequestHeaders(auth, request.headers);
    if (!actor) {
      return sendOperationFailure(reply, { ok: false, code: 'UNAUTHORIZED' });
    }
    if (!exactContractHeader(request)) {
      return sendSopError(reply, 409, 'CONTRACT_UPGRADE_REQUIRED', '请求使用的合同集不受支持');
    }
    actors.set(request, actor);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (isRequestBodyValidationError(error)) {
      return sendSopError(reply, 400, 'CONTRACT_UPGRADE_REQUIRED', '请求体不符合 SOP 候选合同');
    }
    report(error);
    return sendSopError(reply, 503, 'SOP_UNAVAILABLE', '当前 SOP 服务不可用');
  });
  const actorFor = (request: FastifyRequest) => {
    const actor = actors.get(request);
    if (!actor) throw new Error('SOP_CANDIDATE_SESSION_MISSING');
    return actor;
  };
  app.post('/v1/sop/candidate-queries', async (request, reply) => {
    const parsed = validateContractSchema('W5SopCandidateDiscoverRequest', request.body);
    if (!parsed.ok) return sendSopError(reply, 400, 'CONTRACT_UPGRADE_REQUIRED', '请求体不符合 SOP 候选合同');
    const result = await operation.discover(actorFor(request), parsed.value);
    if ('ok' in result) return sendOperationFailure(reply, result);
    return reply.header('x-intake-contract-set', SOP_CANDIDATE_CONTRACT_SET_ID).send(result);
  });
  app.post('/v1/sop/candidate-selections', async (request, reply) => {
    const parsed = validateContractSchema('W5SopCandidateSelectRequest', request.body);
    if (!parsed.ok) return sendSopError(reply, 400, 'CONTRACT_UPGRADE_REQUIRED', '请求体不符合 SOP 候选合同');
    const result = await operation.select(actorFor(request), parsed.value);
    if ('ok' in result) return sendOperationFailure(reply, result);
    return reply.header('x-intake-contract-set', SOP_CANDIDATE_CONTRACT_SET_ID).send(result);
  });
};
