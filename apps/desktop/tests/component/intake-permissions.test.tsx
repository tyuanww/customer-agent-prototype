import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act,render,screen,fireEvent,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,expect,it,vi } from 'vitest';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import type { IntakePermissionCommand, IntakePermissionReply, IntakePermissionView } from '../../src/shared/content-intake-permissions';
import { actionsForIntakePost } from '../../src/shared/intake-post-actions';
import type { SeatAccountIntent, SeatAccountRecord } from '../../src/shared/seat-account-intent';
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
afterEach(()=>{delete window.dashboardPermissions;delete window.dashboardSeats;vi.unstubAllEnvs();vi.useRealTimers();});
it('selects a post, previews that post through the existing command, then saves and revokes',async()=>{
 vi.stubEnv('TZ','Asia/Shanghai');
 const supervisor=actionsForIntakePost('客服主管'),agent=actionsForIntakePost('客服');
 expect(supervisor.ok).toBe(true);expect(agent.ok).toBe(true);
 if(!supervisor.ok || !agent.ok) return;
 const f=intakePermissionsData([...supervisor.actions,...agent.actions]),main=new ContentIntakePermissions(f.session),user=userEvent.setup();
 const commands:IntakePermissionCommand[]=[];
 window.dashboardPermissions={current:async()=>({ok:true,view:main.view()}),command:async c=>{commands.push(c);return {ok:true,view:await main.command(c)};},onInvalidated:fn=>main.subscribe(fn)};
 try{render(<IntakePermissions canGrant active/>);await screen.findAllByRole('row',{name:/合成坐席/});
  const people=screen.getByRole('table',{name:'成员权限'});
  for(const header of ['成员','具备能力','当前状态','操作']) expect(within(people).getByRole('columnheader',{name:header})).toBeInTheDocument();
  expect(within(within(people).getByRole('row',{name:/合成坐席/})).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['合成坐席','—','未授权','查看权限']);
  expect(people).not.toHaveTextContent('registered-agent');
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(screen.queryByRole('table',{name:'权限明细'})).not.toBeInTheDocument();
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
  await pick(user,'成员','合成坐席');
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
  expect(within(within(screen.getByRole('table',{name:'成员权限'})).getByRole('row',{name:/合成坐席/})).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['合成坐席','—','已过期 1 项','查看权限']);
  await user.click(screen.getByRole('button',{name:'查看权限'}));
  const grantRow=within(screen.getByRole('table',{name:'权限明细'})).getByRole('row',{name:/查询复制/});
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
  expect(confirmRevoke).toBeEnabled();
  await user.click(confirmRevoke);
  // rc-util's test build reuses test-id for Drawer and Modal titles; locate the visible confirmation title.
  const revokeDialog=(await screen.findByText('收回 合成坐席 在 该店铺 / 产品 / 该来源的查询复制')).closest<HTMLElement>('[role="dialog"]')!;
  expect(revokeDialog).toHaveTextContent('仅撤销这条权限。撤销后如需使用，须重新授权。');
  const revokeCancel=within(revokeDialog).getByRole('button',{name:'取消'});
  const revokeCommit=within(revokeDialog).getByRole('button',{name:'确认收回'});
  expect(revokeCommit).toHaveClass('ant-btn-dangerous');
  await waitFor(()=>expect(revokeCancel).toHaveFocus());
  expect(commands.some(command=>command.action==='revoke')).toBe(false);
  await user.click(revokeCancel);
  expect(commands.some(command=>command.action==='revoke')).toBe(false);
  expect(screen.getByRole('textbox',{name:'撤销原因'})).toHaveValue('合成撤销');
  await user.click(screen.getByRole('button',{name:'确认撤销'}));
  await user.click(await screen.findByRole('button',{name:'确认收回'}));
  await waitFor(()=>expect(f.grants[0]!.revokedAt).not.toBeNull());
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
  fireEvent.click(screen.getByRole('tab',{name:'账号管理'}));
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
 const seats:SeatAccountRecord[]=[{displayName:'已有坐席',username:'seatkept',post:'客服主管',enabled:true}];
 window.dashboardPermissions={current:async()=>({ok:true,view:main.view()}),command:async c=>({ok:true,view:await main.command(c)}),onInvalidated:fn=>main.subscribe(fn)};
 window.dashboardSeats={command:async intent=>{intents.push(structuredClone(intent));
  if(intent.action==='list')return {ok:true,action:'list',seats:seats.map(seat=>({...seat}))};
  if(intent.action==='create'){const seat={displayName:intent.displayName,username:intent.username,post:intent.post,enabled:true};seats.push(seat);return {ok:true,action:'create',seat};}
  if(intent.action==='reset')return {ok:true,action:'reset',username:intent.username};
  const row=seats.find(seat=>seat.username===intent.username); if(row) row.enabled=false;
  return {ok:true,action:'disable',username:intent.username};}};
 const login=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'../../src/renderer/LoginApp.tsx'),'utf8');
 const page=readFileSync(PAGE,'utf8');
 try{render(<IntakePermissions canGrant active/>);await screen.findAllByRole('row',{name:/合成坐席/});
  await user.click(screen.getByRole('tab',{name:'账号管理'}));
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
  const kept=await within(screen.getByRole('table',{name:'账号管理'})).findByRole('row',{name:/seatkept/});
  expect(within(kept).getByRole('cell',{name:'客服主管'})).toBeInTheDocument();
  expect(intents[0]).toEqual({action:'list'});
  await user.type(within(form).getByLabelText('姓名'),'外包甲');
  await user.type(within(form).getByLabelText('登录名'),'seatui');
  setPassword(within(form).getByLabelText('密码'), 'pw-seat-ui');
  await user.click(within(form).getByRole('button',{name:'保存坐席'}));
  const table=screen.getByRole('table',{name:'账号管理'});
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
  expect(intents.some(intent=>intent.action==='disable'&&'username' in intent&&intent.username==='seatui')).toBe(true);
  expect(within(row).getByRole('cell',{name:/已停用/})).toBeInTheDocument();
 }finally{main.dispose();}
});

