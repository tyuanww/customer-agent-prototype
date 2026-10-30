import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }),
  });
}
import { IntakeLibrary } from '../../src/renderer/features/dashboard/IntakeLibrary';
import { formatIntakeTime } from '../../src/renderer/features/dashboard/intake-time';
import type { IntakeCatalogCommand, IntakeCatalogReply, IntakeCatalogView } from '../../src/shared/content-intake-catalog';
import { ContentIntakeCatalog } from '../../src/main/content-intake-catalog';
import { IntakeUsageError, type IntakeUsageSession } from '../../src/main/content-intake-usage';
import { intakeQueryData } from '../fixtures/intake-query-data';
import { emptyIntakeQueryContext } from '../../src/shared/content-intake-query';

afterEach(() => { cleanup(); delete window.dashboardIntakeCatalog; vi.useRealTimers(); vi.unstubAllEnvs(); });
function data(): IntakeCatalogView {
 const until=new Date(Date.now()+60_000).toISOString();
 return {signedIn:true,busy:false,validUntil:until,releaseId:'rel_synthetic',context:{...emptyIntakeQueryContext(),
  shops:['shop-a','shop-b'],shopId:'shop-a',shopNames:[{id:'shop-a',label:'合成同名店'},{id:'shop-b',label:'合成同名店'}],shopNamesValidUntil:until,
  products:[{id:'product-a',label:'合成商品'}],scenarios:[{id:'scenario-a',label:'合成场景'}],validUntil:until},
  rows:(['product','campaign','presale','aftersale'] as const).map(domain=>({id:`row-${domain}`,domain,title:`合成标题 ${domain}`,
   answerText:`合成原文 ${domain}`,applicabilityNote:'通用范围',riskNote:'核对后使用',category:'合成分类',scriptVersion:1,effectiveFrom:'2020-01-01T00:00:00Z',effectiveTo:null}))};
}
function setup() {
 let view=data();const listeners=new Set<()=>void>();
 const command=vi.fn(async(c:IntakeCatalogCommand):Promise<IntakeCatalogReply>=>{
  if(c.action==='select-conditions')view={...view,rows:[],releaseId:null,validUntil:null,context:{...view.context,productIds:c.productIds,scenarioIds:c.scenarioIds}};
  if(c.action==='select-shop')view={...view,context:{...view.context,shopId:c.shopId,productIds:[],scenarioIds:[]}};
  if(c.action==='refresh')view={...view,...data(),context:view.context};
  if(c.action==='cancel')view={...view,rows:[],validUntil:null,releaseId:null};
  return {ok:true,view:structuredClone(view)};
 });
 window.dashboardIntakeCatalog={command,current:vi.fn(async():Promise<IntakeCatalogReply>=>({ok:true,view:structuredClone(view)})),onInvalidated:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};}};
 return {command,listeners,setView:(v:IntakeCatalogView)=>{view=v;}};
}
it('shows entry dates and the read deadline in the same local time zone with an explicit offset',async()=>{
 vi.stubEnv('TZ','America/New_York');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-01-15T14:59:00Z'));
 const f=setup(),view=data();view.rows[0]!.effectiveFrom='2026-01-15T15:00:00Z';view.rows[0]!.effectiveTo='2026-01-15T16:00:00Z';
 f.command.mockResolvedValueOnce({ok:true,view});render(<IntakeLibrary active/>);
 expect(await screen.findByRole('row',{name:/合成标题 product/})).toHaveTextContent('生效 2026-01-15 10:00，失效 2026-01-15 11:00');
 expect(screen.getByRole('row',{name:/合成标题 product/})).not.toHaveTextContent('UTC');
 const status=screen.getByRole('status');
 expect(status).toHaveTextContent('当前显示 1 条');
 expect(status).not.toHaveTextContent('rel_');
 expect(status).not.toHaveTextContent('UTC');
 expect(status).not.toHaveTextContent('1 小时内到期');
 expect(status).toHaveTextContent('读取有效至 2026-01-15 10:00');
 expect(screen.queryByText('1 小时内到期')).not.toBeInTheDocument();
 expect(f.command).toHaveBeenCalledTimes(1);
});
it('shows missing and invalid entry times explicitly instead of inventing a date',async()=>{
 const f=setup(),view=data();view.rows[0]!.effectiveFrom='';view.rows[0]!.effectiveTo='not-a-date';
 f.command.mockResolvedValueOnce({ok:true,view});render(<IntakeLibrary active/>);
 const row=await screen.findByRole('row',{name:/合成标题 product/});
 expect(row).toHaveTextContent('生效 —');
 expect(row).not.toHaveTextContent('UTC');
 expect(row).not.toHaveTextContent(/1970|Invalid Date/);
});
it('does not turn an absent optional timestamp into the Unix epoch',()=>{
 expect(formatIntakeTime(null)).toBe('未提供时间');
 expect(formatIntakeTime(undefined)).toBe('未提供时间');
 expect(formatIntakeTime('  ')).toBe('未提供时间');
});
it('counts only the visible domain and search results in the footer',async()=>{
 const f=setup(),user=userEvent.setup();render(<IntakeLibrary active/>);
 const product=await screen.findByRole('row',{name:/合成标题 product/});
 expect(screen.getByRole('region',{name:'可用话术目录'})).toBeVisible();
 expect(screen.getByRole('heading',{name:'已发布话术'})).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'系统同步'})).not.toBeInTheDocument();
 expect(screen.queryByText(/软件更新/)).not.toBeInTheDocument();
 expect(screen.queryByText(/发布记录/)).not.toBeInTheDocument();
 const status=screen.getByRole('status');
 expect(status).toHaveTextContent('当前显示 1 条');
 expect(status).not.toHaveTextContent('rel_');
 expect(screen.queryByText('合成原文 campaign')).not.toBeInTheDocument();
 expect(document.querySelector('select')).toBeNull();
 expect(product).not.toHaveTextContent(/rel_/);
 expect(screen.getByRole('tabpanel')).not.toHaveTextContent(/rel_/);
 expect(screen.getByRole('combobox',{name:'目录店铺'}).closest('.ant-select')).toHaveTextContent('合成同名店（shop-a）');
 for(const [label,domain] of [['活动','campaign'],['售前','presale'],['售后','aftersale']]){
  await user.click(screen.getByRole('tab',{name:label}));expect(screen.getByText(`合成原文 ${domain}`)).toBeVisible();
  expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('当前显示 1 条');
 }
 expect(f.command).toHaveBeenCalledTimes(1);
 fireEvent.keyDown(screen.getByRole('tab',{name:'售后'}),{key:'Home'});
 expect(screen.getByRole('tab',{name:'产品'})).toHaveFocus();
 expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby','intake-domain-product');
 expect(screen.queryByRole('button',{name:/复制|下架|导出/})).not.toBeInTheDocument();
 expect(screen.getByRole('button', { name: '刷新可用资料' })).toBeVisible();
 expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
 await user.click(screen.getByRole('tab',{name:'SOP'}));
 expect(screen.getByRole('tabpanel')).toHaveTextContent('此分类还没有可用话术，资料审核发布后会出现在这里。');
 expect(screen.getByRole('tabpanel')).not.toHaveTextContent('这一栏还没有 SOP 目录。');
 expect(screen.getByRole('tabpanel')).not.toHaveTextContent('未接入');
 expect(screen.getByRole('tabpanel')).not.toHaveTextContent('SOP 接口');
 expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
});
it('clears content on condition changes and uses IDs rather than names for shop selection',async()=>{
 const f=setup(),user=userEvent.setup();render(<IntakeLibrary active/>);
 await screen.findByText('合成原文 product');
 await user.click(screen.getByRole('button',{name:'高级筛选'}));
 await user.click(screen.getByRole('checkbox',{name:'合成商品'}));
 expect(f.command).toHaveBeenCalledTimes(1);
 await user.click(screen.getByRole('button',{name:'应用筛选'}));
 await waitFor(()=>expect(f.command).toHaveBeenCalledTimes(3));
 expect(f.command).toHaveBeenNthCalledWith(2,{action:'select-conditions',productIds:['product-a'],scenarioIds:[]});
 expect(f.command).toHaveBeenLastCalledWith({action:'refresh'});
 expect(await screen.findByText('合成原文 product')).toBeVisible();
 expect(screen.getByRole('region',{name:'可用话术目录'})).toHaveTextContent('商品：合成商品');
 await user.click(screen.getByRole('combobox',{name:'目录店铺'}));
 await user.click(await screen.findByRole('option',{name:'合成同名店（shop-b）'}));
 expect(f.command).toHaveBeenLastCalledWith({action:'select-shop',shopId:'shop-b'});
});
it('withdraws old content when a refresh fails instead of treating it as an empty successful catalog',async()=>{
 const f=setup(),user=userEvent.setup();render(<IntakeLibrary active/>);await screen.findByText('合成原文 product');
 f.command.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE',message:'合成读取失败',view:null});
 await user.click(screen.getByRole('button',{name:'刷新可用资料'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('合成读取失败');
 expect(screen.getByRole('button',{name:'重试'})).toBeVisible();
 expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();
});
it('keeps invalidation subscribed while hidden and rejects a late response from the previous generation',async()=>{
 const f=setup(),user=userEvent.setup();const {rerender}=render(<IntakeLibrary active/>);await screen.findByText('合成原文 product');
 let late!:(value:IntakeCatalogReply)=>void;f.command.mockImplementationOnce(()=>new Promise(resolve=>{late=resolve;}));
 await user.click(screen.getByRole('button',{name:'刷新可用资料'}));
 rerender(<IntakeLibrary active={false}/>);
 f.setView({...data(),signedIn:false,rows:[],releaseId:null,validUntil:null,context:emptyIntakeQueryContext()});
 await act(async()=>{f.listeners.forEach(fn=>fn());});
 await act(async()=>{late({ok:true,view:data()});});
 rerender(<IntakeLibrary active/>);
 expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();expect(screen.getByText('请先在查询窗口登录。')).toBeVisible();
 expect(f.command).toHaveBeenCalledTimes(2);
});
it('keeps cancellation available and does not repaint a late completed read',async()=>{
 const f=setup(),user=userEvent.setup();render(<IntakeLibrary active/>);await screen.findByText('合成原文 product');
 let late!:(value:IntakeCatalogReply)=>void;f.command.mockImplementationOnce(()=>new Promise(resolve=>{late=resolve;}));
 await user.click(screen.getByRole('button',{name:'刷新可用资料'}));await user.click(screen.getByRole('button',{name:'停止目录读取'}));
 await act(async()=>{late({ok:true,view:data()});});
 expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();expect(f.command).toHaveBeenLastCalledWith({action:'cancel'});
});
it('withdraws expired content even while hidden and lets names expire separately to IDs',async()=>{
 vi.useFakeTimers();const f=setup();const v=data();v.context.shopNamesValidUntil=new Date(Date.now()+100).toISOString();v.validUntil=new Date(Date.now()+200).toISOString();
 f.command.mockResolvedValueOnce({ok:true,view:v});
 const {rerender}=render(<IntakeLibrary active/>);await act(async()=>{});
 expect(screen.getByText('合成原文 product')).toBeVisible();
 await act(async()=>{vi.advanceTimersByTime(110);});
 expect(screen.getByRole('combobox',{name:'目录店铺'}).closest('.ant-select')).toHaveTextContent('shop-a');
 expect(screen.getByRole('combobox',{name:'目录店铺'}).closest('.ant-select')).not.toHaveTextContent('合成同名店');
 expect(screen.getByText('合成原文 product')).toBeVisible();
 rerender(<IntakeLibrary active={false}/>);await act(async()=>{vi.advanceTimersByTime(100);});rerender(<IntakeLibrary active/>);
 expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('登录状态需要确认');
});
it('refreshes once when 话术库 is shown and does not refresh again after hiding',async()=>{
 const f=setup();const {rerender}=render(<IntakeLibrary active={false}/>);expect(f.command).not.toHaveBeenCalled();
 rerender(<IntakeLibrary active/>);await waitFor(()=>expect(f.command).toHaveBeenCalledOnce());
 rerender(<IntakeLibrary active={false}/>);rerender(<IntakeLibrary active/>);
 await act(async()=>{});
 expect(f.command).toHaveBeenCalledOnce();
});

it.each(['LIMIT','UNAVAILABLE'] as const)('preserves a real Main command failure after a shown snapshot: %s',async code=>{
 const wire=intakeQueryData(),callbacks=new Set<()=>void>();let fail=false;
 const session:IntakeUsageSession={view:()=>({signedIn:true,sessionEpoch:1}),subscribe:fn=>{callbacks.add(fn);return()=>{callbacks.delete(fn);};},
  request:async(_epoch,path,options)=>{if(fail && path.includes('/snapshot'))throw new IntakeUsageError(code);return {value:wire.respond(path,options.body)};}};
 const owner=new ContentIntakeCatalog(session),invalidations=vi.fn();owner.subscribe(invalidations);
 const command=vi.fn(async(c:IntakeCatalogCommand):Promise<IntakeCatalogReply>=>{try{return {ok:true,view:await owner.command(c)};}
  catch(error){return {ok:false,code:error instanceof IntakeUsageError?error.code:'UNAVAILABLE',message:`目录失败 ${code}`,view:owner.view()};}});
 window.dashboardIntakeCatalog={command,current:async()=>({ok:true,view:owner.view()}),onInvalidated:fn=>owner.subscribe(fn)};
 const user=userEvent.setup();
 try{render(<IntakeLibrary active/>);
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'目录店铺'})).toBeEnabled());
  await user.click(screen.getByRole('combobox',{name:'目录店铺'}));
  await user.click(await screen.findByRole('option',{name:'shop-a'}));
  await user.click(screen.getByRole('button',{name:'刷新可用资料'}));await screen.findByRole('row',{name:/洁面用法 0/});
  fail=true;await user.click(screen.getByRole('button',{name:'刷新可用资料'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(`目录失败 ${code}`);
  expect(screen.getByRole('button',{name:'重试'})).toBeVisible();
  expect(screen.queryByRole('row',{name:/洁面用法 0/})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'刷新可用资料'})).toBeEnabled();expect(invalidations).not.toHaveBeenCalled();
 }finally{cleanup();owner.dispose();}
});

