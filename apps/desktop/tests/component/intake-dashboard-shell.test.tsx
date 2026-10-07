import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { DASHBOARD_WINDOW_TITLE } from '../../src/shared/dashboard-window';

afterEach(() => { delete window.dashboardIntake; delete window.dashboardContent; vi.unstubAllGlobals(); });

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
  expect(document.title).toBe(DASHBOARD_WINDOW_TITLE);
  expect(within(shell).getAllByRole('tab')).toHaveLength(1);
  const tab = screen.getByTestId('nav-content');
  expect(tab).toHaveAttribute('aria-selected', 'true');
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    fireEvent.keyDown(tab, { key });
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'content');
  }
  await user.click(screen.getByTestId('dashboard-theme-trigger'));
  await user.click(screen.getByTestId('dashboard-theme-dark'));
  expect(shell).toHaveAttribute('data-theme', 'dark');
  expect(document.documentElement.style.colorScheme).toBe('dark');
  fireEvent.focus(window);
  expect(legacySession).not.toHaveBeenCalled();
  expect(screen.queryByTestId('overview-kpi-source')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '资料审核' })).toBeInTheDocument();
});

it('fails closed before choosing a workspace profile when the mode lookup fails', async () => {
  window.dashboardIntake = { mode: async () => ({ ok: false, code: 'UNAVAILABLE' }),
    current: vi.fn(), command: vi.fn(), onInvalidated: vi.fn() } as unknown as typeof window.dashboardIntake;
  render(<DashboardApp />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('管理模式不可用'));
  expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument();
  expect(window.dashboardIntake!.command).not.toHaveBeenCalled();
});
