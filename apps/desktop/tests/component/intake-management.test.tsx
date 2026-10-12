import { act, render, screen, waitFor, within } from '@testing-library/react';
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
  const confirmation = vi.fn().mockResolvedValue(true);
  const main = new ContentIntakeManagement(session, undefined, confirmation);
  const command = vi.fn(async (c: Parameters<ContentIntakeManagement['command']>[0]) => ({ ok: true as const, view: await main.command(c) }));
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }), current: async () => ({ ok: true, view: main.view() }), command,
    onInvalidated: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const user = userEvent.setup();
  return { data, main, command, user, listeners, confirmation };
}
it('requires explicit human checks and blocks submitting an older saved judgment after editing it', async () => {
  const f = setup(); f.data.candidate.sourceEvidenceVersion = 1; render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
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
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '来源版本' })).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: '来源版本', hidden: true })).toHaveValue('');
    expect(screen.queryByRole('button', { name: '发起组织审批' })).not.toBeInTheDocument();
    await f.user.type(screen.getByRole('textbox', { name: '发布标题' }), '合成 FAQ 更新');
    await f.user.type(screen.getByRole('textbox', { name: '发布摘要' }), '新增已核对条目');
    f.confirmation.mockResolvedValue(false);
    await f.user.click(screen.getByRole('button', { name: '发布当前候选' }));
    await waitFor(() => expect(f.confirmation).toHaveBeenCalledTimes(1));
    expect(f.data.candidate.state).toBe('ready');
    expect(f.data.candidate.publishedReleaseId).toBeNull();
    expect(screen.getByRole('textbox', { name: '发布标题' })).toHaveValue('合成 FAQ 更新');
    f.confirmation.mockResolvedValue(true);
    await f.user.click(screen.getByRole('button', { name: '发布当前候选' }));
    expect(f.command).toHaveBeenCalledWith({ action: 'publish', title: '合成 FAQ 更新', summary: '新增已核对条目' });
    await screen.findByText(/当前候选已发布：rel_2/);
    expect(screen.queryByRole('button', { name: '发布当前候选' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '发布标题', hidden: true })).toHaveValue('');
  } finally { f.main.dispose(); }
});
it('legacy candidates show read-only history and cannot bypass an explicit revision for direct publication', async () => {
  const f = setup(); f.data.historicalReview(); f.data.candidate.sourceEvidenceVersion = 1; f.data.candidate.state = 'ready';
  render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    expect(screen.queryByRole('button', { name: '发起组织审批' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新审批结果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布当前候选' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '读取历史审批' }));
    await screen.findByText(/组织审批已通过 · 审批编号 synthetic-history/);
    expect(f.data.candidate.publicationPolicy).toBe('approval-v1');
    expect(f.data.candidate.approvalEvidenceVersion).toBe(1);
  } finally { f.main.dispose(); }
});
it('keeps an unsaved quality judgment isolated from source and publication mutations', async () => {
  const f = setup(); f.data.candidate.sourceEvidenceVersion = 1; render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    await f.user.click(screen.getByRole('button', { name: '冻结本次抽样' }));
    await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    await f.user.selectOptions(screen.getByRole('combobox', { name: '检查结论 合成洁面 1' }), 'pass');
    expect(screen.queryByRole('textbox', { name: '来源版本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布当前候选' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '保存本条判断' }));
    expect(screen.queryByRole('button', { name: '发布当前候选' })).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});
it('keeps source entry on its own step and opens quality only after confirmation', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), 'source-v2');
    await f.user.type(screen.getByRole('textbox', { name: '来源确认说明' }), '人工核对来源');
    expect(screen.getByRole('button', { name: '确认来源版本' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '冻结本次抽样' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '读取初检' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '确认来源版本' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '来源版本' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '读取初检' })).toBeEnabled();
    expect(f.main.view().hasDraft).toBe(false);
  } finally { f.main.dispose(); }
});
it('preserves unsubmitted source input across a status read and clears that form when confirmation leaves the current step', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), 'export-v1');
    await f.user.type(screen.getByRole('textbox', { name: '来源确认说明' }), '人工确认');
    await f.user.click(screen.getByRole('button', { name: '刷新候选状态' }));
    expect(screen.getByRole('textbox', { name: '来源版本' })).toHaveValue('export-v1');
    expect(f.data.candidate.sourceEvidenceVersion).toBe(0);
    await f.user.click(screen.getByRole('button', { name: '确认来源版本' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '来源版本' })).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: '来源版本', hidden: true })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: '来源确认说明', hidden: true })).toHaveValue('');
    expect(screen.getByRole('button', { name: '读取初检' })).toBeInTheDocument();
    expect(f.data.candidate.sourceEvidenceVersion).toBe(1);
    expect(f.data.workflowReceipts.size).toBe(1);
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
      expect(screen.queryByRole('button', { name: '发布当前候选' })).not.toBeInTheDocument();
    }
  } finally { confirm.mockRestore(); f.main.dispose(); }
});

