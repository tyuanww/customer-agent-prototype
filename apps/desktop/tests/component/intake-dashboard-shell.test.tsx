import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { intakeDestinationsExcludeAnnounce, readIntakePreviewPage } from '../../src/renderer/features/dashboard/intake-destinations';
import { ContentIntakePermissions } from '../../src/main/content-intake-permissions';
import { intakePermissionsData } from '../fixtures/intake-permissions-data';
import { DASHBOARD_WINDOW_TITLE } from '../../src/shared/dashboard-window';
import { observeSessionJob } from '../../src/shared/product-session';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// The workbench surface is Radix mauve-1 in each theme (styles/radix-palette.css). jsdom does
// not resolve custom properties: a computed background reads the token itself, or transparent
// where the rule sits behind a selector jsdom cannot match (`:has`), letting the surface behind
// show through. A real engine resolves mauve-1; the e2e specs cover that.
const SURFACE_LIGHT = ['var(--wb-surface)', 'rgba(0, 0, 0, 0)', 'rgb(253, 252, 253)'];
const SURFACE_DARK = ['var(--wb-surface)', 'rgba(0, 0, 0, 0)', 'rgb(18, 17, 19)'];
function expectSurface(element: Element, theme: 'light' | 'dark') {
  expect(theme === 'light' ? SURFACE_LIGHT : SURFACE_DARK).toContain(getComputedStyle(element).backgroundColor);
}

function allowGrant() {
  window.dashboardContent = {
    session: async () => ({
      ok: true,
      enabled: true,
      signedIn: true,
      role: 'owner',
      displayName: '合成管理员',
      job: observeSessionJob({
        title: '客服总监',
        directory: [{ name: '客服总监', enabled: true }],
        actions: { query: true, import: true, publish: true, rollback: true },
      }),
    }),
    parseUpload: async () => ({ ok: false as const, code: 'UNAVAILABLE', message: '服务暂不可用，请重试' }),
    publishDraft: async () => ({ ok: false as const, code: 'UNAVAILABLE', message: '服务暂不可用，请重试' }),
    rollbackPrevious: async () => ({ ok: false as const, code: 'UNAVAILABLE', message: '服务暂不可用，请重试' }),
    cancelInFlight: async () => ({ ok: true as const }),
  };
}

function installShippedDashboardCss() {
  if (document.getElementById('shipped-dashboard.css')) return;
  for (const file of [
    'src/renderer/features/dashboard/intake-management.css',
    'src/renderer/styles/dashboard.css',
    'src/renderer/features/dashboard/workbench-v9.css',
    'src/renderer/features/dashboard/desk-chrome.css',
    'src/renderer/styles/radix-palette.css',
    'src/renderer/styles/workbench-tokens.css',
    'src/renderer/styles/workbench-shell.css',
  ]) {
    const node = document.createElement('style');
    node.id = `shipped-${file.split('/').pop()}`;
    node.textContent = readFileSync(resolve(desktopRoot, file), 'utf8');
    document.head.appendChild(node);
  }
}

function cleanupDashboardWithWindowBridges() {
  cleanup();
  delete window.dashboardIntake;
  delete window.dashboardIntakeCatalog;
  delete window.dashboardContent;
  delete window.dashboardPermissions;
  delete window.dashboardPageUse;
  vi.unstubAllGlobals();
}

function showPermissionsNav() {
  window.dashboardPageUse = {
    current: async () => ({
      phase: 'ready' as const,
      epoch: 1,
      settings: {
        accessRevision: 1,
        expiresAt: '2026-11-05T11:00:00Z',
        grants: { state: 'open' as const, body: null },
        accounts: 'open' as const,
      },
      sop: { state: 'closed' as const },
    }),
    onChanged: () => () => undefined,
  };
}

afterEach(cleanupDashboardWithWindowBridges);

