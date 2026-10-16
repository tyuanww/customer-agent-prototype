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
import type { UsageLogRow } from '../../src/shared/dashboard-usage-log';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function installShippedDashboardCss() {
  if (document.getElementById('shipped-dashboard.css')) return;
  // Same order as DashboardApp: knowledge sheet, shell sheet, then the font longhands.
  for (const file of [
    'src/renderer/features/dashboard/intake-management.css',
    'src/renderer/styles/dashboard.css',
    'src/renderer/features/dashboard/workbench-v9.css',
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
  const legacySession = vi.fn(async () => ({ ok: false as const }));
  window.dashboardContent = { session: legacySession } as unknown as typeof window.dashboardContent;
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }),
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '合成管理会话暂不可用', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '合成管理会话暂不可用', view: null }), onInvalidated: () => () => undefined };
  render(<DashboardApp />);
  const shell = await screen.findByTestId('dashboard-shell');
  await waitFor(() => expect(document.title).toBe(DASHBOARD_WINDOW_TITLE));
  expect(within(shell).getAllByRole('tab').filter((tab) => tab.getAttribute('data-testid')?.startsWith('nav-'))).toHaveLength(7);
  expect(screen.queryByRole('tab', { name: '权限' })).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '内容管理工作区' })).not.toBeInTheDocument();
  expect(screen.getByTestId('nav-overview')).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByTestId('nav-content'));
  const tab = screen.getByTestId('nav-content');
  expect(tab).toHaveAttribute('aria-selected', 'true');
  for (const [key,module] of [['ArrowDown','publish'],['ArrowUp','content'],['Home','overview'],['End','materials']]) {
    fireEvent.keyDown(screen.getByTestId('nav-content'), { key });
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', module);
  }
  for (const id of ['overview','wording','sop','announce','content']) await user.click(screen.getByTestId(`nav-${id}`));
  await user.click(screen.getByTestId('dashboard-theme-trigger'));
  await user.click(screen.getByTestId('dashboard-theme-dark'));
  expect(shell).toHaveAttribute('data-theme', 'dark');
  expect(document.documentElement.style.colorScheme).toBe('dark');
  fireEvent.focus(window);
  expect(legacySession).toHaveBeenCalled();
  expect(screen.queryByTestId('overview-kpi-source')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '知识库' })).toBeInTheDocument();
});

