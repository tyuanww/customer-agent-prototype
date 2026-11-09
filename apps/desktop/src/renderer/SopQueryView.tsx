import { useEffect, useState, type RefObject } from 'react';
import { SOP_QUERY_GROUPS, type SopQueryCommand, type SopQueryGroup, type SopQueryProjection } from '@shared/sop-query';
import type { useWindowDrag } from './lib/use-window-drag';

const risks: Record<string,string> = {unclassified:'未分级',low:'低风险',medium:'需人工核对',high:'高风险，需复核',critical:'高风险，需复核'};
export function SopQueryView({projection,shellRef,drag}: {projection:SopQueryProjection;shellRef:RefObject<HTMLDivElement>;drag:ReturnType<typeof useWindowDrag>}) {
  const [shop,setShop]=useState(''),[group,setGroup]=useState<SopQueryGroup>(SOP_QUERY_GROUPS[0]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState(false);
  useEffect(()=> {if(!projection.shops.some(s=>s.key===shop)) setShop(projection.shops.length===1?projection.shops[0]!.key:'');},[projection.shops,shop]);
  const command=async (value:SopQueryCommand)=> {
    setBusy(true);setError('');
    try { const result=await window.sopWindow?.queryCommand?.(value); if(!result?.ok)setError(result && !result.ok?result.message:'操作未完成，请重试。'); else if(value.kind==='query')setEditing(false); }
    catch {setError('操作未完成，请重试。');} finally {setBusy(false);}
  };
  const clear=()=> {
    setEditing(true);setError('');
    const request=window.sopWindow?.queryCommand?.({kind:'clear'});
    if(!request) {setError('无法更新查询条件，请重新打开流程。');return;}
    void request.then(result=> {if(!result.ok)setError('无法更新查询条件，请重新打开流程。');})
      .catch(()=>setError('无法更新查询条件，请重新打开流程。'));
  };
  return <div className="sop-shell query-shell" data-testid="sop-query-shell" data-state={projection.state} ref={shellRef}>
    <div className="glass-shell"><div className="glass-surface" aria-hidden="true" />
      <header className="sop-chrome" {...drag}><strong>SOP 流程</strong><button type="button" className="sop-close" aria-label="收起流程，保留进度" onClick={()=>void window.sopWindow?.close()}>×</button></header>
      <div className="sop-body">
        <form onSubmit={event=> {event.preventDefault();void command({kind:'query',shopKey:shop,group,text});}}>
          <label>店铺<select aria-label="店铺" value={shop} onChange={e=>{setShop(e.target.value);clear();}}><option value="">请选择</option>{projection.shops.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
          <label>流程<select aria-label="流程" value={group} onChange={e=>{setGroup(e.target.value as SopQueryGroup);clear();}}>{SOP_QUERY_GROUPS.map(g=><option key={g}>{g}</option>)}</select></label>
          <label>问题<input aria-label="问题" value={text} maxLength={2048} onChange={e=>{setText(e.target.value);clear();}} /></label>
          <button type="submit" className="retry-btn" disabled={busy || !shop || !text.trim()}>查询流程</button>
        </form>
        {projection.notice ? <p role="status">{projection.notice}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {projection.state==='ready' && !editing ? <>
          {projection.messages.map(message=><article className="script-card" key={message.key}>
            <strong>{message.title}</strong><span className="risk-chip">{risks[message.risk]}</span><p className="answer-text">{message.body}</p>
            <button type="button" className="copy-btn" disabled={busy || !message.canCopy} onClick={()=>void command({kind:'copy',key:message.key})}>复制话术</button>
            {!message.canCopy ? <span>本条话术不能复制</span>:null}
          </article>)}
          <div className="sop-branches">{projection.branches.map(branch=><button type="button" className="retry-btn" key={branch.key} disabled={busy} onClick={()=>void command({kind:'choose',key:branch.key})}>{branch.label}</button>)}</div>
          {projection.terminal?<p>流程已到最后一步，请人工确认处理结果。</p>:null}
          {projection.copied?<p role="status">已复制</p>:null}
        </>:null}
        <button type="button" className="sop-end" data-sop-end="true" onClick={()=>void window.sopWindow?.endFlow()}>结束并清除进度</button>
      </div>
    </div>
  </div>;
}
