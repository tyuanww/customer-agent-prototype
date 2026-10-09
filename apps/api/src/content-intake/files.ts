import { IntakeCapacityCommitUnknown, type IntakeCapacity } from './capacity.js';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ContractValidationError, parseContractSchema, type components } from '@customer-agent/contracts';
import { isParseResult, writeIssueReport, type ParseResult } from '@customer-agent/content-intake';
import type { AuthenticatedUser } from '../auth-service.js';
import type { ContentObjectStore, PersistedContentObject } from '../content-object-store.js';
import { parseIntakeUploadMultipart } from '../content-import-multipart.js';
import { authenticatedProductSession } from '../product-auth-service.js';
import { authorize, source } from './authority.js';
import { candidateContext, getJob, jobView, readCandidate } from './candidate.js';
import { digest } from './material.js';
import { sourceInputFormat } from './input-format.js';
import { IntakeRejection, type createIntakeTransactions, type IntakeResult, type IntakeTransaction, type Principal } from './transaction.js';

type C = components['schemas'];
type Run = ReturnType<typeof createIntakeTransactions>;

/** Owns bounded object admission, authenticated material pagination and report
 * export. DB transactions never hold locks across upload, disk or Excel I/O.
 * Only the sealed management host exposes these capabilities over HTTP. */
