import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { emptyIntakeQueryContext } from '../../src/shared/content-intake-query';
import { IntakeQueryFilters } from '../../src/renderer/features/search/IntakeQueryFilters';
import type { useIntakeShops } from '../../src/renderer/features/search/use-intake-shops';
const state=():ReturnType<typeof useIntakeShops>=>({...emptyIntakeQueryContext(),shops:['shop-a','shop-b'],shopId:'shop-a',busy:false,error:'',load:vi.fn(),selectConditions:vi.fn()});
it('shows names with ID disambiguation and emits only the stable shop ID',()=>{
 const s=state();s.shopNames=[{id:'shop-a',label:'合成同名店'},{id:'shop-b',label:'合成同名店'}];s.shopNamesValidUntil=new Date(Date.now()+60000).toISOString();
 render(<IntakeQueryFilters state={s} signedIn onLayoutChange={()=>undefined}/>);
 expect(screen.getByRole('option',{name:'合成同名店（shop-a）'})).toHaveValue('shop-a');
 fireEvent.change(screen.getByRole('combobox',{name:'当前店铺'}),{target:{value:'shop-b'}});expect(s.load).toHaveBeenCalledWith('shop-b');
 expect(screen.queryByText(/名称暂不可用/)).toBeNull();
});
it.each(['missing','expired'])('keeps IDs and explicitly marks %s names unavailable',kind=>{
 const s=state();if(kind==='expired'){s.shopNames=[{id:'shop-a',label:'过期合成名'},{id:'shop-b',label:'过期合成名'}];s.shopNamesValidUntil=new Date(Date.now()-1000).toISOString();}
 render(<IntakeQueryFilters state={s} signedIn onLayoutChange={()=>undefined}/>);
 expect(screen.getByRole('option',{name:'shop-a'})).toHaveValue('shop-a');expect(screen.getByText(/店铺名称暂不可用/)).toBeVisible();
 expect(screen.queryByText(/过期合成名/)).toBeNull();expect(screen.getByRole('combobox',{name:'当前店铺'})).toBeEnabled();
});
