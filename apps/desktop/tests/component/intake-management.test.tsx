import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { IntakeManagement } from '../../src/renderer/features/dashboard/IntakeManagement';
import { renderIntakeDestinations, type IntakeDestinationContext } from '../../src/renderer/features/dashboard/intake-destinations';
import { ContentIntakeManagement } from '../../src/main/content-intake-management';
import type { ProductSession } from '../../src/main/product-session';
import type { IntakeManagementReply } from '../../src/shared/content-intake-management';
import { intakeManagementData } from '../fixtures/intake-management-data';
afterEach(() => { delete window.dashboardIntake; });
function setup() {
  const data = intakeManagementData(1), listeners = new Set<() => void>();
  const session: Pick<ProductSession, 'view' | 'subscribe' | 'request'> = {
    view: () => ({ ok: true, enabled: true, signedIn: true, sessionEpoch: 1, userId: 'synthetic', role: 'coach', authMode: 'mock', displayName: '合成审核员', expiresAt: '2099-01-01T00:00:00Z', job: null }),
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
async function choose(user: ReturnType<typeof userEvent.setup>, name: string, option: string) {
  await user.click(screen.getByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
}

function destinationContext(overrides: Partial<IntakeDestinationContext> = {}): IntakeDestinationContext {
  return {
    active: 'materials', canOpenPermissions: false, canGrant: false, canUploadSop: false,
    seatLibraryOnly: false, jobKnown: true, jobPending: false, sessionKey: 'owner:director', workbenchMode: 'faq-v2',
    snapshot: { phase: 'signed-out' }, onOpen: () => undefined, onTodoCount: () => undefined,
    onSupplyScript: () => undefined, scriptDraft: null, onDraftConsumed: () => undefined,
    ...overrides,
  };
}

it('reuses the authorized overview list when opening the review page', async () => {
  const f = setup(), onOpen = vi.fn();
  const page = render(renderIntakeDestinations(destinationContext({ active: 'overview', onOpen })));
  try {
    expect(await screen.findByRole('cell', { name: /产品 \/ candidate-a/ })).toBeInTheDocument();
    expect(screen.getByTestId('module-overview')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '上传资料' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '查看全部资料' }));
    expect(onOpen).toHaveBeenCalledWith('materials');
    const calls = f.command.mock.calls.length;
    page.rerender(renderIntakeDestinations(destinationContext()));
    expect(screen.getByRole('button', { name: '审核 产品 / candidate-a' })).toBeInTheDocument();
    expect(f.command).toHaveBeenCalledTimes(calls);
  } finally { f.main.dispose(); }
});

it('preserves source and publication input across navigation', async () => {
  const f = setup(); f.data.status.state = 'passed';
  const page = render(renderIntakeDestinations(destinationContext()));
  try {
    await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), 'export-v1');
    await f.user.type(screen.getByRole('textbox', { name: '来源确认说明' }), '核对来源');
    await f.user.click(screen.getByRole('button', { name: '返回批次列表' }));
    page.rerender(renderIntakeDestinations(destinationContext({ active: 'overview' })));
    expect(screen.queryByRole('textbox', { name: '来源版本' })).not.toBeInTheDocument();
    page.rerender(renderIntakeDestinations(destinationContext()));
    await f.user.click(screen.getByRole('button', { name: '继续当前审核' }));
    expect(screen.getByRole('textbox', { name: '来源版本' })).toHaveValue('export-v1');
    expect(screen.getByRole('textbox', { name: '来源确认说明' })).toHaveValue('核对来源');
    await f.user.click(screen.getByRole('button', { name: '确认来源版本' }));
    await f.user.type(await screen.findByRole('textbox', { name: '发布标题' }), '合成标题');
    await f.user.type(screen.getByRole('textbox', { name: '发布摘要' }), '合成摘要');
    page.rerender(renderIntakeDestinations(destinationContext({ active: 'overview' })));
    page.rerender(renderIntakeDestinations(destinationContext()));
    expect(screen.getByRole('textbox', { name: '发布标题' })).toHaveValue('合成标题');
    expect(screen.getByRole('textbox', { name: '发布摘要' })).toHaveValue('合成摘要');
  } finally { f.main.dispose(); }
});