it('shows member headers before a scope is chosen and closing the dialogs does not save',async()=>{
 let view={signedIn:true,available:true,busy:false,validUntil:null,sources:[{selection:'scope-1',label:'合成范围'}],source:null as string|null,people:[],actions:[],grants:[],preview:null,pending:false,resultUnknown:false,notice:null};
 const commands:string[]=[];
 const intents:SeatAccountIntent[]=[];
 window.dashboardPermissions={current:async()=>({ok:true,view}),command:async c=>{commands.push(c.action);if(c.action==='source')view={...view,source:c.selection};return {ok:true,view};},onInvalidated:()=>()=>undefined};
 window.dashboardSeats={command:async intent=>{intents.push(intent);return intent.action==='list'?{ok:true,action:'list',seats:[]}:{ok:false,message:'未保存'};}};
 const user=userEvent.setup();
 render(<IntakePermissions canGrant active/>);
 const people=await screen.findByRole('table',{name:'成员权限'});
 for(const header of ['成员','具备能力','当前状态','操作']) expect(within(people).getByRole('columnheader',{name:header})).toBeInTheDocument();
 expect(people).toHaveTextContent('请选择配置范围');
 expect(screen.getByRole('button',{name:'新增授权'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'停止等待'})).not.toBeInTheDocument();
 expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
 await pick(user,'配置范围','合成范围');
 expect(document.querySelector('select')).toBeNull();
 await user.click(screen.getByRole('button',{name:'新增授权'}));
 const grant=screen.getByRole('dialog',{name:'新增授权'});
 await user.click(within(grant).getByRole('button',{name:'关闭'}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 expect(commands).not.toContain('save');
 expect(commands).not.toContain('preview');
 await user.click(screen.getByRole('tab',{name:'账号管理'}));
 const seatTable=await screen.findByRole('table',{name:'账号管理'});
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
  expect(await screen.findByText('没有权限，请找人开通。')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('没有权限，请找人开通。');
  expect(screen.queryByRole('button', { name: '新增授权' })).toBeNull();
});

it('shows the fixed denial when grant is missing, and still hides the grant button', async () => {
  const view = { signedIn: true, available: true, busy: false, validUntil: null, sources: [{ selection: 'scope-1', label: '合成范围' }], source: 'scope-1', people: [], actions: ['query' as const], grants: [], preview: null, pending: false, resultUnknown: false, notice: null };
  window.dashboardPermissions = { current: async () => ({ ok: true, view }), command: async () => ({ ok: true, view }), onInvalidated: () => () => undefined };
  render(<IntakePermissions canGrant={false} grantAccess={{ need: '给他人开通权限', detail: '没有权限，请找人开通。' }} active />);
  const block = await screen.findByTestId('workbench-no-access');
  expect(block).toHaveTextContent('你还不能给他人开通权限');
  expect(block).toHaveTextContent('没有权限，请找人开通。');
  expect(screen.queryByRole('button', { name: '新增授权' })).toBeNull();
  await userEvent.setup().click(screen.getByRole('tab', { name: '账号管理' }));
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

function permissionView(patch: Partial<IntakePermissionView> = {}): IntakePermissionView {
  return {
    signedIn: true, available: true, busy: false, validUntil: null,
    sources: [{ selection: 'scope-1', label: '合成范围' }], source: 'scope-1' as string | null,
    people: [], actions: ['query' as const], grants: [], preview: null,
    pending: false, resultUnknown: false, notice: null,
    ...patch,
  };
}

it('shows a loading skeleton before the permission read resolves', async () => {
  let release: (value: { ok: true; view: ReturnType<typeof permissionView> }) => void = () => undefined;
  const view = permissionView();
  window.dashboardPermissions = {
    current: async () => ({ ok: true, view }),
    command: () => new Promise(resolve => { release = resolve; }),
    onInvalidated: () => () => undefined,
  };
  render(<IntakePermissions canGrant active />);
  expect(screen.getByLabelText('正在读取权限')).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: '成员权限' })).not.toBeInTheDocument();
  release({ ok: true, view });
  expect(await screen.findByRole('table', { name: '成员权限' })).toBeInTheDocument();
  expect(screen.queryByLabelText('正在读取权限')).not.toBeInTheDocument();
});

it('keeps the existing sentence when the permissions API is missing', async () => {
  render(<IntakePermissions active />);
  expect(await screen.findByRole('alert')).toHaveTextContent('资料还不能在这里改。请把表交给客服经理。');
  expect(screen.queryByText('请先登录。')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('正在读取权限')).not.toBeInTheDocument();
});

it('keeps the existing sentence when a permission read throws', async () => {
  window.dashboardPermissions = {
    current: async () => { throw new Error('down'); },
    command: async () => { throw new Error('down'); },
    onInvalidated: () => () => undefined,
  };
  render(<IntakePermissions active />);
  expect(await screen.findByRole('alert')).toHaveTextContent('权限配置暂不可用，请重新读取。');
  expect(screen.queryByText('请先登录。')).not.toBeInTheDocument();
});

it('shows the reply sentence when a permission read fails without a view', async () => {
  window.dashboardPermissions = {
    current: async () => ({ ok: false, message: '权限、人员状态或输入已变化，请刷新后核对。', view: null }),
    command: async () => ({ ok: false, message: '权限、人员状态或输入已变化，请刷新后核对。', view: null }),
    onInvalidated: () => () => undefined,
  };
  render(<IntakePermissions active />);
  expect(await screen.findByRole('alert')).toHaveTextContent('权限、人员状态或输入已变化，请刷新后核对。');
  expect(screen.queryByText('权限配置暂不可用，请重新读取。')).not.toBeInTheDocument();
});

it('shows 请先登录。 for a signed-out permission view', async () => {
  const view = permissionView({ signedIn: false, available: false, sources: [], source: null, actions: [] });
  window.dashboardPermissions = {
    current: async () => ({ ok: true, view }),
    command: async () => ({ ok: true, view }),
    onInvalidated: () => () => undefined,
  };
  render(<IntakePermissions active />);
  expect(await screen.findByText('请先登录。')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('shows 请先登录。 without a loading flash while the next read is in flight', async () => {
  let release: (value: { ok: false; message: string; view: null }) => void = () => undefined;
  let calls = 0;
  window.dashboardPermissions = {
    current: async () => ({ ok: false, message: '请先登录。', view: null }),
    command: () => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ ok: false, message: '请先登录。', view: null });
      return new Promise(resolve => { release = resolve; });
    },
    onInvalidated: () => () => undefined,
  };
  render(<IntakePermissions active />);
  expect(await screen.findByText('请先登录。')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '刷新权限列表' }));
  expect(screen.getByText('请先登录。')).toBeInTheDocument();
  expect(screen.queryByLabelText('正在读取权限')).not.toBeInTheDocument();
  release({ ok: false, message: '请先登录。', view: null });
  expect(await screen.findByText('请先登录。')).toBeInTheDocument();
  expect(screen.queryByLabelText('正在读取权限')).not.toBeInTheDocument();
});

