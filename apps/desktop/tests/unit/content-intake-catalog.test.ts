// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { ContentIntakeCatalog } from '../../src/main/content-intake-catalog';
import { ContentIntakeUsage, type IntakeUsageSession } from '../../src/main/content-intake-usage';
type C=components['schemas'];
const entry:C['IntakePublishedEntry']={businessEntryId:'row',scriptVersion:1,operation:'upsert',title:'合成标题',answerText:'合成原文',questions:[],productRefs:[],scenarioRefs:[],effectiveFrom:'2020-01-01T00:00:00Z',effectiveTo:null,applicabilityNote:'合成适用',familySourceId:null,familyBusinessEntryId:null,brandNonOverridable:false,category:'合成分类',riskNote:'合成风险'};
function setup(shops=1) {
 const until=new Date(Date.now()+60_000).toISOString();const listeners=new Set<()=>void>(),state={signedIn:true,sessionEpoch:1};
 const sources:C['IntakeSource'][]=Array.from({length:shops},(_,i)=>({scope:{tenantId:'tenant',appId:'app',brandId:'brand',shopId:`shop-${i}`,sourceId:`source-${i}`,domain:'product'},version:1,templateVersion:'faq-p1.1',ruleVersion:'intake-p1.1',mappingVersion:'mapping-p1.1',structureDigest:'a'.repeat(64),contentIntakeMode:'v2-preview',modeVersion:1}));
 const auth:C['IntakeAuthorization']={factsVersion:1,revocationGeneration:0,policyVersion:1,validUntil:until,nextCursor:null,capabilities:sources.map(s=>({scope:s.scope,actions:['query'],mayAllocate:[],mayDelegate:[],validUntil:until}))};
 let ent:C['IntakeEntitlement'],serial=0;
 const pages=vi.fn(async():Promise<unknown>=>({entitlementId:ent.entitlementId,contextGeneration:ent.contextGeneration,releaseId:ent.releaseId,faq:[{sourceId:ent.scopes[0]!.sourceId,entry}],sopNodes:[],sopEdges:[],media:[],vocabulary:[],nextCursor:null}));
 const request=vi.fn(async(_epoch:number,path:string,options:Parameters<IntakeUsageSession['request']>[2]):Promise<{value:unknown}>=>{
  if(path.includes('/authorization?'))return {value:structuredClone(auth)};
  if(path.includes('/sources?'))return {value:{items:structuredClone(sources),nextCursor:null}};
  if(path.includes('/shop-directory?'))return {value:{items:sources.map(s=>({shopId:s.scope.shopId!,displayName:'合成店铺',displayVersion:1})),validUntil:new Date(Date.now()+500).toISOString(),nextCursor:null}};
  if(path.includes('/vocabulary'))return {value:{items:[],nextCursor:null}};
  if(path==='/v1/intake/entitlements') {
   const req=options.body as C['IntakeEntitlementRequest'];
   ent={entitlementId:`secret-${++serial}`,releaseId:`release-${serial}`,shopId:req.shopId,contextGeneration:req.contextGeneration,revocationGeneration:0,validUntil:new Date(Date.now()+1000).toISOString(),scopes:[{...sources.find(s=>s.scope.shopId===req.shopId)!.scope,domain:'campaign'}]};return {value:structuredClone(ent)};
  }
  return {value:await pages()};
 });
 const session:IntakeUsageSession={view:()=>({...state}),subscribe:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},request};
 const owner=new ContentIntakeCatalog(session);const events=vi.fn();owner.subscribe(events);
 return {owner,session,state,listeners,auth,sources,pages,request,events};
}
afterEach(()=>vi.useRealTimers());
it('reads complete qualified pages, projects domain from this entitlement, and exposes only bounded display fields',async()=>{
 vi.useFakeTimers();const f=setup();const original=f.pages.getMockImplementation()!;
 let count=0;f.pages.mockImplementation(async()=>({...await original() as C['IntakeSnapshot'],faq:[{sourceId:'source-0',entry:{...entry,businessEntryId:`row-${++count}`}}],nextCursor:count===1?'second':null}));
 try{const view=await f.owner.command({action:'refresh'});expect(view).toMatchObject({busy:false,releaseId:'release-1',context:{shopId:'shop-0'},rows:[{domain:'campaign'},{domain:'campaign'}]});expect(f.pages).toHaveBeenCalledTimes(2);
 expect(JSON.stringify(view)).not.toMatch(/entitlementId|secret-|contextGeneration|sourceId|"key"/);expect(f.events).not.toHaveBeenCalled();
 view.rows[0]!.answerText='forged';expect(f.owner.view().rows[0]!.answerText).toBe(entry.answerText);
 }finally{f.owner.dispose();}expect(f.listeners.size).toBe(0);
});
it('does not promote upload/publish management rights to query',async()=>{
 const f=setup();f.auth.capabilities[0]!.actions=['import','publish'];
 try{
  await expect(f.owner.command({action:'refresh'})).rejects.toMatchObject({code:'NO_GRANT'});
  expect(f.owner.view()).toMatchObject({busy:false,rows:[],context:{shops:[],shopId:null}});
  expect(f.request.mock.calls.some(c=>c[1]==='/v1/intake/entitlements')).toBe(false);
 }finally{f.owner.dispose();}
});
it('isolates Dashboard selection from Query and other dashboards, and retracts on explicit selection',async()=>{
 const f=setup(2),other=new ContentIntakeCatalog(f.session),query=new ContentIntakeUsage(f.session,vi.fn());query.select({shopId:'shop-1',productIds:[],scenarioIds:[]});
 try{expect((await f.owner.command({action:'refresh'})).context.shopId).toBeNull();await f.owner.command({action:'select-shop',shopId:'shop-0'});expect(f.owner.view().rows).toEqual([]);await f.owner.command({action:'refresh'});
 expect(other.view().context.shopId).toBeNull();const q=await query.refresh();expect(q.read()!.scopes[0]!.shopId).toBe('shop-1');
 await f.owner.command({action:'select-conditions',productIds:[],scenarioIds:[]});expect(f.owner.view().rows).toEqual([]);expect(q.read()).not.toBeNull();
 await expect(f.owner.command({action:'select-conditions',productIds:['forged'],scenarioIds:[]})).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{f.owner.dispose();other.dispose();query.dispose();}
});
it.each(['cancel','relogin','logout','dispose'] as const)('rejects a late ignored page after %s without restoring body or damaging a newer read',async kind=>{
 const f=setup();let resolve!:(v:unknown)=>void;const original=f.pages.getMockImplementation()!;let value:unknown;
 f.pages.mockImplementationOnce(async()=>{value=await original();return new Promise(r=>{resolve=r;});});
 try{const pending=f.owner.command({action:'refresh'});await vi.waitUntil(()=>!!resolve);expect(f.owner.view().rows).toEqual([]);
 if(kind==='cancel')await f.owner.command({action:'cancel'});else if(kind==='dispose')f.owner.dispose();else{if(kind==='relogin')f.state.sessionEpoch++;else f.state.signedIn=false;f.listeners.forEach(fn=>fn());}
 if(kind==='cancel'||kind==='relogin')await f.owner.command({action:'refresh'});
 resolve(value);await expect(pending).rejects.toMatchObject({code:'STALE'});
 expect(f.owner.view().rows.length).toBe(kind==='cancel'||kind==='relogin'?1:0);expect(f.owner.view().busy).toBe(false);
 }finally{f.owner.dispose();}expect(f.listeners.size).toBe(0);
});
it('expires names separately and body by monotonic deadline without granting a read extension',async()=>{
 vi.useFakeTimers();const f=setup();const mono=vi.spyOn(performance,'now');let tick=0;mono.mockImplementation(()=>tick);
 try{await f.owner.command({action:'refresh'});expect(f.owner.view().context.shopNames).toHaveLength(1);tick=600;expect(f.owner.view().context.shopNames).toEqual([]);expect(f.owner.view().rows).toHaveLength(1);
 vi.setSystemTime(new Date(Date.now()-60_000));tick=1001;expect(f.owner.view().rows).toEqual([]);expect(f.events).toHaveBeenCalled();expect(f.request.mock.calls.filter(c=>c[1]==='/v1/intake/entitlements')).toHaveLength(1);
 }finally{f.owner.dispose();mono.mockRestore();}
});
it('returns an observable failure, empty body and idle state after an unavailable refresh',async()=>{
 const f=setup();try{await f.owner.command({action:'refresh'});f.pages.mockRejectedValueOnce({code:'UNAVAILABLE'});await expect(f.owner.command({action:'refresh'})).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.owner.view()).toMatchObject({busy:false,rows:[]});expect(f.events).not.toHaveBeenCalled();}finally{f.owner.dispose();}
});
it.each(['duplicate-scope','row-limit','byte-limit'] as const)('rejects %s as a whole set',async fault=>{
 const f=setup();const original=f.request.getMockImplementation()!;
 f.request.mockImplementation(async(...args)=>{const out=await original(...args);if(fault==='duplicate-scope'&&args[1]==='/v1/intake/entitlements'){const e=out.value as C['IntakeEntitlement'];e.scopes.push({...e.scopes[0]!});}return out;});
 if(fault!=='duplicate-scope'){const originalPage=f.pages.getMockImplementation()!;let total=0;f.pages.mockImplementation(async()=>{const n=fault==='row-limit'?100:10;const rows=Array.from({length:n},()=>({sourceId:'source-0',entry:{...entry,businessEntryId:`row-${total++}`,answerText:fault==='byte-limit'?'字'.repeat(8000):entry.answerText}}));return {...await originalPage() as C['IntakeSnapshot'],faq:rows,nextCursor:total<(fault==='row-limit'?5100:100)?String(total):null};});}
 try{await expect(f.owner.command({action:'refresh'})).rejects.toMatchObject({code:fault==='duplicate-scope'?'FORBIDDEN':'LIMIT'});expect(f.owner.view()).toMatchObject({busy:false,rows:[]});}finally{f.owner.dispose();}
});
