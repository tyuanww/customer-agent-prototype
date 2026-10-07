import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { INTAKE_POLICY } from '@customer-agent/content-intake';
import type { AuthenticatedUser } from '../auth-service.js';
import type { ContentObjectStore } from '../content-object-store.js';
import type { CanonicalJsonValue } from '../idempotency.js';
import { candidateContext, syncCandidateReadiness } from './candidate.js';
import { canonical, digest } from './material.js';
import { clock, createIntakeTransactions, intakeReplay, IntakeRejection, type IntakeResult, type IntakeTransaction } from './transaction.js';
import type { ApprovalAdapter, CandidateReviewBinding as ReviewBinding } from './approval-adapter.js';
import { historicalReviewer } from './reviewer.js';

type C = components['schemas'];
type Run = ReturnType<typeof createIntakeTransactions>;
const json = (v: unknown) => v as CanonicalJsonValue;
const review = (v: unknown) => parseContractSchema('IntakeReview', v);
type Facts = { facts_version: string; revocation_generation: string; state: 'pending' | 'approved' | 'rejected' | 'revoked';
  checked_at: Date; valid_until: Date; reviewer_id: string | null; human_task_id: string | null; decided_at: Date | null };

async function binding(client: IntakeTransaction, id: string): Promise<ReviewBinding> {
  const rows = await client.query<{ value: unknown }>(`SELECT jsonb_build_object('reviewRequestId',r.review_request_id,
    'key',jsonb_build_object('candidateId',r.candidate_id,'version',r.candidate_version,'digest',r.candidate_digest),
    'evidenceVersion',r.evidence_version,'tenantId',r.tenant_id,'appId',r.app_id,'definitionId',r.definition_id,
    'nodeId',r.node_id,'createUuid',r.create_uuid,'packageObjectId',r.package_object_id,'packageSha256',r.package_sha256,
    'packageBytes',o.bytes,'createdAt',o.received_at,'instanceCode',r.instance_code,'attachmentFileCode',r.attachment_file_code) AS value
    FROM content_intake.review_bindings r JOIN content_intake.objects o ON o.object_id=r.package_object_id WHERE review_request_id=$1`, [id]);
  if (!rows.rows[0]) throw new IntakeRejection('SCOPE_DENIED', 'NOT_FOUND');
  return rows.rows[0].value as ReviewBinding;
}
async function facts(client: IntakeTransaction, b: ReviewBinding): Promise<Facts | null> {
  const rows = await client.query<Facts>(`SELECT f.* FROM content_intake.approval_current p JOIN content_intake.approval_facts f
    ON f.review_request_id=p.review_request_id AND f.facts_version=p.facts_version WHERE p.review_request_id=$1`, [b.reviewRequestId]);
  return rows.rows[0] ?? null;
}
async function reviewView(client: IntakeTransaction, b: ReviewBinding): Promise<C['IntakeReview']> {
  const f = await facts(client, b);
  const now = await clock(client);
  let state: C['IntakeReview']['state'] = 'unavailable';
  if (!b.instanceCode) state='creating';
  else if (f?.state === 'revoked') state='revoked';
  else if (f && f.checked_at.getTime()<=now && now<f.valid_until.getTime()) state=f.state;
  return review({ key: b.key, reviewRequestId: b.reviewRequestId, instanceCode: b.instanceCode, evidenceVersion: b.evidenceVersion,
    revocationGeneration: Number(f?.revocation_generation ?? 0),state,
    checkedAt: f?.checked_at.toISOString() ?? null, validUntil: f?.valid_until.toISOString() ?? null,
    reviewPackageObjectId: b.packageObjectId, reviewPackageSha256: b.packageSha256 });
}
async function currentBinding(client: IntakeTransaction, key: C['IntakeCandidateKey'], version: number): Promise<ReviewBinding> {
  const rows = await client.query<{ review_request_id: string }>(`SELECT review_request_id FROM content_intake.review_bindings
    WHERE candidate_id=$1 AND candidate_version=$2 AND candidate_digest=$3 AND evidence_version=$4`, [key.candidateId,key.version,key.digest,version]);
  if (!rows.rows[0]) throw new IntakeRejection('AWAITING_APPROVAL');
  return binding(client, rows.rows[0].review_request_id);
}

