import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';

afterEach(() => {
  cleanup();
  delete window.dashboardWorkbench;
  delete window.dashboardPermissions;
});

it('keeps the current workbench pages when the mode is product-remote', async () => {
  window.dashboardPermissions = {
    current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '', view: null }),
    command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '', view: null }),
    onInvalidated: () => () => undefined,
  } as unknown as Window['dashboardPermissions'];
  window.dashboardWorkbench = { mode: async () => ({ ok: true, kind: 'product-remote' }) };
  render(<DashboardApp />);
  expect(await screen.findByTestId('nav-materials')).toHaveAccessibleName('资料管理');
  expect(screen.getByTestId('nav-permissions')).toHaveAccessibleName('权限');
  expect(screen.getByTestId('nav-content')).toHaveAccessibleName(/知识库/);
  expect(screen.getByTestId('nav-publish')).toHaveAccessibleName('内容管理');
  expect(screen.getByTestId('nav-sop')).toBeInTheDocument();
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
