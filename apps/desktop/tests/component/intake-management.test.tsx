import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { IntakeManagement } from '../../src/renderer/features/dashboard/IntakeManagement';
import { ContentIntakeManagement } from '../../src/main/content-intake-management';
import type { ProductSession } from '../../src/main/product-session';
import { intakeManagementData } from '../fixtures/intake-management-data';
afterEach(() => { delete window.dashboardIntake; });
function setup() {
  const data = intakeManagementData(1), listeners = new Set<() => void>();
  const session: Pick<ProductSession, 'view' | 'subscribe' | 'request'> = {
    view: () => ({ ok: true, enabled: true, signedIn: true, sessionEpoch: 1, userId: 'synthetic', role: 'coach', authMode: 'mock', displayName: '合成审核员', expiresAt: '2099-01-01T00:00:00Z' }),
    subscribe: () => () => undefined,
    request: async (_epoch, path, options = {}) => ({ status: 200, value: structuredClone(data.respond(path, options.body)) }),
  };
  const main = new ContentIntakeManagement(session);
  const command = vi.fn(async (c: Parameters<ContentIntakeManagement['command']>[0]) => ({ ok: true as const, view: await main.command(c) }));
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }), current: async () => ({ ok: true, view: main.view() }), command,
    onInvalidated: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const user = userEvent.setup();
  return { data, main, command, user, listeners };
}
it('requires explicit human checks and blocks submitting an older saved judgment after editing it', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    await f.user.click(await screen.findByRole('button', { name: '冻结本次抽样' }));
    await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    const submit = await screen.findByRole('button', { name: '提交本轮人工检查' });
    expect(submit).toBeDisabled();
    const choice = screen.getByRole('combobox', { name: '检查结论 合成洁面 1' });
    await f.user.selectOptions(choice, 'pass'); await f.user.click(screen.getByRole('button', { name: '保存本条判断' }));
    await waitFor(() => expect(submit).toBeEnabled());
    await f.user.selectOptions(choice, 'defect');
    expect(submit).toBeDisabled();
    await f.user.type(screen.getByRole('textbox', { name: '判断说明 合成洁面 1' }), '合成缺陷');
    await f.user.click(screen.getByRole('button', { name: '保存本条判断' }));
    await f.user.click(submit);
    expect(f.data.receipts.size).toBe(2); expect(f.data.samples[0].check).toMatchObject({ defect: true, reason: '合成缺陷' });
  } finally { f.main.dispose(); }
});
it('rejects an invalidation read that arrives after a newer session notification', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await screen.findByRole('button', { name: /source-a/ });
    const old = f.main.view(); let resolve!: (r: Awaited<ReturnType<NonNullable<typeof window.dashboardIntake>['current']>>) => void;
    window.dashboardIntake!.current = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ ok: false, code: 'UNAUTHORIZED', message: '未登录', view: null });
    await act(async () => { f.listeners.forEach(f => f()); f.listeners.forEach(f => f()); });
    await act(async () => resolve({ ok: true, view: old }));
    expect(screen.queryByRole('button', { name: /source-a/ })).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});