it('clears hidden materials on logout, session change and invalidation', async () => {
  const f = setup();
  const page = render(renderIntakeDestinations(destinationContext()));
  try {
    const fill = async () => {
      await screen.findByText('合成审核员');
      const open = screen.queryByRole('button', { name: '审核 产品 / candidate-a' });
      if (open) await f.user.click(open);
      await f.user.click(screen.getByRole('button', { name: '查看材料' }));
      await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), 'private-draft');
    };
    await fill();
    page.rerender(renderIntakeDestinations(destinationContext({ active: 'overview', jobKnown: false, sessionKey: 'signed-out' })));
    expect(screen.queryByDisplayValue('private-draft')).not.toBeInTheDocument();
    page.rerender(renderIntakeDestinations(destinationContext()));
    await fill();
    page.rerender(renderIntakeDestinations(destinationContext({ active: 'overview', sessionKey: 'coach:other' })));
    expect(screen.queryByDisplayValue('private-draft')).not.toBeInTheDocument();
    page.rerender(renderIntakeDestinations(destinationContext({ sessionKey: 'coach:other' })));
    await fill();
    page.rerender(renderIntakeDestinations(destinationContext({ active: 'overview', sessionKey: 'coach:other' })));
    window.dashboardIntake!.current = async () => ({ ok: false, code: 'UNAUTHORIZED', message: '未登录', view: null });
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.queryByDisplayValue('private-draft')).not.toBeInTheDocument();
    page.rerender(renderIntakeDestinations(destinationContext({ sessionKey: 'coach:other' })));
    expect(screen.queryByDisplayValue('private-draft')).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it('clears a hidden draft when invalidation immediately returns a fresh authorized view', async () => {
  const f = setup();
  const page = render(renderIntakeDestinations(destinationContext()));
  try {
    await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), 'private-draft');
    page.rerender(renderIntakeDestinations(destinationContext({ active: 'overview' })));
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.queryByDisplayValue('private-draft')).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});
it('loads after a development remount instead of sticking on 会话待确认', async () => {
  const f = setup();
  let release!: (value: { ok: true; view: ReturnType<ContentIntakeManagement['view']> }) => void;
  const firstRead = new Promise<{ ok: true; view: ReturnType<ContentIntakeManagement['view']> }>((resolve) => { release = resolve; });
  window.dashboardIntake!.command = vi.fn(async (command) => (
    command.action === 'list' ? firstRead : { ok: true as const, view: f.main.view() }
  ));
  try {
    render(<StrictMode><IntakeManagement /></StrictMode>);
    await act(async () => { release({ ok: true, view: f.main.view() }); });
    expect(await screen.findByText('合成审核员')).toBeInTheDocument();
    expect(screen.queryByText('会话待确认')).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});
it('requires explicit human checks and blocks submitting an older saved judgment after editing it', async () => {
  const f = setup(); f.data.candidate.sourceEvidenceVersion = 1; render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.click(screen.getByRole('button', { name: '读取审核清单' }));
    await f.user.click(await screen.findByRole('button', { name: '开始本轮审核' }));
    await f.user.click(screen.getByRole('button', { name: '读取审核清单' }));
    const submit = await screen.findByRole('button', { name: '提交本轮审核' });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('heading', { name: /合成洁面 1/ })).toBeInTheDocument();
    expect(screen.queryByText('faq-0')).not.toBeInTheDocument();
    await choose(f.user, '检查结论 合成洁面 1', '通过'); await f.user.click(screen.getByRole('button', { name: '暂存本条判断' }));
    await waitFor(() => expect(submit).toBeEnabled());
    await choose(f.user, '检查结论 合成洁面 1', '需修改');
    expect(submit).toBeDisabled();
    await f.user.type(screen.getByRole('textbox', { name: '判断说明 合成洁面 1' }), '合成缺陷');
    await f.user.click(screen.getByRole('button', { name: '暂存本条判断' }));
    await f.user.click(submit);
    expect(f.data.receipts.size).toBe(2); expect(f.data.samples[0].check).toMatchObject({ defect: true, reason: '合成缺陷' });
  } finally { f.main.dispose(); }
});
it('rejects an invalidation read that arrives after a newer session notification', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ });
    const old = f.main.view(); let resolve!: (r: Awaited<ReturnType<NonNullable<typeof window.dashboardIntake>['current']>>) => void;
    window.dashboardIntake!.current = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ ok: false, code: 'UNAUTHORIZED', message: '未登录', view: null });
    await act(async () => { f.listeners.forEach(f => f()); f.listeners.forEach(f => f()); });
    await act(async () => resolve({ ok: true, view: old }));
    expect(screen.queryByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ })).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});