export function createIntakeFiles(run: Run, store: ContentObjectStore, capacity: IntakeCapacity,
  report: (diagnosticId: string, error: unknown) => void) {
  const cursorSecret = randomBytes(32);
  let uploading = false;
  let exporting = false;
  let readingReport = false;
  function failed(error: unknown): IntakeResult<never> {
    const diagnosticId = `intake_${randomUUID()}`;
    try { report(diagnosticId, error); } catch { /* Observational; never return a sink exception. */ }
    const message = error instanceof Error ? error.message : '';
    const rejection = error instanceof IntakeRejection ? error
      : error instanceof ContractValidationError ? new IntakeRejection('FILE_INVALID', 'VALIDATION')
        : /^CONTENT_(UPLOAD|OBJECT_TYPE)/.test(message) ? new IntakeRejection(
          message.includes('TOO_LARGE') ? 'FILE_LIMIT' : 'FILE_INVALID', 'VALIDATION')
          : new IntakeRejection('FILE_INVALID', 'INTERNAL_ERROR');
    return { ok: false, code: rejection.code, reason: rejection.reason, diagnosticId,
      commit: error instanceof IntakeCapacityCommitUnknown ? 'unknown' : 'rolled_back' };
  }
  const busy = () => failed(new IntakeRejection('QUOTA_EXCEEDED', 'OVERLOADED'));
  async function allowedSource(client: IntakeTransaction, who: Principal, sourceId: string) {
    const src = await source(client, parseContractSchema('IntakeId', sourceId));
    await authorize(client, who, 'import', src);
    if (src.mode !== 'v2-preview') throw new IntakeRejection('MODE_CONFLICT');
    return sourceInputFormat(src);
  }
  const checkSource = (actor: AuthenticatedUser, sourceId: string) => run(actor, 'upload-authorize', null, null,
    (client, who) => allowedSource(client, who, sourceId), v => v as ReturnType<typeof sourceInputFormat>);

  async function state(actor: AuthenticatedUser, id: string) {
    return run(actor, 'job-report', null, null, async (client, who) => {
      const view = jobView((await getJob(client, who, parseContractSchema('IntakeId', id))).job);
      const objects = await client.query<{ sha256: string; bytes: string }>(
        "SELECT sha256,bytes FROM content_intake.objects WHERE object_id=$1 AND purpose='report'", [view.reportObjectId]);
      return { view, report: objects.rows[0] ?? null };
    }, v => v as { view: C['IntakeParseJob']; report: { sha256: string; bytes: string } | null });
  }
  async function readReport(actor: AuthenticatedUser, id: string): Promise<IntakeResult<{ view: C['IntakeParseJob']; parsed: ParseResult | null }>> {
    const before = await state(actor, id);
    if (!before.ok) return before;
    const { view, report: metadata } = before.value;
    if (view.reportObjectId === null) return { ok: true, value: { view, parsed: null } };
    if (readingReport) return busy();
    readingReport = true;
    try {
      const bytes = await store.readPayload(view.reportObjectId);
      if (!metadata || digest(bytes) !== metadata.sha256 || bytes.length !== Number(metadata.bytes)) throw new Error('REPORT_CHANGED');
      const parsed: unknown = JSON.parse(bytes.toString());
      if (!isParseResult(parsed)) throw new Error('INVALID_REPORT');
      // Recheck current session and source authority after disk I/O. Reports are
      // immutable, but their reader's permission is not.
      const after = await state(actor, id);
      if (!after.ok) return after;
      if (after.value.view.reportObjectId !== view.reportObjectId) throw new IntakeRejection('MATERIAL_CHANGED');
      return { ok: true, value: { view, parsed } };
    } catch (error) { return failed(error); }
    finally { readingReport = false; }
  }

  return {
    async upload(actor: AuthenticatedUser, sourceId: string, stream: Readable, contentType: string): Promise<IntakeResult<C['IntakeObject']>> {
      if (uploading) return busy();
      uploading = true;
      let stored: PersistedContentObject | undefined;
      let reclaim = false;
      try {
        const allowed = await checkSource(actor, sourceId);
        if (!allowed.ok) return allowed;
        const form = await parseIntakeUploadMultipart(stream, contentType);
        const operationId = parseContractSchema('IntakeId', form.operationId);
        if (form.sourceType !== allowed.value.sourceType) throw new IntakeRejection('SOURCE_FORMAT_MISMATCH', 'VALIDATION');
        stored = await capacity.persist(actor.user_id, sourceId, 'input', form.file, form.sourceType);
        // The command identity binds server-computed bytes, never a claimed hash.
        const object = stored;
        const registered = await run<C['IntakeObject']>(actor, 'upload', { sourceId, sha256: object.sha256, bytes: object.sizeBytes }, operationId,
          async (client, who) => {
            const format = await allowedSource(client, who, sourceId);
            if (format.sourceType !== object.sourceType) throw new IntakeRejection('SOURCE_FORMAT_MISMATCH', 'VALIDATION');
            await client.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'input',clock_timestamp())`,
            [object.objectId, sourceId, who.id, who.tenantId, who.appId, `intake/${object.objectId}`, object.sha256, object.sizeBytes, format.mime]);
            await capacity.adopt(client, object);
            // Source mode and import authority can change while bytes are stored.
            // A definitive rejection must roll back the object and its receipt.
            client.beforeCommit(async () => {
              const current = await allowedSource(client, who, sourceId);
              if (current.sourceType !== object.sourceType) throw new IntakeRejection('SOURCE_FORMAT_MISMATCH', 'VALIDATION');
            });
            return { objectId: object.objectId, sourceId, sha256: object.sha256, bytes: object.sizeBytes, mime: format.mime };
          }, v => parseContractSchema('IntakeObject', v));
        // A replay references the original object; this new temporary copy is
        // unreferenced. Never reclaim after an uncertain DB commit/rollback.
        reclaim = registered.ok ? registered.value.objectId !== object.objectId : registered.commit === 'rolled_back';
        if (!registered.ok) return registered;
        // A newly committed upload has an object ID the caller must receive.
        // A replay bypasses the work callback, so recheck its current authority.
        if (!reclaim) return registered;
        const stillAllowed = await checkSource(actor, sourceId);
        return stillAllowed.ok ? registered : stillAllowed;
      } catch (error) { return failed(error); }
      finally {
        if (stored && reclaim) {
          try { await capacity.discard(stored.objectId); }
          catch (error) { try { report(`intake_${randomUUID()}`, error); } catch { /* Retention failure is diagnostic only. */ } }
        }
        uploading = false;
      }
    },
    async job(actor: AuthenticatedUser, id: string): Promise<IntakeResult<C['IntakeParseJob']>> {
      const result = await readReport(actor, id);
      if (!result.ok) return result;
      const { view, parsed } = result.value;
      if (!parsed) return { ok: true, value: view };
      return { ok: true, value: { ...view, ...jobView({ job_id: id, generation: String(view.generation), state: view.state,
        result_candidate_id: view.candidateId, result_candidate_version: view.candidateVersion === null ? null : String(view.candidateVersion),
        report_object_id: view.reportObjectId }, parsed) } };
    },
    async issueReport(actor: AuthenticatedUser, id: string): Promise<IntakeResult<Buffer>> {
      if (exporting) return busy();
      exporting = true;
      try {
        const result = await readReport(actor, id);
        if (!result.ok) return result;
        if (!result.value.parsed) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
        const bytes = await writeIssueReport(result.value.parsed.issues);
        const allowed = await state(actor, id);
        if (!allowed.ok) return allowed;
        return { ok: true, value: bytes };
      } catch (error) { return failed(error); }
      finally { exporting = false; }
    },
    material(actor: AuthenticatedUser, id: string, version: number, raw: unknown) {
      return run(actor, 'material', null, null, async (client, who) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        const query = raw as Record<string, unknown>;
        if (Object.keys(query).some(k => k !== 'cursor' && k !== 'limit')) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        const limit = query.limit ?? 50;
        if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        const view = await readCandidate(client, who, parseContractSchema('IntakeId', id), parseContractSchema('IntakeVersion', version));
        const { material } = await candidateContext(client, who, view.key, 'content-manage');
        const binding = JSON.stringify([view.key, authenticatedProductSession(actor), who.generation, who.factsVersion, limit]);
        const sign = (offset: number) => createHmac('sha256', cursorSecret).update(binding).update(String(offset)).digest('base64url');
        let offset = 0;
        if (query.cursor !== undefined) {
          if (typeof query.cursor !== 'string' || query.cursor.length > 512) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
          const match = /^(\d{1,4})\.([A-Za-z0-9_-]{43})$/.exec(query.cursor);
          if (!match || !timingSafeEqual(Buffer.from(match[2]!), Buffer.from(sign(Number(match[1]))))) {
            throw new IntakeRejection('MATERIAL_CHANGED');
          }
          offset = Number(match[1]);
          if (offset === 0 || offset >= Math.max(material.entries.length, material.differences.length)) throw new IntakeRejection('MATERIAL_CHANGED');
        }
        const { entries, differences, ...materialHeader } = material;
        const end = offset + Number(limit);
        return { key: view.key, entries: entries.slice(offset, end), differences: differences.slice(offset, end), materialHeader,
          nextCursor: end < Math.max(entries.length, differences.length) ? `${end}.${sign(end)}` : null };
      }, v => parseContractSchema('IntakeCandidatePage', v));
    },
  };
}
