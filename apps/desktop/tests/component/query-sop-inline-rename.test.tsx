import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IntakeAntdTheme } from '../../src/renderer/features/dashboard/intake-antd';
import { SopRenameDraftOwner } from '../../src/main/sop-rename-draft-owner';
import { QuerySopPanel } from '../../src/renderer/features/sop/QuerySopPanel';
import { QuerySopWindowControls } from '../../src/renderer/features/sop/QuerySopWindowControls';
import { projectSop } from '../../src/shared/sop-model';
import { ALLERGY_SOP_TREE } from '../../src/shared/synthetic-sops';
import type { SopDraftIdentity, SopDraftStart, SopDraftUpdate, SopDraftDiscard, SopExecutionRename, SopTaskSummary, SopWindowResult } from '../../src/shared/sop-window';

const projection = projectSop({ tree: ALLERGY_SOP_TREE, progress: { sceneId: ALLERGY_SOP_TREE.sceneId, nodeId: 'voucher-ask', stepIndex: 1 }, role: 'agent', taskId: 'task-a', revision: 7 });
const task: SopTaskSummary = { taskId: 'task-a', ordinal: 1, displayName: null, revision: 7, sceneId: projection.sceneId, sceneTitle: projection.sceneTitle, taskTitle: projection.taskTitle, stepIndex: 1, waiting: null };

function draftApi(currentTask: () => SopTaskSummary) {
  const owner = new SopRenameDraftOwner();
  return {
    draftCurrent: vi.fn(async (request: SopDraftIdentity) => ({ ok: true as const, draft: owner.current(request.taskId) })),
    draftStart: vi.fn(async (request: SopDraftStart) => {
      const current = currentTask();
      return { ok: true as const, draft: owner.start(request.taskId, request.revision, current.displayName, current.displayName ?? `${current.sceneTitle} #${current.ordinal}`) };
    }),
    draftUpdate: vi.fn(async (request: SopDraftUpdate) => owner.update(request.taskId, request.draftId, request.sequence, request.value)),
    draftDiscard: vi.fn(async (request: SopDraftDiscard) => owner.discard(request.taskId, request.draftId)),
  };
}

async function openRename() {
  const edit = screen.getByRole('button', { name: '编辑流程名称' });
  await waitFor(() => expect(edit).toBeEnabled());
  fireEvent.click(edit);
}

function setup() {
  let currentTask = task;
  const api = {
    command: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })),
    copyCurrent: vi.fn(async () => ({ ok: false as const, message: '不可复制' })),
    renameCurrent: vi.fn(async (_request: SopExecutionRename): Promise<SopWindowResult> => ({ ok: true })),
    ...draftApi(() => currentTask),
  };
  const element = (nextTask = task, epoch: number | null = 3, sceneTitle = projection.sceneTitle) => {
    currentTask = nextTask;
    return <IntakeAntdTheme><QuerySopPanel task={nextTask} projection={{ ...projection, sceneTitle, taskId: nextTask.taskId, revision: nextTask.revision }} api={api} hostEpoch={epoch} onCollapse={vi.fn()} /></IntakeAntdTheme>;
  };
  const view = render(element());
  return { api, element, view };
}

