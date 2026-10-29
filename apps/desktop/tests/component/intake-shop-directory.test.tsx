import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { emptyIntakeQueryContext } from '../../src/shared/content-intake-query';
import { IntakeQueryFilters } from '../../src/renderer/features/search/IntakeQueryFilters';
import type { useIntakeShops } from '../../src/renderer/features/search/use-intake-shops';
const state=():ReturnType<typeof useIntakeShops>=>({...emptyIntakeQueryContext(),shops:['shop-a','shop-b'],shopId:'shop-a',busy:false,error:'',load:vi.fn(),selectConditions:vi.fn()});
function Filters({ state: filterState }: { state: ReturnType<typeof useIntakeShops> }) {
  const [open, setOpen] = useState(false);
  return <IntakeQueryFilters state={filterState} signedIn open={open} onToggle={() => setOpen(current => !current)} onLayoutChange={() => undefined} />;
}
it('shows names with ID disambiguation and emits only the stable shop ID',()=>{
 const s=state();s.shopNames=[{id:'shop-a',label:'合成同名店'},{id:'shop-b',label:'合成同名店'}];s.shopNamesValidUntil=new Date(Date.now()+60000).toISOString();
 render(<Filters state={s}/>);
 expect(screen.getByTestId('intake-filter-summary')).toHaveTextContent('合成同名店（shop-a） · 商品通用 · 场景通用');
 fireEvent.click(screen.getByRole('button',{name:'筛选'}));
 expect(screen.getByRole('option',{name:'合成同名店（shop-a）'})).toHaveValue('shop-a');
 fireEvent.change(screen.getByRole('combobox',{name:'当前店铺'}),{target:{value:'shop-b'}});expect(s.load).toHaveBeenCalledWith('shop-b');
 expect(s.selectConditions).not.toHaveBeenCalled();
 expect(screen.queryByText(/名称暂不可用/)).toBeNull();
});
it.each(['missing','expired'])('keeps IDs and explicitly marks %s names unavailable',kind=>{
 const s=state();if(kind==='expired'){s.shopNames=[{id:'shop-a',label:'过期合成名'},{id:'shop-b',label:'过期合成名'}];s.shopNamesValidUntil=new Date(Date.now()-1000).toISOString();}
 render(<Filters state={s}/>);
 expect(screen.getByTestId('intake-filter-summary')).toHaveTextContent('shop-a · 商品通用 · 场景通用');
 expect(screen.queryByText(/过期合成名/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'筛选'}));
 expect(screen.getByRole('option',{name:'shop-a'})).toHaveValue('shop-a');expect(screen.getByText('当前显示店铺编号。')).toBeVisible();
 expect(screen.queryByText(/过期合成名/)).toBeNull();expect(screen.getByRole('combobox',{name:'当前店铺'})).toBeEnabled();
});
it('keeps the shop, product, and scene line collapsed until 筛选 is opened',()=>{
 const s=state();
 s.shopNames=[{id:'shop-a',label:'合成店'}];s.shopNamesValidUntil=new Date(Date.now()+60000).toISOString();
 s.products=[{id:'product-a',label:'洁面乳'}];s.productIds=['product-a'];
 s.scenarios=[{id:'scene-a',label:'晨间'},{id:'scene-b',label:'夜间'}];s.scenarioIds=['scene-a','scene-b'];
 render(<Filters state={s}/>);
 expect(screen.getByTestId('intake-filter-summary')).toHaveTextContent('合成店 · 商品 洁面乳 · 场景 2');
 expect(screen.queryByRole('combobox',{name:'当前店铺'})).toBeNull();
 expect(screen.queryByText('未选的只查通用话术。请点击查询。')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'筛选'}));
 expect(screen.getByRole('combobox',{name:'当前店铺'})).toBeVisible();
 expect(screen.getByText('未选的只查通用话术。请点击查询。')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'收起'}));
 expect(screen.queryByRole('combobox',{name:'当前店铺'})).toBeNull();
});
it('sends only the chosen product id when a condition is checked',()=>{
 const s=state();
 s.products=[{id:'product-a',label:'洁面乳'}];
 render(<Filters state={s}/>);
 fireEvent.click(screen.getByRole('button',{name:'筛选'}));
 fireEvent.click(screen.getByText('商品 · 通用'));
 fireEvent.click(screen.getByRole('checkbox',{name:'洁面乳'}));
 expect(s.selectConditions).toHaveBeenCalledWith({ productIds: ['product-a'], scenarioIds: [] });
 expect(s.load).not.toHaveBeenCalled();
});
it('keeps the filter line collapsed but shows a shop refresh error, and still opens on demand',()=>{
 const s=state();s.error='筛选条件更新失败，请刷新店铺。';
 render(<Filters state={s}/>);
 expect(screen.queryByRole('button',{name:'刷新店铺'})).toBeNull();
 expect(screen.getByRole('alert')).toHaveTextContent('筛选条件更新失败，请刷新店铺。');
 fireEvent.click(screen.getByRole('button',{name:'筛选'}));
 expect(screen.getByRole('button',{name:'刷新店铺'})).toBeEnabled();
 expect(screen.getAllByRole('alert')).toHaveLength(1);
});
