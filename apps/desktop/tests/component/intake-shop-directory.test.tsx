import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { emptyIntakeQueryContext } from '../../src/shared/content-intake-query';
import { describeIntakeQueryScope, IntakeQueryFilters } from '../../src/renderer/features/search/IntakeQueryFilters';
import type { useIntakeShops } from '../../src/renderer/features/search/use-intake-shops';
const state=():ReturnType<typeof useIntakeShops>=>({...emptyIntakeQueryContext(),shops:['shop-a','shop-b'],shopId:'shop-a',busy:false,error:'',load:vi.fn(),selectConditions:vi.fn()});
function Filters({ state, open = false }: { state: ReturnType<typeof useIntakeShops>; open?: boolean }) {
  return <IntakeQueryFilters state={state} scope={describeIntakeQueryScope(state)} signedIn open={open} showError onLayoutChange={() => undefined} />;
}
it('shows names with ID disambiguation and emits only the stable shop ID',()=>{
 const s=state();s.shopNames=[{id:'shop-a',label:'合成同名店'},{id:'shop-b',label:'合成同名店'}];s.shopNamesValidUntil=new Date(Date.now()+60000).toISOString();
 expect(describeIntakeQueryScope(s)).toMatchObject({ context: '合成同名店（shop-a）', description: '合成同名店（shop-a） · 商品全部 · 场景全部' });
 render(<Filters state={s} open />);
 expect(screen.getByRole('option',{name:'合成同名店（shop-a）'})).toHaveValue('shop-a');
 fireEvent.change(screen.getByRole('combobox',{name:'当前店铺'}),{target:{value:'shop-b'}});expect(s.load).toHaveBeenCalledWith('shop-b');
 expect(s.selectConditions).not.toHaveBeenCalled();
 expect(screen.queryByText(/名称暂不可用/)).toBeNull();
});
it.each(['missing','expired'])('keeps IDs and explicitly marks %s names unavailable',kind=>{
 const s=state();if(kind==='expired'){s.shopNames=[{id:'shop-a',label:'过期合成名'},{id:'shop-b',label:'过期合成名'}];s.shopNamesValidUntil=new Date(Date.now()-1000).toISOString();}
 expect(describeIntakeQueryScope(s)).toMatchObject({ context: 'shop-a', description: 'shop-a · 商品全部 · 场景全部' });
 render(<Filters state={s} open />);
 expect(screen.getByRole('option',{name:'shop-a'})).toHaveValue('shop-a');expect(screen.getByText('当前显示店铺编号。')).toBeVisible();
 expect(screen.queryByText(/过期合成名/)).toBeNull();expect(screen.getByRole('combobox',{name:'当前店铺'})).toBeEnabled();
});
it('summarizes compact scope and includes all selected labels in the description',()=>{
 const s=state();
 s.shopNames=[{id:'shop-a',label:'合成店'}];s.shopNamesValidUntil=new Date(Date.now()+60000).toISOString();
 s.products=[{id:'product-a',label:'洁面乳'}];s.productIds=['product-a'];
 s.scenarios=[{id:'scene-a',label:'晨间'},{id:'scene-b',label:'夜间'}];s.scenarioIds=['scene-a','scene-b'];
 expect(describeIntakeQueryScope(s)).toMatchObject({ context: '商品 洁面乳 · 场景 2 · 合成店', description: '合成店 · 商品 洁面乳 · 场景 晨间、夜间' });
 const { rerender } = render(<Filters state={s}/>);
 expect(screen.queryByRole('combobox',{name:'当前店铺'})).toBeNull();
 expect(screen.queryByText('未选条件时查询全部授权话术。请点击查询。')).toBeNull();
 rerender(<Filters state={s} open />);
 expect(screen.getByRole('combobox',{name:'当前店铺'})).toBeVisible();
 expect(screen.getByText('未选条件时查询全部授权话术。请点击查询。')).toBeVisible();
 rerender(<Filters state={s}/>);
 expect(screen.queryByRole('combobox',{name:'当前店铺'})).toBeNull();
});
it('sends only the chosen product id when a condition is checked',()=>{
 const s=state();
 s.products=[{id:'product-a',label:'洁面乳'}];
 render(<Filters state={s} open />);
 fireEvent.click(screen.getByText('商品 · 全部'));
 fireEvent.click(screen.getByRole('checkbox',{name:'洁面乳'}));
 expect(s.selectConditions).toHaveBeenCalledWith({ productIds: ['product-a'], scenarioIds: [] });
 expect(s.load).not.toHaveBeenCalled();
});
it('keeps the filter line collapsed but shows a shop refresh error, and still opens on demand',()=>{
 const s=state();s.error='查询范围更新失败，请刷新店铺。';
 const { rerender } = render(<Filters state={s}/>);
 expect(screen.queryByRole('button',{name:'刷新店铺'})).toBeNull();
 expect(screen.getByRole('alert')).toHaveTextContent('查询范围更新失败，请刷新店铺。');
 rerender(<Filters state={s} open />);
 expect(screen.getByRole('button',{name:'刷新店铺'})).toBeEnabled();
 expect(screen.getAllByRole('alert')).toHaveLength(1);
});
