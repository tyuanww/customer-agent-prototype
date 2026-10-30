import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import type { PageUseSnapshot } from '../../src/shared/page-use';

function installPageUse(snapshot: PageUseSnapshot) {
  window.dashboardPageUse = {
    current: async () => snapshot,
    onChanged: () => () => undefined,
  };
}

const openSnapshot: PageUseSnapshot = {
  phase: 'ready',
  epoch: 1,
  permissions: { state: 'open', body: null },
  sop: { state: 'closed' },
};

afterEach(() => {
  cleanup();
  delete window.dashboardWorkbench;
  delete window.dashboardPermissions;
  delete window.dashboardPageUse;
});

it('keeps the current workbench pages when the mode is product-remote', async () => {
  installPageUse(openSnapshot);
  window.dashboardPermissions = {
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '', view: null }),
    onInvalidated: () => () => undefined,
  } as unknown as Window['dashboardPermissions'];
  window.dashboardWorkbench = { mode: async () => ({ ok: true, kind: 'product-remote' }) };
  render(<DashboardApp />);
  expect(await screen.findByTestId('nav-materials')).toHaveAccessibleName('资料审核');
  expect(await screen.findByTestId('nav-permissions')).toHaveAccessibleName('成员与权限');
  expect(screen.queryByTestId('nav-content')).not.toBeInTheDocument();
  expect(screen.getByTestId('nav-wording')).toHaveAccessibleName('内容库');
  expect(screen.queryByTestId('nav-publish')).not.toBeInTheDocument();
  expect(screen.getByTestId('nav-sop')).toBeInTheDocument();
  expect(screen.queryByTestId('nav-announce')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '系统同步' })).not.toBeInTheDocument();
});

it('hides 权限 when the command channel exists and the snapshot is closed', async () => {
  installPageUse({ phase: 'signed-out' });
  window.dashboardPermissions = {
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '', view: null }),
    onInvalidated: () => () => undefined,
  } as unknown as Window['dashboardPermissions'];
  render(<DashboardApp />);
  expect(await screen.findByTestId('nav-sop')).toBeInTheDocument();
  expect(screen.queryByTestId('nav-permissions')).not.toBeInTheDocument();
});

it('keeps 权限 and 资料 when the mode is faq-v2', async () => {
  installPageUse(openSnapshot);
  window.dashboardPermissions = {
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '', view: null }),
    onInvalidated: () => () => undefined,
  } as unknown as Window['dashboardPermissions'];
  window.dashboardWorkbench = { mode: async () => ({ ok: true, kind: 'faq-v2' }) };
  render(<DashboardApp />);
  expect(await screen.findByTestId('nav-permissions')).toHaveAccessibleName('成员与权限');
  expect(screen.getByTestId('nav-materials')).toHaveAccessibleName('资料审核');
});
