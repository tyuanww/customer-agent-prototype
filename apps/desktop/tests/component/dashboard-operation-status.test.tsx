import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardOperationStatus } from '../../src/renderer/features/dashboard/DashboardOperationStatus';

const operation = {
  domain: 'release' as const,
  operationId: 'operation-1',
  command: 'publish' as const,
  state: 'unknown' as const,
  updatedAt: '2026-11-05T08:00:00.000Z',
  recoveryDeadline: '2026-11-06T08:00:00.000Z',
  canCancel: false,
  canRecover: true,
  releaseInvalidationPending: false,
};

afterEach(() => {
  delete window.dashboardOperations;
});

it('shows one unknown result and recovers it without offering a retry', async () => {
  const command = vi.fn(async () => ({
    ok: true as const,
    view: { ...operation, state: 'committed' as const, canRecover: false },
    views: [{ ...operation, state: 'committed' as const, canRecover: false }],
  }));
  window.dashboardOperations = {
    current: vi.fn(async () => ({ ok: true as const, view: operation, views: [operation] })),
    command,
    onChanged: () => () => undefined,
  };
  render(<DashboardOperationStatus />);
  expect(await screen.findByText('内容发布结果还未确认。请按原请求确认结果。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认结果' }));
  expect(command).toHaveBeenCalledWith({ action: 'recover', domain: 'release' });
  await waitFor(() => expect(screen.queryByTestId('dashboard-operation-status')).not.toBeInTheDocument());
});

it('keeps unknown visible when durable lookup still cannot settle it', async () => {
  window.dashboardOperations = {
    current: vi.fn(async () => ({ ok: true as const, view: operation, views: [operation] })),
    command: vi.fn(async () => ({ ok: true as const, view: operation, views: [operation] })),
    onChanged: () => () => undefined,
  };
  render(<DashboardOperationStatus />);
  expect(await screen.findByTestId('dashboard-operation-status')).toHaveTextContent('结果还未确认');
  await userEvent.click(screen.getByRole('button', { name: '确认结果' }));
  expect(await screen.findByText('内容发布结果还未确认。请按原请求确认结果。')).toBeInTheDocument();
});

it('offers stop-wait for a running operation and refresh for a committed release update', async () => {
  window.dashboardOperations = {
    current: vi.fn(async () => ({
      ok: true as const,
      view: { ...operation, state: 'running' as const, canCancel: true },
      views: [{ ...operation, state: 'running' as const, canCancel: true }],
    })),
    command: vi.fn(),
    onChanged: () => () => undefined,
  };
  const { unmount } = render(<DashboardOperationStatus />);
  expect(await screen.findByRole('button', { name: '停止等待' })).toBeInTheDocument();
  unmount();
  const committed = { ...operation, state: 'committed' as const, canRecover: false, releaseInvalidationPending: true };
  window.dashboardOperations = {
    current: vi.fn(async () => ({ ok: true as const, view: committed, views: [committed] })),
    command: vi.fn(),
    onChanged: () => () => undefined,
  };
  render(<DashboardOperationStatus />);
  expect(await screen.findByText('内容发布已保存，正在更新当前内容。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新查看' })).toBeInTheDocument();
});
