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
it('submits source and publication human intent through Main and displays the published release', async () => {
  const f = setup(); f.data.status.state = 'passed'; render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.selectOptions(screen.getByRole('combobox', { name: '来源版本类型' }), 'integer');
    await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), '7');
    await f.user.type(screen.getByRole('textbox', { name: '来源确认说明' }), '人工核对合成导出');
    await f.user.click(screen.getByRole('button', { name: '确认来源版本' }));
    expect(f.command).toHaveBeenCalledWith({ action: 'confirm-source', versionKind: 'integer', versionValue: '7', reason: '人工核对合成导出' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: '来源版本' })).toHaveValue(''));
    await f.user.click(screen.getByRole('button', { name: '发起组织审批' }));
    await f.user.click(screen.getByRole('button', { name: '刷新审批结果' }));
    await screen.findByText(/组织审批已通过 · 审批编号/);
    await f.user.type(screen.getByRole('textbox', { name: '发布标题' }), '合成 FAQ 更新');
    await f.user.type(screen.getByRole('textbox', { name: '发布摘要' }), '新增已核对条目');
    await f.user.click(screen.getByRole('button', { name: '发布当前候选' }));
    expect(f.command).toHaveBeenCalledWith({ action: 'publish', title: '合成 FAQ 更新', summary: '新增已核对条目' });
    await screen.findByText(/当前候选已发布：rel_2/);
    expect(screen.getByRole('button', { name: '发布当前候选' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '发布标题' })).toHaveValue('');
  } finally { f.main.dispose(); }
});
it('only offers original-request retry while approval creation remains uncertain', async () => {
  const f = setup(); f.data.candidate.sourceEvidenceVersion = 1; f.data.state.creating = true; render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '发起组织审批' }));
    await screen.findByRole('heading', { name: '操作结果待确认' });
    expect(screen.queryByRole('button', { name: '查询原操作回执' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试原操作' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '发起组织审批' })).toBeDisabled();
    f.data.state.creating = false; await f.user.click(screen.getByRole('button', { name: '重试原操作' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '操作结果待确认' })).not.toBeInTheDocument());
    expect(f.data.candidate.approvalEvidenceVersion).toBe(1);
  } finally { f.main.dispose(); }
});
it('allows a deliberate replacement of a completed rejected review without enabling it for an uncertain creation', async () => {
  const f = setup(); f.data.candidate.sourceEvidenceVersion = 1;
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '发起组织审批' }));
    const review = [...f.data.workflowReceipts.values()].find(v => (v as { reviewRequestId?: string }).reviewRequestId) as { state: string };
    review.state = 'rejected'; await f.user.click(screen.getByRole('button', { name: '读取审批状态' }));
    const repeat = screen.getByRole('button', { name: '重新发起组织审批' });
    expect(repeat).toBeEnabled(); await f.user.click(repeat);
    expect(confirmation).toHaveBeenCalled(); expect(f.data.candidate.approvalEvidenceVersion).toBe(2);
  } finally { confirmation.mockRestore(); f.main.dispose(); }
});
it('keeps an unsaved quality judgment isolated from source and approval mutations', async () => {
  const f = setup(); f.data.candidate.sourceEvidenceVersion = 1; render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    await f.user.click(screen.getByRole('button', { name: '冻结本次抽样' }));
    await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    await f.user.selectOptions(screen.getByRole('combobox', { name: '检查结论 合成洁面 1' }), 'pass');
    expect(screen.getByRole('textbox', { name: '来源版本' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发起组织审批' })).toBeDisabled();
    await f.user.click(screen.getByRole('button', { name: '保存本条判断' }));
    expect(screen.getByRole('button', { name: '发起组织审批' })).toBeDisabled(); // Main-owned draft still needs submission
  } finally { f.main.dispose(); }
});
it.each([false, true])('keeps a source form editable while excluding quality writes (frozen=%s)', async frozen => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    if (frozen) {
      await f.user.click(screen.getByRole('button', { name: '冻结本次抽样' }));
      await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    }
    await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), 'source-v2');
    await f.user.type(screen.getByRole('textbox', { name: '来源确认说明' }), '人工核对来源');
    const ownSubmit = screen.getByRole('button', { name: '确认来源版本' });
    expect(ownSubmit).toBeEnabled();
    if (frozen) expect(screen.getByRole('combobox', { name: '检查结论 合成洁面 1' })).toBeDisabled();
    else expect(screen.getByRole('button', { name: '冻结本次抽样' })).toBeDisabled();
    await f.user.click(ownSubmit);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '来源版本' })).toHaveValue(''));
    if (frozen) expect(screen.getByRole('combobox', { name: '检查结论 合成洁面 1' })).toBeEnabled();
    else expect(screen.getByRole('button', { name: '冻结本次抽样' })).toBeEnabled();
    expect(f.main.view().hasDraft).toBe(false);
  } finally { f.main.dispose(); }
});
it('distinguishes a bound review awaiting its first observation from an observed unavailable service', async () => {
  const f = setup(); f.data.candidate.sourceEvidenceVersion = 1;
  const original = f.data.respond;
  f.data.respond = (path, body) => {
    const value = original(path, body);
    if (path.endsWith('/review') && body) (value as { state: string }).state = 'unavailable';
    return value;
  };
  render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '发起组织审批' }));
    await screen.findByText(/尚未核验审批结果 · 审批编号 synthetic-instance/);
    expect(screen.queryByText(/审批服务暂不可用/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新审批结果' })).toBeEnabled();
    const review = [...f.data.workflowReceipts.values()].find(v => (v as { reviewRequestId?: string }).reviewRequestId) as { checkedAt: string };
    review.checkedAt = new Date().toISOString();
    await f.user.click(screen.getByRole('button', { name: '读取审批状态' }));
    await screen.findByText(/审批服务暂不可用 · 审批编号 synthetic-instance/);
  } finally { f.main.dispose(); }
});
it('clears each confirmed source form by its operation identity and preserves new input across status reads', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    for (const version of ['export-v1', 'export-v2']) {
      await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), version);
      await f.user.type(screen.getByRole('textbox', { name: '来源确认说明' }), '人工确认');
      await f.user.click(screen.getByRole('button', { name: '刷新候选状态' }));
      expect(screen.getByRole('textbox', { name: '来源版本' })).toHaveValue(version);
      await f.user.click(screen.getByRole('button', { name: '确认来源版本' }));
      await waitFor(() => expect(screen.getByRole('textbox', { name: '来源版本' })).toHaveValue(''));
      expect(screen.getByRole('textbox', { name: '来源确认说明' })).toHaveValue('');
    }
    expect(f.data.candidate.sourceEvidenceVersion).toBe(2);
    expect(f.data.workflowReceipts.size).toBe(2);
  } finally { f.main.dispose(); }
});