/** Owns immutable source/review evidence and the lock-free provider lifecycle.
 * It never publishes, constructs legacy review assertions or opens a production connection.
 * A committed creation UUID is recovered before any retry can create another instance. */
export function createIntakeEvidence(run: Run, store: ContentObjectStore, adapter: ApprovalAdapter | undefined,
  report: (diagnosticId: string, error: unknown) => void) {
  function diagnostic(error: unknown): void {
    try { report(`intake_${randomUUID()}`, error); } catch { /* Diagnostics cannot alter evidence. */ }
  }
  async function failed<T>(actor: AuthenticatedUser, error: unknown, decode: (v: unknown) => T): Promise<IntakeResult<T>> {
    return run(actor, 'evidence-failure', null, null, async () => {
      throw error instanceof IntakeRejection ? error : new IntakeRejection('APPROVAL_UNAVAILABLE', 'OVERLOADED');
    }, decode);
  }
  async function refresh(actor: AuthenticatedUser, raw: unknown, action: 'content-manage' | 'publish'): Promise<IntakeResult<C['IntakeReview']>> {
    type Prepared = { req: C['IntakeReviewRequest']; reply: C['IntakeReview'] } | {
      req: C['IntakeReviewRequest']; binding: ReviewBinding; generation: number; factsVersion: number; checkedAt: string };
    const prepared = await run(actor,'review-refresh-prepare',null,null,async (client,who): Promise<Prepared> => {
      const req = parseContractSchema('IntakeReviewRequest',raw);
      const prior = await intakeReplay(client,who,'review-refresh',json(req),req.operationId,review);
      if (prior) return { req,reply:prior.value };
      if (!adapter) throw new IntakeRejection('APPROVAL_UNAVAILABLE','OVERLOADED');
      const c = await candidateContext(client,who,req.key,action);
      if (!['awaiting-evidence','ready','published'].includes(c.view.state)) throw new IntakeRejection('MATERIAL_CHANGED');
      if (c.view.approvalEvidenceVersion !== req.expectedEvidenceVersion) throw new IntakeRejection('APPROVAL_CHANGED');
      const b = await currentBinding(client,req.key,req.expectedEvidenceVersion);
      return { req,binding:b,generation:c.view.revocationGeneration,factsVersion:Number((await facts(client,b))?.facts_version ?? 0),
        checkedAt:new Date(await clock(client)).toISOString() };
    },v => v as Prepared);
    if (!prepared.ok) return prepared;
    if ('reply' in prepared.value) return { ok:true,value:prepared.value.reply };
    const { req,binding:b,generation,factsVersion,checkedAt } = prepared.value;
    try {
      const observation = await adapter!.observe(b);
      return run(actor,'review-refresh',json(req),req.operationId,async (client,who) => {
        const c = await candidateContext(client,who,req.key,action);
        if (!['awaiting-evidence','ready','published'].includes(c.view.state)) throw new IntakeRejection('MATERIAL_CHANGED');
        if (c.view.approvalEvidenceVersion !== req.expectedEvidenceVersion || c.view.revocationGeneration !== generation) throw new IntakeRejection('APPROVAL_CHANGED');
        const previous = await facts(client,b);
        if (Number(previous?.facts_version ?? 0) !== factsVersion) throw new IntakeRejection('APPROVAL_CHANGED');
        if (previous?.state === 'revoked' && observation.state !== 'revoked') throw new IntakeRejection('APPROVAL_REVOKED');
        const until = Date.parse(checkedAt)+300_000;
        if (await clock(client) >= until) throw new IntakeRejection('APPROVAL_UNAVAILABLE');
        client.validUntil(until);
        // This package was registered under lock_content(), shared by authority
        // writers, without changing authority itself. Earlier role/grant history
        // therefore committed before this checkpoint; later grants need a new review.
        const reviewer = observation.human ? await historicalReviewer(client,c.src,c.material,observation.human,checkedAt,b.createdAt) : null;
        const invalidates = previous?.state === 'approved' && (observation.state !== 'approved' || previous.reviewer_id !== reviewer?.id
          || previous.human_task_id !== observation.human?.taskId || previous.decided_at?.toISOString() !== observation.human?.decidedAt);
        const revoked = observation.state === 'revoked' && previous?.state !== 'revoked';
        const nextGeneration = Number(previous?.revocation_generation ?? 0)+Number(invalidates || revoked);
        await client.query(`INSERT INTO content_intake.approval_facts(review_request_id,facts_version,revocation_generation,state,checked_at,
          valid_until,raw_facts_digest,package_verified_sha256,human_task_id,reviewer_id,reviewer_facts_version,decided_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [b.reviewRequestId,factsVersion+1,nextGeneration,observation.state,checkedAt,
          new Date(until).toISOString(),observation.rawDigest,observation.packageSha256,observation.human?.taskId ?? null,
          reviewer?.id ?? null,reviewer?.factsVersion ?? null,observation.human?.decidedAt ?? null]);
        await client.query(`INSERT INTO content_intake.approval_current VALUES ($1,$2)
          ON CONFLICT(review_request_id) DO UPDATE SET facts_version=excluded.facts_version`,[b.reviewRequestId,factsVersion+1]);
        await client.query(`UPDATE content_intake.candidate_versions SET revocation_generation=revocation_generation+1,
          updated_at=clock_timestamp() WHERE candidate_id=$1 AND version=$2`,[req.key.candidateId,req.key.version]);
        if (invalidates || revoked) await client.query(`INSERT INTO content_intake.release_revocations(release_id,generation,reason,revoked_at)
          SELECT release_id,$2::bigint,$3::text,clock_timestamp() FROM (
            SELECT release_id FROM content_intake.release_lineage WHERE review_request_id=$1
            UNION SELECT release_id FROM content_intake.release_rollback_lineage WHERE review_request_id=$1
          ) dependencies
          ON CONFLICT(release_id) DO NOTHING`,[b.reviewRequestId,nextGeneration,revoked ? 'APPROVAL_REVOKED' : 'APPROVAL_CHANGED']);
        await syncCandidateReadiness(client,who,req.key,action);
        return reviewView(client,b);
      },review);
    } catch (error) { diagnostic(error); return failed(actor,error,review); }
  }
  return {
    async confirmSource(actor: AuthenticatedUser, raw: unknown): Promise<IntakeResult<C['IntakeCandidate']>> {
      // Keep the human reason in the permanent private receipt alongside its result.
      // The frozen upstream source_confirmations table has no reason column.
      const result = await run(actor, 'source-confirm', json(raw), typeof raw === 'object' && raw !== null && typeof Reflect.get(raw,'operationId') === 'string'
        ? Reflect.get(raw,'operationId') as string : null, async (client, who) => {
        const req = parseContractSchema('IntakeSourceConfirmation', raw);
        const { view, material } = await candidateContext(client, who, req.key, 'source-confirm', true);
        if (view.sourceEvidenceVersion !== req.expectedEvidenceVersion) throw new IntakeRejection('SOURCE_MISMATCH');
        if (material.object.sha256 !== req.objectSha256 || material.sourceClaim.acquisition !== req.acquisition) throw new IntakeRejection('SOURCE_MISMATCH');
        if (!req.reason.trim() || !req.confirmedVersionValue.trim()) throw new IntakeRejection('FILE_INVALID', 'VALIDATION');
        if (req.confirmedVersionKind === 'integer') {
          if (!/^(0|[1-9][0-9]{0,18})$/u.test(req.confirmedVersionValue)) throw new IntakeRejection('SOURCE_ORDER_UNKNOWN', 'VALIDATION');
          const newer = await client.query(`SELECT 1 FROM content_intake.source_confirmations e
            JOIN content_intake.candidate_versions c ON c.candidate_id=e.candidate_id AND c.version=e.candidate_version AND c.source_evidence_version=e.evidence_version
            JOIN content_intake.publications p ON p.candidate_id=c.candidate_id AND p.candidate_version=c.version
            WHERE e.source_id=$1 AND e.version_kind='integer'
              AND (e.version_value::numeric>$2::numeric OR (e.version_value::numeric=$2::numeric AND e.object_sha256<>$3))`,
          [view.sourceId,req.confirmedVersionValue,req.objectSha256]);
          if (newer.rowCount) throw new IntakeRejection('SOURCE_MISMATCH');
        }
        await client.query(`INSERT INTO content_intake.source_confirmations(candidate_id,candidate_version,candidate_digest,source_id,
          evidence_version,revocation_generation,version_kind,version_value,acquisition,confirmed_by,confirmed_at,object_sha256)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp(),$11)`, [req.key.candidateId,req.key.version,req.key.digest,view.sourceId,
          view.sourceEvidenceVersion+1,view.revocationGeneration+1,req.confirmedVersionKind,req.confirmedVersionValue,req.acquisition,who.id,req.objectSha256]);
        await client.query(`UPDATE content_intake.candidate_versions SET source_evidence_version=source_evidence_version+1,
          revocation_generation=revocation_generation+1,updated_at=clock_timestamp() WHERE candidate_id=$1 AND version=$2`, [req.key.candidateId,req.key.version]);
        return { candidate: await syncCandidateReadiness(client,who,req.key,'source-confirm'), reason: req.reason };
      }, value => {
        const v = value as { candidate: unknown; reason: string };
        return { candidate: parseContractSchema('IntakeCandidate', v.candidate), reason: v.reason };
      });
      return result.ok ? { ok: true, value: result.value.candidate } : result;
    },
    async requestReview(actor: AuthenticatedUser, raw: unknown): Promise<IntakeResult<C['IntakeReview']>> {
      const prepared = await run(actor,'review-prepare',null,null,async (client,who) => {
        const req = parseContractSchema('IntakeReviewRequest',raw);
        if (!adapter) throw new IntakeRejection('APPROVAL_UNAVAILABLE', 'OVERLOADED');
        const prior = await intakeReplay(client,who,'review-request',json(req),req.operationId,review);
        const c = await candidateContext(client,who,req.key,'content-manage', !prior);
        if (prior) return { req, context: c, prior: await binding(client,prior.value.reviewRequestId) };
        if (c.view.approvalEvidenceVersion !== req.expectedEvidenceVersion) throw new IntakeRejection('APPROVAL_CHANGED');
        if (c.view.approvalEvidenceVersion && !(await currentBinding(client,req.key,c.view.approvalEvidenceVersion)).instanceCode) {
          throw new IntakeRejection('COMMIT_UNKNOWN');
        }
        if (c.src.scope.tenantId !== adapter.route.tenantId || c.src.scope.appId !== adapter.route.appId) throw new IntakeRejection('APPROVAL_BINDING');
        return { req, context: c, prior: null };
      }, v => v as { req: C['IntakeReviewRequest']; context: Awaited<ReturnType<typeof candidateContext>>; prior: ReviewBinding | null });
      if (!prepared.ok) return prepared;
      const { req,context } = prepared.value;
      let b = prepared.value.prior;
      let reclaimObjectId: string | null = null;
      try {
        if (!b) {
          const reviewRequestId = `review_${randomUUID()}`;
          const bytes = Buffer.from(canonical({ format: 'intake-review-package-v1',reviewRequestId,key:req.key,material:context.material }));
          const obj = await store.persist((async function* () { yield bytes; })(),'csv',{ maxBytes: INTAKE_POLICY.outputBytes });
          reclaimObjectId = obj.objectId;
          const verified = await store.readPayload(obj.objectId);
          if (verified.length !== bytes.length || digest(verified) !== digest(bytes)) throw new IntakeRejection('ATTACHMENT_UNVERIFIED');
          const frozen = await run(actor,'review-request',json(req),req.operationId,async (client,who) => {
            const c = await candidateContext(client,who,req.key,'content-manage',true);
            if (c.view.approvalEvidenceVersion !== req.expectedEvidenceVersion) throw new IntakeRejection('APPROVAL_CHANGED');
            if (c.view.revocationGeneration !== context.view.revocationGeneration) throw new IntakeRejection('APPROVAL_CHANGED');
            const used = await client.query<{ bytes: string }>('SELECT coalesce(sum(bytes),0) AS bytes FROM content_intake.objects WHERE tenant_id=$1',[who.tenantId]);
            if (Number(used.rows[0]!.bytes)+obj.sizeBytes>1073741824) throw new IntakeRejection('QUOTA_EXCEEDED','RATE_LIMITED');
            await client.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'application/json','review-package',clock_timestamp())`,
            [obj.objectId,c.view.sourceId,who.id,who.tenantId,who.appId,`intake/${obj.objectId}`,obj.sha256,obj.sizeBytes]);
            await client.query(`INSERT INTO content_intake.review_bindings(review_request_id,candidate_id,candidate_version,candidate_digest,
              evidence_version,tenant_id,app_id,definition_id,node_id,create_uuid,package_object_id,package_sha256)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [reviewRequestId,req.key.candidateId,req.key.version,req.key.digest,
              req.expectedEvidenceVersion+1,who.tenantId,who.appId,adapter!.route.definitionId,adapter!.route.nodeId,randomUUID(),obj.objectId,obj.sha256]);
            await client.query(`UPDATE content_intake.candidate_versions SET approval_evidence_version=approval_evidence_version+1,
              revocation_generation=revocation_generation+1,state='awaiting-evidence',updated_at=clock_timestamp() WHERE candidate_id=$1 AND version=$2`,[req.key.candidateId,req.key.version]);
            return reviewView(client,await binding(client,reviewRequestId));
          },review);
          // Retain any possibly committed package. A concurrent permanent replay
          // can adopt a different package; only this request's unused copy is ours
          // to reclaim. Later provider/session failures cannot revoke DB ownership.
          if (frozen.ok ? frozen.value.reviewPackageObjectId === obj.objectId : frozen.commit === 'unknown') reclaimObjectId = null;
          if (!frozen.ok) return frozen;
          const loaded = await run(actor,'review-resume',null,null,async (client,who) => {
            await candidateContext(client,who,req.key,'content-manage');
            return binding(client,frozen.value.reviewRequestId);
          },v => v as ReviewBinding);
          if (!loaded.ok) return loaded;
          b = loaded.value;
        }
        // A replay of an older, already-created instance only reads its original result.
        if (b.instanceCode) return run(actor,'review-read',null,null,async (client,who) => {
          await candidateContext(client,who,req.key,'content-manage');
          return reviewView(client,b!);
        },review);
        const permitted = await run(actor,'review-create-check',null,null,async (client,who) => {
          const c = await candidateContext(client,who,req.key,'content-manage',true);
          if (c.view.approvalEvidenceVersion !== b!.evidenceVersion) throw new IntakeRejection('APPROVAL_CHANGED');
          return b!;
        },v => v as ReviewBinding);
        if (!permitted.ok) return permitted;
        let created: Awaited<ReturnType<ApprovalAdapter['create']>>;
        try { created = await adapter!.create(b,await store.readPayload(b.packageObjectId)); }
        catch (error) {
          diagnostic(error);
          // A provider may have committed despite a lost response. Retain UUID/package
          // and expose `creating`; retry this operation, never allocate a replacement.
          return run(actor,'review-create-unknown',null,null,async (client,who) => {
            await candidateContext(client,who,req.key,'content-manage');
            return reviewView(client,await binding(client,b!.reviewRequestId));
          },review);
        }
        return run(actor,'review-bind',null,null,async (client,who) => {
          const c = await candidateContext(client,who,req.key,'content-manage',true);
          if (c.view.approvalEvidenceVersion !== b!.evidenceVersion) throw new IntakeRejection('APPROVAL_CHANGED');
          const current = await binding(client,b!.reviewRequestId);
          if ((current.instanceCode && current.instanceCode !== created.instanceCode)
            || (current.attachmentFileCode && current.attachmentFileCode !== created.attachmentFileCode)) throw new IntakeRejection('APPROVAL_BINDING');
          await client.query('UPDATE content_intake.review_bindings SET instance_code=$2,attachment_file_code=$3 WHERE review_request_id=$1',
            [b!.reviewRequestId,created.instanceCode,created.attachmentFileCode]);
          return reviewView(client,await binding(client,b!.reviewRequestId));
        },review);
      } catch (error) { diagnostic(error); return failed(actor,error,review); }
      finally {
        if (reclaimObjectId) {
          try { await store.reclaim(reclaimObjectId); } catch (error) { diagnostic(error); }
        }
      }
    },
    review(actor: AuthenticatedUser, rawKey: unknown) {
      return run(actor,'review-read',null,null,async (client,who) => {
        const key = parseContractSchema('IntakeCandidateKey',rawKey);
        const c = await candidateContext(client,who,key,'content-manage');
        return reviewView(client,await currentBinding(client,key,c.view.approvalEvidenceVersion));
      },review);
    },
    refreshReview: (actor: AuthenticatedUser, raw: unknown) => refresh(actor,raw,'content-manage'),
    refreshForPublish: (actor: AuthenticatedUser, raw: unknown) => refresh(actor,raw,'publish'),
  };
}
