import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { IntakeCatalogCommand, IntakeCatalogRow, IntakeCatalogView } from '@shared/content-intake-catalog';
import type { IntakeQueryOption } from '@shared/content-intake-query';
import { formatIntakeDay, formatIntakeTime, remainingLabel, timeoutUntil } from './intake-time';
import { IntakeUsageLog } from './IntakeUsageLog';
import './intake-management.css';
import './workbench-v9.css';

const domains: readonly { id: IntakeCatalogRow['domain']; label: string }[] = [
  { id: 'product', label: '产品' }, { id: 'campaign', label: '活动' },
  { id: 'presale', label: '售前' }, { id: 'aftersale', label: '售后' },
];
type LibraryTab = IntakeCatalogRow['domain'] | 'sop';
const libraryTabs: readonly { id: LibraryTab; label: string }[] = [...domains, { id: 'sop', label: 'SOP' }];

function Conditions({ label, options, selected, disabled, change }: {
  label: string; options: IntakeQueryOption[]; selected: string[]; disabled: boolean; change: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const matches = options.filter(option => option.label.includes(search.trim()) || option.id.includes(search.trim()));
  return <details className="intake-catalog-conditions"><summary>{label} · {selected.length ? `已选 ${selected.length}` : '通用'}</summary>
    <fieldset disabled={disabled}><legend className="sr-only">目录{label}条件</legend>
      <label>查找{label}<input aria-label={`目录查找${label}`} value={search} onChange={e => setSearch(e.target.value)} /></label>
      <button disabled={!selected.length} onClick={() => change([])}>清除{label}条件</button>
      <div className="intake-contributors">{matches.slice(0,100).map(option => <label key={option.id} title={option.id}>
        <input type="checkbox" checked={selected.includes(option.id)} disabled={selected.length >= 100 && !selected.includes(option.id)}
          onChange={e => change(e.target.checked ? [...selected,option.id] : selected.filter(id => id !== option.id))} />{option.label}
      </label>)}</div>
      {!matches.length && <p>暂无匹配{label}。</p>}{matches.length > 100 && <p>显示前 100 项，请输入名称缩小范围。</p>}
    </fieldset>
  </details>;
}

/** One mounted reader serves the library and available-version views. Navigation
 * only changes presentation; Main owns snapshots, authorization and cancellation. */
export function IntakeLibrary({ active, onOpenLibrary }: { active: 'wording' | 'announce' | null; onOpenLibrary?: () => void }) {
  const [view,setView] = useState<IntakeCatalogView|null>(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const [domain,setDomain] = useState<LibraryTab>('product');
  const [question,setQuestion] = useState('');
    const started=useRef(false), generation=useRef(0), pending=useRef<number|null>(null), deadline=useRef(0);
  const apply = async (command?: IntakeCatalogCommand) => {
    if (pending.current !== null && command?.action !== 'cancel') return;
    const gen=++generation.current; pending.current=gen; setBusy(true); setError('');
    // Never show the old snapshot while selecting conditions or refreshing it.
    setView(current => current ? {...current,rows:[],releaseId:null,validUntil:null} : null);
    deadline.current=0;
    try {
      const api=window.dashboardIntakeCatalog;
      if (!api) throw new Error('unavailable');
      const result=await (command ? api.command(command) : api.current());
      if (generation.current !== gen) return;
      deadline.current=result.view?.validUntil ? performance.now()+Math.max(0,Date.parse(result.view.validUntil)-Date.now()) : 0;
      setView(result.view); if (!result.ok) setError(result.message);
    } catch {
      if (generation.current === gen) { setView(null); setError('可用资料暂不可读取，请重试。'); }
    } finally {
      if (pending.current === gen) { pending.current=null; setBusy(false); }
    }
  };
  useEffect(() => {
    if (!active || started.current) return;
    started.current=true; void apply({action:'refresh'});
  },[active]);
  useEffect(() => {
    const api=window.dashboardIntakeCatalog;
    if (!api) return;
    const off=api.onInvalidated(() => {
      generation.current++; pending.current=null; deadline.current=0; setView(null); setBusy(false);
      setError('会话或读取资格已变化，请重新读取可用资料。');
      // current projects Main memory; it cannot silently acquire a new snapshot.
      void apply();
    });
    const invalidate=() => { generation.current++; };
    return () => { invalidate(); off(); };
  },[]);
  useEffect(() => {
    if (!view?.validUntil) return;
    const remaining=Math.min(Date.parse(view.validUntil)-Date.now(),deadline.current-performance.now());
    return timeoutUntil(() => {
      generation.current++; pending.current=null; deadline.current=0; setBusy(false);
      setView(current => current ? {...current,rows:[],releaseId:null,validUntil:null} : null);
      setError('读取资格已到期，请刷新可用资料。');
    },Date.now()+Math.max(0,remaining));
  },[view?.validUntil]);
  useEffect(() => {
    const until=view?.context.shopNamesValidUntil;
    if (!until) return;
    return timeoutUntil(() => setView(current => current ? {...current,context:{...current.context,shopNames:[],shopNamesValidUntil:null}} : null),Date.parse(until));
  },[view?.context.shopNamesValidUntil]);
  const context=view?.context, disabled=busy || !!view?.busy;
  const fresh=!!view?.validUntil && Date.now()<Date.parse(view.validUntil) && performance.now()<deadline.current;
  const rows=fresh ? view.rows : [];
  const names=new Map(context?.shopNamesValidUntil && Date.parse(context.shopNamesValidUntil)>Date.now() ? context.shopNames.map(n=>[n.id,n.label]) : []);
  const counts=new Map<string,number>(); for(const name of names.values()) counts.set(name,(counts.get(name)??0)+1);
  const shopLabel=(id:string) => names.has(id) ? `${names.get(id)}${counts.get(names.get(id)!)!>1 ? `（${id}）` : ''}` : id;
  const changeDomain=(id:LibraryTab) => setDomain(id);
  const needle=question.trim();
  const visible=domain==='sop' ? [] : rows.filter(row => row.domain===domain && (!needle || row.title.includes(needle) || row.answerText.includes(needle)));
  const domainKey=(event:KeyboardEvent<HTMLButtonElement>,index:number) => {
    const next=event.key==='ArrowRight' ? (index+1)%libraryTabs.length : event.key==='ArrowLeft' ? (index+libraryTabs.length-1)%libraryTabs.length : event.key==='Home' ? 0 : event.key==='End' ? libraryTabs.length-1 : null;
    if(next===null)return;event.preventDefault();changeDomain(libraryTabs[next].id);document.getElementById(`intake-domain-${libraryTabs[next].id}`)?.focus();
  };
  const entryState=(row:IntakeCatalogRow):{label:string;dot:string} => {
    const now=Date.now(),from=Date.parse(row.effectiveFrom),to=row.effectiveTo?Date.parse(row.effectiveTo):NaN;
    if(Number.isFinite(to)&&now>to)return {label:'已失效',dot:''};
    if(Number.isFinite(from)&&now<from)return {label:'待生效',dot:' wait'};
    return {label:'生效中',dot:' ok'};
  };
  const refreshIcon=<svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 8.5A8 8 0 0 0 5.8 7"/><path d="M5.5 3.5V7H9"/><path d="M4.5 15.5A8 8 0 0 0 18.2 17"/><path d="M18.5 20.5V17H15"/></svg>;
  const shopSelect=<select aria-label="目录店铺" disabled={disabled || !context?.shops.length} value={context?.shopId??''}
    onChange={e => { void apply({action:'select-shop',shopId:e.target.value}); }}>
    <option value="" disabled>{context?.shops.length ? '请选择店铺' : '暂无可用店铺'}</option>
    {context?.shops.map(id => <option key={id} value={id}>{shopLabel(id)}</option>)}
  </select>;
  return <div hidden={!active}>
    <section className="dash-module intake-management intake-library wb9" aria-label={active==='announce' ? '当前可用版本' : '可用话术目录'}>
      <h1 className="desk-sr">{active==='announce' ? '系统同步' : '话术库'}</h1>
      {active==='wording' && <div className="toolbar">
        <div className="left">
          <label className="lbl">目标店铺{shopSelect}</label>
          <label className="lbl">问题<input style={{width:200}} placeholder="搜索问题" aria-label="问题搜索" value={question} onChange={e => setQuestion(e.target.value)} /></label>
        </div>
        <div className="right">
          {disabled && <button type="button" className="btn btn-sm" onClick={() => void apply({action:'cancel'})}>停止目录读取</button>}
          <button type="button" className="icon-btn bordered" aria-label="刷新可用资料" disabled={disabled} onClick={() => void apply({action:'refresh'})}>{refreshIcon}</button>
        </div>
      </div>}
      {context && context.shops.length>0 && names.size!==context.shops.length && <p role="status" className="hint">店铺名称暂不可用，当前显示店铺编号。</p>}
      {active==='wording' && context?.shopId && <div className="intake-catalog-filter-grid">
        <Conditions label="商品" options={context.products} selected={context.productIds} disabled={disabled}
          change={productIds => void apply({action:'select-conditions',productIds,scenarioIds:context.scenarioIds})}/>
        <Conditions label="场景" options={context.scenarios} selected={context.scenarioIds} disabled={disabled}
          change={scenarioIds => void apply({action:'select-conditions',productIds:context.productIds,scenarioIds})}/>
      </div>}
      {error && <p role="alert">{error}</p>}
      {disabled && <p role="status">正在读取可用资料…</p>}
      {view && !view.signedIn && <p>请先在查询窗口登录。</p>}
      {!disabled && view?.signedIn && !context?.shopId && <p>请选择有权查看的店铺；没有可用店铺时请核对身份与范围。</p>}
      {!disabled && context?.shopId && !fresh && <p role="status">当前没有可展示的有效资料，请刷新可用资料。</p>}
      {active==='announce' ? <>
        <div className="sync-line">
          {fresh ? <span className="state"><i className="dot ok" /><b role="status">当前发布 {view!.releaseId} · {rows.length} 条 · 资格截止 {formatIntakeTime(view!.validUntil)}</b></span>
            : <span className="state"><i className="dot" /><b>暂无有效发布</b></span>}
          {fresh && remainingLabel(view!.validUntil) && <span className="rel">{remainingLabel(view!.validUntil)}</span>}
          <span className="grow" />
          {disabled && <button type="button" className="btn btn-sm" onClick={() => void apply({action:'cancel'})}>停止目录读取</button>}
          <button type="button" className="icon-btn bordered" aria-label="刷新可用资料" disabled={disabled} onClick={() => void apply({action:'refresh'})}>{refreshIcon}</button>
        </div>
        <table className="kv" style={{marginTop:8}}><tbody>
          <tr className="item"><td>软件更新</td><td><span className="notready">软件更新未接入。</span></td></tr>
          <tr className="item"><td>发布记录</td><td><span className="notready">未接入</span></td></tr>
        </tbody></table>
        <IntakeUsageLog />
      </> : <>
        <div className="tabbar sub"><div className="tabs" role="tablist" aria-label="话术类型">
          {libraryTabs.map((item,index) => <button type="button" role="tab" key={item.id} id={`intake-domain-${item.id}`}
            aria-selected={domain===item.id} aria-controls="intake-domain-panel" tabIndex={domain===item.id?0:-1}
            className="tab" onClick={() => changeDomain(item.id)} onKeyDown={e=>domainKey(e,index)}>{item.label}</button>)}
        </div></div>
        <section id="intake-domain-panel" role="tabpanel" aria-labelledby={`intake-domain-${domain}`}>
          {domain==='sop' ? <p className="notready" style={{padding:'20px 12px'}}>未接入</p> : fresh && <table className="fixed">
            <colgroup><col style={{width:180}}/><col/><col style={{width:110}}/><col style={{width:130}}/></colgroup>
            <thead><tr><th>话术名称</th><th>话术内容</th><th>状态</th><th>生效时间</th></tr></thead>
            <tbody>
              {!visible.length && <tr><td colSpan={4} className="empty">当前条件下没有此类可用话术。</td></tr>}
              {visible.map(row => { const st=entryState(row); return <tr className="item" key={row.id}>
                <td>{row.title}{row.category && <span className="tag">{row.category}</span>}</td>
                <td><span className="intake-answer">{row.answerText}</span>
                  {(row.applicabilityNote||row.riskNote) && <span className="cell-sub">{row.applicabilityNote && <>适用说明：{row.applicabilityNote}</>}{row.applicabilityNote && row.riskNote && ' · '}{row.riskNote && <>风险提示：{row.riskNote}</>}</span>}</td>
                <td><span className="state"><i className={`dot${st.dot}`} />{st.label}</span></td>
                <td title={`条目版本 ${row.scriptVersion}`}>{formatIntakeDay(row.effectiveFrom)}
                  <span className="desk-sr">生效 {formatIntakeTime(row.effectiveFrom)}{row.effectiveTo ? ` · 失效 ${formatIntakeTime(row.effectiveTo)}` : ''} · 条目版本 {row.scriptVersion}</span></td>
              </tr>; })}
            </tbody></table>}
        </section>
      </>}
    </section>
  </div>;
}
