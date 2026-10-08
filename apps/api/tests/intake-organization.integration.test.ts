import { createHash } from 'node:crypto';
import path from 'node:path';
import { Pool, type Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createFeishuOrganizationObserver } from '../experiments/intake-organization/feishu-observer.js';
import { nativeOrganizationFixture } from './support/intake-organization-native.js';
import { createOrganizationFactsWriter } from '../experiments/intake-organization/facts-writer.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createProductAuthService } from '../src/product-auth-service.js';
import type { ProductAuthService, AuthenticatedUser } from '../src/auth-service.js';
import type { IntakePool } from '../src/content-intake/transaction.js';

const enabled=process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION==='1';
describe.skipIf(!enabled)('offline organization refresh through frozen storage and real usage',()=>{
  let harness:Pg15Harness, admin:Client, pool:Pool, writerPool:Pool;
  let service:ReturnType<typeof createContentIntakeService>, write:ReturnType<typeof createOrganizationFactsWriter>;
  let auth:ProductAuthService, actor:AuthenticatedUser;
  const diagnostics:unknown[]=[];
  const scope={tenantId:'tenant-a',appId:'app-a'};
  beforeEach(async()=>{
    harness=new Pg15Harness();harness.start();const db=harness.createDatabase('organization');
    admin=await harness.connect(db.config);await applyDatabaseMigrations(admin);await seedIntakeSyntheticHost(admin);
    // Only this disposable cluster receives the experimental role. No migration or
    // production grants are changed; this is a candidate least-privilege proof.
    await admin.query(`CREATE ROLE synthetic_facts_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      GRANT USAGE ON SCHEMA content_intake,backend_review TO synthetic_facts_writer;
      GRANT SELECT ON content_intake.principals,content_intake.principal_facts TO synthetic_facts_writer;
      GRANT INSERT ON content_intake.principal_facts TO synthetic_facts_writer;
      GRANT UPDATE(current_facts_version,revocation_generation) ON content_intake.principals TO synthetic_facts_writer;
      GRANT EXECUTE ON FUNCTION backend_review.lock_content() TO synthetic_facts_writer;
      CREATE ROLE synthetic_org_auth LOGIN NOINHERIT; GRANT app_backend_auth TO synthetic_org_auth;`);
    pool=new Pool({...db.config,max:3});writerPool=new Pool({...db.config,user:'synthetic_facts_writer',max:2});
    diagnostics.length=0;write=createOrganizationFactsWriter(writerPool,scope,e=>diagnostics.push(e));
    service=createContentIntakeService(pool,createContentObjectStore(path.join(harness.root,db.name)),(_id,e)=>diagnostics.push(e),undefined,{requireProductSession:true});
    auth=await createProductAuthService({connectionString:`postgresql://synthetic_org_auth@localhost/${db.name}?${new URLSearchParams({host:harness.socket,port:String(harness.port)})}`,
      poolMax:2,connectionTimeoutMs:2000,readinessTimeoutMs:3000},{authorizeUrl:state=>`http://127.0.0.1/authorize?state=${state}`,exchange:async code=>code,close:()=>undefined},'mock');
    const verifier='v'.repeat(43),login=await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
    await auth.callback(new URL(login.authorize_url).searchParams.get('state')!,'agent');
    const session=await auth.exchange(login.login_id,verifier);expect(session).not.toBeNull();
    actor=(await auth.authenticate({authorization:`Bearer ${session!.access_token}`}))!;
  },60_000);
  afterEach(async()=>{await auth?.close();await pool?.end();await writerPool?.end();await admin?.end();harness?.stop();},60_000);
  async function observation(expectedFactsVersion=1,changes:Record<string,unknown>={}) {
    const now=(await admin.query('SELECT clock_timestamp() AS time')).rows[0].time as Date;
    return {principalId:'agent',expectedFactsVersion,departmentIds:['dept-a'],jobId:'job-agent',enabled:true,
      checkedAt:now.toISOString(),validUntil:new Date(now.getTime()+60_000).toISOString(),...changes};
  }
  async function entitlement(){
    const result=await service.issueEntitlement(actor,{shopId:'shop-a',contextGeneration:1,productIds:[],scenarioIds:[],releaseId:null});
    expect(result,JSON.stringify({result,diagnostics})).toMatchObject({ok:true});if(!result.ok)throw new Error(result.reason);return result.value;
  }
  const state=async()=>(await admin.query("SELECT current_facts_version,revocation_generation FROM content_intake.principals WHERE principal_id='agent'")).rows[0];

  it('refreshes with a non-owner writer; exact replay changes no deadline or generation and old lease stays bounded',async()=>{
    const lease=await entitlement(), input=await observation();
    expect(await write(input),JSON.stringify(diagnostics)).toMatchObject({ok:true,status:'applied',factsVersion:2});
    expect(await write({...input,departmentIds:[...input.departmentIds]})).toMatchObject({ok:true,status:'replayed',currentFactsVersion:2});
    expect(await state()).toMatchObject({current_facts_version:'2',revocation_generation:'0'});
    const snap=await service.snapshot(actor,{entitlementId:lease.entitlementId});
    expect(snap).toMatchObject({ok:true});
    const rows=await admin.query("SELECT valid_until FROM content_intake.entitlements WHERE principal_id='agent'");
    expect(rows.rows[0].valid_until.toISOString()).toBe(lease.validUntil);
    expect((await admin.query("SELECT count(*) FROM content_intake.principal_facts WHERE principal_id='agent'")).rows[0].count).toBe('2');
  });

  it('disables actual usage and an old enabled replay cannot restore it; role changes revoke the old qualification',async()=>{
    const old=await entitlement(), enabledInput=await observation();expect(await write(enabledInput)).toMatchObject({ok:true});
    expect(await write(await observation(2,{enabled:false}))).toMatchObject({ok:true});
    expect(await service.snapshot(actor,{entitlementId:old.entitlementId})).toMatchObject({ok:false,reason:'ORG_FACTS_UNAVAILABLE'});
    expect(await write(enabledInput)).toMatchObject({ok:true,status:'replayed',currentFactsVersion:3});
    expect(await service.authorizations(actor,{})).toMatchObject({ok:false,reason:'ORG_FACTS_UNAVAILABLE'});
    expect(await write(await observation(3,{jobId:'job-lead'}))).toMatchObject({ok:true});
    expect(await service.snapshot(actor,{entitlementId:old.entitlementId})).toMatchObject({ok:false,reason:'PERMISSION_CHANGED'});
    expect(await state()).toMatchObject({revocation_generation:'2'});
    // Re-enabling cannot invent import rights for a previously query-only seat.
    const menu=await service.authorizations(actor,{});expect(menu).toMatchObject({ok:true});
    if(menu.ok)expect(menu.value.capabilities.flatMap(c=>c.actions)).toEqual(['query']);
    await entitlement();
  });

  it('rejects stale, future, expired, malformed and cross-scope snapshots without mutation',async()=>{
    const valid=await observation();
    for(const changes of [{principalId:'missing'},{checkedAt:'2020-01-01T00:00:00.000Z',validUntil:'2020-01-01T00:01:00.000Z'},
      {checkedAt:'2090-01-01T00:00:00.000Z',validUntil:'2090-01-01T00:01:00.000Z'},
      {departmentIds:[]},{departmentIds:['dept-a','dept-a']},{enabled:'true'},{expectedFactsVersion:0},{expectedFactsVersion:Number.MAX_SAFE_INTEGER},
      {validUntil:new Date(Date.parse(valid.checkedAt)+300_001).toISOString()},{approved:true}]) {
      expect(await write({...valid,...changes})).toMatchObject({ok:false,commit:'rolled_back'});
    }
    const other=createOrganizationFactsWriter(writerPool,{...scope,tenantId:'tenant-b'});
    expect(await other(valid)).toMatchObject({ok:false,reason:'SUBJECT_UNAVAILABLE'});
    expect(await state()).toMatchObject({current_facts_version:'1',revocation_generation:'0'});
  });

  it('serializes concurrent snapshots and refuses a newer version with an older observation',async()=>{
    const a=await observation(),b={...a,enabled:false};
    const results=await Promise.all([write(a),write(b)]);
    expect(results.filter(r=>r.ok&&r.status==='applied')).toHaveLength(1);
    expect(results.filter(r=>!r.ok&&r.reason==='VERSION_CONFLICT')).toHaveLength(1);
    expect(await write({...a,expectedFactsVersion:2})).toMatchObject({ok:false,reason:'STALE_OBSERVATION'});
    expect(await state()).toMatchObject({current_facts_version:'2'});
  });

  it('recovers a lost commit using the exact immutable version after writer recreation',async()=>{
    const uncertainPool:IntakePool={connect:async()=>{
      const client=await writerPool.connect();return new Proxy(client,{get(target,key){
        if(key==='query')return async(text:string,values?:unknown[])=>{const result=await target.query(text,values);if(text==='COMMIT')throw new Error('synthetic lost response');return result;};
        const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;
      }});
    }};
    const input=await observation(1,{enabled:false});
    expect(await createOrganizationFactsWriter(uncertainPool,scope)(input)).toMatchObject({ok:false,commit:'unknown'});
    expect(await createOrganizationFactsWriter(writerPool,scope)(input)).toMatchObject({ok:true,status:'replayed',factsVersion:2});
    expect(await state()).toMatchObject({current_facts_version:'2',revocation_generation:'1'});
    expect(await write({...input,enabled:true})).toMatchObject({ok:false,reason:'VERSION_CONFLICT'});
  });

  it('rolls back an observation that expires after writing but before commit',async()=>{
    const input=await observation();input.validUntil=new Date(Date.parse(input.checkedAt)+1000).toISOString();
    let wrote=false;
    const delayed:IntakePool={connect:async()=>{
      const client=await writerPool.connect();return new Proxy(client,{get(target,key){
        if(key==='query')return async(text:string,values?:unknown[])=>{
          const result=await target.query(text,values);
          if(text.startsWith('UPDATE content_intake.principals')){wrote=true;await target.query('SELECT pg_sleep(1.1)');}
          return result;
        };
        const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;
      }});
    }};
    expect(await createOrganizationFactsWriter(delayed,scope)(input)).toMatchObject({ok:false,reason:'STALE_OBSERVATION',commit:'rolled_back'});
    expect(wrote).toBe(true);expect(await state()).toMatchObject({current_facts_version:'1',revocation_generation:'0'});
    expect((await admin.query("SELECT count(*) FROM content_intake.principal_facts WHERE principal_id='agent'")).rows[0].count).toBe('1');
  });

  it('department changes remove access and do not rewrite grants or silently choose a role',async()=>{
    const old=await entitlement();expect(await write(await observation(1,{departmentIds:['unmapped-department']}))).toMatchObject({ok:true});
    expect(await service.issueEntitlement(actor,{shopId:'shop-a',contextGeneration:2,productIds:[],scenarioIds:[],releaseId:null})).toMatchObject({ok:false});
    expect(await service.snapshot(actor,{entitlementId:old.entitlementId})).toMatchObject({ok:false});
    expect(await state()).toMatchObject({revocation_generation:'1'});
    expect((await admin.query("SELECT count(*) FROM content_intake.grants WHERE recipient_id='agent' AND revoked_at IS NULL")).rows[0].count).toBe('1');
  });

  it('consumes native-shaped observations through the restricted writer and revokes real usage on status/department change',async()=>{
    const f=nativeOrganizationFixture();
    const now=async()=>((await admin.query('SELECT clock_timestamp() AS time')).rows[0].time as Date).getTime();
    const observe=createFeishuOrganizationObserver(scope,f.transport,now);
    const binding={...scope,principalId:'agent',openId:f.person.open_id,expectedFactsVersion:1};
    const old=await entitlement();
    const first=await observe(binding);expect(first).toMatchObject({ok:true});if(!first.ok)throw new Error(first.reason);
    expect(await write(first.snapshot)).toMatchObject({ok:true,status:'applied'});
    f.person.status.is_frozen=true;
    const disabled=await observe({...binding,expectedFactsVersion:2});expect(disabled).toMatchObject({ok:true});if(!disabled.ok)throw new Error(disabled.reason);
    expect(await write(disabled.snapshot)).toMatchObject({ok:true,status:'applied'});
    expect(await service.snapshot(actor,{entitlementId:old.entitlementId})).toMatchObject({ok:false,reason:'ORG_FACTS_UNAVAILABLE'});
    expect(await write(first.snapshot)).toMatchObject({ok:true,status:'replayed',currentFactsVersion:3});
    f.person.status.is_frozen=false;f.person.department_ids=['unmapped-department'];
    const moved=await observe({...binding,expectedFactsVersion:3});expect(moved).toMatchObject({ok:true});if(!moved.ok)throw new Error(moved.reason);
    expect(await write(moved.snapshot)).toMatchObject({ok:true,status:'applied'});
    expect(await service.issueEntitlement(actor,{shopId:'shop-a',contextGeneration:2,productIds:[],scenarioIds:[],releaseId:null})).toMatchObject({ok:false});
    expect(await state()).toMatchObject({current_facts_version:'4',revocation_generation:'2'});
  });

  it('produces no writable snapshot when a later directory page fails; facts and expiry remain unchanged',async()=>{
    const f=nativeOrganizationFixture(), original=f.transport.jobTitles;
    f.transport.jobTitles=async(token,signal)=>token ? JSON.stringify({code:999,msg:'synthetic denied'}) : original(token,signal);
    const before=(await admin.query("SELECT facts_version,checked_at,valid_until FROM content_intake.principal_facts WHERE principal_id='agent'")).rows;
    const observed=await createFeishuOrganizationObserver(scope,f.transport,async()=>Date.now())({...scope,principalId:'agent',openId:f.person.open_id,expectedFactsVersion:1});
    expect(observed).toEqual({ok:false,reason:'DEPENDENCY_UNAVAILABLE'});
    expect((await admin.query("SELECT facts_version,checked_at,valid_until FROM content_intake.principal_facts WHERE principal_id='agent'")).rows).toEqual(before);
    expect(await state()).toMatchObject({current_facts_version:'1',revocation_generation:'0'});
  });

  it('has no write authority over identity, role policy, grants, history or publication',async()=>{
    expect((await writerPool.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0])
      .toEqual({rolsuper:false,rolcreatedb:false,rolcreaterole:false});
    for(const sql of ["UPDATE content_intake.principals SET user_id='forged' WHERE principal_id='agent'",
      "UPDATE content_intake.principal_facts SET enabled=false WHERE principal_id='agent'",
      'DELETE FROM content_intake.principal_facts',"UPDATE content_intake.role_rules SET role='director'",
      'DELETE FROM content_intake.grants','DELETE FROM public.content_current','CREATE TABLE content_intake.forged(id int)']) {
      await expect(writerPool.query(sql)).rejects.toMatchObject({code:'42501'});
    }
    expect(await write(await observation())).toMatchObject({ok:true});
  });
});