it('reuses workspace chrome and theme without mounting legacy modules or calling their session API', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const legacySession = vi.fn(async () => ({
    ok: true as const,
    enabled: true,
    signedIn: true,
    role: 'owner' as const,
    displayName: '合成管理员',
    job: observeSessionJob({
      title: '客服总监',
      directory: [{ name: '客服总监', enabled: true }],
      actions: { query: true, import: true, publish: true, rollback: true },
    }),
  }));
  window.dashboardContent = { session: legacySession } as unknown as typeof window.dashboardContent;
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }),
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '合成管理会话暂不可用', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '合成管理会话暂不可用', view: null }), onInvalidated: () => () => undefined };
  render(<DashboardApp />);
  const shell = await screen.findByTestId('dashboard-shell');
  await waitFor(() => expect(document.title).toBe(DASHBOARD_WINDOW_TITLE));
  await waitFor(() => expect(within(shell).getAllByRole('tab').filter((tab) => tab.getAttribute('data-testid')?.startsWith('nav-'))).toHaveLength(4));
  expect(screen.queryByRole('tab', { name: '设置' })).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '内容管理工作区' })).not.toBeInTheDocument();
  expect(screen.getByTestId('nav-overview')).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByTestId('nav-wording'));
  const tab = screen.getByTestId('nav-wording');
  expect(tab).toHaveAttribute('aria-selected', 'true');
  for (const [key,module] of [['ArrowDown','sop'],['ArrowUp','wording'],['Home','overview'],['End','materials']]) {
    fireEvent.keyDown(screen.getByTestId('nav-wording'), { key });
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', module);
  }
  for (const id of ['overview','wording','sop']) await user.click(screen.getByTestId(`nav-${id}`));
  await user.click(screen.getByTestId('dashboard-theme-trigger'));
  await user.click(screen.getByTestId('dashboard-theme-dark'));
  expect(shell).toHaveAttribute('data-theme', 'dark');
  expect(document.documentElement.style.colorScheme).toBe('dark');
  fireEvent.focus(window);
  expect(legacySession).toHaveBeenCalled();
  expect(screen.queryByTestId('overview-kpi-source')).not.toBeInTheDocument();
  expect(screen.getByTestId('module-sop')).toBeInTheDocument();
});

