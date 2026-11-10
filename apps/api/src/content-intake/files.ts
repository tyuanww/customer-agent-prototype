import { IntakeCapacityCommitUnknown, type IntakeCapacity } from './capacity.js';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ContractValidationError, parseContractSchema, type components } from './contract-view.js';
import { isParseResult, writeIssueReport, type ParseResult } from '@customer-agent/content-intake';
import type { AuthenticatedUser } from '../auth-service.js';
import type { ContentObjectStore, PersistedContentObject } from '../content-object-store.js';
import { parseIntakeUploadMultipart } from '../content-import-multipart.js';
import { authenticatedProductSession } from '../product-auth-service.js';
import { authorize, source } from './authority.js';
import { candidateContext, getJob, jobView, readCandidate } from './candidate.js';
import { canonical, digest } from './material.js';
import { readQualityView } from './quality.js';
import { sourceInputFormat } from './input-format.js';
import { IntakeRejection, type createIntakeTransactions, type IntakeResult, type IntakeTransaction, type Principal } from './transaction.js';
import { intakeView } from './contract-view.js';

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

  const qualityReport = (actor: AuthenticatedUser, id: string) => run(actor, 'graph-quality-report', null, null, async (client, who) => {
    const { job } = await getJob(client, who, id);
    if (!job.result_candidate_id || !job.result_candidate_version) throw new IntakeRejection('MATERIAL_CHANGED');
    const candidate = await readCandidate(client, who, job.result_candidate_id, Number(job.result_candidate_version), 'import');
    const { material } = await candidateContext(client, who, candidate.key, 'import');
    if (material.canonicalEncodingVersion !== 'candidate-sop-task-graph-v2') return null;
    const { progress, graph } = await readQualityView(client, who, candidate.key);
    if (!graph) throw new IntakeRejection('SOURCE_FORMAT_MISMATCH');
    const { rounds, plan, ...metadata } = progress;
    const rows: string[][] = [['metadata', '0', canonical(metadata)], ['sopPlan', '0', canonical(graph.sopPlan)]];
    for (const [name, field] of Object.entries(plan ?? {})) {
      const items = Array.isArray(field) ? field : [field];
      items.forEach((item, index) => rows.push([`faqPlan.${name}`, String(index), canonical(item)]));
    }
    graph.targets.forEach((target, index) => rows.push(['sopTarget', String(index), canonical(target)]));
    for (const round of rounds) {
      const { checks, ...attribution } = round;
      rows.push(['round', round.phase, canonical(attribution)]);
      checks.forEach((check, index) => rows.push([`faqCheck.${round.phase}`, String(index), canonical(check)]));
    }
    graph.checks.forEach((check, index) => rows.push(['sopCheck', String(index), canonical(check)]));
    return rows;
  }, value => {
    if (value === null) return null;
    if (!Array.isArray(value) || !value.every((row): row is string[] => Array.isArray(row) && row.length === 3 && row.every(cell => typeof cell === 'string'))) {
      throw new Error('INVALID_QUALITY_REPORT');
    }
    return value;
  });

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
        if (intakeView() === 'graph' && result.value.view.state === 'validated') {
          const evidence = await qualityReport(actor, id);
          if (!evidence.ok) return evidence;
          if (evidence.value !== null) {
            const bytes = await writeIssueReport([], evidence.value);
            const current = await qualityReport(actor, id);
            if (!current.ok) return current;
            if (canonical(current.value) !== canonical(evidence.value)) throw new IntakeRejection('MATERIAL_CHANGED');
            return { ok: true, value: bytes };
          }
        }
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
        if (Object.keys(query).some(k => k !== 'cursor' && k !== 'limit' && k !== 'previous')) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        const limit = query.limit ?? 50;
        if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        if (query.previous !== undefined && typeof query.previous !== 'boolean') throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        const view = await readCandidate(client, who, parseContractSchema('IntakeId', id), parseContractSchema('IntakeVersion', version));
        const { material } = await candidateContext(client, who, view.key, 'content-manage');
        const binding = JSON.stringify([view.key, intakeView(), authenticatedProductSession(actor), who.generation, who.factsVersion, limit]);
        const sign = (offset: number) => createHmac('sha256', cursorSecret).update(binding).update(String(offset)).digest('base64url');
        const graph = material.canonicalEncodingVersion === 'candidate-sop-task-graph-v2';
        const total = graph ? material.entries.length + material.differences.length + (material.sopFlows?.length ?? 0) + (material.sopDifferences?.length ?? 0)
          : Math.max(material.entries.length, material.differences.length);
        let offset = 0;
        if (query.cursor !== undefined) {
          if (typeof query.cursor !== 'string' || query.cursor.length > 512) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
          const match = /^(\d{1,4})\.([A-Za-z0-9_-]{43})$/.exec(query.cursor);
          if (!match || !timingSafeEqual(Buffer.from(match[2]!), Buffer.from(sign(Number(match[1]))))) {
            throw new IntakeRejection('MATERIAL_CHANGED');
          }
          offset = Number(match[1]);
          // Graph pages also pack by bytes, so their previous boundary is computed
          // from the same immutable material below.
          if (query.previous === true && !graph) offset = Math.max(0, offset - Number(limit));
          else if (offset === 0 || offset >= total) throw new IntakeRejection('MATERIAL_CHANGED');
        } else if (query.previous === true) {
          throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        }
        const { entries, differences, sopFlows, sopDifferences, ...materialHeader } = material;
        if (graph) {
          const records = [
            ...entries.map(value => ({ collection: 'entries' as const, value })),
            ...differences.map(value => ({ collection: 'differences' as const, value })),
            ...(sopFlows ?? []).map(value => ({ collection: 'sopFlows' as const, value })),
            ...(sopDifferences ?? []).map(value => ({ collection: 'sopDifferences' as const, value })),
          ];
          const page = { key: view.key, entries: [] as C['IntakeEntry'][], differences: [] as C['IntakeDifference'][],
            sopFlows: [] as C['IntakeSopFlowDefinition'][], sopDifferences: [] as C['IntakeSopFlowDifference'][], materialHeader, nextCursor: null as string | null };
          const headerBytes = Buffer.byteLength(JSON.stringify(page)) + 514;
          const pageEnd = (start: number) => {
            let end = start, bytes = headerBytes;
            while (end < records.length && end - start < Number(limit)) {
              const added = Buffer.byteLength(JSON.stringify(records[end]!.value)) + 1;
              if (bytes + added > 1_048_576) break;
              end++; bytes += added;
            }
            if (end === start && end < total) throw new IntakeRejection('FILE_LIMIT', 'VALIDATION');
            return end;
          };
          if (query.previous === true) {
            let start = 0;
            while (pageEnd(start) < offset) start = pageEnd(start);
            if (pageEnd(start) !== offset) throw new IntakeRejection('MATERIAL_CHANGED');
            offset = start;
          }
          const end = pageEnd(offset);
          for (const record of records.slice(offset, end)) {
            switch (record.collection) {
              case 'entries': page.entries.push(record.value); break;
              case 'differences': page.differences.push(record.value); break;
              case 'sopFlows': page.sopFlows.push(record.value); break;
              case 'sopDifferences': page.sopDifferences.push(record.value); break;
            }
          }
          page.nextCursor = end < total ? `${end}.${sign(end)}` : null;
          return parseContractSchema('IntakeCandidatePage', page);
        }
        const end = offset + Number(limit);
        return parseContractSchema('IntakeCandidatePage', { key: view.key, entries: entries.slice(offset, end), differences: differences.slice(offset, end), materialHeader,
          nextCursor: end < total ? `${end}.${sign(end)}` : null });
      }, v => parseContractSchema('IntakeCandidatePage', v));
    },
  };
}