it('submits source and publication human intent through Main and displays the published release', async () => {
  const f = setup(); f.data.status.state = 'passed'; render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    expect(screen.queryByRole('combobox', { name: '来源版本类型' })).not.toBeInTheDocument();
    await f.user.click(screen.getByText('来源版本格式与填写限制'));
    expect(screen.getByRole('combobox', { name: '来源版本类型' }).tagName).not.toBe('SELECT');
    await choose(f.user, '来源版本类型', '递增整数');
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
    await f.user.click(screen.getByRole('button', { name: '发布整批资料' }));
    await waitFor(() => expect(f.confirmation).toHaveBeenCalledTimes(1));
    expect(f.data.candidate.state).toBe('ready');
    expect(f.data.candidate.publishedReleaseId).toBeNull();
    expect(screen.getByRole('textbox', { name: '发布标题' })).toHaveValue('合成 FAQ 更新');
    f.confirmation.mockResolvedValue(true);
    await f.user.click(screen.getByRole('button', { name: '发布整批资料' }));
    expect(f.command).toHaveBeenCalledWith({ action: 'publish', title: '合成 FAQ 更新', summary: '新增已核对条目' });
    const published = await screen.findByText('已发布。');
    expect(published.closest('[role="status"]')?.textContent?.startsWith('已发布。')).toBe(true);
    const publishedTitle = within(screen.getByRole('region', { name: '批次详情' })).getByRole('heading', { name: '产品 / candidate-a' });
    expect(publishedTitle.textContent).toBe('产品 / candidate-a');
    expect(publishedTitle.textContent).not.toMatch(/source-/);
    expect(publishedTitle.textContent).not.toContain('rel_2');
    expect(screen.queryByRole('button', { name: '发布整批资料' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '发布标题', hidden: true })).toHaveValue('');
  } finally { f.main.dispose(); }
});
it('legacy candidates show read-only history and cannot bypass an explicit revision for direct publication', async () => {
  const f = setup(); f.data.historicalReview(); f.data.candidate.sourceEvidenceVersion = 1; f.data.candidate.state = 'ready';
  render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    expect(screen.queryByRole('button', { name: '发起组织审批' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新审批结果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布整批资料' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '读取历史审批' }));
    await screen.findByText(/组织审批已通过，审批编号 synthetic-history/);
    expect(f.data.candidate.publicationPolicy).toBe('approval-v1');
    expect(f.data.candidate.approvalEvidenceVersion).toBe(1);
  } finally { f.main.dispose(); }
});
it('keeps an unsaved quality judgment isolated from source and publication mutations', async () => {
  const f = setup(); f.data.candidate.sourceEvidenceVersion = 1; render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.click(screen.getByRole('button', { name: '读取审核清单' }));
    await f.user.click(screen.getByRole('button', { name: '开始本轮审核' }));
    await f.user.click(screen.getByRole('button', { name: '读取审核清单' }));
    await choose(f.user, '检查结论 合成洁面 1', '通过');
    expect(screen.queryByRole('textbox', { name: '来源版本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布整批资料' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '暂存本条判断' }));
    expect(screen.queryByRole('button', { name: '发布整批资料' })).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});
it('keeps source entry on its own step and opens quality only after confirmation', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), 'source-v2');
    await f.user.type(screen.getByRole('textbox', { name: '来源确认说明' }), '人工核对来源');
    expect(screen.getByRole('button', { name: '确认来源版本' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '开始本轮审核' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '读取审核清单' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '确认来源版本' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '来源版本' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '读取审核清单' })).toBeEnabled();
    expect(f.main.view().hasDraft).toBe(false);
  } finally { f.main.dispose(); }
});
it('preserves unsubmitted source input across a status read and clears that form when confirmation leaves the current step', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), 'export-v1');
    await f.user.type(screen.getByRole('textbox', { name: '来源确认说明' }), '人工确认');
    await f.user.click(screen.getByRole('button', { name: '刷新审核状态' }));
    expect(screen.getByRole('textbox', { name: '来源版本' })).toHaveValue('export-v1');
    expect(f.data.candidate.sourceEvidenceVersion).toBe(0);
    await f.user.click(screen.getByRole('button', { name: '确认来源版本' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '来源版本' })).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: '来源版本', hidden: true })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: '来源确认说明', hidden: true })).toHaveValue('');
    expect(screen.getByRole('button', { name: '读取审核清单' })).toBeInTheDocument();
    expect(f.data.candidate.sourceEvidenceVersion).toBe(1);
    expect(f.data.workflowReceipts.size).toBe(1);
  } finally { f.main.dispose(); }
});

