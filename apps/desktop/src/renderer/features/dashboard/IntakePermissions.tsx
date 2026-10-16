import { useEffect, useRef, useState } from 'react';
import './workbench-v9.css';
import { INTAKE_PERMISSION_ACTION_LABELS as labels, type IntakePermissionCommand, type IntakePermissionView } from '@shared/content-intake-permissions';
import { actionsForIntakePost, DEFAULT_INTAKE_POST, INTAKE_POSTS, intakePostStatusForGrants, intakePostsCoveredBy, isIntakePost, type IntakePost } from '@shared/intake-post-actions';
import type { SeatAccountIntent, SeatAccountRecord, SeatAccountReply } from '@shared/seat-account-intent';
import { formatIntakeTime, timeoutUntil } from './intake-time';

function SeatAccounts({ disabled, createOpen, setCreateOpen }: { disabled: boolean; createOpen: boolean; setCreateOpen: (open: boolean) => void }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [post, setPost] = useState<IntakePost>(DEFAULT_INTAKE_POST);
  const [rows, setRows] = useState<SeatAccountRecord[]>([]);
  const [resetting, setResetting] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [disabling, setDisabling] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const flight = useRef(false);
  const listGeneration = useRef(0);
  const blocked = disabled || busy;
  const send = async (intent: SeatAccountIntent): Promise<SeatAccountReply | null> => {
    const api = window.dashboardSeats;
    if (!api) { setProblem('账号暂不可用。'); return null; }
    if (flight.current) return null;
    flight.current = true;
    setBusy(true); setProblem('');
    try {
      const reply = await api.command(intent);
      if (!reply.ok) { setProblem(reply.message); return null; }
      return reply;
    } catch {
      setProblem('账号暂不可用。');
      return null;
    } finally { flight.current = false; setBusy(false); }
  };
  const create = async () => {
    const reply = await send({ action: 'create', displayName: name.trim(), username: username.trim(), password, post });
    if (reply === null || !reply.ok || reply.action !== 'create') return;
    listGeneration.current += 1;
    setRows(current => [...current, reply.seat]);
    setName(''); setUsername(''); setPassword(''); setPost(DEFAULT_INTAKE_POST); setCreateOpen(false);
  };
  const reset = async (login: string) => {
    const reply = await send({ action: 'reset', username: login, password: nextPassword });
    if (reply === null || !reply.ok || reply.action !== 'reset') return;
    setNextPassword(''); setResetting('');
  };
  const closeReset = () => { setResetting(''); setNextPassword(''); };
  const disable = async (login: string) => {
    const reply = await send({ action: 'disable', username: login });
    if (reply === null || !reply.ok || reply.action !== 'disable') return;
    setRows(current => current.map(row => row.username === login ? { ...row, enabled: false } : row));
    setDisabling('');
  };
  const choose = (value: string) => {
    if (!isIntakePost(value)) { setProblem('请选择岗位。'); return; }
    setPost(value);
  };
  useEffect(() => {
    const api = window.dashboardSeats;
    if (!api) { setProblem('账号暂不可用。'); return; }
    const generation = ++listGeneration.current;
    let alive = true;
    void api.command({ action: 'list' }).then(reply => {
      if (!alive || generation !== listGeneration.current) return;
      if (!reply.ok) { setProblem(reply.message); return; }
      if (reply.action === 'list') setRows(reply.seats);
    }).catch(() => { if (alive) setProblem('账号暂不可用。'); });
    return () => { alive = false; };
  }, []);
  const closeAll = () => { setCreateOpen(false); closeReset(); setDisabling(''); };
  return <section>
    {problem && <p role="alert">{problem}</p>}
    <table className="fixed" aria-label="外包坐席">
      <colgroup><col style={{ width: 140 }} /><col /><col style={{ width: 120 }} /><col style={{ width: 100 }} /><col style={{ width: 170 }} /></colgroup>
      <thead><tr><th>姓名</th><th>登录名</th><th>岗位</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={5} className="empty">还没有外包坐席。</td></tr>}
        {rows.map(row => <tr className="item" key={row.username}>
          <td>{row.displayName}</td>
          <td>{row.username}</td>
          <td>{row.post}</td>
          <td><span className="state"><i className={`dot${row.enabled ? ' ok' : ''}`} />{row.enabled ? '使用中' : '已停用'}</span></td>
          <td><div className="acts">
            {row.enabled && <button type="button" className="link" disabled={blocked} onClick={() => { setResetting(row.username); setNextPassword(''); setDisabling(''); }}>重置密码</button>}
            {row.enabled && <button type="button" className="link danger" disabled={blocked} onClick={() => { setDisabling(row.username); closeReset(); }}>停用</button>}
          </div></td>
        </tr>)}
      </tbody>
    </table>
    {createOpen && <div className="mask on" onClick={event => { if (event.target === event.currentTarget) closeAll(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="seat-create-title">
        <header><h3 id="seat-create-title">新建坐席</h3><button type="button" className="icon-btn" aria-label="关闭" onClick={closeAll}><svg className="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button></header>
        <fieldset className="fields" disabled={blocked} style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
          <label>姓名<input aria-label="姓名" autoComplete="off" value={name} onChange={event => setName(event.target.value)} /></label>
          <label>登录名<input aria-label="登录名" autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} /></label>
          <label>密码<input aria-label="密码" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
          <label>岗位<select aria-label="坐席岗位" value={post} onChange={event => choose(event.target.value)}>{INTAKE_POSTS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        </fieldset>
        <footer><button type="button" className="btn" onClick={closeAll}>取消</button>
          <button type="button" className="btn btn-primary" disabled={blocked || !name.trim() || !username.trim() || password.length === 0} onClick={() => void create()}>保存坐席</button></footer>
      </div>
    </div>}
    {resetting && <div className="mask on" onClick={event => { if (event.target === event.currentTarget) closeAll(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="seat-reset-title">
        <header><h3 id="seat-reset-title">重置密码</h3><button type="button" className="icon-btn" aria-label="关闭" onClick={closeAll}><svg className="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button></header>
        <div className="fields"><label>新密码<input aria-label="新密码" type="password" autoComplete="new-password" value={nextPassword} onChange={event => setNextPassword(event.target.value)} /></label></div>
        <footer><button type="button" className="btn" disabled={blocked} onClick={closeAll}>取消</button>
          <button type="button" className="btn btn-primary" disabled={blocked || nextPassword.length === 0} onClick={() => void reset(resetting)}>确认重置</button></footer>
      </div>
    </div>}
    {disabling && <div className="mask on" onClick={event => { if (event.target === event.currentTarget) closeAll(); }}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="seat-disable-title">
        <header><h3 id="seat-disable-title">停用坐席</h3></header>
        <p>停用后该账号无法再登录。</p>
        <footer><button type="button" className="btn" disabled={blocked} onClick={closeAll}>取消</button>
          <button type="button" className="btn btn-danger" disabled={blocked} onClick={() => void disable(disabling)}>确认停用</button></footer>
      </div>
    </div>}
  </section>;
}
export function IntakePermissions({ active, canGrant = true, grantBlock = '' }: { active: boolean; canGrant?: boolean; grantBlock?: string }) {
  const [view,setView]=useState<IntakePermissionView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [person,setPerson]=useState(''),[post,setPost]=useState<IntakePost>(DEFAULT_INTAKE_POST);
  const [starts,setStarts]=useState(''),[expires,setExpires]=useState(''),[reason,setReason]=useState('');
  const [revoke,setRevoke]=useState(''),[revokeReason,setRevokeReason]=useState('');
  const [job,setJob]=useState<'grants'|'seats'>('grants');
  const [grantOpen,setGrantOpen]=useState(false),[seatCreateOpen,setSeatCreateOpen]=useState(false);
  const [eligibilityEnded,setEligibilityEnded]=useState(false);
  const generation=useRef(0),pending=useRef(false);
  const apply=async(command?:IntakePermissionCommand): Promise<boolean>=>{
    if(pending.current && command?.action!=='stop')return false;
    const gen=++generation.current;pending.current=true;setBusy(true);setError('');
    try{const api=window.dashboardPermissions;if(!api)throw new Error('unavailable');
      const reply=await(command?api.command(command):api.current());if(gen!==generation.current)return false;
      setView(reply.view);if(!reply.ok){setError(reply.message);return false;}
      return true;
    }catch{if(gen===generation.current){setError('权限配置暂不可用，请重新读取。');setView(null);}return false;}
    finally{if(gen===generation.current){pending.current=false;setBusy(false);}}
  };
  useEffect(()=>{
    // 切走再回来时页面仍挂着。再读一次会清掉还没保存的预览。
    if(!active || view)return;
    const gen=++generation.current;
    let alive=true;
    void (async()=>{
      try{const api=window.dashboardPermissions;if(!api)throw new Error('unavailable');
        const reply=await api.command({action:'refresh'});
        if(!alive || gen!==generation.current)return;
        setView(reply.view);if(!reply.ok)setError(reply.message);
      }catch{if(alive && gen===generation.current){setError('权限配置暂不可用，请重新读取。');setView(null);}}
    })();
    return()=>{alive=false;};
  },[active,view]);
  useEffect(()=>{
    const api=window.dashboardPermissions;if(!api)return;
    return api.onInvalidated(()=>{if(!pending.current)void apply();});
  },[]);
  useEffect(()=>{setPerson('');setPost(DEFAULT_INTAKE_POST);setRevoke('');setRevokeReason('');},[view?.source]);
  useEffect(()=>{
    if(!view?.validUntil)return undefined;
    const until=Date.parse(view.validUntil);
    if(!Number.isFinite(until))return undefined;
    setEligibilityEnded(false);
    return timeoutUntil(()=>{setEligibilityEnded(true);void apply();},until);
  },[view?.validUntil]);
  useEffect(()=>()=>{generation.current++;},[]);
  const disabled=busy || !!view?.busy || !!view?.pending;
  const offered=intakePostsCoveredBy(view?.actions??[]);
  const chosen=offered.includes(post)?post:undefined;
  const previewPost=()=>{
    if(!chosen){setError('当前范围没有可授予的岗位。');return;}
    const mapped=actionsForIntakePost(chosen);
    if(!mapped.ok){setError('未知岗位。');return;}
    void apply({action:'preview',person,actions:[...mapped.actions],startsAt:new Date(starts).toISOString(),expiresAt:new Date(expires).toISOString(),reason});
  };
  const choosePost=(value:string)=>{
    if(!isIntakePost(value)){setError('未知岗位。');return;}
    setPost(value);
  };
  const closeX=<svg className="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>;
  const closeGrant=()=>{
    if(!view?.preview){setGrantOpen(false);return;}
    void apply({action:'discard'}).then((ok)=>{if(ok)setGrantOpen(false);});
  };
  const peopleRows=view?.source && view.people.length ? view.people.map(p=>{const grant=intakePostStatusForGrants(view.grants.filter(g=>g.personSelection===p.selection));return {key:p.selection,label:p.label,post:grant.post ?? '—',status:grant.status};}) : [];
  return <div className="desk-permissions-page wb9"><section className="intake-management desk-permissions wb9" aria-label="权限配置">
    <h1 className="desk-sr">权限配置</h1>
    {error && <p role="alert">{error}</p>}{view?.notice && <p role="status">{view.notice}</p>}
    {view?.pending && <div className="funnel" style={{marginTop:0,marginBottom:12}}><p className="fn-note" style={{margin:'0 0 12px'}}>{view.resultUnknown?'授权结果可能已提交。请按原请求确认，不要重复新建授权。若现在关闭窗口或退出，本机原请求会丢失；请由有权人员核对授权列表。':'正在确认授权结果；请勿重复新建授权。'}</p><button type="button" className="btn btn-sm" disabled={busy} onClick={()=>void apply({action:'retry'})}>按原请求确认结果</button></div>}
    {!view?.available && <div className="toolbar" style={{marginBottom:12}}><div className="left">
      <button type="button" className="btn" disabled={disabled || !!view?.preview} onClick={()=>void apply({action:'refresh'})}>刷新权限列表</button>
      {(busy || view?.busy) && <button type="button" className="btn" onClick={()=>void apply({action:'stop'})}>停止等待</button>}</div></div>}
    {view && !view.signedIn && <p>请先登录。</p>}
    {view?.signedIn && !view.available && !view.pending && <p>{eligibilityEnded ? '读取资格已到期。请刷新核对。' : '当前没有可配置范围。请刷新核对。'}</p>}
    {view?.available && <>
      <div className="tabbar"><div className="tabs intake-job-switch" role="tablist" aria-label="权限工作">
        <button type="button" className="tab" role="tab" aria-selected={job==='grants'} onClick={()=>setJob('grants')}>业务授权</button>
        <button type="button" className="tab" role="tab" aria-selected={job==='seats'} onClick={()=>{closeGrant();setJob('seats');}}>外包坐席</button>
      </div>
        <span className="row" style={{display:'inline-flex',gap:8,marginBottom:8}}>
          {(busy || view.busy) && <button type="button" className="btn" onClick={()=>void apply({action:'stop'})}>停止等待</button>}
          {job==='grants'
            ? <button type="button" className="btn btn-primary" style={{marginBottom:0}} disabled={disabled || !view.source || !canGrant} onClick={()=>setGrantOpen(true)}>新增授权</button>
            : <button type="button" className="btn btn-primary" style={{marginBottom:0}} onClick={()=>setSeatCreateOpen(true)}>新建坐席</button>}
        </span>
      </div>
      {grantBlock ? <p role="status">{grantBlock}</p> : null}
      <div hidden={job!=='grants'}>
        <div className="sub"><label className="lbl">配置范围<select aria-label="配置范围" style={{width:260}} disabled={disabled || !!view.preview} value={view.source??''} onChange={e=>void apply({action:'source',selection:e.target.value})}>
          <option value="">请选择已有范围</option>{view.sources.map(s=><option key={s.selection} value={s.selection}>{s.label}</option>)}</select></label>
          <button type="button" className="icon-btn bordered" style={{marginLeft:8}} aria-label="刷新权限列表" disabled={disabled || !!view.preview} onClick={()=>void apply({action:'refresh'})}><svg className="ico" viewBox="0 0 24 24"><path d="M19.5 8.5A8 8 0 0 0 5.8 7"/><path d="M5.5 3.5V7H9"/><path d="M4.5 15.5A8 8 0 0 0 18.2 17"/><path d="M18.5 20.5V17H15"/></svg></button></div>
        <table className="fixed sub" aria-label="人员"><colgroup><col style={{width:160}}/><col/><col style={{width:140}}/><col style={{width:120}}/></colgroup>
          <thead><tr><th>姓名</th><th>登录名</th><th>岗位</th><th>状态</th></tr></thead><tbody>
          {peopleRows.length ? peopleRows.map(p=><tr className="item" key={p.key}><td>{p.label}</td><td className="mute">—</td><td>{p.post}</td><td><span className="state"><i className={`dot${p.status==='已授权'?' ok':''}`} />{p.status}</span></td></tr>)
            : <tr><td colSpan={4} className="empty">{view.source ? '当前没有可选择的人员。' : '请选择配置范围。'}</td></tr>}
        </tbody></table>
        <div className="sec"><div className="sec-head"><h2>当前可管理的业务权限</h2></div>
          <section aria-label="已有业务权限">
          <table className="fixed"><colgroup><col style={{width:160}}/><col style={{width:120}}/><col/><col style={{width:130}}/></colgroup>
            <thead><tr><th>人员 / 权限</th><th>授权记录</th><th>有效期</th><th>操作</th></tr></thead><tbody>
            {!view.grants.length && <tr><td colSpan={4} className="empty">此范围暂无可管理业务权限。</td></tr>}
            {view.grants.flatMap(g=>[
              <tr className="item" key={g.selection}>
                <td>{g.person}<span className="cell-sub">{labels[g.action]}</span></td>
                <td>{g.reference}<span className="cell-sub">原授权原因：{g.reason}</span></td>
                <td>{g.scope}<span className="cell-sub">{formatIntakeTime(g.startsAt)} 至 {formatIntakeTime(g.expiresAt)} · {g.revoked?'已撤销':'授权记录（实际使用仍核验当前资格）'}</span></td>
                <td><button type="button" className="btn btn-sm btn-danger-ghost" disabled={disabled || !g.canRevoke || !!view.preview} onClick={()=>{setRevoke(g.selection);setRevokeReason('');}}>撤销该权限</button></td>
              </tr>,
              revoke===g.selection ? <tr className="expand" key={`${g.selection}-revoke`}><td colSpan={4}>
                <fieldset disabled={disabled} style={{border:0,padding:0,margin:0}}><div className="note-row"><span className="lbl">撤销原因</span>
                  <input aria-label="撤销原因" maxLength={512} value={revokeReason} onChange={e=>setRevokeReason(e.target.value)} />
                  <button type="button" className="btn btn-sm btn-danger" disabled={!revokeReason.trim()} onClick={()=>void apply({action:'revoke',selection:revoke,reason:revokeReason})}>确认撤销</button>
                  <button type="button" className="btn btn-sm" onClick={()=>setRevoke('')}>取消</button></div></fieldset></td></tr> : null,
            ])}
          </tbody></table></section></div>
      </div>
      <div hidden={job!=='seats'}><SeatAccounts disabled={disabled} createOpen={seatCreateOpen} setCreateOpen={setSeatCreateOpen} /></div>
      {grantOpen && <div className="mask on" onClick={event=>{if(event.target===event.currentTarget)closeGrant();}}>
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="grant-title">
          <header><h3 id="grant-title">{view.preview?'预览 · 尚未保存':'新增业务权限'}</h3><button type="button" className="icon-btn" aria-label="关闭" onClick={closeGrant}>{closeX}</button></header>
          {!view.preview ? <>
            <fieldset className="fields" disabled={disabled} style={{border:0,padding:0,margin:'12px 0 0'}}>
              <div className="two"><label>人员<select aria-label="人员" value={person} onChange={e=>setPerson(e.target.value)}><option value="">请选择已确认人员</option>{view.people.map(p=><option key={p.selection} value={p.selection}>{p.label}</option>)}</select></label>
              <label>岗位<select aria-label="岗位" value={chosen??''} disabled={offered.length===0} onChange={e=>choosePost(e.target.value)}>{!chosen && <option value="">{offered.length===0?'当前范围没有可授予的岗位':'请选择岗位'}</option>}{offered.map(name=><option key={name} value={name}>{name}</option>)}</select></label></div>
              <div className="two"><label>生效时间<input aria-label="生效时间" type="datetime-local" value={starts} onChange={e=>setStarts(e.target.value)}/></label>
              <label>失效时间<input aria-label="失效时间" type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)}/></label></div>
              <span className="hint">时间按本机时区填写，范围和期限仍由服务器核对。</span>
              <label>授权原因<input aria-label="授权原因" maxLength={512} value={reason} onChange={e=>setReason(e.target.value)}/></label>
            </fieldset>
            <footer><button type="button" className="btn" onClick={closeGrant}>取消</button>
              <button type="button" className="btn btn-primary" disabled={disabled || !person || !chosen || !starts || !expires || !reason.trim() || !Number.isFinite(Date.parse(starts)) || !Number.isFinite(Date.parse(expires))}
                onClick={previewPost}>预览权限</button></footer>
          </> : <section aria-label="权限预览">
            <p>{view.preview.person} · {view.preview.scope}</p>
            <p>{view.preview.actions.map(a=>labels[a]).join('、')}</p><p>{formatIntakeTime(view.preview.startsAt)} 至 {formatIntakeTime(view.preview.expiresAt)}</p><p>{view.preview.reason}</p>
            <footer><button type="button" className="btn" disabled={disabled} onClick={()=>void apply({action:'discard'})}>返回修改</button>
              <button type="button" className="btn btn-primary" disabled={disabled} onClick={()=>void apply({action:'save'}).then((ok)=>{if(ok)setGrantOpen(false);})}>确认保存权限</button></footer>
          </section>}
        </div>
      </div>}
    </>}
  </section></div>;
}
