import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { isIntakePermissionCommand, type IntakePermissionReply } from '../shared/content-intake-permissions';
import { ContentIntakePermissions } from './content-intake-permissions';
import { isTrustedMainFrameSender } from './sender-guard';
import type { ProductSession } from './product-session';
import { ProductHttpError } from './product-http';
const channels = ['dashboard:permissions-current','dashboard:permissions-command'] as const;
/** Private per-window controller; no renderer-supplied identity or URL. */
export function registerContentIntakePermissionsIpc(session: ProductSession | null, dashboard: () => WebContents | null, devUrl: () => string | undefined) {
  const owners=new Map<WebContents,ContentIntakePermissions>();
  for(const channel of channels)ipcMain.handle(channel,async(event,...args:unknown[]):Promise<IntakePermissionReply>=>{
    const wc=dashboard();
    if(!wc || !isTrustedMainFrameSender(event,[wc],devUrl()))return {ok:false,message:'无权访问此窗口能力。',view:null};
    if(channel==='dashboard:permissions-command'?args.length!==1 || !isIntakePermissionCommand(args[0]):args.length!==0)return {ok:false,message:'权限配置输入无效。',view:null};
    if(!session)return {ok:false,message:'权限配置尚未接入当前运行模式。',view:null};
    let owner=owners.get(wc);
    if(!owner){
      const win=BrowserWindow.fromWebContents(wc);if(!win || win.isDestroyed())return {ok:false,message:'窗口不可用。',view:null};
      owner=new ContentIntakePermissions(session);owners.set(wc,owner);const owned=owner;
      const closing=(event:{preventDefault():void})=>{if(owned.closeRisk() && dialog.showMessageBoxSync(win,{type:'warning',title:'关闭权限配置',
        message:'仍有未保存预览或结果待确认的操作。关闭不会撤销服务器已受理的操作。',buttons:['继续核对','仍然关闭'],defaultId:0,cancelId:0,noLink:true})!==1)event.preventDefault();};
      win.on('close',closing);owned.subscribe(()=>{if(!wc.isDestroyed())wc.send('dashboard:permissions-invalidated');});
      wc.once('destroyed',()=>{win.removeListener('close',closing);owners.delete(wc);owned.dispose();});
    }
    try{return {ok:true,view:channel==='dashboard:permissions-current'?owner.view():await owner.command(args[0] as Parameters<ContentIntakePermissions['command']>[0])};}
    catch(error){return {ok:false,message:error instanceof ProductHttpError && error.reason==='ROLE_CEILING'?'所选人员不能执行这些动作，请调整权限。':owner.view().pending?'操作结果待确认，请按原请求重试。':'权限、人员状态或输入已变化，请刷新后核对。',view:owner.view()};}
  });
  const allowClose=()=>{
    if(![...owners.values()].some(owner=>owner.closeRisk()))return true;
    return dialog.showMessageBoxSync({type:'warning',title:'退出权限配置',message:'仍有未保存预览或结果待确认的权限操作。退出不会撤销服务端操作。',buttons:['继续核对','仍然退出'],defaultId:0,cancelId:0,noLink:true})===1;
  };
  return {allowClose,dispose:()=>{for(const owner of owners.values())owner.dispose();owners.clear();for(const channel of channels)ipcMain.removeHandler(channel);}};
}
