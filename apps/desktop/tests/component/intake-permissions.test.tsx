import { render,screen,fireEvent,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,expect,it,vi } from 'vitest';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import { IntakePermissions } from '../../src/renderer/features/dashboard/IntakePermissions';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';
afterEach(()=>{delete window.dashboardPermissions;vi.unstubAllEnvs();});
it('selects name, previews without saving, saves then explicitly revokes from refreshed list',async()=>{
 vi.stubEnv('TZ','Asia/Shanghai');
 const f=intakePermissionsData(),main=new ContentIntakePermissions(f.session),user=userEvent.setup();
 window.dashboardPermissions={current:async()=>({ok:true,view:main.view()}),command:async c=>({ok:true,view:await main.command(c)}),onInvalidated:fn=>main.subscribe(fn)};
 try{render(<IntakePermissions active/>);await screen.findByRole('option',{name:'合成坐席'});
  await user.selectOptions(screen.getByRole('combobox',{name:'人员'}),main.view().people[0]!.selection);await user.click(screen.getByRole('checkbox',{name:'查询复制'}));
  fireEvent.change(screen.getByLabelText('生效时间'),{target:{value:'2026-10-08T10:00'}});fireEvent.change(screen.getByLabelText('失效时间'),{target:{value:'2026-10-09T10:00'}});
  await user.type(screen.getByRole('textbox',{name:'授权原因'}),'合成任务');await user.click(screen.getByRole('button',{name:'预览权限'}));
  await screen.findByText('预览 · 尚未保存');expect(f.grants).toHaveLength(0);
  const displayedPeriod='2026年10月08日 10:00:00（UTC+08:00） 至 2026年10月09日 10:00:00（UTC+08:00）';
  expect(screen.getByRole('region',{name:'权限预览'})).toHaveTextContent(displayedPeriod);
  expect(f.requests.find(request=>request.path==='/v1/intake/grants/preview')).toMatchObject({body:{items:[{
   startsAt:'2026-10-08T02:00:00.000Z',expiresAt:'2026-10-09T02:00:00.000Z',
  }]}});
  await user.click(screen.getByRole('button',{name:'确认保存权限'}));
  await screen.findByText(/本次操作已保存/);await user.click(screen.getByRole('button',{name:'刷新权限列表'}));
  expect(within(screen.getByRole('region',{name:'已有业务权限'})).getByRole('article')).toHaveTextContent(displayedPeriod);
  await user.click(await screen.findByRole('button',{name:'撤销该权限'}));await user.type(screen.getByRole('textbox',{name:'撤销原因'}),'合成撤销');
  await user.click(screen.getByRole('button',{name:'确认撤销'}));await waitFor(()=>expect(f.grants[0]!.revokedAt).not.toBeNull());
 }finally{main.dispose();}
});
