import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SOP_TASKS, type QuerySopRevision, type SopProjection } from '../../src/shared/sop-window';
import { ALLERGY_SOP_SCENE_ID, MISSING_ITEM_SOP_SCENE_ID } from '../../src/shared/sop-entry';
import { SopWindowController } from '../../src/main/sop-window-controller';

vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() } }));

const controllers: SopWindowController[] = [];
afterEach(() => { controllers.splice(0).forEach(controller => controller.destroy()); vi.useRealTimers(); });

function setup(writeClipboard = vi.fn<(text: string) => void>(), enabled = () => true) {
  let selectedTask: string | null = null;
  const selectTask = (taskId: string | null) => { selectedTask = taskId; };
  const changed = vi.fn();
  const controller = new SopWindowController({
    enabled,
    sessionRole: () => 'agent',
    writeClipboard,
    presentation: {
      selectedTask: () => selectedTask,
      showTask: async taskId => { selectTask(taskId); return true; },
      removeTask: taskId => { if (selectedTask === taskId) selectTask(null); },
      changed,
    },
  });
  controllers.push(controller);
  const current = (): SopProjection => {
    const projection = controller.current();
    if (!projection) throw new Error('Expected an active SOP task');
    return projection;
  };
  const revision = (): QuerySopRevision => {
    const { taskId, revision, stepIndex } = current();
    return { taskId, revision, stepIndex };
  };
  return { controller, current, revision, changed, selectTask, selectedTask: () => selectedTask, writeClipboard };
}

function taskRevision(projection: SopProjection): QuerySopRevision {
  return { taskId: projection.taskId, revision: projection.revision, stepIndex: projection.stepIndex };
}

