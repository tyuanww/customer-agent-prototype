import { Button, Input, Modal, Tooltip, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useLayoutEffect, useRef, useState } from 'react';
import { MAX_SOP_DISPLAY_NAME_LENGTH, type SopTaskSummary } from '@shared/sop-window';
import { isImeComposing } from '../../lib/ime';
import { SopRenameDrafts, useSopRenameDrafts } from './sop-rename-drafts';

export function QuerySopTasks({ tasks, busy, error, unavailable, onRestore, onClose, onRename, onRecover, onLayoutChange, drafts }: {
  tasks: readonly SopTaskSummary[];
  busy: boolean;
  error: string | null;
  unavailable: boolean;
  onRestore: (task: SopTaskSummary) => void;
  onClose: (task: SopTaskSummary) => void;
  onRename: (task: SopTaskSummary, name: string) => Promise<boolean>;
  onRecover: () => void;
  onLayoutChange: () => void;
  drafts?: SopRenameDrafts;
}) {
  const [closing, setClosing] = useState<{ task: SopTaskSummary; stage: 'open' | 'cancel' | 'confirm' } | null>(null);
  const [localDrafts] = useState(() => new SopRenameDrafts());
  const renameDrafts = useSopRenameDrafts(drafts ?? localDrafts);
  const [rename, setRename] = useState<{ kind: 'selecting' } | { kind: 'editing'; taskId: string } | null>(() => {
    const activeTaskId = renameDrafts.active();
    return activeTaskId ? { kind: 'editing', taskId: activeTaskId } : null;
  });
  const editingTask = rename?.kind === 'editing' ? tasks.find(task => task.taskId === rename.taskId) : undefined;
  const draft = editingTask ? renameDrafts.get(editingTask.taskId) : undefined;
  const editing = editingTask && draft ? { task: editingTask, ...draft } : null;
  const selecting = rename?.kind === 'selecting';
  const saving = editing?.stage === 'saving';
  const pendingRename = useRef(false);
  const renameComposing = useRef(false);
  const editorGeneration = useRef(0);
  const closeDialogActive = closing !== null;
  const editingOpen = editing !== null;
  const renameErrorOpen = Boolean(editing?.error);
  useLayoutEffect(onLayoutChange, [editingOpen, renameErrorOpen, onLayoutChange]);
  useLayoutEffect(() => {
    if (!closeDialogActive) return undefined;
    // Focus can remain in Query during the modal's entry and exit animation.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!event.isComposing) {
          event.preventDefault();
          setClosing(current => current?.stage === 'open' ? { ...current, stage: 'cancel' } : current);
        }
      } else if (event.key === 'F7' || ['1', '2', '3'].includes(event.key) || ['Numpad1', 'Numpad2', 'Numpad3'].includes(event.code)) {
        event.stopPropagation();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeDialogActive]);
  const label = (task: SopTaskSummary) => task.displayName ?? `${task.sceneTitle} #${task.ordinal}`;
  const edit = (task: SopTaskSummary) => {
    if (closing || saving || pendingRename.current) return;
    editorGeneration.current += 1;
    renameComposing.current = false;
    if (!renameDrafts.get(task.taskId)) {
      renameDrafts.start(task.taskId, { revision: task.revision, initialName: task.displayName, value: task.displayName ?? '', stage: 'editing', error: '' });
    }
    renameDrafts.activate(task.taskId);
    setRename({ kind: 'editing', taskId: task.taskId });
  };
  const cancelEdit = () => {
    if (saving || pendingRename.current) return;
    editorGeneration.current += 1;
    renameComposing.current = false;
    if (editing) renameDrafts.update(editing.task.taskId, editing.editId, () => null);
    setRename(null);
  };
  const cancelClose = () => setClosing(current => current?.stage === 'open' ? { ...current, stage: 'cancel' } : current);
  const save = async () => {
    if (!editing || editing.stage !== 'editing' || busy || pendingRename.current || renameComposing.current) return;
    const { task, editId, value } = editing;
    if (Array.from(value.trim()).length > MAX_SOP_DISPLAY_NAME_LENGTH) {
      renameDrafts.update(task.taskId, editId, draft => ({ ...draft, error: '最多 20 字' }));
      return;
    }
    if (task.revision !== editing.revision) {
      renameDrafts.update(task.taskId, editId, draft => ({ ...draft, revision: task.revision, error: '待办已变化，请核对后再次保存' }));
      return;
    }
    const generation = editorGeneration.current;
    pendingRename.current = true;
    renameDrafts.update(task.taskId, editId, draft => ({ ...draft, stage: 'saving', error: '' }));
    try {
      const ok = await onRename(task, value.trim());
      if (ok) {
        renameDrafts.update(task.taskId, editId, () => null);
        if (generation === editorGeneration.current && !renameDrafts.get(task.taskId)) setRename(null);
      } else renameDrafts.update(task.taskId, editId, draft => ({ ...draft, stage: 'editing', error: '昵称保存失败，请重试' }));
    } catch {
      renameDrafts.update(task.taskId, editId, draft => ({ ...draft, stage: 'editing', error: '昵称保存失败，请重试' }));
    } finally { pendingRename.current = false; }
  };
  return <section className="query-sop-tasks" aria-label="SOP 待办" onKeyDown={event => {
    if (closing) { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) cancelClose(); return; }
    if (event.key === 'Escape' && rename && !renameComposing.current && !isImeComposing(event.nativeEvent)) { event.stopPropagation(); cancelEdit(); }
  }}>
    {tasks.length ? <div className="query-sop-tasks-heading">
      <Typography.Text type="secondary" className="query-sop-tasks-label">{selecting ? '选择要改名的待办' : 'SOP 待办'}</Typography.Text>
      {selecting ? <Button type="text" size="small" aria-label="取消改名" onClick={cancelEdit}>取消</Button>
        : <Button type="text" size="small" disabled={busy || saving || editingOpen} onClick={() => { if (!closing) setRename({ kind: 'selecting' }); }}>改名</Button>}
    </div> : null}
    <div className="query-sop-task-list">
      {tasks.map(task => {
        const waiting = task.waiting === 'customer' ? '等待客户' : task.waiting === 'internal' ? '等待内部协助' : null;
        const details = `${label(task)} · ${task.sceneTitle} · ${waiting ? `${waiting} · ` : ''}步骤 ${task.stepIndex} · ${task.taskTitle}`;
        return <div className="query-sop-task-row" key={task.taskId}>
          <Tooltip title={details} trigger={['hover', 'focus']} placement="top">
          <Button className="query-sop-task-restore" disabled={busy || saving} aria-label={selecting ? `修改 ${label(task)} 的昵称 · ${details}` : details}
            onContextMenu={event => { event.preventDefault(); edit(task); }}
            onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); edit(task); } }}
            onClick={() => { if (closing) return; if (selecting) edit(task); else onRestore(task); }}>
            <span className="query-sop-task-title"><span className="query-sop-task-name">{task.displayName ?? task.sceneTitle}</span>{task.displayName === null ? <span className="query-sop-task-number">#{task.ordinal}</span> : null}</span>
            <span className="query-sop-task-detail">{waiting
              ? <><span className="query-sop-task-status">{task.waiting === 'internal' ? '等待内部' : waiting}</span><span className="query-sop-task-status"> · {task.stepIndex}</span></>
              : <><span className="query-sop-task-status">步骤 {task.stepIndex}</span><span className="query-sop-task-detail-text"> · {task.taskTitle}</span></>}
            </span>
          </Button>
          </Tooltip>
          <Button type="text" className="query-sop-task-close" danger icon={<CloseOutlined />} disabled={busy || selecting || saving}
            aria-label={`结束 ${label(task)}`} onClick={() => { if (!closing) setClosing({ task, stage: 'open' }); }} />
      </div>; })}
    </div>
    {editing && !closing ? <div className="query-sop-task-edit" role="group" aria-label={`修改 ${label(editing.task)} 的昵称`}>
      <Input autoFocus aria-label="待办昵称" value={editing.value} disabled={busy || saving} placeholder="留空恢复默认名称"
        onCompositionStart={() => { renameComposing.current = true; }}
        onCompositionEnd={event => {
          if (!renameComposing.current) return;
          renameComposing.current = false;
          const name = event.currentTarget.value;
          renameDrafts.update(editing.task.taskId, editing.editId, draft => ({ ...draft, value: name, error: Array.from(name).length > MAX_SOP_DISPLAY_NAME_LENGTH ? '最多 20 字' : '' }));
        }}
        onChange={event => {
          const name = event.target.value;
          const length = Array.from(name).length;
          if (!renameComposing.current && length > MAX_SOP_DISPLAY_NAME_LENGTH && length > Array.from(editing.value).length) {
            renameDrafts.update(editing.task.taskId, editing.editId, draft => ({ ...draft, error: '最多 20 字' }));
          } else {
            renameDrafts.update(editing.task.taskId, editing.editId, draft => ({ ...draft, value: name, error: !renameComposing.current && length > MAX_SOP_DISPLAY_NAME_LENGTH ? '最多 20 字' : '' }));
          }
        }}
        onKeyDown={event => { if (event.key === 'Enter' && !renameComposing.current && !isImeComposing(event.nativeEvent)) { event.preventDefault(); void save(); } }} />
      <Button size="small" aria-label="保存昵称" disabled={busy} loading={saving} onClick={() => { void save(); }}>保存</Button>
      <Button size="small" disabled={saving} onClick={cancelEdit}>取消</Button>
    </div> : null}
    {editing && !closing && editing.error ? <Typography.Text type="danger" role="alert">{editing.error}</Typography.Text> : null}
    <Modal open={closing?.stage === 'open'} title="结束流程？" width={320} centered closable={false} okText="结束流程" cancelText="取消"
      okButtonProps={{ danger: true, disabled: busy }} onCancel={cancelClose}
      onOk={() => setClosing(current => current?.stage === 'open' ? { ...current, stage: 'confirm' } : current)}
      afterClose={() => {
        if (closing?.stage === 'confirm') onClose(closing.task);
        if (closing && closing.stage !== 'open') setClosing(null);
      }}>
      {closing ? <Typography.Text>结束「{label(closing.task)}」后将清除进度。</Typography.Text> : null}
    </Modal>
    {unavailable ? <div className="query-sop-task-error" role="alert">无法读取流程进度<Button type="link" loading={busy} onClick={onRecover}>重新读取</Button></div> : null}
    {error ? <Typography.Text type="danger" role="alert" data-testid="sop-open-error">{error}</Typography.Text> : null}
  </section>;
}