it('reads low, medium, and high risk notes as levels on the wording list',async()=>{
 const f=setup(),view=data(),base=view.rows[0]!;
 view.rows=[
  {...base,id:'low',title:'低风险话术',riskNote:'low'},
  {...base,id:'medium',title:'中档话术',riskNote:'medium'},
  {...base,id:'high',title:'高风险话术',riskNote:'high'},
  {...base,id:'zh',title:'中文档话术',riskNote:'风险高'},
  {...base,id:'sentence',title:'句子话术',riskNote:'核对后使用'},
 ];
 f.command.mockResolvedValueOnce({ok:true,view});
 render(<IntakeLibrary active/>);
 const low=await screen.findByRole('row',{name:/低风险话术/});
 expect(low).toHaveTextContent('风险低');
 expect(low).not.toHaveTextContent(/\blow\b/);
 expect(low).not.toHaveTextContent('风险提示');
 const medium=screen.getByRole('row',{name:/中档话术/});
 expect(medium).toHaveTextContent('风险中');
 expect(medium).not.toHaveTextContent('medium');
 const high=screen.getByRole('row',{name:/高风险话术/});
 expect(high).toHaveTextContent('风险高');
 expect(high).not.toHaveTextContent(/\bhigh\b/);
 const zh=screen.getByRole('row',{name:/中文档话术/});
 expect(zh).toHaveTextContent('风险高');
 expect(zh).not.toHaveTextContent('风险提示：风险高');
 const sentence=screen.getByRole('row',{name:/句子话术/});
 expect(sentence).toHaveTextContent('风险提示：核对后使用');
 expect(sentence).not.toHaveTextContent('风险低');
 expect(sentence).not.toHaveTextContent('风险中');
 expect(sentence).not.toHaveTextContent('风险高');
 expect(document.querySelector('select')).toBeNull();
 expect(screen.getByRole('tabpanel')).not.toHaveTextContent(/rel_/);
 for(const row of [low,medium,high,zh,sentence]) expect(row).not.toHaveTextContent(/rel_/);
});
it('counts a fresh empty snapshot as zero available rows',async()=>{
 const f=setup(),view=data();view.rows=[];
 f.command.mockResolvedValueOnce({ok:true,view});
 render(<IntakeLibrary active/>);
 await screen.findByText('当前显示 0 条');
 const status=screen.getByRole('status');
 expect(status).toHaveTextContent('当前显示 0 条');
 expect(status).not.toHaveTextContent('暂无有效发布');
});
it('stores a missing catalog API as the unavailable sentence with a retry',async()=>{
 render(<IntakeLibrary active/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('可用资料暂不可读取，请重试。');
 expect(screen.getByRole('button',{name:'重试'})).toBeVisible();
 expect(screen.queryByText('请先在查询窗口登录。')).not.toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'系统同步'})).not.toBeInTheDocument();
 expect(screen.queryByText(/全店|店铺总数|全库/)).not.toBeInTheDocument();
});
it('stores a signed-out catalog as the logged-out sentence without a retry',async()=>{
 const f=setup(),view=data();
 view.signedIn=false;view.rows=[];view.releaseId=null;view.validUntil=null;view.context=emptyIntakeQueryContext();
 f.command.mockResolvedValueOnce({ok:true,view});
 render(<IntakeLibrary active/>);
 expect(await screen.findByText('请先在查询窗口登录。')).toBeVisible();
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'重试'})).not.toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'系统同步'})).not.toBeInTheDocument();
});