it('opens the five-page shell without waiting on the intake mode lookup', async () => {
  window.dashboardIntake = { mode: async () => ({ ok: false, code: 'UNAVAILABLE' }),
    current: vi.fn(), command: vi.fn(async () => ({ ok:false,code:'UNAVAILABLE',message:'无法读取资料',view:null })), onInvalidated: () => () => undefined } as unknown as typeof window.dashboardIntake;
  render(<DashboardApp />);
  expect(await screen.findByTestId('dashboard-shell')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(window.dashboardIntake!.command).toHaveBeenCalledWith({ action:'list', next:false });
});

it('preserves an unsaved permission preview across outer navigation',async()=>{
  const fixture=intakePermissionsData(),owner=new ContentIntakePermissions(fixture.session),user=userEvent.setup();
  window.dashboardPermissions={current:async()=>({ok:true,view:owner.view()}),command:async c=>({ok:true,view:await owner.command(c)}),onInvalidated:fn=>owner.subscribe(fn)};
  showPermissionsNav();
  window.dashboardIntake={mode:async()=>({ok:true,enabled:true}),current:async()=>({ok:false,code:'UNAVAILABLE',message:'未读取资料',view:null}),command:async()=>({ok:false,code:'UNAVAILABLE',message:'未读取资料',view:null}),onInvalidated:()=>()=>undefined};
  try{installShippedDashboardCss();allowGrant();render(<DashboardApp/>);
    expect(await screen.findByTestId('nav-settings')).toHaveAttribute('data-nav-group','治理与架构');
    expect(screen.getAllByRole('tab').filter((tab) => tab.getAttribute('data-testid')?.startsWith('nav-'))).toHaveLength(5);
    await user.click(screen.getByTestId('nav-wording'));
    fireEvent.keyDown(screen.getByTestId('nav-wording'), { key: 'ArrowDown' });
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'sop');
    expect(screen.queryByRole('group',{name:'内容管理工作区'})).not.toBeInTheDocument();
    await user.click(screen.getByTestId('nav-settings'));
    const permissionsPage = document.querySelector('.desk-permissions-page');
    const permissionsColumn = document.querySelector('.desk-permissions');
    if (!(permissionsPage instanceof HTMLElement) || !(permissionsColumn instanceof HTMLElement)) throw new Error('missing permissions page');
    const content = screen.getByTestId('dashboard-content');
    expectSurface(content, 'light');
    expectSurface(permissionsPage, 'light');
    expect(getComputedStyle(permissionsPage).minHeight).toBe('100%');
    expect(getComputedStyle(permissionsPage).maxWidth).not.toBe('1000px');
    expect(getComputedStyle(permissionsColumn).maxWidth).toBe('1000px');
    expectSurface(permissionsColumn, 'light');
    await screen.findAllByRole('row',{name:/合成坐席/});
    await user.click(screen.getByRole('button',{name:'新增授权'}));
    const person = owner.view().people[0]!;
    await user.click(screen.getByRole('combobox',{name:'成员'}));
    await user.click(await screen.findByRole('option', { name: person.label }));
    await user.click(screen.getByLabelText('生效时间'));
    await user.type(screen.getByLabelText('生效时间'), '2026-10-08 18:00{Enter}');
    await user.click(screen.getByLabelText('失效时间'));
    await user.type(screen.getByLabelText('失效时间'), '2026-10-09 18:00{Enter}');
    await user.type(screen.getByRole('textbox',{name:'授权原因'}),'合成导航保留');await user.click(screen.getByRole('button',{name:'预览权限'}));await screen.findByText('预览，尚未保存');
    await user.click(screen.getByTestId('nav-overview'));await user.click(screen.getByTestId('nav-settings'));
    expect(screen.getByText('预览，尚未保存')).toBeVisible();expect(fixture.grants).toHaveLength(0);
    await user.click(screen.getByRole('button',{name:'返回修改'}));expect(screen.getByRole('textbox',{name:'授权原因'})).toHaveValue('合成导航保留');
  }finally{cleanup();owner.dispose();}
}, 20000);