it('does not read again or close an unsaved preview when the page is left and opened', async () => {
  const preview = { person: '甲', actions: ['query' as const], scope: '合成范围', startsAt: '2026-10-08T02:00:00.000Z', expiresAt: '2026-10-09T02:00:00.000Z', reason: '试用' };
  const view = permissionView({ preview });
  const commands: string[] = [];
  window.dashboardPermissions = {
    current: async () => ({ ok: true, view }),
    command: async (command) => { commands.push(command.action); return { ok: true, view }; },
    onInvalidated: () => () => undefined,
  };
  const user = userEvent.setup();
  const { rerender } = render(<IntakePermissions canGrant active={false} />);
  expect(commands).toEqual([]);
  rerender(<IntakePermissions canGrant active />);
  await user.click(await screen.findByRole('button', { name: '新增授权' }));
  expect(screen.getByRole('dialog', { name: '预览，尚未保存' })).toBeInTheDocument();
  expect(commands).toEqual(['refresh']);
  rerender(<IntakePermissions canGrant active={false} />);
  rerender(<IntakePermissions canGrant active />);
  expect(screen.getByRole('dialog', { name: '预览，尚未保存' })).toBeInTheDocument();
  expect(commands).toEqual(['refresh']);
});

it('shows a revoked grant as closed and does not offer a way to restore it', async () => {
  const f = intakePermissionsData();
  f.grants.push({
    grantId: 'revoked-business',
    version: 2,
    kind: 'business',
    issuerPrincipalId: 'registered-director',
    recipientPrincipalId: f.person.principalId,
    action: 'query',
    scope: f.scope,
    startsAt: '2026-10-08T02:00:00.000Z',
    expiresAt: '2099-10-09T02:00:00.000Z',
    revokedAt: '2026-10-08T03:00:00.000Z',
    stewardPrincipalId: null,
    reason: '合成授予',
    mayRedelegate: false,
    lastChangeReason: '合成撤销',
  });
  const main = new ContentIntakePermissions(f.session);
  const commands: IntakePermissionCommand[] = [];
  window.dashboardPermissions = {
    current: async () => ({ ok: true, view: main.view() }),
    command: async (command) => {
      commands.push(command);
      return { ok: true, view: await main.command(command) };
    },
    onInvalidated: (fn) => main.subscribe(fn),
  };
  try {
    render(<IntakePermissions canGrant active />);
    await userEvent.click(await screen.findByRole('button', { name: '查看权限' }));
    const grants = await screen.findByRole('table', { name: '权限明细' });
    expect(grants).toHaveTextContent('已撤销');
    expect(grants).not.toHaveTextContent('已过期');
    expect(within(grants).queryByRole('button', { name: '撤销该权限' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /恢复|重新开通/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '撤销原因' })).not.toBeInTheDocument();
    expect(commands.map((command) => command.action)).toEqual(['refresh']);
    expect(f.grants[0]!.revokedAt).toBe('2026-10-08T03:00:00.000Z');
  } finally {
    main.dispose();
  }
});

