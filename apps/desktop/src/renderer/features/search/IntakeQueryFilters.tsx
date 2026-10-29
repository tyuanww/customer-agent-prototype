import { useEffect, useRef, useState } from 'react';
import type { IntakeQueryOption } from '@shared/content-intake-query';
import type { useIntakeShops } from './use-intake-shops';

type IntakeFilterState = ReturnType<typeof useIntakeShops>;

function Terms({ label, options, selected, disabled, onChange, onLayoutChange }: {
  label: string; options: IntakeQueryOption[]; selected: string[]; disabled: boolean; onChange: (ids: string[]) => void; onLayoutChange: () => void;
}) {
  const [text, setText] = useState('');
  const matches = options.filter(option => option.label.includes(text.trim()) || option.id.includes(text.trim()));
  return <details className="intake-terms" onToggle={onLayoutChange}>
    <summary>{label} · {selected.length ? `已选 ${selected.length}` : '通用'}</summary>
    <fieldset disabled={disabled}>
      <legend className="sr-only">{label}筛选</legend>
      <input aria-label={`查找${label}`} value={text} onChange={event => { setText(event.target.value); onLayoutChange(); }} placeholder={`查找${label}`} />
      <button type="button" className="retry-btn" onClick={() => onChange([])} disabled={!selected.length}>清除{label}</button>
      <div className="intake-term-options">
        {matches.slice(0, 100).map(option => <label key={option.id} title={option.id}>
          <input type="checkbox" checked={selected.includes(option.id)}
            disabled={selected.length >= 100 && !selected.includes(option.id)}
            onChange={event => onChange(event.target.checked ? [...selected, option.id] : selected.filter(id => id !== option.id))} />
          <span>{option.label}</span>
        </label>)}
        {!matches.length ? <span>暂无匹配{label}</span> : null}
      </div>
      {matches.length > 100 ? <p>请输入名称缩小范围。</p> : null}
    </fieldset>
  </details>;
}

function shopOptionLabel(id: string, names: Map<string, string>, repeats: Map<string, number>): string {
  const name = names.get(id);
  if (!name) return id;
  return (repeats.get(name) ?? 0) > 1 ? `${name}（${id}）` : name;
}

function dimensionSummary(label: '商品' | '场景', selected: string[], options: IntakeQueryOption[]): string {
  if (!selected.length) return `${label}通用`;
  if (selected.length === 1) {
    const id = selected[0] ?? '';
    return `${label} ${options.find(option => option.id === id)?.label ?? id}`;
  }
  return `${label} ${selected.length}`;
}

function filterSummary(state: IntakeFilterState, names: Map<string, string>, repeats: Map<string, number>): string {
  const shop = state.busy && !state.shopId
    ? '读取中'
    : state.shopId ? shopOptionLabel(state.shopId, names, repeats) : '未选店铺';
  return [
    shop,
    dimensionSummary('商品', state.productIds, state.products),
    dimensionSummary('场景', state.scenarioIds, state.scenarios),
  ].join(' · ');
}

export function IntakeQueryFilters({ state, signedIn, open, onToggle, onLayoutChange }: {
  state: IntakeFilterState; signedIn: boolean; open: boolean; onToggle: () => void; onLayoutChange: () => void;
}) {
  const disabled = state.busy || !signedIn;
  const names = new Map(state.shopNamesValidUntil && Date.parse(state.shopNamesValidUntil)>Date.now()
    ? state.shopNames.map(n=>[n.id,n.label]) : []);
  const repeats = new Map<string,number>(); for (const name of names.values()) repeats.set(name,(repeats.get(name)??0)+1);
  // Errors stay visible while collapsed; the line changes overlay height, so Main must re-measure.
  const layoutRef = useRef(onLayoutChange);
  layoutRef.current = onLayoutChange;
  useEffect(() => { layoutRef.current(); }, [state.error]);
  return <div className="intake-query-filters" data-testid="intake-query-filters" data-open={open ? 'true' : 'false'}>
    <div className="intake-filter-bar">
      <p className="intake-filter-summary" data-testid="intake-filter-summary">{filterSummary(state, names, repeats)}</p>
      <button type="button" className="intake-filter-toggle" aria-expanded={open} aria-controls="intake-filter-body" onClick={onToggle}>
        {open ? '收起' : '筛选'}
      </button>
    </div>
    {!open && state.error ? <p role="alert" className="validation-error">{state.error}</p> : null}
    {open ? <div className="intake-filter-body" id="intake-filter-body">
      <div className="intake-shop-control">
        <label htmlFor="intake-shop">当前店铺</label>
        <select id="intake-shop" value={state.shopId ?? ''} disabled={disabled}
          onChange={event => { void state.load(event.target.value); }}>
          <option value="" disabled>{state.busy ? '读取中…' : state.shops.length ? '请选择店铺' : '暂无可用店铺'}</option>
          {state.shops.map(shop => <option key={shop} value={shop}>{shopOptionLabel(shop, names, repeats)}</option>)}
        </select>
        <button type="button" className="retry-btn" disabled={disabled} onClick={() => { void state.load(); }}>刷新店铺</button>
      </div>
      {state.shops.length>0 && names.size!==state.shops.length ? <p role="status">当前显示店铺编号。</p> : null}
      <div className="intake-condition-controls">
        <Terms onLayoutChange={onLayoutChange} label="商品" options={state.products} selected={state.productIds} disabled={disabled || !state.shopId}
          onChange={productIds => { void state.selectConditions({ productIds, scenarioIds: state.scenarioIds }); }} />
        <Terms onLayoutChange={onLayoutChange} label="场景" options={state.scenarios} selected={state.scenarioIds} disabled={disabled || !state.shopId}
          onChange={scenarioIds => { void state.selectConditions({ productIds: state.productIds, scenarioIds }); }} />
      </div>
      <p role="status">未选的只查通用话术。请点击查询。</p>
      {state.error ? <p role="alert" className="validation-error">{state.error}</p> : null}
    </div> : null}
  </div>;
}
