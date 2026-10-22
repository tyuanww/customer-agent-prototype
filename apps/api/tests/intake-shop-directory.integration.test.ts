import { createHash } from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseContractSchema } from '@customer-agent/contracts';
import { applyDatabaseMigrations } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { createContentIntakeService } from '../src/content-intake/service.js';
import { createIntakePurposePool, type IntakePurposePool } from '../src/content-intake/runtime-pool.js';
import { contentIntakeUsageRoutes } from '../src/content-intake/usage-http.js';
import { createContentObjectStore } from '../src/content-object-store.js';
import { createProductAuthService } from '../src/product-auth-service.js';
import type { ProductAuthService } from '../src/auth-service.js';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.js';
import { seedIntakeSyntheticDirectory } from './support/intake-synthetic-directory.js';

describe.skipIf(process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION!=='1')('shop directory through real auth/HTTP and restricted PG15',()=>{
 let harness:Pg15Harness,admin:Client,pool:IntakePurposePool,auth:ProductAuthService,app:FastifyInstance,origin:string,token:string,delayFinal=false,loseCommit=false,invalidPrepared: 'missing-field'|'oversize-name'|null=null;
 beforeEach(async()=>{
  harness=new Pg15Harness();harness.start();const db=harness.createDatabase('shop_directory');admin=await harness.connect(db.config);
  await applyDatabaseMigrations(admin);await seedIntakeSyntheticHost(admin);await seedIntakeSyntheticDirectory(admin);
  await admin.query('CREATE ROLE synthetic_shop_usage LOGIN NOINHERIT; GRANT intake_usage TO synthetic_shop_usage');
  await admin.query('CREATE ROLE synthetic_shop_auth LOGIN NOINHERIT; GRANT app_backend_auth TO synthetic_shop_auth');
  pool=createIntakePurposePool({...db.config,user:'synthetic_shop_usage',max:2},'usage');
  auth=await createProductAuthService({connectionString:`postgresql://synthetic_shop_auth@localhost/${db.name}?${new URLSearchParams({host:harness.socket,port:String(harness.port)})}`,poolMax:1,connectionTimeoutMs:2000,readinessTimeoutMs:3000},
   {authorizeUrl:s=>`http://127.0.0.1/auth?state=${s}`,exchange:async c=>c,close:()=>undefined},'mock');
  const verifier='v'.repeat(43),login=await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
  await auth.callback(new URL(login.authorize_url).searchParams.get('state')!,'agent');token=(await auth.exchange(login.login_id,verifier))!.access_token;
  const observed={connect:async()=>{const client=await pool.connect();return new Proxy(client,{get(target,key){
   if(key==='query')return async(...args:unknown[])=>{if(delayFinal && typeof args[0]==='string' && args[0].includes('finish_shop_directory_transaction'))await target.query('SELECT pg_sleep(0.4)');const result=await Reflect.apply(target.query,target,args);
    if(invalidPrepared && typeof args[0]==='string' && args[0].includes('prepare_shop_directory_read')) {
     const value=result.rows[0].envelope.value;
     if(invalidPrepared==='missing-field')delete value.validUntil;
     else value.items.push({shopId:'invalid-synthetic-shop',displayName:'界'.repeat(257),displayVersion:1});
    }
    if(loseCommit && args[0]==='COMMIT'){loseCommit=false;throw new Error('synthetic lost read commit response');}return result;};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});}};
  const usage=createContentIntakeService(observed,createContentObjectStore(path.join(harness.root,db.name)),()=>undefined,undefined,{requireProductSession:true});
  app=Fastify();await app.register(contentIntakeUsageRoutes,{auth,usage});origin=await app.listen({host:'127.0.0.1',port:0});delayFinal=false;loseCommit=false;invalidPrepared=null;
 },60000);
 afterEach(async()=>{await app?.close();await auth?.close();await pool?.end();await admin?.end();harness?.stop();},60000);
 async function get(query='',authenticated=true){const r=await fetch(origin+'/v1/intake/shop-directory'+query,{headers:authenticated?{authorization:`Bearer ${token}`}:{}});return {status:r.status,headers:r.headers,body:await r.json()};}
 it('returns only names for visible shop IDs, denies forged selectors, and exposes no private envelope',async()=>{
  const before=await admin.query('SELECT count(*) AS n FROM content_intake.grants');
  const r=await get();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');
  expect(parseContractSchema('IntakeShopDirectory',r.body).items).toEqual([{shopId:'shop-a',displayName:'合成示例店',displayVersion:1}]);
  expect(JSON.stringify(r.body)).not.toMatch(/sessionHash|principal|keyVersion|key_material|[c]{64}/);
  expect((await get('',false))).toMatchObject({status:401,body:{error:{details:{reason:'SHOP_DIRECTORY_SESSION'}}}});
  for(const q of ['?limit=0','?limit=101','?limit=1&limit=2','?principalId=agent','?tenantId=tenant-a','?cursor=forged'])expect((await get(q))).toMatchObject({status:400,body:{error:{details:{reason:'SHOP_DIRECTORY_CURSOR'}}}});
  expect((await admin.query('SELECT count(*) AS n FROM content_intake.grants')).rows).toEqual(before.rows);
 });
 it('rejects an entire missing-name set and invalidates pagination on rename and revocation',async()=>{
  await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
   VALUES ('directory-root-b','allocation','director','director','tenant-a','app-a','scope-b','query',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','合成目录范围','director')`);
  // A query row is live only with the current policy version and a store set member.
  await admin.query(`INSERT INTO content_intake.store_set_members(tenant_id,app_id,version,scope_id,source_id,content_valid_until)
   VALUES ('tenant-a','app-a',1,'scope-b','source-b',clock_timestamp()+interval '2 hours')
   ON CONFLICT (tenant_id,app_id,version,scope_id,source_id) DO NOTHING`);
  await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id,policy_version,store_set_version)
   VALUES ('directory-query-b','business','director','agent','tenant-a','app-a','scope-b','source-b','query',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 minutes','合成目录范围','director','directory-root-b',
     (SELECT version FROM content_intake.policy_versions WHERE tenant_id='tenant-a' AND app_id='app-a'),1)`);
  expect(await get()).toMatchObject({status:409,body:{error:{details:{reason:'SHOP_DISPLAY_MISSING'}}}});
  await admin.query("SELECT content_intake.upsert_shop_display('director','tenant-a','app-a','shop-b','合成示例店',1)");
  const first=parseContractSchema('IntakeShopDirectory',(await get('?limit=1')).body);expect(first.items).toHaveLength(1);expect(first.nextCursor).toBeTruthy();
  await admin.query("SELECT content_intake.upsert_shop_display('director','tenant-a','app-a','shop-b','合成更名店',2)");
  expect(await get(`?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)).toMatchObject({status:409,body:{error:{details:{reason:'SHOP_DIRECTORY_CHANGED'}}}});
  const current=parseContractSchema('IntakeShopDirectory',(await get()).body);expect(current.items.map(x=>x.displayName)).toEqual(['合成示例店','合成更名店']);
  await admin.query("UPDATE content_intake.grants SET revoked_at=clock_timestamp(),version=version+1,last_change_reason='合成撤销' WHERE recipient_id='agent'");
  expect(parseContractSchema('IntakeShopDirectory',(await get()).body).items).toEqual([]);
 });
 it.each(['missing-field','oversize-name'] as const)('rejects the whole malformed prepared page as unavailable: %s',async mode=>{
  invalidPrepared=mode;
  const response=await get();
  expect(response).toMatchObject({status:503,body:{error:{details:{reason:'SHOP_DIRECTORY_UNAVAILABLE'}}}});
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.body).not.toHaveProperty('items');
  expect(JSON.stringify(response.body)).not.toMatch(/合成示例店|shop-a|invalid-synthetic-shop|界|FILE_INVALID|validUntil|sessionHash|key_material/);
  invalidPrepared=null;
  expect(parseContractSchema('IntakeShopDirectory',(await get()).body).items).toHaveLength(1);
  expect(await get('?limit=0')).toMatchObject({status:400,body:{error:{details:{reason:'SHOP_DIRECTORY_CURSOR'}}}});
 });
 it('does not expose a page after an unknown COMMIT and allows a fresh read retry',async()=>{
  loseCommit=true;expect(await get()).toMatchObject({status:503,body:{error:{details:{reason:'SHOP_DIRECTORY_UNAVAILABLE'}}}});
  expect(parseContractSchema('IntakeShopDirectory',(await get()).body).items).toHaveLength(1);
 });
 it('fails closed on unavailable key and rejects a prepared page that expires before the final guard',async()=>{
  await admin.query(`SELECT content_intake.rotate_shop_directory_key('tenant-a','app-a','short-lived',repeat('d',64),clock_timestamp()+interval '250 milliseconds',1,'合成到期','short-key')`);
  delayFinal=true;expect(await get()).toMatchObject({status:503,body:{error:{details:{reason:'SHOP_DIRECTORY_UNAVAILABLE'}}}});
  delayFinal=false;expect(await get()).toMatchObject({status:503,body:{error:{details:{reason:'SHOP_DIRECTORY_UNAVAILABLE'}}}});
 });
});
