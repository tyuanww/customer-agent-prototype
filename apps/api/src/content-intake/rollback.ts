import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import type { CanonicalJsonValue } from '../idempotency.js';
import { authorize, source } from './authority.js';
import type { RollbackReviewBinding } from './approval-adapter.js';
import { clock, createIntakeTransactions, intakeReplay, IntakeRejection, type IntakeTransaction, type Principal, type Reason } from './transaction.js';

type C = components['schemas'];
type Run = ReturnType<typeof createIntakeTransactions>;
type Impact = Omit<C['IntakeRollbackImpact'], 'rollbackPlanId' | 'approvalEvidenceVersion'> & { sourceIds: string[] };
type Plan = C['IntakeRollbackImpact'] & { actorId: string; sourceIds: string[] };
type Facts = { facts_version: string; revocation_generation: string; state: 'pending'|'approved'|'rejected'|'revoked';
  checked_at: Date; valid_until: Date; reviewer_id: string | null; human_task_id: string | null; decided_at: Date | null };
const review = (v: unknown) => parseContractSchema('IntakeRollbackReview', v);
const receipt = (v: unknown) => parseContractSchema('IntakeRollbackReceipt', v);
const json = (v: unknown) => v as CanonicalJsonValue;
const denials = new Set<Reason>(['FILE_LIMIT','BASE_CHANGED','SCOPE_DENIED','MATERIAL_CHANGED','APPROVAL_CHANGED','APPROVAL_REVOKED',
  'AWAITING_APPROVAL','PERMISSION_CHANGED','HUMAN_REVIEW_REQUIRED','APPROVAL_UNAVAILABLE','MODE_CONFLICT','SOURCE_MISMATCH','TICKET_EXPIRED','TICKET_CONSUMED','ALREADY_PUBLISHED']);
async function sql<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ZA001' || error.code === 'ZA003' || error.code === 'ZA005' || error.code === 'ZA002') && denials.has(error.message as Reason)) {
      throw new IntakeRejection(error.message as Reason,error.code === 'ZA001' ? 'VALIDATION' : error.code === 'ZA005' ? 'FORBIDDEN' : error.code === 'ZA002' ? 'NOT_FOUND' : 'CONFLICT');
    }
    throw error;
  }
}
async function impact(client: IntakeTransaction, who: Principal, base: string, target: string): Promise<Impact> {
  const result = await sql(() => client.query<{ value: Impact }>('SELECT content_intake.preview_rollback($1,$2,$3) AS value',[who.id,base,target]));
  const value = result.rows[0]!.value;
  // Carry every authority deadline consumed by the SQL projection through COMMIT.
  for (const scope of value.scopes) await authorize(client,who,'rollback',await source(client,scope.sourceId));
  return value;
}
async function plan(client: IntakeTransaction, who: Principal, id: string, allowPublished = false): Promise<Plan> {
  const result = await client.query<{ base_release_id:string; target_release_id:string; impact_digest:string; actor_id:string; version:string }>(
    `SELECT p.*,coalesce((SELECT max(evidence_version) FROM content_intake.review_bindings b WHERE b.rollback_plan_id=p.rollback_plan_id),0) AS version
      FROM content_intake.rollback_plans p WHERE rollback_plan_id=$1 AND actor_id=$2`,[parseContractSchema('IntakeId',id),who.id]);
  const p = result.rows[0];
  if (!p) throw new IntakeRejection('SCOPE_DENIED','NOT_FOUND');
  const historical = allowPublished;
  let current: Impact;
  if (historical) {
    const ids = (await client.query<{source_id:string}>('SELECT source_id FROM content_intake.rollback_scopes WHERE rollback_plan_id=$1 ORDER BY source_id',[id])).rows.map(r=>r.source_id);
    const scopes: C['IntakeSourceScope'][] = [];
    for (const sourceId of ids) { const src=await source(client,sourceId); await authorize(client,who,'rollback',src); scopes.push(src.scope); }
    current={baseReleaseId:p.base_release_id,targetReleaseId:p.target_release_id,impactDigest:p.impact_digest,sourceIds:ids,scopes,requiresCorrectiveCandidate:false};
  } else current = await impact(client,who,p.base_release_id,p.target_release_id);
  if (current.impactDigest !== p.impact_digest) throw new IntakeRejection('MATERIAL_CHANGED');
  if (current.requiresCorrectiveCandidate) throw new IntakeRejection('SCOPE_DENIED','FORBIDDEN');
  return { ...current,rollbackPlanId:id,approvalEvidenceVersion:Number(p.version),actorId:p.actor_id };
}
async function binding(client: IntakeTransaction, id: string): Promise<RollbackReviewBinding> {
  const r = await client.query<{ value: RollbackReviewBinding }>(`SELECT jsonb_build_object('reviewRequestId',r.review_request_id,
    'rollbackPlanId',r.rollback_plan_id,'impactDigest',r.impact_digest,'evidenceVersion',r.evidence_version,
    'tenantId',r.tenant_id,'appId',r.app_id,'definitionId',r.definition_id,'nodeId',r.node_id,'createUuid',r.create_uuid,
    'packageObjectId',r.package_object_id,'packageSha256',r.package_sha256,'packageBytes',o.bytes,'createdAt',o.received_at,
    'instanceCode',r.instance_code,'attachmentFileCode',r.attachment_file_code) AS value
    FROM content_intake.review_bindings r JOIN content_intake.objects o ON o.object_id=r.package_object_id
    WHERE review_request_id=$1 AND rollback_plan_id IS NOT NULL`,[id]);
  if (!r.rows[0]) throw new IntakeRejection('AWAITING_APPROVAL');
  return r.rows[0].value;
}
async function currentBinding(client: IntakeTransaction, p: Plan): Promise<RollbackReviewBinding> {
  const r = await client.query<{ review_request_id:string }>('SELECT review_request_id FROM content_intake.review_bindings WHERE rollback_plan_id=$1 AND evidence_version=$2',[p.rollbackPlanId,p.approvalEvidenceVersion]);
  if (!r.rows[0]) throw new IntakeRejection('AWAITING_APPROVAL');
  return binding(client,r.rows[0].review_request_id);
}
async function facts(client: IntakeTransaction, b: RollbackReviewBinding): Promise<Facts | null> {
  return (await client.query<Facts>(`SELECT f.* FROM content_intake.approval_current p JOIN content_intake.approval_facts f
    ON f.review_request_id=p.review_request_id AND f.facts_version=p.facts_version WHERE p.review_request_id=$1`,[b.reviewRequestId])).rows[0] ?? null;
}
async function view(client: IntakeTransaction, b: RollbackReviewBinding): Promise<C['IntakeRollbackReview']> {
  const f = await facts(client,b); const now = await clock(client);
  const state = !b.instanceCode ? 'creating' : f?.state === 'revoked' ? 'revoked'
    : f && f.checked_at.getTime() <= now && now < f.valid_until.getTime() ? f.state : 'unavailable';
  return review({ rollbackPlanId:b.rollbackPlanId,impactDigest:b.impactDigest,reviewRequestId:b.reviewRequestId,
    evidenceVersion:b.evidenceVersion,state,instanceCode:b.instanceCode,revocationGeneration:Number(f?.revocation_generation ?? 0),
    checkedAt:f?.checked_at.toISOString() ?? null,validUntil:f?.valid_until.toISOString() ?? null,
    reviewPackageObjectId:b.packageObjectId,reviewPackageSha256:b.packageSha256 });
}
/** Corrective publication retains the full-impact plan and current authority.
 * Legacy approval history remains readable; no new approval writes are admitted. */