it('keeps the intake pages inside 980 by 680 in light and dark', async () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  window.dashboardIntake = {
    mode: async () => ({ ok: true, enabled: true }),
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
    onInvalidated: () => () => undefined,
  };
  const owner = new ContentIntakePermissions(intakePermissionsData().session);
  window.dashboardPermissions = { current: async () => ({ ok: true, view: owner.view() }), command: async (command) => ({ ok: true, view: await owner.command(command) }), onInvalidated: (fn) => owner.subscribe(fn) };
  showPermissionsNav();
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
    const pages = ['overview', 'wording', 'sop', 'materials', 'settings'] as const;
    for (const theme of ['light', 'dark'] as const) {
      await user.click(screen.getByTestId('dashboard-theme-trigger'));
      await user.click(screen.getByTestId(`dashboard-theme-${theme}`));
      expect(shell).toHaveAttribute('data-theme', theme);
      if (theme === 'dark') {
        await waitFor(() => expectSurface(content, 'dark'));
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
    expect(screen.getByTestId('module-sop')).toHaveTextContent('SOP 学习与执行尚未开放。');
    await user.click(screen.getByTestId('nav-wording'));
    expect(screen.getByRole('region', { name: '可用话术目录' })).toBeInTheDocument();
    await user.click(screen.getByTestId('nav-settings'));
    expect(content).toHaveAttribute('data-active-module', 'settings');
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

it.each(['light', 'dark'] as const)('keeps add, grant and seat dialog keyboard flows usable at 980 by 680 in %s mode', async (theme) => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  window.dashboardIntake = {
    mode: async () => ({ ok: true, enabled: true }),
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
    onInvalidated: () => () => undefined,
  };
  const owner = new ContentIntakePermissions(intakePermissionsData().session);
  window.dashboardPermissions = { current: async () => ({ ok: true, view: owner.view() }), command: async (command) => ({ ok: true, view: await owner.command(command) }), onInvalidated: (fn) => owner.subscribe(fn) };
  showPermissionsNav();
  window.dashboardSeats = { command: async (intent) => (intent.action === 'list' ? { ok: true, action: 'list' as const, seats: [] } : { ok: false, message: '未保存' }) };
  installShippedDashboardCss();
  allowGrant();
  document.documentElement.style.width = '980px';
  document.body.style.cssText = 'width:980px;height:680px;margin:0';
  const user = userEvent.setup();
  try {
    render(<DashboardApp />);
    const shell = await screen.findByTestId('dashboard-shell');
    shell.style.width = '980px';
    shell.style.height = '680px';
    const content = screen.getByTestId('dashboard-content');
    await user.click(screen.getByTestId('dashboard-theme-trigger'));
    await user.click(screen.getByTestId(`dashboard-theme-${theme}`));
    expect(shell).toHaveAttribute('data-theme', theme);
    if (theme === 'dark') await waitFor(() => expectSurface(content, 'dark'));

    await user.click(screen.getByTestId('nav-settings'));
    const businessTab = screen.queryByRole('tab', { name: '权限' });
    if (businessTab && businessTab.getAttribute('aria-selected') !== 'true') await user.click(businessTab);
    await screen.findByRole('row', { name: /合成坐席/ });
    expect(screen.queryByRole('button', { name: '停止等待' })).not.toBeInTheDocument();
    expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增授权' }));
    const grant = screen.getByRole('dialog', { name: '新增授权' });
    await tabUntil(user, within(grant).getByRole('button', { name: '关闭' }));
    await tabUntil(user, within(grant).getByRole('combobox', { name: '成员' }));
    await user.click(within(grant).getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '账号' }));
    await user.click(screen.getByRole('button', { name: '新建账号' }));
    const seat = screen.getByRole('dialog', { name: '新建账号' });
    await tabUntil(user, within(seat).getByRole('button', { name: '关闭' }));
    await tabUntil(user, within(seat).getByLabelText('姓名'));
    await user.click(within(seat).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(content.scrollWidth).toBeLessThanOrEqual(Math.max(content.clientWidth, 980));

    await user.click(screen.getByTestId('nav-wording'));
    const refresh = await screen.findByRole('button', { name: '刷新可用资料' });
    await tabUntil(user, refresh);
    expect(screen.getByRole('region', { name: '可用话术目录' })).toBeInTheDocument();
    expect(content.scrollWidth).toBeLessThanOrEqual(Math.max(content.clientWidth, 980));
    await user.click(screen.getByTestId('nav-settings'));
    await user.click(screen.getByRole('tab', { name: '权限' }));
    await user.click(screen.getByRole('button', { name: '新增授权' }));
    const person = owner.view().people[0]!;
    await user.click(screen.getByRole('combobox', { name: '成员' }));
    await user.click(await screen.findByRole('option', { name: person.label }));
    await user.click(screen.getByLabelText('生效时间'));
    await user.type(screen.getByLabelText('生效时间'), '2026-10-08 10:00{Enter}');
    await user.click(screen.getByLabelText('失效时间'));
    await user.type(screen.getByLabelText('失效时间'), '2026-10-09 10:00{Enter}');
    await user.type(screen.getByRole('textbox', { name: '授权原因' }), '焦点撤销');
    await user.click(screen.getByRole('button', { name: '预览权限' }));
    await screen.findByText('预览，尚未保存');
    expect(owner.view().grants).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '确认保存权限' }));
    await screen.findByText(/本次操作已保存/);
    await user.click(screen.getByRole('button', { name: '刷新权限列表' }));
    await user.click(await screen.findByRole('button', { name: '查看权限' }));
    const revoke = await screen.findByRole('button', { name: '撤销该权限' });
    expect(revoke).toHaveClass('ant-btn-dangerous');
    await tabUntil(user, revoke);
    await user.click(revoke);
    await tabUntil(user, screen.getByRole('textbox', { name: '撤销原因' }));
    await user.type(screen.getByRole('textbox', { name: '撤销原因' }), '合成撤销');
    const confirm = screen.getByRole('button', { name: '确认撤销' });
    expect(confirm).toHaveClass('ant-btn-dangerous');
    await tabUntil(user, confirm);
    expect(screen.queryByText(/读取资格已到期/)).not.toBeInTheDocument();
  } finally {
    owner.dispose();
    delete window.dashboardSeats;
    delete window.dashboardUsageLog;
    document.documentElement.style.width = '';
    document.body.style.cssText = '';
  }
}, 20000);