it('explains candidate readiness and risk without exposing internal codes or prototype members', async () => {
  const f = setup();
  f.data.candidate.readinessReasons = ['SOURCE_CONFIRMATION_REQUIRED', 'AWAITING_APPROVAL', 'constructor', 'NEW_REASON'];
  render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    expect(screen.getByText(/待确认来源版本 \/ 待组织审批通过 \/ 还有待核验事项，请刷新候选状态/)).toBeInTheDocument();
    expect(screen.queryByText(/SOURCE_CONFIRMATION_REQUIRED|constructor|NEW_REASON/)).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    expect(await screen.findByText(/风险等级：常规内容/)).toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it.each(['revise', 'cancel-candidate'] as const)('requires explicit confirmation and a clean form before %s', async action => {
  const f = setup(); f.data.state.importer = true; f.data.state.canceller = true;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    const label = action === 'revise' ? '修订当前候选' : '取消当前候选';
    await f.user.click(screen.getByRole('button', { name: label }));
    expect(f.command.mock.calls.some(([c]) => c.action === action)).toBe(false);
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    const source = screen.getByRole('textbox', { name: '来源版本' });
    await f.user.type(source, '未提交来源');
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    await f.user.clear(source); confirm.mockReturnValue(true);
    await f.user.click(screen.getByRole('button', { name: label }));
    expect(f.command).toHaveBeenLastCalledWith({ action });
    if (action === 'revise') {
      await screen.findByText(/正在准备修订：candidate-a · 原版本 1/);
      expect(screen.queryByRole('region', { name: '当前候选' })).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: '上传来源' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '放弃本地修订' })).toBeEnabled();
    } else {
      await screen.findByText(/已取消 · 此版本不再接受修改或发布/);
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '发布当前候选' })).toBeDisabled();
    }
  } finally { confirm.mockRestore(); f.main.dispose(); }
});
