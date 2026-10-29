import { expect,it,vi,afterEach } from 'vitest';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import { ProductHttpError } from '../../src/main/product-http';
import { isIntakePermissionCommand } from '../../src/shared/content-intake-permissions';
import { isDefinitiveRollback } from '../../src/shared/content-intake-recovery';
import type { ProductErrorCode } from '../../src/shared/product-session';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';
afterEach(()=>vi.useRealTimers());
it.each(['VALIDATION','FORBIDDEN','UNAUTHORIZED','CONFLICT','GONE'] as ProductErrorCode[])('recognizes pre-commit %s as definitive but not COMMIT_UNKNOWN',code=>{
 expect(isDefinitiveRollback(code)).toBe(true);
 expect(isDefinitiveRollback(code,'COMMIT_UNKNOWN')).toBe(false);
});
it('preserves recovery for transport uncertainty',()=>{
 expect(isDefinitiveRollback('UNAVAILABLE')).toBe(false);
 expect(isDefinitiveRollback('CANCELLED')).toBe(false);
});
it('keeps IDs and original batch in Main; preview unsaved, unknown retry exact, stale selections rejected',async()=>{
 const f=intakePermissionsData(),main=new ContentIntakePermissions(f.session);
 try{
  const view=await main.command({action:'refresh'});expect(view.busy).toBe(false);expect(view.people[0]!.label).toBe('合成坐席');expect(JSON.stringify(view)).not.toContain('registered-agent');
  await expect(main.command(f.command('registered-agent'))).rejects.toThrow();
  const preview=await main.command(f.command(view.people[0]!.selection));expect(preview.preview?.person).toBe('合成坐席');expect(f.receipts.size).toBe(0);
  f.setUnknown();await expect(main.command({action:'save'})).rejects.toThrow();expect(main.view().pending).toBe(true);expect(main.view().resultUnknown).toBe(true);await expect(main.command({action:'refresh'})).rejects.toThrow();
  await main.command({action:'retry'});expect(main.view().pending).toBe(false);expect(f.grants).toHaveLength(1);
  const writes=f.requests.filter(r=>r.path==='/v1/intake/grants');expect(writes).toHaveLength(2);expect(writes[0]).toEqual(writes[1]);expect(writes[0]!.method).toBe('POST');
  expect([...f.receipts.keys()]).toEqual([(writes[0]!.body as {operationId:string}).operationId]);
  const current=await main.command({action:'refresh'});await expect(main.command(f.command(view.people[0]!.selection))).rejects.toThrow();expect(current.grants[0]!.canRevoke).toBe(true);
  expect(current.grants[0]!.personSelection).toBe(current.people[0]!.selection);
 }finally{main.dispose();}
});
it('rejects retry without a pending operation as a typed conflict',async()=>{
 const f=intakePermissionsData(),main=new ContentIntakePermissions(f.session);
 try{
  await expect(main.command({action:'retry'})).rejects.toMatchObject({code:'CONFLICT'});
  expect(main.view().pending).toBe(false);
  expect(main.view().resultUnknown).toBe(false);
  expect(f.requests).toHaveLength(0);
 }finally{main.dispose();}
});
it('releases a fresh grant request after a definitive 404 scope rejection',async()=>{
 const f=intakePermissionsData(),main=new ContentIntakePermissions(f.session),original=f.session.request;
 try{
  const view=await main.command({action:'refresh'});await main.command(f.command(view.people[0]!.selection));
  f.session.request=async(epoch,path,options)=>{
   if(path==='/v1/intake/grants' && options.body)throw new ProductHttpError('GONE','SCOPE_DENIED');
   return original(epoch,path,options);
  };
  await expect(main.command({action:'save'})).rejects.toMatchObject({code:'GONE',reason:'SCOPE_DENIED'});
  expect(main.view().pending).toBe(false);
  expect(f.receipts.size).toBe(0);
  f.session.request=original;
  await main.command({action:'refresh'});
 }finally{main.dispose();}
});
it('keeps an uncertain grant operation when a later qualification rejection cannot read its receipt',async()=>{
 const f=intakePermissionsData(),main=new ContentIntakePermissions(f.session),original=f.session.request;
 try{
  const initial=await main.command({action:'refresh'});await main.command(f.command(initial.people[0]!.selection));
  f.setUnknown();await expect(main.command({action:'save'})).rejects.toMatchObject({code:'UNAVAILABLE'});
  expect(main.view().pending).toBe(true);expect(f.grants).toHaveLength(1);
  const originalBody=f.requests.find(r=>r.path==='/v1/intake/grants')!.body;
  f.session.request=async(epoch,path,options)=>{
   if(path==='/v1/intake/grants' && options.body)throw new ProductHttpError('FORBIDDEN');
   return original(epoch,path,options);
  };
  await expect(main.command({action:'retry'})).rejects.toMatchObject({code:'FORBIDDEN'});
  expect(main.view().pending).toBe(true);
  expect(main.view().notice).toContain('当前资格已拒绝重试');
  f.session.request=original;
  await main.command({action:'retry'});
  expect(main.view().pending).toBe(false);expect(f.grants).toHaveLength(1);
  expect(f.requests.filter(r=>r.path==='/v1/intake/grants').at(-1)!.body).toEqual(originalBody);
 }finally{main.dispose();}
});
it('keeps the original grant request when stopping after a possible commit precedes a forbidden retry',async()=>{
 const f=intakePermissionsData(),main=new ContentIntakePermissions(f.session),original=f.session.request;
 let release!:()=>void,attempts=0;
 const bodies:unknown[]=[];
 try{
  const initial=await main.command({action:'refresh'});await main.command(f.command(initial.people[0]!.selection));
  f.session.request=async(epoch,path,options)=>{
   if(path==='/v1/intake/grants' && options.body){
    bodies.push(structuredClone(options.body));attempts++;
    if(attempts===1){
     const committed=await original(epoch,path,options);
     await new Promise<void>(resolve=>{release=resolve;});
     return committed;
    }
    if(attempts===2)throw new ProductHttpError('FORBIDDEN');
   }
   return original(epoch,path,options);
  };
  const first=main.command({action:'save'}),stale=expect(first).rejects.toMatchObject({code:'STALE'});
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  expect(f.grants).toHaveLength(1);
  await main.command({action:'stop'});release();await stale;
  await expect(main.command({action:'retry'})).rejects.toMatchObject({code:'FORBIDDEN'});
  expect(main.view().pending).toBe(true);
  expect(main.view().notice).toContain('当前资格已拒绝重试');
  await main.command({action:'retry'});
  expect(main.view().pending).toBe(false);expect(f.grants).toHaveLength(1);
  expect(bodies).toHaveLength(3);expect(bodies[1]).toEqual(bodies[0]);expect(bodies[2]).toEqual(bodies[0]);
  expect([...f.receipts.keys()]).toEqual([(bodies[0] as {operationId:string}).operationId]);
 }finally{main.dispose();}
});
it('keeps the exact revoke operation through stop, forbidden retry, then receipt recovery',async()=>{
 const f=intakePermissionsData(),main=new ContentIntakePermissions(f.session),original=f.session.request;
 let release!:()=>void,attempts=0;const writes:{path:string;method:string|undefined;body:unknown}[]=[];
 try{
  const initial=await main.command({action:'refresh'});await main.command(f.command(initial.people[0]!.selection));await main.command({action:'save'});
  const saved=await main.command({action:'refresh'}),originalGrantId=saved.grants[0]!.reference;
  f.session.request=async(epoch,path,options)=>{
   if(path.startsWith('/v1/intake/grants/') && options.body){
    writes.push({path,method:(options as {method?:string}).method,body:structuredClone(options.body)});attempts++;
    if(attempts===1){const committed=await original(epoch,path,options);await new Promise<void>(resolve=>{release=resolve;});return committed;}
    if(attempts===2)throw new ProductHttpError('FORBIDDEN');
   }
   return original(epoch,path,options);
  };
  const first=main.command({action:'revoke',selection:saved.grants[0]!.selection,reason:'合成撤销'}),stale=expect(first).rejects.toMatchObject({code:'STALE'});
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  expect(f.grants[0]!.revokedAt).not.toBeNull();expect(f.receipts.size).toBe(2);
  await main.command({action:'stop'});release();await stale;
  await expect(main.command({action:'retry'})).rejects.toMatchObject({code:'FORBIDDEN'});
  expect(main.view().pending).toBe(true);
  await main.command({action:'retry'});
  expect(main.view().pending).toBe(false);
  expect(writes).toHaveLength(3);expect(writes[1]).toEqual(writes[0]);expect(writes[2]).toEqual(writes[0]);
  expect(writes[0]).toMatchObject({path:`/v1/intake/grants/${originalGrantId}`,method:'PATCH'});
  expect(new Set(f.receipts.keys())).toEqual(new Set([(f.requests.find(r=>r.path==='/v1/intake/grants')!.body as {operationId:string}).operationId,(writes[0]!.body as {operationId:string}).operationId]));
  expect(f.grants).toHaveLength(1);expect(f.grants[0]!.grantId).toBe(originalGrantId);expect(f.grants[0]!.version).toBe(2);
 }finally{main.dispose();}
});
it('revokes an identifiable grant record after its current name disappears without exposing hidden identity',async()=>{
 const f=intakePermissionsData(),main=new ContentIntakePermissions(f.session);
 try{const initial=await main.command({action:'refresh'});await main.command(f.command(initial.people[0]!.selection));await main.command({action:'save'});
  f.hidePerson();const view=await main.command({action:'refresh'});expect(view.people).toEqual([]);expect(view.grants[0]).toMatchObject({person:'当前姓名不可用',personSelection:null,reference:'created-business',canRevoke:true});
  expect(JSON.stringify(view)).not.toContain('registered-agent');await main.command({action:'revoke',selection:view.grants[0]!.selection,reason:'合成离职撤销'});expect(f.grants[0]!.revokedAt).not.toBeNull();
 }finally{main.dispose();}
});
it('expires selected person and preview before caller deadline and notifies the view',async()=>{
 vi.useFakeTimers({toFake:['Date','performance','setTimeout','clearTimeout']});const f=intakePermissionsData();f.person.validUntil=new Date(Date.now()+1000).toISOString();
 const main=new ContentIntakePermissions(f.session),changed=vi.fn();main.subscribe(changed);
 try{const view=await main.command({action:'refresh'});await main.command(f.command(view.people[0]!.selection));await vi.advanceTimersByTimeAsync(1100);
  expect(main.view().people).toEqual([]);expect(main.view().preview).toBeNull();expect(changed).toHaveBeenCalled();await expect(main.command({action:'save'})).rejects.toThrow();
 }finally{main.dispose();}
});
it('notifies subscribers when stop or discard clears a local preview',async()=>{
 const f=intakePermissionsData(),main=new ContentIntakePermissions(f.session),changed=vi.fn();main.subscribe(changed);
 try{
  const view=await main.command({action:'refresh'});await main.command(f.command(view.people[0]!.selection));
  expect(main.view().preview?.person).toBe('合成坐席');changed.mockClear();
  const stopped=await main.command({action:'stop'});expect(stopped.preview).toBeNull();expect(stopped.notice).toBe('已停止读取。');expect(changed).toHaveBeenCalledTimes(1);
  await main.command(f.command(view.people[0]!.selection));expect(main.view().preview).not.toBeNull();changed.mockClear();
  const discarded=await main.command({action:'discard'});expect(discarded.preview).toBeNull();expect(changed).toHaveBeenCalledTimes(1);
 }finally{main.dispose();}
});
it('cancels pending reads, discards late results and invalidates prior-session selections',async()=>{
 const f=intakePermissionsData(),original=f.session.request;let release!:()=>void;
 f.session.request=async(epoch,path,options)=>{if(path.startsWith('/v1/intake/principals'))await new Promise<void>(resolve=>{release=resolve;});return original(epoch,path,options);};
 const main=new ContentIntakePermissions(f.session);
 try{const reading=main.command({action:'refresh'});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));await main.command({action:'stop'});release();await expect(reading).rejects.toThrow();
  f.logout();expect(main.view().people).toEqual([]);expect(main.view().available).toBe(false);await expect(main.command({action:'refresh'})).rejects.toThrow();
 }finally{main.dispose();}
});
it('rejects actor/grant IDs and arbitrary actions at renderer boundary',()=>{
 expect(isIntakePermissionCommand({action:'save',actor:'director'})).toBe(false);expect(isIntakePermissionCommand({action:'revoke',grantId:'g',reason:'r'})).toBe(false);
 expect(isIntakePermissionCommand({action:'preview',person:'h',actions:['review'],startsAt:'x',expiresAt:'y',reason:'r'})).toBe(false);
});

