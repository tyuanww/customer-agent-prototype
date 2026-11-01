// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { projectSop, startSopProgress, type SopTree } from '../../src/shared/sop-model';
import { isQuerySopSnapshot, isSopFloatingSnapshot, MAX_SOP_TASKS, SOP_UNAVAILABLE, type SopFloatingApi, type SopFloatingSnapshot } from '../../src/shared/sop-window';

const electron = vi.hoisted(() => ({
  expose: vi.fn(), invoke: vi.fn(),
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
  remove: vi.fn((channel: string, listener: (event: unknown, payload: unknown) => void) => {
    if (electron.listeners.get(channel) === listener) electron.listeners.delete(channel);
  }),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: {
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) => electron.listeners.set(channel, listener),
    removeListener: electron.remove, invoke: electron.invoke,
  },
}));

const tree: SopTree = { sceneId: 's', sceneTitle: '合成流程', stageLabel: '测试', version: '1', startNodeId: 'n', nodes: [
  { id: 'n', title: '合成步骤', instruction: '核实', stageLabel: '测试', kind: 'terminal', scripts: [], requirements: [], knowledge: [] },
] };
const projection = projectSop({ tree, progress: startSopProgress(tree), role: 'agent', taskId: 'task-current', revision: 1 });
const ready: Extract<SopFloatingSnapshot, { kind: 'ready' }> = { kind: 'ready', mode: 'floating', access: { kind: 'executable', hostEpoch: 1 },
  sequence: 1, copyGeneration: 0, collapsed: false, view: { kind: 'sop', taskId: projection.taskId }, viewEpoch: 1, transition: null, projection,
  tasks: [{ taskId: projection.taskId, revision: projection.revision, ordinal: 1, displayName: null, sceneId: projection.sceneId,
    sceneTitle: projection.sceneTitle, taskTitle: projection.taskTitle, stepIndex: projection.stepIndex, waiting: null }],
  seenActiveTaskIds: [projection.taskId],
};

it('strictly validates floating-only IDs and never changes the Query snapshot contract', () => {
  expect(isSopFloatingSnapshot(ready)).toBe(true);
  expect(isSopFloatingSnapshot(SOP_UNAVAILABLE)).toBe(true);
  const { seenActiveTaskIds: _ids, collapsed: _collapsed, ...query } = ready;
  expect(isQuerySopSnapshot(query)).toBe(true);
  expect(isQuerySopSnapshot(ready)).toBe(false);
  expect(isSopFloatingSnapshot(query)).toBe(false);
  expect(isSopFloatingSnapshot(Object.assign(Object.create({ seenActiveTaskIds: [projection.taskId] }), query))).toBe(false);
  for (const invalid of [
    { ...ready, seenActiveTaskIds: null },
    { ...ready, seenActiveTaskIds: [] },
    { ...ready, seenActiveTaskIds: ['task-previous'] },
    { ...ready, seenActiveTaskIds: [projection.taskId, 'task-previous'] },
    { ...ready, seenActiveTaskIds: [projection.taskId, projection.taskId] },
    { ...ready, seenActiveTaskIds: [projection.taskId, ' invalid '] },
    { ...ready, seenActiveTaskIds: [projection.taskId, 'x'.repeat(129)] },
    { ...ready, seenActiveTaskIds: Array.from({ length: MAX_SOP_TASKS + 1 }, (_, index) => `task-${index}`) },
    { ...ready, unexpected: true },
    { ...SOP_UNAVAILABLE, seenActiveTaskIds: [] },
    { ...ready, tasks: [...ready.tasks, { ...ready.tasks[0], taskId: 'task-previous' }] },
  ]) expect(isSopFloatingSnapshot(invalid)).toBe(false);
  const home = { ...ready, view: { kind: 'query-home' }, projection: null, access: { kind: 'none' }, tasks: [], seenActiveTaskIds: [] };
  expect(isSopFloatingSnapshot(home)).toBe(true);
  expect(isSopFloatingSnapshot({ ...home, tasks: ready.tasks })).toBe(false);
  expect(isSopFloatingSnapshot({ ...home, view: { kind: 'query-results' } })).toBe(false);
  expect(isSopFloatingSnapshot({ ...ready, transition: { stage: 'preparing', from: { width: 580, height: 620 }, to: { width: 580, height: 620 } } })).toBe(false);
});

it('validates current and projection events identically and unsubscribes', async () => {
  await import('../../src/preload/sop');
  const exposed = electron.expose.mock.calls.find(call => call[0] === 'sopFloating');
  if (!exposed) throw new Error('Missing floating preload API');
  const api: SopFloatingApi = exposed[1];
  const received = vi.fn();
  const stop = api.onProjection(received);
  const listener = electron.listeners.get('sop-floating:projection');
  if (!listener) throw new Error('Missing floating projection listener');
  listener({}, ready);
  listener({}, { ...ready, seenActiveTaskIds: [] });
  expect(received).toHaveBeenNthCalledWith(1, ready);
  expect(received).toHaveBeenNthCalledWith(2, SOP_UNAVAILABLE);
  electron.invoke.mockResolvedValueOnce(ready).mockResolvedValueOnce({ ...ready, seenActiveTaskIds: [] });
  await expect(api.current()).resolves.toEqual(ready);
  await expect(api.current()).resolves.toEqual(SOP_UNAVAILABLE);
  stop();
  expect(electron.remove).toHaveBeenCalledWith('sop-floating:projection', listener);
  expect(electron.listeners.has('sop-floating:projection')).toBe(false);
  expect('onTaskRemoved' in api).toBe(false);
});
