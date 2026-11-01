import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SopRenameDraftOwner } from '../../src/main/sop-rename-draft-owner';
import { IntakeAntdTheme } from '../../src/renderer/features/dashboard/intake-antd';
import { QuerySopPanel } from '../../src/renderer/features/sop/QuerySopPanel';
import { projectSop } from '../../src/shared/sop-model';
import { ALLERGY_SOP_TREE } from '../../src/shared/synthetic-sops';
import type { SopCopyResult, SopDraftResult, SopTaskSummary, SopWindowResult } from '../../src/shared/sop-window';

const projection = projectSop({ tree: ALLERGY_SOP_TREE, progress: { sceneId: ALLERGY_SOP_TREE.sceneId, nodeId: 'voucher-ask', stepIndex: 1 }, role: 'agent', taskId: 'task-a', revision: 7 });
const task: SopTaskSummary = { taskId: 'task-a', ordinal: 1, displayName: null, revision: 7, sceneId: projection.sceneId, sceneTitle: projection.sceneTitle, taskTitle: projection.taskTitle, stepIndex: 1, waiting: null };
type TransferRegistration = { taskId: string; hostEpoch: number; prepareTransfer: () => Promise<boolean>; finishTransfer: () => void };

function setup(firstCurrent?: () => Promise<SopDraftResult>, onTransferGuard?: (guard: TransferRegistration | null) => void) {
  const owner = new SopRenameDraftOwner();
  const api = {
    command: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })),
    copyCurrent: vi.fn(async (): Promise<SopCopyResult> => ({ ok: false, message: '不可复制' })),
    renameCurrent: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })),
    draftCurrent: vi.fn(async ({ taskId }: { taskId: string }): Promise<SopDraftResult> => ({ ok: true, draft: owner.current(taskId) })),
    draftStart: vi.fn(async ({ taskId, revision }: { taskId: string; revision: number }): Promise<SopDraftResult> => ({ ok: true, draft: owner.start(taskId, revision, null, '过敏流程 #1') })),
    draftUpdate: vi.fn(async ({ taskId, draftId, sequence, value }: { taskId: string; draftId: number; sequence: number; value: string }) => owner.update(taskId, draftId, sequence, value)),
    draftDiscard: vi.fn(async ({ taskId, draftId }: { taskId: string; draftId: number }) => owner.discard(taskId, draftId)),
  };
  if (firstCurrent) api.draftCurrent.mockImplementationOnce(firstCurrent);
  const switched = vi.fn();
  const onSearch = vi.fn();
  const onCollapse = vi.fn(async () => {});
  const element = (epoch: number) => <IntakeAntdTheme><QuerySopPanel task={task} projection={projection} api={api} hostEpoch={epoch} onCollapse={onCollapse} onSearch={onSearch} onTransferGuard={onTransferGuard}
    windowControls={(disabled, guard) => <button disabled={disabled} onClick={() => { void guard.prepareTransfer().then(ok => { if (ok) switched(); }).finally(guard.finishTransfer); }}>切换宿主</button>} />
  </IntakeAntdTheme>;
  const view = render(element(3));
  return { owner, api, switched, onSearch, onCollapse, element, view };
}

async function editName(name: string) {
  await waitFor(() => expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '编辑流程名称' }));
  const input = screen.getByRole('textbox', { name: '流程名称' });
  fireEvent.change(input, { target: { value: name } });
  return input;
}