it('opens the six-page shell without waiting on the intake mode lookup', async () => {
  window.dashboardIntake = { mode: async () => ({ ok: false, code: 'UNAVAILABLE' }),
    current: vi.fn(), command: vi.fn(), onInvalidated: vi.fn() } as unknown as typeof window.dashboardIntake;
  render(<DashboardApp />);
  expect(await screen.findByTestId('dashboard-shell')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(window.dashboardIntake!.command).not.toHaveBeenCalled();
});

it('keeps an unsent knowledge name across workspace navigation', async () => {
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  window.dashboardDesk = { current: async () => desk.reply('operator', '合成经理'), command: async (command) => desk.command('operator', command, '合成经理') };
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }), current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }), command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }), onInvalidated: () => () => undefined };
  const user = userEvent.setup();
  installShippedDashboardCss();
  render(<DashboardApp />);
  await user.click(await screen.findByTestId('nav-content'));
  const write = await screen.findByRole('button', { name: '添加话术' });
  const content = screen.getByTestId('dashboard-content');
  const knowledge = document.querySelector('.desk-knowledge');
  const column = document.querySelector('.desk-knowledge .desk-column');
  if (!(knowledge instanceof HTMLElement) || !(column instanceof HTMLElement) || !(knowledge.parentElement instanceof HTMLElement)) {
    throw new Error('missing knowledge page');
  }
  expect(getComputedStyle(content).backgroundColor).toBe('rgb(255, 255, 255)');
  expect(getComputedStyle(knowledge.parentElement).backgroundColor).toBe('rgb(255, 255, 255)');
  expect(getComputedStyle(column).maxWidth).toBe('none');
  expect(getComputedStyle(write).fontSize).toBe('14px');
  expect(getComputedStyle(write).fontWeight).toBe('600');
  expect(getComputedStyle(screen.getByRole('button', { name: '全店' })).fontSize).toBe('14px');
  expect(getComputedStyle(screen.getByRole('button', { name: '全店' })).fontWeight).toBe('600');
  await user.click(write);
  await user.click(screen.getByRole('button', { name: '没有文档？手动填写一条' }));
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
    expect(screen.getAllByRole('tab').filter((tab) => tab.getAttribute('data-testid')?.startsWith('nav-'))).toHaveLength(8);
    expect(screen.queryByRole('group',{name:'内容管理工作区'})).not.toBeInTheDocument();
    await user.click(screen.getByTestId('nav-permissions'));
    const permissionsPage = document.querySelector('.desk-permissions-page');
    const permissionsColumn = document.querySelector('.desk-permissions');
    if (!(permissionsPage instanceof HTMLElement) || !(permissionsColumn instanceof HTMLElement)) throw new Error('missing permissions page');
    const content = screen.getByTestId('dashboard-content');
    expect(getComputedStyle(content).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(permissionsPage).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(permissionsPage).minHeight).toBe('100%');
    expect(getComputedStyle(permissionsPage).maxWidth).not.toBe('1000px');
    expect(getComputedStyle(permissionsColumn).maxWidth).toBe('1000px');
    expect(getComputedStyle(permissionsColumn).backgroundColor).toBe('rgb(255, 255, 255)');
    await screen.findAllByRole('row',{name:/合成坐席/});await user.click(screen.getByRole('button',{name:'新增授权'}));await user.selectOptions(screen.getByRole('combobox',{name:'人员'}),owner.view().people[0]!.selection);
    fireEvent.change(screen.getByLabelText('生效时间'),{target:{value:'2026-10-08T18:00'}});fireEvent.change(screen.getByLabelText('失效时间'),{target:{value:'2026-10-09T18:00'}});
    await user.type(screen.getByRole('textbox',{name:'授权原因'}),'合成导航保留');await user.click(screen.getByRole('button',{name:'预览权限'}));await screen.findByText('预览 · 尚未保存');
    await user.click(screen.getByTestId('nav-overview'));await user.click(screen.getByTestId('nav-permissions'));
    expect(screen.getByText('预览 · 尚未保存')).toBeVisible();expect(fixture.grants).toHaveLength(0);
    await user.click(screen.getByRole('button',{name:'返回修改'}));expect(screen.getByRole('textbox',{name:'授权原因'})).toHaveValue('合成导航保留');
  }finally{cleanup();owner.dispose();}
});

it('keeps the six intake pages inside 980 by 680 in light and dark', async () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  window.dashboardDesk = { current: async () => desk.reply('operator', '合成经理'), command: async (command) => desk.command('operator', command, '合成经理') };
  window.dashboardIntake = {
    mode: async () => ({ ok: true, enabled: true }),
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
    onInvalidated: () => () => undefined,
  };
  const owner = new ContentIntakePermissions(intakePermissionsData().session);
  window.dashboardPermissions = { current: async () => ({ ok: true, view: owner.view() }), command: async (command) => ({ ok: true, view: await owner.command(command) }), onInvalidated: (fn) => owner.subscribe(fn) };
  window.dashboardSeats = { command: async (intent) => (intent.action === 'list' ? { ok: true, action: 'list' as const, seats: [] } : { ok: false, message: '未保存' }) };
  installShippedDashboardCss();
  document.documentElement.style.width = '980px';
  document.body.style.cssText = 'width:980px;height:680px;margin:0';
  const user = userEvent.setup();
  try {
    render(<DashboardApp />);
    const shell = await screen.findByTestId('dashboard-shell');
    shell.style.width = '980px';
    shell.style.height = '680px';
    const content = screen.getByTestId('dashboard-content');
    const pages = ['overview', 'wording', 'sop', 'content', 'permissions', 'announce'] as const;
    for (const theme of ['light', 'dark'] as const) {
      await user.click(screen.getByTestId('dashboard-theme-trigger'));
      await user.click(screen.getByTestId(`dashboard-theme-${theme}`));
      expect(shell).toHaveAttribute('data-theme', theme);
      if (theme === 'dark') {
        await waitFor(() => expect(getComputedStyle(content).backgroundColor).toBe('rgb(22, 21, 26)'));
      }
      for (const page of pages) {
        await user.click(screen.getByTestId(`nav-${page}`));
        expect(content).toHaveAttribute('data-active-module', page);
        expect(content.scrollWidth).toBeLessThanOrEqual(Math.max(content.clientWidth, 980));
        expect(shell.scrollWidth).toBeLessThanOrEqual(Math.max(shell.clientWidth, 980));
      }
    }
    expect(getComputedStyle(content).overflowX).toBe('hidden');
    await user.click(screen.getByTestId('nav-sop'));
    expect(screen.getByTestId('module-sop')).toHaveTextContent('未接入');
    expect(screen.queryByText('上传 CSV 会覆盖当前产品会话 SOP 树')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('nav-announce'));
    expect(screen.getByTestId('module-announce')).toBeInTheDocument();
    expect(await screen.findByText('未接入当前发布')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '使用情况' })).not.toBeInTheDocument();
    expect(screen.queryByText('可用资料暂不可读取，请重试。')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('nav-content'));
    const add = await screen.findByRole('button', { name: '添加话术' });
    for (let step = 0; step < 8 && document.activeElement !== add; step += 1) await user.tab();
    expect(add).toHaveFocus();
    const focused = getComputedStyle(add);
    expect(focused.outlineStyle === 'none' && focused.outlineWidth === '0px').toBe(false);
  } finally {
    owner.dispose();
    delete window.dashboardSeats;
    document.documentElement.style.width = '';
    document.body.style.cssText = '';
  }
});