it('opens 话术库 for page=announce and leaves that URL alone', () => {
  expect(intakeDestinationsExcludeAnnounce).toBe(true);
  const location = { hostname: '127.0.0.1', search: '?preview=intake&page=announce' };
  expect(readIntakePreviewPage(location, true)).toBe('wording');
  expect(readIntakePreviewPage(location, false)).toBe('wording');
  expect(location.search).toBe('?preview=intake&page=announce');
  expect(readIntakePreviewPage({ hostname: '127.0.0.1', search: '?preview=intake&page=permissions' }, false)).toBe('overview');
  expect(readIntakePreviewPage({ hostname: '127.0.0.1', search: '?preview=intake&page=permissions' }, true)).toBe('settings');
  expect(readIntakePreviewPage({ hostname: '127.0.0.1', search: '?preview=intake&page=settings' }, true)).toBe('settings');
  expect(readIntakePreviewPage({ hostname: '127.0.0.1', search: '?preview=intake&page=materials' }, false)).toBe('materials');
  expect(readIntakePreviewPage({ hostname: 'example.test', search: '?preview=intake&page=wording' }, true)).toBe('overview');
  expect(readIntakePreviewPage({ hostname: '127.0.0.1', search: '?page=announce' }, true)).toBe('overview');
  expect(readIntakePreviewPage({ hostname: 'localhost', search: '?preview=intake&page=nope' }, true)).toBe('overview');
  window.history.replaceState({}, '', '/?preview=intake&page=announce');
  try {
    render(<DashboardApp />);
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'wording');
    expect(screen.getByRole('region', { name: '可用话术目录' })).toBeInTheDocument();
    expect(window.location.search).toBe('?preview=intake&page=announce');
  } finally {
    window.history.replaceState({}, '', '/');
  }
});

it('shows the signed-in account at the bottom of the sidebar and logs out through the dashboard bridge', async () => {
  const user = userEvent.setup();
  allowGrant();
  let signedIn = true;
  const changed: { notify: (() => void) | null } = { notify: null };
  const base = window.dashboardContent!;
  const logout = vi.fn(async () => ({ ok: false as const, code: 'UNAVAILABLE' as const, message: '已退出本机，服务端退出未确认。' }));
  window.dashboardContent = {
    ...base,
    session: async () => signedIn ? base.session() : { ok: true, enabled: true, signedIn: false, role: null, displayName: null, job: null },
    logout,
    onSessionChanged: (listener: () => void) => { changed.notify = listener; return () => { changed.notify = null; }; },
  } as typeof window.dashboardContent;
  render(<DashboardApp />);
  const account = await screen.findByRole('button', { name: '账号信息' });
  await waitFor(() => expect(account).toHaveTextContent('合成管理员'));
  expect(account).toHaveTextContent('客服总监');
  await user.click(account);
  await user.click(await screen.findByRole('menuitem', { name: /退出登录/ }));
  expect(logout).toHaveBeenCalledWith();
  expect(await screen.findByText('已退出本机，服务端退出未确认。')).toHaveAttribute('role','alert');
  signedIn = false;
  changed.notify?.();
  expect(await screen.findByText('未登录')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '账号信息' })).not.toBeInTheDocument();
});
