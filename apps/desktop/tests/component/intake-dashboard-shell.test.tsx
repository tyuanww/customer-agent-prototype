import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { DeskKnowledgeStore } from '../../src/shared/desk-knowledge';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';
import { DASHBOARD_WINDOW_TITLE } from '../../src/shared/dashboard-window';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function installShippedDashboardCss() {
  if (document.getElementById('shipped-dashboard.css')) return;
  // Same order as DashboardApp: knowledge sheet, shell sheet, then the font longhands.
  for (const file of [
    'src/renderer/features/dashboard/intake-management.css',
    'src/renderer/styles/dashboard.css',
    'src/renderer/features/dashboard/desk-chrome.css',
  ]) {
    const node = document.createElement('style');
    node.id = `shipped-${file.split('/').pop()}`;
    node.textContent = readFileSync(resolve(desktopRoot, file), 'utf8');
    document.head.appendChild(node);
  }
}

afterEach(() => {
  // Unmount while the bridge still exists, including after an early assertion.
  cleanup(); delete window.dashboardIntake; delete window.dashboardDesk; delete window.dashboardIntakeCatalog; delete window.dashboardContent; delete window.dashboardPermissions; vi.unstubAllGlobals();
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
  expect(screen.queryByRole('tab', { name: '权限' })).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '内容管理工作区' })).not.toBeInTheDocument();
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
  expect(screen.getByRole('heading', { name: '知识库' })).toBeInTheDocument();
});

it('fails closed before choosing a workspace profile when the mode lookup fails', async () => {
  window.dashboardIntake = { mode: async () => ({ ok: false, code: 'UNAVAILABLE' }),
    current: vi.fn(), command: vi.fn(), onInvalidated: vi.fn() } as unknown as typeof window.dashboardIntake;
  render(<DashboardApp />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('管理模式不可用'));
  expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument();
  expect(window.dashboardIntake!.command).not.toHaveBeenCalled();
});

it('keeps an unsent knowledge name across workspace navigation', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  window.dashboardDesk = { current: async () => desk.reply('operator', '合成经理'), command: async (command) => desk.command('operator', command, '合成经理') };
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }), current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }), command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }), onInvalidated: () => () => undefined };
  const user = userEvent.setup();
  installShippedDashboardCss();
  render(<DashboardApp />);
  const write = await screen.findByRole('button', { name: '添加话术' });
  expect(getComputedStyle(write).fontSize).toBe('14px');
  expect(getComputedStyle(write).fontWeight).toBe('600');
  expect(getComputedStyle(screen.getByRole('button', { name: '全店' })).fontSize).toBe('14px');
  expect(getComputedStyle(screen.getByRole('button', { name: '全店' })).fontWeight).toBe('600');
  await user.click(write);
  const question = screen.getByRole('textbox', { name: '问题' });
  expect(getComputedStyle(question).fontSize).toBe('14px');
  const save = screen.getByRole('button', { name: '保存' });
  expect(getComputedStyle(save).fontSize).toBe('14px');
  expect(getComputedStyle(save).fontWeight).toBe('600');
  await user.type(question, '退货时效');
  await user.click(screen.getByTestId('nav-overview'));
  await user.click(screen.getByTestId('nav-content'));
  expect(screen.getByRole('textbox', { name: '问题' })).toHaveValue('退货时效');
});
it('preserves an unsaved permission preview across outer navigation',async()=>{
  const fixture=intakePermissionsData(),owner=new ContentIntakePermissions(fixture.session),user=userEvent.setup();
  window.dashboardPermissions={current:async()=>({ok:true,view:owner.view()}),command:async c=>({ok:true,view:await owner.command(c)}),onInvalidated:fn=>owner.subscribe(fn)};
  window.dashboardIntake={mode:async()=>({ok:true,enabled:true}),current:async()=>({ok:false,code:'UNAVAILABLE',message:'未读取资料',view:null}),command:async()=>({ok:false,code:'UNAVAILABLE',message:'未读取资料',view:null}),onInvalidated:()=>()=>undefined};
  try{installShippedDashboardCss();render(<DashboardApp/>);
    expect(await screen.findByRole('tab',{name:'权限'})).toHaveAttribute('data-nav-group','治理与架构');
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.queryByRole('group',{name:'内容管理工作区'})).not.toBeInTheDocument();
    await user.click(screen.getByTestId('nav-permissions'));
    const permissionsPage = document.querySelector('.desk-permissions-page');
    const permissionsColumn = document.querySelector('.desk-permissions');
    if (!(permissionsPage instanceof HTMLElement) || !(permissionsColumn instanceof HTMLElement)) throw new Error('missing permissions page');
    const content = screen.getByTestId('dashboard-content');
    expect(getComputedStyle(content).backgroundColor).toBe('rgb(241, 244, 248)');
    expect(getComputedStyle(permissionsPage).backgroundColor).toBe('rgb(241, 244, 248)');
    expect(getComputedStyle(permissionsPage).minHeight).toBe('100%');
    expect(getComputedStyle(permissionsPage).maxWidth).not.toBe('1000px');
    expect(getComputedStyle(permissionsColumn).maxWidth).toBe('1000px');
    expect(getComputedStyle(permissionsColumn).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await screen.findByRole('option',{name:'合成坐席'});await user.selectOptions(screen.getByRole('combobox',{name:'人员'}),owner.view().people[0]!.selection);
    fireEvent.change(screen.getByLabelText('生效时间'),{target:{value:'2026-10-08T18:00'}});fireEvent.change(screen.getByLabelText('失效时间'),{target:{value:'2026-10-09T18:00'}});
    await user.type(screen.getByRole('textbox',{name:'授权原因'}),'合成导航保留');await user.click(screen.getByRole('button',{name:'预览权限'}));await screen.findByText('预览 · 尚未保存');
    await user.click(screen.getByTestId('nav-overview'));await user.click(screen.getByTestId('nav-permissions'));
    expect(screen.getByText('预览 · 尚未保存')).toBeVisible();expect(fixture.grants).toHaveLength(0);
    await user.click(screen.getByRole('button',{name:'返回修改'}));expect(screen.getByRole('textbox',{name:'授权原因'})).toHaveValue('合成导航保留');
  }finally{cleanup();owner.dispose();}
});
