// Root-owned synthetic cross-application probe, invoked only by the isolated API
// integration test. Node 24 transforms Main's TS in this test process; no runtime
// build, API dependency on desktop, production route or private key file is added.
import assert from 'node:assert/strict';
import { ContentIntakeUsage } from '../apps/desktop/src/main/content-intake-usage.ts';

let input='';
for await (const chunk of process.stdin) {
  input+=String(chunk);if(input.length>4096)throw new Error('PROBE_INPUT_LIMIT');
}
const {origin,token,releaseId}=JSON.parse(input);
assert.match(origin,/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
assert.equal(typeof token,'string');assert.equal(typeof releaseId,'string');
async function request(path,options={}) {
  const response=await fetch(new URL(path,origin),{method:options.body===undefined?'GET':'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    ...(options.body===undefined?{}:{body:JSON.stringify(options.body)}),
    signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000),redirect:'error'});
  const value=await response.json();
  if(!response.ok)throw Object.assign(new Error('SYNTHETIC_REQUEST_FAILED'),{code:value.code,reason:value.reason});
  return {value};
}
const copied=[];
const main=new ContentIntakeUsage({view:()=>({signedIn:true,sessionEpoch:1}),subscribe:()=>()=>{},
  request:async(epoch,path,options)=>{assert.equal(epoch,1);return request(path,options);}},text=>copied.push(text));
try {
  main.select({shopId:'shop-a',productIds:[],scenarioIds:[]});
  const first=await main.refresh(), projection=first.read();
  assert.equal(projection.releaseId,releaseId);
  assert.equal(projection.faq[0].entry.answerText,'第一行。\n第二行。');
  assert.equal('internalNote' in projection.faq[0].entry,false);
  assert.equal('entitlementId' in projection,false);
  first.copy(projection.faq[0].key);assert.deepEqual(copied,['第一行。\n第二行。']);
  await request('/__synthetic__/expire-next',{body:{}});
  await assert.rejects(main.refresh(),{code:'EXPIRED'});
  assert.equal(main.current(),first);first.copy(projection.faq[0].key);assert.equal(copied.length,2);
  await request('/__synthetic__/next-release',{body:{}});
  const empty=await main.refresh();assert.deepEqual(empty.read().faq,[]);assert.equal(first.read().faq.length,1);
  await request('/__synthetic__/revoke',{body:{}});
  await assert.rejects(main.refresh(),{code:'FORBIDDEN'});
  assert.equal(first.read(),null);assert.equal(empty.read(),null);
  assert.throws(()=>first.copy(projection.faq[0].key),/STALE/);assert.equal(copied.length,2);
  console.log(JSON.stringify({status:'PASS',publishedText:true,localExpiry:true,normalUpdate:true,revocationFanout:true}));
} finally {main.dispose();}
