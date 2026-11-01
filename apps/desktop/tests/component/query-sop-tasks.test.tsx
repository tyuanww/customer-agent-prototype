import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuerySopTasks } from '../../src/renderer/features/sop/QuerySopTasks';
import { SopRenameDrafts } from '../../src/renderer/features/sop/sop-rename-drafts';
import type { SopTaskSummary } from '../../src/shared/sop-window';

const task: SopTaskSummary = { taskId: 'task-a', ordinal: 1, revision: 3, sceneId: 'missing', sceneTitle: '少件流程', taskTitle: '核对数量', stepIndex: 2, waiting: null, displayName: '小林' };
function setup() {
  const props = { tasks: [task], busy: false, error: null, unavailable: false, onRestore: vi.fn(), onClose: vi.fn(), onRename: vi.fn(async () => true), onRecover: vi.fn(), onLayoutChange: vi.fn() };
  return { ...render(<QuerySopTasks {...props} />), ...props, props };
}
describe('compact SOP tasks', () => {
  it('shows the nickname with the process and current step while keeping close independent', async () => {
    const { onRestore, onClose } = setup();
    const restore = screen.getByRole('button', { name: /^小林/ });
    expect(restore).toHaveTextContent('步骤 2 · 核对数量');
    fireEvent.click(screen.getByRole('button', { name: '结束 小林' }));
    expect(onRestore).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('dialog', { name: '结束流程？' });
    expect(confirmation).toHaveTextContent('结束「小林」后将清除进度');
    fireEvent.click(screen.getByRole('button', { name: '结束流程' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(task));
  });
  it('offers a visible rename action and selects a task without restoring or ending it', async () => {
    const { onRename, onRestore, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: '改名' }));
    expect(screen.getByText('选择要改名的待办')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^修改 小林 的昵称/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '小林售后' } });
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '待办昵称' })).toBeNull());
    expect(onRename).toHaveBeenCalledWith(task, '小林售后');
    expect(onRestore).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('cancels task selection with Escape without dismissing Query or changing a task', () => {
    const { onRestore, onRename, onClose } = setup();
    const dismiss = vi.fn();
    window.addEventListener('keydown', dismiss);
    try {
      fireEvent.click(screen.getByRole('button', { name: '改名' }));
      fireEvent.keyDown(screen.getByRole('button', { name: '取消改名' }), { key: 'Escape' });
      expect(screen.queryByText('选择要改名的待办')).toBeNull();
      expect(dismiss).not.toHaveBeenCalled();
      expect(onRestore).not.toHaveBeenCalled();
      expect(onRename).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', dismiss); }
  });
  it.each([
    ['customer', '等待客户', '等待客户'],
    ['internal', '等待内部', '等待内部协助'],
  ] as const)('shows %s waiting state and the current step when waiting ends', (waiting, waitingLabel, fullLabel) => {
    const view = setup();
    view.rerender(<QuerySopTasks {...view.props} tasks={[{ ...task, waiting }]} />);
    expect(screen.getByRole('button', { name: /^小林/ })).toHaveTextContent(`${waitingLabel} · 2`);
    expect(screen.getByRole('button', { name: /^小林/ })).toHaveAccessibleName(`小林 · 少件流程 · ${fullLabel} · 步骤 2 · 核对数量`);
    view.rerender(<QuerySopTasks {...view.props} />);
    expect(screen.getByRole('button', { name: /^小林/ })).toHaveTextContent('步骤 2 · 核对数量');
    expect(screen.queryByText(waitingLabel)).toBeNull();
  });
  it.each(['focus', 'hover'])('exposes the full process and step through a tooltip on %s', async trigger => {
    setup();
    const restore = screen.getByRole('button', { name: /^小林/ });
    if (trigger === 'focus') fireEvent.focus(restore);
    else fireEvent.mouseEnter(restore);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('小林 · 少件流程 · 步骤 2 · 核对数量');
  });
  it.each(['contextmenu', 'F2'])('edits a task inline through %s and preserves Unicode code points', trigger => {
    const { onRename, onRestore } = setup();
    const restore = screen.getByRole('button', { name: /^小林/ });
    if (trigger === 'F2') fireEvent.keyDown(restore, { key: 'F2' });
    else fireEvent.contextMenu(restore);
    const input = screen.getByRole('textbox', { name: '待办昵称' });
    fireEvent.change(input, { target: { value: '😀'.repeat(20) } });
    fireEvent.change(input, { target: { value: '😀'.repeat(21) } });
    expect(input).toHaveValue('😀'.repeat(20));
    expect(screen.getByRole('alert')).toHaveTextContent('最多 20 字');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(task, '😀'.repeat(20));
    expect(onRestore).not.toHaveBeenCalled();
  });
  it('keeps the existing nickname on an over-limit insertion and allows replacement', async () => {
    const name = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉';
    const user = userEvent.setup();
    const view = setup();
    view.rerender(<QuerySopTasks {...view.props} tasks={[{ ...task, displayName: name }]} />);
    fireEvent.keyDown(screen.getByRole('button', { name: new RegExp(`^${name}`) }), { key: 'F2' });
    const input = screen.getByRole('textbox', { name: '待办昵称' });
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
  it('preserves over-limit IME text and blocks saving until it is shortened', () => {
    const name = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉';
    const view = setup();
    view.rerender(<QuerySopTasks {...view.props} tasks={[{ ...task, displayName: name }]} />);
    fireEvent.keyDown(screen.getByRole('button', { name: new RegExp(`^${name}`) }), { key: 'F2' });
    const input = screen.getByRole('textbox', { name: '待办昵称' });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: `${name}新` } });
    fireEvent.compositionEnd(input, { data: '新' });
    expect(input).toHaveValue(`${name}新`);
    expect(screen.getByRole('alert')).toHaveTextContent('最多 20 字');
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    expect(view.onRename).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: name } });
    expect(input).toHaveValue(name);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each(['button', 'Escape'])('keeps the pending nickname editor open when %s is used', async action => {
    const { onRename } = setup();
    let finish: (result: boolean) => void = () => undefined;
    onRename.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    const input = screen.getByRole('textbox', { name: '待办昵称' });
    fireEvent.change(input, { target: { value: '小林售后' } });
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    expect(onRename).toHaveBeenCalledOnce();
    if (action === 'button') {
      const cancel = screen.getByRole('button', { name: /取\s*消/ });
      expect(cancel).toBeDisabled();
      fireEvent.click(cancel);
    } else {
      fireEvent.keyDown(screen.getByRole('group', { name: '修改 小林 的昵称' }), { key: 'Escape' });
    }
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('小林售后');
    await act(async () => finish(false));
    expect(await screen.findByRole('alert')).toHaveTextContent('昵称保存失败，请重试');
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('小林售后');
    expect(screen.getByRole('button', { name: /取\s*消/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(screen.queryByRole('textbox', { name: '待办昵称' })).toBeNull();
  });
  it('keeps a pending save locked after the list view remounts and restores failures', async () => {
    const drafts = new SopRenameDrafts();
    let finish: (result: boolean) => void = () => undefined;
    const props = { tasks: [task], busy: false, error: null, unavailable: false, drafts, onRestore: vi.fn(), onClose: vi.fn(), onRename: vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })), onRecover: vi.fn(), onLayoutChange: vi.fn() };
    const first = render(<QuerySopTasks {...props} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '保存中的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    first.unmount();
    render(<QuerySopTasks {...props} />);
    const input = screen.getByRole('textbox', { name: '待办昵称' });
    expect(input).toHaveValue('保存中的草稿');
    expect(input).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('group', { name: '修改 小林 的昵称' }), { key: 'Escape' });
    expect(input).toBeInTheDocument();
    await act(async () => finish(false));
    expect(screen.getByRole('alert')).toHaveTextContent('昵称保存失败，请重试');
    expect(input).toBeEnabled();
    expect(input).toHaveValue('保存中的草稿');
  });
  it('does not let an old save clear a new editing generation', async () => {
    const drafts = new SopRenameDrafts();
    let finish: (result: boolean) => void = () => undefined;
    const props = { tasks: [task], busy: false, error: null, unavailable: false, drafts, onRestore: vi.fn(), onClose: vi.fn(), onRename: vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })), onRecover: vi.fn(), onLayoutChange: vi.fn() };
    const first = render(<QuerySopTasks {...props} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '旧草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    first.unmount();
    drafts.delete(task.taskId);
    drafts.start(task.taskId, { revision: task.revision, initialName: task.displayName, value: '新草稿', stage: 'editing', error: '' });
    drafts.activate(task.taskId);
    render(<QuerySopTasks {...props} />);
    await act(async () => finish(true));
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('新草稿');
  });
  it('cancels without writing and sends an empty nickname to restore the default', () => {
    const { onRename } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '取消修改' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '待办昵称' }), { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '待办昵称' }), { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(task, '');
  });
  it('replaces the nickname editor with a separate close confirmation', async () => {
    setup();
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '结束 小林' }));
    expect(screen.queryByRole('textbox', { name: '待办昵称' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('dialog', { name: '结束流程？' })).toBeVisible());
  });

  it('keeps an unsaved nickname when ending the task is cancelled', async () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '尚未保存的昵称' } });
    fireEvent.click(screen.getByRole('button', { name: '结束 小林' }));
    const dialog = screen.getByRole('dialog', { name: '结束流程？' });
    fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('尚未保存的昵称'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a nickname draft when the close request leaves the task present', async () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '仍未保存' } });
    fireEvent.click(screen.getByRole('button', { name: '结束 小林' }));
    fireEvent.click(screen.getByRole('button', { name: '结束流程' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(task));
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('仍未保存');
  });

  it('keeps separate list drafts when choosing another task to edit', () => {
    const view = setup();
    const other = { ...task, taskId: 'task-b', ordinal: 2, displayName: '小陈' };
    view.rerender(<QuerySopTasks {...view.props} tasks={[task, other]} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '草稿甲' } });
    fireEvent.keyDown(screen.getByRole('button', { name: /^小陈/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '草稿乙' } });
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('草稿甲');
    fireEvent.keyDown(screen.getByRole('button', { name: /^小陈/ }), { key: 'F2' });
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('草稿乙');
  });

  it('cancels the confirmation with Escape without ending the task or dismissing Query', () => {
    const { onClose } = setup();
    const dismiss = vi.fn();
    window.addEventListener('keydown', dismiss);
    try {
      fireEvent.click(screen.getByRole('button', { name: '结束 小林' }));
      fireEvent.keyDown(screen.getByRole('dialog', { name: '结束流程？' }), { key: 'Escape', code: 'Escape', keyCode: 27 });
      expect(screen.queryByRole('dialog', { name: '结束流程？' })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(dismiss).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', dismiss); }
  });

  it('keeps global shortcuts from acting while a close confirmation is open', () => {
    setup();
    const globalKey = vi.fn();
    window.addEventListener('keydown', globalKey);
    try {
      fireEvent.click(screen.getByRole('button', { name: '结束 小林' }));
      const confirmation = screen.getByRole('dialog', { name: '结束流程？' });
      fireEvent.keyDown(confirmation, { key: 'F7' });
      fireEvent.keyDown(confirmation, { key: '1' });
      fireEvent.keyDown(window, { key: 'F7' });
      fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
      expect(screen.getByRole('dialog', { name: '结束流程？' })).toBeInTheDocument();
      expect(globalKey).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', globalKey); }
  });

  it('requires a fresh confirmation for every intervening task revision', async () => {
    const view = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '查询端草稿' } });

    const firstUpdate = { ...task, revision: 4, displayName: '浮窗已保存' };
    view.rerender(<QuerySopTasks {...view.props} tasks={[firstUpdate]} />);
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    expect(view.onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('待办已变化，请核对后再次保存');
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('查询端草稿');

    const secondUpdate = { ...task, revision: 5, displayName: '浮窗再次保存' };
    view.rerender(<QuerySopTasks {...view.props} tasks={[secondUpdate]} />);
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    expect(view.onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('待办已变化，请核对后再次保存');
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('查询端草稿');

    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    await waitFor(() => expect(view.onRename).toHaveBeenCalledExactlyOnceWith(secondUpdate, '查询端草稿'));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '待办昵称' })).toBeNull());
  });

  it.each(['false', 'throw'])('preserves the nickname draft when saving returns %s and permits retry', async outcome => {
    const view = setup();
    view.onRename.mockImplementationOnce(async () => { if (outcome === 'throw') throw new Error('IPC failed'); return false; });
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '小林售后' } });
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('昵称保存失败，请重试'));
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('小林售后');
    const latestTask = { ...task, revision: 4, stepIndex: 3 };
    view.rerender(<QuerySopTasks {...view.props} tasks={[latestTask]} />);
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    expect(view.onRename).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('待办已变化，请核对后再次保存');
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('小林售后');
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '待办昵称' })).toBeNull());
    expect(view.onRename).toHaveBeenLastCalledWith(latestTask, '小林售后');
  });

});
it('consumes local Escape without dismissing the Query window and leaves IME Escape alone', () => {
  setup();
  const dismiss = vi.fn();
  window.addEventListener('keydown', dismiss);
  try {
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'F2' });
    const input = screen.getByRole('textbox', { name: '待办昵称' });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toBeVisible();
    dismiss.mockClear();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(dismiss).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '待办昵称' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: /^小林/ }), { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledOnce();
  } finally { window.removeEventListener('keydown', dismiss); }
});
