import { randomUUID } from 'node:crypto';
import { parseContractSchema, type components } from '@customer-agent/contracts';
import { INTAKE_POLICY } from '@customer-agent/content-intake';
import type { AuthenticatedUser } from '../auth-service.js';
import type { ContentObjectStore } from '../content-object-store.js';
import type { CanonicalJsonValue } from '../idempotency.js';
import { authorize, source } from './authority.js';
import { canonical, digest } from './material.js';
import { historicalReviewer } from './reviewer.js';
import type { ApprovalAdapter, RollbackReviewBinding } from './approval-adapter.js';
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
const denials = new Set<Reason>(['BASE_CHANGED','SCOPE_DENIED','MATERIAL_CHANGED','APPROVAL_CHANGED','APPROVAL_REVOKED',
  'AWAITING_APPROVAL','PERMISSION_CHANGED','HUMAN_REVIEW_REQUIRED','APPROVAL_UNAVAILABLE','MODE_CONFLICT','SOURCE_MISMATCH','TICKET_EXPIRED','TICKET_CONSUMED','ALREADY_PUBLISHED']);
async function sql<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ZA003' || error.code === 'ZA005' || error.code === 'ZA002') && denials.has(error.message as Reason)) {
      throw new IntakeRejection(error.message as Reason,error.code === 'ZA005' ? 'FORBIDDEN' : error.code === 'ZA002' ? 'NOT_FOUND' : 'CONFLICT');
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
  const published = allowPublished && (await client.query('SELECT 1 FROM content_intake.publications WHERE rollback_plan_id=$1',[id])).rowCount === 1;
  let current: Impact;
  if (published) {
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
/** Independent full-catalog rollback evidence. It shares the approval transport and
 * publication transaction owner, but never represents a rollback as a candidate.
 * Provider I/O is outside locks; creation reuses its durable UUID after uncertainty. */
export function createIntakeRollback(run: Run, store: ContentObjectStore, adapter: ApprovalAdapter | undefined,
  report: (id:string,error:unknown) => void) {
  const request = (id:string,raw:unknown) => ({ rollbackPlanId:parseContractSchema('IntakeId',id),...parseContractSchema('IntakeRollbackReviewRequest',raw) });
  function diagnostic(error:unknown) { try { report(`intake_${randomUUID()}`,error); } catch { /* Observational only. */ } }
  const failure = (actor:AuthenticatedUser,error:unknown) => run(actor,'rollback-review-failure',null,null,async () => {
    throw error instanceof IntakeRejection ? error : new IntakeRejection('APPROVAL_UNAVAILABLE','OVERLOADED');
  },review);
  async function check(client:IntakeTransaction,who:Principal,req:ReturnType<typeof request>, allowPublished=false) {
    const p = await plan(client,who,req.rollbackPlanId,allowPublished);
    if (p.impactDigest !== req.impactDigest) throw new IntakeRejection('MATERIAL_CHANGED');
    if (p.approvalEvidenceVersion !== req.expectedEvidenceVersion) throw new IntakeRejection('APPROVAL_CHANGED');
    return p;
  }
  async function packageMaterial(client:IntakeTransaction,p:Plan) {
    const rows = await client.query<{ release_id:string; material: C['IntakeMaterial'] }>(`SELECT DISTINCT l.release_id,c.material FROM content_intake.release_lineage l
      JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
      WHERE l.release_id=ANY($1::text[]) AND l.source_id=ANY($2::text[]) ORDER BY l.release_id,c.material`,[[p.baseReleaseId,p.targetReleaseId],p.sourceIds]);
    const contributors = [...new Set([p.actorId,...rows.rows.flatMap(r => r.material.contributors)])].sort();
    return { baseReleaseId:p.baseReleaseId,targetReleaseId:p.targetReleaseId,impactDigest:p.impactDigest,scopes:p.scopes,
      contributors,catalogs:rows.rows.map(r => ({ releaseId:r.release_id,material:r.material })) };
  }
  async function refresh(actor:AuthenticatedUser,id:string,raw:unknown) {
    const prepared = await run(actor,'rollback-review-refresh-prepare',null,null,async (client,who) => {
      const req = request(id,raw);
      const prior = await intakeReplay(client,who,'rollback-review-refresh',json(req),req.operationId,review);
      if (prior) return { req,reply:prior.value };
      if (!adapter) throw new IntakeRejection('APPROVAL_UNAVAILABLE','OVERLOADED');
      const p = await check(client,who,req,true); const b = await currentBinding(client,p);
      return { req,b,p,factsVersion:Number((await facts(client,b))?.facts_version ?? 0),checkedAt:new Date(await clock(client)).toISOString() };
    },v => v as {req:ReturnType<typeof request>;reply:C['IntakeRollbackReview']} | {req:ReturnType<typeof request>;b:RollbackReviewBinding;p:Plan;factsVersion:number;checkedAt:string});
    if (!prepared.ok) return prepared;
    if ('reply' in prepared.value) return {ok:true as const,value:prepared.value.reply};
    const {req,b,factsVersion,checkedAt} = prepared.value;
    try {
      const observation = await adapter!.observe(b);
      return run(actor,'rollback-review-refresh',json(req),req.operationId,async (client,who) => {
        const p = await check(client,who,req,true); const prior = await facts(client,b);
        if (Number(prior?.facts_version ?? 0) !== factsVersion) throw new IntakeRejection('APPROVAL_CHANGED');
        if (prior?.state === 'revoked' && observation.state !== 'revoked') throw new IntakeRejection('APPROVAL_REVOKED');
        const until = Date.parse(checkedAt)+300_000; if (await clock(client)>=until) throw new IntakeRejection('APPROVAL_UNAVAILABLE');
        client.validUntil(until);
        let reviewer: {id:string;factsVersion:number} | null = null;
        if (observation.human) {
          const material = await packageMaterial(client,p);
          for (const sourceId of p.sourceIds) reviewer = await historicalReviewer(client,await source(client,sourceId),
            { contributors:material.contributors,risk:{level:'critical'} },observation.human,checkedAt,b.createdAt);
          if (!reviewer) throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
        }
        const invalidates = prior?.state === 'approved' && (observation.state !== 'approved' || prior.reviewer_id !== reviewer?.id
          || prior.human_task_id !== observation.human?.taskId || prior.decided_at?.toISOString() !== observation.human?.decidedAt);
        const revoked = observation.state === 'revoked' && prior?.state !== 'revoked';
        const generation = Number(prior?.revocation_generation ?? 0)+Number(invalidates || revoked);
        await client.query(`INSERT INTO content_intake.approval_facts(review_request_id,facts_version,revocation_generation,state,checked_at,valid_until,
          raw_facts_digest,package_verified_sha256,human_task_id,reviewer_id,reviewer_facts_version,decided_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[b.reviewRequestId,factsVersion+1,generation,observation.state,checkedAt,new Date(until).toISOString(),
          observation.rawDigest,observation.packageSha256,observation.human?.taskId ?? null,reviewer?.id ?? null,reviewer?.factsVersion ?? null,observation.human?.decidedAt ?? null]);
        await client.query(`INSERT INTO content_intake.approval_current VALUES($1,$2) ON CONFLICT(review_request_id) DO UPDATE SET facts_version=excluded.facts_version`,[b.reviewRequestId,factsVersion+1]);
        if (invalidates || revoked) await client.query(`INSERT INTO content_intake.release_revocations(release_id,generation,reason,revoked_at)
          SELECT release_id,$2::bigint,$3::text,clock_timestamp() FROM content_intake.release_rollback_lineage WHERE review_request_id=$1
          ON CONFLICT(release_id) DO NOTHING`,[b.reviewRequestId,generation,revoked?'APPROVAL_REVOKED':'APPROVAL_CHANGED']);
        return view(client,b);
      },review);
    } catch(error) { diagnostic(error); return failure(actor,error); }
  }
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
    async requestRollbackReview(actor:AuthenticatedUser,id:string,raw:unknown) {
      const prepared = await run(actor,'rollback-review-prepare',null,null,async(client,who) => {
        const req = request(id,raw); if (!adapter) throw new IntakeRejection('APPROVAL_UNAVAILABLE','OVERLOADED');
        const prior = await intakeReplay(client,who,'rollback-review-request',json(req),req.operationId,review);
        const p = await plan(client,who,id);
        if (prior) return {req,p,b:await binding(client,prior.value.reviewRequestId),material:null};
        await check(client,who,req);
        if (p.approvalEvidenceVersion && !(await currentBinding(client,p)).instanceCode) throw new IntakeRejection('COMMIT_UNKNOWN');
        if (who.tenantId!==adapter.route.tenantId || who.appId!==adapter.route.appId) throw new IntakeRejection('APPROVAL_BINDING');
        return {req,p,b:null,material:await packageMaterial(client,p)};
      },v => v as {req:ReturnType<typeof request>;p:Plan;b:RollbackReviewBinding|null;material:Awaited<ReturnType<typeof packageMaterial>>|null});
      if (!prepared.ok) return prepared;
      const {req,material} = prepared.value; let b = prepared.value.b; let reclaim:string|null=null;
      try {
        if (!b) {
          const reviewRequestId=`review_${randomUUID()}`;
          const bytes=Buffer.from(canonical({format:'intake-rollback-review-package-v1',reviewRequestId,rollbackPlanId:id,material:json(material)}));
          const obj=await store.persist((async function*(){yield bytes;})(),'csv',{maxBytes:INTAKE_POLICY.outputBytes}); reclaim=obj.objectId;
          const copied=await store.readPayload(obj.objectId);
          if(copied.length!==bytes.length || digest(copied)!==digest(bytes)) throw new IntakeRejection('ATTACHMENT_UNVERIFIED');
          const frozen=await run(actor,'rollback-review-request',json(req),req.operationId,async(client,who) => {
            await check(client,who,req);
            const used=await client.query<{bytes:string}>('SELECT coalesce(sum(bytes),0) AS bytes FROM content_intake.objects WHERE tenant_id=$1',[who.tenantId]);
            if(Number(used.rows[0]!.bytes)+obj.sizeBytes>1073741824) throw new IntakeRejection('QUOTA_EXCEEDED','RATE_LIMITED');
            await client.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
              VALUES($1,NULL,$2,$3,$4,$5,$6,$7,'application/json','review-package',clock_timestamp())`,[obj.objectId,who.id,who.tenantId,who.appId,`intake/${obj.objectId}`,obj.sha256,obj.sizeBytes]);
            await client.query(`INSERT INTO content_intake.review_bindings(review_request_id,rollback_plan_id,impact_digest,evidence_version,
              tenant_id,app_id,definition_id,node_id,create_uuid,package_object_id,package_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [reviewRequestId,id,req.impactDigest,req.expectedEvidenceVersion+1,who.tenantId,who.appId,adapter!.route.definitionId,adapter!.route.nodeId,randomUUID(),obj.objectId,obj.sha256]);
            return view(client,await binding(client,reviewRequestId));
          },review);
          if(frozen.ok ? frozen.value.reviewPackageObjectId===obj.objectId : frozen.commit==='unknown') reclaim=null;
          if(!frozen.ok)return frozen;
          const loaded=await run(actor,'rollback-review-resume',null,null,async(client,who)=>{await plan(client,who,id);return binding(client,frozen.value.reviewRequestId);},v=>v as RollbackReviewBinding);
          if(!loaded.ok)return loaded; b=loaded.value;
        }
        const saved=b;
        if(saved.instanceCode)return run(actor,'rollback-review-read',null,null,async(client,who)=>{await plan(client,who,id);return view(client,saved);},review);
        const permitted=await run(actor,'rollback-review-create-check',null,null,async(client,who)=>check(client,who,{...req,expectedEvidenceVersion:saved.evidenceVersion}),v=>v as Plan);
        if(!permitted.ok)return permitted;
        let created:Awaited<ReturnType<ApprovalAdapter['create']>>;
        try{created=await adapter!.create(saved,await store.readPayload(saved.packageObjectId));}
        catch(error){diagnostic(error);return run(actor,'rollback-review-create-unknown',null,null,async(client,who)=>{await plan(client,who,id);return view(client,await binding(client,saved.reviewRequestId));},review);}
        return run(actor,'rollback-review-bind',null,null,async(client,who)=>{
          await check(client,who,{...req,expectedEvidenceVersion:saved.evidenceVersion});const current=await binding(client,saved.reviewRequestId);
          if((current.instanceCode&&current.instanceCode!==created.instanceCode)||(current.attachmentFileCode&&current.attachmentFileCode!==created.attachmentFileCode))throw new IntakeRejection('APPROVAL_BINDING');
          await client.query('UPDATE content_intake.review_bindings SET instance_code=$2,attachment_file_code=$3 WHERE review_request_id=$1',[saved.reviewRequestId,created.instanceCode,created.attachmentFileCode]);
          return view(client,await binding(client,saved.reviewRequestId));
        },review);
      }catch(error){diagnostic(error);return failure(actor,error);}
      finally{if(reclaim)try{await store.reclaim(reclaim);}catch(error){diagnostic(error);}}
    },
    refreshRollbackReview:refresh,
    async rollback(actor:AuthenticatedUser,raw:unknown) {
      const prepared=await run(actor,'rollback-prepare',null,null,async(client,who)=>{
        const req=parseContractSchema('IntakeRollback',raw);const prior=await intakeReplay(client,who,'rollback',json(req),req.operationId,receipt);
        if(prior)return {req,prior:prior.value};
        const p=await check(client,who,{rollbackPlanId:req.rollbackPlanId,operationId:req.operationId,impactDigest:req.impactDigest,expectedEvidenceVersion:req.approvalEvidenceVersion});
        if(p.baseReleaseId!==req.baseReleaseId||p.targetReleaseId!==req.targetReleaseId)throw new IntakeRejection('BASE_CHANGED');
        return {req,prior:null};
      },v=>v as {req:C['IntakeRollback'];prior:C['IntakeRollbackReceipt']|null});
      if(!prepared.ok)return prepared;const {req,prior}=prepared.value;if(prior)return {ok:true as const,value:prior};
      const observed=await refresh(actor,req.rollbackPlanId,{operationId:`rollback-check_${randomUUID()}`,impactDigest:req.impactDigest,expectedEvidenceVersion:req.approvalEvidenceVersion});
      if(!observed.ok)return observed;
      return run(actor,'rollback',json(req),req.operationId,async(client,who)=>{
        const r=await sql(()=>client.query<{value:{receipt:unknown;validUntil:string}}>('SELECT content_intake.execute_rollback($1,$2::jsonb,$3::jsonb) AS value',[who.id,JSON.stringify(req),JSON.stringify(observed.value)]));
        client.validUntil(Date.parse(r.rows[0]!.value.validUntil));return receipt(r.rows[0]!.value.receipt);
      },receipt);
    },
  };
}
