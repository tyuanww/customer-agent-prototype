import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { isIntakePermissionCommand, type IntakePermissionReply } from '../shared/content-intake-permissions';
import { canViewGrantSettings } from '../shared/page-use';
import { ContentIntakePermissions } from './content-intake-permissions';
import type { PageUseReader } from './page-use';
import { isTrustedMainFrameSender } from './sender-guard';
import type { ProductSession } from './product-session';
import { ProductHttpError } from './product-http';
import { WORKBENCH_EMPTY } from '../shared/workbench-empty';
import {
  DashboardControlPlaneError,
  dashboardControlPlaneForSession,
  type DashboardDomainOutcome,
  type DashboardRecoveryOutcome,
} from './dashboard-control-plane';
const channels = ['dashboard:permissions-current','dashboard:permissions-command'] as const;

function userDataDirectory(): string | null {
  try {
    return app?.getPath('userData') ?? null;
  } catch {
    return null;
  }
}

function controlMessage(error: unknown): string {
  if (!(error instanceof DashboardControlPlaneError)) return '权限操作暂未完成，请刷新后核对。';
  if (error.code === 'UNAUTHORIZED') return '请先登录。';
  if (error.code === 'FORBIDDEN') return '没有权限，请找人开通。';
  if (error.code === 'VALIDATION') return '设置输入无效。';
  return '权限操作暂未完成，请刷新后核对。';
}

