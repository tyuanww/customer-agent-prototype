import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingSopApp } from '../../src/renderer/features/sop/FloatingSopApp';
import { projectSop } from '../../src/shared/sop-model';
import { MISSING_ITEM_SOP_TREE } from '../../src/shared/synthetic-sops';
import type { QuerySopSnapshot, SopFloatingSnapshot, SopFloatingApi, SopWindowResult, SopCopyResult, SopDraft } from '../../src/shared/sop-window';

const projection = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: { sceneId: MISSING_ITEM_SOP_TREE.sceneId, nodeId: 'collect', stepIndex: 1 }, role: 'agent', taskId: 'sop-1', revision: 1 });
function snapshot(access: Exclude<Extract<QuerySopSnapshot, { kind: 'ready' }>['access'], { kind: 'none' }>, sequence = 1, taskProjection = projection, seenActiveTaskIds = [taskProjection.taskId]): Extract<SopFloatingSnapshot, { kind: 'ready' }> {
  return { kind: 'ready', sequence, copyGeneration: 0, collapsed: false, seenActiveTaskIds, tasks: [{ taskId: taskProjection.taskId, revision: taskProjection.revision, ordinal: 1, displayName: '小林售后', sceneId: taskProjection.sceneId, sceneTitle: taskProjection.sceneTitle, taskTitle: taskProjection.taskTitle, stepIndex: taskProjection.stepIndex, waiting: null }], mode: 'floating', access, view: { kind: 'sop', taskId: taskProjection.taskId }, viewEpoch: 1, transition: null, projection: taskProjection };
}
function setup(initial = snapshot({ kind: 'preview', mountId: 3 })) {
  let notify: (value: SopFloatingSnapshot) => void = () => {};
  let nextDraftId = 0;
  const drafts = new Map<string, SopDraft>();
  const api: SopFloatingApi = {
    current: vi.fn(async () => initial), ready: vi.fn(async () => true), command: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })),
    renameCurrent: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })),
    copyCurrent: vi.fn(async (): Promise<SopCopyResult> => ({ ok: false, message: '复制暂不可用' })), windowIntent: vi.fn(async () => true),
    draftCurrent: vi.fn(async ({ taskId }) => ({ ok: true, draft: drafts.get(taskId) ?? null })),
    draftStart: vi.fn(async ({ taskId, revision }) => {
      const draft = drafts.get(taskId) ?? { draftId: ++nextDraftId, revision, initialName: '小林售后', value: '小林售后', sequence: 0 };
      drafts.set(taskId, draft);
      return { ok: true, draft };
    }),
    draftUpdate: vi.fn(async ({ taskId, draftId, sequence, value }) => {
      const draft = drafts.get(taskId);
      if (!draft || draft.draftId !== draftId || sequence <= draft.sequence) return false;
      drafts.set(taskId, { ...draft, sequence, value });
      return true;
    }),
    draftDiscard: vi.fn(async ({ taskId, draftId }) => {
      if (drafts.get(taskId)?.draftId !== draftId) return false;
      drafts.delete(taskId);
      return true;
    }),
    onProjection: vi.fn(callback => { notify = callback; return vi.fn(); }),
  };
  window.sopFloating = api;
  return { api, clearDraft: (taskId: string) => drafts.delete(taskId), notify: (value: SopFloatingSnapshot) => act(() => { notify(value); }) };
}
async function showQueryItem() {
  fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));
  return screen.findByRole('menuitem', { name: '显示查询' });
}
afterEach(() => { delete window.sopFloating; });
describe('floating SOP shared panel', () => {
  it('requires confirmation to end only the current floating task and preserves it on cancel', async () => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    const end = await screen.findByRole('button', { name: '结束流程' });
    await waitFor(() => expect(end).toBeEnabled());
    fireEvent.click(end);
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(dialog.getByText(/小林售后/)).toBeVisible());
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: '取消' }));
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(end);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '结束流程' }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'end', taskId: 'sop-1', revision: 1, hostEpoch: 9 })));
    expect(api.windowIntent).not.toHaveBeenCalled();
  });
  it('acknowledges a rendered read-only preview before allowing execution', async () => {
    const { api, notify } = setup();
    render(<FloatingSopApp />);
    expect(await screen.findByRole('heading', { name: projection.taskTitle })).toBeVisible();
    expect(screen.getByLabelText('小林售后')).toBeVisible();
    expect(screen.getByText(projection.sceneTitle)).toBeVisible();
    await waitFor(() => expect(api.ready).toHaveBeenCalledWith({ mountId: 3 }));
    expect(screen.getByRole('button', { name: '结束流程' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '复制确认收到材料' })).toBeDisabled();
    notify(snapshot({ kind: 'executable', hostEpoch: 9 }, 2));
    await waitFor(() => expect(screen.getByRole('button', { name: '复制确认收到材料' })).toBeEnabled());
    fireEvent.click(screen.getByRole('checkbox', { name: '已核对订单应收数量' }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ hostEpoch: 9, taskId: projection.taskId, type: 'check' })));
  });
  it('hides through the assigned host without ending the task', async () => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    fireEvent.click(await screen.findByRole('button', { name: '收起' }));
    await waitFor(() => expect(api.windowIntent).toHaveBeenCalledWith({ type: 'hide', taskId: projection.taskId, hostEpoch: 9 }));
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(await showQueryItem());
    await waitFor(() => expect(api.windowIntent).toHaveBeenCalledWith({ type: 'show-query', taskId: projection.taskId, hostEpoch: 9 }));
    expect(screen.getByRole('button', { name: '合回查询' })).toBeVisible();
  });
  it.each(['rejected', 'failed'])('keeps the step visible when showing Query is %s', async failure => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    vi.mocked(api.windowIntent).mockImplementationOnce(async () => {
      if (failure === 'rejected') throw new Error('Window unavailable');
      return false;
    });
    render(<FloatingSopApp />);
    fireEvent.click(await showQueryItem());
    expect(await screen.findByText('暂时无法显示查询，请重试')).toBeVisible();
    expect(screen.getByRole('heading', { name: projection.taskTitle })).toBeVisible();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.copyCurrent).not.toHaveBeenCalled();
  });
  it('clears a show-query error after retry succeeds', async () => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    vi.mocked(api.windowIntent).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<FloatingSopApp />);
    fireEvent.click(await showQueryItem());
    expect(await screen.findByText('暂时无法显示查询，请重试')).toBeVisible();
    fireEvent.click(await showQueryItem());
    await waitFor(() => expect(screen.queryByText('暂时无法显示查询，请重试')).not.toBeInTheDocument());
  });
  it.each([
    { type: 'show-query' as const, label: '显示查询', error: '暂时无法显示查询，请重试' },
    { type: 'hide' as const, label: '收起', error: '窗口收起失败，请重试' },
  ])('retries the failed $label action from the alert', async ({ type, label, error }) => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    vi.mocked(api.windowIntent).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<FloatingSopApp />);
    const button = label === '显示查询' ? await showQueryItem() : await screen.findByRole('button', { name: label });
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByText(error)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(api.windowIntent).toHaveBeenCalledTimes(2));
    expect(api.windowIntent).toHaveBeenLastCalledWith({ type, taskId: 'sop-1', hostEpoch: 9 });
    await waitFor(() => expect(screen.queryByText(error)).not.toBeInTheDocument());
  });
  it.each(['show-query', 'hide'] as const)('ignores a late %s failure after the host changes', async type => {
    const { api, notify } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    let finish: (ok: boolean) => void = () => undefined;
    vi.mocked(api.windowIntent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<FloatingSopApp />);
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeEnabled());
    fireEvent.click(type === 'hide' ? screen.getByRole('button', { name: '收起' }) : await showQueryItem());
    await waitFor(() => expect(api.windowIntent).toHaveBeenCalledOnce());
    notify(snapshot({ kind: 'executable', hostEpoch: 10 }, 2));
    await act(async () => finish(false));
    expect(screen.queryByText('暂时无法显示查询，请重试')).not.toBeInTheDocument();
    expect(screen.queryByText('窗口收起失败，请重试')).not.toBeInTheDocument();
  });
  it('flushes an edited draft again before retrying a failed collapse', async () => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    vi.mocked(api.windowIntent).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<FloatingSopApp />);
    const edit = await screen.findByRole('button', { name: '编辑流程名称' });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    const input = screen.getByRole('textbox', { name: '流程名称' });
    fireEvent.change(input, { target: { value: '第一版草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(await screen.findByText('窗口收起失败，请重试')).toBeVisible();
    fireEvent.change(input, { target: { value: '修改后的草稿' } });
    await waitFor(async () => expect(await api.draftCurrent?.({ taskId: 'sop-1', hostEpoch: 9 })).toMatchObject({ ok: true, draft: { value: '修改后的草稿' } }));
    const draftUpdate = api.draftUpdate;
    if (!draftUpdate) throw new Error('Missing draft update');
    const write = vi.mocked(draftUpdate).getMockImplementation();
    if (!write) throw new Error('Missing draft update implementation');
    let finish: () => void = () => undefined;
    vi.mocked(draftUpdate).mockImplementationOnce(request => new Promise(resolve => { finish = () => { void Promise.resolve(write(request)).then(resolve); }; }));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(input).toBeDisabled());
    expect(api.windowIntent).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(api.windowIntent).toHaveBeenCalledTimes(2));
    expect(await api.draftCurrent?.({ taskId: 'sop-1', hostEpoch: 9 })).toMatchObject({ ok: true, draft: { value: '修改后的草稿' } });
  });
  it('does not submit a second show-query request while the first is pending', async () => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    let finish: (ok: boolean) => void = () => undefined;
    vi.mocked(api.windowIntent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<FloatingSopApp />);
    const button = await showQueryItem();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.windowIntent).toHaveBeenCalledTimes(1);
    await act(async () => finish(true));
    expect(screen.queryByText('暂时无法显示查询，请重试')).not.toBeInTheDocument();
  });
  it('clears projected content when a later projection is invalid', async () => {
    const { notify } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    await screen.findByRole('heading', { name: projection.taskTitle });
    notify({ kind: 'unavailable', message: '流程不可用' });
    expect(screen.queryByRole('heading', { name: projection.taskTitle })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('流程不可用');
  });
  it('hides stale content if an accepted step cannot be reread', async () => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    await screen.findByRole('heading', { name: projection.taskTitle });
    vi.mocked(api.current).mockRejectedValueOnce(new Error('read failed'));
    fireEvent.click(screen.getByRole('checkbox', { name: '已核对订单应收数量' }));
    expect(await screen.findByRole('button', { name: '重新读取' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: projection.taskTitle })).not.toBeInTheDocument();
    expect(screen.queryByText('操作失败，请重试')).not.toBeInTheDocument();
  });
  it('keeps step actions disabled until the accepted operation is reconciled', async () => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    await screen.findByRole('heading', { name: projection.taskTitle });
    let finish: (result: SopFloatingSnapshot) => void = () => undefined;
    vi.mocked(api.current).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('checkbox', { name: '已核对订单应收数量' }));
    await waitFor(() => expect(api.current).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '复制确认收到材料' })).toBeDisabled();
    await act(async () => finish(snapshot({ kind: 'executable', hostEpoch: 9 }, 2, { ...projection, revision: 2 })));
    expect(screen.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeEnabled();
  });
  it('does not re-enable an old step if the successful operation rereads the old revision', async () => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    await screen.findByRole('heading', { name: projection.taskTitle });
    fireEvent.click(screen.getByRole('checkbox', { name: '已核对订单应收数量' }));
    expect(await screen.findByRole('button', { name: '重新读取' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '复制确认收到材料' })).not.toBeInTheDocument();
    expect(screen.queryByText('操作失败，请重试')).not.toBeInTheDocument();
    expect(api.command).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(api.current).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('button', { name: '重新读取' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '复制确认收到材料' })).not.toBeInTheDocument();
    vi.mocked(api.current).mockResolvedValueOnce(snapshot({ kind: 'executable', hostEpoch: 9 }, 2, { ...projection, revision: 2 }));
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(await screen.findByRole('button', { name: '复制确认收到材料' })).toBeEnabled();
  });
  it('refreshes its visible snapshot on focus after a missed update', async () => {
    const { api } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    await screen.findByRole('heading', { name: projection.taskTitle });
    vi.mocked(api.current).mockResolvedValueOnce(snapshot({ kind: 'executable', hostEpoch: 10 }, 2, { ...projection, taskTitle: '更新后的步骤' }));
    fireEvent.focus(window);
    expect(await screen.findByRole('heading', { name: '更新后的步骤' })).toBeVisible();
  });
  it('ignores a failed recovery read after a newer projection has restored the flow', async () => {
    const { api, notify } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    await screen.findByRole('heading', { name: projection.taskTitle });
    notify({ kind: 'unavailable', message: '流程不可用' });
    let rejectRead: (error: Error) => void = () => undefined;
    vi.mocked(api.current).mockImplementationOnce(() => new Promise((_, reject) => { rejectRead = reject; }));
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    notify(snapshot({ kind: 'executable', hostEpoch: 10 }, 2));
    await act(async () => rejectRead(new Error('old recovery failed')));
    expect(screen.getByRole('heading', { name: projection.taskTitle })).toBeVisible();
    expect(screen.queryByText('读取失败，请重试')).not.toBeInTheDocument();
  });
  it('restores an unsaved name after this task is collapsed and expanded', async () => {
    const { api, notify } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    const edit = await screen.findByRole('button', { name: '编辑流程名称' });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    fireEvent.change(screen.getByRole('textbox', { name: '流程名称' }), { target: { value: '合成草稿甲' } });
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    await waitFor(() => expect(api.windowIntent).toHaveBeenCalledWith({ type: 'hide', taskId: 'sop-1', hostEpoch: 9 }));
    notify({ ...snapshot({ kind: 'executable', hostEpoch: 9 }, 2), collapsed: true });
    expect(screen.queryByRole('textbox', { name: '流程名称' })).not.toBeInTheDocument();
    notify(snapshot({ kind: 'executable', hostEpoch: 9 }, 3));
    expect(await screen.findByRole('textbox', { name: '流程名称' })).toHaveValue('合成草稿甲');
  });
  it('rejects a projection for another task in the same floating renderer', async () => {
    const { notify } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    await screen.findByRole('heading', { name: projection.taskTitle });
    notify(snapshot({ kind: 'executable', hostEpoch: 10 }, 2, { ...projection, taskId: 'sop-2', taskTitle: '其他任务正文' }));
    expect(screen.queryByText('其他任务正文')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('无法读取流程进度');
  });
  it('does not discard drafts on unavailable or older snapshots', async () => {
    const { api, notify } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    render(<FloatingSopApp />);
    const edit = await screen.findByRole('button', { name: '编辑流程名称' });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    fireEvent.change(screen.getByRole('textbox', { name: '流程名称' }), { target: { value: '尚未保存' } });
    await waitFor(() => expect(api.draftUpdate).toHaveBeenCalled());
    notify({ kind: 'unavailable', message: '流程不可用' });
    notify(snapshot({ kind: 'executable', hostEpoch: 10 }, 2));
    notify(snapshot({ kind: 'executable', hostEpoch: 9 }, 1));
    expect(await screen.findByRole('textbox', { name: '流程名称' })).toHaveValue('尚未保存');
  });
  it('does not let a delayed success discard a newer edit', async () => {
    const { api, clearDraft, notify } = setup(snapshot({ kind: 'executable', hostEpoch: 9 }));
    let finish: (result: SopWindowResult) => void = () => undefined;
    vi.mocked(api.renameCurrent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<FloatingSopApp />);
    const edit = await screen.findByRole('button', { name: '编辑流程名称' });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    fireEvent.change(screen.getByRole('textbox', { name: '流程名称' }), { target: { value: '旧草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    await waitFor(() => expect(api.renameCurrent).toHaveBeenCalled());
    clearDraft('sop-1');
    notify(snapshot({ kind: 'executable', hostEpoch: 11 }, 4, { ...projection, revision: 2 }));
    const nextEdit = await screen.findByRole('button', { name: '编辑流程名称' });
    await waitFor(() => expect(nextEdit).toBeEnabled());
    fireEvent.click(nextEdit);
    fireEvent.change(screen.getByRole('textbox', { name: '流程名称' }), { target: { value: '新草稿' } });
    await act(async () => finish({ ok: true }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: '流程名称' })).toHaveValue('新草稿');
  });
});
