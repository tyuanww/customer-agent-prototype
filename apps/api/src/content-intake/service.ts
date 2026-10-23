import { createIntakeShopDirectory } from './shop-directory.js';
import { createIntakeCapacity } from './capacity.js';
import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { createParseRunner } from '@customer-agent/content-intake/runner';
import { adoptPreviews, cancelPreviewsAtVersion, discardPreviewRow, previewFromBytes, stagePreviews } from './linked-preview.js';
import { INTAKE_POLICY, CSV_POLICY_VERSION, failedParse, tryParseSopAsFaq, type ParseResult } from '@customer-agent/content-intake';
import type { AuthenticatedUser } from '../auth-service.js';
import { authenticatedProductSession } from '../product-auth-service.js';
import type { ContentObjectStore, ContentAttachmentStore, PersistedContentObject } from '../content-object-store.js';
import type { CanonicalJsonValue } from '../idempotency.js';
import { createIntakeTransactions, IntakeRejection, type IntakePool, type IntakeResult } from './transaction.js';
import { authorize, changeGrant, createGrants, previewGrants, source } from './authority.js';
import { cancelCandidate, cancellationReceipt, historicalCandidate, freezeParsed, getJob, readCandidate, receive } from './candidate.js';
import { digest } from './material.js';
import { sourceInputFormat } from './input-format.js';
import { sourceUsesSopWorkbook } from './sop-source.js';
import { freezeSopParsed, readSopInheritedAssets, sopContentVersion, type MediaItem } from './sop-freeze.js';
import { createSopMediaLifecycle } from './sop-media.js';
import { createReleasePreviewReader } from './sop-preview.js';
import type { ApprovalAdapter } from './approval-adapter.js';
import { createIntakeEvidence } from './evidence.js';
import { createIntakeRollback } from './rollback.js';
import { createIntakePublication } from './publication.js';
import { createIntakeUsage } from './usage.js';
import { createIntakeDiscovery, type IntakePrincipalLabels } from './discovery.js';
import { createIntakeQualityAccess } from './quality-access.js';
import { createIntakeFiles } from './files.js';
import { checkQuality, freezeQuality, previewQuality, qualityCommand, qualitySubmission, readQuality,
  type IntakeQualityPreview, type IntakeQualityProgress } from './quality.js';

type C = components['schemas'];
const operation = (value: unknown): string | null => typeof value === 'object' && value !== null
  && typeof Reflect.get(value, 'operationId') === 'string' ? Reflect.get(value, 'operationId') as string : null;
const json = (value: unknown): CanonicalJsonValue => value as CanonicalJsonValue;

/** SOP images are durable reservations; a store without the attachment lock
 * cannot publish them at all, so the caller fails closed instead of freezing a
 * text-only candidate that a later publish would refuse. */
const isAttachmentStore = (store: ContentObjectStore & Partial<ContentAttachmentStore>): store is ContentAttachmentStore =>
  typeof store.withObjectLock === 'function' && typeof store.persistAttachment === 'function'
  && typeof store.readAttachment === 'function';

/** P2 preview transaction slice. No production factory/HTTP registration is provided.
 * The authenticated actor comes from product-auth, never from a request body's userId.
 * The existing object store and isolated parser are the only file consumers.
 * The old transport argument is retained for internal caller compatibility only;
 * this direct profile never calls it and cannot enable approval writes. */
