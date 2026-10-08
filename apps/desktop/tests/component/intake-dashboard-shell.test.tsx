import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { ContentIntakeManagement } from '../../src/main/content-intake-management';
import { intakeManagementData } from '../fixtures/intake-management-data';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';
import { DASHBOARD_WINDOW_TITLE } from '../../src/shared/dashboard-window';

afterEach(() => {
  // Unmount while the bridge still exists, including after an early assertion.
  cleanup(); delete window.dashboardIntake; delete window.dashboardIntakeCatalog; delete window.dashboardContent; delete window.dashboardPermissions; vi.unstubAllGlobals();
});

it('reuses workspace chrome and theme without mounting legacy modules or calling their session API', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const legacySession = vi.fn();
  window.dashboardContent = { session: legacySession } as unknown as typeof window.dashboardContent;
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }),
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '合成管理会话暂不可用', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '合成管理会话暂不可用', view: null }), onInvalidated: () => () => undefined };
  render(<DashboardApp />);
  const shell = await screen.findByTestId('dashboard-shell');
  await waitFor(() => expect(document.title).toBe(DASHBOARD_WINDOW_TITLE));
  expect(within(shell).getAllByRole('tab')).toHaveLength(5);
  const tab = screen.getByTestId('nav-content');
  expect(tab).toHaveAttribute('aria-selected', 'true');
  for (const [key,module] of [['ArrowDown','announce'],['ArrowUp','content'],['Home','overview'],['End','announce']]) {
    fireEvent.keyDown(screen.getByRole('tab',{selected:true}), { key });
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', module);
  }
  for (const id of ['overview','wording','sop','announce','content']) await user.click(screen.getByTestId(`nav-${id}`));
  await user.click(screen.getByTestId('dashboard-theme-trigger'));
  await user.click(screen.getByTestId('dashboard-theme-dark'));
  expect(shell).toHaveAttribute('data-theme', 'dark');
  expect(document.documentElement.style.colorScheme).toBe('dark');
  fireEvent.focus(window);
  expect(legacySession).not.toHaveBeenCalled();
  expect(screen.queryByTestId('overview-kpi-source')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '资料管理' })).toBeInTheDocument();
});

it('fails closed before choosing a workspace profile when the mode lookup fails', async () => {
  window.dashboardIntake = { mode: async () => ({ ok: false, code: 'UNAVAILABLE' }),
    current: vi.fn(), command: vi.fn(), onInvalidated: vi.fn() } as unknown as typeof window.dashboardIntake;
  render(<DashboardApp />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('管理模式不可用'));
  expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument();
  expect(window.dashboardIntake!.command).not.toHaveBeenCalled();
});

it('preserves unpublished input and a pending confirmation across workspace navigation',async()=>{
  const data=intakeManagementData(1);data.status.state='passed';data.candidate.sourceEvidenceVersion=1;data.candidate.state='ready';
  let answer!:(value:boolean)=>void;
  const confirm=vi.fn(()=>new Promise<boolean>(resolve=>{answer=resolve;}));
  const main=new ContentIntakeManagement({view:()=>({ok:true,enabled:true,signedIn:true,sessionEpoch:1,userId:'synthetic',role:'coach',authMode:'mock',displayName:'合成经理',expiresAt:'2099-01-01T00:00:00Z'}),
    subscribe:()=>()=>undefined,request:async(_epoch,path,options={})=>({status:200,value:structuredClone(data.respond(path,options.body))})},undefined,confirm);
  const command=vi.fn(async(c:Parameters<typeof main.command>[0])=>({ok:true as const,view:await main.command(c)}));
  window.dashboardIntake={mode:async()=>({ok:true,enabled:true}),current:async()=>({ok:true,view:main.view()}),command,onInvalidated:fn=>main.subscribe(fn)};
  const user=userEvent.setup();
  try{render(<DashboardApp/>);await user.click(await screen.findByRole('button',{name:/source-a/}));
    await user.click(screen.getByRole('button',{name:'查看材料'}));
    await user.type(screen.getByRole('textbox',{name:'发布标题'}),'保留的合成标题');await user.type(screen.getByRole('textbox',{name:'发布摘要'}),'保留的合成摘要');
    await user.click(screen.getByTestId('nav-overview'));await user.click(screen.getByTestId('nav-content'));
    expect(screen.getByRole('textbox',{name:'发布标题'})).toHaveValue('保留的合成标题');
    await user.click(screen.getByRole('button',{name:'发布当前候选'}));await waitFor(()=>expect(confirm).toHaveBeenCalledOnce());
    await user.click(screen.getByTestId('nav-sop'));await user.click(screen.getByTestId('nav-content'));
    expect(screen.getByRole('button',{name:'发布当前候选'})).toBeDisabled();
    await act(async()=>{answer(false);});
    expect(screen.getByRole('textbox',{name:'发布标题'})).toHaveValue('保留的合成标题');
    expect(data.workflowReceipts.size).toBe(0);
    expect(command.mock.calls.filter(([c])=>c.action==='list')).toHaveLength(1);
  }finally{cleanup();main.dispose();}
});
it('preserves an unsaved permission preview across outer navigation',async()=>{
  const fixture=intakePermissionsData(),owner=new ContentIntakePermissions(fixture.session),user=userEvent.setup();
  window.dashboardPermissions={current:async()=>({ok:true,view:owner.view()}),command:async c=>({ok:true,view:await owner.command(c)}),onInvalidated:fn=>owner.subscribe(fn)};
  window.dashboardIntake={mode:async()=>({ok:true,enabled:true}),current:async()=>({ok:false,code:'UNAVAILABLE',message:'未读取资料',view:null}),command:async()=>({ok:false,code:'UNAVAILABLE',message:'未读取资料',view:null}),onInvalidated:()=>()=>undefined};
  try{render(<DashboardApp/>);await user.click(await screen.findByRole('button',{name:'权限配置'}));
    await screen.findByRole('option',{name:'合成坐席'});await user.selectOptions(screen.getByRole('combobox',{name:'人员'}),owner.view().people[0]!.selection);
    await user.click(screen.getByRole('checkbox',{name:'查询复制'}));
    fireEvent.change(screen.getByLabelText('生效时间'),{target:{value:'2026-10-08T18:00'}});fireEvent.change(screen.getByLabelText('失效时间'),{target:{value:'2026-10-09T18:00'}});
    await user.type(screen.getByRole('textbox',{name:'授权原因'}),'合成导航保留');await user.click(screen.getByRole('button',{name:'预览权限'}));await screen.findByText('预览 · 尚未保存');
    await user.click(screen.getByTestId('nav-overview'));await user.click(screen.getByTestId('nav-content'));
    expect(screen.getByText('预览 · 尚未保存')).toBeVisible();expect(fixture.grants).toHaveLength(0);
    await user.click(screen.getByRole('button',{name:'返回修改'}));expect(screen.getByRole('textbox',{name:'授权原因'})).toHaveValue('合成导航保留');
  }finally{cleanup();owner.dispose();}
});