function permissionGrant(patch: Partial<IntakePermissionView['grants'][number]> = {}): IntakePermissionView['grants'][number] {
  return {
    selection: 'grant-one', reference: 'record-one', person: '合成成员', personSelection: 'person-one',
    action: 'query', scope: '合成店铺 / 产品 / 来源甲',
    startsAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    reason: '合成授权原因', revoked: false, canRevoke: true, ...patch,
  };
}

function showPermissionView(view: IntakePermissionView) {
  const command = vi.fn(async (_command: IntakePermissionCommand): Promise<IntakePermissionReply> => ({ ok: true, view }));
  window.dashboardPermissions = { current: async () => ({ ok: true, view }), command, onInvalidated: () => () => undefined };
  render(<IntakePermissions canGrant active />);
  return command;
}

it('groups only by exact nonempty person selection, preserving same names and every unresolved grant', async () => {
  const grants = [
    permissionGrant(),
    permissionGrant({ selection: 'grant-two', reference: 'record-two', action: 'import', reason: '只在详情按需显示的原因' }),
    permissionGrant({ selection: 'grant-three', reference: 'record-three', personSelection: 'person-two', action: 'publish' }),
    permissionGrant({ selection: 'grant-four', reference: 'record-four', personSelection: 'person-one ', person: '另一标识' }),
    ...[null, null, '', ' '].map((personSelection, index) => permissionGrant({
      selection: `unknown-${index}`, reference: `unknown-ref-${index}`, person: '当前姓名不可用', personSelection,
    })),
  ];
  const view = permissionView({
    people: [{ selection: 'person-one', label: '同名成员' }, { selection: 'person-two', label: '同名成员' }, { selection: 'no-grants', label: '待授权成员' }],
    grants,
  });
  const original = structuredClone(view);
  const command = showPermissionView(view);
  const user = userEvent.setup();
  const table = await screen.findByRole('table', { name: '成员权限' });
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(within(table).getAllByRole('button', { name: '查看权限' })).toHaveLength(8);
  const named = within(table).getAllByRole('row', { name: /同名成员/ });
  expect(named).toHaveLength(2);
  expect(named[0]).toHaveTextContent('查询复制、上传资料');
  expect(named[0]).toHaveTextContent('有效 2 项');
  expect(named[1]).toHaveTextContent('发布资料');
  expect(within(table).getByRole('row', { name: /待授权成员/ })).toHaveTextContent('未授权');
  expect(table).not.toHaveTextContent('只在详情按需显示的原因');
  expect(table).not.toHaveTextContent('离职');
  await user.click(within(named[0]!).getByRole('button', { name: '查看权限' }));
  const detail = screen.getByRole('table', { name: '权限明细' });
  expect(within(detail).getAllByRole('button', { name: '撤销该权限' })).toHaveLength(2);
  expect(detail).not.toHaveTextContent('record-three');
  expect(screen.getByText('只在详情按需显示的原因')).not.toBeVisible();
  await user.click(within(detail).getByRole('row', { name: /record-two/ }).querySelector('summary')!);
  expect(screen.getByText('只在详情按需显示的原因')).toBeVisible();
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const unresolved = within(table).getAllByRole('row', { name: /当前姓名不可用/ });
  expect(unresolved).toHaveLength(4);
  for (const [index, row] of unresolved.entries()) {
    expect(row).toHaveTextContent(`unknown-ref-${index}`);
    expect(row).toHaveTextContent('有效 1 项');
    await user.click(within(row).getByRole('button', { name: '查看权限' }));
    const single = screen.getByRole('table', { name: '权限明细' });
    expect(within(single).getAllByRole('button', { name: '撤销该权限' })).toHaveLength(1);
    expect(single).toHaveTextContent(`unknown-ref-${index}`);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }
  expect(view).toEqual(original);
  expect(command.mock.calls.map(([intent]) => intent.action)).toEqual(['refresh']);
});

