// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { ContentIntakeUsage, type IntakeUsageSession } from '../../src/main/content-intake-usage';
import { ProductHttpError } from '../../src/main/product-http';
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
function setup(clock?: { now: () => number; monotonic: () => number }) {
  let view={signedIn:true,sessionEpoch:1};const callbacks=new Set<()=>void>();
  let ent:C['IntakeEntitlement'];let serial=0;
  const entitlements = new Map<string,C['IntakeEntitlement']>();
  const pages=vi.fn(async (pageEnt: C['IntakeEntitlement'] = ent, _url?: string):Promise<unknown>=>({releaseId:pageEnt.releaseId,entitlementId:pageEnt.entitlementId,contextGeneration:pageEnt.contextGeneration,
    faq:[{sourceId:'source',entry:structuredClone(entry)}],sopNodes:[],sopEdges:[],media:[],vocabulary:[],nextCursor:null}));
  const request=vi.fn(async(_epoch:number,url:string,options:{body?:unknown;signal:AbortSignal})=>{
    if(url==='/v1/intake/entitlements') {
      const req=options.body as C['IntakeEntitlementRequest'];
      ent={entitlementId:`ent-${++serial}`,releaseId:`release-${serial}`,shopId:req.shopId,contextGeneration:req.contextGeneration,
        revocationGeneration:0,validUntil:new Date(Date.now()+1000).toISOString(),scopes:[{...scope,shopId:req.shopId}]};
      entitlements.set(ent.entitlementId, ent);
      return {value:structuredClone(ent)};
    }
    return {value:await pages(entitlements.get(new URL(url, 'http://synthetic.invalid').searchParams.get('entitlementId')!)!,url)};
  });
  const session:IntakeUsageSession={view:()=>view,subscribe:fn=>{callbacks.add(fn);return()=>{callbacks.delete(fn);};},request};
  const clipboard=vi.fn();const usage=new ContentIntakeUsage(session,clipboard,clock?.now,clock?.monotonic);
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
      expect(projected.scopes).toEqual([scope]);
      projected.scopes[0]!.domain='campaign';expect(catalog.read()!.scopes[0]!.domain).toBe('product');
      projected.faq[0]!.entry.answerText='伪造正文';
      expect(await catalog.copy(key)).toEqual({copied:true});expect(s.clipboard).toHaveBeenLastCalledWith(entry.answerText);
      await expect(catalog.copy('unknown')).rejects.toMatchObject({code:'VALIDATION'});
      expect(s.request.mock.calls[0]![2].body).toEqual({...selection,contextGeneration:1,releaseId:null});
      expect(s.request.mock.calls[1]![1]).toBe('/v1/intake/snapshot?entitlementId=ent-1&limit=100');
      expect(s.request.mock.calls[2]![1]).toBe('/v1/intake/snapshot?entitlementId=ent-1&limit=100');
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
      expect(old.read()).toBeNull();await expect(old.copy(key)).rejects.toMatchObject({code:'STALE'});
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
      expect(old.read()).not.toBeNull();
      s.pages.mockRejectedValueOnce({code:'UNAVAILABLE'});
      await expect(old.copy(key)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(s.clipboard).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1001);expect(old.read()).toBeNull();
      vi.setSystemTime(new Date('2020-01-01'));await expect(old.copy(key)).rejects.toMatchObject({code:'EXPIRED'});
    }finally{s.usage.dispose();}
  });
  it('uses the server expiry even when the client clock started five minutes behind',async()=>{
    vi.useFakeTimers();let elapsed=0;const s=setup({now:()=>Date.now()-300_000,monotonic:()=>elapsed});
    const events:string[]=[];s.usage.subscribe(event=>events.push(event));
    try {
      const catalog=await s.usage.refresh(), key=catalog.read()!.faq[0]!.key;
      elapsed=70_000;
      expect(catalog.read()).not.toBeNull();
      s.pages.mockRejectedValueOnce({code:'FORBIDDEN',reason:'LEASE_EXPIRED'});
      await expect(catalog.copy(key)).rejects.toMatchObject({code:'EXPIRED'});
      expect(s.clipboard).not.toHaveBeenCalled();expect(catalog.read()).toBeNull();
      expect(events.at(-1)).toBe('expired');
    }finally{s.usage.dispose();}
  });
  it.each(['server refusal','inactive response'])('rechecks the target page when a later-page vocabulary term becomes inactive: %s',async failure=>{
    const s=setup(),events:string[]=[];s.usage.subscribe(event=>events.push(event));
    const original=s.pages.getMockImplementation()!;let inactive=false;
    const target={...entry,businessEntryId:'entry-later',answerText:'第二页合成正文',productRefs:[{id:'product-later',displayVersion:1}]};
    const term:C['IntakeVocabulary']={id:'product-later',kind:'product',displayVersion:1,displayName:'合成商品',meaningDigest:'a'.repeat(64),active:true,
      scope:{tenantId:'tenant',appId:'app',brandId:'brand',shopId:'shop-a',domain:'product',sourceId:null}};
    const first={...entry,productRefs:[{id:'product-first',displayVersion:1}]};
    const firstTerm={...term,id:'product-first'};
    s.usage.select({...selection,productIds:['product-first','product-later']});
    s.pages.mockImplementation(async(...args)=>{
      const page=await original(...args) as C['IntakeSnapshot'];
      const cursor=new URL(args[1]!, 'http://synthetic.invalid').searchParams.get('cursor');
      if(cursor===null)return {...page,faq:[{sourceId:'source',entry:first}],vocabulary:[firstTerm],nextCursor:'opaque-later-page'};
      expect(cursor).toBe('opaque-later-page');
      if(inactive && failure==='server refusal')throw {code:'FORBIDDEN',reason:'SOURCE_MISMATCH'};
      return {...page,faq:[{sourceId:'source',entry:target}],vocabulary:[{...term,active:!inactive}],nextCursor:null};
    });
    try {
      const catalog=await s.usage.refresh(),rows=catalog.read()!.faq;
      expect(rows).toHaveLength(2);expect(JSON.stringify(rows)).not.toContain('opaque-later-page');
      expect(await catalog.copy(rows[1]!.key)).toEqual({copied:true});
      expect(s.request.mock.calls.at(-1)![1]).toBe('/v1/intake/snapshot?entitlementId=ent-1&limit=100&cursor=opaque-later-page');
      inactive=true;
      expect(await catalog.copy(rows[0]!.key)).toEqual({copied:true});
      await expect(catalog.copy(rows[1]!.key)).rejects.toMatchObject({code:'FORBIDDEN'});
      expect(s.request.mock.calls.at(-1)![1]).toContain('cursor=opaque-later-page');
      expect(s.clipboard).toHaveBeenCalledTimes(2);expect(events.at(-1)).toBe('invalidated');
    }finally{s.usage.dispose();}
  });
  it('signals expiry when the local deadline passes before its timer runs',async()=>{
    let localNow=Date.now();const s=setup({now:()=>localNow,monotonic:()=>0});
    const events:string[]=[];s.usage.subscribe(event=>events.push(event));
    try {
      const catalog=await s.usage.refresh(), key=catalog.read()!.faq[0]!.key;
      localNow+=2_000;
      await expect(catalog.copy(key)).rejects.toMatchObject({code:'EXPIRED'});
      expect(events.at(-1)).toBe('expired');expect(s.clipboard).not.toHaveBeenCalled();
    }finally{s.usage.dispose();}
  });
  it.each(['response','failure'])('signals expiry if the wall clock crosses the deadline during copy verification: %s',async outcome=>{
    let localNow=Date.now();const s=setup({now:()=>localNow,monotonic:()=>0});
    const events:string[]=[];s.usage.subscribe(event=>events.push(event));
    try {
      const catalog=await s.usage.refresh(), key=catalog.read()!.faq[0]!.key;
      const original=s.pages.getMockImplementation()!;
      s.pages.mockImplementationOnce(async(...args)=>{
        const page=await original(...args);localNow+=2_000;
        if(outcome==='failure')throw new ProductHttpError('UNAVAILABLE');
        return page;
      });
      await expect(catalog.copy(key)).rejects.toMatchObject({code:'EXPIRED'});
      expect(events.at(-1)).toBe('expired');expect(catalog.read()).toBeNull();
      expect(s.clipboard).not.toHaveBeenCalled();
    }finally{s.usage.dispose();}
  });
  it('reports expired organization facts when copy revalidation invalidates the visible result',async()=>{
    const s=setup(),events:string[]=[];s.usage.subscribe(event=>events.push(event));
    try {
      const catalog=await s.usage.refresh(), key=catalog.read()!.faq[0]!.key;
      s.pages.mockRejectedValueOnce(new ProductHttpError('FORBIDDEN','ORG_FACTS_UNAVAILABLE'));
      await expect(catalog.copy(key)).rejects.toMatchObject({code:'FACTS_EXPIRED'});
      expect(events.at(-1)).toBe('facts-expired');expect(catalog.read()).toBeNull();
      expect(s.clipboard).not.toHaveBeenCalled();
    }finally{s.usage.dispose();}
  });
  it('checks the elapsed verification budget again immediately before the clipboard write',async()=>{
    let elapsed=0, checks=0;const s=setup({now:()=>Date.now(),monotonic:()=>elapsed});
    const request=s.request.getMockImplementation()!;
    s.request.mockImplementationOnce(async(...args)=>{
      const out=await request(...args);
      return {value:{...out.value as C['IntakeEntitlement'],validUntil:new Date(Date.now()+20_000).toISOString()}};
    });
    try {
      const catalog=await s.usage.refresh(), key=catalog.read()!.faq[0]!.key;
      await expect(catalog.copy(key,{stillShown:()=>{if(++checks===2)elapsed=5_001;return true;}})).rejects.toMatchObject({code:'UNAVAILABLE'});
      expect(s.clipboard).not.toHaveBeenCalled();
    }finally{s.usage.dispose();}
  });
  it.each([6_000,-1_000])('refuses a wall-clock change of %i ms even if the monotonic clock stops',async change=>{
    let wall=Date.now()-300_000;const s=setup({now:()=>wall,monotonic:()=>0});
    try {
      const catalog=await s.usage.refresh(), key=catalog.read()!.faq[0]!.key;
      const original=s.pages.getMockImplementation()!;
      s.pages.mockImplementationOnce(async(...args)=>{
        const response=await original(...args);wall+=change;return response;
      });
      await expect(catalog.copy(key)).rejects.toMatchObject({code:'UNAVAILABLE'});
      expect(catalog.read()).not.toBeNull();expect(s.clipboard).not.toHaveBeenCalled();
    }finally{s.usage.dispose();}
  });
  it('accepts a timely verification when the initial client wall clock is behind',async()=>{
    let wall=Date.now()-300_000;const s=setup({now:()=>wall,monotonic:()=>0});
    try {
      const catalog=await s.usage.refresh(), key=catalog.read()!.faq[0]!.key;
      const original=s.pages.getMockImplementation()!;
      s.pages.mockImplementationOnce(async(...args)=>{
        const response=await original(...args);wall+=100;return response;
      });
      expect(await catalog.copy(key)).toEqual({copied:true});expect(s.clipboard).toHaveBeenCalledWith(entry.answerText);
    }finally{s.usage.dispose();}
  });
  it.each(['wrong-release','wrong-generation','wrong-entitlement','malformed','missing-target','changed-version','changed-answer','changed-reference'] as const)(
    'refuses a mismatched %s copy verification response and invalidates the catalog',async fault=>{
      const s=setup(),events:string[]=[];s.usage.subscribe(event=>events.push(event));
      try {
        const catalog=await s.usage.refresh(),key=catalog.read()!.faq[0]!.key;
        const original=s.pages.getMockImplementation()!;
        s.pages.mockImplementationOnce(async(...args)=>{
          const page=await original(...args) as C['IntakeSnapshot'];
          if(fault==='wrong-release')page.releaseId='other';
          if(fault==='wrong-generation')page.contextGeneration++;
          if(fault==='wrong-entitlement')page.entitlementId='other';
          if(fault==='missing-target')page.faq=[];
          if(fault==='changed-version')page.faq[0]!.entry.scriptVersion++;
          if(fault==='changed-answer')page.faq[0]!.entry.answerText='篡改正文';
          if(fault==='changed-reference')page.faq[0]!.entry.productRefs=[{id:'other',displayVersion:1}];
          return fault==='malformed'?{...page,unexpected:true}:page;
        });
        await expect(catalog.copy(key)).rejects.toMatchObject({code:'FORBIDDEN'});
        expect(s.clipboard).not.toHaveBeenCalled();expect(catalog.read()).toBeNull();
        expect(events.at(-1)).toBe('invalidated');
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
      expect(short.read()).toBeNull();expect(s.usage.current()).toBeNull();expect(await old.copy(key)).toEqual({copied:true});
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
      expect(s.usage.current()).toBe(old);expect(await old.copy(key)).toEqual({copied:true});
    }finally{s.usage.dispose();}
  });
  it('keeps another valid handle when the server reports the requested qualification expired',async()=>{
    vi.useFakeTimers();const s=setup();const events:string[]=[];s.usage.subscribe(e=>events.push(e));
    try {
      const old=await s.usage.refresh();const key=old.read()!.faq[0]!.key;
      s.pages.mockRejectedValueOnce({code:'FORBIDDEN',reason:'LEASE_EXPIRED'});
      await expect(s.usage.refresh()).rejects.toMatchObject({code:'EXPIRED'});
      expect(s.usage.current()).toBe(old);expect(await old.copy(key)).toEqual({copied:true});
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
