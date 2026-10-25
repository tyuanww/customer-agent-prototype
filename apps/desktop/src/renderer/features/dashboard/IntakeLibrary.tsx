import { createElement, useCallback, useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { Button, Checkbox, Empty, Input, Select, Table, type ButtonProps, type TableColumnsType, type TableProps } from 'antd';
import { asyncFailure, type AsyncResource } from '@shared/async-resource';
import type { IntakeCatalogCommand, IntakeCatalogRow, IntakeCatalogView } from '@shared/content-intake-catalog';
import type { IntakeQueryOption } from '@shared/content-intake-query';
import { READ_DISCARDED, useAsyncResource } from './use-async-resource';
import { catalogAvailability, catalogAvailabilitySentence } from './catalog-availability';
import { formatIntakeDay, formatSeatClock, timeoutUntil } from './intake-time';
import './intake-management.css';
import './workbench-v9.css';
import { WorkbenchFailed, WorkbenchLoading } from './WorkbenchState';

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

// `sop` is a real bucket now: the main process files an entry whose source carries the
// SOP mapping marker under it, so the tab renders rows instead of a fixed empty state.
const domains: readonly { id: IntakeCatalogRow['domain']; label: string }[] = [
  { id: 'product', label: '产品' }, { id: 'campaign', label: '活动' },
  { id: 'presale', label: '售前' }, { id: 'aftersale', label: '售后' }, { id: 'sop', label: 'SOP' },
];
type LibraryTab = IntakeCatalogRow['domain'];
const libraryTabs: readonly { id: LibraryTab; label: string }[] = domains;

function Conditions({ label, options, selected, disabled, change }: {
  label: string; options: IntakeQueryOption[]; selected: string[]; disabled: boolean; change: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const matches = options.filter(option => option.label.includes(search.trim()) || option.id.includes(search.trim()));
  return <details className="intake-catalog-conditions"><summary>{label}<span className="cond-value">{selected.length ? `已选 ${selected.length}` : '通用'}</span></summary>
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

const LOGGED_OUT = '请先在查询窗口登录。';
const UNAVAILABLE = '可用资料暂不可读取，请重试。';
const SESSION_CHANGED = '登录状态已变化，请刷新可用资料。';
const SESSION_CONFIRM = '登录状态需要确认，请刷新可用资料。';

type CatalogIntent = { kind: 'current' } | { kind: 'command'; command: IntakeCatalogCommand };

function readFailure(code: string, message: string): AsyncResource<IntakeCatalogView> {
  return asyncFailure(code, { forbidden: LOGGED_OUT, error: message });
}

function withoutRows(current: IntakeCatalogView): IntakeCatalogView {
  return { ...current, rows: [], releaseId: null, validUntil: null };
}

function hang(): Promise<typeof READ_DISCARDED> {
  return Promise.resolve(READ_DISCARDED);
}

export function IntakeLibrary({ active, seatNotice = false }: { active: boolean; seatNotice?: boolean }) {
  const shownRef = useRef<IntakeCatalogView | null>(null);
  const intentRef = useRef<CatalogIntent | null>(null);
  const generationRef = useRef(0);
  const flightRef = useRef(0);
  const deadlineRef = useRef(0);
  const startedRef = useRef(false);
  const kickRef = useRef(false);
  const consumedRef = useRef(false);
  const [held, setHeld] = useState<IntakeCatalogView | null>(null);
  const [busy, setBusy] = useState(() => active && window.dashboardIntakeCatalog !== undefined);
  const [domain, setDomain] = useState<LibraryTab>('product');
  const [question, setQuestion] = useState('');
  if (active && !startedRef.current) {
    startedRef.current = true;
    intentRef.current = { kind: 'command', command: { action: 'refresh' } };
    generationRef.current += 1;
    flightRef.current = generationRef.current;
    kickRef.current = true;
  }
  const remember = useCallback((next: IntakeCatalogView | null) => {
    shownRef.current = next;
    setHeld(next);
  }, []);
  const hasCatalog = window.dashboardIntakeCatalog !== undefined;
  const initial: AsyncResource<IntakeCatalogView> = hasCatalog
    ? (active ? { status: 'loading' } : { status: 'idle' })
    : { status: 'error', message: UNAVAILABLE };
  const { resource, reload, replace } = useAsyncResource(async () => {
    if (flightRef.current === 0) {
      return hasCatalog ? { status: 'idle' } : { status: 'error', message: UNAVAILABLE };
    }
    consumedRef.current = true;
    const gen = generationRef.current;
    const pending = intentRef.current;
    try {
      const api = window.dashboardIntakeCatalog;
      if (!api) {
        remember(null);
        deadlineRef.current = 0;
        return { status: 'error', message: UNAVAILABLE };
      }
      const reply = pending?.kind === 'command' ? await api.command(pending.command) : await api.current();
      if (generationRef.current !== gen) return hang();
      deadlineRef.current = reply.view?.validUntil
        ? performance.now() + Math.max(0, Date.parse(reply.view.validUntil) - Date.now())
        : 0;
      remember(reply.view);
      if (!reply.ok) return readFailure(reply.code, reply.message);
      if (!reply.view.signedIn) return { status: 'forbidden', message: LOGGED_OUT };
      return { status: 'ready', value: reply.view };
    } catch {
      if (generationRef.current !== gen) return hang();
      deadlineRef.current = 0;
      remember(null);
      return { status: 'error', message: UNAVAILABLE };
    } finally {
      if (flightRef.current === gen) {
        flightRef.current = 0;
        setBusy(false);
      }
    }
  }, [], initial);
  const begin = useCallback((command?: IntakeCatalogCommand) => {
    if (flightRef.current !== 0 && command?.action !== 'cancel') return;
    const gen = ++generationRef.current;
    flightRef.current = gen;
    intentRef.current = command ? { kind: 'command', command } : { kind: 'current' };
    deadlineRef.current = 0;
    setBusy(true);
    const current = shownRef.current;
    remember(current ? withoutRows(current) : null);
    replace((state) => (state.status === 'forbidden' || state.status === 'loading' ? state : { status: 'loading' }));
    reload();
  }, [remember, reload, replace]);
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    if (!kickRef.current) return undefined;
    kickRef.current = false;
    if (consumedRef.current) return undefined;
    setBusy(true);
    reload();
    return undefined;
  }, [active, reload]);
  useEffect(() => {
    const api = window.dashboardIntakeCatalog;
    if (!api) return undefined;
    const off = api.onInvalidated(() => {
      generationRef.current += 1;
      flightRef.current = 0;
      deadlineRef.current = 0;
      setBusy(false);
      remember(null);
      replace({ status: 'error', message: SESSION_CHANGED });
      // current projects Main memory; it cannot silently acquire a new snapshot.
      beginRef.current();
    });
    return () => {
      generationRef.current += 1;
      off();
    };
  }, [remember, replace]);
  const reading = busy || resource.status === 'loading';
  const view = reading || resource.status !== 'ready' ? held : resource.value;
  const context = view?.context;
  const disabled = reading || !!view?.busy;
  const fresh = !!view?.validUntil && Date.now() < Date.parse(view.validUntil) && performance.now() < deadlineRef.current;
  useEffect(() => {
    if (!view?.validUntil) return undefined;
    const remaining = Math.min(Date.parse(view.validUntil) - Date.now(), deadlineRef.current - performance.now());
    return timeoutUntil(() => {
      generationRef.current += 1;
      flightRef.current = 0;
      deadlineRef.current = 0;
      setBusy(false);
      const current = shownRef.current;
      remember(current ? withoutRows(current) : null);
      replace({ status: 'error', message: SESSION_CONFIRM });
    }, Date.now() + Math.max(0, remaining));
  }, [view?.validUntil, remember, replace]);
  useEffect(() => {
    const until = view?.context.shopNamesValidUntil;
    if (!until) return undefined;
    return timeoutUntil(() => {
      const current = shownRef.current;
      if (!current) return;
      const next: IntakeCatalogView = {
        ...current,
        context: { ...current.context, shopNames: [], shopNamesValidUntil: null },
      };
      remember(next);
      replace((state) => (state.status === 'ready' ? { status: 'ready', value: next } : state));
    }, Date.parse(until));
  }, [view?.context.shopNamesValidUntil, remember, replace]);
  const availability = catalogAvailability(view, fresh);
  const rows = fresh && view ? view.rows : [];
  const loggedOut = resource.status === 'forbidden'
    ? resource.message
    : view && !view.signedIn
      ? LOGGED_OUT
      : '';
  const names=new Map(context?.shopNamesValidUntil && Date.parse(context.shopNamesValidUntil)>Date.now() ? context.shopNames.map(n=>[n.id,n.label]) : []);
  const counts=new Map<string,number>(); for(const name of names.values()) counts.set(name,(counts.get(name)??0)+1);
  const shopLabel=(id:string) => names.has(id) ? `${names.get(id)}${counts.get(names.get(id)!)!>1 ? `（${id}）` : ''}` : id;
  const changeDomain=(id:LibraryTab) => setDomain(id);
  const needle=question.trim();
  const visible=rows.filter(row => row.domain===domain && (!needle || row.title.includes(needle) || row.answerText.includes(needle)));
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
        {(row.applicabilityNote || risk) && <span className="cell-sub">{row.applicabilityNote ? <>适用说明：{row.applicabilityNote}</> : null}{row.applicabilityNote && risk ? '；' : null}{risk}</span>}
      </>;
    } },
    { title: '状态', key: 'state', width: 110, render: (_value: unknown, row) => { const state = entryState(row); return <span className="state"><i className={`dot${state.dot}`} />{state.label}</span>; } },
    { title: '生效时间', key: 'effective', width: 130, render: (_value: unknown, row) => <span title={`条目版本 ${row.scriptVersion}`}>{formatIntakeDay(row.effectiveFrom)}
      <span className="desk-sr">生效 {formatSeatClock(row.effectiveFrom)}{row.effectiveTo ? `，失效 ${formatSeatClock(row.effectiveTo)}` : ''}，条目版本 {row.scriptVersion}</span></span> },
  ];
  return <div hidden={!active}>
    {active ? <section className="dash-module intake-management intake-library wb9" aria-label="可用话术目录">
      <h1 className="desk-sr">话术库</h1>
      {seatNotice ? <p data-testid="seat-library-notice">你现在可以查话术。需要看数据或管内容，请联系客服主管。</p> : null}
      <div className="sync-line">
        <span className="state">
          <i className={availability.kind === 'available' ? 'dot ok' : 'dot'} />
          <b role="status">{catalogAvailabilitySentence(availability)}</b>
        </span>
        {availability.kind === 'available' && availability.remaining
          ? <span className="rel">{availability.remaining}</span>
          : null}
      </div>
      <div className="toolbar">
        <div className="left">
          <label className="lbl">目标店铺<Select aria-label="目录店铺" virtual={false} disabled={disabled || !context?.shops.length}
            value={context?.shopId ?? undefined} placeholder={context?.shops.length ? '请选择店铺' : '暂无可用店铺'} style={{ width: 220 }}
            options={(context?.shops ?? []).map(id => ({ value: id, label: shopLabel(id) }))}
            onChange={shopId => { begin({ action: 'select-shop', shopId }); }} /></label>
          <label className="lbl">问题<Input style={{width:220}} placeholder="搜索问题" aria-label="问题搜索" value={question} onChange={e => setQuestion(e.target.value)} /></label>
        </div>
        <div className="right">
          {disabled && <LibraryButton onClick={() => begin({ action: 'cancel' })}>停止目录读取</LibraryButton>}
          <LibraryButton aria-label="刷新可用资料" disabled={disabled} onClick={() => begin({ action: 'refresh' })}>{refreshIcon}</LibraryButton>
        </div>
      </div>
      {context && context.shops.length>0 && names.size!==context.shops.length && <p role="status" className="hint">当前显示店铺编号。</p>}
      {context?.shopId && <div className="intake-catalog-filter-grid">
        <Conditions label="商品" options={context.products} selected={context.productIds} disabled={disabled}
          change={productIds => begin({ action: 'select-conditions', productIds, scenarioIds: context.scenarioIds })}/>
        <Conditions label="场景" options={context.scenarios} selected={context.scenarioIds} disabled={disabled}
          change={scenarioIds => begin({ action: 'select-conditions', productIds: context.productIds, scenarioIds })}/>
      </div>}
      {resource.status === 'error' ? <WorkbenchFailed message={resource.message} onRetry={disabled ? undefined : () => begin({ action: 'refresh' })} /> : null}
      {disabled && !fresh ? <WorkbenchLoading rows={6} label="正在读取可用资料" /> : null}
      {loggedOut ? <p>{loggedOut}</p> : null}
      {!disabled && view?.signedIn && !context?.shopId && <p>请选择有权查看的店铺；没有可用店铺时请核对身份与范围。</p>}
      {!disabled && context?.shopId && !fresh && <p role="status">当前没有可展示的有效资料，请刷新可用资料。</p>}
      <div className="tabbar sub"><div className="tabs" role="tablist" aria-label="话术类型">
        {libraryTabs.map((item,index) => <LibraryButton type="text" role="tab" key={item.id} id={`intake-domain-${item.id}`}
          aria-selected={domain===item.id} aria-controls="intake-domain-panel" tabIndex={domain===item.id?0:-1}
          className="tab" onClick={() => changeDomain(item.id)} onKeyDown={e=>domainKey(e,index)}>{item.label}</LibraryButton>)}
      </div></div>
      <section id="intake-domain-panel" role="tabpanel" aria-labelledby={`intake-domain-${domain}`}>
        {fresh ? <ScriptTable<IntakeCatalogRow>
          aria-label="可用话术" pagination={false} tableLayout="fixed" rowKey="id" rowClassName={() => 'item'}
          dataSource={visible} columns={scriptColumns}
          locale={{ emptyText: <CatalogEmpty description="当前条件下没有此类可用话术。" /> }} />
          : <CatalogEmpty description={context?.shops.length ? '选择店铺后，可用话术会出现在这里。' : '暂无可用店铺。目录接入后会出现在这里。'} />}
      </section>
    </section> : null}
  </div>;
}