describe('SOP step draft transfer', () => {
  it.each(['shortcut', 'copy button', 'decision'] as const)('blocks %s immediately when transfer preparation starts', async action => {
    const registrations: TransferRegistration[] = [];
    const { api } = setup(undefined, guard => { if (guard) registrations.push(guard); });
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeEnabled());
    const guard = registrations[0];
    if (!guard) throw new Error('Missing transfer guard');
    const copy = screen.getByRole('button', { name: '复制索取凭证' });
    const choice = screen.getByRole('button', { name: /已给照片/ });
    await act(async () => {
      const transfer = guard.prepareTransfer();
      if (action === 'shortcut') fireEvent.keyDown(window, { key: 'F6' });
      else fireEvent.click(action === 'copy button' ? copy : choice);
      expect(api.copyCurrent).not.toHaveBeenCalled();
      expect(api.command).not.toHaveBeenCalled();
      expect(await transfer).toBe(true);
      guard.finishTransfer();
    });
    fireEvent.click(choice);
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'choose', edgeId: 'has-photo' })));
  });

  it.each(['copy', 'choose'] as const)('does not transfer while a %s action is still pending', async action => {
    const { api, onSearch, onCollapse, switched } = setup();
    let finishCopy: (value: SopCopyResult) => void = () => undefined;
    let finishCommand: (value: SopWindowResult) => void = () => undefined;
    if (action === 'copy') api.copyCurrent.mockImplementationOnce(() => new Promise(resolve => { finishCopy = resolve; }));
    else api.command.mockImplementationOnce(() => new Promise(resolve => { finishCommand = resolve; }));
    const button = await screen.findByRole('button', { name: action === 'copy' ? '复制索取凭证' : /已给照片/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: '返回搜索' }));
    expect(await screen.findByText('当前操作处理中，请稍后重试')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    fireEvent.click(screen.getByRole('button', { name: '切换宿主' }));
    expect(onSearch).not.toHaveBeenCalled();
    expect(onCollapse).not.toHaveBeenCalled();
    expect(switched).not.toHaveBeenCalled();
    await act(async () => {
      if (action === 'copy') finishCopy({ ok: true, outcome: 'copied-stayed', reason: 'decision', source: { taskId: 'task-a', revision: 7, stepIndex: 1 }, sourceTitle: projection.taskTitle, copyGeneration: 1 });
      else finishCommand({ ok: true });
    });
    await waitFor(() => expect(screen.queryByText('当前操作处理中，请稍后重试')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '返回搜索' }));
    await waitFor(() => expect(onSearch).toHaveBeenCalledOnce());
  });

  it('registers its task and host guard and removes it after the panel unmounts', async () => {
    const onTransferGuard = vi.fn();
    const { view } = setup(undefined, onTransferGuard);
    await waitFor(() => expect(onTransferGuard).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-a', hostEpoch: 3 })));
    view.unmount();
    expect(onTransferGuard).toHaveBeenLastCalledWith(null);
  });

  it('rejects an old registration when the task host changes', async () => {
    const registrations: TransferRegistration[] = [];
    const { element, view } = setup(undefined, guard => { if (guard) registrations.push(guard); });
    await waitFor(() => expect(registrations).toHaveLength(1));
    const old = registrations[0];
    if (!old) throw new Error('Missing initial guard');
    view.rerender(element(4));
    await waitFor(() => expect(registrations).toHaveLength(2));
    expect(registrations[1]?.hostEpoch).toBe(4);
    expect(await old.prepareTransfer()).toBe(false);
  });

  it('rejects a previously registered flush that resolves after its host changes', async () => {
    const registrations: TransferRegistration[] = [];
    const { owner, api, element, view } = setup(undefined, guard => { if (guard) registrations.push(guard); });
    await editName('合成客户甲');
    await waitFor(() => expect(owner.current('task-a')?.value).toBe('合成客户甲'));
    const old = registrations[0];
    if (!old) throw new Error('Missing initial guard');
    let finish: () => void = () => undefined;
    api.draftUpdate.mockImplementationOnce(request => new Promise(resolve => {
      finish = () => resolve(owner.update(request.taskId, request.draftId, request.sequence, request.value));
    }));
    let pending: Promise<boolean> | undefined;
    act(() => { pending = old.prepareTransfer(); });
    await waitFor(() => expect(screen.getByRole('textbox', { name: '流程名称' })).toBeDisabled());
    view.rerender(element(4));
    await act(async () => { finish(); expect(await pending).toBe(false); });
  });

  it('flushes the unsaved name before returning and restores it in a new host', async () => {
    const { owner, onSearch, element, view } = setup();
    await editName('合成客户甲');
    fireEvent.click(screen.getByRole('button', { name: '返回搜索' }));
    await waitFor(() => expect(onSearch).toHaveBeenCalledOnce());
    expect(owner.current('task-a')?.value).toBe('合成客户甲');
    view.rerender(element(4));
    expect(await screen.findByRole('textbox', { name: '流程名称' })).toHaveValue('合成客户甲');
  });

  it('keeps the edit in the original host if flushing fails', async () => {
    const { api, switched } = setup();
    const input = await editName('合成客户乙');
    api.draftUpdate.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: '切换宿主' }));
    expect(await screen.findByText('未能保留名称草稿，请重试')).toBeVisible();
    expect(input).toHaveValue('合成客户乙');
    expect(input).toBeEnabled();
    expect(switched).not.toHaveBeenCalled();
  });

  it('does not let a late older input overwrite a newer draft', async () => {
    const { owner, api } = setup();
    const input = await editName('合成客户');
    await waitFor(() => expect(owner.current('task-a')?.value).toBe('合成客户'));
    let finishOld: () => void = () => undefined;
    api.draftUpdate.mockImplementationOnce(request => new Promise(resolve => {
      finishOld = () => resolve(owner.update(request.taskId, request.draftId, request.sequence, request.value));
    }));
    fireEvent.change(input, { target: { value: '旧输入' } });
    fireEvent.change(input, { target: { value: '新输入' } });
    await waitFor(() => expect(owner.current('task-a')?.value).toBe('新输入'));
    await act(async () => finishOld());
    expect(input).toHaveValue('新输入');
    expect(owner.current('task-a')?.value).toBe('新输入');
    expect(screen.queryByText('未能保留名称草稿，请重试')).not.toBeInTheDocument();
  });

  it('blocks editing until an unavailable draft can be read again', async () => {
    setup(async () => ({ ok: false }));
    expect(await screen.findByText('无法读取名称草稿')).toBeVisible();
    expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeEnabled());
  });

  it('ignores an old host draft response after the execution host changes', async () => {
    let finish: (value: SopDraftResult) => void = () => undefined;
    const { owner, element, view } = setup(() => new Promise(resolve => { finish = resolve; }));
    view.rerender(element(4));
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeEnabled());
    const oldDraft = owner.start('task-a', 7, null, '旧宿主草稿');
    await act(async () => finish({ ok: true, draft: oldDraft }));
    expect(screen.queryByRole('textbox', { name: '流程名称' })).not.toBeInTheDocument();
  });

  it('does not transfer during IME composition and preserves the composed input', async () => {
    const { switched } = setup();
    const input = await editName('合成客户');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '合成客户甲' } });
    fireEvent.click(screen.getByRole('button', { name: '切换宿主' }));
    expect(await screen.findByText('请先完成输入')).toBeVisible();
    expect(input).toHaveValue('合成客户甲');
    expect(switched).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { data: '甲' });
    fireEvent.click(screen.getByRole('button', { name: '切换宿主' }));
    await waitFor(() => expect(switched).toHaveBeenCalledOnce());
  });

  it('locks the input while its latest draft is being flushed for transfer', async () => {
    const { owner, api, switched } = setup();
    const input = await editName('合成客户丙');
    await waitFor(() => expect(owner.current('task-a')?.value).toBe('合成客户丙'));
    let finish: () => void = () => undefined;
    api.draftUpdate.mockImplementationOnce(request => new Promise(resolve => {
      finish = () => resolve(owner.update(request.taskId, request.draftId, request.sequence, request.value));
    }));
    fireEvent.click(screen.getByRole('button', { name: '切换宿主' }));
    await waitFor(() => expect(input).toBeDisabled());
    fireEvent.change(input, { target: { value: '不能覆盖已提交草稿' } });
    expect(input).toHaveValue('合成客户丙');
    await act(async () => finish());
    await waitFor(() => expect(switched).toHaveBeenCalledOnce());
    expect(owner.current('task-a')?.value).toBe('合成客户丙');
  });

  it('does not navigate a new host when the old host finishes flushing late', async () => {
    const { owner, api, onSearch, element, view } = setup();
    await editName('合成客户戊');
    await waitFor(() => expect(owner.current('task-a')?.value).toBe('合成客户戊'));
    let finish: () => void = () => undefined;
    api.draftUpdate.mockImplementationOnce(request => new Promise(resolve => {
      finish = () => resolve(owner.update(request.taskId, request.draftId, request.sequence, request.value));
    }));
    fireEvent.click(screen.getByRole('button', { name: '返回搜索' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '流程名称' })).toBeDisabled());
    view.rerender(element(4));
    await act(async () => finish());
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('shows a hide failure after rollback changes the host epoch and keeps the draft and step', async () => {
    const { owner, api, onCollapse, element, view } = setup();
    let rejectHide: (reason: Error) => void = () => undefined;
    onCollapse.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectHide = reject; }));
    await editName('合成客户己');
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    await waitFor(() => expect(onCollapse).toHaveBeenCalledOnce());
    view.rerender(element(4));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '流程名称' })).toBeEnabled());
    await act(async () => rejectHide(new Error('native rollback')));
    expect(await screen.findByText('操作失败，请重试')).toBeVisible();
    expect(screen.getByRole('textbox', { name: '流程名称' })).toHaveValue('合成客户己');
    expect(owner.current('task-a')?.value).toBe('合成客户己');
    expect(screen.getByRole('heading', { name: projection.taskTitle })).toBeVisible();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.copyCurrent).not.toHaveBeenCalled();
  });

  it('does not show a late old hide failure after a newer transfer has succeeded', async () => {
    const { onCollapse, element, view } = setup();
    let rejectHide: (reason: Error) => void = () => undefined;
    onCollapse.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectHide = reject; }));
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    await waitFor(() => expect(onCollapse).toHaveBeenCalledOnce());
    view.rerender(element(4));
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    await waitFor(() => expect(onCollapse).toHaveBeenCalledTimes(2));
    await act(async () => rejectHide(new Error('late old failure')));
    expect(screen.queryByText('操作失败，请重试')).not.toBeInTheDocument();
  });

  it('shows a retryable error and releases the edit after a hide failure', async () => {
    const { onCollapse } = setup();
    const input = await editName('合成客户丁');
    onCollapse.mockRejectedValueOnce(new Error('hide unavailable'));
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(await screen.findByText('操作失败，请重试')).toBeVisible();
    expect(input).toHaveValue('合成客户丁');
    expect(input).toBeEnabled();
  });
});
