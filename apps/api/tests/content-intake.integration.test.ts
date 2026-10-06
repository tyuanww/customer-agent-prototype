import path from 'node:path';
import { Pool, type Client, type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createTemplate } from '@customer-agent/content-intake';
import type { components } from '@customer-agent/contracts';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import type { IntakeResult } from '../src/content-intake/transaction.js';
import type { AuthenticatedUser } from '../src/auth-service.js';
import { createApprovalAdapter, type ApprovalTransport } from '../src/content-intake/approval-adapter.js';
import { syntheticApproval } from './support/intake-approval.js';
import { digest } from '../src/content-intake/material.js';
import { seedSyntheticG1aRelease } from './support/synthetic-g1a.js';
import type { IntakeQualityPreview, IntakeQualityProgress, QualityCheck } from '../src/content-intake/quality.js';

type C = components['schemas'];
const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const actor = (id: string): AuthenticatedUser => ({ user_id: `user-${id}`, role: 'owner', auth_mode: 'mock' });
const scope: C['IntakeScope'] = { tenantId: 'tenant-a', appId: 'app-a', brandId: 'brand-a', shopId: 'shop-a', domain: 'product', sourceId: 'source-a' };
function value<T>(result: IntakeResult<T>): T {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe.skipIf(!enabled)('P2 sealed synthetic authority and durable candidates', () => {
  let harness: Pg15Harness;
  let admin: Client;
  let pool: Pool;
  let service: ReturnType<typeof createContentIntakeService>;
  let store: ReturnType<typeof createContentObjectStore>;
  let policyVersion: number;
  const diagnostics: unknown[] = [];
  let provider: ReturnType<typeof syntheticApproval>;
  const route = { tenantId:'tenant-a',appId:'app-a',definitionId:'synthetic-definition',nodeId:'manual-node' };
  function evidenceService(transport: ApprovalTransport = provider.transport) {
    return createContentIntakeService(pool,store,(_id,error) => diagnostics.push(error),createApprovalAdapter(route,transport));
  }

  beforeEach(async () => {
    harness = new Pg15Harness(); harness.start();
    const db = harness.createDatabase('intake');
    admin = await harness.connect(db.config);
    await applyDatabaseMigrations(admin);
    pool = new Pool({ ...db.config, max: 4 });
    store = createContentObjectStore(path.join(harness.root, db.name));
    provider = syntheticApproval();
    service = evidenceService();
    diagnostics.length = 0;
    await admin.query('BEGIN');
    for (const [id, role] of [['director','director'], ['manager','manager'], ['supervisor','supervisor'], ['enabler','enabler'], ['other','enabler'], ['reviewer','enabler'], ['agent','agent']] as const) {
      await admin.query(`INSERT INTO backend_identity.subject_bindings(binding_id,provider,tenant,subject,user_id,subject_hash,enabled,role)
        VALUES ($1,'synthetic','tenant-a',$1,$2,repeat('a',64),true,'owner')`, [id, `user-${id}`]);
      await admin.query(`INSERT INTO content_intake.principals VALUES ($1,$2,'tenant-a','app-a','confirmed-synthetic',$1,1,0)`, [id, `user-${id}`]);
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ($1,1,ARRAY['dept-a'],$2,true,
        statement_timestamp()-interval '1 second',statement_timestamp()+interval '299 seconds',repeat('a',64))`, [id, `job-${role}`]);
      await admin.query(`INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-a',$1,1,$2) ON CONFLICT DO NOTHING`, [`job-${role}`, role]);
    }
    for (const [id, shop] of [['a','shop-a'], ['b','shop-b'], ['brand',null]] as const) {
      await admin.query(`INSERT INTO content_intake.scopes VALUES ($1,'tenant-a','app-a','brand-a',$2,'product')`, [`scope-${id}`, shop]);
      await admin.query(`INSERT INTO content_intake.sources(source_id,scope_id,current_mapping_version,mode) VALUES ($1,$2,1,'v2-preview')`, [`source-${id}`, `scope-${id}`]);
      await admin.query(`INSERT INTO content_intake.source_mappings VALUES ($1,1,'faq-p1.1','intake-p1.1','mapping-p1.1',repeat('a',64))`, [`source-${id}`]);
    }
    const actions = ['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'];
    for (const action of actions) {
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
        VALUES ($1,'allocation','director','director','tenant-a','app-a','scope-a',$2,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day','合成根资格','director')`, [`root-${action}`, action]);
      for (const recipient of ['enabler', 'other', 'reviewer', ...(action === 'query' ? ['agent'] : [])]) {
        await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
          VALUES ($1,'business','director',$2,'tenant-a','app-a','scope-a','source-a',$3,clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '1 hour','合成业务授权','director',$4)`, [`business-${recipient}-${action}`, recipient, action, `root-${action}`]);
      }
    }
    await admin.query('COMMIT');
    policyVersion = Number((await admin.query('SELECT version FROM content_intake.policy_versions')).rows[0].version);
  }, 60_000);
  afterEach(async () => { await pool?.end(); await admin?.end(); harness?.stop(); }, 60_000);

  function batch(recipient: string, action: C['IntakeAction'] = 'import', kind: 'business' | 'delegation' = 'business', op = 'batch-one'): C['IntakeGrantBatch'] {
    return { operationId: op, issuerFactsVersion: 1, policyVersion, items: [{ kind, recipientPrincipalId: recipient,
      recipientFactsVersion: 1, action, scope, startsAt: new Date().toISOString(), expiresAt: new Date(Date.now()+600_000).toISOString(), reason: '合成授权' }] };
  }
  async function input(op: string, prior: C['IntakeCandidateKey'] | null = null, rows = [
    ['faq-one','合成问题','第一行。\n第二行。','','','分类','','启用','','','','内部说明','风险提示','','false'],
  ]): Promise<C['IntakeReceive']> {
    const bytes = await createTemplate({ sourceId: 'source-a', brandId: 'brand-a', scope: 'shop-a', domain: 'product', sheet: 'FAQ', templateVersion: 'faq-p1.1' }, rows);
    const obj = await store.persist((async function* () { yield bytes; })(), 'excel');
    await admin.query(`INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES ($1,'source-a','enabler','tenant-a','app-a',$2,$3,$4,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','input',clock_timestamp())`,
    [obj.objectId, `intake/${obj.objectId}`, obj.sha256, obj.sizeBytes]);
    return { operationId: op, objectId: obj.objectId, sourceVersion: 1, baseReleaseId: null,
      contributorDeclaration: { preparerPrincipalId: 'enabler', editorPrincipalIds: ['other'], confirmed: true }, expectedPriorKey: prior };
  }
  async function candidate(op = 'receive-one') {
    const received = value(await service.receive(actor('enabler'), 'source-a', await input(op)));
    const parsed = await service.parse(actor('enabler'), received.jobId);
    if (!parsed.ok) throw new Error(JSON.stringify({ parsed, diagnostics, report: await service.job(actor('enabler'), received.jobId) }));
    return value(parsed);
  }
  async function routine() {
    const req = await input('routine',null,[['faq-one','合成问题','第一行。\n第二行。','','','分类','','启用','','','','内部说明','','','false']]);
    return value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',req)).jobId));
  }
  async function confirm(c: C['IntakeCandidate'], op = 'source-confirm-one', expected = 0) {
    const material = (await admin.query('SELECT material FROM content_intake.candidate_versions WHERE candidate_id=$1 AND version=$2',[c.key.candidateId,c.key.version])).rows[0].material as C['IntakeMaterial'];
    const req: C['IntakeSourceConfirmation'] = { operationId:op,key:c.key,expectedEvidenceVersion:expected,
      confirmedVersionKind:'opaque',confirmedVersionValue:'synthetic-export-one',acquisition:'controlled-synthetic-export',objectSha256:material.object.sha256,reason:'合成人工确认来源' };
    return { req,result:await service.confirmSource(actor('enabler'),req) };
  }
  const reviewRequest = (c: C['IntakeCandidate'], expected = 0, op = 'review-one'): C['IntakeReviewRequest'] =>
    ({ operationId:op,key:c.key,expectedEvidenceVersion:expected });
  const refresh = (c: C['IntakeCandidate'], op = 'refresh-one', expected = 1) => service.refreshReview(actor('other'),reviewRequest(c,expected,op));

  // A consumer probe, not a production bridge: synthetic legacy batch/lease only.
  // No staging, native review-to-owner conversion, publication or mode activation.
  async function freezeQualityProbe(p: IntakeQualityPreview, label = 'one') {
    const batchId = `quality-probe-${label}`;
    const planId = `qplan_probe-${label}`;
    const jobId = `quality-job-${label}`;
    await admin.query(`INSERT INTO public.import_batches(import_batch_id,source_type,source_binding_hash,status)
      VALUES ($1,'other',repeat('a',64),'validating')`, [batchId]);
    await admin.query(`INSERT INTO public.outbox_jobs(job_id,job_type,payload,status,lease_owner,lease_version,lease_expires_at)
      VALUES ($1,'import_validate',jsonb_build_object('import_batch_id',$2::text),'running','quality-probe',1,clock_timestamp()+interval '60 seconds')`, [jobId,batchId]);
    const frozen = await admin.query(`SELECT * FROM public.freeze_content_quality_review_plan(
      $1,'quality-probe',1,$2,$3,'quality-sampling-v1',clock_timestamp(),$4,$5,$6,$7,$8,'sha256-ranked-v1',$9::jsonb)`,
    [jobId,batchId,planId,p.population.length,p.ordinaryCount,p.mandatoryCount,p.seedHash,p.selectionManifestHash,JSON.stringify(p.population)]);
    expect(frozen.rows[0]).toEqual({ frozen_plan_id:planId, initial_sample_target:p.initialTarget, expanded_sample_target:p.expandedTarget });
    const stored = (await admin.query('SELECT * FROM public.content_quality_review_plans WHERE plan_id=$1',[planId])).rows[0];
    expect(stored).toMatchObject({ population_manifest_hash:p.populationManifestHash,selection_manifest_hash:p.selectionManifestHash });
    return planId;
  }

  function qualityChecks(p: IntakeQualityProgress, phase: 'initial' | 'expanded' = 'initial', defects = 0): QualityCheck[] {
    const plan = p.plan!;
    const prior = new Map(p.rounds.flatMap(r => r.checks).map(c => [c.scriptId,c]));
    const hashes = new Map(plan.population.map(r => [r.script_id,r.content_hash]));
    return (phase === 'initial' ? plan.initialScriptIds : plan.expandedScriptIds).map((id,index) => prior.get(id)
      ?? { scriptId:id,contentHash:hashes.get(id)!,defect:index<defects,reason:index<defects?'合成阻断错误':'' });
  }
  const freezeQuality = (c: C['IntakeCandidate']) => service.freezeQuality(actor('reviewer'),{ operationId:'freeze-quality',key:c.key });

  it('freezes quality before individual checks, survives service recreation and creates no approval or release', async () => {
    const c = await routine();
    expect(value(await service.quality(actor('enabler'),c.key)).state).toBe('not_frozen');
    expect(await service.checkQuality(actor('enabler'),{ operationId:'before-freeze',key:c.key,phase:'initial',checks:[] })).toMatchObject({ ok:false });
    const frozen = value(await freezeQuality(c));
    expect(frozen.state).toBe('initial_required');
    expect(value(await createContentIntakeService(pool,store).quality(actor('enabler'),c.key))).toEqual(frozen);
    expect(value(await service.freezeQuality(actor('other'),{ operationId:'another-freeze',key:c.key }))).toEqual(frozen);
    const req = { operationId:'quality-initial',key:c.key,phase:'initial',checks:qualityChecks(frozen) };
    const checked = await service.checkQuality(actor('enabler'),req);
    expect(checked.ok, diagnostics.map(e => e instanceof Error ? e.message : String(e)).join(' | ')).toBe(true);
    const result = value(checked);
    expect(result.state).toBe('passed'); // Routine self-review is allowed.
    expect(result.rounds[0]).toMatchObject({ checkedBy:'enabler',factsVersion:1,checks:req.checks });
    expect(value(await service.checkQuality(actor('enabler'),req))).toEqual(result);
    expect(value(await service.candidate(actor('enabler'),c.key.candidateId,c.key.version)).state).toBe('awaiting-evidence');
    for (const table of ['public.content_releases','content_intake.commit_tickets','content_intake.approval_facts']) {
      expect((await admin.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe('0');
    }
    await expect(admin.query("UPDATE content_intake.quality_plans SET plan='{}'::jsonb")).rejects.toMatchObject({ code:'ZA003' });
    await expect(admin.query('DELETE FROM content_intake.quality_rounds')).rejects.toMatchObject({ code:'ZA003' });
  });

  it('rejects omitted, invented, duplicate, changed-content and caller-supplied quality conclusions atomically', async () => {
    const c = await routine(); const p = value(await freezeQuality(c)); const checks = qualityChecks(p);
    const req = { operationId:'invalid-check',key:c.key,phase:'initial',checks };
    for (const bad of [[],[...checks,...checks],[{ ...checks[0]!,contentHash:'f'.repeat(64) }],
      [{ ...checks[0]!,scriptId:`intake_${'f'.repeat(64)}` }],[{ ...checks[0]!,defect:true,reason:'' }]]) {
      expect(await service.checkQuality(actor('reviewer'),{ ...req,checks:bad })).toMatchObject({ ok:false,code:'VALIDATION' });
    }
    expect(await service.checkQuality(actor('reviewer'),{ ...req,conclusion:'passed' })).toMatchObject({ ok:false,code:'VALIDATION' });
    expect(await service.checkQuality(actor('reviewer'),{ ...req,key:{ ...c.key,digest:'f'.repeat(64) } })).toMatchObject({ ok:false,reason:'MATERIAL_CHANGED' });
    await expect(admin.query(`INSERT INTO content_intake.quality_rounds VALUES ($1,$2,$3,'initial','[]','reviewer',1,clock_timestamp())`,
      [c.key.candidateId,c.key.version,c.key.digest])).rejects.toMatchObject({ message:'QUALITY_SAMPLE_MISMATCH' });
    expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('0');
    expect((await admin.query("SELECT count(*) FROM backend_review.receipts WHERE operation='intake:quality-check'")).rows[0].count).toBe('0');
    expect(value(await service.checkQuality(actor('reviewer'),req)).state).toBe('passed');
  });

  it.each([[2,'revision_required'],[3,'expansion_required'],[5,'expansion_required'],[6,'blocked']] as const)(
    'derives the 501-row quality state with %s initial defects as %s', async (defects,state) => {
      const rows = Array.from({ length:501 },(_,n) => [`faq-${n}`,'合成标题','合成正文','','','分类','','启用','','','','','','','false']);
      const req = await input('quality-rounds-large',null,rows);
      const c = value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',req)).jobId));
      const frozen = value(await freezeQuality(c));
      expect(await service.checkQuality(actor('reviewer'),{ operationId:'too-early',key:c.key,phase:'expanded',checks:qualityChecks(frozen,'expanded') })).toMatchObject({ ok:false });
      const initial = value(await service.checkQuality(actor('reviewer'),{ operationId:'initial-round',key:c.key,phase:'initial',checks:qualityChecks(frozen,'initial',defects) }));
      expect(initial.state).toBe(state);
      if (state === 'expansion_required') {
        const expanded = qualityChecks(initial,'expanded');
        const altered = expanded.map(c => ({ ...c,defect:false,reason:'' }));
        expect(await service.checkQuality(actor('reviewer'),{ operationId:'changed-prior',key:c.key,phase:'expanded',checks:altered })).toMatchObject({ ok:false,code:'VALIDATION' });
        const final = value(await service.checkQuality(actor('reviewer'),{ operationId:'expanded-round',key:c.key,phase:'expanded',checks:expanded }));
        expect(final.state).toBe('revision_required');
        expect(final.rounds).toHaveLength(2);
      }
      expect(await service.checkQuality(actor('reviewer'),{ operationId:'retry-new-key',key:c.key,phase:'initial',checks:qualityChecks(frozen) })).toMatchObject({ ok:false });
    });

  it('records all 5000 critical checks within the unchanged transaction budget', async () => {
    const rows = Array.from({ length:5000 },(_,n) => [`faq-${n}`,'合成标题','合成正文','','','分类','','启用','','','','','合成风险','','false']);
    const req = await input('quality-max-critical',null,rows);
    const c = value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',req)).jobId));
    const frozen = value(await freezeQuality(c));
    expect(frozen.plan?.mandatoryCount).toBe(5000);
    const checked = await service.checkQuality(actor('reviewer'),{ operationId:'quality-max-check',key:c.key,phase:'initial',checks:qualityChecks(frozen) });
    expect(checked.ok,diagnostics.map(e => e instanceof Error ? e.message : String(e)).join(' | ')).toBe(true);
    expect(value(checked).state).toBe('passed');
    expect((await admin.query('SELECT jsonb_array_length(checks) AS count FROM content_intake.quality_rounds')).rows).toEqual([{ count:5000 }]);
  },30_000);

  it('requires a non-contributing person for critical quality and refuses reuse after revision', async () => {
    const c = await candidate(); const frozen = value(await freezeQuality(c));
    expect(frozen.plan?.mandatoryCount).toBe(1);
    const req = { operationId:'critical-quality',key:c.key,phase:'initial',checks:qualityChecks(frozen) };
    for (const id of ['enabler','other']) expect(await service.checkQuality(actor(id),req)).toMatchObject({ ok:false,reason:'HUMAN_REVIEW_REQUIRED' });
    expect(value(await service.checkQuality(actor('reviewer'),req)).state).toBe('passed');
    const revision = await input('quality-revision',c.key);
    const next = value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',revision)).jobId));
    expect(value(await service.quality(actor('reviewer'),next.key)).state).toBe('not_frozen');
    expect(await service.quality(actor('reviewer'),c.key)).toMatchObject({ ok:false,reason:'MATERIAL_CHANGED' });
    expect(await service.checkQuality(actor('reviewer'),{ ...req,key:next.key,operationId:'stale-new-version' })).toMatchObject({ ok:false });
    expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('1');
  });

  it('rechecks scope, revocation and cancellation before recording quality', async () => {
    const c = await routine(); const frozen = value(await freezeQuality(c));
    const req = { operationId:'denied-quality',key:c.key,phase:'initial',checks:qualityChecks(frozen) };
    expect(await service.checkQuality(actor('agent'),req)).toMatchObject({ ok:false });
    value(await service.changeGrant(actor('director'),'business-reviewer-review',{ operationId:'revoke-quality',expectedVersion:1,change:'revoke',stewardPrincipalId:null,reason:'合成撤权' }));
    expect(await service.checkQuality(actor('reviewer'),req)).toMatchObject({ ok:false });
    value(await service.cancel(actor('enabler'),{ operationId:'cancel-quality',key:c.key }));
    expect(await service.checkQuality(actor('enabler'),req)).toMatchObject({ ok:false });
    expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('0');
  });

  it('recovers a lost quality COMMIT once and rejects changed payload under the original operation', async () => {
    const c = await routine(); const frozen = value(await freezeQuality(c));
    let injected = false;
    const uncertainPool = { async connect() {
      const client = await pool.connect();
      return new Proxy(client,{ get(target,key) {
        if (key === 'query') return async (sql: string,values?: unknown[]) => {
          const result = await target.query(sql,values);
          if (sql === 'COMMIT' && !injected) { injected=true; throw new Error('synthetic quality response lost'); }
          return result;
        };
        const member: unknown = Reflect.get(target,key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const req = { operationId:'uncertain-quality',key:c.key,phase:'initial',checks:qualityChecks(frozen) };
    expect(await createContentIntakeService(uncertainPool,store).checkQuality(actor('enabler'),req)).toMatchObject({ ok:false,commit:'unknown' });
    expect(value(await service.checkQuality(actor('enabler'),req)).state).toBe('passed');
    expect(await service.checkQuality(actor('enabler'),{ ...req,checks:req.checks.map(c => ({ ...c,defect:true,reason:'changed' })) }))
      .toMatchObject({ ok:false,reason:'IDEMPOTENCY_CONFLICT' });
    expect((await admin.query('SELECT count(*) FROM content_intake.quality_rounds')).rows[0].count).toBe('1');
  });

  it('quality preview preserves the candidate and is actually consumable by the existing SQL plan freezer', async () => {
    const c = await routine();
    const before = (await admin.query('SELECT * FROM content_intake.candidate_versions')).rows;
    const p = value(await service.qualityPreview(actor('reviewer'),c.key));
    expect(p.purpose).toBe('synthetic-quality-preview');
    expect(p.entries[0]?.entry.answerText).toBe('第一行。\n第二行。');
    expect(p.entries[0]?.entry.internalNote).toBe('内部说明');
    expect(p.initialScriptIds).toEqual(p.population.map(r => r.script_id));
    expect(value(await service.qualityPreview(actor('reviewer'),c.key))).toEqual(p);
    expect((await admin.query('SELECT * FROM content_intake.candidate_versions')).rows).toEqual(before);
    expect((await admin.query('SELECT count(*) FROM public.content_quality_review_plans')).rows[0].count).toBe('0');
    await freezeQualityProbe(p);
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM public.content_quality_review_evidence')).rows[0].count).toBe('0');
  });

  it('quality SQL requires expanded review and rejects a fabricated passing conclusion', async () => {
    const rows = Array.from({ length:501 }, (_, n) => [`faq-${n}`,'合成标题','合成正文','','','分类','','启用','','','','','','','false']);
    const req = await input('quality-large',null,rows);
    const c = value(await service.parse(actor('enabler'),value(await service.receive(actor('enabler'),'source-a',req)).jobId));
    const p = value(await service.qualityPreview(actor('reviewer'),c.key));
    expect(p.initialScriptIds).toHaveLength(100);
    expect(p.expandedScriptIds).toHaveLength(151);
    expect(p.initialScriptIds.every(id => p.expandedScriptIds.includes(id))).toBe(true);
    const plan = await freezeQualityProbe(p);
    const record = (expanded: number | null, defects: number | null, conclusion: string) => admin.query(
      `SELECT public.record_content_quality_review_evidence($1,100,3,$2,$3,0,0,491,10,$4,'synthetic-quality-evidence','content_quality_reviewer')`,
      [plan,expanded,defects,conclusion]);
    await expect(record(null,null,'passed')).rejects.toMatchObject({ detail:'QUALITY_EXPANSION_REQUIRED' });
    await expect(record(151,10,'passed')).rejects.toMatchObject({ detail:'QUALITY_THRESHOLD_MISMATCH' });
    expect((await admin.query('SELECT count(*) FROM public.content_quality_review_evidence')).rows[0].count).toBe('0');
    await record(151,10,'blocked');
    expect((await admin.query('SELECT conclusion FROM public.content_quality_review_evidence')).rows).toEqual([{ conclusion:'blocked' }]);
    expect((await admin.query('SELECT quality_gate_passed FROM public.import_batches')).rows).toEqual([{ quality_gate_passed:false }]);
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
  });

  it('critical quality population requires every live entry and does not fabricate owner acceptance', async () => {
    const c = await candidate();
    value((await confirm(c)).result);
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    provider.approve('reviewer');
    value(await refresh(c));
    expect(value(await service.candidate(actor('enabler'),c.key.candidateId,c.key.version)).state).toBe('ready');
    const p = value(await service.qualityPreview(actor('reviewer'),c.key));
    expect(p).toMatchObject({ ordinaryCount:0,mandatoryCount:1,initialTarget:0,expandedTarget:0 });
    expect(p.initialScriptIds).toEqual(p.population.map(r => r.script_id));
    expect(p.expandedScriptIds).toEqual(p.initialScriptIds);
    const plan = await freezeQualityProbe(p);
    await expect(admin.query(`SELECT public.record_content_quality_review_evidence($1,0,0,NULL,NULL,0,0,1,0,'passed','synthetic-evidence','content_quality_reviewer')`,[plan]))
      .rejects.toMatchObject({ detail:'QUALITY_EVIDENCE_INVALID' });
    await admin.query(`SELECT public.record_content_quality_review_evidence($1,0,0,NULL,NULL,1,0,1,0,'passed','synthetic-evidence','content_quality_reviewer')`,[plan]);
    // Native human approval and a quality pass are neither legacy owner evidence
    // nor a P2 publication. Even the old purpose needs a separately registered record.
    for (const purpose of ['native-intake-approval','g1a_offline_only']) await expect(admin.query(
      "SELECT public.assert_owner_acceptance('tenant-a',$1,repeat('a',64),$2,'{}'::jsonb)", [c.key.digest,purpose]))
      .rejects.toMatchObject({ message:'OWNER_ACCEPTANCE_NOT_ACTIVE' });
    expect((await admin.query('SELECT count(*) FROM public.owner_acceptance_records')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM content_intake.commit_tickets')).rows[0].count).toBe('0');
  });

  it('quality preview rechecks role, current grants, the exact key and cancellation on every read', async () => {
    const c = await routine();
    expect(await service.qualityPreview(actor('agent'),c.key)).toMatchObject({ ok:false,code:'NOT_FOUND' });
    expect(await service.qualityPreview(actor('reviewer'),{ ...c.key,digest:'a'.repeat(64) })).toMatchObject({ ok:false,reason:'MATERIAL_CHANGED' });
    value(await service.qualityPreview(actor('reviewer'),c.key));
    value(await service.changeGrant(actor('director'),'business-reviewer-review',
      { operationId:'revoke-quality-reviewer',expectedVersion:1,change:'revoke',stewardPrincipalId:null,reason:'合成质量预览撤权' }));
    expect(await service.qualityPreview(actor('reviewer'),c.key)).toMatchObject({ ok:false,code:'NOT_FOUND' });
    value(await service.cancel(actor('enabler'),{ operationId:'cancel-quality',key:c.key }));
    expect(await service.qualityPreview(actor('other'),c.key)).toMatchObject({ ok:false,reason:'MATERIAL_CHANGED' });
  });

  it('ignores the login owner label; enabler needs an exact shop/source business grant', async () => {
    value(await service.authorization(actor('enabler'), 'source-a', 'import'));
    expect(await service.authorization(actor('agent'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    value(await service.authorization(actor('agent'), 'source-a', 'query'));
    expect(await service.authorization(actor('director'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    for (const id of ['source-b','source-brand','missing']) expect(await service.authorization(actor('enabler'), id, 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await admin.query("INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-a','job-enabler',1,'agent') ON CONFLICT (tenant_id,app_id,department_id,job_id) DO UPDATE SET role='agent'");
    expect(await service.authorization(actor('enabler'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await admin.query("UPDATE backend_identity.subject_bindings SET enabled=false WHERE user_id='user-enabler'");
    expect(await service.authorization(actor('enabler'), 'source-a', 'query')).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
    const acl = await admin.query("SELECT has_schema_privilege('app_content_admin','content_intake','USAGE') AS allowed");
    expect(acl.rows[0].allowed).toBe(false);
  });

  it('commits multi-action batches atomically; rejects self, agent writes, wider scope, stale policy and redelegation', async () => {
    const good = batch('manager');
    const atomic = { ...good, items: [...good.items, { ...good.items[0]!, recipientPrincipalId: 'agent' }] };
    expect(await service.grantBatch(actor('director'), atomic)).toMatchObject({ ok: false, reason: 'ROLE_CEILING' });
    expect((await admin.query("SELECT count(*) FROM content_intake.grants WHERE recipient_id='manager'")).rows[0].count).toBe('0');
    expect(await service.grantBatch(actor('director'), batch('director'))).toMatchObject({ ok: false, reason: 'SELF_ESCALATION' });
    expect(await service.grantBatch(actor('director'), { ...good, policyVersion: 999 })).toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED' });
    expect(await service.grantBatch(actor('director'), { ...good, items: [{ ...good.items[0]!, scope: { ...scope, shopId: 'shop-b' } }] })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const delegation = value(await service.grantBatch(actor('director'), batch('enabler', 'import', 'delegation'))).items[0]!;
    const delegated = batch('manager', 'import', 'business', 'delegated');
    delegated.items[0]!.expiresAt = new Date(Date.parse(delegation.expiresAt)-1000).toISOString();
    value(await service.grantBatch(actor('enabler'), delegated));
    expect(await service.grantBatch(actor('enabler'), batch('manager','import','delegation','again'))).toMatchObject({ ok: false, reason: 'REDELEGATION_DENIED' });
    const revoked = value(await service.changeGrant(actor('director'), delegation.grantId,
      { operationId: 'revoke', expectedVersion: 1, change: 'revoke', stewardPrincipalId: null, reason: '合成撤资格' }));
    expect(revoked.version).toBe(2);
    const child = (await admin.query("SELECT * FROM content_intake.grants WHERE parent_grant_id=$1", [delegation.grantId])).rows[0];
    expect(child).toMatchObject({ issuer_id: 'enabler', revoked_at: null, steward_id: null, version: '2', reason: '合成授权', last_change_reason: '合成撤资格' });
    value(await service.authorization(actor('manager'), 'source-a', 'import'));
    expect(await service.grantBatch(actor('enabler'), { ...delegated, operationId: 'after-revocation' })).toMatchObject({ ok: false, reason: 'GRANT_AUTHORITY_DENIED' });
    expect((await admin.query('SELECT count(*) FROM content_intake.grant_history WHERE grant_id=$1', [child.grant_id])).rows[0].count).toBe('2');
    // Delegation is independent of the recipient's own business ceiling (§12.1).
    const agentDelegation = value(await service.grantBatch(actor('director'), batch('agent', 'import', 'delegation', 'agent-allocator'))).items[0]!;
    const byAgent = batch('manager', 'import', 'business', 'agent-distributes');
    byAgent.items[0]!.expiresAt = new Date(Date.parse(agentDelegation.expiresAt)-1000).toISOString();
    value(await service.grantBatch(actor('agent'), byAgent));
    expect(await service.authorization(actor('agent'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.grantBatch(actor('agent'), batch('other', 'import', 'delegation', 'agent-redelegates')))
      .toMatchObject({ ok: false, reason: 'REDELEGATION_DENIED' });
  });

  it('recovers lost COMMIT responses using the original durable operation and rejects payload changes', async () => {
    let injected = false;
    const uncertainPool = { async connect() {
      const client = await pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (sql === 'COMMIT' && !injected) { injected = true; throw new Error('synthetic lost response after commit'); }
          return result;
        };
        const member: unknown = Reflect.get(target, key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const uncertain = createContentIntakeService(uncertainPool, store);
    const req = batch('manager');
    expect(await uncertain.grantBatch(actor('director'), req)).toMatchObject({ ok: false, commit: 'unknown' });
    const replay = value(await service.grantBatch(actor('director'), req));
    expect(replay.items).toHaveLength(1);
    expect((await admin.query("SELECT count(*) FROM content_intake.grants WHERE recipient_id='manager'")).rows[0].count).toBe('1');
    expect(await service.grantBatch(actor('director'), { ...req, items: [{ ...req.items[0]!, reason: '变更载荷' }] })).toMatchObject({ ok: false, reason: 'IDEMPOTENCY_CONFLICT' });
  });

  it('keeps permanent operation replay independent of retired HTTP HMAC keys', async () => {
    const req = batch('manager');
    const first = value(await service.grantBatch(actor('director'), req));
    const restarted = createContentIntakeService(pool, store);
    expect(value(await restarted.grantBatch(actor('director'), req))).toEqual(first);
    // No rotating HTTP key is accepted by this permanent-receipt service.
    const receipt = (await admin.query("SELECT request_hash FROM backend_review.receipts WHERE operation='intake:grants'")).rows[0];
    expect(receipt.request_hash).toMatch(/^intake-request-v1:[a-f0-9]{64}$/);
  });

  it('rejects admission when its business grant expires after authorization but before commit', async () => {
    const req = await input('expiry-during-admission');
    await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成短时授权取代' WHERE grant_id='business-enabler-import'");
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
      VALUES ('short-import','business','director','enabler','tenant-a','app-a','scope-a','source-a','import',clock_timestamp()-interval '1 second',clock_timestamp()+interval '0.2 seconds','合成短时授权','director','root-import')`);
    const delayed = { async connect() {
      const client = await pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (sql.includes('AS actor_jobs')) await target.query('SELECT pg_sleep(0.25)');
          return result;
        };
        const member: unknown = Reflect.get(target, key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    expect(await createContentIntakeService(delayed, store).receive(actor('enabler'), 'source-a', req))
      .toMatchObject({ ok: false, reason: 'PERMISSION_CHANGED' });
    expect((await admin.query('SELECT count(*) FROM content_intake.parse_jobs')).rows[0].count).toBe('0');
  });

  it('allows a newly qualified supervisor to take over and revoke existing business grants', async () => {
    await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id)
      VALUES ('new-supervisor','allocation','director','supervisor','tenant-a','app-a','scope-a','source-a','import',clock_timestamp()-interval '1 second',clock_timestamp()+interval '10 minutes','合成新任范围负责人','director')`);
    const takeover = { operationId: 'new-steward', expectedVersion: 1, change: 'takeover' as const, stewardPrincipalId: 'supervisor', reason: '合成接管' };
    const changed = value(await service.changeGrant(actor('supervisor'), 'business-enabler-import', takeover));
    expect(changed).toMatchObject({ issuerPrincipalId: 'director', stewardPrincipalId: 'supervisor', version: 2, revokedAt: null });
    value(await service.authorization(actor('enabler'), 'source-a', 'import'));
    value(await service.changeGrant(actor('supervisor'), changed.grantId, { ...takeover, operationId: 'new-steward-revoke', expectedVersion: 2, change: 'revoke', stewardPrincipalId: null }));
    expect(await service.authorization(actor('enabler'), 'source-a', 'import')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('fences legacy publication while admitting against an empty current pointer', async () => {
    const req = await input('legacy-base-race');
    let reached!: () => void;
    const atBase = new Promise<void>(resolve => { reached = resolve; });
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const delayed = { async connect() {
      const client = await pool.connect();
      return new Proxy(client, { get(target, key) {
        if (key === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (sql.startsWith('SELECT current_release_id')) { reached(); await gate; }
          return result;
        };
        const member: unknown = Reflect.get(target, key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const pending = createContentIntakeService(delayed, store).receive(actor('enabler'), 'source-a', req);
    await atBase;
    let acquired: boolean;
    try {
      await admin.query('BEGIN');
      acquired = (await admin.query("SELECT pg_try_advisory_xact_lock(hashtext('cs_ai_content_publish')) AS acquired")).rows[0].acquired;
    } finally { await admin.query('ROLLBACK'); resume(); }
    value(await pending);
    expect(acquired).toBe(false);
  });

  it('parses an actual stored workbook, freezes contributors/material, and supports another authorized manager', async () => {
    const c = await candidate();
    expect(c.state).toBe('awaiting-evidence');
    expect(c.key.version).toBe(1);
    expect(c.readinessReasons).toContain('AWAITING_APPROVAL');
    value(await service.candidate(actor('other'), c.key.candidateId, 1));
    expect(await service.candidate(actor('agent'), c.key.candidateId, 1)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const persisted = (await admin.query('SELECT * FROM content_intake.candidate_versions WHERE candidate_id=$1', [c.key.candidateId])).rows[0];
    expect(persisted.digest).toBe(c.key.digest);
    expect(persisted.material.contributors).toEqual(['enabler','other']);
    expect(persisted.material.entries[0].answerText).toBe('第一行。\n第二行。');
    expect(persisted.material.entries[0].internalNote).toBe('内部说明');
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM public.import_batches')).rows[0].count).toBe('0');
  });

  it('keeps the old candidate on bad input and durably reopens the actual error report', async () => {
    const c = await candidate();
    const req = await input('bad-revision', c.key, [['bad','标题','','','','','','启用','','','','','','','false']]);
    const j = value(await service.receive(actor('enabler'), 'source-a', req));
    expect(await service.parse(actor('enabler'), j.jobId)).toMatchObject({ ok: false, reason: 'FILE_INVALID' });
    const report = value(await service.job(actor('other'), j.jobId));
    expect(report.state).toBe('failed');
    expect(report.reportObjectId).not.toBeNull();
    expect(report.issues.some(i => i.location.sheet === 'FAQ' && i.location.row === 2 && i.location.column === 3)).toBe(true);
    const original = value(await service.candidate(actor('enabler'), c.key.candidateId, 1));
    expect(original.state).toBe('awaiting-evidence');
    expect(original.key.digest).toBe(c.key.digest);
  });

  it('serializes two revisions against one key and prevents cancelled material from reviving', async () => {
    const c = await candidate();
    const a = value(await service.receive(actor('enabler'), 'source-a', await input('revision-a', c.key)));
    const b = value(await service.receive(actor('enabler'), 'source-a', await input('revision-b', c.key)));
    const otherService = createContentIntakeService(pool, store);
    const results = await Promise.all([service.parse(actor('enabler'), a.jobId), otherService.parse(actor('enabler'), b.jobId)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    const next = value(results.find(r => r.ok)!);
    expect(next.key.version).toBe(2);
    expect(value(await service.candidate(actor('enabler'), c.key.candidateId, 1)).state).toBe('invalidated');
    const cancel = { operationId: 'cancel-one', key: next.key };
    expect(value(await service.cancel(actor('other'), cancel)).state).toBe('cancelled');
    expect(value(await service.cancel(actor('other'), cancel)).state).toBe('cancelled');
    expect(await service.receive(actor('enabler'), 'source-a', await input('after-cancel', next.key))).toMatchObject({ ok: false, reason: 'MATERIAL_CHANGED' });
    expect((await admin.query("SELECT count(*) FROM content_intake.write_attempts WHERE action='cancel'")).rows[0].count).toBe('1');
  });

  it('reserves quotas atomically and records parser cancellation without a candidate', async () => {
    const reqs: C['IntakeReceive'][] = [];
    for (let i = 0; i < 11; i++) reqs.push(await input(`quota-${i}`));
    const results = await Promise.all(reqs.map(req => service.receive(actor('enabler'), 'source-a', req)));
    expect(results.filter(r => r.ok)).toHaveLength(10);
    expect(results.find(r => !r.ok)).toMatchObject({ ok: false, reason: 'QUOTA_EXCEEDED' });
    const j = value(results.find(r => r.ok)!);
    const abort = new AbortController(); abort.abort();
    expect(await service.parse(actor('enabler'), j.jobId, abort.signal)).toMatchObject({ ok: false });
    expect(value(await service.job(actor('enabler'), j.jobId)).state).toBe('cancelled');
    expect((await admin.query('SELECT count(*) FROM content_intake.candidate_versions')).rows[0].count).toBe('0');
  });

  it('rechecks revocation after waiting on the same content lock', async () => {
    await admin.query('BEGIN');
    await admin.query('SELECT backend_review.lock_content()');
    const request = service.authorization(actor('enabler'), 'source-a', 'import');
    await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成撤权' WHERE grant_id='business-enabler-import'");
    await admin.query('COMMIT');
    expect(await request).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('resumes a durable parsing job after restart and replays its successful result', async () => {
    const j = value(await service.receive(actor('enabler'), 'source-a', await input('restart')));
    await admin.query("UPDATE content_intake.parse_jobs SET state='parsing' WHERE job_id=$1", [j.jobId]);
    const restarted = createContentIntakeService(pool, store);
    const c = value(await restarted.parse(actor('enabler'), j.jobId));
    const replay = value(await restarted.parse(actor('enabler'), j.jobId));
    expect(replay.key).toEqual(c.key);
    expect((await admin.query('SELECT count(*) FROM content_intake.candidate_versions')).rows[0].count).toBe('1');
  });

  it('cannot freeze after import permission is revoked during object I/O, and releases the failed job slot', async () => {
    const j = value(await service.receive(actor('enabler'), 'source-a', await input('revoke-during-parse')));
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const slow = createContentIntakeService(pool, { ...store, async readPayload(id) {
      entered(); await gate; return store.readPayload(id);
    } });
    const pending = slow.parse(actor('enabler'), j.jobId);
    await reading;
    value(await service.changeGrant(actor('director'), 'business-enabler-import',
      { operationId: 'revoke-import', expectedVersion: 1, change: 'revoke', stewardPrincipalId: null, reason: '合成撤权竞争' }));
    resume();
    expect(await pending).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect((await admin.query('SELECT state FROM content_intake.parse_jobs WHERE job_id=$1', [j.jobId])).rows[0].state).toBe('failed');
    expect((await admin.query('SELECT count(*) FROM content_intake.candidate_versions')).rows[0].count).toBe('0');
  });

  it('refuses expiry while queued and unknown wire fields without persisting mutations', async () => {
    expect(await service.grantBatch(actor('director'), { ...batch('manager'), actorPrincipalId: 'director' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    await admin.query('BEGIN');
    await admin.query('SELECT backend_review.lock_content()');
    await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('enabler',2,ARRAY['dept-a'],'job-enabler',true,
      statement_timestamp()-interval '10 seconds',statement_timestamp()+interval '0.2 seconds',repeat('b',64))`);
    await admin.query("UPDATE content_intake.principals SET current_facts_version=2 WHERE principal_id='enabler'");
    const waiting = service.authorization(actor('enabler'), 'source-a', 'import');
    await admin.query('SELECT pg_sleep(0.25)');
    await admin.query('COMMIT');
    expect(await waiting).toMatchObject({ ok: false, reason: 'ORG_FACTS_UNAVAILABLE' });
    expect((await admin.query("SELECT count(*) FROM content_intake.grants WHERE recipient_id='manager'")).rows[0].count).toBe('0');
  });

  it('round-trips the full review package and reaches ready with independent source confirmation and routine self-review', async () => {
    const c = await routine();
    const before = (await admin.query('SELECT canonical_material FROM content_intake.candidate_versions')).rows[0].canonical_material;
    const r = value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    const bytes = await store.readPayload(r.reviewPackageObjectId);
    expect(digest(bytes)).toBe(r.reviewPackageSha256);
    const actual = JSON.parse(provider.packages.get(provider.latest().attachmentFileCode)!.toString());
    expect(actual).toMatchObject({ format:'intake-review-package-v1',key:c.key,material:{ contributors:['enabler','other'],
      entries:[{ answerText:'第一行。\n第二行。',internalNote:'内部说明' }],risk:{ level:'routine' } } });
    expect(actual.material.differences).toHaveLength(1);
    provider.approve('enabler');
    expect(value(await refresh(c)).state).toBe('approved');
    expect(value(await service.candidate(actor('other'),c.key.candidateId,1)).readinessReasons).toEqual(['SOURCE_CONFIRMATION_REQUIRED']);
    const confirmation = await confirm(c);
    expect(value(confirmation.result)).toMatchObject({ state:'ready',sourceEvidenceVersion:1,approvalEvidenceVersion:1,key:c.key });
    expect(value(await service.confirmSource(actor('enabler'),confirmation.req)).state).toBe('ready');
    expect((await admin.query('SELECT canonical_material FROM content_intake.candidate_versions')).rows[0].canonical_material).toBe(before);
    expect((await admin.query("SELECT response->>'reason' AS reason FROM backend_review.receipts WHERE operation='intake:source-confirm'")).rows[0].reason).toBe('合成人工确认来源');
    expect((await admin.query('SELECT count(*) FROM public.import_batches')).rows[0].count).toBe('0');
    expect((await admin.query('SELECT count(*) FROM public.content_releases')).rows[0].count).toBe('0');
  });

  it('requires a qualified noncontributor for critical changes and verifies decision-time history separately from current eligibility', async () => {
    const c = await candidate();
    value((await confirm(c)).result);
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    for (const contributor of ['enabler','other']) {
      provider.approve(contributor);
      expect(await refresh(c,`self-${contributor}`)).toMatchObject({ ok:false,reason:'HUMAN_REVIEW_REQUIRED' });
    }
    provider.approve('reviewer');
    expect(value(await refresh(c)).state).toBe('approved');
    expect(value(await service.candidate(actor('enabler'),c.key.candidateId,1)).state).toBe('ready');
    value(await service.changeGrant(actor('director'),'business-reviewer-review',
      { operationId:'revoke-reviewer',expectedVersion:1,change:'revoke',stewardPrincipalId:null,reason:'合成审核者撤权' }));
    // Historical PASS stays valid; it cannot authorize a new publication by an ineligible reviewer.
    expect(value(await refresh(c,'after-revocation')).state).toBe('approved');
    expect(value(await service.candidate(actor('enabler'),c.key.candidateId,1))).toMatchObject({ state:'awaiting-evidence',readinessReasons:['PERMISSION_CHANGED'] });
  });

  it('rejects a historical PASS before the review grant or before the qualifying role existed', async () => {
    const c = await routine();
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    const old = new Date(Date.now()-30_000).toISOString();
    provider.approve('reviewer',old);
    expect(await refresh(c)).toMatchObject({ ok:false,reason:'HUMAN_REVIEW_REQUIRED' });
    const beforeGrant = new Date((await admin.query('SELECT clock_timestamp() AS time')).rows[0].time).toISOString();
    value(await service.grantBatch(actor('director'),batch('manager','review','business','late-review-grant')));
    provider.approve('manager',beforeGrant);
    expect(await refresh(c,'before-grant')).toMatchObject({ ok:false,reason:'HUMAN_REVIEW_REQUIRED' });
    await admin.query("INSERT INTO content_intake.role_rules VALUES ('tenant-a','app-a','dept-a','job-enabler',2,'agent') ON CONFLICT (tenant_id,app_id,department_id,job_id) DO UPDATE SET role='agent',policy_version=2");
    const duringAgentRole = new Date((await admin.query('SELECT clock_timestamp() AS time')).rows[0].time).toISOString();
    await admin.query("UPDATE content_intake.role_rules SET role='enabler',policy_version=3 WHERE job_id='job-enabler'");
    provider.approve('reviewer',duringAgentRole);
    expect(await refresh(c,'before-role')).toMatchObject({ ok:false,reason:'HUMAN_REVIEW_REQUIRED' });
    expect((await admin.query('SELECT count(*) FROM content_intake.approval_facts')).rows[0].count).toBe('0');
  });

  it('rejects forged instance/form bindings, automatic PASS, timeline mismatch and attachment substitution without renewing evidence', async () => {
    const c = await routine();
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    provider.approve('enabler');
    const r = value(await refresh(c));
    const instance = provider.latest();
    const original = structuredClone(instance);
    for (const [field,wrong] of [['tenantId','tenant-b'],['appId','app-b'],['nodeId','auto-node'],['createUuid','wrong-uuid'],['instanceCode','wrong-instance']] as const) {
      instance[field]=wrong;
      expect(await refresh(c,`wrong-${field}`)).toMatchObject({ ok:false,reason:'APPROVAL_BINDING' });
      Object.assign(instance,structuredClone(original));
    }
    instance.form.key.digest='b'.repeat(64);
    expect(await refresh(c,'wrong-form')).toMatchObject({ ok:false,reason:'APPROVAL_BINDING' });
    Object.assign(instance,structuredClone(original));
    instance.task!.kind='AUTO_PASS';
    expect(await refresh(c,'auto-pass')).toMatchObject({ ok:false,reason:'HUMAN_REVIEW_REQUIRED' });
    Object.assign(instance,structuredClone(original));
    instance.timeline[0]!.taskId='different-task';
    expect(await refresh(c,'wrong-timeline')).toMatchObject({ ok:false,reason:'HUMAN_REVIEW_REQUIRED' });
    Object.assign(instance,structuredClone(original));
    const bytes = provider.packages.get(instance.attachmentFileCode)!;
    const corrupt = Buffer.from(bytes); corrupt[corrupt.length-2]=33;
    provider.packages.set(instance.attachmentFileCode,corrupt);
    expect(await refresh(c,'wrong-attachment')).toMatchObject({ ok:false,reason:'ATTACHMENT_UNVERIFIED' });
    expect(value(await service.review(actor('other'),c.key)).validUntil).toBe(r.validUntil);
    expect((await admin.query('SELECT count(*) FROM content_intake.approval_facts')).rows[0].count).toBe('1');
    expect(await service.refreshReview(actor('enabler'),{ ...reviewRequest(c,1,'forged-json'),approved:true })).toMatchObject({ ok:false,code:'VALIDATION' });
  });

  it('persists creation before I/O and recovers a lost provider response with one UUID across restart', async () => {
    const c = await routine();
    let lose = true;
    const transport: ApprovalTransport = { ...provider.transport,async create(b,bytes,signal) {
      expect((await admin.query('SELECT count(*) FROM content_intake.review_bindings WHERE create_uuid=$1',[b.createUuid])).rows[0].count).toBe('1');
      await admin.query('BEGIN');
      try { expect((await admin.query('SELECT pg_try_advisory_xact_lock(724019,1) AS unlocked')).rows[0].unlocked).toBe(true); }
      finally { await admin.query('ROLLBACK'); }
      const result = await provider.transport.create(b,bytes,signal);
      if (lose) { lose=false; throw new Error('synthetic provider lost creation response'); }
      return result;
    } };
    const req = reviewRequest(c);
    const first = value(await evidenceService(transport).requestReview(actor('enabler'),req));
    expect(first.state).toBe('creating');
    expect(await service.requestReview(actor('enabler'),reviewRequest(c,1,'new-key'))).toMatchObject({ ok:false,reason:'COMMIT_UNKNOWN' });
    const recovered = value(await evidenceService(transport).requestReview(actor('enabler'),req));
    expect(recovered).toMatchObject({ reviewRequestId:first.reviewRequestId,evidenceVersion:1,reviewPackageSha256:first.reviewPackageSha256 });
    expect(recovered.instanceCode).not.toBeNull();
    expect(provider.instances.size).toBe(1);
    value(await evidenceService(transport).requestReview(actor('enabler'),req));
    expect(provider.calls()).toBe(2);
    expect(await service.requestReview(actor('enabler'),{ ...req,expectedEvidenceVersion:1 })).toMatchObject({ ok:false,reason:'IDEMPOTENCY_CONFLICT' });
  });

  it('invalidates approval work when cancellation or source evidence wins during external I/O', async () => {
    const c = await routine();
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    provider.approve('enabler');
    let during: () => Promise<void> = async () => { value((await confirm(c)).result); };
    const delayed = evidenceService({ ...provider.transport,async instance(b,signal) {
      const snapshot = await provider.transport.instance(b,signal);
      await during(); return snapshot;
    } });
    expect(await delayed.refreshReview(actor('other'),reviewRequest(c,1,'source-race'))).toMatchObject({ ok:false,reason:'APPROVAL_CHANGED' });
    during = async () => { value(await service.cancel(actor('other'),{ operationId:'cancel-during-review',key:c.key })); };
    expect(await delayed.refreshReview(actor('other'),reviewRequest(c,1,'cancel-race'))).toMatchObject({ ok:false,reason:'MATERIAL_CHANGED' });
    expect((await admin.query('SELECT count(*) FROM content_intake.approval_facts')).rows[0].count).toBe('0');
  });

  it('serializes concurrent review replacement and prevents old evidence from marking the candidate ready', async () => {
    const c = await routine();
    value((await confirm(c)).result);
    const requests = await Promise.all([service.requestReview(actor('enabler'),reviewRequest(c)),
      evidenceService().requestReview(actor('other'),reviewRequest(c,0,'other-request'))]);
    expect(requests.filter(r => r.ok)).toHaveLength(1);
    expect((await admin.query('SELECT count(*) FROM content_intake.review_bindings')).rows[0].count).toBe('1');
    provider.approve('enabler');
    value(await refresh(c));
    value(await service.requestReview(actor('enabler'),reviewRequest(c,1,'replace')));
    expect(await refresh(c,'old-evidence')).toMatchObject({ ok:false,reason:'APPROVAL_CHANGED' });
    expect(value(await service.candidate(actor('other'),c.key.candidateId,1)).state).toBe('awaiting-evidence');
    expect((await admin.query('SELECT digest FROM content_intake.candidate_versions')).rows[0].digest).toBe(c.key.digest);
  });

  it('keeps revoked evidence terminal and rejects a late approved response from another service', async () => {
    const c = await routine();
    value((await confirm(c)).result);
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    provider.approve('enabler');
    value(await refresh(c));
    const delayed = evidenceService({ ...provider.transport,async instance(b,signal) {
      const snapshot = await provider.transport.instance(b,signal);
      provider.latest().state='REVOKED';
      expect(value(await refresh(c,'revoke')).state).toBe('revoked');
      return snapshot;
    } });
    const late = await delayed.refreshReview(actor('other'),reviewRequest(c,1,'late-approval'));
    expect(late,JSON.stringify(diagnostics.map(e => e instanceof Error ? e.message : e))).toMatchObject({ ok:false,reason:'APPROVAL_CHANGED' });
    expect(value(await service.candidate(actor('enabler'),c.key.candidateId,1)).readinessReasons).toEqual(['APPROVAL_REVOKED']);
    provider.approve('enabler');
    expect(await refresh(c,'resurrect')).toMatchObject({ ok:false,reason:'APPROVAL_REVOKED' });
    expect((await admin.query('SELECT count(*) FROM content_intake.approval_facts')).rows[0].count).toBe('2');
  });

  it('recovers an approval COMMIT with the original operation even when the provider is now unavailable', async () => {
    const c = await routine();
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    provider.approve('enabler');
    let finishing = false;
    let lost = false;
    const uncertain = { async connect() {
      const client = await pool.connect();
      return new Proxy(client,{ get(target,key) {
        if (key === 'query') return async (sql: string,values?: unknown[]) => {
          const result = await target.query(sql,values);
          if (sql.startsWith('INSERT INTO content_intake.approval_facts')) finishing=true;
          if (sql === 'COMMIT' && finishing && !lost) { lost=true; throw new Error('synthetic lost approval COMMIT'); }
          return result;
        };
        const member: unknown = Reflect.get(target,key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const req = reviewRequest(c,1,'unknown-refresh');
    expect(await createContentIntakeService(uncertain,store,undefined,createApprovalAdapter(route,provider.transport)).refreshReview(actor('other'),req))
      .toMatchObject({ ok:false,commit:'unknown' });
    const after = evidenceService({ ...provider.transport,async instance() { throw new Error('must replay without provider'); } });
    expect(value(await after.refreshReview(actor('other'),req)).state).toBe('approved');
    expect((await admin.query('SELECT count(*) FROM content_intake.approval_facts')).rows[0].count).toBe('1');
  });

  it('projects expiry without renewing facts on reads and refuses a stale or mismatched source confirmation', async () => {
    const c = await routine();
    const confirmed = await confirm(c);
    value(confirmed.result);
    expect(await service.confirmSource(actor('enabler'),{ ...confirmed.req,operationId:'stale-source' })).toMatchObject({ ok:false,reason:'SOURCE_MISMATCH' });
    expect(await service.confirmSource(actor('enabler'),{ ...confirmed.req,operationId:'wrong-file',expectedEvidenceVersion:1,objectSha256:'b'.repeat(64) })).toMatchObject({ ok:false,reason:'SOURCE_MISMATCH' });
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    provider.approve('enabler');
    value(await refresh(c));
    await admin.query(`INSERT INTO content_intake.approval_facts SELECT review_request_id,2,revocation_generation,state,
      statement_timestamp()-interval '299 seconds',statement_timestamp()+interval '0.1 seconds',raw_facts_digest,
      package_verified_sha256,human_task_id,reviewer_id,reviewer_facts_version,statement_timestamp()-interval '299 seconds'
      FROM content_intake.approval_facts WHERE facts_version=1`);
    await admin.query('UPDATE content_intake.approval_current SET facts_version=2');
    await admin.query('SELECT pg_sleep(0.15)');
    const old = value(await service.review(actor('other'),c.key));
    expect(old.state).toBe('unavailable');
    expect(value(await service.candidate(actor('other'),c.key.candidateId,1))).toMatchObject({ state:'awaiting-evidence',readinessReasons:['APPROVAL_UNAVAILABLE'] });
    const calls = provider.instanceCalls();
    value(await service.review(actor('other'),c.key));
    expect(provider.instanceCalls()).toBe(calls);
    expect((await admin.query('SELECT count(*) FROM content_intake.approval_facts')).rows[0].count).toBe('2');
  });

  it('inherits exact candidate and approval lineage and propagates later revocation to both releases', async () => {
    const c = await routine();
    value((await confirm(c)).result);
    const r = value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    provider.approve('enabler');
    value(await refresh(c));
    // Seed real four-domain release rows via the existing test support. This tests
    // revocation propagation, not the still-unimplemented P2 publish transaction.
    await seedSyntheticG1aRelease(admin);
    const original = (await admin.query('SELECT release_id FROM public.content_releases')).rows[0].release_id as string;
    await admin.query('BEGIN');
    await admin.query("SELECT set_config('app.publishing','on',true)");
    await admin.query(`INSERT INTO public.content_releases(release_id,release_seq,status,source_binding_hash)
      SELECT 'inherited-synthetic-release',2,'published',source_binding_hash FROM public.content_releases WHERE release_id=$1`,[original]);
    await admin.query(`INSERT INTO public.release_source_bindings(release_id,domain,source_version_id)
      SELECT 'inherited-synthetic-release',domain,source_version_id FROM public.release_source_bindings WHERE release_id=$1`,[original]);
    await admin.query('COMMIT');
    await admin.query("INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES ($1,'intake-v2.1')",[original]);
    await admin.query(`INSERT INTO content_intake.release_lineage VALUES ($1,'source-a','faq-one',1,$2,1,$3,'2099-01-01T00:00:00Z')`,[original,c.key.candidateId,r.reviewRequestId]);
    await admin.query('BEGIN');
    await admin.query('SELECT backend_review.lock_content()');
    await admin.query("SELECT content_intake.inherit_legacy_catalog($1,'inherited-synthetic-release')",[original]);
    await admin.query('COMMIT');
    const inherited = await admin.query(`SELECT to_jsonb(l)-'release_id' AS lineage
      FROM content_intake.release_lineage l ORDER BY release_id`);
    expect(inherited.rows).toHaveLength(2);
    expect(inherited.rows[0]).toEqual(inherited.rows[1]);
    provider.latest().state='REVOKED';
    expect(value(await refresh(c,'cascade-revoke')).state).toBe('revoked');
    const revoked = (await admin.query('SELECT release_id,reason FROM content_intake.release_revocations ORDER BY release_id')).rows;
    expect(revoked).toEqual([original,'inherited-synthetic-release'].sort().map(release_id => ({ release_id,reason:'APPROVAL_REVOKED' })));
    value(await refresh(c,'repeated-revoke'));
    expect((await admin.query('SELECT count(*) FROM content_intake.release_revocations')).rows[0].count).toBe('2');
  });

  it('binds evidence freshness to verification start and leaves no locks held while reading the provider', async () => {
    const c = await routine();
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    provider.approve('enabler');
    let finished = 0;
    const delayed = evidenceService({ ...provider.transport,async instance(b,signal) {
      await admin.query('BEGIN');
      try {
        expect((await admin.query('SELECT pg_try_advisory_xact_lock(724019,1) AS unlocked')).rows[0].unlocked).toBe(true);
        await admin.query('SELECT pg_sleep(0.1)');
        finished = new Date((await admin.query('SELECT clock_timestamp() AS time')).rows[0].time).getTime();
      } finally { await admin.query('ROLLBACK'); }
      return provider.transport.instance(b,signal);
    } });
    const r = value(await delayed.refreshReview(actor('other'),reviewRequest(c,1,'slow-verification')));
    expect(Date.parse(r.validUntil!)-Date.parse(r.checkedAt!)).toBe(300_000);
    expect(finished-Date.parse(r.checkedAt!)).toBeGreaterThanOrEqual(90);
  });

  it.each(['facts-expire','facts-disabled','grant-expires'] as const)('rejects ambiguous sub-millisecond eligibility: %s', async kind => {
    const c = await routine();
    const at = new Date(Date.now()+250).toISOString();
    if (kind === 'grant-expires') {
      await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成精度边界' WHERE grant_id='business-reviewer-review'");
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,parent_grant_id,steward_id)
        VALUES ('fractional-expiry','business','director','reviewer','tenant-a','app-a','scope-a','source-a','review',clock_timestamp(),$1::timestamptz+interval '0.2 milliseconds','合成自然到期','root-review','director')`,[at]);
    } else {
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('reviewer',2,ARRAY['dept-a'],'job-enabler',$2,
        $1::timestamptz+CASE WHEN $2 THEN interval '-10 milliseconds' ELSE interval '0.2 milliseconds' END,
        $1::timestamptz+CASE WHEN $2 THEN interval '0.2 milliseconds' ELSE interval '1 minute' END,repeat('b',64))`,[at,kind === 'facts-expire']);
      await admin.query(`INSERT INTO content_intake.principal_facts VALUES ('reviewer',3,ARRAY['dept-a'],'job-enabler',true,
        $1::timestamptz+interval '1 millisecond',$1::timestamptz+interval '1 minute',repeat('c',64))`,[at]);
      await admin.query("UPDATE content_intake.principals SET current_facts_version=3 WHERE principal_id='reviewer'");
    }
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    await admin.query('SELECT pg_sleep(0.3)');
    provider.approve('reviewer',at);
    expect(await refresh(c)).toMatchObject({ ok:false,reason:'HUMAN_REVIEW_REQUIRED' });
    expect((await admin.query('SELECT count(*) FROM content_intake.approval_facts')).rows[0].count).toBe('0');
  });

  it('does not backdate authority from an uncommitted grant and recovers with a new review after commit', async () => {
    const c = await routine();
    value(await service.requestReview(actor('enabler'),reviewRequest(c)));
    let reached!: () => void;
    const written = new Promise<void>(resolve => { reached=resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release=resolve; });
    const paused = { async connect() {
      const client = await pool.connect();
      return new Proxy(client,{ get(target,key) {
        if (key === 'query') return async (sql: string,values?: unknown[]) => {
          const result = await target.query(sql,values);
          if (sql.startsWith('INSERT INTO backend_review.receipts') && values?.[1] === 'intake:grants') { reached(); await gate; }
          return result;
        };
        const member: unknown = Reflect.get(target,key);
        return typeof member === 'function' ? member.bind(target) : member;
      } }) as PoolClient;
    } };
    const pending = createContentIntakeService(paused,store).grantBatch(actor('director'),batch('manager','review'));
    await written;
    try {
      await admin.query('SELECT pg_sleep(0.01)');
      provider.approve('manager');
    } finally { release(); }
    value(await pending);
    expect(await refresh(c)).toMatchObject({ ok:false,reason:'HUMAN_REVIEW_REQUIRED' });
    value(await service.requestReview(actor('enabler'),reviewRequest(c,1,'after-grant-commit')));
    provider.approve('manager');
    expect(value(await refresh(c,'qualified-later',2)).state).toBe('approved');
  });
});
