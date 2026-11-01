import { describe, expect, it } from 'vitest';
import { projectSop, startSopProgress } from '../../src/shared/sop-model';
import { MISSING_ITEM_SOP_TREE } from '../../src/shared/synthetic-sops';
import { isSopProjection, isQuerySopSnapshot, isSopCopyResult, SOP_UNAVAILABLE } from '../../src/shared/sop-window';

const progress = startSopProgress(MISSING_ITEM_SOP_TREE);
const project = (published: ReadonlySet<string> | 'fixture') => projectSop({
  tree: MISSING_ITEM_SOP_TREE, progress, role: 'agent', taskId: 'test-task', revision: 1, published,
});

describe('unavailable synthetic SOP wordings', () => {
  it('keeps only the identity and unavailable status in the Query projection', () => {
    const available = project('fixture');
    const unavailable = project(new Set());
    expect(isSopProjection(available)).toBe(true);
    expect(available.scripts[0]).toMatchObject({ unpublished: false, answerText: expect.any(String) });
    expect(unavailable.scripts).toEqual(available.scripts.map(script => ({ scriptId: script.scriptId, unpublished: true, images: [] })));
    expect(isSopProjection(unavailable)).toBe(true);
  });

  it('rejects an unavailable item carrying a title, condition, body or image', () => {
    const unavailable = project(new Set());
    const item = unavailable.scripts[0];
    const image = project('fixture').images[0];
    expect(item).toBeDefined();
    expect(image).toBeDefined();
    for (const extra of [{ title: '合成标题' }, { condition: '合成条件' }, { answerText: '合成正文' }, { images: [image] }]) {
      expect(isSopProjection({ ...unavailable, scripts: [{ ...item, ...extra }] })).toBe(false);
    }
  });

  it('also withholds text with an unfilled authoring placeholder', () => {
    const tree = { ...MISSING_ITEM_SOP_TREE, nodes: MISSING_ITEM_SOP_TREE.nodes.map(node => node.id !== progress.nodeId ? node : {
      ...node, scripts: node.scripts.map((script, index) => index === 0 ? { ...script, answerText: '请确认 {待填写信息}' } : script),
    }) };
    const result = projectSop({ tree, progress, role: 'agent', taskId: 'test-task', revision: 1 });
    expect(result.scripts[0]).toEqual({ scriptId: tree.nodes[0]?.scripts[0]?.id, unpublished: true, images: [] });
    expect(result.scripts[1]?.unpublished).toBe(false);
    expect(isSopProjection(result)).toBe(true);
  });
});

describe('SOP workspace snapshot boundary', () => {
  const snapshot = () => {
    const projection = project('fixture');
    return {
      kind: 'ready', mode: 'query', access: {kind:'executable',hostEpoch:1}, sequence: 1, copyGeneration: 0, view: { kind: 'sop', taskId: projection.taskId }, viewEpoch: 2, transition: null, projection,
      tasks: [{ taskId: projection.taskId, ordinal: 1, displayName: null, revision: projection.revision, sceneId: projection.sceneId,
        sceneTitle: projection.sceneTitle, taskTitle: projection.taskTitle, stepIndex: projection.stepIndex, waiting: projection.waiting }],
    };
  };

  it('accepts one consistent active task and rejects stale or foreign projection identity', () => {
    const valid = snapshot();
    expect(isQuerySopSnapshot(valid)).toBe(true);
    expect(isQuerySopSnapshot({ ...valid, view: { kind: 'sop', taskId: 'other-task' } })).toBe(false);
    expect(isQuerySopSnapshot({ ...valid, tasks: [{ ...valid.tasks[0], revision: 2 }] })).toBe(false);
    expect(isQuerySopSnapshot({ ...valid, tasks: [{ ...valid.tasks[0], stepIndex: 2 }] })).toBe(false);
    expect(isQuerySopSnapshot({ ...valid, tasks: [...valid.tasks, ...valid.tasks] })).toBe(false);
    expect(isQuerySopSnapshot({ ...valid, view: { kind: 'query-home' } })).toBe(false);
  });

  it('never permits an unavailable or home snapshot to carry stale SOP content', () => {
    const valid = snapshot();
    expect(isQuerySopSnapshot(SOP_UNAVAILABLE)).toBe(true);
    expect(isQuerySopSnapshot({ ...SOP_UNAVAILABLE, projection: valid.projection })).toBe(false);
    expect(isQuerySopSnapshot({ ...valid, view: { kind: 'query-home' }, access: {kind:'none'}, projection: null })).toBe(true);
    expect(isQuerySopSnapshot({ ...valid, sequence: 0 })).toBe(false);
    expect(isQuerySopSnapshot({ ...valid, transition: { stage: 'animating', from: { width: 600, height: 208 }, to: { width: 580, height: Infinity } } })).toBe(false);
  });

  it('requires copy feedback to name a valid source step without carrying copyable text', () => {
    const projection = project('fixture');
    const source = { taskId: projection.taskId, revision: projection.revision, stepIndex: projection.stepIndex };
    const result = { ok: true, outcome: 'copied-advanced', source, sourceTitle: projection.taskTitle, copyGeneration: 1 };
    expect(isSopCopyResult(result)).toBe(true);
    expect(isSopCopyResult({ ...result, source: { ...source, taskId: '' } })).toBe(false);
    expect(isSopCopyResult({ ...result, source: { ...source, revision: 0 } })).toBe(false);
    expect(isSopCopyResult({ ...result, answerText: '不得夹带正文' })).toBe(false);
    expect(isSopCopyResult({ ok: true })).toBe(false);
    expect(isSopCopyResult({ ...result, outcome: 'copied-stayed', reason: 'requirements' })).toBe(true);
    expect(isSopCopyResult({ ...result, outcome: 'copied-stayed' })).toBe(false);
    expect(isSopCopyResult({ ...result, outcome: 'copied-stayed', reason: 'unexplained' })).toBe(false);
    expect(isSopCopyResult({ ...result, reason: 'requirements' })).toBe(false);
  });
});