it('keeps filter edits local until applied and counts the visible search', async () => {
 const fixture=setup(), user=userEvent.setup();render(<IntakeLibrary active/>);
 await screen.findByText('合成原文 product');
 expect(screen.queryByText('商品')).not.toBeInTheDocument();
 await user.type(screen.getByRole('textbox',{name:'问题搜索'}),'不匹配');
 expect(screen.getByRole('status')).toHaveTextContent('当前显示 0 条');
 await user.click(screen.getByRole('button',{name:'高级筛选'}));
 await user.click(screen.getByRole('checkbox',{name:'合成商品'}));
 await user.click(screen.getByRole('button',{name:'取消'}));
 expect(fixture.command).toHaveBeenCalledTimes(1);
 expect(screen.queryByLabelText('已用筛选')).not.toBeInTheDocument();
});
it('does not acquire a new snapshot after applying rejected filters',async()=>{
 const fixture=setup(),user=userEvent.setup();render(<IntakeLibrary active/>);
 await screen.findByText('合成原文 product');
 await user.click(screen.getByRole('button',{name:'高级筛选'}));
 await user.click(screen.getByRole('checkbox',{name:'合成商品'}));
 fixture.command.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE',message:'筛选范围已变化',view:null});
 await user.click(screen.getByRole('button',{name:'应用筛选'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('筛选范围已变化');
 expect(fixture.command).toHaveBeenCalledTimes(2);
 expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();
});
