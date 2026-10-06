import type { Readable } from 'node:stream';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ProductAuthService } from '../auth-service.js';
import { CONTENT_UPLOAD_MAX_BYTES, type ContentObjectStore } from '../content-object-store.js';
import { createContentIntakeService } from './service.js';
import type { IntakePool } from './transaction.js';
import { intakeFailure, intakeHttpBoundary, intakePageQuery, sendIntake } from './http-boundary.js';

const MAX_PENDING_PARSE = 10;
const noQuery = (request: FastifyRequest) => Object.keys(request.query as object).length === 0;
const params = (request: FastifyRequest) => request.params as Record<string, string>;
function version(request: FastifyRequest): number {
  const raw = params(request).version!;
  return /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : NaN;
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
  report?: (diagnosticId: string, error: unknown) => void;
}> = async (app, { auth, pool, store, report }) => {
  const actor = intakeHttpBoundary(app, auth, report);
  const service = createContentIntakeService(pool, store, report, undefined, { requireProductSession: true });
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
};
