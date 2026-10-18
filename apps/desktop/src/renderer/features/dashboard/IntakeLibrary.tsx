import { createElement, useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { Button, Checkbox, Empty, Input, Select, Table, type ButtonProps, type TableColumnsType, type TableProps } from 'antd';
import type { IntakeCatalogCommand, IntakeCatalogRow, IntakeCatalogView } from '@shared/content-intake-catalog';
import type { IntakeQueryOption } from '@shared/content-intake-query';
import { formatIntakeDay, formatSeatClock, remainingLabel, timeoutUntil } from './intake-time';
import { IntakeUsageLog } from './IntakeUsageLog';
import './intake-management.css';
import './workbench-v9.css';

const RISK_LEVEL_LABEL = {
  low: '风险低', medium: '风险中', high: '风险高',
  风险低: '风险低', 风险中: '风险中', 风险高: '风险高',
} as const;

function riskCopy(note: string): string | null {
  const trimmed = note.trim();
  if (!trimmed) return null;
  if (Object.hasOwn(RISK_LEVEL_LABEL, trimmed)) return RISK_LEVEL_LABEL[trimmed as keyof typeof RISK_LEVEL_LABEL];
  return `风险提示：${trimmed}`;
}

function LibraryButton(props: ButtonProps) {
  return <Button {...props} autoInsertSpace={false} />;
}

function CatalogEmpty({ description }: { description: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

/** rc-table copies aria-label onto the table. antd's prop type omits it. */
function ScriptTable<RecordType extends object>(props: TableProps<RecordType> & { 'aria-label': string }) {
  return createElement(Table as ComponentType<typeof props>, props);
}

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
      <label>查找{label}<Input aria-label={`目录查找${label}`} value={search} onChange={e => setSearch(e.target.value)} /></label>
      <LibraryButton disabled={!selected.length} onClick={() => change([])}>清除{label}条件</LibraryButton>
      <div className="intake-contributors">{matches.slice(0,100).map(option => <Checkbox key={option.id} title={option.id}
        checked={selected.includes(option.id)} disabled={selected.length >= 100 && !selected.includes(option.id)}
        onChange={e => change(e.target.checked ? [...selected,option.id] : selected.filter(id => id !== option.id))}>{option.label}</Checkbox>)}</div>
      {!matches.length && <p>暂无匹配{label}。</p>}{matches.length > 100 && <p>请输入名称缩小范围。</p>}
    </fieldset>
  </details>;
}

/** One mounted reader serves the library and available-version views. Navigation
 * only changes presentation; Main owns snapshots, authorization and cancellation. */
export function IntakeLibrary({ active }: { active: 'wording' | 'announce' | null }) {
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
  const domainKey=(event:KeyboardEvent<HTMLElement>,index:number) => {
    const next=event.key==='ArrowRight' ? (index+1)%libraryTabs.length : event.key==='ArrowLeft' ? (index+libraryTabs.length-1)%libraryTabs.length : event.key==='Home' ? 0 : event.key==='End' ? libraryTabs.length-1 : null;
    if(next===null)return;event.preventDefault();changeDomain(libraryTabs[next].id);document.getElementById(`intake-domain-${libraryTabs[next].id}`)?.focus();
  };
  const entryState=(row:IntakeCatalogRow):{label:string;dot:string} => {
    const now=Date.now(),from=Date.parse(row.effectiveFrom),to=row.effectiveTo?Date.parse(row.effectiveTo):NaN;
    if(Number.isFinite(to)&&now>to)return {label:'已失效',dot:''};
    if(Number.isFinite(from)&&now<from)return {label:'待生效',dot:' wait'};
    return {label:'生效中',dot:' ok'};
  };
  const refreshIcon=<svg className="ico" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 8.5A8 8 0 0 0 5.8 7"/><path d="M5.5 3.5V7H9"/><path d="M4.5 15.5A8 8 0 0 0 18.2 17"/><path d="M18.5 20.5V17H15"/></svg>;
  const scriptColumns: TableColumnsType<IntakeCatalogRow> = [
    { title: '话术名称', dataIndex: 'title', width: 180, render: (_title: string, row) => <>{row.title}{row.category ? <span className="tag">{row.category}</span> : null}</> },
    { title: '话术内容', dataIndex: 'answerText', render: (_answer: string, row) => {
      const risk = riskCopy(row.riskNote);
      return <>
        <span className="intake-answer">{row.answerText}</span>
        {(row.applicabilityNote || risk) && <span className="cell-sub">{row.applicabilityNote ? <>适用说明：{row.applicabilityNote}</> : null}{row.applicabilityNote && risk ? ' · ' : null}{risk}</span>}
      </>;
    } },
    { title: '状态', key: 'state', width: 110, render: (_value: unknown, row) => { const state = entryState(row); return <span className="state"><i className={`dot${state.dot}`} />{state.label}</span>; } },
    { title: '生效时间', key: 'effective', width: 130, render: (_value: unknown, row) => <span title={`条目版本 ${row.scriptVersion}`}>{formatIntakeDay(row.effectiveFrom)}
      <span className="desk-sr">生效 {formatSeatClock(row.effectiveFrom)}{row.effectiveTo ? ` · 失效 ${formatSeatClock(row.effectiveTo)}` : ''} · 条目版本 {row.scriptVersion}</span></span> },
  ];
  return <div hidden={!active}>
    <section className="dash-module intake-management intake-library wb9" aria-label={active==='announce' ? '当前可用版本' : '可用话术目录'}>
      <h1 className="desk-sr">{active==='announce' ? '系统同步' : '话术库'}</h1>
      {active==='wording' && <div className="toolbar">
        <div className="left">
          <label className="lbl">目标店铺<Select aria-label="目录店铺" virtual={false} disabled={disabled || !context?.shops.length}
            value={context?.shopId ?? undefined} placeholder={context?.shops.length ? '请选择店铺' : '暂无可用店铺'} style={{ width: 220 }}
            options={(context?.shops ?? []).map(id => ({ value: id, label: shopLabel(id) }))}
            onChange={shopId => { void apply({ action: 'select-shop', shopId }); }} /></label>
          <label className="lbl">问题<Input style={{width:220}} placeholder="搜索问题" aria-label="问题搜索" value={question} onChange={e => setQuestion(e.target.value)} /></label>
        </div>
        <div className="right">
          {disabled && <LibraryButton onClick={() => void apply({action:'cancel'})}>停止目录读取</LibraryButton>}
          <LibraryButton aria-label="刷新可用资料" disabled={disabled} onClick={() => void apply({action:'refresh'})}>{refreshIcon}</LibraryButton>
        </div>
      </div>}
      {context && context.shops.length>0 && names.size!==context.shops.length && <p role="status" className="hint">当前显示店铺编号。</p>}
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
          {fresh ? <span className="state"><i className="dot ok" /><b role="status">当前可用 {rows.length} 条，到 {formatIntakeDay(view!.validUntil)} 还能查。</b></span>
            : <span className="state"><i className="dot" /><b>暂无有效发布</b></span>}
          {fresh && remainingLabel(view!.validUntil) && <span className="rel">{remainingLabel(view!.validUntil)}</span>}
          <span className="grow" />
          {disabled && <LibraryButton onClick={() => void apply({action:'cancel'})}>停止目录读取</LibraryButton>}
          <LibraryButton aria-label="刷新可用资料" disabled={disabled} onClick={() => void apply({action:'refresh'})}>{refreshIcon}</LibraryButton>
        </div>
        <p>软件更新：安装包更新还不在这页。</p>
        <p>发布记录：发布记录还没有接到这里。</p>
        <IntakeUsageLog />
      </> : <>
        <div className="tabbar sub"><div className="tabs" role="tablist" aria-label="话术类型">
          {libraryTabs.map((item,index) => <LibraryButton type="text" role="tab" key={item.id} id={`intake-domain-${item.id}`}
            aria-selected={domain===item.id} aria-controls="intake-domain-panel" tabIndex={domain===item.id?0:-1}
            className="tab" onClick={() => changeDomain(item.id)} onKeyDown={e=>domainKey(e,index)}>{item.label}</LibraryButton>)}
        </div></div>
        <section id="intake-domain-panel" role="tabpanel" aria-labelledby={`intake-domain-${domain}`}>
          {domain==='sop' ? <CatalogEmpty description="这一栏还没有 SOP 目录。" /> : fresh ? <ScriptTable<IntakeCatalogRow>
            aria-label="可用话术" pagination={false} tableLayout="fixed" rowKey="id" rowClassName={() => 'item'}
            dataSource={visible} columns={scriptColumns}
            locale={{ emptyText: <CatalogEmpty description="当前条件下没有此类可用话术。" /> }} />
            : <CatalogEmpty description={context?.shops.length ? '选择店铺后，可用话术会出现在这里。' : '暂无可用店铺。目录接入后会出现在这里。'} />}
        </section>
      </>}
    </section>
  </div>;
}