it('explains candidate readiness and risk without exposing internal codes or prototype members', async () => {
  const f = setup();
  f.data.candidate.readinessReasons = ['SOURCE_CONFIRMATION_REQUIRED', 'AWAITING_APPROVAL', 'constructor', 'NEW_REASON'];
  render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    expect(screen.getByText(/待确认来源版本 \/ 待组织审批通过 \/ 还有待核验事项，请刷新审核状态/)).toBeInTheDocument();
    expect(screen.queryByText(/SOURCE_CONFIRMATION_REQUIRED|constructor|NEW_REASON/)).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    expect(await screen.findByText('常规内容')).toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it.each(['revise', 'cancel-candidate'] as const)('requires explicit confirmation and a clean form before %s', async action => {
  const f = setup(); f.data.state.importer = true; f.data.state.canceller = true;
  render(<IntakeManagement />);
    try {
      await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
      const label = action === 'revise' ? '上传修订版' : '取消这份资料';
      await f.user.click(screen.getByRole('button', { name: label }));
      expect(f.command.mock.calls.some(([c]) => c.action === action)).toBe(false);
      const sentence = action === 'revise'
        ? '上传这份资料的修订版？请上传完整修订稿。校验成功后旧版失效，新版须重新确认来源和审核；校验失败保留旧版。'
        : '确认取消这份资料？取消成功后该版本不能再发布，已发布内容不受影响。这不是停止本机等待。';
      const note = await screen.findByText(sentence);
      await f.user.click(within(note.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: '取消' }));
      await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    const source = screen.getByRole('textbox', { name: '来源版本' });
    await f.user.type(source, '未提交来源');
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    await f.user.clear(source);
    await f.user.click(screen.getByRole('button', { name: label }));
    const again = await screen.findByText(action === 'revise'
      ? '上传这份资料的修订版？请上传完整修订稿。校验成功后旧版失效，新版须重新确认来源和审核；校验失败保留旧版。'
      : '确认取消这份资料？取消成功后该版本不能再发布，已发布内容不受影响。这不是停止本机等待。');
    await f.user.click(within(again.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: '确认' }));
    expect(f.command).toHaveBeenLastCalledWith({ action });
    if (action === 'revise') {
      await screen.findByText(/正在准备修订：candidate-a，原版本 1/);
      expect(screen.queryByRole('region', { name: '批次详情' })).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: '上传来源' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '放弃本地修订' })).toBeEnabled();
    } else {
      await screen.findByText(/已取消：此版本不再接受修改或发布/);
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '发布整批资料' })).not.toBeInTheDocument();
    }
  } finally { f.main.dispose(); }
});

it('keeps review navigation separate from the existing source, sample and publication commands', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: '审核 产品 / candidate-a' }));
    const progress = () => screen.getByLabelText('当前步骤');
    expect(progress()).toHaveTextContent('核对材料');
    const calls = f.command.mock.calls.length;
    await f.user.click(screen.getByRole('button', { name: '人工质量检查' }));
    await f.user.click(screen.getByRole('button', { name: '原始材料' }));
    expect(f.command).toHaveBeenCalledTimes(calls);
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.click(screen.getByRole('button', { name: '来源确认' }));
    expect(progress()).toHaveTextContent('确认来源');
    await f.user.type(screen.getByRole('textbox', { name: '来源版本' }), 'export-1');
    await f.user.type(screen.getByRole('textbox', { name: '来源确认说明' }), '已核对合成来源');
    await f.user.click(screen.getByRole('button', { name: '确认来源版本' }));
    await waitFor(() => expect(progress()).toHaveTextContent('完成质量检查'));
    await f.user.click(screen.getByRole('button', { name: '读取审核清单' }));
    await f.user.click(screen.getByRole('button', { name: '开始本轮审核' }));
    await f.user.click(screen.getByRole('button', { name: '读取审核清单' }));
    await choose(f.user, '检查结论 合成洁面 1', '通过');
    await f.user.click(screen.getByRole('button', { name: '暂存本条判断' }));
    expect(progress()).toHaveTextContent('完成本轮质量检查');
    expect(f.data.samples[0].check).toBeNull();
    await f.user.click(screen.getByRole('button', { name: '提交本轮审核' }));
    expect(progress()).toHaveTextContent('读取最新检查状态');
    await f.user.click(screen.getByRole('button', { name: '读取审核清单' }));
    expect(progress()).toHaveTextContent('核对审核状态');
    await f.user.click(screen.getByRole('button', { name: '刷新审核状态' }));
    expect(progress()).toHaveTextContent('确认发布');
    expect(f.data.candidate.publishedReleaseId).toBeNull();
  } finally { f.main.dispose(); }
});

