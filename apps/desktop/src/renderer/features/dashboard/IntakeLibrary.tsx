import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { IntakeCatalogCommand, IntakeCatalogRow, IntakeCatalogView } from '@shared/content-intake-catalog';
import type { IntakeQueryOption } from '@shared/content-intake-query';
import { formatIntakeTime } from './intake-time';
import './intake-management.css';

const domains: readonly { id: IntakeCatalogRow['domain']; label: string }[] = [
  { id: 'product', label: '产品话术' }, { id: 'campaign', label: '活动话术' },
  { id: 'presale', label: '售前流程' }, { id: 'aftersale', label: '售后流程' },
];

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
export function IntakeLibrary({ active }: { active: 'wording' | 'announce' | null }) {
  const [view,setView] = useState<IntakeCatalogView|null>(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const [domain,setDomain] = useState<IntakeCatalogRow['domain']>('product');
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
    const timer=setTimeout(() => {
      generation.current++; pending.current=null; deadline.current=0; setBusy(false);
      setView(current => current ? {...current,rows:[],releaseId:null,validUntil:null} : null);
      setError('读取资格已到期，请刷新可用资料。');
    },Math.max(0,remaining));
    return () => clearTimeout(timer);
  },[view?.validUntil]);
  useEffect(() => {
    const until=view?.context.shopNamesValidUntil;
    if (!until) return;
    const timer=setTimeout(() => setView(current => current ? {...current,context:{...current.context,shopNames:[],shopNamesValidUntil:null}} : null),Math.max(0,Date.parse(until)-Date.now()));
    return () => clearTimeout(timer);
  },[view?.context.shopNamesValidUntil]);
  const context=view?.context, disabled=busy || !!view?.busy;
  const fresh=!!view?.validUntil && Date.now()<Date.parse(view.validUntil) && performance.now()<deadline.current;
  const rows=fresh ? view.rows : [];
  const names=new Map(context?.shopNamesValidUntil && Date.parse(context.shopNamesValidUntil)>Date.now() ? context.shopNames.map(n=>[n.id,n.label]) : []);
  const counts=new Map<string,number>(); for(const name of names.values()) counts.set(name,(counts.get(name)??0)+1);
  const shopLabel=(id:string) => names.has(id) ? `${names.get(id)}${counts.get(names.get(id)!)!>1 ? `（${id}）` : ''}` : id;
  const selectedTerms=(options:IntakeQueryOption[],ids:string[]) => ids.length ? options.filter(o=>ids.includes(o.id)).map(o=>o.label).join('、') : '通用';
  const changeDomain=(id:IntakeCatalogRow['domain']) => setDomain(id);
  const domainKey=(event:KeyboardEvent<HTMLButtonElement>,index:number) => {
    const next=event.key==='ArrowRight' ? (index+1)%domains.length : event.key==='ArrowLeft' ? (index+domains.length-1)%domains.length : event.key==='Home' ? 0 : event.key==='End' ? domains.length-1 : null;
    if(next===null)return;event.preventDefault();changeDomain(domains[next].id);document.getElementById(`intake-domain-${domains[next].id}`)?.focus();
  };
  return <div hidden={!active}>
    <section className="dash-module intake-management intake-library" aria-label={active==='announce' ? '当前可用版本' : '可用话术目录'}>
      <header className="dash-module-head"><div><h1>{active==='announce' ? '系统同步' : '话术库'}</h1>
        <p>仅显示当前店铺、商品与场景条件下有权读取的已发布资料。</p></div></header>
      <div className="intake-toolbar">
        <label>目录店铺<select aria-label="目录店铺" disabled={disabled || !context?.shops.length} value={context?.shopId??''}
          onChange={e => { void apply({action:'select-shop',shopId:e.target.value}); }}>
          <option value="" disabled>{context?.shops.length ? '请选择店铺' : '暂无可用店铺'}</option>
          {context?.shops.map(id => <option key={id} value={id}>{shopLabel(id)}</option>)}
        </select></label>
        <button disabled={disabled} onClick={() => void apply({action:'refresh'})}>刷新可用资料</button>
        {disabled && <button onClick={() => void apply({action:'cancel'})}>停止目录读取</button>}
      </div>
      {context && context.shops.length>0 && names.size!==context.shops.length && <p role="status">店铺名称暂不可用，当前显示店铺编号。</p>}
      {context?.shopId && <>
        <div className="intake-catalog-filter-grid">
          <Conditions label="商品" options={context.products} selected={context.productIds} disabled={disabled}
            change={productIds => void apply({action:'select-conditions',productIds,scenarioIds:context.scenarioIds})}/>
          <Conditions label="场景" options={context.scenarios} selected={context.scenarioIds} disabled={disabled}
            change={scenarioIds => void apply({action:'select-conditions',productIds:context.productIds,scenarioIds})}/>
        </div>
        <p className="dash-scope">当前范围：{shopLabel(context.shopId)} · 商品：{selectedTerms(context.products,context.productIds)} · 场景：{selectedTerms(context.scenarios,context.scenarioIds)}。未选择的维度仅显示通用资料。</p>
      </>}
      {error && <p role="alert">{error}</p>}
      {disabled && <p role="status">正在读取可用资料…</p>}
      {view && !view.signedIn && <p>请先在查询窗口登录。</p>}
      {!disabled && view?.signedIn && !context?.shopId && <p>请选择有权查看的店铺；没有可用店铺时请核对身份与范围。</p>}
      {!disabled && context?.shopId && !fresh && <p role="status">当前没有可展示的有效资料，请刷新可用资料。</p>}
      {active==='announce' ? <>
        <h2>当前条件下可用发布版本</h2>
        {fresh && <p role="status">可用版本 {view!.releaseId} · 本次读取 {rows.length} 条 · 资格截止 {formatIntakeTime(view!.validUntil)}</p>}
        <p>版本来自当前条件下的读取结果，不代表全库同步、公告已读或四库变更统计。</p>
        <h2>软件版本更新</h2><p>未接入。</p>
      </> : <>
        <div className="wording-domain-tabs" role="tablist" aria-label="话术域">
          {domains.map((item,index) => <button type="button" role="tab" key={item.id} id={`intake-domain-${item.id}`}
            aria-selected={domain===item.id} aria-controls="intake-domain-panel" tabIndex={domain===item.id?0:-1}
            className={domain===item.id?'is-active':''} onClick={() => changeDomain(item.id)} onKeyDown={e=>domainKey(e,index)}>{item.label}</button>)}
        </div>
        <section id="intake-domain-panel" role="tabpanel" aria-labelledby={`intake-domain-${domain}`}>
          {fresh && <p>{domains.find(d=>d.id===domain)!.label} · 当前条件下 {rows.filter(row=>row.domain===domain).length} 条 · 发布版本 {view!.releaseId}</p>}
          {fresh && !rows.some(row=>row.domain===domain) && <p>当前条件下没有此类可用话术。</p>}
          {rows.filter(row=>row.domain===domain).map(row => <article className="intake-card" key={row.id} aria-label={row.title}>
            <h2>{row.title}</h2><p className="intake-answer">{row.answerText}</p>
            {row.applicabilityNote && <p>适用说明：{row.applicabilityNote}</p>}{row.riskNote && <p>风险提示：{row.riskNote}</p>}
            {row.category && <p>分类：{row.category}</p>}
            <p>条目版本 {row.scriptVersion} · 生效 {formatIntakeTime(row.effectiveFrom)}{row.effectiveTo ? ` · 失效 ${formatIntakeTime(row.effectiveTo)}` : ''}</p>
          </article>)}
        </section>
      </>}
    </section>
  </div>;
}
