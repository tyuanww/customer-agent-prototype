import { validateContractSchema } from '@customer-agent/contracts';
import { qualityReceipt } from './quality-access.js';
import { QUALITY_LIMITS } from './quality.js';
import type { Readable } from 'node:stream';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ProductAuthService } from '../auth-service.js';
import { CONTENT_UPLOAD_MAX_BYTES, type ContentObjectStore } from '../content-object-store.js';
import { createContentIntakeService } from './service.js';
import { contentIntakeGrantRoutes } from './grants-http.js';
import type { IntakePool } from './transaction.js';
import type { ApprovalAdapter } from './approval-adapter.js';
import type { IntakePrincipalLabels } from './discovery.js';
import { intakeFailure, intakeHttpBoundary, intakePageQuery, sendIntake } from './http-boundary.js';

const MAX_PENDING_PARSE = 10;
const noQuery = (request: FastifyRequest) => Object.keys(request.query as object).length === 0;
const params = (request: FastifyRequest) => request.params as Record<string, string>;
function version(request: FastifyRequest): number {
  const raw = params(request).version!;
  return /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : NaN;
}
function candidateCommand(request: FastifyRequest): boolean {
  if (!noQuery(request) || (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') return false;
  const body = request.body;
  if (!body || typeof body !== 'object' || !('key' in body) || !body.key || typeof body.key !== 'object') return false;
  // Never let a valid body authorize a different path. Leave the complete body
  // untouched for the service's strict frozen-schema validation.
  return 'candidateId' in body.key && body.key.candidateId === params(request).candidateId
    && 'version' in body.key && body.key.version === version(request);
}

/** Explicitly registered by the isolated synthetic host only. The plugin creates
 * its own session-required service, so an internal DTO-only fixture service cannot
 * accidentally be exposed. No production factory imports this module.
 *
 * Accepted jobs persist before 202. A bounded serial queue drives the existing
 * parser; shutdown aborts/settles it. After a crash, replay the exact receive
 * command to resume a reading/parsing job using its durable receipt. */
export const contentIntakeManagementRoutes: FastifyPluginAsync<{
  auth: ProductAuthService; pool: IntakePool; store: ContentObjectStore;
  approval?: ApprovalAdapter;
  principalLabels?: IntakePrincipalLabels;
  terminalPool?: IntakePool;
  report?: (diagnosticId: string, error: unknown) => void;
}> = async (app, { auth, pool, store, approval, principalLabels, terminalPool, report }) => {
  const actor = intakeHttpBoundary(app, auth, report);
  const service = createContentIntakeService(pool, store, report, approval,
    { requireProductSession: true, ...(principalLabels ? { principalLabels } : {}), ...(terminalPool ? { terminalPool } : {}) });
  await app.register(contentIntakeGrantRoutes, { auth, service, ...(report ? { report } : {}) });
  app.get('/v1/intake/sources/:sourceId/management-context', { exposeHeadRoute: false }, async (request, reply) => {
    if (!noQuery(request) || request.body !== undefined || request.headers['transfer-encoding'] !== undefined
      || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) {
      return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    }
    return sendIntake(reply, await service.managementContext(actor(request), params(request).sourceId!), 'IntakeManagementContext');
  });
  app.get('/v1/intake/principals', { exposeHeadRoute: false }, async (request, reply) => {
    if (request.body !== undefined || request.headers['transfer-encoding'] !== undefined
      || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) {
      return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    }
    return sendIntake(reply, await service.principals(actor(request), intakePageQuery(request)), 'IntakePrincipalPage');
  });
  app.get('/v1/intake/candidates', { exposeHeadRoute: false }, async (request, reply) =>
    sendIntake(reply, await service.candidates(actor(request), intakePageQuery(request)), 'IntakeCandidateList'));
  const stopping = new AbortController();
  let pending = 0;
  let tail = Promise.resolve();
  const jobs = new Set<string>();
  app.addHook('onClose', async () => { stopping.abort(); await tail; });
  app.addContentTypeParser('multipart/form-data', (_request, payload, done) => done(null, payload));
  app.post('/v1/intake/sources/:sourceId/objects', { bodyLimit: CONTENT_UPLOAD_MAX_BYTES + 16 * 1024 }, async (request, reply) => {
    if (!noQuery(request) || !(request.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/form-data;')) {
      return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    }
    return sendIntake(reply, await service.upload(actor(request), params(request).sourceId!, request.body as Readable,
      request.headers['content-type']!), 'IntakeObject', 201);
  });
  app.post('/v1/intake/sources/:sourceId/candidates', { bodyLimit: 65_536 }, async (request, reply) => {
    if (!noQuery(request) || (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    }
    if (stopping.signal.aborted || pending >= MAX_PENDING_PARSE) return intakeFailure(reply, 'OVERLOADED', 'QUOTA_EXCEEDED');
    pending++;
    let queued = false;
    try {
      const who = actor(request);
      const result = await service.receive(who, params(request).sourceId!, request.body);
      if (result.ok && !jobs.has(result.value.jobId)) {
        const id = result.value.jobId;
        jobs.add(id); queued = true;
        tail = tail.then(async () => {
          // parse normalizes failures and performs worker-only terminal bookkeeping.
          // Business/session authority is checked both before work and at freeze.
          await service.parse(who, id, stopping.signal);
        }).catch(error => {
          try { report?.('intake_parse_queue', error); } catch { /* Keep draining after a diagnostic sink failure. */ }
        }).finally(() => { jobs.delete(id); pending--; });
      }
      return sendIntake(reply, result, 'IntakeParseJob', 202);
    } finally { if (!queued) pending--; }
  });
  app.get('/v1/intake/parse-jobs/:jobId', { exposeHeadRoute: false }, async (request, reply) => {
    if (!noQuery(request)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    return sendIntake(reply, await service.job(actor(request), params(request).jobId!), 'IntakeParseJob');
  });
  app.get('/v1/intake/parse-jobs/:jobId/report', { exposeHeadRoute: false }, async (request, reply) => {
    if (!noQuery(request)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    const result = await service.issueReport(actor(request), params(request).jobId!);
    if (!result.ok) return intakeFailure(reply, result.code, result.reason, result.diagnosticId);
    return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', 'attachment; filename="intake-issues.xlsx"').send(result.value);
  });
  app.get('/v1/intake/candidates/:candidateId/versions/:version', { exposeHeadRoute: false }, async (request, reply) => {
    if (!noQuery(request)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    return sendIntake(reply, await service.candidate(actor(request), params(request).candidateId!, version(request)), 'IntakeCandidate');
  });
  app.get('/v1/intake/candidates/:candidateId/versions/:version/material', { exposeHeadRoute: false }, async (request, reply) =>
    sendIntake(reply, await service.material(actor(request), params(request).candidateId!, version(request), intakePageQuery(request)), 'IntakeCandidatePage'));
  for (const [path, method, schema, status] of [
    ['source-confirmation', 'confirmSource', 'IntakeCandidate', 200],
    ['review', 'requestReview', 'IntakeReview', 202],
    ['review/refresh', 'refreshReview', 'IntakeReview', 202],
    ['publish', 'publish', 'IntakeReceipt', 202],
    ['cancel', 'cancel', 'IntakeReceipt', 200],
  ] as const) app.post(`/v1/intake/candidates/:candidateId/versions/:version/${path}`, { bodyLimit: 65_536 }, async (request, reply) => {
    if (!candidateCommand(request)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    return sendIntake(reply, await service[method](actor(request), request.body), schema, status);
  });
  app.get('/v1/intake/candidates/:candidateId/versions/:version/review', { exposeHeadRoute: false }, async (request, reply) => {
    if (!noQuery(request)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    const candidate = await service.candidate(actor(request), params(request).candidateId!, version(request));
    if (!candidate.ok) return intakeFailure(reply, candidate.code, candidate.reason, candidate.diagnosticId);
    // Versioned material is immutable. Both reads authorize independently; this
    // address-to-key lookup cannot carry authority across a logout/revocation.
    return sendIntake(reply, await service.review(actor(request), candidate.value.key), 'IntakeReview');
  });
  for (const [suffix, method, schema] of [
    ['', 'qualityStatus', 'IntakeQualityStatus'],
    ['/samples', 'qualitySamples', 'IntakeQualitySamplePage'],
  ] as const) app.get(`/v1/intake/candidates/:candidateId/versions/:version/quality${suffix}`, { exposeHeadRoute: false }, async (request, reply) =>
    sendIntake(reply, await service[method](actor(request), params(request).candidateId!, version(request), intakePageQuery(request)), schema));
  for (const [suffix, method, schema, action, bodyLimit] of [
    ['freeze', 'freezeQuality', 'IntakeQualityCommand', 'quality-freeze', QUALITY_LIMITS.commandBytes],
    ['checks', 'checkQuality', 'IntakeQualitySubmission', 'quality-check', QUALITY_LIMITS.checksBytes],
  ] as const) app.post(`/v1/intake/candidates/:candidateId/versions/:version/quality/${suffix}`, { bodyLimit, config: { intakeFileLimitStatus: 413 } }, async (request, reply) => {
    if (!candidateCommand(request) || request.headers['content-encoding'] !== undefined) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    const parsed = validateContractSchema(schema, request.body);
    if (!parsed.ok) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    const result = await service[method](actor(request), parsed.value);
    return sendIntake(reply, result.ok ? { ok: true, value: qualityReceipt(parsed.value.operationId, action, result.value) } : result, 'IntakeQualityReceipt');
  });
  app.get('/v1/intake/quality/operations/:operationId', { exposeHeadRoute: false }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).length !== 1 || !('action' in query)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    return sendIntake(reply, await service.qualityOperationReceipt(actor(request), params(request).operationId!, query.action), 'IntakeQualityReceipt');
  });
  for (const [suffix,method,schema,status] of [
    ['/preview','rollbackPreview','IntakeRollbackImpact',200],
    ['','rollback','IntakeRollbackReceipt',202],
  ] as const) app.post(`/v1/intake/rollback${suffix}`,{bodyLimit:65_536},async(request,reply)=>{
    if(!noQuery(request)||(request.headers['content-type']??'').split(';')[0]?.trim().toLowerCase()!=='application/json')return intakeFailure(reply,'VALIDATION','FILE_INVALID');
    return sendIntake(reply,await service[method](actor(request),request.body),schema,status);
  });
  for (const [suffix,method] of [['','requestRollbackReview'],['/refresh','refreshRollbackReview']] as const)
    app.post(`/v1/intake/rollback/:rollbackPlanId/review${suffix}`,{bodyLimit:65_536},async(request,reply)=>{
      if(!noQuery(request)||(request.headers['content-type']??'').split(';')[0]?.trim().toLowerCase()!=='application/json')return intakeFailure(reply,'VALIDATION','FILE_INVALID');
      return sendIntake(reply,await service[method](actor(request),params(request).rollbackPlanId!,request.body),'IntakeRollbackReview',202);
    });
  app.get('/v1/intake/rollback/:rollbackPlanId/review',{exposeHeadRoute:false},async(request,reply)=>{
    if(!noQuery(request)||request.body!==undefined||request.headers['transfer-encoding']!==undefined
      ||(request.headers['content-length']!==undefined&&request.headers['content-length']!=='0'))return intakeFailure(reply,'VALIDATION','FILE_INVALID');
    return sendIntake(reply,await service.rollbackReview(actor(request),params(request).rollbackPlanId!),'IntakeRollbackReview');
  });
  app.get('/v1/intake/operations/:operationId', { exposeHeadRoute: false }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).length !== 1 || !('action' in query)) return intakeFailure(reply, 'VALIDATION', 'FILE_INVALID');
    return sendIntake(reply, await service.operationReceipt(actor(request), params(request).operationId!, query.action), 'IntakeOperationReceipt');
  });
};
