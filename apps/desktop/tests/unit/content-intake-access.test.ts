// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { components } from '@customer-agent/contracts';
import { loadIntakeAccess } from '../../src/main/content-intake-access';
import type { IntakeUsageSession } from '../../src/main/content-intake-usage';

type C = components['schemas'];
function fixture(count = 1) {
  const until = new Date(Date.now()+60_000).toISOString();
  const sources: C['IntakeSource'][] = Array.from({length:count},(_,i)=>({
    scope:{tenantId:'tenant-a',appId:'app-a',brandId:'brand-a',shopId:`shop-${i}`,domain:'product',sourceId:`source-${i}`},
    version:1,templateVersion:'faq-p1.1',ruleVersion:'intake-p1.1',mappingVersion:'mapping-p1.1',structureDigest:'a'.repeat(64),contentIntakeMode:'v2-preview',modeVersion:1,
  }));
  const auth: C['IntakeAuthorization'] = {factsVersion:1,revocationGeneration:0,policyVersion:1,validUntil:until,nextCursor:null,
    capabilities:sources.map(s=>({scope:{...s.scope},actions:['query'],mayAllocate:[],mayDelegate:[],validUntil:until}))};
  const listeners=new Set<()=>void>();const state={signedIn:true,sessionEpoch:1};
  const requests: {path:string; options:Parameters<IntakeUsageSession['request']>[2]}[]=[];
  const respond=(_epoch:number,path:string,options:Parameters<IntakeUsageSession['request']>[2])=>{
    requests.push({path,options});const url=new URL(path,'http://synthetic.invalid');
    const start=Number(url.searchParams.get('cursor')??0),end=start+100;
    const data=url.pathname.endsWith('authorization')?auth.capabilities:sources;
    return {value:url.pathname.endsWith('authorization')?{...auth,capabilities:data.slice(start,end),nextCursor:end<data.length?String(end):null}
      :{items:data.slice(start,end),nextCursor:end<data.length?String(end):null}};
  };
  const session: IntakeUsageSession={view:()=>({...state}),subscribe:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},request:vi.fn(async(...args:Parameters<IntakeUsageSession['request']>)=>respond(...args))};
  return {auth,sources,session,state,listeners,requests,respond};
}

it('assembles all pages, fences the two lists, and exposes only explicit queryable shops',async()=>{
  const f=fixture(102);
  f.sources[0].scope.shopId=null;f.auth.capabilities[0].scope.shopId=null;
  f.sources[1].contentIntakeMode='legacy';
  f.auth.capabilities[2].actions=[];f.auth.capabilities[2].mayAllocate=['query'];
  const access=await loadIntakeAccess(f.session);
  expect(access.sources).toHaveLength(102);expect(access.shops).toHaveLength(99);
  expect(access.shops).not.toContain('shop-0');expect(access.shops).not.toContain('shop-1');expect(access.shops).not.toContain('shop-2');
  expect(f.requests).toHaveLength(6);expect(f.requests[5].options.maxResponseBytes).toBeLessThan(f.requests[0].options.maxResponseBytes!);
  expect(f.listeners.size).toBe(0);expect(f.requests.every(r=>r.options.signal.aborted)).toBe(true);
});

it('returns an explicit empty selection when the subject has no scope',async()=>{
  const f=fixture(0);expect(await loadIntakeAccess(f.session)).toMatchObject({shops:[],sources:[],capabilities:[]});
});

it.each(['permission-change','scope-mismatch','missing-source','duplicate-source','cyclic-cursor','expired'])(
  'rejects %s without returning a partial menu',async failure=>{
    const f=fixture();let authReads=0;
    // Both reads represent the same expired authority, not a changed deadline.
    const expiredUntil=new Date(Date.now()-10_000).toISOString();
    vi.mocked(f.session.request).mockImplementation(async(...args)=>{
      const result=f.respond(...args);const isAuth=args[1].includes('/authorization?');
      if(isAuth) {
        authReads++;
        const page=result.value as C['IntakeAuthorization'];
        if(failure==='permission-change'&&authReads===2)page.revocationGeneration++;
        if(failure==='expired') { page.validUntil=expiredUntil; page.capabilities[0].validUntil=page.validUntil; }
      } else {
        const page=result.value as C['IntakeSourceList'];
        if(failure==='scope-mismatch')page.items[0]={...page.items[0],scope:{...page.items[0].scope,shopId:'other-shop'}};
        if(failure==='missing-source')page.items=[];
        if(failure==='duplicate-source')page.items.push(page.items[0]);
        if(failure==='cyclic-cursor')page.nextCursor='0';
      }
      return result;
    });
    await expect(loadIntakeAccess(f.session)).rejects.toMatchObject({code:failure==='expired'?'EXPIRED'
      :failure==='duplicate-source'||failure==='cyclic-cursor'?'FORBIDDEN':'STALE'});
    expect(f.listeners.size).toBe(0);
  });

it.each(['cancel','relogin','logout'] as const)('isolates an uncooperative late page after %s',async failure=>{
  const f=fixture();const controller=new AbortController();let release!:()=>void;
  const waiting=new Promise<void>(r=>{release=r;});
  vi.mocked(f.session.request).mockImplementationOnce(async(...args)=>{await waiting;return f.respond(...args);});
  const result=loadIntakeAccess(f.session,controller.signal);const rejected=expect(result).rejects.toMatchObject({code:'STALE'});
  if(failure==='cancel')controller.abort();
  else {if(failure==='relogin')f.state.sessionEpoch++;else f.state.signedIn=false;f.listeners.forEach(fn=>fn());}
  release();await rejected;expect(f.requests).toHaveLength(1);expect(f.listeners.size).toBe(0);
});

it('fails closed on oversized input and performs no unauthenticated I/O',async()=>{
  const f=fixture();f.state.signedIn=false;
  await expect(loadIntakeAccess(f.session)).rejects.toMatchObject({code:'UNAUTHORIZED'});expect(f.session.request).not.toHaveBeenCalled();
  f.state.signedIn=true;vi.mocked(f.session.request).mockResolvedValueOnce({value:{padding:'x'.repeat(8*1024*1024)}});
  await expect(loadIntakeAccess(f.session)).rejects.toMatchObject({code:'LIMIT'});expect(f.listeners.size).toBe(0);
});