/** Private per-window controller; no renderer-supplied identity or URL. */
export function registerContentIntakePermissionsIpc(
  session: ProductSession | null,
  dashboard: () => WebContents | null,
  devUrl: () => string | undefined,
  bound: { pageUse: PageUseReader; permissions: ContentIntakePermissions } | null = null,
) {
  const owners=new Map<WebContents,ContentIntakePermissions>();
  const plane = session
    ? dashboardControlPlaneForSession(session, userDataDirectory())
    : null;
  for(const channel of channels)ipcMain.handle(channel,async(event,...args:unknown[]):Promise<IntakePermissionReply>=>{
    const wc=dashboard();
    if(!wc || !isTrustedMainFrameSender(event,[wc],devUrl()))return {ok:false,message:'无权访问此窗口能力。',view:null};
    if(channel==='dashboard:permissions-command'?args.length!==1 || !isIntakePermissionCommand(args[0]):args.length!==0)return {ok:false,message:'设置输入无效。',view:null};
    if(!session)return {ok:false,message:WORKBENCH_EMPTY.intakeUnmounted,view:null};
    if(bound && !canViewGrantSettings(bound.pageUse.current()))
      return {ok:false,message:'没有权限，请找人开通。',view:null};
    let owner=owners.get(wc);
    if(!owner){
      const win=BrowserWindow.fromWebContents(wc);if(!win || win.isDestroyed())return {ok:false,message:'窗口不可用。',view:null};
      owner=bound?.permissions ?? new ContentIntakePermissions(session);owners.set(wc,owner);const owned=owner;const shared=Boolean(bound);
      const closing=(event:{preventDefault():void})=>{if(!owned.closeRisk())return;
        const unknown=owned.view().resultUnknown;
        if(dialog.showMessageBoxSync(win,{type:'warning',title:'关闭设置',
          message:unknown?'授权操作可能已提交。关闭后原请求会丢失，无法按原请求重试；请由有权人员核对授权列表，确认结果后再操作。':'仍有未保存的权限预览或读取。关闭会丢弃本机内容。',
          buttons:unknown?['继续核对','已知需人工核对，仍然关闭']:['返回编辑','仍然关闭'],defaultId:0,cancelId:0,noLink:true})!==1)event.preventDefault();};
      win.on('close',closing);owned.subscribe(()=>{if(!wc.isDestroyed())wc.send('dashboard:permissions-invalidated');});
      wc.once('destroyed',()=>{win.removeListener('close',closing);owners.delete(wc);if(!shared)owned.dispose();});
      if (plane) {
        plane.registerRecovery('permissions', async (): Promise<DashboardRecoveryOutcome> => {
          try {
            const view = await owned.command({ action: 'retry' });
            if (view.resultUnknown || view.pending) return { kind: 'unknown' };
            return { kind: 'committed', resultRef: 'permissions-retry' };
          } catch (error) {
            if (owned.view().resultUnknown || owned.view().pending) return { kind: 'unknown' };
            if (error instanceof ProductHttpError
              && ['VALIDATION', 'FORBIDDEN', 'CONFLICT', 'UNAUTHORIZED'].includes(error.code)) {
              return { kind: 'failed', failureCode: error.code };
            }
            return { kind: 'unknown' };
          }
        });
      }
    }
    try{
      if(bound && channel==='dashboard:permissions-command' && (args[0] as {action?:string}).action==='refresh'){
        await bound.pageUse.refreshPermissions(session.view().sessionEpoch);
        return {ok:true,view:owner.view()};
      }
      if (channel==='dashboard:permissions-current') return {ok:true,view:owner.view()};
      const command = args[0] as Parameters<ContentIntakePermissions['command']>[0];
      if (plane && command.action === 'retry') {
        const recovered = await plane.recover('permissions');
        if (recovered) return { ok: true, view: owner.view() };
      }
      if (!plane || (command.action !== 'save' && command.action !== 'revoke')) {
        return {ok:true,view:await owner.command(command)};
      }
      const current = owner.view();
      const scope = command.action === 'save'
        ? current.preview
        : command.action === 'revoke'
          ? current.grants.find(grant => grant.selection === command.selection) ?? null
          : null;
      const run = await plane.submit({
        domain: 'permissions',
        command: 'grants-manage',
        expectedVersion: 0,
        scope,
        intent: command,
        authorize: view => view.grants === 'open',
        onCancel: async () => {
          await owner.command({ action: 'stop' });
        },
        execute: async (): Promise<DashboardDomainOutcome<ReturnType<ContentIntakePermissions['view']>>> => {
          try {
            const view = await owner.command(command);
            if (view.resultUnknown || view.pending) return { kind: 'unknown', result: view };
            return { kind: 'committed', result: view, resultRef: command.action };
          } catch (error) {
            const live = owner.view();
            if (live.resultUnknown || live.pending) return { kind: 'unknown', result: live };
            if (error instanceof ProductHttpError
              && ['VALIDATION','FORBIDDEN','CONFLICT','UNAUTHORIZED'].includes(error.code)) {
              return { kind: 'failed', result: live, failureCode: error.code };
            }
            return { kind: 'unknown', result: live };
          }
        },
      });
      return {
        ok: true,
        view: run.result ?? {
          ...owner.view(),
          notice: run.view.state === 'unknown'
            ? '授权操作可能已经提交，请按原请求确认结果。'
            : '授权操作已完成，请刷新核对。',
        },
      };
    }
    catch(error){
      const named = owner.view().notice;
      return {ok:false,message:named ?? (error instanceof DashboardControlPlaneError ? controlMessage(error) : error instanceof ProductHttpError && error.reason==='ROLE_CEILING'?'所选人员不能执行这些动作，请调整权限。':owner.view().pending?'操作结果待确认，请按原请求重试。':'权限、人员状态或输入已变化，请刷新后核对。'),view:owner.view()};
    }
  });
  const allowClose=()=>{
    if(![...owners.values()].some(owner=>owner.closeRisk()))return true;
    const unknown=[...owners.values()].some(owner=>owner.view().resultUnknown);
    return dialog.showMessageBoxSync({type:'warning',title:'退出设置',
      message:unknown?'授权操作可能已提交。退出后原请求会丢失，无法按原请求重试；请由有权人员核对授权列表，确认结果后再操作。':'仍有未保存的权限预览或读取。退出会丢弃本机内容。',
      buttons:unknown?['继续核对','已知需人工核对，仍然退出']:['返回编辑','仍然退出'],defaultId:0,cancelId:0,noLink:true})===1;
  };
  return {allowClose,dispose:()=>{if(!bound)for(const owner of owners.values())owner.dispose();owners.clear();for(const channel of channels)ipcMain.removeHandler(channel);}};
}