export function createContentIntakeService(pool: IntakePool, store: ContentObjectStore & Partial<ContentAttachmentStore>,
  report: (diagnosticId: string, error: unknown) => void = () => undefined, _legacyApproval?: ApprovalAdapter,
  options: { requireProductSession?: boolean; principalLabels?: IntakePrincipalLabels; terminalPool?: IntakePool } = {}) {
  const run = createIntakeTransactions(pool, report, options);
  const runner = createParseRunner();
  const reportCapacityError = (error: unknown) => {
    try { report(`intake_${randomUUID()}`, error); } catch { /* Observational. */ }
  };
  const capacity = createIntakeCapacity(pool, store, reportCapacityError);
  // Failure bookkeeping may outlive the actor's authority. The caller owns both
  // pools; only this terminal path uses the optional worker capability.
  const terminalPool = options.terminalPool ?? pool;
  const terminalCapacity = options.terminalPool ? createIntakeCapacity(terminalPool, store, reportCapacityError) : capacity;
  const grantList = (v: unknown) => parseContractSchema('IntakeGrantList', v);
  const grant = (v: unknown) => parseContractSchema('IntakeGrant', v);
  const candidate = (v: unknown) => parseContractSchema('IntakeCandidate', v);
  const job = (v: unknown) => parseContractSchema('IntakeParseJob', v);
  const evidence = createIntakeEvidence(run);

  /** Worker-only terminal bookkeeping must still finish after user permission expires.
   * It cannot create a candidate, alter a terminal job or grant any authority. */
  async function finishFailure(jobId: string, result: ParseResult, actorUserId: string): Promise<boolean> {
    // Release the lookup connection before capacity admission borrows one. Even
    // a one-connection pool must finish terminal bookkeeping without deadlock.
    const lookup = await terminalPool.connect();
    let sourceId: string;
    try {
      const pending = await lookup.query<{ source_id: string }>(`SELECT j.source_id FROM content_intake.parse_jobs j
        JOIN content_intake.principals p ON p.principal_id=j.actor_id
        WHERE j.job_id=$1 AND p.user_id=$2 AND j.state IN ('reading','parsing')`, [jobId, actorUserId]);
      if (!pending.rows[0]) return true;
      sourceId = pending.rows[0].source_id;
    } finally { lookup.release(); }
    let stored: PersistedContentObject | undefined;
    const bytes = Buffer.from(JSON.stringify(result));
    try {
      stored = await terminalCapacity.persist(actorUserId, sourceId, 'report',
        (async function* () { yield bytes; })(), 'csv', Math.min(bytes.length, INTAKE_POLICY.outputBytes));
    } catch (error) {
      // Quota cannot strand a failed/cancelled job in parsing and consume every
      // candidate slot. Only a definite admission refusal permits reportless
      // completion; unknown disk/DB outcomes stay protected and retryable.
      if (!(error instanceof IntakeRejection) || error.reason !== 'QUOTA_EXCEEDED') throw error;
    }
    let reclaim = false;
    let broken = false;
    let committing = false;
    const client = await terminalPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
      await client.query('SELECT backend_review.lock_content()');
      if (stored) {
        const inserted = await client.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
          SELECT $2,j.source_id,j.actor_id,p.tenant_id,p.app_id,$3,$4,$5,'application/json','report',clock_timestamp()
          FROM content_intake.parse_jobs j JOIN content_intake.principals p ON p.principal_id=j.actor_id
          WHERE j.job_id=$1 AND j.state IN ('reading','parsing') AND p.user_id=$6`,
        [jobId, stored.objectId, `intake/${stored.objectId}`, stored.sha256, stored.sizeBytes, actorUserId]);
        if (inserted.rowCount === 1) await terminalCapacity.adopt(client, stored);
        reclaim = inserted.rowCount === 0;
      }
      await client.query(`UPDATE content_intake.parse_jobs SET state=$3,finished_at=clock_timestamp(),report_object_id=$2
        WHERE job_id=$1 AND state IN ('reading','parsing') AND EXISTS
          (SELECT 1 FROM content_intake.principals WHERE principal_id=actor_id AND user_id=$4)`,
      [jobId, stored?.objectId ?? null, result.issues.some(i => i.code === 'CANCELLED') ? 'cancelled' : 'failed', actorUserId]);
      committing = true;
      await client.query('COMMIT');
    } catch (error) {
      broken = true;
      reclaim = false;
      if (!committing) {
        try { await client.query('ROLLBACK'); reclaim = true; }
        catch { /* Unknown rollback retains the object. */ }
      }
      throw error;
    } finally {
      client.release(broken);
      if (stored && reclaim) {
        try { await terminalCapacity.discard(stored.objectId); }
        catch (error) { try { report(`intake_${randomUUID()}`, error); } catch { /* Observational. */ } }
      }
    }
    return stored !== undefined;
  }

  // Only an uncertain freeze retains its exact parser generation. A later,
  // authorized read of the same durable job result confirms this handle, never
  // whichever stage currently occupies the shared object-id preview slot.
  const uncertainPreviews = new Map<string, { key: C['IntakeCandidateKey']; stage: ReturnType<typeof stagePreviews> }>();
  let parseActive = false;
  async function executeParse(actor: AuthenticatedUser, id: string, signal?: AbortSignal): Promise<IntakeResult<C['IntakeCandidate']>> {
    const pending = uncertainPreviews.get(id);
    // Reserve once, then release all database locks before object I/O and parsing.
    const prepared = await run(actor, 'parse-start', null, null, async (client, who) => {
      const { job: j, src } = await getJob(client, who, parseContractSchema('IntakeId', id));
      if (j.actor_id !== who.id) throw new IntakeRejection('MATERIAL_CHANGED');
      if (j.state === 'validated') return { candidate: await readCandidate(client, who, j.result_candidate_id!, Number(j.result_candidate_version), 'import') };
      if (j.state !== 'reading' && j.state !== 'parsing') throw new IntakeRejection('MATERIAL_CHANGED');
      if (src.version !== Number(j.source_version)) throw new IntakeRejection('SOURCE_MISMATCH');
      const format = sourceInputFormat(src);
      const objects = await client.query<{ sha256: string; bytes: string; mime: string }>('SELECT sha256,bytes,mime FROM content_intake.objects WHERE object_id=$1', [j.object_id]);
      if (objects.rows[0]?.mime !== format.mime) throw new IntakeRejection('SOURCE_FORMAT_MISMATCH', 'VALIDATION');
      await client.query("UPDATE content_intake.parse_jobs SET state='parsing' WHERE job_id=$1", [id]);
      return { job: j, source: src, object: objects.rows[0]! };
    }, v => v as { candidate: C['IntakeCandidate'] } | { job: import('./candidate.js').Job; source: import('./authority.js').Source; object: { sha256: string; bytes: string; mime: string } });
    if (!prepared.ok) {
      // A queued HTTP admission can lose its session before a worker starts.
      // Close only that actor's still-pending job; this grants no business write
      // authority. A fabricated/cloned DTO cannot trigger this worker cleanup.
      if (options.requireProductSession && authenticatedProductSession(actor) && prepared.commit === 'rolled_back') {
        try {
          await finishFailure(id, { ok: false, policyVersion: INTAKE_POLICY.version, rows: [], questions: [], excluded: [], expandedBytes: 0, mediaCount: 0,
            issues: [{ code: prepared.reason, sheet: '', row: 0, column: '', fix: '刷新权限和会话后重新接收文件' }] }, actor.user_id);
        } catch (error) { try { report(`intake_${randomUUID()}`, error); } catch { /* Observational. */ } }
      }
      return prepared;
    }
    if ('candidate' in prepared.value) {
      const recovered = prepared.value.candidate;
      if (pending) {
        if (pending.key.candidateId === recovered.key.candidateId && pending.key.version === recovered.key.version
          && pending.key.digest === recovered.key.digest && recovered.state !== 'cancelled') {
          pending.stage.commit(recovered.key.candidateId, recovered.key.version);
        } else pending.stage.rollback();
        if (uncertainPreviews.get(id) === pending) uncertainPreviews.delete(id);
      }
      return { ok: true, value: recovered };
    }
    // A locked read still in reading/parsing proves the earlier uncertain freeze
    // did not leave a durable result. Retire only the record this call observed.
    if (pending) {
      pending.stage.rollback();
      if (uncertainPreviews.get(id) === pending) uncertainPreviews.delete(id);
    }
    const previewKey = prepared.value.job.object_id;
    let previewStage: ReturnType<typeof stagePreviews> | undefined;
    let parsed: ParseResult;
    let sopPreviews: Awaited<ReturnType<typeof tryParseSopAsFaq>> extends infer Value ? Value extends { previews: infer Previews } ? Previews : never : never = [];
    let sopRows: NonNullable<Awaited<ReturnType<typeof tryParseSopAsFaq>>>['rowBindings'] = [];
    let sopVersion: unknown;
    let sopWorkbook = false;
    try {
      const bytes = await store.readPayload(prepared.value.job.object_id);
      if (bytes.length !== Number(prepared.value.object.bytes) || digest(bytes) !== prepared.value.object.sha256) throw new Error('OBJECT_CHANGED');
      const sourceId = prepared.value.source.scope.sourceId;
      const sopSource = sourceUsesSopWorkbook(prepared.value.source);
      const sop = sopSource ? await tryParseSopAsFaq(bytes, prepared.value.source.scope) : null;
      if (sop) {
        // A non-null result means the six sheets were found, so these rows carry a
        // workbook row map. When a sheet is missing, tryParseSopAsFaq returns null and
        // the registered SOP context makes the FAQ parser refuse the workbook.
        parsed = sop.parsed;
        sopPreviews = sop.previews;
        sopRows = sop.rowBindings;
        sopVersion = sop.contentVersion;
        sopWorkbook = true;
        previewStage = stagePreviews(prepared.value.job.object_id, sop.previews.map(item => previewFromBytes(item.bytes, item.mime, sourceId, item.rowId, {
          productRefIds: item.productRefIds, scenarioRefIds: item.scenarioRefIds, familySourceId: item.familySourceId,
        })));
      } else {
        parsed = (await runner.parse(bytes, sourceInputFormat(prepared.value.source).context, signal ? { signal } : {})).result;
      }
    } catch {
      parsed = { ...failedParse('OBJECT_UNAVAILABLE', prepared.value.source.ruleVersion === CSV_POLICY_VERSION ? CSV_POLICY_VERSION : INTAKE_POLICY.version),
        issues: [{ code: 'OBJECT_UNAVAILABLE', sheet: '', row: 0, column: '', fix: '对象不可读取或指纹变化，请重新上传' }] };
      sopWorkbook = false;
    }
    // Images are published by the same SQL capability as the candidate rows, so
    // every byte must already be a completed private reservation before freeze.
    // Persisting is idempotent per (job, exact bytes); a retry reuses the first
    // reservation instead of charging the source twice.
    let sopMedia: MediaItem[] = [];
    let sopLifecycle: ReturnType<typeof createSopMediaLifecycle> | undefined;
    const releaseSopMedia = async (lifecycle: ReturnType<typeof createSopMediaLifecycle>,
      who: AuthenticatedUser, jobId: string, sourceId: string, items: readonly MediaItem[]) => {
      for (const item of items) {
        try {
          await lifecycle.release(who, jobId, { objectId: item.payloadObjectId, mediaObjectId: item.mediaObjectId,
            sourceId, sha256: item.sha256, bytes: item.bytes,
            mime: item.mime as 'image/png' | 'image/jpeg' | 'image/gif', state: 'persisted' });
        } catch (error) { try { report(`intake_${randomUUID()}`, error); } catch { /* Observational. */ } }
      }
    };
    if (sopWorkbook && parsed.ok && sopPreviews.length) {
      if (!isAttachmentStore(store)) { previewStage?.rollback(); return { ok: false, code: 'VALIDATION', reason: 'FILE_INVALID',
        commit: 'rolled_back', diagnosticId: `intake_${randomUUID()}` }; }
      if (!previewStage) previewStage = stagePreviews(previewKey, []);
      const lifecycle = sopLifecycle = createSopMediaLifecycle(run, store);
      const sourceId = prepared.value.source.scope.sourceId;
      try {
        for (const item of sopPreviews) {
          const persisted = await lifecycle.persist(actor, id, sourceId, item.bytes, item.mime);
          if (!persisted.ok) {
            if (persisted.commit === 'rolled_back') {
              previewStage.rollback();
              await releaseSopMedia(lifecycle, actor, id, sourceId, sopMedia);
            }
            return persisted;
          }
          sopMedia = [...sopMedia, { mediaObjectId: persisted.value.mediaObjectId, payloadObjectId: persisted.value.objectId,
            sha256: persisted.value.sha256, bytes: persisted.value.bytes, mime: persisted.value.mime,
            sheetName: item.sheet, rowNumber: item.row, columnNumber: item.column, ordinal: item.ordinal }];
        }
      } catch (error) {
        previewStage.rollback();
        const diagnosticId = `intake_${randomUUID()}`;
        try { report(diagnosticId, error); } catch { /* Observational. */ }
        return { ok: false, code: 'OVERLOADED', reason: 'COMMIT_UNKNOWN', commit: 'unknown', diagnosticId };
      }
    }
    let frozenKey: C['IntakeCandidateKey'] | undefined;
    const frozen = parsed.ok ? await run(actor, 'freeze', null, null, async (client, who) => {
      const { job: j, src } = await getJob(client, who, id);
      if (j.state === 'validated') {
        const existing = await readCandidate(client, who, j.result_candidate_id!, Number(j.result_candidate_version), 'import');
        frozenKey = existing.key; return existing;
      }
      const candidate = sopWorkbook
        ? await freezeSopParsed(client, who, j, src, parsed, sopContentVersion(sopVersion), sopRows,
            await readSopInheritedAssets(client, who, j.job_id), sopMedia)
        : await freezeParsed(client, who, j, src, parsed);
      frozenKey = candidate.key;
      return candidate;
    }, candidate) : { ok: false as const, code: 'VALIDATION' as const, reason: 'FILE_INVALID' as const,
      commit: 'rolled_back' as const, diagnosticId: `intake_${randomUUID()}` };
    if (!frozen.ok && frozen.commit === 'unknown' && previewStage && frozenKey) {
      uncertainPreviews.set(id, { key: frozenKey, stage: previewStage });
    }
    if (!frozen.ok && frozen.commit === 'rolled_back') {
      previewStage?.rollback();
      // The bytes are already durable, so a definite rollback has to give them and
      // the quota back. An unknown outcome keeps them, because freeze may have
      // committed and only SQL can tell.
      if (sopLifecycle) await releaseSopMedia(sopLifecycle, actor, id, prepared.value.source.scope.sourceId, sopMedia);
      if (uncertainPreviews.get(id)?.stage === previewStage) uncertainPreviews.delete(id);
    }
    if (!frozen.ok && frozen.commit !== 'unknown') {
      const failure = parsed.ok ? { ...parsed, ok: false, rows: [], questions: [],
        issues: [{ code: frozen.reason, sheet: '', row: 0, column: '', fix: '刷新权限、来源和候选后重新接收文件' }] } : parsed;
      try {
        if (!await finishFailure(id, failure, actor.user_id)) return { ok: false, code: 'RATE_LIMITED',
          reason: 'QUOTA_EXCEEDED', commit: 'rolled_back', diagnosticId: `intake_${randomUUID()}` };
      } catch (error) {
        const diagnosticId = `intake_${randomUUID()}`;
        try { report(diagnosticId, error); } catch { /* Observational. */ }
        return { ok: false, code: 'OVERLOADED', reason: 'COMMIT_UNKNOWN', commit: 'unknown', diagnosticId };
      }
    }
    if (frozen.ok) {
      if (previewStage) previewStage.commit(frozen.value.key.candidateId, frozen.value.key.version);
      else adoptPreviews(previewKey, frozen.value.key.candidateId, frozen.value.key.version);
      if (uncertainPreviews.get(id)?.stage === previewStage) uncertainPreviews.delete(id);
    }
    return frozen;
  }

  return {
    ...evidence,
    ...createIntakeRollback(run),
    ...createIntakePublication(run),
    ...createIntakeUsage(run, createReleasePreviewReader(store)),
    ...createIntakeShopDirectory(run),
    ...createIntakeDiscovery(run, options.principalLabels),
    ...createIntakeQualityAccess(run),
    ...createIntakeFiles(run, store, capacity, report),
    qualityPreview(actor: AuthenticatedUser, key: unknown) {
      return run(actor, 'quality-preview', null, null,
        (client, who) => previewQuality(client, who, key), value => value as IntakeQualityPreview);
    },
    quality(actor: AuthenticatedUser, key: unknown) {
      return run(actor, 'quality', null, null, (client, who) => readQuality(client, who, key), value => value as IntakeQualityProgress);
    },
    freezeQuality(actor: AuthenticatedUser, raw: unknown) {
      return run(actor, 'quality-freeze', json(raw), operation(raw),
        (client, who) => freezeQuality(client, who, qualityCommand(raw)), value => value as IntakeQualityProgress);
    },
    checkQuality(actor: AuthenticatedUser, raw: unknown) {
      return run(actor, 'quality-check', json(raw), operation(raw),
        (client, who) => checkQuality(client, who, qualitySubmission(raw)), value => value as IntakeQualityProgress);
    },
    previewGrants(actor: AuthenticatedUser, raw: unknown) {
      return run(actor, 'grant-preview', null, null,
        (client, who) => previewGrants(client, who, parseContractSchema('IntakeGrantBatch', raw)), grantList);
    },
    grantBatch(actor: AuthenticatedUser, raw: unknown) {
      return run(actor, 'grants', json(raw), operation(raw),
        (client, who) => createGrants(client, who, parseContractSchema('IntakeGrantBatch', raw)), grantList);
    },
    changeGrant(actor: AuthenticatedUser, id: string, raw: unknown) {
      return run(actor, 'grant-change', { id, body: json(raw) }, operation(raw),
        (client, who) => changeGrant(client, who, parseContractSchema('IntakeId', id), parseContractSchema('IntakeGrantChange', raw)), grant);
    },
    authorization(actor: AuthenticatedUser, sourceId: string, action: C['IntakeAction']) {
      return run(actor, 'authorization', null, null, async (client, who) => {
        const src = await source(client, parseContractSchema('IntakeId', sourceId));
        const until = await authorize(client, who, parseContractSchema('IntakeAction', action), src);
        return { sourceId, action, validUntil: new Date(until).toISOString(), factsVersion: who.factsVersion, revocationGeneration: who.generation };
      }, value => value as { sourceId: string; action: C['IntakeAction']; validUntil: string; factsVersion: number; revocationGeneration: number });
    },
    receive(actor: AuthenticatedUser, sourceId: string, raw: unknown) {
      return run(actor, 'receive', { sourceId, body: json(raw) }, operation(raw),
        (client, who) => receive(client, who, parseContractSchema('IntakeId', sourceId), parseContractSchema('IntakeReceive', raw)), job);
    },
    candidate(actor: AuthenticatedUser, id: string, version: number) {
      return run(actor, 'candidate', null, null, (client, who) => readCandidate(client, who,
        parseContractSchema('IntakeId', id), parseContractSchema('IntakeVersion', version)), candidate);
    },
    async cancel(actor: AuthenticatedUser, raw: unknown) {
      const result = await run(actor, 'cancel', json(raw), operation(raw),
        (client, who) => cancelCandidate(client, who, parseContractSchema('IntakeCancel', raw)), historicalCandidate);
      if (!result.ok) return result;
      cancelPreviewsAtVersion(result.value.key.candidateId, result.value.key.version);
      return { ok: true as const, value: cancellationReceipt(operation(raw)!, result.value) };
    },
    async deleteUnusedSopRow(actor: AuthenticatedUser, candidateId: string, candidateVersion: number, rowId: string) {
      const result = await run(actor, 'delete-unused-sop-row', { candidateId, candidateVersion, rowId }, null, async (client, who) => {
        parseContractSchema('IntakeId', candidateId);
        if (!Number.isInteger(candidateVersion) || candidateVersion < 1) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        if (!/^sop:[^:]{1,128}:[1-9][0-9]{0,3}$/.test(rowId)) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        const found = await client.query<{ source_id: string }>(
          'SELECT source_id FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2',
          [candidateId, candidateVersion]);
        const sourceId = found.rows[0]?.source_id;
        if (!sourceId) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
        await authorize(client, who, 'candidate-cancel', await source(client, sourceId));
        try {
          await client.query('SELECT content_intake.delete_unused_sop_row($1,$2,$3)', [candidateId, candidateVersion, rowId]);
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (message.includes('SOP_ROW_NOT_FOUND')) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
          if (message.includes('SOP_ROW_IN_USE')) throw new IntakeRejection('ALREADY_PUBLISHED');
          throw error;
        }
        return { candidateId, rowId };
      }, (value: unknown) => {
        const removed = value as { candidateId: string; rowId: string };
        return removed;
      });
      if (!result.ok) return result;
      discardPreviewRow(result.value.candidateId, result.value.rowId);
      return { ok: true as const, value: undefined };
    },
    async parse(actor: AuthenticatedUser, id: string, signal?: AbortSignal): Promise<IntakeResult<C['IntakeCandidate']>> {
      if (parseActive) return { ok: false, code: 'OVERLOADED', reason: 'QUOTA_EXCEEDED', commit: 'rolled_back', diagnosticId: `intake_${randomUUID()}` };
      parseActive = true;
      try { return await executeParse(actor, id, signal); } finally { parseActive = false; }
    },
  };
}