function expectVisibleFocus(element: HTMLElement) {
  expect(element).toHaveFocus();
  const style = getComputedStyle(element);
  expect(style.outlineStyle === 'none' && style.outlineWidth === '0px').toBe(false);
}

async function tabUntil(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  (document.activeElement as HTMLElement | null)?.blur?.();
  for (let step = 0; step < 60 && document.activeElement !== target; step += 1) await user.tab();
  expectVisibleFocus(target);
}

it('opens the add layer and permission dialogs and keeps keyboard focus inside 980 by 680 in light and dark', async () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const desk = new DeskKnowledgeStore({ now: () => '2026-10-13T00:00:00.000Z', load: () => null, save: () => undefined });
  window.dashboardDesk = { current: async () => desk.reply('operator', '合成经理'), command: async (command) => desk.command('operator', command, '合成经理') };
  window.dashboardIntake = {
    mode: async () => ({ ok: true, enabled: true }),
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
    onInvalidated: () => () => undefined,
  };
  const owner = new ContentIntakePermissions(intakePermissionsData().session);
  window.dashboardPermissions = { current: async () => ({ ok: true, view: owner.view() }), command: async (command) => ({ ok: true, view: await owner.command(command) }), onInvalidated: (fn) => owner.subscribe(fn) };
  window.dashboardSeats = { command: async (intent) => (intent.action === 'list' ? { ok: true, action: 'list' as const, seats: [] } : { ok: false, message: '未保存' }) };
  const usageRows: UsageLogRow[] = [
    { id: '1', askedAt: '2026-10-13T01:02:03.000Z', agent: '坐席甲', question: '退货多久', scriptTitle: '退货时效', result: 'copied', snapshotStale: false },
  ];
  window.dashboardUsageLog = {
    list: async () => ({ ok: true, rows: usageRows, nextCursor: null, canExport: true }),
    previewExport: async () => ({ ok: true, exportable: 1, redacted: 0, withoutConsent: 0 }),
    export: async () => ({ ok: true, written: 1 }),
  };
  installShippedDashboardCss();
  document.documentElement.style.width = '980px';
  document.body.style.cssText = 'width:980px;height:680px;margin:0';
  const user = userEvent.setup();
  try {
    render(<DashboardApp />);
    const shell = await screen.findByTestId('dashboard-shell');
    shell.style.width = '980px';
    shell.style.height = '680px';
    const content = screen.getByTestId('dashboard-content');
    for (const theme of ['light', 'dark'] as const) {
      await user.click(screen.getByTestId('dashboard-theme-trigger'));
      await user.click(screen.getByTestId(`dashboard-theme-${theme}`));
      expect(shell).toHaveAttribute('data-theme', theme);
      if (theme === 'dark') await waitFor(() => expect(getComputedStyle(content).backgroundColor).toBe('rgb(22, 21, 26)'));

      await user.click(screen.getByTestId('nav-content'));
      const add = await screen.findByRole('button', { name: '添加话术' });
      await user.click(add);
      const addDialog = screen.getByRole('dialog', { name: '添加话术' });
      await tabUntil(user, within(addDialog).getByRole('button', { name: '关闭' }));
      await user.click(within(addDialog).getByRole('button', { name: '没有文档？手动填写一条' }));
      await tabUntil(user, within(addDialog).getByRole('textbox', { name: '问题' }));
      await user.type(within(addDialog).getByRole('textbox', { name: '问题' }), '焦点不保存');
      await user.click(within(addDialog).getByRole('button', { name: '关闭' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('cell', { name: '焦点不保存' })).not.toBeInTheDocument();
      expect(content.scrollWidth).toBeLessThanOrEqual(Math.max(content.clientWidth, 980));

      await user.click(screen.getByTestId('nav-permissions'));
      const businessTab = screen.queryByRole('tab', { name: '业务授权' });
      if (businessTab && businessTab.getAttribute('aria-selected') !== 'true') await user.click(businessTab);
      await screen.findByRole('row', { name: /合成坐席/ });
      expect(screen.queryByRole('button', { name: '停止等待' })).not.toBeInTheDocument();
      expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '新增授权' }));
      const grant = screen.getByRole('dialog', { name: '新增业务权限' });
      await tabUntil(user, within(grant).getByRole('button', { name: '关闭' }));
      await tabUntil(user, within(grant).getByRole('combobox', { name: '人员' }));
      await user.click(within(grant).getByRole('button', { name: '关闭' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: '外包坐席' }));
      await user.click(screen.getByRole('button', { name: '新建坐席' }));
      const seat = screen.getByRole('dialog', { name: '新建坐席' });
      await tabUntil(user, within(seat).getByRole('button', { name: '关闭' }));
      await tabUntil(user, within(seat).getByLabelText('姓名'));
      await user.click(within(seat).getByRole('button', { name: '取消' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(content.scrollWidth).toBeLessThanOrEqual(Math.max(content.clientWidth, 980));

      await user.click(screen.getByTestId('nav-announce'));
      const wordingTab = await screen.findByRole('tab', { name: '话术版本更新' });
      await tabUntil(user, wordingTab);
      await tabUntil(user, screen.getByRole('tab', { name: '软件版本更新' }));
      expect(await screen.findByText('未接入当前发布')).toBeInTheDocument();
      expect(content.scrollWidth).toBeLessThanOrEqual(Math.max(content.clientWidth, 980));
    }
    await user.click(screen.getByTestId('nav-permissions'));
    await user.click(screen.getByRole('tab', { name: '业务授权' }));
    await user.click(screen.getByRole('button', { name: '新增授权' }));
    await user.selectOptions(screen.getByRole('combobox', { name: '人员' }), owner.view().people[0]!.selection);
    fireEvent.change(screen.getByLabelText('生效时间'), { target: { value: '2026-10-08T10:00' } });
    fireEvent.change(screen.getByLabelText('失效时间'), { target: { value: '2026-10-09T10:00' } });
    await user.type(screen.getByRole('textbox', { name: '授权原因' }), '焦点撤销');
    await user.click(screen.getByRole('button', { name: '预览权限' }));
    await screen.findByText('预览 · 尚未保存');
    expect(owner.view().grants).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '确认保存权限' }));
    await screen.findByText(/本次操作已保存/);
    await user.click(screen.getByRole('button', { name: '刷新权限列表' }));
    const revoke = await screen.findByRole('button', { name: '撤销该权限' });
    expect(revoke).toHaveClass('btn-danger-ghost');
    await tabUntil(user, revoke);
    await user.click(revoke);
    await tabUntil(user, screen.getByRole('textbox', { name: '撤销原因' }));
    await user.type(screen.getByRole('textbox', { name: '撤销原因' }), '合成撤销');
    const confirm = screen.getByRole('button', { name: '确认撤销' });
    expect(confirm).toHaveClass('btn-danger');
    await tabUntil(user, confirm);
    expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
  } finally {
    owner.dispose();
    delete window.dashboardSeats;
    delete window.dashboardUsageLog;
    document.documentElement.style.width = '';
    document.body.style.cssText = '';
  }
});