it('shows actual per-grant periods and states without counting future or historical capabilities as current', async () => {
  const now = Date.now();
  const future = new Date(now + 86_400_000).toISOString();
  const grants = [
    permissionGrant({ reference: 'effective', startsAt: new Date(now).toISOString(), canRevoke: false }),
    permissionGrant({ selection: 'future', reference: 'future', action: 'import', startsAt: future, expiresAt: new Date(now + 172_800_000).toISOString() }),
    permissionGrant({ selection: 'expired', reference: 'expired', action: 'publish', expiresAt: new Date(now).toISOString() }),
    permissionGrant({ selection: 'revoked', reference: 'revoked', action: 'rollback', revoked: true, startsAt: future }),
    permissionGrant({ selection: 'invalid', reference: 'invalid', action: 'review', startsAt: 'not-a-date' }),
  ];
  showPermissionView(permissionView({ grants, validUntil: new Date(now + 30_000).toISOString() }));
  const user = userEvent.setup();
  const row = await screen.findByRole('row', { name: /合成成员/ });
  expect(within(row).getAllByRole('cell')[1]).toHaveTextContent(/^查询复制$/);
  for (const state of ['有效', '未生效', '已过期', '已撤销', '时间待确认']) expect(row).toHaveTextContent(`${state} 1 项`);
  await user.click(within(row).getByRole('button', { name: '查看权限' }));
  const table = screen.getByRole('table', { name: '权限明细' });
  const expected = [['effective', '有效'], ['future', '未生效'], ['expired', '已过期'], ['revoked', '已撤销'], ['invalid', '时间待确认']];
  for (const [reference, state] of expected) {
    const grantRow = within(table).getByRole('row', { name: new RegExp(reference!) });
    expect(within(grantRow).getByRole('cell', { name: state })).toBeInTheDocument();
  }
  expect(within(within(table).getByRole('row', { name: /effective/ })).getByRole('button', { name: '撤销该权限' })).toBeDisabled();
  expect(within(within(table).getByRole('row', { name: /expired/ })).getByRole('button', { name: '撤销该权限' })).toBeEnabled();
  expect(within(within(table).getByRole('row', { name: /revoked/ })).queryByRole('button')).not.toBeInTheDocument();
  const period = within(within(table).getByRole('row', { name: /future/ })).getAllByRole('cell')[1]!;
  const format = (iso: string) => new Date(iso).toLocaleString('sv-SE').slice(0, 16);
  expect(period).toHaveTextContent(`${format(future)} 至 ${format(grants[1]!.expiresAt)}`);
  expect(period).not.toHaveTextContent(format(new Date(now + 30_000).toISOString()));
});