it('guides the existing material, source, quality and publish flow without issuing commands on navigation', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    const guide = () => within(screen.getByRole('region', { name: '当前步骤' }));
    expect(guide().getByRole('heading', { name: '1. 核对材料' })).toBeInTheDocument();
    const target = within(screen.getByRole('region', { name: '当前候选' })).getByRole('heading', { name: '1. 核对材料' });
    const scroll = vi.fn(); Object.defineProperty(target, 'scrollIntoView', { value: scroll });
    const calls = f.command.mock.calls.length;
    await f.user.click(guide().getByRole('button', { name: '前往当前步骤' }));
    expect(target).toHaveFocus(); expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    expect(f.command).toHaveBeenCalledTimes(calls);
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    expect(guide().getByRole('heading', { name: '2. 确认来源' })).toBeInTheDocument();
    await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), 'export-1');
    await f.user.type(screen.getByRole('textbox', { name: '来源确认说明' }), '已核对合成来源');
    expect(guide().getByRole('heading', { name: '完成来源确认' })).toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '确认来源版本' }));
    await waitFor(() => expect(guide().getByRole('heading', { name: '3. 完成质量检查' })).toBeInTheDocument());
    await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    await f.user.click(screen.getByRole('button', { name: '冻结本次抽样' }));
    await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    await f.user.selectOptions(screen.getByRole('combobox', { name: '检查结论 合成洁面 1' }), 'pass');
    await f.user.click(screen.getByRole('button', { name: '保存本条判断' }));
    expect(guide().getByRole('heading', { name: '完成本轮质量检查' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布当前候选' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '提交本轮人工检查' }));
    expect(guide().getByRole('heading', { name: '读取最新检查状态' })).toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '读取初检' }));
    expect(guide().getByRole('heading', { name: '核对候选状态' })).toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '刷新候选状态' }));
    expect(guide().getByRole('heading', { name: '4. 确认发布' })).toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it('directs an unknown publication to its original recovery and removes the guide on access invalidation', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    const pendingView = { ...f.main.view(), pending: { action: 'publish' as const, operationId: 'synthetic-unknown', recovery: 'receipt' as const } };
    window.dashboardIntake!.current = async () => ({ ok: true, view: pendingView });
    await act(async () => { f.listeners.forEach(listener => listener()); });
    const guide = within(screen.getByRole('region', { name: '当前步骤' }));
    expect(guide.getByRole('heading', { name: '确认上次操作结果' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布当前候选' })).not.toBeInTheDocument();
    const target = screen.getByRole('heading', { name: '操作结果待确认' });
    Object.defineProperty(target, 'scrollIntoView', { value: vi.fn() });
    const calls = f.command.mock.calls.length;
    await f.user.click(guide.getByRole('button', { name: '前往当前步骤' }));
    expect(target).toHaveFocus(); expect(f.command).toHaveBeenCalledTimes(calls);
    window.dashboardIntake!.current = async () => ({ ok: false, code: 'UNAUTHORIZED', message: '未登录', view: null });
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.queryByRole('region', { name: '当前步骤' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布当前候选' })).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it('leaves rollback input, an active plan and unknown recovery with the rollback panel instead of candidate guidance', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /source-a/ }));
    const view = f.main.view(); view.rollback.available = true;
    if (view.selected) view.selected.state = 'published';
    for (const row of view.candidates) row.candidate.state = 'published';
    window.dashboardIntake!.current = async () => ({ ok: true, view: structuredClone(view) });
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.getByRole('region', { name: '当前步骤' })).toBeInTheDocument();
    const input = screen.getByRole('combobox', { name: '当前发布版本' });
    await f.user.type(input, 'rel_2');
    expect(screen.queryByRole('region', { name: '当前步骤' })).not.toBeInTheDocument();
    await f.user.clear(input);
    expect(screen.getByRole('region', { name: '当前步骤' })).toBeInTheDocument();
    view.rollback.impact = { baseReleaseId: 'rel_2', targetReleaseId: 'rel_1', scopes: [], requiresCorrectiveCandidate: false };
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.queryByRole('region', { name: '当前步骤' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭回退计划' })).toBeInTheDocument();
    view.rollback.impact = null; // Unknown recovery must also work after material was withdrawn.
    view.rollback.pending = { action: 'rollback', recovery: 'receipt' };
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.queryByRole('region', { name: '当前步骤' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查询原回退回执' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '发布当前候选' })).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it('opens the materials page as a candidate table and expands only the current step', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    expect(await screen.findByRole('columnheader', { name: '名称' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['名称', '范围', '状态', '下一步', '时间']);
    expect(screen.getByRole('cell', { name: 'shop-a · 产品' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: '候选筛选' })).getAllByRole('button').map(button => button.textContent)).toEqual(['待我处理', '已发布', '全部']);
    expect(screen.getByRole('button', { name: '选择 CSV / Excel 文件' })).not.toHaveClass('dash-action-primary');
    await f.user.click(screen.getByRole('button', { name: 'source-a' }));
    const open = within(screen.getByRole('region', { name: '当前候选' }));
    expect(open.getByRole('heading', { name: '1. 核对材料' })).toBeInTheDocument();
    expect(open.queryByRole('heading', { name: '2. 确认来源' })).not.toBeInTheDocument();
    expect(open.queryByRole('heading', { name: '3. 质量检查' })).not.toBeInTheDocument();
    expect(open.queryByRole('heading', { name: '4. 确认发布' })).not.toBeInTheDocument();
    expect(open.getAllByRole('button').filter(button => button.classList.contains('dash-action-primary')).map(button => button.textContent)).toEqual(['查看材料']);
    await f.user.click(open.getByRole('button', { name: '查看材料' }));
    expect(open.queryByRole('heading', { name: '1. 核对材料' })).not.toBeInTheDocument();
    expect(open.getByRole('heading', { name: '2. 确认来源' })).toBeInTheDocument();
    expect(open.getByRole('heading', { name: '合成洁面' })).toBeInTheDocument();
    expect(open.getByText(/风险等级：常规内容/)).toBeInTheDocument();
    expect(open.getByRole('button', { name: '下一页材料' })).not.toHaveClass('dash-action-primary');
    expect(open.getAllByRole('button').filter(button => button.classList.contains('dash-action-primary')).map(button => button.textContent)).toEqual(['确认来源版本']);
  } finally { f.main.dispose(); }
});

it('keeps rollback on the published row', async () => {
  const f = setup(); f.data.candidate.state = 'published'; f.data.state.rollback = true; render(<IntakeManagement />);
  try {
    await screen.findByRole('columnheader', { name: '名称' });
    expect(screen.getByText('这个筛选下没有候选。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '回退' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '已发布' }));
    expect(screen.getByRole('button', { name: '回退' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'source-a' })).toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: 'source-a' }));
    const named = await screen.findByRole('region', { name: '已发布目录纠正回退' });
    expect(named).not.toHaveFocus();
    await f.user.click(screen.getByRole('button', { name: '回退' }));
    expect(await screen.findByRole('region', { name: '已发布目录纠正回退' })).toHaveFocus();
  } finally { f.main.dispose(); }
});

it('shows publishing as its status and does not offer a material check', async () => {
  const f = setup();
  f.data.candidate.state = 'publishing';
  render(<IntakeManagement />);
  try {
    expect(await screen.findByRole('cell', { name: 'shop-a · 产品' })).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: '发布中' })).toHaveLength(2);
    expect(screen.queryByRole('cell', { name: '核对材料' })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: '质量检查' })).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});
