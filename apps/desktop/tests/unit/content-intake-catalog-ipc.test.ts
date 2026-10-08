// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { registerContentIntakeCatalogIpc } from '../../src/main/content-intake-catalog-ipc';
import type { IntakeUsageSession } from '../../src/main/content-intake-usage';
import { isIntakeCatalogCommand } from '../../src/shared/content-intake-catalog';
const handlers=vi.hoisted(()=>new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>Promise<unknown>>());
vi.mock('electron',()=>({ipcMain:{handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>Promise<unknown>)=>handlers.set(name,fn),removeHandler:(name:string)=>handlers.delete(name)}}));
const channels=['dashboard:intake-catalog-current','dashboard:intake-catalog-command'];
function window(id=1,role='dashboard'){
 const frame={parent:null};let destroyed=()=>{};
 const wc={id,mainFrame:frame,isDestroyed:()=>false,getURL:()=>`http://127.0.0.1:5173/?role=${role}`,send:vi.fn(),once:(_event:string,listener:()=>void)=>{destroyed=listener;}} as unknown as WebContents;
 return {wc,event:(sender=wc,senderFrame:unknown=frame)=>({sender,senderFrame}) as IpcMainInvokeEvent,destroy:()=>destroyed()};
}
it('gates exact read commands on Dashboard identity, role, main frame and enabled profile',async()=>{
 const w=window();let current=w.wc;const dispose=registerContentIntakeCatalogIpc(null,()=>current,()=> 'http://127.0.0.1:5173/');
 try{for(const [i,channel]of channels.entries()){
 const fn=handlers.get(channel)!;const args=i?[{action:'refresh'}]:[];
 for(const event of [w.event(window(2).wc),w.event(w.wc,{}),w.event(w.wc,{parent:{}})])expect(await fn(event,...args)).toMatchObject({ok:false,code:'FORBIDDEN'});
 expect(await fn(w.event(),...args,{})).toMatchObject({code:'VALIDATION'});expect(await fn(w.event(),...args)).toMatchObject({code:'UNAVAILABLE'});
 current=window(1,'query').wc;expect(await fn(w.event(current,current.mainFrame),...args)).toMatchObject({code:'FORBIDDEN'});current=w.wc;
 }
 for(const command of [{action:'refresh',url:'https://invalid.example'},{action:'copy',key:'x'},{action:'select-shop',shopId:'a',sessionEpoch:1},{action:'select-conditions',productIds:[],scenarioIds:[],domain:'product'}]){
 expect(isIntakeCatalogCommand(command)).toBe(false);expect(await handlers.get(channels[1]!)!(w.event(),command)).toMatchObject({code:'VALIDATION'});
 }
 }finally{dispose();}expect(handlers.size).toBe(0);
});
it('uses one owner per Dashboard and releases session listeners on destruction and shutdown',async()=>{
 const listeners=new Set<()=>void>();const session:IntakeUsageSession={view:()=>({signedIn:true,sessionEpoch:1}),subscribe:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},request:vi.fn()};
 const a=window(),b=window(2);let current=a.wc;const dispose=registerContentIntakeCatalogIpc(session,()=>current,()=> 'http://127.0.0.1:5173/');
 try{const fn=handlers.get(channels[0]!)!;
 expect(await fn(a.event())).toMatchObject({ok:true,view:{busy:false,rows:[]}});const oneOwner=listeners.size;expect(oneOwner).toBeGreaterThan(0);
 await fn(a.event());expect(listeners.size).toBe(oneOwner);current=b.wc;await fn(b.event());expect(listeners.size).toBe(oneOwner*2);
 a.destroy();expect(listeners.size).toBe(oneOwner);expect(session.request).not.toHaveBeenCalled();
 }finally{dispose();}expect(listeners.size).toBe(0);expect(handlers.size).toBe(0);
});
