// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { ContentIntakeUsage, type IntakeUsageSession } from '../../src/main/content-intake-usage';
import type { ProductSession } from '../../src/main/product-session';

type C = components['schemas'];
const selection = {shopId:'shop-a',productIds:[],scenarioIds:[]};
const scope:C['IntakeSourceScope'] = {tenantId:'tenant',appId:'app',brandId:'brand',shopId:'shop-a',domain:'product',sourceId:'source'};
const entry:C['IntakePublishedEntry'] = {businessEntryId:'entry',scriptVersion:1,operation:'upsert',title:'合成标题',answerText:'原文第一行\n第二行',
  questions:[],productRefs:[],scenarioRefs:[],effectiveFrom:'2020-01-01T00:00:00Z',effectiveTo:null,applicabilityNote:'适用说明',
  familySourceId:null,familyBusinessEntryId:null,brandNonOverridable:false,category:'分类',riskNote:'单独风险说明'};
// ProductSession can supply this Main capability directly, without an identity wrapper.
const compatible = (session:ProductSession):IntakeUsageSession => session;
void compatible;
function setup() {
  let view={signedIn:true,sessionEpoch:1};const callbacks=new Set<()=>void>();
  let ent:C['IntakeEntitlement'];let serial=0;
  const pages=vi.fn(async ():Promise<unknown>=>({releaseId:ent.releaseId,entitlementId:ent.entitlementId,contextGeneration:ent.contextGeneration,
    faq:[{sourceId:'source',entry}],sopNodes:[],sopEdges:[],media:[],vocabulary:[],nextCursor:null}));
  const request=vi.fn(async(_epoch:number,url:string,options:{body?:unknown;signal:AbortSignal})=>{
    if(url==='/v1/intake/entitlements') {
      const req=options.body as C['IntakeEntitlementRequest'];
      ent={entitlementId:`ent-${++serial}`,releaseId:`release-${serial}`,shopId:req.shopId,contextGeneration:req.contextGeneration,
        revocationGeneration:0,validUntil:new Date(Date.now()+1000).toISOString(),scopes:[{...scope,shopId:req.shopId}]};
      return {value:structuredClone(ent)};
    }
    return {value:await pages()};
  });
  const session:IntakeUsageSession={view:()=>view,subscribe:fn=>{callbacks.add(fn);return()=>{callbacks.delete(fn);};},request};
  const clipboard=vi.fn();const usage=new ContentIntakeUsage(session,clipboard);
  usage.select(selection);
  const replace=()=>{view={...view,sessionEpoch:view.sessionEpoch+1};callbacks.forEach(fn=>fn());};
  return {usage,request,pages,clipboard,replace};
}
afterEach(()=>{vi.useRealTimers();});
describe('Main sealed intake usage consumer',()=>{
  it('assembles the formal pages, exposes no qualification/session token, and copies only owned original text',async()=>{
    vi.useFakeTimers();const s=setup();
    try {
      const catalog=await s.usage.refresh();const projected=catalog.read()!;const key=projected.faq[0]!.key;
      expect(projected).toMatchObject({releaseId:'release-1',contextGeneration:1,faq:[{entry:{answerText:entry.answerText}}]});
      expect(JSON.stringify(projected)).not.toContain('entitlementId');
      projected.faq[0]!.entry.answerText='伪造正文';
      expect(catalog.copy(key)).toEqual({copied:true});expect(s.clipboard).toHaveBeenLastCalledWith(entry.answerText);
      expect(()=>catalog.copy('unknown')).toThrow('VALIDATION');
      expect(s.request.mock.calls[0]![2].body).toEqual({...selection,contextGeneration:1,releaseId:null});
      expect(s.request.mock.calls[1]![1]).toBe('/v1/intake/snapshot?entitlementId=ent-1&limit=100');
    }finally{s.usage.dispose();}
  });
  it('retires old body/copy immediately on selection or session change, even when a page ignores cancellation',async()=>{
    vi.useFakeTimers();const s=setup();
    try {
      const old=await s.usage.refresh();const key=old.read()!.faq[0]!.key;
      let resolve!:(value:unknown)=>void;
      s.pages.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
      const pending=s.usage.refresh();await vi.waitUntil(()=>!!resolve);
      s.usage.select({...selection,shopId:'shop-b'});
      expect(old.read()).toBeNull();expect(()=>old.copy(key)).toThrow('STALE');
      const fresh=await s.usage.refresh();
      resolve({});await expect(pending).rejects.toMatchObject({code:'STALE'});
      expect(fresh.read()).not.toBeNull();expect(s.usage.current()).toBe(fresh);
      s.replace();expect(fresh.read()).toBeNull();expect(s.usage.current()).toBeNull();
    }finally{s.usage.dispose();}
  });
  it.each([
    {code:'FORBIDDEN'},
    {code:'FORBIDDEN',reason:'PERMISSION_CHANGED'},
    {code:'FORBIDDEN',reason:'APPROVAL_REVOKED'},
    {code:'UNAUTHORIZED',reason:'LEASE_EXPIRED'},
  ])('retains shown old-release actions on normal publication, but definitive refusal %j revokes every handle',async failure=>{
    vi.useFakeTimers();const s=setup();const events:string[]=[];s.usage.subscribe(e=>events.push(e));
    try {
      const old=await s.usage.refresh(), fresh=await s.usage.refresh();
      expect(old.read()?.releaseId).toBe('release-1');expect(fresh.read()?.releaseId).toBe('release-2');
      expect(events).toEqual(['updated','updated']);
      s.pages.mockRejectedValueOnce(failure);
      await expect(s.usage.refresh()).rejects.toMatchObject({code:failure.code});
      expect(old.read()).toBeNull();expect(fresh.read()).toBeNull();expect(events.at(-1)).toBe('invalidated');
    }finally{s.usage.dispose();}
  });
  it('keeps an offline snapshot only to its original deadline and never revives it after clock rollback',async()=>{
    vi.useFakeTimers();const s=setup();
    try {
      const old=await s.usage.refresh();const key=old.read()!.faq[0]!.key;
      s.pages.mockRejectedValueOnce({code:'UNAVAILABLE'});
      await expect(s.usage.refresh()).rejects.toMatchObject({code:'UNAVAILABLE'});
      expect(old.copy(key)).toEqual({copied:true});
      await vi.advanceTimersByTimeAsync(1001);expect(old.read()).toBeNull();
      vi.setSystemTime(new Date('2020-01-01'));expect(()=>old.copy(key)).toThrow('STALE');
    }finally{s.usage.dispose();}
  });
  it('expires an old catalog without cancelling a fresh qualification already paging',async()=>{
    vi.useFakeTimers();const s=setup();const events:string[]=[];s.usage.subscribe(e=>events.push(e));
    try {
      const old=await s.usage.refresh();await vi.advanceTimersByTimeAsync(900);
      const original=s.pages.getMockImplementation()!;let resolve!:(value:unknown)=>void;let page:unknown;
      s.pages.mockImplementationOnce(async()=>{page=await original();return new Promise(r=>{resolve=r;});});
      const pending=s.usage.refresh();await vi.waitUntil(()=>!!resolve);
      await vi.advanceTimersByTimeAsync(200);expect(old.read()).toBeNull();expect(s.usage.current()).toBeNull();
      resolve(page);const fresh=await pending;expect(fresh.read()).not.toBeNull();
      expect(events).toEqual(['updated','expired','updated']);
    }finally{s.usage.dispose();}
  });
  it('does not extend a short new qualification or revoke a longer shown old one',async()=>{
    vi.useFakeTimers();const s=setup();
    try {
      const old=await s.usage.refresh();const key=old.read()!.faq[0]!.key;
      const request=s.request.getMockImplementation()!;
      s.request.mockImplementationOnce(async(...args)=>{const out=await request(...args);return {value:{...out.value as C['IntakeEntitlement'],validUntil:new Date(Date.now()+100).toISOString()}};});
      const short=await s.usage.refresh();await vi.advanceTimersByTimeAsync(150);
      expect(short.read()).toBeNull();expect(s.usage.current()).toBeNull();expect(old.copy(key)).toEqual({copied:true});
    }finally{s.usage.dispose();}
  });
  it('fails an expired in-flight qualification without revoking a still-valid shown handle',async()=>{
    vi.useFakeTimers();const s=setup();
    try {
      const old=await s.usage.refresh();const key=old.read()!.faq[0]!.key;
      const request=s.request.getMockImplementation()!;
      s.request.mockImplementationOnce(async(...args)=>{const out=await request(...args);return {value:{...out.value as C['IntakeEntitlement'],validUntil:new Date(Date.now()+100).toISOString()}};});
      const original=s.pages.getMockImplementation()!;let resolve!:(value:unknown)=>void;let page:unknown;
      s.pages.mockImplementationOnce(async()=>{page=await original();return new Promise(r=>{resolve=r;});});
      const pending=s.usage.refresh();await vi.waitUntil(()=>!!resolve);await vi.advanceTimersByTimeAsync(150);
      resolve(page);await expect(pending).rejects.toMatchObject({code:'EXPIRED'});
      expect(s.usage.current()).toBe(old);expect(old.copy(key)).toEqual({copied:true});
    }finally{s.usage.dispose();}
  });
  it('keeps another valid handle when the server reports the requested qualification expired',async()=>{
    vi.useFakeTimers();const s=setup();const events:string[]=[];s.usage.subscribe(e=>events.push(e));
    try {
      const old=await s.usage.refresh();const key=old.read()!.faq[0]!.key;
      s.pages.mockRejectedValueOnce({code:'FORBIDDEN',reason:'LEASE_EXPIRED'});
      await expect(s.usage.refresh()).rejects.toMatchObject({code:'EXPIRED'});
      expect(s.usage.current()).toBe(old);expect(old.copy(key)).toEqual({copied:true});
      expect(events).toEqual(['updated']);
      await vi.advanceTimersByTimeAsync(1001);expect(old.read()).toBeNull();
    }finally{s.usage.dispose();}
  });
  it.each(['wrong-release','wrong-generation','duplicate','cursor-loop','wrong-source','malformed'] as const)('rejects %s without releasing a partial snapshot',async fault=>{
    vi.useFakeTimers();const s=setup();
    const original=s.pages.getMockImplementation()!;
    s.pages.mockImplementation(async()=>{
      const page=await original() as C['IntakeSnapshot'];
      if(fault==='wrong-release')page.releaseId='other';
      if(fault==='wrong-generation')page.contextGeneration++;
      if(fault==='duplicate')page.faq.push(page.faq[0]!);
      if(fault==='cursor-loop')page.nextCursor='repeat';
      if(fault==='wrong-source')page.faq[0]!.sourceId='other';
      if(fault==='malformed')return {...page,sessionToken:'not-allowed'};
      return page;
    });
    try {await expect(s.usage.refresh()).rejects.toMatchObject({code:'FORBIDDEN'});expect(s.usage.current()).toBeNull();expect(s.clipboard).not.toHaveBeenCalled();}
    finally{s.usage.dispose();}
  });
  it('accepts an empty complete catalog and rejects injected identity/generation in selection',async()=>{
    vi.useFakeTimers();const s=setup();const original=s.pages.getMockImplementation()!;
    s.pages.mockImplementation(async()=>({...await original() as C['IntakeSnapshot'],faq:[]}));
    try {
      expect(()=>s.usage.select({...selection,sessionEpoch:2})).toThrow('VALIDATION');
      expect(()=>s.usage.select({...selection,contextGeneration:99})).toThrow('VALIDATION');
      expect((await s.usage.refresh()).read()!.faq).toEqual([]);
    }finally{s.usage.dispose();}
  });
});
