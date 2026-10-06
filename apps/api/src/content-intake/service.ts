import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { createParseRunner } from '@customer-agent/content-intake/runner';
import { INTAKE_POLICY, TEMPLATE_VERSION, isParseResult, type ParseResult } from '@customer-agent/content-intake';
import type { AuthenticatedUser } from '../auth-service.js';
import type { ContentObjectStore } from '../content-object-store.js';
import type { CanonicalJsonValue } from '../idempotency.js';
import { createIntakeTransactions, IntakeRejection, type IntakePool, type IntakeResult } from './transaction.js';
import { authorize, changeGrant, createGrants, source } from './authority.js';
import { cancelCandidate, freezeParsed, getJob, jobView, readCandidate, receive } from './candidate.js';
import { digest } from './material.js';
import type { ApprovalAdapter } from './approval-adapter.js';
import { createIntakeEvidence } from './evidence.js';

type C = components['schemas'];
const operation = (value: unknown): string | null => typeof value === 'object' && value !== null
  && typeof Reflect.get(value, 'operationId') === 'string' ? Reflect.get(value, 'operationId') as string : null;
const json = (value: unknown): CanonicalJsonValue => value as CanonicalJsonValue;

/** P2 preview transaction slice. No production factory/HTTP registration is provided.
 * The authenticated actor comes from product-auth, never from a request body's userId.
 * The existing object store and isolated parser are the only file consumers. */
export function createContentIntakeService(pool: IntakePool, store: ContentObjectStore,
  report: (diagnosticId: string, error: unknown) => void = () => undefined, approval?: ApprovalAdapter) {
  const run = createIntakeTransactions(pool, report);
  const runner = createParseRunner();
  const grantList = (v: unknown) => parseContractSchema('IntakeGrantList', v);
  const grant = (v: unknown) => parseContractSchema('IntakeGrant', v);
  const candidate = (v: unknown) => parseContractSchema('IntakeCandidate', v);
  const job = (v: unknown) => parseContractSchema('IntakeParseJob', v);

  /** Worker-only terminal bookkeeping must still finish after user permission expires.
   * It cannot create a candidate, alter a terminal job or grant any authority. */
  async function finishFailure(jobId: string, result: ParseResult): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(result));
    const stored = await store.persist((async function* () { yield bytes; })(), 'csv', { maxBytes: INTAKE_POLICY.outputBytes });
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
      await client.query('SELECT backend_review.lock_content()');
      await client.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
        SELECT $2,j.source_id,j.actor_id,p.tenant_id,p.app_id,$3,$4,$5,'application/json','report',clock_timestamp()
        FROM content_intake.parse_jobs j JOIN content_intake.principals p ON p.principal_id=j.actor_id
        WHERE j.job_id=$1 AND j.state='parsing'`, [jobId, stored.objectId, `intake/${stored.objectId}`, stored.sha256, stored.sizeBytes]);
      await client.query(`UPDATE content_intake.parse_jobs SET state=$3,finished_at=clock_timestamp(),report_object_id=$2
        WHERE job_id=$1 AND state='parsing'`, [jobId, stored.objectId, result.issues.some(i => i.code === 'CANCELLED') ? 'cancelled' : 'failed']);
      await client.query('COMMIT');
    } catch (error) {
      broken = true;
      try { await client.query('ROLLBACK'); } catch { /* Preserve original error; discard connection. */ }
      throw error;
    } finally { client.release(broken); }
    // Retain objects on uncertain outcomes. Retention/reclaim is an independent workflow.
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
    if (!prepared.ok) return prepared;
    if ('candidate' in prepared.value) return { ok: true, value: prepared.value.candidate };
    let parsed: ParseResult;
    try {
      const bytes = await store.readPayload(prepared.value.job.object_id);
      if (bytes.length !== Number(prepared.value.object.bytes) || digest(bytes) !== prepared.value.object.sha256) throw new Error('OBJECT_CHANGED');
      const scope = prepared.value.source.scope;
      parsed = (await runner.parse(bytes, { sourceId: scope.sourceId, brandId: scope.brandId, scope: scope.shopId ?? 'brand',
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
      try { await finishFailure(id, failure); } catch (error) {
        const diagnosticId = `intake_${randomUUID()}`;
        try { report(diagnosticId, error); } catch { /* Observational. */ }
        return { ok: false, code: 'OVERLOADED', reason: 'COMMIT_UNKNOWN', commit: 'unknown', diagnosticId };
      }
    }
    return frozen;
  }

  return {
    ...createIntakeEvidence(run, store, approval, report),
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
    cancel(actor: AuthenticatedUser, raw: unknown) {
      return run(actor, 'cancel', json(raw), operation(raw),
        (client, who) => cancelCandidate(client, who, parseContractSchema('IntakeCancel', raw)), candidate);
    },
    async job(actor: AuthenticatedUser, id: string): Promise<IntakeResult<C['IntakeParseJob']>> {
      const state = await run(actor, 'job', null, null, async (client, who) => {
        const view = jobView((await getJob(client, who, parseContractSchema('IntakeId', id))).job);
        const objects = await client.query<{ sha256: string; bytes: string }>(
          "SELECT sha256,bytes FROM content_intake.objects WHERE object_id=$1 AND purpose='report'", [view.reportObjectId]);
        return { view, report: objects.rows[0] ?? null };
      }, v => v as { view: C['IntakeParseJob']; report: { sha256: string; bytes: string } | null });
      if (!state.ok) return state;
      const view = state.value.view;
      if (view.reportObjectId === null) return { ok: true, value: view };
      try {
        const bytes = await store.readPayload(view.reportObjectId);
        if (!state.value.report || digest(bytes) !== state.value.report.sha256 || bytes.length !== Number(state.value.report.bytes)) throw new Error('REPORT_CHANGED');
        const parsed: unknown = JSON.parse(bytes.toString());
        if (!isParseResult(parsed)) throw new Error('INVALID_REPORT');
        return { ok: true, value: job({ ...view,
          issues: jobView({ job_id: id, generation: '1', state: 'failed', result_candidate_id: null,
            result_candidate_version: null, report_object_id: view.reportObjectId }, parsed).issues,
          totalIssues: parsed.issues.length, excludedSheetCount: parsed.excluded.length,
          excludedMediaCount: parsed.excluded.reduce((sum, x) => sum + x.images, 0) }) };
      } catch (error) {
        const diagnosticId = `intake_${randomUUID()}`;
        try { report(diagnosticId, error); } catch { /* Observational. */ }
        return { ok: false, code: 'INTERNAL_ERROR', reason: 'FILE_INVALID', commit: 'rolled_back', diagnosticId };
      }
    },
    async parse(actor: AuthenticatedUser, id: string, signal?: AbortSignal): Promise<IntakeResult<C['IntakeCandidate']>> {
      if (parseActive) return { ok: false, code: 'OVERLOADED', reason: 'QUOTA_EXCEEDED', commit: 'rolled_back', diagnosticId: `intake_${randomUUID()}` };
      parseActive = true;
      try { return await executeParse(actor, id, signal); } finally { parseActive = false; }
    },
  };
}