describe('SOP step inline nickname', () => {
  it('reveals a long nickname when its title receives keyboard focus', async () => {
    const name = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉';
    const { view, element } = setup();
    view.rerender(element({ ...task, displayName: name }));
    const title = screen.getByLabelText(name);
    expect(title).toHaveAttribute('tabindex', '0');
    fireEvent.focus(title);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(name);
  });

  it('reveals a long process subtitle when it receives keyboard focus', async () => {
    const name = '需要完整阅读的较长过敏流程名称及其后续说明';
    const { view, element } = setup();
    view.rerender(element({ ...task, displayName: '合成客户甲', sceneTitle: name }, 3, name));
    const subtitle = screen.getByLabelText(name);
    expect(subtitle).toHaveAttribute('tabindex', '0');
    fireEvent.focus(subtitle);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(name);
  });

  it('edits the visible name and reports a successful change without invoking step shortcuts', async () => {
    const { api } = setup();
    expect(screen.queryByRole('status', { name: '名称已调整' })).not.toBeInTheDocument();
    await openRename();
    const input = screen.getByRole('textbox', { name: '流程名称' });
    expect(input).toHaveValue(`${task.sceneTitle} #1`);
    fireEvent.change(input, { target: { value: '合成客户甲' } });
    fireEvent.keyDown(window, { key: 'F6' });
    fireEvent.keyDown(window, { key: 'F8' });
    expect(api.copyCurrent).not.toHaveBeenCalled();
    expect(api.command).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '更多操作' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /已给照片/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    await waitFor(() => expect(api.renameCurrent).toHaveBeenCalledWith({ taskId: 'task-a', revision: 7, hostEpoch: 3, displayName: '合成客户甲' }));
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('已调整');
    expect(notice).toHaveAttribute('data-phase', 'label');
    expect(screen.getByRole('button', { name: '名称已保存' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '编辑流程名称' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '核实凭证' })).toHaveFocus();
    await waitFor(() => expect(notice).toHaveAttribute('data-phase', 'check'), { timeout: 2500 });
    expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('status', { name: '名称已调整' })).not.toBeInTheDocument(), { timeout: 2000 });
  });

  it('does not move focus back to the edit button after the user moves it while saving', async () => {
    const { api } = setup();
    let finish: (value: SopWindowResult) => void = () => undefined;
    api.renameCurrent.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await openRename();
    fireEvent.change(screen.getByRole('textbox', { name: '流程名称' }), { target: { value: '客户乙' } });
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    const panel = screen.getByRole('region', { name: 'SOP 流程' });
    panel.focus();
    await waitFor(() => expect(api.renameCurrent).toHaveBeenCalledOnce());
    await act(async () => finish({ ok: true }));
    const notice = await screen.findByRole('status');
    await waitFor(() => expect(notice).toHaveAttribute('data-phase', 'check'), { timeout: 2500 });
    expect(panel).toHaveFocus();
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeVisible());
  });

  it('does not turn the unchanged default title into a nickname', async () => {
    const { api } = setup();
    await openRename();
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    expect(api.renameCurrent).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑流程名称' })).toBeVisible());
  });

  it('keeps an existing 20-character name when insertion exceeds the limit and permits replacement', async () => {
    const name = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉';
    const user = userEvent.setup();
    const { view, element } = setup();
    view.rerender(element({ ...task, displayName: name }));
    await openRename();
    const input = screen.getByRole('textbox', { name: '流程名称' });
    if (!(input instanceof HTMLInputElement)) throw new Error('Expected a text input');
    input.setSelectionRange(0, 0);
    await user.keyboard('新');
    expect(input).toHaveValue(name);
    expect(screen.getByRole('alert')).toHaveTextContent('最多 20 字');
    input.setSelectionRange(0, 1);
    await user.keyboard('新');
    expect(input).toHaveValue(`新${name.slice(1)}`);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps an over-limit IME composition intact until the operator shortens it', async () => {
    const name = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉';
    const { api, view, element } = setup();
    view.rerender(element({ ...task, displayName: name }));
    await openRename();
    const input = screen.getByRole('textbox', { name: '流程名称' });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: `${name}新` } });
    fireEvent.compositionEnd(input, { data: '新' });
    expect(input).toHaveValue(`${name}新`);
    expect(screen.getByRole('alert')).toHaveTextContent('最多 20 字');
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    expect(api.renameCurrent).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: name } });
    expect(input).toHaveValue(name);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains the draft when save fails and permits an explicit retry against the current revision', async () => {
    const { api, element, view } = setup();
    api.renameCurrent.mockResolvedValueOnce({ ok: false, code: 'INVALID', message: '待办已变化，请重新选择' });
    await openRename();
    fireEvent.change(screen.getByRole('textbox', { name: '流程名称' }), { target: { value: '客户乙' } });
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('待办已变化');
    expect(screen.getByRole('textbox', { name: '流程名称' })).toHaveValue('客户乙');
    view.rerender(element({ ...task, revision: 8, displayName: '外部更新甲' }));
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    expect(api.renameCurrent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('待办已变化');
    view.rerender(element({ ...task, revision: 9, displayName: '外部更新乙' }));
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    expect(api.renameCurrent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: '流程名称' })).toHaveValue('客户乙');
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    await waitFor(() => expect(api.renameCurrent).toHaveBeenLastCalledWith({ taskId: 'task-a', revision: 9, hostEpoch: 3, displayName: '客户乙' }));
  });

  it('honors IME and escape, and cannot cancel an already submitted save', async () => {
    const { api } = setup();
    await openRename();
    const input = screen.getByRole('textbox', { name: '流程名称' });
    fireEvent.change(input, { target: { value: '客户丙' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(api.renameCurrent).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('textbox', { name: '流程名称' })).toBeVisible();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '流程名称' })).not.toBeInTheDocument());
    await openRename();
    fireEvent.change(screen.getByRole('textbox', { name: '流程名称' }), { target: { value: '客户丙' } });
    let finish: (value: SopWindowResult) => void = () => undefined;
    api.renameCurrent.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: '流程名称' }), { key: 'Escape' });
    expect(screen.getByRole('textbox', { name: '流程名称' })).toBeDisabled();
    await waitFor(() => expect(api.renameCurrent).toHaveBeenCalledOnce());
    await act(async () => finish({ ok: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('已调整');
  });

  it('ignores a late save result after the task or host changes', async () => {
    const { api, view, element } = setup();
    let finish: (value: SopWindowResult) => void = () => undefined;
    api.renameCurrent.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await openRename();
    fireEvent.change(screen.getByRole('textbox', { name: '流程名称' }), { target: { value: '客户丁' } });
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    await waitFor(() => expect(api.renameCurrent).toHaveBeenCalledOnce());
    view.rerender(element({ ...task, taskId: 'task-b', ordinal: 2 }, 4));
    await act(async () => finish({ ok: true }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '流程名称' })).not.toBeInTheDocument();
  });

  it.each(['query', 'floating'] as const)('preserves an unsaved name until editing is cancelled in %s', async mode => {
    const api = {
      command: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })),
      copyCurrent: vi.fn(async () => ({ ok: false as const, message: '不可复制' })),
      renameCurrent: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })),
      windowIntent: vi.fn(async () => true),
      ...draftApi(() => task),
    };
    const onSearch = vi.fn();
    const onCollapse = vi.fn();
    const searchLabel = mode === 'query' ? '返回搜索' : '显示查询';
    const transferLabel = mode === 'query' ? '独立悬浮' : '合回查询';
    render(<IntakeAntdTheme><QuerySopWindowControls api={api} taskId="task-a" hostEpoch={3} mode={mode}>{control =>
      <QuerySopPanel task={task} projection={projection} api={api} hostEpoch={3} onSearch={onSearch}
        searchLabel={searchLabel} onCollapse={onCollapse} windowControls={control} />
    }</QuerySopWindowControls></IntakeAntdTheme>);
    await openRename();
    const input = screen.getByRole('textbox', { name: '流程名称' });
    fireEvent.change(input, { target: { value: '合成待保存昵称' } });
    const control = screen.getByRole('button', { name: transferLabel });
    expect(control).toBeEnabled();
    fireEvent.click(control);
    await waitFor(() => expect(api.windowIntent).toHaveBeenCalledWith({ taskId: 'task-a', hostEpoch: 3, type: mode === 'query' ? 'detach' : 'attach' }));
    expect(input).toHaveValue('合成待保存昵称');
    fireEvent.click(screen.getByRole('button', { name: searchLabel }));
    await waitFor(() => expect(onSearch).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    await waitFor(() => expect(onCollapse).toHaveBeenCalledOnce());
    expect(input).toHaveValue('合成待保存昵称');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '流程名称' })).not.toBeInTheDocument());
    for (const label of [transferLabel, searchLabel, '收起']) expect(screen.getByRole('button', { name: label })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: transferLabel }));
    await waitFor(() => expect(api.windowIntent).toHaveBeenCalledWith({ taskId: 'task-a', hostEpoch: 3, type: mode === 'query' ? 'detach' : 'attach' }));
  });

  it.each(['query', 'floating'] as const)('blocks window transfer during an accepted save in %s', async mode => {
    let finish: (value: SopWindowResult) => void = () => undefined;
    const api = {
      command: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })),
      copyCurrent: vi.fn(async () => ({ ok: false as const, message: '不可复制' })),
      renameCurrent: vi.fn(() => new Promise<SopWindowResult>(resolve => { finish = resolve; })),
      windowIntent: vi.fn(async () => true),
      ...draftApi(() => task),
    };
    render(<IntakeAntdTheme><QuerySopWindowControls api={api} taskId="task-a" hostEpoch={3} mode={mode}>{control =>
      <QuerySopPanel task={task} projection={projection} api={api} hostEpoch={3} onCollapse={vi.fn()} windowControls={control} />
    }</QuerySopWindowControls></IntakeAntdTheme>);
    const transfer = screen.getByRole('button', { name: mode === 'query' ? '独立悬浮' : '合回查询' });
    await waitFor(() => expect(transfer).toBeEnabled());
    await openRename();
    fireEvent.change(screen.getByRole('textbox', { name: '流程名称' }), { target: { value: '合成客户戊' } });
    fireEvent.click(screen.getByRole('button', { name: '保存流程名称' }));
    expect(transfer).toBeDisabled();
    fireEvent.click(transfer);
    expect(api.windowIntent).not.toHaveBeenCalled();
    await waitFor(() => expect(api.renameCurrent).toHaveBeenCalledOnce());
    await act(async () => finish({ ok: true }));
    expect(transfer).toBeEnabled();
  });

  it('allows Escape to cancel an edit when focus has moved to the SOP body', async () => {
    const { api } = setup();
    await openRename();
    fireEvent.change(screen.getByRole('textbox', { name: '流程名称' }), { target: { value: '合成客户己' } });
    const scriptToggle = screen.getByRole('button', { name: '索取凭证' });
    scriptToggle.focus();
    fireEvent.keyDown(scriptToggle, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('textbox', { name: '流程名称' })).toBeVisible();
    fireEvent.keyDown(scriptToggle, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '流程名称' })).not.toBeInTheDocument());
    expect(api.renameCurrent).not.toHaveBeenCalled();
  });
});
