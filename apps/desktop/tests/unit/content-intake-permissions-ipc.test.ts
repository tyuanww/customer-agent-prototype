// @vitest-environment node
import { expect,it,vi } from 'vitest';
import type { IpcMainInvokeEvent,WebContents } from 'electron';
import { registerContentIntakePermissionsIpc } from '../../src/main/content-intake-permissions-ipc';
const handlers=vi.hoisted(()=>new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>Promise<unknown>>());
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},ipcMain:{handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>Promise<unknown>)=>handlers.set(name,fn),removeHandler:(name:string)=>handlers.delete(name)}}));
it('rejects other windows, child frames and forged fields before accessing a session',async()=>{
 const frame={parent:null},dashboard={id:1,mainFrame:frame,isDestroyed:()=>false,getURL:()=> 'http://127.0.0.1:5173/?role=dashboard'} as unknown as WebContents;
 const owned=registerContentIntakePermissionsIpc(null,()=>dashboard,()=> 'http://127.0.0.1:5173/');
 const event=(sender:WebContents,senderFrame:unknown=frame)=>({sender,senderFrame}) as IpcMainInvokeEvent;
 try{const command=handlers.get('dashboard:permissions-command')!,current=handlers.get('dashboard:permissions-current')!;
  expect(await command(event({...dashboard,id:9} as WebContents),{action:'refresh'})).toMatchObject({ok:false,view:null});
  expect(await command(event(dashboard,{parent:frame}),{action:'refresh'})).toMatchObject({ok:false,view:null});
  expect(await command(event(dashboard),{action:'save',actor:'forged'})).toMatchObject({ok:false,message:'权限配置输入无效。'});
  expect(await current(event(dashboard),{})).toMatchObject({ok:false,message:'权限配置输入无效。'});
  expect(await command(event(dashboard),{action:'refresh'})).toMatchObject({ok:false,message:'权限配置尚未接入当前运行模式。'});
 }finally{owned.dispose();}expect(handlers.size).toBe(0);
});
