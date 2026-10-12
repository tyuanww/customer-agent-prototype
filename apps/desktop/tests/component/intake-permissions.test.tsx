import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render,screen,fireEvent,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,expect,it,vi } from 'vitest';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import type { IntakePermissionCommand } from '../../src/shared/content-intake-permissions';
import { actionsForIntakePost } from '../../src/shared/intake-post-actions';
import { IntakePermissions } from '../../src/renderer/features/dashboard/IntakePermissions';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';
const PAGE = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/features/dashboard/IntakePermissions.tsx');
afterEach(()=>{delete window.dashboardPermissions;vi.unstubAllEnvs();});
it('selects a post, previews that post through the existing command, then saves and revokes',async()=>{
 vi.stubEnv('TZ','Asia/Shanghai');
 const supervisor=actionsForIntakePost('客服主管'),agent=actionsForIntakePost('客服');
 expect(supervisor.ok).toBe(true);expect(agent.ok).toBe(true);
 if(!supervisor.ok || !agent.ok) return;
 const f=intakePermissionsData([...supervisor.actions,...agent.actions]),main=new ContentIntakePermissions(f.session),user=userEvent.setup();
 const commands:IntakePermissionCommand[]=[];
 window.dashboardPermissions={current:async()=>({ok:true,view:main.view()}),command:async c=>{commands.push(c);return {ok:true,view:await main.command(c)};},onInvalidated:fn=>main.subscribe(fn)};
 try{render(<IntakePermissions active/>);await screen.findByRole('option',{name:'合成坐席'});
  const people=screen.getByRole('table',{name:'人员'});
  for(const header of ['姓名','登录名','岗位','状态']) expect(within(people).getByRole('columnheader',{name:header})).toBeInTheDocument();
  expect(within(within(people).getByRole('row',{name:/合成坐席/})).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['合成坐席','—','—','未授权']);
  expect(people).not.toHaveTextContent('registered-agent');
  expect(screen.getByRole('combobox',{name:'岗位'})).toHaveValue('客服');
  const page=readFileSync(PAGE,'utf8');
  expect(page).toContain('actionsForIntakePost');
  expect(page).not.toContain('content-manage');
  expect(page).not.toContain('source-confirm');
  expect(page).not.toContain('password-accounts');
  await user.selectOptions(screen.getByRole('combobox',{name:'人员'}),main.view().people[0]!.selection);
  await user.selectOptions(screen.getByRole('combobox',{name:'岗位'}),'客服主管');
  fireEvent.change(screen.getByLabelText('生效时间'),{target:{value:'2026-10-08T10:00'}});fireEvent.change(screen.getByLabelText('失效时间'),{target:{value:'2026-10-09T10:00'}});
  await user.type(screen.getByRole('textbox',{name:'授权原因'}),'合成任务');await user.click(screen.getByRole('button',{name:'预览权限'}));
  await screen.findByText('预览 · 尚未保存');expect(f.grants).toHaveLength(0);
  expect(f.requests.filter(request=>request.path==='/v1/intake/grants/preview').map(request=>(request.body as {items:{action:string}[]}).items.map(item=>item.action))).toEqual([[...supervisor.actions]]);
  expect(f.requests.some(request=>request.path.includes('password') || request.path.includes('account'))).toBe(false);
  await user.click(screen.getByRole('button',{name:'返回修改'}));
  await user.selectOptions(screen.getByRole('combobox',{name:'岗位'}),'客服');
  await user.click(screen.getByRole('button',{name:'预览权限'}));
  await screen.findByText('预览 · 尚未保存');expect(f.grants).toHaveLength(0);
  const displayedPeriod='2026年10月08日 10:00:00（UTC+08:00） 至 2026年10月09日 10:00:00（UTC+08:00）';
  expect(screen.getByRole('region',{name:'权限预览'})).toHaveTextContent(displayedPeriod);
  expect(f.requests.filter(request=>request.path==='/v1/intake/grants/preview').at(-1)).toMatchObject({body:{items:[{
   startsAt:'2026-10-08T02:00:00.000Z',expiresAt:'2026-10-09T02:00:00.000Z',action:agent.actions[0],
  }]}});
  await user.click(screen.getByRole('button',{name:'确认保存权限'}));
  await screen.findByText(/本次操作已保存/);await user.click(screen.getByRole('button',{name:'刷新权限列表'}));
  expect(within(within(screen.getByRole('table',{name:'人员'})).getByRole('row',{name:/合成坐席/})).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['合成坐席','—','客服','已授权']);
  expect(within(screen.getByRole('region',{name:'已有业务权限'})).getByRole('article')).toHaveTextContent(displayedPeriod);
  await user.click(await screen.findByRole('button',{name:'撤销该权限'}));await user.type(screen.getByRole('textbox',{name:'撤销原因'}),'合成撤销');
  await user.click(screen.getByRole('button',{name:'确认撤销'}));await waitFor(()=>expect(f.grants[0]!.revokedAt).not.toBeNull());
  expect(commands.some(command=>command.action==='save')).toBe(true);
  expect(commands.some(command=>command.action==='revoke')).toBe(true);
  expect(commands.every(command=>['refresh','save','retry','discard','stop','source','preview','revoke'].includes(command.action))).toBe(true);
  expect(commands.filter(command=>command.action==='preview').map(command=>command.action==='preview'?[...command.actions]:[])).toEqual([[...supervisor.actions],[...agent.actions]]);
 }finally{main.dispose();}
});
it('does not offer a post the current scope cannot grant',async()=>{
 const main=new ContentIntakePermissions(intakePermissionsData().session);
 window.dashboardPermissions={current:async()=>({ok:true,view:main.view()}),command:async c=>({ok:true,view:await main.command(c)}),onInvalidated:fn=>main.subscribe(fn)};
 try{render(<IntakePermissions active/>);await screen.findByRole('option',{name:'合成坐席'});
  const post=screen.getByRole('combobox',{name:'岗位'});
  expect(within(post).getAllByRole('option').map(option=>option.textContent)).toEqual(['客服']);
  expect(post).toHaveValue('客服');
 }finally{main.dispose();}
});