it('updates future and expired states at their actual boundaries without refetching or granting', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T02:00:00.000Z'));
  const now = Date.now();
  const command = showPermissionView(permissionView({ grants: [permissionGrant({ startsAt: new Date(now + 1000).toISOString(), expiresAt: new Date(now + 2000).toISOString() })] }));
  await act(async () => {});
  let row = screen.getByRole('row', { name: /合成成员/ });
  expect(row).toHaveTextContent('未生效 1 项');
  expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('—');
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  row = screen.getByRole('row', { name: /合成成员/ });
  expect(row).toHaveTextContent('有效 1 项');
  expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('查询复制');
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  row = screen.getByRole('row', { name: /合成成员/ });
  expect(row).toHaveTextContent('已过期 1 项');
  expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('—');
  expect(command.mock.calls.map(([intent]) => intent.action)).toEqual(['refresh']);
});

it.each([null, 'person-one'])('revokes only the chosen grant for grouping key %s, keeps one flight, and recovers the original operation after stopping', async (personSelection) => {
  const grants = [0, 1].map(index => permissionGrant({ selection: `grant-${index}`, reference: `reference-${index}`, personSelection, person: personSelection ? '同一成员' : '当前姓名不可用' }));
  let view = permissionView({ grants });
  let finishRevoke: (reply: IntakePermissionReply) => void = () => undefined;
  const command = vi.fn(async (intent: IntakePermissionCommand): Promise<IntakePermissionReply> => {
    if (intent.action === 'revoke') return new Promise(resolve => { finishRevoke = resolve; });
    if (intent.action === 'stop') view = { ...view, pending: true, resultUnknown: true };
    if (intent.action === 'retry') view = { ...view, pending: false, resultUnknown: false, grants: [grants[0]!, { ...grants[1]!, revoked: true, canRevoke: false }] };
    return { ok: true, view };
  });
  window.dashboardPermissions = { current: async () => ({ ok: true, view }), command, onInvalidated: () => () => undefined };
  render(<IntakePermissions canGrant active />);
  const user = userEvent.setup();
  const chosen = await screen.findByRole('row', { name: personSelection ? /同一成员/ : /reference-1/ });
  await user.click(within(chosen).getByRole('button', { name: '查看权限' }));
  const chosenGrant = within(screen.getByRole('table', { name: '权限明细' })).getByRole('row', { name: /reference-1/ });
  await user.click(within(chosenGrant).getByRole('button', { name: '撤销该权限' }));
  await user.type(screen.getByRole('textbox', { name: '撤销原因' }), '仅收回这一条');
  await user.click(screen.getByRole('button', { name: '确认撤销' }));
  const confirm = screen.getByRole('button', { name: '确认收回' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(command.mock.calls.filter(([intent]) => intent.action === 'revoke')).toEqual([[{ action: 'revoke', selection: 'grant-1', reason: '仅收回这一条' }]]);
  expect(within(chosenGrant).getByRole('button', { name: '撤销该权限' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '新增授权' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '刷新权限列表' })).toBeDisabled();
  const detail = screen.getByRole('dialog');
  await user.click(within(detail).getByRole('button', { name: '停止等待' }));
  expect(within(detail).getByText(/权限操作结果待确认/)).toBeInTheDocument();
  await act(async () => { finishRevoke({ ok: true, view: permissionView() }); });
  expect(screen.getByText(/权限操作结果待确认/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新增授权' })).toBeDisabled();
  await user.click(within(detail).getByRole('button', { name: '按原请求确认结果' }));
  expect(command.mock.calls.map(([intent]) => intent.action)).toEqual(['refresh', 'revoke', 'stop', 'retry']);
  await user.click(within(detail).getByRole('button', { name: '关闭' }));
  const members = screen.getByRole('table', { name: '成员权限' });
  expect(within(members).getByRole('row', { name: personSelection ? /同一成员/ : /reference-0/ })).toHaveTextContent('有效 1 项');
  expect(within(members).getByRole('row', { name: personSelection ? /同一成员/ : /reference-1/ })).toHaveTextContent('已撤销 1 项');
});

it('clears the member detail and revoke confirmation at the read deadline even while refresh is unresolved', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T02:00:00.000Z'));
  const view = permissionView({ validUntil: new Date(Date.now() + 1000).toISOString(), grants: [permissionGrant()] });
  let finishRead: (reply: IntakePermissionReply) => void = () => undefined;
  window.dashboardPermissions = {
    current: vi.fn(() => new Promise<IntakePermissionReply>(resolve => { finishRead = resolve; })),
    command: async () => ({ ok: true, view }),
    onInvalidated: () => () => undefined,
  };
  render(<IntakePermissions canGrant active />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '查看权限' }));
  fireEvent.click(screen.getByRole('button', { name: '撤销该权限' }));
  fireEvent.change(screen.getByRole('textbox', { name: '撤销原因' }), { target: { value: '合成收回' } });
  fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText('合成授权原因')).not.toBeInTheDocument();
  expect(screen.getByText('登录状态需要确认。请刷新权限列表。')).toBeInTheDocument();
  await act(async () => { finishRead({ ok: true, view }); });
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('keeps original-request recovery available when no permission list is readable', async () => {
  const command = showPermissionView(permissionView({ available: false, source: null, pending: true, resultUnknown: true }));
  const recovery = await screen.findByRole('button', { name: '按原请求确认结果' });
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新权限列表' })).toBeDisabled();
  await userEvent.click(recovery);
  expect(command.mock.calls.map(([intent]) => intent.action)).toEqual(['refresh', 'retry']);
});

it('uses the supplied server gate and clears details when that view is replaced', async () => {
  const view = permissionView({ grants: [permissionGrant()] });
  window.dashboardPermissions = { current: async () => ({ ok: true, view }), command: async () => ({ ok: true, view }), onInvalidated: () => () => undefined };
  const { rerender } = render(<IntakePermissions active canGrant={false} gate={{ state: 'open', body: view }} />);
  await userEvent.click(screen.getByRole('button', { name: '查看权限' }));
  expect(screen.getByRole('table', { name: '权限明细' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新增授权' })).toBeEnabled();
  rerender(<IntakePermissions active canGrant={false} gate={{ state: 'open', body: permissionView({ signedIn: false, available: false, source: null }) }} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新增授权' })).not.toBeInTheDocument();
});
