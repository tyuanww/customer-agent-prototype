import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render,screen,fireEvent,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,expect,it,vi } from 'vitest';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import type { IntakePermissionCommand } from '../../src/shared/content-intake-permissions';
import { actionsForIntakePost } from '../../src/shared/intake-post-actions';
import type { SeatAccountIntent } from '../../src/shared/seat-account-intent';
import { IntakePermissions } from '../../src/renderer/features/dashboard/IntakePermissions';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';
const PAGE = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/features/dashboard/IntakePermissions.tsx');
function setPassword(element: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(element, value);
  fireEvent.input(element, { target: element });
}
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }),
  });
}
async function pick(user: ReturnType<typeof userEvent.setup>, name: string | RegExp, option: string) {
  await user.click(screen.getByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
}
afterEach(()=>{delete window.dashboardPermissions;delete window.dashboardSeats;vi.unstubAllEnvs();});
it('selects a post, previews that post through the existing command, then saves and revokes',async()=>{
 vi.stubEnv('TZ','Asia/Shanghai');
 const supervisor=actionsForIntakePost('客服主管'),agent=actionsForIntakePost('客服');
 expect(supervisor.ok).toBe(true);expect(agent.ok).toBe(true);
 if(!supervisor.ok || !agent.ok) return;
 const f=intakePermissionsData([...supervisor.actions,...agent.actions]),main=new ContentIntakePermissions(f.session),user=userEvent.setup();
 const commands:IntakePermissionCommand[]=[];
 window.dashboardPermissions={current:async()=>({ok:true,view:main.view()}),command:async c=>{commands.push(c);return {ok:true,view:await main.command(c)};},onInvalidated:fn=>main.subscribe(fn)};
 try{render(<IntakePermissions canGrant active/>);await screen.findAllByRole('row',{name:/合成坐席/});
  const people=screen.getByRole('table',{name:'人员'});
  for(const header of ['姓名','登录名','岗位','状态']) expect(within(people).getByRole('columnheader',{name:header})).toBeInTheDocument();
  expect(within(within(people).getByRole('row',{name:/合成坐席/})).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['合成坐席','—','—','未授权']);
  expect(people).not.toHaveTextContent('registered-agent');
  const grants=screen.getByRole('table',{name:'已有业务权限'});
  for(const header of ['人员','范围名称','有效期']) expect(within(grants).getByRole('columnheader',{name:header})).toBeInTheDocument();
  expect(grants).toHaveTextContent('此范围暂无可管理业务权限。');
  expect(document.querySelector('select')).toBeNull();
  await user.click(screen.getByRole('button',{name:'新增授权'}));
  expect(screen.getByRole('button',{name:'新增授权'})).toHaveClass('ant-btn-primary');
  expect(screen.getByRole('combobox',{name:/^岗位$/}).closest('.ant-select')).toHaveTextContent('客服');
  expect(document.querySelector('select')).toBeNull();
  const page=readFileSync(PAGE,'utf8');
  expect(page).toContain('actionsForIntakePost');
  expect(page).not.toContain('content-manage');
  expect(page).not.toContain('source-confirm');
  expect(page).not.toContain('password-accounts');
  await pick(user,'人员','合成坐席');
  await pick(user,/^岗位$/,'客服主管');
  await user.click(screen.getByLabelText('生效时间'));
  await user.type(screen.getByLabelText('生效时间'), '2026-10-08 10:00{Enter}');
  await user.click(screen.getByLabelText('失效时间'));
  await user.type(screen.getByLabelText('失效时间'), '2026-10-09 10:00{Enter}');
  await user.type(screen.getByRole('textbox',{name:'授权原因'}),'合成任务');await user.click(screen.getByRole('button',{name:'预览权限'}));
  await screen.findByText('预览，尚未保存');expect(f.grants).toHaveLength(0);
  expect(f.requests.filter(request=>request.path==='/v1/intake/grants/preview').map(request=>(request.body as {items:{action:string}[]}).items.map(item=>item.action))).toEqual([[...supervisor.actions]]);
  expect(f.requests.some(request=>request.path.includes('password') || request.path.includes('account'))).toBe(false);
  await user.click(screen.getByRole('button',{name:'返回修改'}));
  await pick(user,/^岗位$/,'客服');
  await user.click(screen.getByRole('button',{name:'预览权限'}));
  await screen.findByText('预览，尚未保存');expect(f.grants).toHaveLength(0);
  const displayedPeriod='2026-10-08 10:00 至 2026-10-09 10:00';
  expect(screen.getByRole('region',{name:'权限预览'})).toHaveTextContent(displayedPeriod);
  expect(f.requests.filter(request=>request.path==='/v1/intake/grants/preview').at(-1)).toMatchObject({body:{items:[{
   startsAt:'2026-10-08T02:00:00.000Z',expiresAt:'2026-10-09T02:00:00.000Z',action:agent.actions[0],
  }]}});
  await user.click(screen.getByRole('button',{name:'确认保存权限'}));
  await screen.findByText(/本次操作已保存/);
  expect(screen.queryByRole('button',{name:'停止等待'})).not.toBeInTheDocument();
  expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'刷新权限列表'}));
  expect(within(within(screen.getByRole('table',{name:'人员'})).getByRole('row',{name:/合成坐席/})).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['合成坐席','—','客服','已过期']);
  const grantRow=within(screen.getByRole('region',{name:'已有业务权限'})).getByRole('row',{name:/合成坐席/});
  expect(grantRow).toHaveTextContent(displayedPeriod);
  const grantCells=within(grantRow).getAllByRole('cell').map(cell=>cell.textContent??'');
  expect(grantCells.join('\n')).not.toContain('grant-demo');
  expect(grantCells.join('\n')).not.toContain('created-business');
  expect(grantCells.join('\n')).not.toMatch(/source-/);
  expect(grantCells.join('\n')).not.toMatch(/shop-/);
  const scopeCell=grantCells.find(cell=>cell.includes('该店铺'));
  expect(scopeCell).toContain('该来源');
  expect(scopeCell).toContain('产品');
  const periodCell=grantCells.find(cell=>cell.includes('2026-10-08'));
  expect(periodCell).toContain(displayedPeriod);
  expect(periodCell).not.toContain('该店铺');
  const revoke=await screen.findByRole('button',{name:'撤销该权限'});
  expect(revoke).toHaveClass('ant-btn-dangerous');
  expect(revoke).not.toHaveClass('ant-btn-primary');
  expect(revoke).not.toHaveClass('fn-note');
  await user.click(revoke);await user.type(screen.getByRole('textbox',{name:'撤销原因'}),'合成撤销');
  const confirmRevoke=screen.getByRole('button',{name:'确认撤销'});
  expect(confirmRevoke).toHaveClass('ant-btn-dangerous');
  await user.click(confirmRevoke);await waitFor(()=>expect(f.grants[0]!.revokedAt).not.toBeNull());
  expect(commands.some(command=>command.action==='save')).toBe(true);
  expect(commands.some(command=>command.action==='revoke')).toBe(true);
  expect(commands.every(command=>['refresh','save','retry','discard','stop','source','preview','revoke'].includes(command.action))).toBe(true);
  expect(commands.filter(command=>command.action==='preview').map(command=>command.action==='preview'?[...command.actions]:[])).toEqual([[...supervisor.actions],[...agent.actions]]);
 }finally{main.dispose();}
}, 30_000);
it('does not offer a post the current scope cannot grant',async()=>{
 const main=new ContentIntakePermissions(intakePermissionsData().session);
 window.dashboardPermissions={current:async()=>({ok:true,view:main.view()}),command:async c=>({ok:true,view:await main.command(c)}),onInvalidated:fn=>main.subscribe(fn)};
 try{render(<IntakePermissions canGrant active/>);await screen.findAllByRole('row',{name:/合成坐席/});
  await userEvent.click(screen.getByRole('button',{name:'新增授权'}));
  const post=screen.getByRole('combobox',{name:/^岗位$/});
  expect(post.closest('.ant-select')).toHaveTextContent('客服');
  await userEvent.click(post);
  expect((await screen.findAllByRole('option')).map(option=>option.textContent)).toEqual(['客服']);
  expect(document.querySelector('select')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'关闭'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'停止等待'})).not.toBeInTheDocument();
  expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:'外包坐席'}));
  fireEvent.click(screen.getByRole('button',{name:'新建坐席'}));
  const seatPost=screen.getByRole('combobox',{name:'坐席岗位'});
  expect(seatPost.closest('.ant-select')).toHaveTextContent('客服');
  await userEvent.click(seatPost);
  expect((await screen.findAllByRole('option')).map(option=>option.textContent)).toEqual(['客服','客服主管']);
  expect(document.querySelector('select')).toBeNull();
 }finally{main.dispose();}
});
it('creates an outsourced seat from an intent and does not keep the password on the page',async()=>{
 const main=new ContentIntakePermissions(intakePermissionsData().session),user=userEvent.setup();
 const intents:SeatAccountIntent[]=[];
 window.dashboardPermissions={current:async()=>({ok:true,view:main.view()}),command:async c=>({ok:true,view:await main.command(c)}),onInvalidated:fn=>main.subscribe(fn)};
 window.dashboardSeats={command:async intent=>{intents.push(structuredClone(intent));
  if(intent.action==='list')return {ok:true,action:'list',seats:[{displayName:'已有坐席',username:'seatkept',post:'客服主管',enabled:true}]};
  if(intent.action==='create')return {ok:true,action:'create',seat:{displayName:intent.displayName,username:intent.username,post:intent.post,enabled:true}};
  if(intent.action==='reset')return {ok:true,action:'reset',username:intent.username};
  return {ok:true,action:'disable',username:intent.username};}};
 const login=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'../../src/renderer/LoginApp.tsx'),'utf8');
 const page=readFileSync(PAGE,'utf8');
 try{render(<IntakePermissions canGrant active/>);await screen.findAllByRole('row',{name:/合成坐席/});
  await user.click(screen.getByRole('tab',{name:'外包坐席'}));
  await user.click(screen.getByRole('button',{name:'新建坐席'}));
  const form=screen.getByRole('dialog',{name:'新建坐席'});
  expect(within(form).getByLabelText('姓名')).toBeInTheDocument();
  expect(within(form).getByLabelText('登录名')).toBeInTheDocument();
  expect(within(form).getByLabelText('密码')).toHaveAttribute('type','password');
  const seatPost=within(form).getByRole('combobox',{name:'坐席岗位'});
  expect(seatPost.closest('.ant-select')).toHaveTextContent('客服');
  await user.click(seatPost);
  expect((await screen.findAllByRole('option')).map(option=>option.textContent)).toEqual(['客服','客服主管']);
  await user.click(await screen.findByRole('option',{name:'客服'}));
  expect(document.querySelector('select')).toBeNull();
  expect(screen.getByRole('dialog',{name:'新建坐席'})).toBe(form);
  expect(page).toContain('dashboardSeats');
  expect(page).not.toContain('password-accounts');
  expect(page).not.toMatch(/seat-account-command|password-account-file|subject-binding|from 'pg'/);
  expect(login).toContain('飞书');expect(login).toContain('账号');expect(login).not.toContain('外包');
  const kept=await within(screen.getByRole('table',{name:'外包坐席'})).findByRole('row',{name:/seatkept/});
  expect(within(kept).getByRole('cell',{name:'客服主管'})).toBeInTheDocument();
  expect(intents[0]).toEqual({action:'list'});
  await user.type(within(form).getByLabelText('姓名'),'外包甲');
  await user.type(within(form).getByLabelText('登录名'),'seatui');
  setPassword(within(form).getByLabelText('密码'), 'pw-seat-ui');
  await user.click(within(form).getByRole('button',{name:'保存坐席'}));
  const table=screen.getByRole('table',{name:'外包坐席'});
  const row=await within(table).findByRole('row',{name:/seatui/});
  expect(intents.find(intent=>intent.action==='create')).toEqual({action:'create',displayName:'外包甲',username:'seatui',password:'pw-seat-ui',post:'客服'});
  expect(document.body.innerHTML).not.toContain('pw-seat-ui');
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
  expect(within(row).getByRole('cell',{name:'seatui'})).toBeInTheDocument();
  expect(within(row).queryByRole('textbox',{name:'登录名'})).not.toBeInTheDocument();
  await user.click(within(row).getByRole('button',{name:'重置密码'}));
  setPassword(screen.getByLabelText('新密码'), 'pw-seat-reset');
  await user.click(screen.getByRole('button',{name:'确认重置'}));
  expect(intents.at(-1)).toEqual({action:'reset',username:'seatui',password:'pw-seat-reset'});
  expect(document.body.innerHTML).not.toContain('pw-seat-reset');
  expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument();
  expect(within(row).queryByRole('button',{name:'确认停用'})).not.toBeInTheDocument();
  await user.click(within(row).getByRole('button',{name:'停用'}));
  const confirm=screen.getByRole('button',{name:'确认停用'});
  expect(confirm).toHaveClass('ant-btn-dangerous');
  expect(intents.some(intent=>intent.action==='disable')).toBe(false);
  await user.click(confirm);
  expect(intents.at(-1)).toEqual({action:'disable',username:'seatui'});
  expect(within(row).getByRole('cell',{name:/已停用/})).toBeInTheDocument();
 }finally{main.dispose();}
});