it('keeps original unknown-operation recovery reachable after returning to the list and switching presentation', async () => {
  const f = setup(); const page = render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: '审核 产品 / candidate-a' }));
    const pendingView = { ...f.main.view(), pending: { action: 'publish' as const, operationId: 'synthetic-unknown', recovery: 'receipt' as const } };
    window.dashboardIntake!.current = async () => ({ ok: true, view: pendingView });
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.getByLabelText('当前步骤')).toHaveTextContent('确认上次操作结果');
    expect(screen.queryByRole('button', { name: '发布整批资料' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '返回批次列表' }));
    expect(screen.getByRole('button', { name: '查询原操作回执' })).toBeEnabled();
    const calls = f.command.mock.calls.length;
    page.rerender(<IntakeManagement presentation="overview" onOpenReview={() => undefined} />);
    expect(screen.queryByRole('button', { name: '查询原操作回执' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试原操作' })).not.toBeInTheDocument();
    expect(f.command).toHaveBeenCalledTimes(calls);
    page.rerender(<IntakeManagement />);
    expect(screen.getByText('synthetic-unknown')).toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '查询原操作回执' }));
    expect(f.command).toHaveBeenLastCalledWith({ action: 'recover' });
    window.dashboardIntake!.current = async () => ({ ok: false, code: 'UNAUTHORIZED', message: '未登录', view: null });
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.queryByRole('button', { name: '查询原操作回执' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('当前步骤')).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it('preserves an existing rollback plan and unknown recovery without exposing a new rollback entry', async () => {
  const f = setup(); render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    const view = f.main.view(); view.rollback.available = true;
    if (view.selected) view.selected.state = 'published';
    for (const row of view.candidates) row.candidate.state = 'published';
    window.dashboardIntake!.current = async () => ({ ok: true, view: structuredClone(view) });
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.getByLabelText('当前步骤')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '已发布目录纠正回退' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /发布编号/ })).not.toBeInTheDocument();
    view.rollback.impact = { baseReleaseId: 'rel_2', targetReleaseId: 'rel_1', scopes: [], requiresCorrectiveCandidate: false };
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.queryByLabelText('当前步骤')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭回退计划' })).toBeInTheDocument();
    view.rollback.impact = null; // Unknown recovery must also work after material was withdrawn.
    view.rollback.pending = { action: 'rollback', recovery: 'receipt' };
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.queryByLabelText('当前步骤')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查询原回退回执' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '发布整批资料' })).not.toBeInTheDocument();
    view.rollback.pending = null;
    view.rollback.result = { state: 'published', releaseId: 'rel_3' };
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(screen.getByText('回退已发布。')).toBeInTheDocument();
    expect(screen.getByText(/发布号 rel_3/)).toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it('opens a full-width batch list, then a single detail with on-demand original rows and differences', async () => {
  const f = setup();
  f.data.material.differences = [{ businessEntryId: 'faq-a', change: 'modify', previousVersion: 1, nextVersion: 2, beforeDigest: 'a'.repeat(64), afterDigest: 'b'.repeat(64) }];
  render(<IntakeManagement />);
  try {
    await screen.findByRole('columnheader', { name: '资料批次' });
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['资料批次', '分类', '更新时间', '审核状态', '下一步', '操作']);
    expect(screen.getByRole('heading', { name: '资料审核' })).toBeInTheDocument();
    expect(screen.getByText('产品 / candidate-a')).toBeInTheDocument();
    expect(screen.queryByText(/该店铺|source-a/)).not.toBeInTheDocument();
    expect(screen.getByText('修订 1')).toBeInTheDocument();
    const filter = screen.getByRole('radiogroup', { name: '批次筛选' });
    expect(within(filter).getByRole('radio', { name: '待我处理' })).toBeChecked();
    expect(within(filter).getByRole('radio', { name: '全部' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上传资料' })).toHaveClass('ant-btn-primary');
    expect(screen.queryByRole('button', { name: '选择 CSV / Excel 文件' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '审核 产品 / candidate-a' }));
    expect(screen.queryByRole('region', { name: '资料批次列表' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '批次详情' })).not.toHaveClass('has-sheet');
    expect(screen.queryByText('核对材料 → 确认来源 → 质量检查 → 确认发布')).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    const original = within(screen.getByRole('region', { name: '当前页材料与差异' }));
    expect(original.getAllByRole('table')).toHaveLength(2);
    expect(original.getByRole('cell', { name: '修改' })).toBeInTheDocument();
    expect(original.getByRole('cell', { name: '1 → 2' })).toBeInTheDocument();
    expect(original.queryByText(/第一行/)).not.toBeInTheDocument();
    await f.user.click(original.getByRole('button', { name: '查看原文 faq-a' }));
    expect(original.getByText(/第一行/)).toHaveTextContent('第一行 第二行');
    expect(original.getAllByText('faq-a', { selector: 'code' })).toHaveLength(2);
    expect(original.getByText('常规内容')).toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '返回批次列表' }));
    expect(screen.getByRole('region', { name: '资料批次列表' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '批次详情' })).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '继续当前审核' }));
    expect(screen.getByRole('button', { name: '收起原文 faq-a' })).toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it('opens published materials without an unavailable rollback entry', async () => {
  const f = setup(); f.data.candidate.state = 'published'; f.data.state.rollback = true; render(<IntakeManagement />);
  try {
    await screen.findByRole('columnheader', { name: '资料批次' });
    expect(screen.getByText('这个筛选下没有资料批次。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '回退' })).not.toBeInTheDocument();
    await f.user.click(within(screen.getByRole('radiogroup', { name: '批次筛选' })).getByText('已发布'));
    expect(screen.queryByRole('button', { name: '回退' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ })).toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ }));
    expect(await screen.findByRole('region', { name: '批次详情' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '已发布目录纠正回退' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看回退影响' })).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it('shows publishing as its status and does not offer a material check', async () => {
  const f = setup();
  f.data.candidate.state = 'publishing';
  render(<IntakeManagement />);
  try {
    expect(await screen.findByRole('cell', { name: '产品' })).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: '发布中' })).toHaveLength(2);
    expect(screen.queryByRole('cell', { name: '核对材料' })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: '质量检查' })).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it('keeps the unavailable sentence when intake is not mounted', async () => {
  render(<IntakeManagement />);
  expect(await screen.findByRole('alert')).toHaveTextContent('资料还不能在这里改。请把表交给客服经理。');
  expect(screen.getByRole('button', { name: '重新读取当前状态' })).toBeEnabled();
  expect(screen.queryByText('请先在查询窗口登录。')).not.toBeInTheDocument();
});

it('shows a logged-out read as forbidden and retries other read failures', async () => {
  const f = setup();
  window.dashboardIntake!.command = vi.fn(async () => ({
    ok: false as const, code: 'UNAUTHORIZED', message: '请先在查询窗口登录。', view: null,
  }));
  try {
    render(<IntakeManagement />);
    expect(await screen.findByRole('alert')).toHaveTextContent('请先在查询窗口登录。');
    expect(screen.queryByRole('button', { name: /^(审核|查看) 产品 \/ candidate-a$/ })).not.toBeInTheDocument();
    window.dashboardIntake!.command = vi.fn(async () => ({
      ok: false as const, code: 'UNAVAILABLE', message: '管理服务不可用，请刷新。', view: null,
    }));
    window.dashboardIntake!.current = async () => ({
      ok: false, code: 'UNAVAILABLE', message: '管理服务不可用，请刷新。', view: null,
    });
    await f.user.click(screen.getByRole('button', { name: '重新读取当前状态' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('管理服务不可用，请刷新。'));
    expect(screen.getByRole('button', { name: '重新读取当前状态' })).toBeEnabled();
    window.dashboardIntake!.current = async () => ({ ok: true, view: f.main.view() });
    await f.user.click(screen.getByRole('button', { name: '重新读取当前状态' }));
    expect(await screen.findByText('合成审核员')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});

it('shows only authorized open batches in overview, with distinct batch IDs and no inferred totals', async () => {
  const f = setup(), openReview = vi.fn();
  const view = await f.main.command({ action: 'list', next: false });
  view.moreCandidates = true;
  view.candidates = ['awaiting-evidence', 'ready', 'publishing', 'published', 'cancelled', 'invalidated'].map((state, index) => ({
    selection: `row-${index}`, scopeLabel: 'shop-a / 产品',
    candidate: { ...f.data.candidate, key: { ...f.data.candidate.key, candidateId: `candidate-synthetic-batch-${index}` },
      state: state as typeof f.data.candidate.state, sourceEvidenceVersion: index ? 1 : 0 },
  }));
  window.dashboardIntake!.command = vi.fn(async () => ({ ok: true as const, view: structuredClone(view) }));
  const page = render(<IntakeManagement presentation="overview" onOpenReview={openReview} />);
  try {
    const overview = within(await screen.findByTestId('module-overview'));
    await overview.findByRole('cell', { name: /atch-0/ });
    expect(overview.getAllByRole('row')).toHaveLength(4);
    for (const id of ['atch-0', 'atch-1', 'atch-2']) expect(overview.getByRole('cell', { name: new RegExp(id) })).toBeInTheDocument();
    expect(overview.queryByRole('cell', { name: /atch-3|atch-4|atch-5/ })).not.toBeInTheDocument();
    expect(overview.getAllByRole('button').map(button => button.textContent)).toEqual(['查看全部资料']);
    expect(within(screen.getByRole('region', { name: '待审核资料' })).queryByText(/全店|总计|命中率|该店铺/)).not.toBeInTheDocument();
    await f.user.click(overview.getByRole('button', { name: '查看全部资料' }));
    expect(openReview).toHaveBeenCalledOnce();
    expect(window.dashboardIntake!.command).toHaveBeenCalledTimes(1);
    view.authorized = false;
    window.dashboardIntake!.current = async () => ({ ok: true, view: structuredClone(view) });
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(overview.queryByRole('cell', { name: /atch-/ })).not.toBeInTheDocument();
    view.authorized = true; view.candidates = [];
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(overview.getByText('当前页没有待审核资料，后续批次尚未读取。')).toBeInTheDocument();
    expect(overview.getByText(/这里只显示当前已读取的批次/)).toBeInTheDocument();
    view.moreCandidates = false;
    await act(async () => { f.listeners.forEach(listener => listener()); });
    expect(overview.getByText('有可处理的资料批次时，会显示在这里。')).toBeInTheDocument();
  } finally { page.unmount(); f.main.dispose(); }
});

it('distinguishes overview loading, read failure and confirmed lack of access, with a read-only retry', async () => {
  const f = setup();
  const view = await f.main.command({ action: 'list', next: false });
  let finish!: (reply: IntakeManagementReply) => void;
  window.dashboardIntake!.command = vi.fn(() => new Promise<IntakeManagementReply>(resolve => { finish = resolve; }));
  const current = vi.fn(async () => ({ ok: true as const, view: { ...view, authorized: false } }));
  window.dashboardIntake!.current = current;
  render(<IntakeManagement presentation="overview" onOpenReview={() => undefined} />);
  try {
    expect(screen.getByRole('status', { name: '读取待审核资料' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('取得资料查看权限后，会显示可处理的批次。')).not.toBeInTheDocument();
    await act(async () => finish({ ok: false, code: 'UNAVAILABLE', message: '管理服务不可用，请刷新。', view: null }));
    expect(screen.getByRole('alert')).toHaveTextContent('管理服务不可用，请刷新。');
    expect(screen.queryByText('取得资料查看权限后，会显示可处理的批次。')).not.toBeInTheDocument();
    await f.user.click(screen.getByRole('button', { name: '重新读取当前状态' }));
    expect(await screen.findByText('取得资料查看权限后，会显示可处理的批次。')).toBeInTheDocument();
    expect(current).toHaveBeenCalledOnce();
    expect(window.dashboardIntake!.command).toHaveBeenCalledTimes(1);
  } finally { f.main.dispose(); }
});

it('preserves unsaved and staged quality judgments through list and overview without lifting dirty gates', async () => {
  const f = setup(); f.data.candidate.sourceEvidenceVersion = 1;
  const respond = f.data.respond;
  f.data.respond = (path, body) => path.startsWith('/v1/intake/candidates?')
    ? { items: [f.data.candidate, { ...f.data.candidate, key: { ...f.data.candidate.key, candidateId: 'candidate-b' } }], nextCursor: null }
    : respond(path, body);
  const page = render(<IntakeManagement />);
  try {
    await f.user.click(await screen.findByRole('button', { name: '审核 产品 / candidate-a' }));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.click(screen.getByRole('button', { name: '读取审核清单' }));
    await f.user.click(screen.getByRole('button', { name: '开始本轮审核' }));
    await f.user.click(screen.getByRole('button', { name: '读取审核清单' }));
    await choose(f.user, '检查结论 合成洁面 1', '需修改');
    await f.user.type(screen.getByRole('textbox', { name: '判断说明 合成洁面 1' }), '需核对原文');
    await f.user.click(screen.getByRole('button', { name: '返回批次列表' }));
    expect(screen.getByRole('button', { name: '刷新批次' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '审核 产品 / candidate-b' })).toBeDisabled();
    await f.user.click(within(screen.getByRole('radiogroup', { name: '批次筛选' })).getByText('已发布'));
    const calls = f.command.mock.calls.length;
    page.rerender(<IntakeManagement presentation="overview" onOpenReview={() => undefined} />);
    expect(screen.queryByRole('textbox', { name: '判断说明 合成洁面 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交本轮审核' })).not.toBeInTheDocument();
    page.rerender(<IntakeManagement />);
    expect(within(screen.getByRole('radiogroup', { name: '批次筛选' })).getByRole('radio', { name: '已发布' })).toBeChecked();
    await f.user.click(screen.getByRole('button', { name: '继续当前审核' }));
    expect(f.command).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole('textbox', { name: '判断说明 合成洁面 1' })).toHaveValue('需核对原文');
    expect(screen.getByRole('button', { name: '提交本轮审核' })).toBeDisabled();
    await f.user.click(screen.getByRole('button', { name: '原始材料' }));
    expect(screen.getByRole('button', { name: '查看材料' })).toBeDisabled();
    await f.user.click(screen.getByRole('button', { name: '发布资料' }));
    expect(screen.getByRole('button', { name: '发布整批资料' })).toBeDisabled();
    await f.user.click(screen.getByRole('button', { name: '人工质量检查' }));
    await f.user.click(screen.getByRole('button', { name: '暂存本条判断' }));
    expect(f.main.view().hasDraft).toBe(true);
    expect(f.data.samples[0].check).toBeNull();
    await f.user.click(screen.getByRole('button', { name: '返回批次列表' }));
    expect(screen.getByRole('button', { name: '刷新批次' })).toBeDisabled();
    await f.user.click(screen.getByRole('button', { name: '继续当前审核' }));
    expect(screen.getByRole('textbox', { name: '判断说明 合成洁面 1' })).toHaveValue('需核对原文');
    expect(screen.getByRole('button', { name: '提交本轮审核' })).toBeEnabled();
  } finally { f.main.dispose(); }
});

it.each(['overview', 'hidden'] as const)('dismisses confirmation and hides select portals when %s without dispatching a mutation', async mode => {
  const f = setup(); f.data.state.canceller = true;
  const renderPage = (parked: boolean) => <div hidden={parked && mode === 'hidden'}><IntakeManagement
    active={!parked || mode !== 'hidden'} presentation={parked && mode === 'overview' ? 'overview' : 'review'} /></div>;
  const page = render(renderPage(false));
  try {
    await f.user.click(await screen.findByRole('button', { name: '审核 产品 / candidate-a' }));
    await f.user.click(screen.getByRole('button', { name: '取消这份资料' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    page.rerender(renderPage(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(f.command.mock.calls.some(([command]) => command.action === 'cancel-candidate')).toBe(false);
    page.rerender(renderPage(false));
    await f.user.click(screen.getByRole('button', { name: '查看材料' }));
    await f.user.click(screen.getByText('来源版本格式与填写限制'));
    await f.user.click(screen.getByRole('combobox', { name: '来源版本类型' }));
    expect(await screen.findByRole('option', { name: '递增整数' })).toBeInTheDocument();
    page.rerender(renderPage(true));
    expect(screen.queryByRole('option', { name: '递增整数' })).not.toBeInTheDocument();
  } finally { f.main.dispose(); }
});
