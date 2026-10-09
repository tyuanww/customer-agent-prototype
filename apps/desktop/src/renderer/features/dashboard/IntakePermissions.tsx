import { useEffect, useRef, useState } from 'react';
import { INTAKE_PERMISSION_ACTION_LABELS as labels, type IntakePermissionCommand, type IntakePermissionView } from '@shared/content-intake-permissions';
import { formatIntakeTime } from './intake-time';
export function IntakePermissions({ active }: { active: boolean }) {
  const [view,setView]=useState<IntakePermissionView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [person,setPerson]=useState(''),[actions,setActions]=useState<IntakePermissionView['actions']>([]);
  const [starts,setStarts]=useState(''),[expires,setExpires]=useState(''),[reason,setReason]=useState('');
  const [revoke,setRevoke]=useState(''),[revokeReason,setRevokeReason]=useState('');
  const generation=useRef(0),pending=useRef(false),started=useRef(false);
  const apply=async(command?:IntakePermissionCommand)=>{
    if(pending.current && command?.action!=='stop')return;
    const gen=++generation.current;pending.current=true;setBusy(true);setError('');
    try{const api=window.dashboardPermissions;if(!api)throw new Error('unavailable');
      const reply=await(command?api.command(command):api.current());if(gen!==generation.current)return;
      setView(reply.view);if(!reply.ok)setError(reply.message);
    }catch{if(gen===generation.current){setError('权限配置暂不可用，请重新读取。');setView(null);}}
    finally{if(gen===generation.current){pending.current=false;setBusy(false);}}
  };
  useEffect(()=>{
    if(!active || started.current)return;started.current=true;void apply({action:'refresh'});
  },[active]);
  useEffect(()=>{
    const api=window.dashboardPermissions;if(!api)return;
    return api.onInvalidated(()=>{if(!pending.current)void apply();});
  },[]);
  useEffect(()=>{setPerson('');setActions([]);setRevoke('');setRevokeReason('');},[view?.source]);
  useEffect(()=>{if(!view?.validUntil)return;const timer=setTimeout(()=>void apply(),Math.max(0,Date.parse(view.validUntil)-Date.now()));return()=>clearTimeout(timer);},[view?.validUntil]);
  useEffect(()=>()=>{generation.current++;},[]);
  const disabled=busy || !!view?.busy || !!view?.pending;
  return <section className="intake-management" aria-label="权限配置">
    <header><div><h1>权限配置</h1><p>总监、经理在已获分配资格的范围内直接配置业务权限，无需审批。</p></div></header>
    <div className="intake-toolbar"><button disabled={disabled || !!view?.preview} onClick={()=>void apply({action:'refresh'})}>刷新权限列表</button>
      <button disabled={!busy && !view?.busy} onClick={()=>void apply({action:'stop'})}>停止等待</button></div>
    {error && <p role="alert">{error}</p>}{view?.notice && <p role="status">{view.notice}</p>}
    {view?.pending && <div className="intake-notice"><p>结果尚未确认。请按原请求重试，不要重复新建授权。</p><button disabled={busy} onClick={()=>void apply({action:'retry'})}>按原请求确认结果</button></div>}
    {view && !view.signedIn && <p>请先登录。</p>}
    {view?.signedIn && !view.available && !view.pending && <p>当前没有可配置范围，或读取资格已到期。请刷新核对。</p>}
    {view?.available && <>
      <label>配置范围<select aria-label="配置范围" disabled={disabled || !!view.preview} value={view.source??''} onChange={e=>void apply({action:'source',selection:e.target.value})}>
        <option value="">请选择已有范围</option>{view.sources.map(s=><option key={s.selection} value={s.selection}>{s.label}</option>)}</select></label>
      {view.source && <>
        {!view.preview ? <fieldset disabled={disabled}><legend>新增业务权限</legend>
          <label>人员<select aria-label="人员" value={person} onChange={e=>setPerson(e.target.value)}><option value="">请选择已确认人员</option>{view.people.map(p=><option key={p.selection} value={p.selection}>{p.label}</option>)}</select></label>
          {!view.people.length && <p>当前没有可选择的人员。</p>}
          <div role="group" aria-label="业务动作">{view.actions.map(action=><label key={action}><input type="checkbox" checked={actions.includes(action)} onChange={e=>setActions(current=>e.target.checked?[...current,action]:current.filter(a=>a!==action))}/>{labels[action]}</label>)}</div>
          <label>生效时间<input aria-label="生效时间" type="datetime-local" value={starts} onChange={e=>setStarts(e.target.value)}/></label>
          <label>失效时间<input aria-label="失效时间" type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)}/></label>
          <p>时间按本机时区填写，范围和期限仍由服务器核对。</p>
          <label>授权原因<textarea aria-label="授权原因" maxLength={512} value={reason} onChange={e=>setReason(e.target.value)}/></label>
          <button disabled={!person || !actions.length || !starts || !expires || !reason.trim() || !Number.isFinite(Date.parse(starts)) || !Number.isFinite(Date.parse(expires))}
            onClick={()=>void apply({action:'preview',person,actions,startsAt:new Date(starts).toISOString(),expiresAt:new Date(expires).toISOString(),reason})}>预览权限</button>
        </fieldset>:<section aria-label="权限预览"><h2>预览 · 尚未保存</h2><p>{view.preview.person} · {view.preview.scope}</p>
          <p>{view.preview.actions.map(a=>labels[a]).join('、')}</p><p>{formatIntakeTime(view.preview.startsAt)} 至 {formatIntakeTime(view.preview.expiresAt)}</p><p>{view.preview.reason}</p>
          <div className="intake-toolbar"><button className="dash-action-primary" disabled={disabled} onClick={()=>void apply({action:'save'})}>确认保存权限</button>
          <button disabled={disabled} onClick={()=>void apply({action:'discard'})}>返回修改</button></div></section>}
        <section aria-label="已有业务权限"><h2>当前可管理的业务权限</h2><p>当前姓名不可用时，请依据授权记录编号、范围和原授权原因核对后撤销；不会猜测人员。</p>
          {!view.grants.length && <p>此范围暂无可管理业务权限。</p>}
          {view.grants.map(g=><article className="intake-card" key={g.selection}><h3>{g.person} · {labels[g.action]}</h3><p>授权记录 {g.reference}</p><p>原授权原因：{g.reason}</p><p>{g.scope} · {formatIntakeTime(g.startsAt)} 至 {formatIntakeTime(g.expiresAt)} · {g.revoked?'已撤销':'授权记录（实际使用仍核验当前资格）'}</p>
            <button className="intake-danger" disabled={disabled || !g.canRevoke || !!view.preview} onClick={()=>{setRevoke(g.selection);setRevokeReason('');}}>撤销该权限</button>
            {revoke===g.selection && <fieldset disabled={disabled}><legend>核对撤销</legend><label>撤销原因<textarea aria-label="撤销原因" maxLength={512} value={revokeReason} onChange={e=>setRevokeReason(e.target.value)}/></label>
              <div className="intake-toolbar"><button className="intake-danger" disabled={!revokeReason.trim()} onClick={()=>void apply({action:'revoke',selection:revoke,reason:revokeReason})}>确认撤销</button><button onClick={()=>setRevoke('')}>取消</button></div></fieldset>}
          </article>)}
        </section>
      </>}
    </>}
  </section>;
}
