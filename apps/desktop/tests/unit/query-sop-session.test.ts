import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), clipboard: { writeText: vi.fn() } }));
import { SopWindowController } from '../../src/main/sop-window-controller';
import { ALLERGY_SOP_SCENE_ID, MISSING_ITEM_SOP_SCENE_ID } from '../../src/shared/sop-entry';
import { ALLERGY_SOP_TREE } from '../../src/shared/synthetic-sops';
import { advanceSopNext, validateSopTree } from '../../src/shared/sop-model';
import { isQuerySopCommand } from '../../src/shared/sop-window';
import { isQuerySopWindowIntent, resizeSopFrame, SOP_MIN_WIDTH, SOP_RESIZE_EDGES } from '../../src/shared/query-sop-window';

const sessions: SopWindowController[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.destroy()); });
function queryHost(changed = vi.fn()) {
  let selectedTask: string | null = null;
  return {
    selectedTask: () => selectedTask,
    showTask: vi.fn(async (taskId: string) => { selectedTask = taskId; return true; }),
    removeTask: vi.fn((taskId: string) => { if (selectedTask === taskId) selectedTask = null; }),
    changed,
  };
}
function setup(enabled = true) {
  const changed = vi.fn(), copy = vi.fn(), host = queryHost(changed);
  const session = new SopWindowController({
    enabled: () => enabled,
    presentation: host,
    sessionRole: () => 'agent', writeClipboard: copy,
  });
  sessions.push(session);
  const choose = (edgeId: string) => session.command({ type: 'choose', edgeId, taskId: session.current()!.taskId, revision: session.current()!.revision, stepIndex: session.current()!.stepIndex });
  return { session, changed, host, copy, choose };
}
describe('in-query SOP progress', () => {
  // Regression: an uncertain allergy case must stay with the agent for follow-up, not require another reviewer.
  it('separates discomfort from missing information and lets the agent reassess', async () => {
    const { session, choose } = setup();
    await session.open(ALLERGY_SOP_SCENE_ID);
    expect(choose('has-photo').ok).toBe(true);
    expect(session.current()?.edges.map(edge => edge.label)).toEqual(['客户描述轻微', '客户描述明显不适', '信息不足']);
    expect(choose('unknown').ok).toBe(true);
    expect(session.current()).toMatchObject({ taskTitle: '补充不适信息', terminal: false });
    const revision = () => ({ taskId: session.current()!.taskId, revision: session.current()!.revision, stepIndex: session.current()!.stepIndex });
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(false);
    expect(session.command({ ...revision(), type: 'wait', reason: 'customer' }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(false);
    expect(session.command({ ...revision(), type: 'resume' }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'check', requirementId: 'details-confirmed', checked: true }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(true);
    expect(session.current()).toMatchObject({ taskTitle: '再次核实不适情况', terminal: false });
    expect(choose('unknown').ok).toBe(true);
    expect(session.current()).toMatchObject({ taskTitle: '等待补充信息', terminal: false });
    expect(session.command({ ...revision(), type: 'wait', reason: 'customer' }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'resume' }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'rewind', targetStepIndex: 4 }).ok).toBe(true);
    expect(session.current()?.taskTitle).toBe('再次核实不适情况');
    expect(choose('severe').ok).toBe(true);
    expect(session.current()?.taskTitle).toBe('记录明显不适');
  });
  it('retains the existing stop-use and seek-care reminder without sending or escalating it', async () => {
    const { session, choose, copy } = setup();
    await session.open(ALLERGY_SOP_SCENE_ID);
    expect(choose('has-photo').ok).toBe(true);
    expect(choose('severe').ok).toBe(true);
    const current = session.current();
    const script = current?.scripts[0];
    if (!script || script.unpublished) throw new Error('Expected an available synthetic wording');
    expect(current?.taskTitle).toBe('记录明显不适');
    expect(script.answerText).toContain('请暂停使用');
    expect(script.answerText).toContain('若症状持续或加重，请及时就医');
    expect(current?.prompt).not.toContain('人工复核');
    expect(copy).not.toHaveBeenCalled();
  });
  it('lets the agent follow up a mild description without an escalation step', async () => {
    const { session, choose } = setup();
    await session.open(ALLERGY_SOP_SCENE_ID);
    expect(choose('has-photo').ok).toBe(true);
    expect(choose('mild').ok).toBe(true);
    expect(session.current()).toMatchObject({ taskTitle: '记录不适', terminal: true });
    expect(session.current()?.prompt).not.toContain('人工复核');
  });
  it('resumes missing evidence and confirms follow-up without finishing early', async () => {
    const { session, choose } = setup();
    await session.open(ALLERGY_SOP_SCENE_ID);
    const revision = () => ({ taskId: session.current()!.taskId, revision: session.current()!.revision, stepIndex: session.current()!.stepIndex });
    expect(choose('no-photo').ok).toBe(true);
    expect(session.current()?.taskTitle).toBe('等待补充凭证');
    expect(session.command({ ...revision(), type: 'wait', reason: 'customer' }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(false);
    expect(session.command({ ...revision(), type: 'resume' }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(false);
    expect(session.command({ ...revision(), type: 'check', requirementId: 'photo-received', checked: true }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(true);
    expect(session.current()?.taskTitle).toBe('核实不适情况');
    expect(choose('severe').ok).toBe(true);
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(true);
    expect(session.current()?.taskTitle).toBe('确认后续跟进');
    expect(session.command({ ...revision(), type: 'wait', reason: 'customer' }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'resume' }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(false);
    expect(session.command({ ...revision(), type: 'check', requirementId: 'followup-confirmed', checked: true }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(true);
    expect(session.current()).toMatchObject({ taskTitle: '记录后续跟进', terminal: true });
  });
  it('copy stays at a decision; decisions require a choice; stale duplicate clicks cannot advance', async () => {
    const { session, copy, choose } = setup();
    await session.open(ALLERGY_SOP_SCENE_ID);
    const start = session.current()!;
    expect(session.copyCurrent({ taskId: start.taskId, revision: start.revision, stepIndex: start.stepIndex, scriptId: 'syn-sop-allergy-voucher' })).toMatchObject({ ok: true, outcome: 'copied-stayed', reason: 'decision' });
    expect(copy).toHaveBeenCalledOnce();
    expect(session.current()?.stepIndex).toBe(1);
    expect(session.command({ type: 'next', taskId: session.current()!.taskId, revision: session.current()!.revision, stepIndex: session.current()!.stepIndex }).ok).toBe(false);
    choose('has-photo');
    expect(session.command({ type: 'next', taskId: session.current()!.taskId, revision: session.current()!.revision, stepIndex: session.current()!.stepIndex }).ok).toBe(false);
    expect(session.command({ type: 'choose', edgeId: 'severe', taskId: start.taskId, revision: start.revision, stepIndex: start.stepIndex }).ok).toBe(false);
    choose('severe');
    const next = { type: 'next' as const, taskId: session.current()!.taskId, revision: session.current()!.revision, stepIndex: 3 };
    expect(session.command(next).ok).toBe(true);
    expect(session.command(next).ok).toBe(false);
    expect(session.current()).toMatchObject({ taskTitle: '确认后续跟进', terminal: false });
    expect(session.command({ type: 'next', taskId: session.current()!.taskId, revision: session.current()!.revision, stepIndex: session.current()!.stepIndex }).ok).toBe(false);
  });
  it('resume preserves the branch; end clears it; restart invalidates old commands', async () => {
    const { session, choose, host } = setup();
    await session.open(ALLERGY_SOP_SCENE_ID);
    choose('has-photo');
    const beforeRestore = session.current()!;
    expect(await session.restore(beforeRestore.taskId, beforeRestore.revision)).toEqual({ ok: true });
    const old = session.current()!;
    expect(old.stepIndex).toBe(2);
    expect(session.resumeAvailable()).toBe(true);
    session.command({ type: 'restart', taskId: old.taskId, revision: old.revision, stepIndex: old.stepIndex });
    expect(session.current()?.stepIndex).toBe(1);
    expect(session.command({ type: 'choose', edgeId: 'has-photo', taskId: old.taskId, revision: old.revision, stepIndex: 1 }).ok).toBe(false);
    session.endFlow();
    expect(host.removeTask).toHaveBeenLastCalledWith(old.taskId);
    expect(session.current()).toBeNull();
    expect(session.resumeAvailable()).toBe(false);
  });
  it('never opens the synthetic flow in an excluded profile', async () => {
    const { session, host } = setup(false);
    expect(session.entryAvailable()).toBe(false);
    expect((await session.open(ALLERGY_SOP_SCENE_ID)).ok).toBe(false);
    expect(host.showTask).not.toHaveBeenCalled();
  });
  it('stops returning the image projection and refuses copy if the synthetic gate closes', async () => {
    let enabled = true;
    const copy = vi.fn();
    const session = new SopWindowController({ enabled: () => enabled, sessionRole: () => 'agent',
      presentation: queryHost(), writeClipboard: copy });
    sessions.push(session);
    await session.open(MISSING_ITEM_SOP_SCENE_ID);
    const current = session.current()!;
    expect(current.images).toHaveLength(1);
    enabled = false;
    expect(session.current()).toBeNull();
    expect(session.copyCurrent({ taskId: current.taskId, revision: current.revision, stepIndex: current.stepIndex, scriptId: 'syn-missing-ask' }).ok).toBe(false);
    expect(copy).not.toHaveBeenCalled();
  });
  it('rejects a malformed graph that bypasses a branch, even before validation', () => {
    const tree = { ...ALLERGY_SOP_TREE, nodes: ALLERGY_SOP_TREE.nodes.map(node => node.id === 'severity' ? { ...node, nextId: 'confirm-followup' } : node) };
    expect(() => validateSopTree(tree)).toThrow(/cannot have nextId/);
    expect(advanceSopNext(tree, { sceneId: tree.sceneId, nodeId: 'severity', stepIndex: 2 })).toBeNull();
  });
  it('rejects malformed and extra IPC fields', () => {
    expect(isQuerySopCommand({ type: 'next', taskId: 'sop-1', revision: 1, stepIndex: 1, answer: 'injected' })).toBe(false);
    expect(isQuerySopCommand({ type: 'choose', taskId: 'sop-1', revision: 1, stepIndex: 1, edgeId: '' })).toBe(false);
    expect(isQuerySopWindowIntent({ type: 'resize', taskId: 'sop-1', hostEpoch: 1, gesture: 1, dx: Infinity, dy: 0 })).toBe(false);
    expect(isQuerySopWindowIntent({ type: 'detach', taskId: 'sop-1', hostEpoch: 1, width: 999 })).toBe(false);
  });

  it('requires material confirmation, copies an explicit script, pauses and safely rewinds', async () => {
    const { session, copy } = setup();
    await session.open(MISSING_ITEM_SOP_SCENE_ID);
    const revision = () => ({ taskId: session.current()!.taskId, revision: session.current()!.revision, stepIndex: session.current()!.stepIndex });
    expect(session.current()?.selectedScriptId).toBeNull();
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(false);
    expect(session.copyCurrent({ ...revision(), scriptId: 'other' }).ok).toBe(false);
    const stale = revision();
    expect(session.copyCurrent({ ...revision(), scriptId: 'syn-missing-ack' }).ok).toBe(true);
    expect(copy).toHaveBeenLastCalledWith('收到您提供的信息了，我会先核对订单和包裹情况，再与您确认后续处理。');
    expect(session.current()?.stepIndex).toBe(1);
    expect(session.current()?.images).toHaveLength(1);
    expect(session.command({ ...stale, type: 'next' }).ok).toBe(false);
    expect(session.command({ ...revision(), type: 'wait', reason: 'customer' }).ok).toBe(true);
    expect(session.copyCurrent({ ...revision(), scriptId: 'syn-missing-ack' }).ok).toBe(false);
    expect(session.command({ ...revision(), type: 'select-script', scriptId: 'syn-missing-ack' }).ok).toBe(false);
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(false);
    expect(session.command({ ...revision(), type: 'check', requirementId: 'ordered', checked: true }).ok).toBe(false);
    expect(session.command({ ...revision(), type: 'resume' }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'check', requirementId: 'ordered', checked: true }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'check', requirementId: 'received', checked: true }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'next' }).ok).toBe(true);
    expect(session.command({ ...revision(), type: 'choose', edgeId: 'missing' }).ok).toBe(true);
    expect(session.current()?.history[1]?.choiceLabel).toBe('已核实数量不足');
    expect(session.current()?.history[0]?.confirmedRequirements).toHaveLength(2);
    const beforeRewind = revision();
    expect(session.command({ ...revision(), type: 'rewind', targetStepIndex: 1 }).ok).toBe(true);
    expect(session.current()?.history).toHaveLength(1);
    expect(session.current()?.requirements.every(item => !item.checked)).toBe(true);
    expect(session.current()?.selectedScriptId).toBeNull();
    expect(session.command({ ...beforeRewind, type: 'next' }).ok).toBe(false);
  });
  it('keeps the first scenario when another scenario is opened', async () => {
    const { session } = setup();
    await session.open(ALLERGY_SOP_SCENE_ID);
    const first = session.current()!;
    expect((await session.open(MISSING_ITEM_SOP_SCENE_ID)).ok).toBe(true);
    expect(session.current()?.sceneId).toBe(MISSING_ITEM_SOP_SCENE_ID);
    expect(session.summaries().map(task => task.sceneId)).toEqual([ALLERGY_SOP_SCENE_ID, MISSING_ITEM_SOP_SCENE_ID]);
    expect((await session.restore(first.taskId, first.revision)).ok).toBe(true);
    expect(session.current()).toEqual(first);
  });

  it('keeps progress and selection unchanged on clipboard failure and checks current publication', async () => {
    let allowed = new Set(['syn-missing-ack']);
    const copy = vi.fn(() => { throw new Error('unavailable'); });
    const session = new SopWindowController({
      enabled: () => true, sessionRole: () => 'agent',
      presentation: queryHost(),
      writeClipboard: copy, publishedScriptIds: () => allowed,
    });
    sessions.push(session);
    await session.open(MISSING_ITEM_SOP_SCENE_ID);
    const revision = () => ({ taskId: session.current()!.taskId, revision: session.current()!.revision, stepIndex: session.current()!.stepIndex });
    const before = session.current();
    expect(session.copyCurrent({ ...revision(), scriptId: 'syn-missing-ack' })).toEqual({ ok: false, message: '复制失败，请重试' });
    expect(session.current()).toEqual(before);
    expect(copy).toHaveBeenCalledOnce();
    allowed = new Set();
    expect(session.copyCurrent({ ...revision(), scriptId: 'syn-missing-ack' }).ok).toBe(false);
    expect(copy).toHaveBeenCalledOnce();
  });
  it('refreshes the projection when a stale copy discovers an unavailable wording', async () => {
    const allowed = new Set(['syn-missing-ack']);
    const changed = vi.fn(), copy = vi.fn();
    const session = new SopWindowController({
      enabled: () => true, sessionRole: () => 'agent',
      presentation: queryHost(changed),
      writeClipboard: copy, publishedScriptIds: () => allowed,
    });
    sessions.push(session);
    await session.open(MISSING_ITEM_SOP_SCENE_ID);
    const before = session.current();
    if (!before) throw new Error('Expected an active synthetic SOP');
    const stale = { taskId: before.taskId, revision: before.revision, stepIndex: before.stepIndex };
    allowed.clear();
    expect(session.copyCurrent({ ...stale, scriptId: 'syn-missing-ack' })).toEqual({ ok: false, message: '该话术当前不可复制' });
    expect(copy).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(2);
    const refreshed = session.current();
    if (!refreshed) throw new Error('Expected the updated SOP projection');
    expect(refreshed).toMatchObject({ nodeId: before.nodeId, stepIndex: before.stepIndex, scripts: [
      { scriptId: 'syn-missing-ask', unpublished: true, images: [] },
      { scriptId: 'syn-missing-ack', unpublished: true, images: [] },
    ] });
    expect(refreshed.revision).not.toBe(stale.revision);
    expect(session.command({ ...stale, type: 'check', requirementId: 'ordered', checked: true }).ok).toBe(false);
  });
  it('clamps all eight resize directions and supports small screens', () => {
    const base = { x: 100, y: 100, width: 600, height: 620 };
    const area = { x: 0, y: 0, width: 1200, height: 900 };
    for (const edge of SOP_RESIZE_EDGES) for (const delta of [-5000, 5000]) {
      const frame = resizeSopFrame(base, edge, delta, delta, area);
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(area.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(area.height);
      expect(frame.width).toBeGreaterThanOrEqual(SOP_MIN_WIDTH);
      expect(frame.width).toBeLessThanOrEqual(area.width);
      expect(frame.height).toBeGreaterThanOrEqual(320);
    }
    const small = { x: 0, y: 0, width: 280, height: 280 };
    expect(resizeSopFrame(small, 'se', -1000, -1000, small)).toEqual(small);
    const wide = resizeSopFrame({ x: 100, y: 100, width: 580, height: 620 }, 'e', 300, 0, area);
    expect(wide).toMatchObject({ x: 100, width: 880 });
  });
  it('resizes continuously into a compact sidebar without snapping to the old minimum', () => {
    const base = { x: 100, y: 100, width: 580, height: 620 };
    const area = { x: 0, y: 0, width: 1200, height: 900 };
    for (const width of [419, 380, 301, 300]) {
      expect(resizeSopFrame(base, 'e', width - base.width, 0, area)).toEqual({ ...base, width });
    }
    expect(resizeSopFrame(base, 'e', -1000, 0, area)).toEqual({ ...base, width: 300 });
  });
});