it.each(['stopped retry', 'new session'] as const)('late rejected writes cannot erase recovery for the %s', async transition => {
 const f=intakePermissionsData(),originalRequest=f.session.request,originalSubscribe=f.session.subscribe;
 let notifySession!:()=>void,rejectFirst!:(error:Error)=>void,releaseSecond!:()=>void;
 const bodies:unknown[]=[];
 f.session.subscribe=listener=>{notifySession=listener;return originalSubscribe(listener);};
 f.session.request=async(epoch,path,options)=>{
  if(path==='/v1/intake/grants' && options.body){
   bodies.push(structuredClone(options.body));
   if(bodies.length===1)await new Promise<void>((_resolve,reject)=>{rejectFirst=reject;});
   if(bodies.length===2)await new Promise<void>(resolve=>{releaseSecond=resolve;});
  }
  return originalRequest(epoch,path,options);
 };
 const main=new ContentIntakePermissions(f.session);
 try{
  const initial=await main.command({action:'refresh'});await main.command(f.command(initial.people[0]!.selection));
  const first=main.command({action:'save'}),staleFailure=expect(first).rejects.toMatchObject({code:'STALE'});
  await vi.waitFor(()=>expect(rejectFirst).toBeTypeOf('function'));
  if(transition==='stopped retry'){
   await main.command({action:'stop'});expect(main.view().pending).toBe(true);
  }else{
   f.logout();expect(main.view().pending).toBe(false);
   // Reauthentication owns a new epoch: never replay the old session's body.
   f.session.view=()=>({signedIn:true,sessionEpoch:3});notifySession();
   const current=await main.command({action:'refresh'});await main.command(f.command(current.people[0]!.selection));
  }
  const current=main.command({action:transition==='stopped retry'?'retry':'save'});
  const unknownFailure=expect(current).rejects.toMatchObject({code:'UNAVAILABLE'});
  await vi.waitFor(()=>expect(releaseSecond).toBeTypeOf('function'));
  rejectFirst(new ProductHttpError('FORBIDDEN'));await staleFailure;
  expect(main.view().pending).toBe(true);expect(main.view().busy).toBe(true);
  // The active attempt commits but loses its response; only its exact body may
  // recover that receipt, even though an old request just failed definitively.
  f.setUnknown();releaseSecond();await unknownFailure;
  expect(main.view().pending).toBe(true);expect(main.closeRisk()).toBe(true);
  await main.command({action:'retry'});
  expect(main.view().pending).toBe(false);expect(main.closeRisk()).toBe(false);
  expect(f.grants).toHaveLength(1);expect(bodies).toHaveLength(3);
  expect(bodies[2]).toEqual(bodies[1]);
  if(transition==='stopped retry')expect(bodies[1]).toEqual(bodies[0]);
  else expect(bodies[1]).not.toEqual(bodies[0]);
 }finally{main.dispose();}
});
