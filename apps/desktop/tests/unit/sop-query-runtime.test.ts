// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SopQueryRuntime, executableSopGraph } from '../../src/main/sop-query-runtime';
import { ProductHttp } from '../../src/main/product-http';
import type { ProductSession } from '../../src/main/product-session';
import { isSopQueryResponse, isSopQueryProjection, SOP_QUERY_CONTRACT } from '../../src/shared/sop-query';
import { intakeQueryData } from '../fixtures/intake-query-data';
import { sopQueryData } from '../fixtures/sop-query-data';

const cleanups: (()=>Promise<void>|void)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse()) await cleanup();});
async function setup() {
  const data=intakeQueryData(), copies:string[]=[], requests:{path:string;header:unknown;body:Record<string,unknown>}[]=[];
  let transform=(value:ReturnType<typeof sopQueryData>):unknown=>value;
  let delay:Promise<void>|null=null, status=200, epoch=1;
  const listeners=new Set<()=>void>();
  const server=createServer(async(req,res)=> {
    let body='';for await(const chunk of req)body+=String(chunk);
    const value=body?JSON.parse(body):{};
    requests.push({path:req.url!,header:req.headers['x-intake-contract-set'],body:value});
    res.setHeader('content-type','application/json');
    if(req.url==='/v1/sop/query') {
      const answer=transform(sopQueryData(value.request_id));
      if(delay)await delay;
      res.statusCode=status;res.setHeader('x-intake-contract-set',SOP_QUERY_CONTRACT);res.end(JSON.stringify(answer));return;
    }
    try {res.end(JSON.stringify(data.respond(req.url!,value)));} catch {res.statusCode=403;res.end('{}');}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  cleanups.push(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const http=new ProductHttp(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  const session={view:()=>({signedIn:true,sessionEpoch:epoch}),subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},request:(_epoch:number,path:string,options:Parameters<ProductHttp['request']>[1])=>http.request(path,{...options,token:'synthetic-only'})} as unknown as ProductSession;
  const runtime=new SopQueryRuntime(session,text=>copies.push(text));cleanups.push(()=>runtime.dispose());
  await runtime.open(1);
  const query=()=>runtime.command({kind:'query',group:'过敏流程SOP',shopKey:runtime.projection().shops[0]!.key,text:'合成问题'});
  return {runtime,copies,requests,query,transform:(fn:typeof transform)=>{transform=fn;},delay:(p:Promise<void>|null)=>{delay=p;},status:(s:number)=>{status=s;},logout:()=>{epoch++;for(const fn of listeners)fn();}};
}

describe('independent SOP HTTP to Main consumer',()=> {
  it('preserves explicit graph edges and separate messages, rechecks before copying exact text',async()=> {
    const h=await setup();await h.query();
    expect(h.runtime.projection()).toMatchObject({state:'ready',messages:[]});
    await h.runtime.command({kind:'choose',key:h.runtime.projection().branches[0]!.key});
    const messages=h.runtime.projection().messages;
    const beforeReopen = h.runtime.projection();
    await h.runtime.open(1);
    expect(h.runtime.projection()).toEqual(beforeReopen);
    expect(messages.map(m=>m.body)).toEqual(['这是合成原文甲。\n保留换行。','这是合成原文乙。']);
    expect(messages[1]!.canCopy).toBe(false);
    expect((await h.runtime.command({kind:'copy',key:messages[1]!.key})).ok).toBe(false);
    await h.runtime.command({kind:'copy',key:messages[0]!.key});
    expect(h.copies).toEqual([messages[0]!.body]);
    expect(h.requests.filter(r=>r.path==='/v1/sop/query')).toHaveLength(4);
    expect(h.requests.filter(r=>r.path==='/v1/sop/query').every(r=>r.header===SOP_QUERY_CONTRACT)).toBe(true);
    expect(isSopQueryProjection(h.runtime.projection())).toBe(true);
    expect(JSON.stringify(h.runtime.projection())).not.toMatch(/token|user_id|preview_handle|source_ref/);
  });
  it.each(['blocked','stale','no_match'] as const)('projects %s without content',async(state)=> {
    const h=await setup();h.transform(v=>state==='no_match'?{...v,status:state,result:{nodes:[],branches:[],messages:[],media_refs:[]}}:{...v,status:state,release_id:null,lease_expires_at:null,result:null,reasons:[{code:'SCOPE_DENIED'}]});
    await h.query();expect(h.runtime.projection()).toMatchObject({state,messages:[],branches:[],copied:false});
  });
  it('rejects media rather than constructing a preview URL',async()=> {
    const h=await setup();h.transform(v=>({...v,result:{...v.result,media_refs:[{media_id:'m',node_id:'reply',content_type:'image/png',preview_handle:'opaque',expires_at:v.lease_expires_at}]}}));
    await h.query();expect(h.runtime.projection().state).toBe('blocked');expect(h.runtime.projection().notice).toContain('图片暂不可用');expect(h.copies).toEqual([]);
  });
  it('clears content on revoked copy qualification and rejects stale handles',async()=> {
    const h=await setup();await h.query();await h.runtime.command({kind:'choose',key:h.runtime.projection().branches[0]!.key});
    const key=h.runtime.projection().messages[0]!.key;h.status(403);
    await h.runtime.command({kind:'copy',key});expect(h.copies).toEqual([]);expect(h.runtime.projection()).toMatchObject({state:'stale',messages:[]});
    h.status(200);await h.query();expect((await h.runtime.command({kind:'copy',key})).ok).toBe(false);
  });
  it('discards a late query after context invalidation',async()=> {
    const h=await setup();let release!:()=>void;h.delay(new Promise(resolve=>{release=resolve;}));
    const pending=h.query();await vi.waitFor(()=>expect(h.requests.some(r=>r.path==='/v1/sop/query')).toBe(true));h.runtime.invalidate();release();await pending;
    expect(h.runtime.projection()).toMatchObject({state:'stale',messages:[],branches:[]});
  });
  it('does not copy a late action after logout',async()=> {
    const h=await setup();await h.query();await h.runtime.command({kind:'choose',key:h.runtime.projection().branches[0]!.key});
    let release!:()=>void;h.delay(new Promise(resolve=>{release=resolve;}));
    const before=h.requests.filter(r=>r.path==='/v1/sop/query').length;
    const pending=h.runtime.command({kind:'copy',key:h.runtime.projection().messages[0]!.key});
    await vi.waitFor(()=>expect(h.requests.filter(r=>r.path==='/v1/sop/query').length).toBe(before+1));
    h.logout();release();await pending;
    expect(h.copies).toEqual([]);expect(h.runtime.projection().messages).toEqual([]);
  });
  it('rejects release changes and expired leases',async()=> {
    const h=await setup();await h.query();h.transform(v=>({...v,release_id:'changed'}));
    await h.runtime.command({kind:'choose',key:h.runtime.projection().branches[0]!.key});expect(h.runtime.projection().state).toBe('stale');
    h.transform(v=>({...v,lease_expires_at:'2000-01-01T00:00:00.000Z'}));await h.query();expect(h.runtime.projection().state).toBe('stale');
  });
  it('expires displayed content and invalidates copies at the original deadline',async()=> {
    const h=await setup();h.transform(v=>({...v,lease_expires_at:new Date(Date.now()+150).toISOString()}));
    await h.query();expect(h.runtime.projection().state).toBe('ready');
    await vi.waitFor(()=>expect(h.runtime.projection()).toMatchObject({state:'stale',messages:[],branches:[]}),{timeout:2000});
  });
  it('does not reinterpret changed copy permission as a new copy grant',async()=> {
    const h=await setup();await h.query();await h.runtime.command({kind:'choose',key:h.runtime.projection().branches[0]!.key});
    const key=h.runtime.projection().messages[0]!.key;
    h.transform(v=>({...v,result:{...v.result,messages:v.result.messages.map(m=>({...m,copy_allowed:false}))}}));
    await h.runtime.command({kind:'copy',key});expect(h.copies).toEqual([]);expect(h.runtime.projection().state).toBe('stale');
  });
  it.each([
    {risk_level:'unclassified',title:'合成话术',body:'合成正文'},
    {risk_level:'high',title:'合成过敏',body:'请先确认情况'},
    {risk_level:'high',title:'合成话术',body:'过敏后请先停手'},
  ])('refuses unsafe ready content at the Main boundary: %j',async(message)=> {
    const h=await setup();h.transform(v=>({...v,result:{...v.result,messages:[{...v.result.messages[0],...message}]}}));
    await h.query();expect(h.runtime.projection()).toMatchObject({state:'blocked',messages:[],branches:[]});expect(h.copies).toEqual([]);
  });
  it('rejects malformed wire, ambiguous edges and cycles',()=> {
    const v=sopQueryData('f65c95da-25ee-4443-9079-6370f5357536');expect(isSopQueryResponse(v)).toBe(true);
    expect(isSopQueryResponse({...v,token:'leak'})).toBe(false);
    v.result.branches[2]!.target_node_id='check';expect(executableSopGraph(v.result)).toBe(false);
    v.result.branches=[];expect(executableSopGraph(v.result)).toBe(false);
  });
});
