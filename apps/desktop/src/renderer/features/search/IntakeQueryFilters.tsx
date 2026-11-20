import { useEffect, useRef, useState, type Ref } from 'react';
import type { IntakeQueryOption } from '@shared/content-intake-query';
import type { useIntakeShops } from './use-intake-shops';

type IntakeFilterState = ReturnType<typeof useIntakeShops>;
export const INTAKE_FILTER_PANEL_ID = 'intake-filter-body';

function Terms({ label, options, selected, disabled, onChange, onLayoutChange }: {
  label: string; options: IntakeQueryOption[]; selected: string[]; disabled: boolean; onChange: (ids: string[]) => void; onLayoutChange: () => void;
}) {
  const [text, setText] = useState('');
  const matches = options.filter(option => option.label.includes(text.trim()) || option.id.includes(text.trim()));
  return <details className="intake-terms" onToggle={onLayoutChange}>
    <summary>{label} · {selected.length ? `已选 ${selected.length}` : '全部'}</summary>
    <fieldset disabled={disabled}>
      <legend className="sr-only">{label}查询范围</legend>
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

export function describeIntakeQueryScope(state: IntakeFilterState) {
  const names = new Map(state.shopNamesValidUntil && Date.parse(state.shopNamesValidUntil) > Date.now()
    ? state.shopNames.map(name => [name.id, name.label]) : []);
  const repeats = new Map<string, number>();
  for (const name of names.values()) repeats.set(name, (repeats.get(name) ?? 0) + 1);
  const shopLabels = new Map(state.shops.map(id => [id, shopOptionLabel(id, names, repeats)]));
  const shop = state.shopId ? shopLabels.get(state.shopId) ?? state.shopId : '';
  const products = state.productIds.map(id => state.products.find(option => option.id === id)?.label ?? id);
  const scenarios = state.scenarioIds.map(id => state.scenarios.find(option => option.id === id)?.label ?? id);
  const context = [
    products.length ? `商品 ${products.length === 1 ? products[0] : products.length}` : '',
    scenarios.length ? `场景 ${scenarios.length === 1 ? scenarios[0] : scenarios.length}` : '',
    state.shops.length > 1 ? shop : '',
  ].filter(Boolean).join(' · ');
  const description = [
    shop || (state.busy ? '读取店铺中' : '未选店铺'),
    products.length ? `商品 ${products.join('、')}` : '商品全部',
    scenarios.length ? `场景 ${scenarios.join('、')}` : '场景全部',
  ].join(' · ');
  return { shopLabels, usingShopIds: state.shops.some(id => !names.has(id)), context, description };
}

export function IntakeQueryFilters({ state, scope, signedIn, open, shopControlRef, showError, onLayoutChange }: {
  state: IntakeFilterState; scope: Pick<ReturnType<typeof describeIntakeQueryScope>, 'shopLabels' | 'usingShopIds'>;
  signedIn: boolean; open: boolean; shopControlRef?: Ref<HTMLDivElement>; showError: boolean; onLayoutChange: () => void;
}) {
  const disabled = state.busy || !signedIn;
  const layoutRef = useRef(onLayoutChange);
  layoutRef.current = onLayoutChange;
  useEffect(() => { layoutRef.current(); }, [state.error]);
  const error = showError && state.error ? <p role="alert" className="validation-error">{state.error}</p> : null;
  return <div className="intake-query-filters" data-testid="intake-query-filters" data-open={open ? 'true' : 'false'}>
    {open ? <div className="intake-filter-body" id={INTAKE_FILTER_PANEL_ID}>
      <div className="intake-shop-control" ref={shopControlRef}>
        <label htmlFor="intake-shop">当前店铺</label>
        <select id="intake-shop" value={state.shopId ?? ''} disabled={disabled}
          onChange={event => { void state.load(event.target.value); }}>
          <option value="" disabled>{state.busy ? '读取中…' : state.shops.length ? '请选择店铺' : '暂无可用店铺'}</option>
          {state.shops.map(shop => <option key={shop} value={shop}>{scope.shopLabels.get(shop) ?? shop}</option>)}
        </select>
        <button type="button" className="retry-btn" disabled={disabled} onClick={() => { void state.load(); }}>刷新店铺</button>
      </div>
      {scope.usingShopIds ? <p role="status">当前显示店铺编号。</p> : null}
      <div className="intake-condition-controls">
        <Terms onLayoutChange={onLayoutChange} label="商品" options={state.products} selected={state.productIds} disabled={disabled || !state.shopId}
          onChange={productIds => { void state.selectConditions({ productIds, scenarioIds: state.scenarioIds }); }} />
        <Terms onLayoutChange={onLayoutChange} label="场景" options={state.scenarios} selected={state.scenarioIds} disabled={disabled || !state.shopId}
          onChange={scenarioIds => { void state.selectConditions({ productIds: state.productIds, scenarioIds }); }} />
      </div>
      <p role="status">未选条件时查询全部授权话术。请点击查询。</p>
      {error}
    </div> : error}
  </div>;
}
