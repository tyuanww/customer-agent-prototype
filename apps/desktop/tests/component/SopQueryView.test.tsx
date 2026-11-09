import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SopApp } from '../../src/renderer/SopApp';
import type { SopQueryProjection } from '../../src/shared/sop-query';
const empty:SopQueryProjection={projectionVersion:'sop-query-v1',sessionId:1,state:'ready',shops:[{key:'shop-handle',label:'合成店铺'}],notice:'',messages:[],branches:[],terminal:false,copied:false};
afterEach(()=> {cleanup();delete window.sopWindow;});
it('shows distinct original messages and obeys each copy flag',async()=> {
  const queryCommand=vi.fn().mockResolvedValue({ok:true});window.sopWindow={queryCommand} as unknown as NonNullable<typeof window.sopWindow>;
  render(<SopApp projection={{...empty,messages:[{key:'a',title:'话术甲',body:'原文甲',risk:'low',canCopy:true},{key:'b',title:'话术乙',body:'原文乙',risk:'high',canCopy:false}]}}/>);
  expect(screen.getByText('原文甲')).toBeVisible();expect(screen.getByText('原文乙')).toBeVisible();
  const buttons=screen.getAllByRole('button',{name:'复制话术'});expect(buttons[1]).toBeDisabled();fireEvent.click(buttons[0]!);
  await waitFor(()=>expect(queryCommand).toHaveBeenCalledWith({kind:'copy',key:'a'}));
});
it.each(['blocked','stale','no_match'] as const)('renders %s without old content or actions',state=> {
  const {rerender}=render(<SopApp projection={{...empty,messages:[{key:'a',title:'话术',body:'旧原文',risk:'low',canCopy:true}]}}/>);
  rerender(<SopApp projection={{...empty,state,notice:'当前提示'}}/>);
  expect(screen.queryByText('旧原文')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'复制话术'})).not.toBeInTheDocument();expect(screen.getByText('当前提示')).toBeVisible();
});
it('clears authority when form context changes and reports rejected commands',async()=> {
  const queryCommand=vi.fn().mockResolvedValue({ok:false,code:'FAILED',message:'请重新查询'});window.sopWindow={queryCommand} as unknown as NonNullable<typeof window.sopWindow>;
  render(<SopApp projection={empty}/>);fireEvent.change(screen.getByRole('textbox',{name:'问题'}),{target:{value:'新的问题'}});
  expect(queryCommand).toHaveBeenCalledWith({kind:'clear'});fireEvent.click(screen.getByRole('button',{name:'查询流程'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('请重新查询'));
});

it('hides old content immediately and reports a failed context clear',async()=> {
  const queryCommand=vi.fn().mockRejectedValue(new Error('disconnected'));
  window.sopWindow={queryCommand} as unknown as NonNullable<typeof window.sopWindow>;
  render(<SopApp projection={{...empty,messages:[{key:'a',title:'旧话术',body:'旧正文',risk:'low',canCopy:true}]}}/>);
  fireEvent.change(screen.getByRole('textbox',{name:'问题'}),{target:{value:'新问题'}});
  expect(screen.queryByText('旧正文')).not.toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('无法更新查询条件'));
});
