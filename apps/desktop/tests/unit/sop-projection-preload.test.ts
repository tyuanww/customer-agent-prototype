// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { CustomerAgentApi } from '../../src/shared/contracts';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { projectSop, startSopProgress, type SopTree } from '../../src/shared/sop-model';
import { SOP_UNAVAILABLE, type QuerySopSnapshot } from '../../src/shared/sop-window';

const electron = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(),
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: {
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) => electron.listeners.set(channel, listener),
    removeListener: (channel: string) => electron.listeners.delete(channel),
    invoke: electron.invoke,
  },
}));

it('removes stale SOP content on an invalid snapshot and allows a controlled read to recover', async () => {
  await import('../../src/preload/index');
  const exposed = electron.expose.mock.calls.find(call => call[0] === 'customerAgent');
  if (!exposed) throw new Error('Missing overlay preload API');
  const api: CustomerAgentApi = exposed[1];
  const subscribe = api.sopWindow?.onProjection;
  if (!subscribe || !api.sopWindow?.current) throw new Error('Missing SOP snapshot API');
  const received = vi.fn();
  const stop = subscribe(received);
  const tree: SopTree = { sceneId: 's', sceneTitle: '合成流程', stageLabel: '测试', version: '1', startNodeId: 'n', nodes: [
    { id: 'n', title: '合成任务', instruction: '核实', stageLabel: '测试', kind: 'terminal', scripts: [], requirements: [], knowledge: [] },
  ] };
  const projection = projectSop({ tree, progress: startSopProgress(tree), role: 'agent', taskId: 'task-a', revision: 1 });
  const valid: QuerySopSnapshot = { kind: 'ready', mode: 'query', access: {kind:'executable',hostEpoch:1}, sequence: 1, copyGeneration: 0, view: { kind: 'sop', taskId: projection.taskId }, viewEpoch: 1,
    transition: null, projection, tasks: [{ taskId: projection.taskId, revision: projection.revision, ordinal: 1, displayName: null, sceneId: tree.sceneId,
      sceneTitle: tree.sceneTitle, taskTitle: projection.taskTitle, stepIndex: projection.stepIndex, waiting: null }] };
  const ended: QuerySopSnapshot = { kind: 'ready', mode: 'query', access: {kind:'none'}, sequence: 3, copyGeneration: 0, view: { kind: 'query-home' }, viewEpoch: 2, transition: null, projection: null, tasks: [] };
  const listener = electron.listeners.get(IPC_CHANNELS.SOP_WINDOW_PROJECTION);
  if (!listener) throw new Error('Missing SOP projection listener');
  listener({}, valid);
  listener({}, { ...valid, projection: { ...projection, images: [{ alt: '坏图', dataUrl: 'file:///secret.png' }] } });
  listener({}, { ...valid, sequence: 2 });
  listener({}, ended);
  expect(received).toHaveBeenNthCalledWith(1, valid);
  expect(received).toHaveBeenNthCalledWith(2, SOP_UNAVAILABLE);
  expect(received).toHaveBeenNthCalledWith(3, { ...valid, sequence: 2 });
  expect(received).toHaveBeenNthCalledWith(4, ended);
  electron.invoke.mockResolvedValueOnce({ ...valid, view: { kind: 'sop', taskId: 'other-task' } });
  await expect(api.sopWindow.current()).resolves.toEqual(SOP_UNAVAILABLE);
  electron.invoke.mockResolvedValueOnce({ ...valid, sequence: 4 });
  await expect(api.sopWindow.current()).resolves.toEqual({ ...valid, sequence: 4 });
  stop();
});
