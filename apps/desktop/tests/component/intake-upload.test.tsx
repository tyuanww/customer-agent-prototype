import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { IntakeUploadView } from '../../src/shared/content-intake-upload';
import type { IntakeManagementApi, IntakeManagementView } from '../../src/shared/content-intake-management';
import { IntakeUpload } from '../../src/renderer/features/dashboard/IntakeUpload';
import { IntakeManagement } from '../../src/renderer/features/dashboard/IntakeManagement';
import { intakeManagementData } from '../fixtures/intake-management-data';

afterEach(() => { delete window.dashboardIntake; });
function upload(overrides: Partial<IntakeUploadView> = {}): IntakeUploadView {
  return { phase: 'confirming', busy: false, authorized: true, validUntil: '2099-01-01T00:00:00Z', draftRevision: 1,
    sources: [{ selection: 'source-handle', domain: 'product', label: '合成店铺 FAQ' }], sourceSelection: 'source-handle', revisionOf: null,
    file: { name: 'synthetic-faq.xlsx', bytes: 2048 }, principals: [
      { selection: 'self-handle', displayLabel: '合成整理人', enabled: true },
      { selection: 'editor-handle', displayLabel: '合成历史编辑', enabled: false },
    ], preparerSelection: null, editorSelections: [], confirmed: false, pending: null, job: null,
    canChoose: true, canSubmit: true, canRetry: false, canRefresh: false, canStop: false,
    canSaveReport: false, canOpen: false, canReset: true, notice: null, ...overrides };
}
function management(state: IntakeUploadView): IntakeManagementView {
  return { rollback: { available: false, impact: null, review: null, pending: null, result: null, hasReview: false, canExecute: false }, signedIn: true, displayName: '合成上传人', authorized: true, validUntil: state.validUntil,
    candidates: [], moreCandidates: false, selected: null, material: null, canReview: false, quality: null, hasDraft: false,
    canConfirmSource: false, canPublish: false, canRevise: false, canCancel: false, review: null, workflowResult: null, pending: null, receipt: null, upload: state };
}
async function declare(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByRole('combobox', { name: '整理责任人' }), 'self-handle');
  await user.click(screen.getByRole('checkbox', { name: '实际改稿人 合成历史编辑' }));
  await user.click(screen.getByRole('checkbox', { name: '我已核对整理责任人及全部实际改稿人' }));
}
it('requires explicit human declarations and sends opaque choices without file or actor input', async () => {
  const apply = vi.fn(), user = userEvent.setup();
  render(<IntakeUpload view={upload()} busy={false} blocked={false} refreshBlocked={false} stopping={false} apply={apply} />);
  const submit = screen.getByRole('button', { name: '上传并校验' });
  expect(submit).toBeDisabled();
  await declare(user);
  expect(submit).toBeEnabled();
  await user.click(submit);
  expect(apply).toHaveBeenLastCalledWith({ action: 'upload-submit', preparerSelection: 'self-handle', editorSelections: ['editor-handle'], confirmed: true });
  await user.click(screen.getByRole('checkbox', { name: '实际改稿人 合成整理人' }));
  expect(screen.getByRole('checkbox', { name: '我已核对整理责任人及全部实际改稿人' })).not.toBeChecked();
  expect(submit).toBeDisabled();
});
it('preserves declarations on status reads but requires a fresh confirmation for same-name same-size replacement', async () => {
  const apply = vi.fn(), user = userEvent.setup(), view = upload();
  const { rerender } = render(<IntakeUpload view={view} busy={false} blocked={false} refreshBlocked={false} stopping={false} apply={apply} />);
  await declare(user);
  rerender(<IntakeUpload view={structuredClone(view)} busy={false} blocked={false} refreshBlocked={false} stopping={false} apply={apply} />);
  expect(screen.getByRole('button', { name: '上传并校验' })).toBeEnabled();
  rerender(<IntakeUpload view={{ ...view, draftRevision: 2 }} busy={false} blocked={false} refreshBlocked={false} stopping={false} apply={apply} />);
  expect(screen.getByRole('combobox', { name: '整理责任人' })).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: '实际改稿人 合成历史编辑' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: '上传并校验' })).toBeDisabled();
});
it('shows total issues separately from the bounded page and saves the complete report using a pathless intent', async () => {
  const apply = vi.fn(), user = userEvent.setup();
  const view = upload({ phase: 'failed', canSubmit: false, canSaveReport: true,
    job: { state: 'failed', totalIssues: 125, excludedSheetCount: 2, excludedMediaCount: 1,
      issues: [{ code: 'MISSING_HEADER', message: '请补齐标准话术列', location: { sheet: 'FAQ', row: 1, column: 3 } }] } });
  render(<IntakeUpload view={view} busy={false} blocked={false} refreshBlocked={false} stopping={false} apply={apply} />);
  expect(screen.getByText(/共 125 个问题，当前显示 1 个/)).toBeInTheDocument();
  expect(screen.getByText(/最近读取的服务端状态：校验未通过/)).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '1 / 3' })).toBeInTheDocument();
  expect(screen.getByText(/本批尚未形成候选/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '保存完整错误报告' }));
  expect(apply).toHaveBeenCalledWith({ action: 'upload-save-report' });
  await user.click(screen.getByRole('button', { name: '选择 CSV / Excel 文件' }));
  expect(apply).toHaveBeenLastCalledWith({ action: 'upload-choose' });
});
it('shows CSV record coordinates and offers a pathless choice for either supported format', async () => {
  const apply = vi.fn(), user = userEvent.setup();
  render(<IntakeUpload view={upload({ file: { name: 'synthetic-faq.csv', bytes: 1024 }, phase: 'failed', canSubmit: false,
    job: { state: 'failed', totalIssues: 1, excludedSheetCount: 0, excludedMediaCount: 0,
      issues: [{ code: 'REQUIRED', message: '补齐必填内容后整批重新上传', location: { sheet: 'CSV', row: 3, column: 8 } }] } })}
    busy={false} blocked={false} refreshBlocked={false} stopping={false} apply={apply} />);
  expect(screen.getByText(/标准 CSV（UTF-8）或 Excel（XLSX）模板/)).toBeInTheDocument();
  expect(screen.getByText(/CSV 行号按记录计算/)).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '3 / 8' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '资料校验结果' })).toHaveTextContent('本批尚未形成候选');
  await user.click(screen.getByRole('button', { name: '选择 CSV / Excel 文件' }));
  expect(apply).toHaveBeenCalledWith({ action: 'upload-choose' });
});
it('keeps stopping available during a busy request and never labels it server cancellation', async () => {
  const apply = vi.fn(), user = userEvent.setup();
  render(<IntakeUpload view={upload({ phase: 'parsing', busy: true, canSubmit: false, canStop: true, canRefresh: true })}
    busy blocked refreshBlocked={false} stopping={false} apply={apply} />);
  expect(screen.getByRole('button', { name: '刷新解析进度' })).toBeDisabled();
  expect(screen.getByText(/停止本机等待不会撤销服务器已接收的任务/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '停止本机等待' }));
  expect(apply).toHaveBeenCalledWith({ action: 'upload-stop' });
});
it('stops a pending upload through the management controller and ignores its late response', async () => {
  const user = userEvent.setup(); let view = management(upload());
  let resolve!: (reply: Awaited<ReturnType<IntakeManagementApi['command']>>) => void;
  let finishRetry!: (reply: Awaited<ReturnType<IntakeManagementApi['command']>>) => void;
  const command = vi.fn<IntakeManagementApi['command']>(async c => {
    if (c.action === 'upload-submit') {
      view = management(upload({ phase: 'uploading', busy: true, canStop: true, canSubmit: false }));
      return new Promise(done => { resolve = done; });
    }
    if (c.action === 'upload-retry') {
      view = management(upload({ phase: 'uploading', busy: true, pending: 'upload', canSubmit: false, canStop: true }));
      return new Promise(done => { finishRetry = done; });
    }
    if (c.action === 'upload-stop') view = management(upload({ phase: 'unknown', pending: 'upload', canSubmit: false, canRetry: true }));
    return { ok: true, view: structuredClone(view) };
  });
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }), command,
    current: async () => ({ ok: true, view: structuredClone(view) }), onInvalidated: () => () => undefined };
  render(<IntakeManagement />);
  await screen.findByRole('combobox', { name: '整理责任人' }); await declare(user);
  await user.click(screen.getByRole('button', { name: '上传并校验' }));
  await user.click(await screen.findByRole('button', { name: '停止本机等待' }));
  await screen.findByText('提交结果待确认');
  await waitFor(() => expect(screen.getByRole('button', { name: '按原请求重试上传' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: '按原请求重试上传' }));
  await screen.findByText('正在上传文件');
  await act(async () => resolve({ ok: true, view: management(upload({ phase: 'validated', canSubmit: false, canOpen: true })) }));
  expect(screen.queryByText('校验通过，候选已形成')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新上传权限' })).toBeDisabled();
  await act(async () => finishRetry({ ok: true, view: management(upload({ phase: 'validated', canSubmit: false, canOpen: true })) }));
  expect(await screen.findByText('校验通过，候选已形成')).toBeInTheDocument();
  expect(command.mock.calls.map(([c]) => c.action)).toEqual(['list', 'upload-submit', 'upload-stop', 'upload-retry']);
});
it('protects an already opened candidate from a new native file selection while allowing report reads', async () => {
  const view = { ...management(upload({ phase: 'validated', canSubmit: false, canSaveReport: true })), selected: intakeManagementData(1).candidate };
  const command = vi.fn(async () => ({ ok: true as const, view }));
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }), command,
    current: async () => ({ ok: true, view }), onInvalidated: () => () => undefined };
  render(<IntakeManagement />);
  expect(await screen.findByRole('button', { name: '选择 CSV / Excel 文件' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '保存完整错误报告' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '查看材料' })).toBeEnabled();
});
it.each([
  { name: 'source input', field: '来源版本', hasDraft: false },
  { name: 'publication input', field: '发布标题', hasDraft: false },
  { name: 'saved quality draft', field: null, hasDraft: true },
])('blocks history refresh for $name while keeping report download available', async ({ field, hasDraft }) => {
  const user = userEvent.setup(), data = intakeManagementData(1); data.candidate.state = 'ready';
  const view: IntakeManagementView = { ...management(upload({ phase: 'validated', canSubmit: false, canRefresh: true, canSaveReport: true })),
    selected: data.candidate, material: data.material, canConfirmSource: true, canPublish: true, hasDraft };
  const command = vi.fn<IntakeManagementApi['command']>(async () => ({ ok: true, view: structuredClone(view) }));
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }), command,
    current: async () => ({ ok: true, view: structuredClone(view) }), onInvalidated: () => () => undefined };
  render(<IntakeManagement />);
  const refresh = await screen.findByRole('button', { name: '刷新解析进度' });
  if (field) {
    expect(refresh).toBeEnabled();
    await user.type(screen.getByRole('textbox', { name: field }), '尚未提交的合成输入');
  }
  expect(refresh).toBeDisabled();
  command.mockClear();
  await user.click(refresh);
  expect(command).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '保存完整错误报告' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '保存完整错误报告' }));
  expect(command).toHaveBeenCalledWith({ action: 'upload-save-report' });
  if (field) expect(screen.getByRole('textbox', { name: field })).toHaveValue('尚未提交的合成输入');
});
it('re-reads Main after an upload IPC failure and preserves declarations only in the still-current draft', async () => {
  const user = userEvent.setup(), view = management(upload());
  let fail!: () => void;
  const current = vi.fn(async () => ({ ok: true as const, view: structuredClone(view) }));
  const command = vi.fn<IntakeManagementApi['command']>(async c => {
    if (c.action === 'upload-choose') return new Promise((_resolve, reject) => { fail = () => reject(new Error('synthetic IPC reply lost')); });
    return { ok: true, view: structuredClone(view) };
  });
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }), command, current, onInvalidated: () => () => undefined };
  render(<IntakeManagement />);
  await screen.findByRole('combobox', { name: '整理责任人' }); await declare(user);
  await user.click(screen.getByRole('button', { name: '选择 CSV / Excel 文件' }));
  await waitFor(() => expect(current).toHaveBeenCalled());
  await act(async () => fail());
  await screen.findByRole('alert');
  expect(current).toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: '整理责任人' })).toHaveValue('self-handle');
  expect(screen.getByRole('checkbox', { name: '我已核对整理责任人及全部实际改稿人' })).toBeChecked();
});
it('can refresh permissions without discarding an uncertain upload or requiring a new login', async () => {
  const user = userEvent.setup(), view = management(upload({ phase: 'unknown', authorized: false, file: null,
    principals: [], pending: 'upload', canSubmit: false, canChoose: false, canRetry: true }));
  const command = vi.fn<IntakeManagementApi['command']>(async () => ({ ok: true, view: structuredClone(view) }));
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }), command,
    current: async () => ({ ok: true, view: structuredClone(view) }), onInvalidated: () => () => undefined };
  render(<IntakeManagement />);
  expect(await screen.findByRole('button', { name: '按原请求重试上传' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '刷新上传权限' }));
  expect(command).toHaveBeenLastCalledWith({ action: 'list', next: false });
});
it.each(['revoked', 'unavailable'] as const)('does not retain personal material when IPC recovery is %s', async outcome => {
  const user = userEvent.setup(), view = management(upload()); let recovering = false;
  const current = vi.fn<IntakeManagementApi['current']>(async () => {
    if (!recovering) return { ok: true, view: structuredClone(view) };
    if (outcome === 'unavailable') throw new Error('synthetic IPC unavailable');
    return { ok: true, view: management(upload({ authorized: false, file: null, principals: [], canSubmit: false })) };
  });
  const command = vi.fn<IntakeManagementApi['command']>(async c => {
    if (c.action === 'upload-choose') { recovering = true; throw new Error('synthetic IPC reply lost'); }
    return { ok: true, view: structuredClone(view) };
  });
  window.dashboardIntake = { mode: async () => ({ ok: true, enabled: true }), command, current, onInvalidated: () => () => undefined };
  render(<IntakeManagement />);
  await screen.findByRole('combobox', { name: '整理责任人' }); await declare(user);
  await user.click(screen.getByRole('button', { name: '选择 CSV / Excel 文件' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('combobox', { name: '整理责任人' })).not.toBeInTheDocument();
  expect(screen.queryByText('synthetic-faq.xlsx')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新读取当前状态' })).toBeEnabled();
});

it('offers only local discard when revision details are hidden after import revocation', async () => {
  const apply = vi.fn(), user = userEvent.setup();
  render(<IntakeUpload view={upload({ authorized: false, sources: [], sourceSelection: null, file: null,
    revisionOf: null, principals: [], canChoose: false, canSubmit: false, canReset: true })}
    busy={false} blocked={false} refreshBlocked={false} stopping={false} apply={apply} />);
  expect(screen.getByRole('button', { name: '选择 CSV / Excel 文件' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '清除本地上传准备' }));
  expect(apply).toHaveBeenCalledWith({ action: 'upload-reset' });
});