it('shows people headers before a scope is chosen and closing the dialogs does not save',async()=>{
 let view={signedIn:true,available:true,busy:false,validUntil:null,sources:[{selection:'scope-1',label:'合成范围'}],source:null as string|null,people:[],actions:[],grants:[],preview:null,pending:false,resultUnknown:false,notice:null};
 const commands:string[]=[];
 const intents:SeatAccountIntent[]=[];
 window.dashboardPermissions={current:async()=>({ok:true,view}),command:async c=>{commands.push(c.action);if(c.action==='source')view={...view,source:c.selection};return {ok:true,view};},onInvalidated:()=>()=>undefined};
 window.dashboardSeats={command:async intent=>{intents.push(intent);return intent.action==='list'?{ok:true,action:'list',seats:[]}:{ok:false,message:'未保存'};}};
 const user=userEvent.setup();
 render(<IntakePermissions canGrant active/>);
 const people=await screen.findByRole('table',{name:'人员'});
 for(const header of ['姓名','登录名','岗位','状态']) expect(within(people).getByRole('columnheader',{name:header})).toBeInTheDocument();
 expect(people).toHaveTextContent('请选择配置范围');
 expect(screen.getByRole('button',{name:'新增授权'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'停止等待'})).not.toBeInTheDocument();
 expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
 await pick(user,'配置范围','合成范围');
 expect(document.querySelector('select')).toBeNull();
 await user.click(screen.getByRole('button',{name:'新增授权'}));
 const grant=screen.getByRole('dialog',{name:'新增业务权限'});
 await user.click(within(grant).getByRole('button',{name:'关闭'}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 expect(commands).not.toContain('save');
 expect(commands).not.toContain('preview');
 await user.click(screen.getByRole('tab',{name:'外包坐席'}));
 const seatTable=await screen.findByRole('table',{name:'外包坐席'});
 for(const header of ['姓名','登录名','岗位','状态']) expect(within(seatTable).getByRole('columnheader',{name:header})).toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'新建坐席'}));
 const seat=screen.getByRole('dialog',{name:'新建坐席'});
 await user.type(within(seat).getByLabelText('姓名'),'不保存');
 setPassword(within(seat).getByLabelText('密码'), 'pw-left-behind');
 await user.click(within(seat).getByRole('button',{name:'关闭'}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 expect(document.body.innerHTML).not.toContain('pw-left-behind');
 expect(intents.every(intent=>intent.action==='list')).toBe(true);
 await user.click(screen.getByRole('button',{name:'新建坐席'}));
 const again=screen.getByRole('dialog',{name:'新建坐席'});
 fireEvent.change(within(again).getByLabelText('姓名'),{target:{value:'另一人'}});
 fireEvent.change(within(again).getByLabelText('登录名'),{target:{value:'other'}});
 expect(within(again).getByRole('button',{name:'保存坐席'})).toBeDisabled();
 expect(document.body.innerHTML).not.toContain('pw-left-behind');
});

it('keeps an unsaved permission preview open when discard fails',async()=>{
 const preview={person:'甲',actions:['query' as const],scope:'合成范围',startsAt:'2026-10-08T02:00:00.000Z',expiresAt:'2026-10-09T02:00:00.000Z',reason:'试用'};
 const view={signedIn:true,available:true,busy:false,validUntil:null,sources:[{selection:'scope-1',label:'合成范围'}],source:'scope-1',people:[],actions:['query' as const],grants:[],preview,pending:false,resultUnknown:false,notice:null};
 const commands:string[]=[];
 window.dashboardPermissions={current:async()=>({ok:true,view}),command:async c=>{commands.push(c.action);if(c.action==='discard')return {ok:false,message:'这次没有放弃预览。',view};return {ok:true,view};},onInvalidated:()=>()=>undefined};
 const user=userEvent.setup();
 render(<IntakePermissions canGrant active/>);
 await user.click(await screen.findByRole('button',{name:'新增授权'}));
 const dialog=screen.getByRole('dialog',{name:'预览，尚未保存'});
 await user.click(within(dialog).getByRole('button',{name:'关闭'}));
 expect(commands).toContain('discard');
 expect(commands).not.toContain('save');
 expect(screen.getByRole('dialog',{name:'预览，尚未保存'})).toHaveTextContent('这次没有放弃预览。');
});

it('hides 新增授权 when the server publish bit is false', async () => {
  const view = { signedIn: true, available: true, busy: false, validUntil: null, sources: [{ selection: 'scope-1', label: '合成范围' }], source: 'scope-1', people: [], actions: ['query' as const], grants: [], preview: null, pending: false, resultUnknown: false, notice: null };
  window.dashboardPermissions = { current: async () => ({ ok: true, view }), command: async () => ({ ok: true, view }), onInvalidated: () => () => undefined };
  render(<IntakePermissions canGrant={false} grantBlock="没有权限，请找人开通。" active />);
  expect(await screen.findByRole('status')).toHaveTextContent('没有权限，请找人开通。');
  expect(screen.queryByRole('button', { name: '新增授权' })).toBeNull();
});

it('names the missing ability and the role to ask, and still hides the grant button', async () => {
  const view = { signedIn: true, available: true, busy: false, validUntil: null, sources: [{ selection: 'scope-1', label: '合成范围' }], source: 'scope-1', people: [], actions: ['query' as const], grants: [], preview: null, pending: false, resultUnknown: false, notice: null };
  window.dashboardPermissions = { current: async () => ({ ok: true, view }), command: async () => ({ ok: true, view }), onInvalidated: () => () => undefined };
  render(<IntakePermissions canGrant={false} grantAccess={{ need: '给他人开通权限', ask: '你的经理' }} active />);
  const block = await screen.findByTestId('workbench-no-access');
  expect(block).toHaveTextContent('你还不能给他人开通权限');
  expect(block).toHaveTextContent('请联系你的经理开通。');
  expect(screen.queryByRole('button', { name: '新增授权' })).toBeNull();
  // The block is shown on the grant tab only; the seat tab has its own controls.
  await userEvent.setup().click(screen.getByRole('tab', { name: '外包坐席' }));
  expect(screen.queryByTestId('workbench-no-access')).toBeNull();
});

it('does not say the read window expired when no countdown is running',async()=>{
 const view={signedIn:true,available:false,busy:false,validUntil:null,sources:[],source:null,people:[],actions:[],grants:[],preview:null,pending:false,resultUnknown:false,notice:null};
 window.dashboardPermissions={current:async()=>({ok:true,view}),command:async()=>({ok:true,view}),onInvalidated:()=>()=>undefined};
 render(<IntakePermissions canGrant active/>);
 expect(await screen.findByText('请刷新权限列表。')).toBeInTheDocument();
 expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'停止等待'})).not.toBeInTheDocument();
});
