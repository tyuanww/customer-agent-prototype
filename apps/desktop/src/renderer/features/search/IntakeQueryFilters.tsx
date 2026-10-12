import { useState } from 'react';
import type { IntakeQueryOption } from '@shared/content-intake-query';
import type { useIntakeShops } from './use-intake-shops';

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
      {matches.length > 100 ? <p>显示前 100 项，请输入名称缩小范围。</p> : null}
    </fieldset>
  </details>;
}

/** Selection intent only; Main checks menu membership and the API reauthorizes
 * every query. Keep the controls inside the measured result region. */
export function IntakeQueryFilters({ state, signedIn, onLayoutChange }: { state: ReturnType<typeof useIntakeShops>; signedIn: boolean; onLayoutChange: () => void }) {
  const disabled = state.busy || !signedIn;
  const names = new Map(state.shopNamesValidUntil && Date.parse(state.shopNamesValidUntil)>Date.now()
    ? state.shopNames.map(n=>[n.id,n.label]) : []);
  const repeats = new Map<string,number>(); for (const name of names.values()) repeats.set(name,(repeats.get(name)??0)+1);
  return <div className="intake-query-filters" data-testid="intake-query-filters">
    <div className="intake-shop-control">
      <label htmlFor="intake-shop">当前店铺</label>
      <select id="intake-shop" value={state.shopId ?? ''} disabled={disabled}
        onChange={event => { void state.load(event.target.value); }}>
        <option value="" disabled>{state.busy ? '读取中…' : state.shops.length ? '请选择店铺' : '暂无可用店铺'}</option>
        {state.shops.map(shop => <option key={shop} value={shop}>{names.has(shop) ? `${names.get(shop)}${repeats.get(names.get(shop)!)!>1 ? `（${shop}）` : ''}` : shop}</option>)}
      </select>
      <button type="button" className="retry-btn" disabled={disabled} onClick={() => { void state.load(); }}>刷新店铺</button>
    </div>
    {state.shops.length>0 && names.size!==state.shops.length ? <p role="status">店铺名称暂不可用，当前显示店铺编号；查询范围不变。</p> : null}
    <div className="intake-condition-controls">
      <Terms onLayoutChange={onLayoutChange} label="商品" options={state.products} selected={state.productIds} disabled={disabled || !state.shopId}
        onChange={productIds => { void state.selectConditions({ productIds, scenarioIds: state.scenarioIds }); }} />
      <Terms onLayoutChange={onLayoutChange} label="场景" options={state.scenarios} selected={state.scenarioIds} disabled={disabled || !state.shopId}
        onChange={scenarioIds => { void state.selectConditions({ productIds: state.productIds, scenarioIds }); }} />
    </div>
    <p role="status">未选择的维度仅查通用话术。切换条件保留问题，请点击查询。</p>
    {state.error ? <p role="alert" className="validation-error">{state.error}</p> : null}
  </div>;
}
