// @vitest-environment node
import { expect,it,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IpcMainInvokeEvent,WebContents } from 'electron';
import type { ProductSession } from '../../src/main/product-session';
import { registerContentIntakePermissionsIpc } from '../../src/main/content-intake-permissions-ipc';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';
import { observeSessionJob } from '../../src/shared/product-session';
const handlers=vi.hoisted(()=>new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>Promise<unknown>>());
const native=vi.hoisted(()=>({window:null as unknown,choice:0,show:vi.fn()}));
vi.mock('electron',()=>({BrowserWindow:{fromWebContents:()=>native.window},dialog:{showMessageBoxSync:(...args:unknown[])=>{native.show(...args);return native.choice;}},ipcMain:{handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>Promise<unknown>)=>handlers.set(name,fn),removeHandler:(name:string)=>handlers.delete(name)}}));
it('rejects other windows, child frames and forged fields before accessing a session',async()=>{
 const frame={parent:null},dashboard={id:1,mainFrame:frame,isDestroyed:()=>false,getURL:()=> 'http://127.0.0.1:5173/?role=dashboard'} as unknown as WebContents;
 const owned=registerContentIntakePermissionsIpc(null,()=>dashboard,()=> 'http://127.0.0.1:5173/');
 const event=(sender:WebContents,senderFrame:unknown=frame)=>({sender,senderFrame}) as IpcMainInvokeEvent;
 try{const command=handlers.get('dashboard:permissions-command')!,current=handlers.get('dashboard:permissions-current')!;
  expect(await command(event({...dashboard,id:9} as WebContents),{action:'refresh'})).toMatchObject({ok:false,view:null});
  expect(await command(event(dashboard,{parent:frame}),{action:'refresh'})).toMatchObject({ok:false,view:null});
  expect(await command(event(dashboard),{action:'save',actor:'forged'})).toMatchObject({ok:false,message:'权限配置输入无效。'});
  expect(await current(event(dashboard),{})).toMatchObject({ok:false,message:'权限配置输入无效。'});
  expect(await command(event(dashboard),{action:'refresh'})).toMatchObject({ok:false,message:'资料还不能在这里改。请把表交给客服经理。'});
 }finally{owned.dispose();}expect(handlers.size).toBe(0);
});
it('warns about losing an uncertain grant request and permits an explicit close or exit',async()=>{
 const f=intakePermissionsData(),frame={parent:null},wc=Object.assign(new EventEmitter(),{id:1,mainFrame:frame,isDestroyed:()=>false,getURL:()=> 'http://127.0.0.1:5173/?role=dashboard',send:vi.fn()}) as unknown as WebContents;
 const win=Object.assign(new EventEmitter(),{isDestroyed:()=>false});native.window=win;native.choice=0;native.show.mockClear();
 const session=f.session as unknown as ProductSession;
 const inner=session.view.bind(session);
 session.view=()=>({...inner(),job:observeSessionJob({title:'客服总监',directory:[{name:'客服总监',enabled:true}]})}) as ReturnType<ProductSession['view']>;
 const owned=registerContentIntakePermissionsIpc(session,()=>wc,()=> 'http://127.0.0.1:5173/');
 const event={sender:wc,senderFrame:frame} as IpcMainInvokeEvent;
 try{
  const command=handlers.get('dashboard:permissions-command')!;
  const refreshed=await command(event,{action:'refresh'}) as {ok:boolean;view:{people:{selection:string}[]}};
  expect(refreshed.ok).toBe(true);
  await command(event,f.command(refreshed.view.people[0]!.selection));
  const previewBlocked=vi.fn();win.emit('close',{preventDefault:previewBlocked});expect(previewBlocked).toHaveBeenCalledOnce();
  expect(native.show.mock.lastCall?.at(-1)).toMatchObject({buttons:['返回编辑','仍然关闭']});
  expect(owned.allowClose()).toBe(false);
  expect(native.show.mock.lastCall?.at(-1)).toMatchObject({buttons:['返回编辑','仍然退出']});
  f.setUnknown();await command(event,{action:'save'});
  const blocked=vi.fn();win.emit('close',{preventDefault:blocked});expect(blocked).toHaveBeenCalledOnce();
  expect(native.show.mock.lastCall?.at(-1)).toMatchObject({message:expect.stringContaining('原请求会丢失')});
  expect(native.show.mock.lastCall?.at(-1)).toMatchObject({message:expect.stringContaining('有权人员核对授权列表')});
  expect(native.show.mock.lastCall?.at(-1)).toMatchObject({buttons:['继续核对','已知需人工核对，仍然关闭']});
  expect(owned.allowClose()).toBe(false);
  expect(native.show.mock.lastCall?.at(-1)).toMatchObject({buttons:['继续核对','已知需人工核对，仍然退出']});
  native.choice=1;const allowed=vi.fn();win.emit('close',{preventDefault:allowed});expect(allowed).not.toHaveBeenCalled();
  expect(owned.allowClose()).toBe(true);
 }finally{owned.dispose();native.window=null;}
});
