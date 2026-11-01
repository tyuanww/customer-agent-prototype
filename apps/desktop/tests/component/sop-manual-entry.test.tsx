import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';

const previous = window.dashboardWorkbench;
afterEach(() => { window.dashboardWorkbench = previous; });

it('opens the shared synthetic manual only after Main confirms offline mode', async () => {
  window.dashboardWorkbench = { mode: vi.fn().mockResolvedValue({ ok: true, kind: 'synthetic-offline' }) };
  render(<DashboardApp />);
  await waitFor(() => expect(window.dashboardWorkbench?.mode).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId('nav-sop'));
  await screen.findByRole('region', { name: 'SOP 手册' });
  expect(screen.queryByRole('button', { name: '下一步' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '复制话术' })).not.toBeInTheDocument();
});

it.each(['product-remote', 'faq-v2', 'legacy'])('never substitutes synthetic content for %s', async kind => {
  window.dashboardWorkbench = { mode: vi.fn().mockResolvedValue({ ok: true, kind }) };
  render(<DashboardApp />);
  await waitFor(() => expect(window.dashboardWorkbench?.mode).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId('nav-sop'));
  expect(screen.queryByRole('region', { name: 'SOP 手册' })).not.toBeInTheDocument();
});

it('keeps the manual closed when the mode handshake fails', async () => {
  window.dashboardWorkbench = { mode: vi.fn().mockRejectedValue(new Error('unavailable')) };
  render(<DashboardApp />);
  await waitFor(() => expect(window.dashboardWorkbench?.mode).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId('nav-sop'));
  expect(screen.queryByRole('region', { name: 'SOP 手册' })).not.toBeInTheDocument();
});
