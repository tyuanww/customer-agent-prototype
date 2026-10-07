import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { createParseRunner } from '@customer-agent/content-intake/runner';
import { INTAKE_POLICY, TEMPLATE_VERSION, type ParseResult } from '@customer-agent/content-intake';
import type { AuthenticatedUser } from '../auth-service.js';
import { authenticatedProductSession } from '../product-auth-service.js';
import type { ContentObjectStore, PersistedContentObject } from '../content-object-store.js';
import type { CanonicalJsonValue } from '../idempotency.js';
import { createIntakeTransactions, IntakeRejection, type IntakePool, type IntakeResult } from './transaction.js';
import { authorize, changeGrant, createGrants, source } from './authority.js';
import { cancelCandidate, cancellationReceipt, freezeParsed, getJob, readCandidate, receive } from './candidate.js';
import { digest } from './material.js';
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

/** P2 preview transaction slice. No production factory/HTTP registration is provided.
 * The authenticated actor comes from product-auth, never from a request body's userId.
 * The existing object store and isolated parser are the only file consumers. */
export function createContentIntakeService(pool: IntakePool, store: ContentObjectStore,
  report: (diagnosticId: string, error: unknown) => void = () => undefined, approval?: ApprovalAdapter,
  options: { requireProductSession?: boolean; principalLabels?: IntakePrincipalLabels } = {}) {
  const run = createIntakeTransactions(pool, report, options);
  const runner = createParseRunner();
  const grantList = (v: unknown) => parseContractSchema('IntakeGrantList', v);
  const grant = (v: unknown) => parseContractSchema('IntakeGrant', v);
  const candidate = (v: unknown) => parseContractSchema('IntakeCandidate', v);
  const job = (v: unknown) => parseContractSchema('IntakeParseJob', v);
  const { refreshForPublish, ...evidence } = createIntakeEvidence(run, store, approval, report);

  /** Worker-only terminal bookkeeping must still finish after user permission expires.
   * It cannot create a candidate, alter a terminal job or grant any authority. */
  async function finishFailure(jobId: string, result: ParseResult, actorUserId: string): Promise<void> {
    const client = await pool.connect();
    let broken = false;
    let committing = false;
    let reclaim = false;
    let stored: PersistedContentObject | undefined;
    try {
      // A permanent receive receipt can refer to a terminal job. Avoid creating
      // another report on replay; the locked INSERT below also handles races.
      const pending = await client.query(`SELECT 1 FROM content_intake.parse_jobs j
        JOIN content_intake.principals p ON p.principal_id=j.actor_id
        WHERE j.job_id=$1 AND p.user_id=$2 AND j.state IN ('reading','parsing')`, [jobId, actorUserId]);
      if (pending.rowCount !== 1) return;
      const bytes = Buffer.from(JSON.stringify(result));
      // No transaction or DB lock is held while persisting the report.
      stored = await store.persist((async function* () { yield bytes; })(), 'csv', { maxBytes: INTAKE_POLICY.outputBytes });
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
      await client.query('SELECT backend_review.lock_content()');
      const inserted = await client.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
        SELECT $2,j.source_id,j.actor_id,p.tenant_id,p.app_id,$3,$4,$5,'application/json','report',clock_timestamp()
        FROM content_intake.parse_jobs j JOIN content_intake.principals p ON p.principal_id=j.actor_id
        WHERE j.job_id=$1 AND j.state IN ('reading','parsing') AND p.user_id=$6`,
      [jobId, stored.objectId, `intake/${stored.objectId}`, stored.sha256, stored.sizeBytes, actorUserId]);
      await client.query(`UPDATE content_intake.parse_jobs SET state=$3,finished_at=clock_timestamp(),report_object_id=$2
        WHERE job_id=$1 AND state IN ('reading','parsing') AND EXISTS
          (SELECT 1 FROM content_intake.objects WHERE object_id=$2)`,
      [jobId, stored.objectId, result.issues.some(i => i.code === 'CANCELLED') ? 'cancelled' : 'failed']);
      committing = true;
      await client.query('COMMIT');
      reclaim = inserted.rowCount === 0;
    } catch (error) {
      broken = true;
      if (!committing) {
        try { await client.query('ROLLBACK'); reclaim = true; }
        catch { /* Unknown rollback: retain the object and discard this connection. */ }
      }
      throw error;
    } finally {
      client.release(broken);
      if (stored && reclaim) {
        try { await store.reclaim(stored.objectId); }
        catch (error) { try { report(`intake_${randomUUID()}`, error); } catch { /* Observational. */ } }
      }
    }
    // Unknown commits retain their objects; reclamation needs an independent reconciliation.
  }

  let parseActive = false;
  async function executeParse(actor: AuthenticatedUser, id: string, signal?: AbortSignal): Promise<IntakeResult<C['IntakeCandidate']>> {
    // Reserve once, then release all database locks before object I/O and parsing.
    const prepared = await run(actor, 'parse-start', null, null, async (client, who) => {
      const { job: j, src } = await getJob(client, who, parseContractSchema('IntakeId', id));
      if (j.actor_id !== who.id) throw new IntakeRejection('MATERIAL_CHANGED');
      if (j.state === 'validated') return { candidate: await readCandidate(client, who, j.result_candidate_id!, Number(j.result_candidate_version), 'import') };
      if (j.state !== 'reading' && j.state !== 'parsing') throw new IntakeRejection('MATERIAL_CHANGED');
      if (src.templateVersion !== TEMPLATE_VERSION || src.ruleVersion !== INTAKE_POLICY.version) throw new IntakeRejection('TEMPLATE_VERSION', 'VALIDATION');
      const objects = await client.query<{ sha256: string; bytes: string }>('SELECT sha256,bytes FROM content_intake.objects WHERE object_id=$1', [j.object_id]);
      await client.query("UPDATE content_intake.parse_jobs SET state='parsing' WHERE job_id=$1", [id]);
      return { job: j, source: src, object: objects.rows[0]! };
    }, v => v as { candidate: C['IntakeCandidate'] } | { job: import('./candidate.js').Job; source: import('./authority.js').Source; object: { sha256: string; bytes: string } });
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
    if ('candidate' in prepared.value) return { ok: true, value: prepared.value.candidate };
    let parsed: ParseResult;
    try {
      const bytes = await store.readPayload(prepared.value.job.object_id);
      if (bytes.length !== Number(prepared.value.object.bytes) || digest(bytes) !== prepared.value.object.sha256) throw new Error('OBJECT_CHANGED');
      const scope = prepared.value.source.scope;
      parsed = (await runner.parse(bytes, { sourceId: scope.sourceId, brandId: scope.brandId, scope: scope.shopId ?? 'brand',
        scopeKind: scope.shopId === null ? 'brand' : 'shop',
        domain: scope.domain, sheet: 'FAQ', templateVersion: TEMPLATE_VERSION }, signal ? { signal } : {})).result;
    } catch {
      parsed = { ok: false, policyVersion: INTAKE_POLICY.version, rows: [], questions: [], excluded: [], expandedBytes: 0, mediaCount: 0,
        issues: [{ code: 'OBJECT_UNAVAILABLE', sheet: '', row: 0, column: '', fix: '对象不可读取或指纹变化，请重新上传' }] };
    }
    const frozen = parsed.ok ? await run(actor, 'freeze', null, null, async (client, who) => {
      const { job: j, src } = await getJob(client, who, id);
      if (j.state === 'validated') return readCandidate(client, who, j.result_candidate_id!, Number(j.result_candidate_version), 'import');
      return freezeParsed(client, who, j, src, parsed);
    }, candidate) : { ok: false as const, code: 'VALIDATION' as const, reason: 'FILE_INVALID' as const,
      commit: 'rolled_back' as const, diagnosticId: `intake_${randomUUID()}` };
    if (!frozen.ok && frozen.commit !== 'unknown') {
      const failure = parsed.ok ? { ...parsed, ok: false, rows: [], questions: [],
        issues: [{ code: frozen.reason, sheet: '', row: 0, column: '', fix: '刷新权限、来源和候选后重新接收文件' }] } : parsed;
      try { await finishFailure(id, failure, actor.user_id); } catch (error) {
        const diagnosticId = `intake_${randomUUID()}`;
        try { report(diagnosticId, error); } catch { /* Observational. */ }
        return { ok: false, code: 'OVERLOADED', reason: 'COMMIT_UNKNOWN', commit: 'unknown', diagnosticId };
      }
    }
    return frozen;
  }

  return {
    ...evidence,
    ...createIntakeRollback(run, store, approval, report),
    ...createIntakePublication(run, refreshForPublish),
    ...createIntakeUsage(run),
    ...createIntakeDiscovery(run, options.principalLabels),
    ...createIntakeQualityAccess(run),
    ...createIntakeFiles(run, store, report),
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
        (client, who) => cancelCandidate(client, who, parseContractSchema('IntakeCancel', raw)), candidate);
      return result.ok ? { ok: true as const, value: cancellationReceipt(operation(raw)!, result.value) } : result;
    },
    async parse(actor: AuthenticatedUser, id: string, signal?: AbortSignal): Promise<IntakeResult<C['IntakeCandidate']>> {
      if (parseActive) return { ok: false, code: 'OVERLOADED', reason: 'QUOTA_EXCEEDED', commit: 'rolled_back', diagnosticId: `intake_${randomUUID()}` };
      parseActive = true;
      try { return await executeParse(actor, id, signal); } finally { parseActive = false; }
    },
  };
}