export function createIntakeRollback(run: Run) {
  const unavailable = (actor: AuthenticatedUser, id: string, raw: unknown) => run(actor, 'rollback-review-disabled', null, null, async (client, who) => {
    parseContractSchema('IntakeRollbackReviewRequest', raw);
    await plan(client, who, id, true);
    throw new IntakeRejection('MODE_CONFLICT');
  }, review);
  return {
    rollbackPreview(actor:AuthenticatedUser,raw:unknown) {
      return run(actor,'rollback-preview',null,null,async(client,who) => {
        const req = parseContractSchema('IntakeRollbackPreview',raw); const v = await impact(client,who,req.baseReleaseId,req.targetReleaseId);
        const id = `rollback_${randomUUID()}`;
        await client.query(`INSERT INTO content_intake.rollback_plans VALUES($1,$2,$3,$4,$5,clock_timestamp())`,[id,req.baseReleaseId,req.targetReleaseId,v.impactDigest,who.id]);
        for (const sourceId of v.sourceIds) await client.query('INSERT INTO content_intake.rollback_scopes VALUES($1,$2)',[id,sourceId]);
        return {baseReleaseId:v.baseReleaseId,targetReleaseId:v.targetReleaseId,impactDigest:v.impactDigest,scopes:v.scopes,
          requiresCorrectiveCandidate:v.requiresCorrectiveCandidate,rollbackPlanId:id,approvalEvidenceVersion:0};
      },v => parseContractSchema('IntakeRollbackImpact',v));
    },
    rollbackReview(actor:AuthenticatedUser,id:string) {
      return run(actor,'rollback-review-read',null,null,async(client,who) => view(client,await currentBinding(client,await plan(client,who,id,true))),review);
    },
    requestRollbackReview: unavailable,
    refreshRollbackReview: unavailable,
    async rollback(actor:AuthenticatedUser,raw:unknown) {
      const prepared=await run(actor,'rollback-prepare',null,null,async(client,who)=>{
        const req=parseContractSchema('IntakeRollback',raw);const prior=await intakeReplay(client,who,'rollback',json(req),req.operationId,receipt);
        if(prior)return {req,prior:prior.value};
        const p=await plan(client,who,req.rollbackPlanId);
        if(p.impactDigest!==req.impactDigest)throw new IntakeRejection('MATERIAL_CHANGED');
        if(p.baseReleaseId!==req.baseReleaseId||p.targetReleaseId!==req.targetReleaseId)throw new IntakeRejection('BASE_CHANGED');
        return {req,prior:null};
      },v=>v as {req:C['IntakeRollback'];prior:C['IntakeRollbackReceipt']|null});
      if(!prepared.ok)return prepared;const {req,prior}=prepared.value;if(prior)return {ok:true as const,value:prior};
      return run(actor,'rollback',json(req),req.operationId,async(client,who)=>{
        const r=await sql(()=>client.query<{value:{receipt:unknown;validUntil:string}}>('SELECT content_intake.execute_rollback($1,$2::jsonb,$3::jsonb) AS value',[who.id,JSON.stringify(req),'null']));
        client.validUntil(Date.parse(r.rows[0]!.value.validUntil));return receipt(r.rows[0]!.value.receipt);
      },receipt);
    },
  };
}
