import { parseContractSchema } from '@customer-agent/contracts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool, type Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { contentIntakeGrantRoutes } from '../src/content-intake/grants-http.js';
import { contentIntakeManagementRoutes } from '../src/content-intake/management-http.js';
import { contentIntakeUsageRoutes } from '../src/content-intake/usage-http.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createProductAuthService } from '../src/product-auth-service.js';
import type { ProductAuthService } from '../src/auth-service.js';
import { seedIntakeSyntheticHost, INTAKE_SYNTHETIC_IDENTITIES } from './support/intake-synthetic-seed.js';
import { createSyntheticConsumerPool } from '../experiments/intake-runtime/consumer-pool.js';
const enabled=process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION==='1';
describe.skipIf(!enabled)('business permission HTTP and PG15 (synthetic)',()=>{
 let harness:Pg15Harness,admin:Client,pool:Pool,auth:ProductAuthService,app:FastifyInstance,origin:string;
 const tokens:Record<string,string>={};const diagnostics:unknown[]=[];
 const report=(_id:string,error:unknown)=>diagnostics.push(error);
 beforeEach(async()=>{
  harness=new Pg15Harness();harness.start();const db=harness.createDatabase('grant_ui');admin=await harness.connect(db.config);
  await applyDatabaseMigrations(admin);await seedIntakeSyntheticHost(admin);
  for(const file of ['session-lock.sql','purpose-acl.sql','consumer-acl.sql'])await admin.query(await readFile(new URL(`../experiments/intake-runtime/${file}`,import.meta.url),'utf8'));
  pool=new Pool({...db.config,user:'intake_business',max:2});const restricted=await createSyntheticConsumerPool(pool);
  await admin.query('CREATE ROLE synthetic_grant_auth LOGIN NOINHERIT; GRANT app_backend_auth TO synthetic_grant_auth');
  auth=await createProductAuthService({connectionString:`postgresql://synthetic_grant_auth@localhost/${db.name}?${new URLSearchParams({host:harness.socket,port:String(harness.port)})}`,poolMax:1,connectionTimeoutMs:2000,readinessTimeoutMs:3000},
    {authorizeUrl:s=>`http://127.0.0.1/auth?state=${s}`,exchange:async c=>c,close:()=>undefined},'mock');
  for(const [id] of INTAKE_SYNTHETIC_IDENTITIES){const verifier='v'.repeat(43);const login=await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
   await auth.callback(new URL(login.authorize_url).searchParams.get('state')!,id);tokens[id]=(await auth.exchange(login.login_id,verifier))!.access_token;}
  const store=createContentObjectStore(path.join(harness.root,db.name));const principalLabels=({principalId}:{principalId:string})=>INTAKE_SYNTHETIC_IDENTITIES.find(r=>r[0]===principalId)?.[2]??null;
  const service=createContentIntakeService(restricted,store,report,undefined,{requireProductSession:true,principalLabels});
  app=Fastify();await app.register(contentIntakeGrantRoutes,{auth,service,report});
  await app.register(contentIntakeUsageRoutes,{auth,usage:service,report});await app.register(contentIntakeManagementRoutes,{auth,pool:restricted,store,principalLabels,report});
  origin=await app.listen({host:'127.0.0.1',port:0});diagnostics.length=0;
 },60000);
 afterEach(async()=>{await app?.close();await auth?.close();await pool?.end();await admin?.end();harness?.stop();},60000);
 async function http(url:string,method='GET',body?:unknown,who='director'){
  const response=await fetch(origin+url,{method,headers:{authorization:`Bearer ${tokens[who]}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(response.status>=500)throw new Error(JSON.stringify({value,diagnostics:diagnostics.map(String)}));return {status:response.status,value};
 }
 async function batch(operationId='grant-test'){
  const a=parseContractSchema('IntakeAuthorization',(await http('/v1/intake/authorization')).value);
  const directory=parseContractSchema('IntakePrincipalPage',(await http('/v1/intake/principals?sourceId=source-a&purpose=grant-recipient')).value);
  const person=directory.items.find((p:{principalId:string})=>p.principalId==='agent')!;
  return {operationId,issuerFactsVersion:a.factsVersion,policyVersion:a.policyVersion,items:[{kind:'business',recipientPrincipalId:person.principalId,
   recipientFactsVersion:person.factsVersion,action:'query',scope:a.capabilities[0]!.scope,startsAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),reason:'合成权限配置'}]};
 }
 async function counts(){return (await admin.query(`SELECT (SELECT count(*) FROM content_intake.grants) AS grants,(SELECT count(*) FROM content_intake.grant_history) AS history,
  (SELECT count(*) FROM backend_review.receipts) AS receipts,(SELECT revocation_generation FROM content_intake.principals WHERE principal_id='agent') AS generation`)).rows[0];}
 it('selects names, previews without writes, saves/replays/lists, then revokes a disabled recipient',async()=>{
  const request=await batch();const before=await counts();
  const preview=await http('/v1/intake/grants/preview','POST',request);expect(preview.status).toBe(200);expect(parseContractSchema('IntakeGrantList',preview.value).items[0]!.grantId).toMatch(/^preview_/);expect(await counts()).toEqual(before);
  const saved=await http('/v1/intake/grants','POST',request);expect(saved.status).toBe(200);expect(parseContractSchema('IntakeGrantList',saved.value).items[0]!.grantId).not.toBe(parseContractSchema('IntakeGrantList',preview.value).items[0]!.grantId);
  expect((await http('/v1/intake/grants','POST',request)).value).toEqual(saved.value);
  const grant=parseContractSchema('IntakeGrantList',saved.value).items[0]!;expect(parseContractSchema('IntakeGrantList',(await http('/v1/intake/grants')).value).items.some((g:{grantId:string})=>g.grantId===grant.grantId)).toBe(true);
  await admin.query("UPDATE backend_identity.subject_bindings SET enabled=false WHERE user_id='user-agent'");
  expect(parseContractSchema('IntakePrincipalPage',(await http('/v1/intake/principals?sourceId=source-a&purpose=grant-recipient')).value).items.some((p:{principalId:string})=>p.principalId==='agent')).toBe(false);
  const changed=await http(`/v1/intake/grants/${grant.grantId}`,'PATCH',{operationId:'revoke-disabled',expectedVersion:grant.version,change:'revoke',stewardPrincipalId:null,reason:'合成停用撤销'});
  expect(changed.status).toBe(200);expect(parseContractSchema('IntakeGrant',changed.value).revokedAt).not.toBeNull();expect(parseContractSchema('IntakeGrant',changed.value).version).toBe(2);
 });
 it('excludes invisible scope rows before paging and invalidates cursors on authority change',async()=>{
  await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
   VALUES ('hidden-root','allocation','reviewer','reviewer','tenant-a','app-a','scope-b','query',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day','合成隔离根资格','reviewer')`);
  await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
   SELECT 'hidden-grant-'||n,'business','reviewer','agent','tenant-a','app-a','scope-b','source-b','query',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','合成不可见范围','reviewer','hidden-root' FROM generate_series(1,150) n`);
  let cursor:string|null=null;let firstCursor='';let count=0;do{
   const response=await http(`/v1/intake/grants?limit=1${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);expect(response.status).toBe(200);
   expect(parseContractSchema('IntakeGrantList',response.value).items).toHaveLength(1);expect(parseContractSchema('IntakeGrantList',response.value).items[0]!.scope.shopId).toBe('shop-a');count++;
   cursor=parseContractSchema('IntakeGrantList',response.value).nextCursor;if(cursor){firstCursor ||= cursor;expect(Buffer.from(cursor.split('.')[0]!,'base64url').toString()).not.toContain('hidden-grant');}
  }while(cursor);expect(count).toBe(17);
  await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成撤资格' WHERE grant_id='root-query'");
  expect((await http(`/v1/intake/grants?limit=1&cursor=${encodeURIComponent(firstCursor)}`)).status).toBe(409);
  expect(parseContractSchema('IntakeGrantList',(await http('/v1/intake/grants','GET',undefined,'agent')).value).items).toEqual([]);
 });
 it('rechecks after preview and refuses forged input or a partially invalid batch without writes',async()=>{
  const request=await batch();expect((await http('/v1/intake/grants/preview','POST',request)).status).toBe(200);
  const before=await counts();const bad={...request,items:[...request.items,{...request.items[0],action:'publish'}]};
  expect((await http('/v1/intake/grants','POST',bad)).status).toBe(403);expect(await counts()).toEqual(before);
  expect((await http('/v1/intake/grants','POST',{...request,actorPrincipalId:'director'})).status).toBe(400);
  expect((await http('/v1/intake/grants/preview','POST',{...request,items:[{...request.items[0],scope:{...request.items[0]!.scope,shopId:'shop-b',sourceId:'source-b'}}]})).status).toBe(404);
  await admin.query("UPDATE backend_identity.subject_bindings SET enabled=false WHERE user_id='user-agent'");
  expect((await http('/v1/intake/grants','POST',request)).status).toBe(403);expect(await counts()).toEqual(before);
 });
});
