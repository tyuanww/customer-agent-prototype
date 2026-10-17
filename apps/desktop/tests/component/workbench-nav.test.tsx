import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';

afterEach(() => {
  cleanup();
  delete window.dashboardWorkbench;
  delete window.dashboardPermissions;
});

it('hides unfinished boards when the mode is product-remote and keeps 内容管理', async () => {
  window.dashboardWorkbench = { mode: async () => ({ ok: true, kind: 'product-remote' }) };
  render(<DashboardApp />);
  expect(await screen.findByTestId('nav-publish')).toHaveAccessibleName('内容管理');
  expect(screen.queryByTestId('nav-materials')).toBeNull();
  expect(screen.queryByTestId('nav-permissions')).toBeNull();
  expect(screen.queryByRole('button', { name: '知识库' })).toBeNull();
  expect(screen.getByTestId('nav-announce')).toBeInTheDocument();
});

it('keeps 权限 and 资料管理 when the mode is faq-v2', async () => {
  window.dashboardPermissions = {
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '', view: null }),
    onInvalidated: () => () => undefined,
  } as unknown as Window['dashboardPermissions'];
  window.dashboardWorkbench = { mode: async () => ({ ok: true, kind: 'faq-v2' }) };
  render(<DashboardApp />);
  expect(await screen.findByTestId('nav-permissions')).toHaveAccessibleName('权限');
  expect(screen.getByTestId('nav-materials')).toHaveAccessibleName('资料管理');
});