describe('independent SOP tasks', () => {
  it('clears task data and refuses execution when the SOP capability is disabled', async () => {
    let enabled = true;
    const { controller, current, selectedTask, writeClipboard } = setup(vi.fn(), () => enabled);
    await controller.open(MISSING_ITEM_SOP_SCENE_ID);
    const previous = current();
    enabled = false;
    expect(controller.summaries()).toEqual([]);
    expect(controller.current()).toBeNull();
    expect(selectedTask()).toBeNull();
    expect(controller.entryAvailable()).toBe(false);
    expect(await controller.open(MISSING_ITEM_SOP_SCENE_ID)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect((await controller.restore(previous.taskId, previous.revision)).ok).toBe(false);
    expect(controller.copyCurrent({ ...taskRevision(previous), scriptId: 'syn-missing-ask' }).ok).toBe(false);
    expect(writeClipboard).not.toHaveBeenCalled();
    expect(controller.summaries()).toEqual([]);
    expect(controller.current()).toBeNull();
    enabled = true;
    expect(controller.resumeAvailable()).toBe(false);
  });

  it('creates two same-named tasks and restores each set of checks, selection and waiting state', async () => {
    const { controller, current, revision } = setup();
    await controller.open(MISSING_ITEM_SOP_SCENE_ID);
    controller.command({ ...revision(), type: 'select-script', scriptId: 'syn-missing-ack' });
    controller.command({ ...revision(), type: 'check', requirementId: 'ordered', checked: true });
    controller.command({ ...revision(), type: 'wait', reason: 'customer' });
    const first = current();
    await controller.open(MISSING_ITEM_SOP_SCENE_ID);
    const second = current();
    expect(second.sceneId).toBe(first.sceneId);
    expect(second.taskId).not.toBe(first.taskId);
    expect(second.revision).toBe(1);
    expect(second.selectedScriptId).toBeNull();
    expect(second.requirements.every(item => !item.checked)).toBe(true);
    controller.command({ ...revision(), type: 'check', requirementId: 'received', checked: true });
    const changedSecond = current();
    expect(await controller.restore(first.taskId, first.revision)).toEqual({ ok: true });
    expect(current()).toEqual(first);
    expect(current().waiting).toBe('customer');
    expect(await controller.restore(second.taskId, changedSecond.revision)).toEqual({ ok: true });
    expect(current()).toEqual(changedSecond);
    const summaries = controller.summaries();
    expect(summaries.map(item => item.ordinal)).toEqual([1, 2]);
    expect(summaries.map(item => item.revision)).toEqual([first.revision, changedSecond.revision]);
  });

  it('rejects background work and closes only the requested background task while preserving Top3 view', async () => {
    const { controller, current, revision, selectTask, selectedTask, writeClipboard } = setup();
    await controller.open(ALLERGY_SOP_SCENE_ID);
    const first = current();
    await controller.open(MISSING_ITEM_SOP_SCENE_ID);
    const second = current();
    expect(controller.command({ ...taskRevision(first), type: 'choose', edgeId: 'has-photo' }).ok).toBe(false);
    expect(controller.copyCurrent({ ...taskRevision(first), scriptId: 'syn-sop-allergy-voucher' }).ok).toBe(false);
    expect(writeClipboard).not.toHaveBeenCalled();
    selectTask(null);
    expect(controller.command({ ...taskRevision(first), type: 'end' })).toEqual({ ok: true });
    expect(controller.current()).toBeNull();
    expect(selectedTask()).toBeNull();
    expect(controller.summaries()).toMatchObject([{ taskId: second.taskId, revision: second.revision, stepIndex: second.stepIndex }]);
    expect(await controller.restore(second.taskId, second.revision)).toEqual({ ok: true });
    expect(current()).toEqual(second);
    const stale = revision();
    controller.command({ ...revision(), type: 'check', requirementId: 'ordered', checked: true });
    expect(controller.command({ ...stale, type: 'end' }).ok).toBe(false);
    expect(controller.current()).not.toBeNull();
  });

  it('clears the selected task and summaries when the displayed task ends', async () => {
    const { controller, revision, selectedTask } = setup();
    await controller.open(MISSING_ITEM_SOP_SCENE_ID);
    expect(controller.command({ ...revision(), type: 'end' })).toEqual({ ok: true });
    expect(controller.summaries()).toEqual([]);
    expect(controller.current()).toBeNull();
    expect(selectedTask()).toBeNull();
  });

  it('rejects task overflow visibly and never evicts retained progress', async () => {
    const { controller, current } = setup();
    for (let index = 0; index < MAX_SOP_TASKS; index += 1) expect(await controller.open(ALLERGY_SOP_SCENE_ID)).toEqual({ ok: true });
    const before = controller.summaries(), visible = current();
    expect(await controller.open(MISSING_ITEM_SOP_SCENE_ID)).toEqual({ ok: false, code: 'INVALID', message: `最多保留 ${MAX_SOP_TASKS} 条待办，请先结束一条` });
    expect(controller.summaries()).toEqual(before);
    expect(current()).toEqual(visible);
    expect((await controller.restore('missing-task', 1)).ok).toBe(false);
  });
});

describe('atomic SOP copy and advance', () => {
  it('orders successful external and SOP copies while failed writes leave the generation unchanged', async () => {
    let fail = false;
    const { controller, revision, current } = setup(vi.fn(() => { if (fail) throw new Error('clipboard unavailable'); }));
    await controller.open(ALLERGY_SOP_SCENE_ID);
    expect(controller.copyGeneration()).toBe(0);
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-sop-allergy-voucher' })).toMatchObject({ ok: true, copyGeneration: 1 });
    fail = true;
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-sop-allergy-voucher' })).toMatchObject({ ok: false });
    expect(controller.copyGeneration()).toBe(1);
    expect(current().copied).toBe(true);
    expect(controller.reportExternalCopy()).toBe(2);
    expect(current().copied).toBe(false);
    fail = false;
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-sop-allergy-voucher' })).toMatchObject({ ok: true, copyGeneration: 3 });
  });

  it('clears another task copy feedback only after the new clipboard write succeeds', async () => {
    let fail = false;
    const { controller, current, revision, selectTask } = setup(vi.fn(() => { if (fail) throw new Error('clipboard unavailable'); }));
    await controller.open(ALLERGY_SOP_SCENE_ID);
    const first = current();
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-sop-allergy-voucher' }).ok).toBe(true);
    expect(controller.projection(first.taskId)?.copied).toBe(true);
    await controller.open(ALLERGY_SOP_SCENE_ID);
    const second = current();
    fail = true;
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-sop-allergy-voucher' }).ok).toBe(false);
    expect(controller.projection(first.taskId)?.copied).toBe(true);
    fail = false;
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-sop-allergy-voucher' }).ok).toBe(true);
    expect(controller.projection(first.taskId)?.copied).toBe(false);
    expect(controller.projection(second.taskId)?.copied).toBe(true);
    selectTask(first.taskId);
  });

  it('writes the current wording before one committed transition and returns its source step', async () => {
    const observed: SopProjection[] = [];
    const writeClipboard = vi.fn(() => { observed.push(current()); });
    const { controller, current, revision, changed } = setup(writeClipboard);
    await controller.open(MISSING_ITEM_SOP_SCENE_ID);
    controller.command({ ...revision(), type: 'check', requirementId: 'ordered', checked: true });
    controller.command({ ...revision(), type: 'check', requirementId: 'received', checked: true });
    const before = current();
    changed.mockClear();
    const result = controller.copyCurrent({ ...revision(), scriptId: 'syn-missing-ack' });
    expect(result).toEqual({ ok: true, outcome: 'copied-advanced', source: taskRevision(before), sourceTitle: before.taskTitle, copyGeneration: 1 });
    expect(observed).toEqual([before]);
    expect(writeClipboard).toHaveBeenCalledOnce();
    expect(current()).toMatchObject({ taskId: before.taskId, revision: before.revision + 1, stepIndex: 2, nodeKind: 'decision', copied: false });
    expect(current().history[0]?.confirmedRequirements).toHaveLength(2);
    expect(changed).toHaveBeenCalledOnce();
    expect(controller.current()).toMatchObject({ taskId: before.taskId, stepIndex: 2 });
    expect(controller.copyCurrent({ ...taskRevision(before), scriptId: 'syn-missing-ack' }).ok).toBe(false);
    expect(writeClipboard).toHaveBeenCalledOnce();
  });

  it('copies a material request without checking requirements or advancing the task', async () => {
    const { controller, current, revision } = setup();
    await controller.open(MISSING_ITEM_SOP_SCENE_ID);
    const before = current();
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-missing-ask' })).toEqual({
      ok: true, outcome: 'copied-stayed', reason: 'requirements', source: taskRevision(before), sourceTitle: before.taskTitle, copyGeneration: 1,
    });
    expect(current()).toMatchObject({ nodeId: before.nodeId, stepIndex: before.stepIndex, copied: true, selectedScriptId: 'syn-missing-ask' });
    expect(current().requirements.every(item => !item.checked)).toBe(true);
  });

  it('keeps decisions and terminals in place after copy and requires explicit choice or end', async () => {
    const { controller, current, revision } = setup();
    await controller.open(ALLERGY_SOP_SCENE_ID);
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-sop-allergy-voucher' })).toMatchObject({ ok: true, outcome: 'copied-stayed', reason: 'decision' });
    expect(current().nodeKind).toBe('decision');
    expect(current().stepIndex).toBe(1);
    controller.command({ ...revision(), type: 'choose', edgeId: 'has-photo' });
    controller.command({ ...revision(), type: 'choose', edgeId: 'mild' });
    const terminal = current();
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-sop-allergy-mild' })).toMatchObject({ ok: true, outcome: 'copied-stayed', reason: 'terminal' });
    expect(current()).toMatchObject({ taskId: terminal.taskId, nodeId: terminal.nodeId, terminal: true });
    expect(controller.resumeAvailable()).toBe(true);
  });

  it('preserves fully verified progress when the clipboard fails and blocks all copying while waiting', async () => {
    const writeClipboard = vi.fn(() => { throw new Error('clipboard offline'); });
    const { controller, current, revision, changed } = setup(writeClipboard);
    await controller.open(MISSING_ITEM_SOP_SCENE_ID);
    controller.command({ ...revision(), type: 'check', requirementId: 'ordered', checked: true });
    controller.command({ ...revision(), type: 'check', requirementId: 'received', checked: true });
    const before = current();
    changed.mockClear();
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-missing-ack' })).toEqual({ ok: false, message: '复制失败，请重试' });
    expect(current()).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
    controller.command({ ...revision(), type: 'wait', reason: 'internal' });
    const waiting = current();
    expect(controller.copyCurrent({ ...revision(), scriptId: 'syn-missing-ack' })).toEqual({ ok: false, message: '请先继续流程' });
    expect(current()).toEqual(waiting);
    expect(writeClipboard).toHaveBeenCalledOnce();
  });
});
