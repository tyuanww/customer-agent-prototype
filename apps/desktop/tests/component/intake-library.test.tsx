import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
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
 f.command.mockResolvedValueOnce({ok:true,view});const {rerender}=render(<IntakeLibrary active="wording"/>);
 expect(await screen.findByRole('article',{name:'合成标题 product'})).toHaveTextContent('生效 2026年01月15日 10:00:00（UTC-05:00） · 失效 2026年01月15日 11:00:00（UTC-05:00）');
 rerender(<IntakeLibrary active="announce"/>);
 expect(screen.getByText(/可用版本 rel_synthetic/)).toHaveTextContent('资格截止 2026年01月15日 10:00:00（UTC-05:00）');
 expect(f.command).toHaveBeenCalledTimes(1);
});
it('shows missing and invalid entry times explicitly instead of inventing a date',async()=>{
 const f=setup(),view=data();view.rows[0]!.effectiveFrom='';view.rows[0]!.effectiveTo='not-a-date';
 f.command.mockResolvedValueOnce({ok:true,view});render(<IntakeLibrary active="wording"/>);
 const row=await screen.findByRole('article',{name:'合成标题 product'});
 expect(row).toHaveTextContent('生效 未提供时间 · 失效 时间无效');
 expect(row).not.toHaveTextContent(/1970|Invalid Date/);
});
it('does not turn an absent optional timestamp into the Unix epoch',()=>{
 expect(formatIntakeTime(null)).toBe('未提供时间');
 expect(formatIntakeTime(undefined)).toBe('未提供时间');
 expect(formatIntakeTime('  ')).toBe('未提供时间');
});
it('browses four scoped domains and shares the same complete read with the available-version page',async()=>{
 const f=setup(),user=userEvent.setup();const {rerender}=render(<IntakeLibrary active="wording"/>);
 await screen.findByRole('article',{name:'合成标题 product'});
 expect(screen.getByRole('option',{name:'合成同名店（shop-b）'})).toHaveValue('shop-b');
 for(const [label,domain] of [['活动话术','campaign'],['售前流程','presale'],['售后流程','aftersale']]){
  await user.click(screen.getByRole('tab',{name:label}));expect(screen.getByText(`合成原文 ${domain}`)).toBeVisible();
  expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();
 }
 fireEvent.keyDown(screen.getByRole('tab',{name:'售后流程'}),{key:'Home'});
 expect(screen.getByRole('tab',{name:'产品话术'})).toHaveFocus();
 expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby','intake-domain-product');
 expect(screen.queryByRole('button',{name:/复制|下架|导出/})).not.toBeInTheDocument();
 rerender(<IntakeLibrary active="announce"/>);
 expect(screen.getByRole('region',{name:'当前可用版本'})).toBeVisible();
 expect(screen.getByText(/可用版本 rel_synthetic/)).toBeVisible();
 expect(screen.getByText(/不代表全库同步/)).toBeVisible();
 expect(f.command).toHaveBeenCalledTimes(1);
});
it('clears content on condition changes and uses IDs rather than names for shop selection',async()=>{
 const f=setup(),user=userEvent.setup();render(<IntakeLibrary active="wording"/>);
 await screen.findByText('合成原文 product');
 await user.click(screen.getByText('商品 · 通用'));
 await user.click(screen.getByRole('checkbox',{name:'合成商品'}));
 expect(f.command).toHaveBeenLastCalledWith({action:'select-conditions',productIds:['product-a'],scenarioIds:[]});
 expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'刷新可用资料'}));await screen.findByText('合成原文 product');
 await user.selectOptions(screen.getByRole('combobox',{name:'目录店铺'}),'shop-b');
 expect(f.command).toHaveBeenLastCalledWith({action:'select-shop',shopId:'shop-b'});
});
it('withdraws old content when a refresh fails instead of treating it as an empty successful catalog',async()=>{
 const f=setup(),user=userEvent.setup();render(<IntakeLibrary active="wording"/>);await screen.findByText('合成原文 product');
 f.command.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE',message:'合成读取失败',view:null});
 await user.click(screen.getByRole('button',{name:'刷新可用资料'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('合成读取失败');expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();
});
it('keeps invalidation subscribed while hidden and rejects a late response from the previous generation',async()=>{
 const f=setup(),user=userEvent.setup();const {rerender}=render(<IntakeLibrary active="wording"/>);await screen.findByText('合成原文 product');
 let late!:(value:IntakeCatalogReply)=>void;f.command.mockImplementationOnce(()=>new Promise(resolve=>{late=resolve;}));
 await user.click(screen.getByRole('button',{name:'刷新可用资料'}));
 rerender(<IntakeLibrary active={null}/>);
 f.setView({...data(),signedIn:false,rows:[],releaseId:null,validUntil:null,context:emptyIntakeQueryContext()});
 await act(async()=>{f.listeners.forEach(fn=>fn());});
 await act(async()=>{late({ok:true,view:data()});});
 rerender(<IntakeLibrary active="wording"/>);
 expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();expect(screen.getByText('请先在查询窗口登录。')).toBeVisible();
 expect(f.command).toHaveBeenCalledTimes(2);
});
it('keeps cancellation available and does not repaint a late completed read',async()=>{
 const f=setup(),user=userEvent.setup();render(<IntakeLibrary active="wording"/>);await screen.findByText('合成原文 product');
 let late!:(value:IntakeCatalogReply)=>void;f.command.mockImplementationOnce(()=>new Promise(resolve=>{late=resolve;}));
 await user.click(screen.getByRole('button',{name:'刷新可用资料'}));await user.click(screen.getByRole('button',{name:'停止目录读取'}));
 await act(async()=>{late({ok:true,view:data()});});
 expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();expect(f.command).toHaveBeenLastCalledWith({action:'cancel'});
});
it('withdraws expired content even while hidden and lets names expire separately to IDs',async()=>{
 vi.useFakeTimers();const f=setup();const v=data();v.context.shopNamesValidUntil=new Date(Date.now()+100).toISOString();v.validUntil=new Date(Date.now()+200).toISOString();
 f.command.mockResolvedValueOnce({ok:true,view:v});
 const {rerender}=render(<IntakeLibrary active="wording"/>);await act(async()=>{});
 expect(screen.getByText('合成原文 product')).toBeVisible();
 await act(async()=>{vi.advanceTimersByTime(110);});
 expect(screen.getByRole('option',{name:'shop-a'})).toBeInTheDocument();expect(screen.getByText('合成原文 product')).toBeVisible();
 rerender(<IntakeLibrary active={null}/>);await act(async()=>{vi.advanceTimersByTime(100);});rerender(<IntakeLibrary active="wording"/>);
 expect(screen.queryByText('合成原文 product')).not.toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('读取资格已到期');
});
it('does not start directory I/O before visiting either consumer',async()=>{
 const f=setup();const {rerender}=render(<IntakeLibrary active={null}/>);expect(f.command).not.toHaveBeenCalled();
 rerender(<IntakeLibrary active="announce"/>);await waitFor(()=>expect(f.command).toHaveBeenCalledOnce());
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
 try{render(<IntakeLibrary active="wording"/>);await screen.findByRole('option',{name:'shop-a'});
  await user.selectOptions(screen.getByRole('combobox',{name:'目录店铺'}),'shop-a');
  await user.click(screen.getByRole('button',{name:'刷新可用资料'}));await screen.findByRole('article',{name:'洁面用法 0'});
  fail=true;await user.click(screen.getByRole('button',{name:'刷新可用资料'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(`目录失败 ${code}`);
  expect(screen.queryByRole('article',{name:'洁面用法 0'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'刷新可用资料'})).toBeEnabled();expect(invalidations).not.toHaveBeenCalled();
 }finally{cleanup();owner.dispose();}
});
