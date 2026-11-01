import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FloatingSopApp } from '../../src/renderer/features/sop/FloatingSopApp';
import { projectSop, startSopProgress } from '../../src/shared/sop-model';
import { ALLERGY_SOP_TREE } from '../../src/shared/synthetic-sops';
import type { SopFloatingApi, SopFloatingSnapshot, SopWindowResult, SopCopyResult } from '../../src/shared/sop-window';

const projection = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'sop-1', revision: 1 });
const initial: SopFloatingSnapshot = {
  kind: 'ready', sequence: 1, copyGeneration: 0, collapsed: false, seenActiveTaskIds: ['sop-1'], mode: 'floating',
  tasks: [{ taskId: 'sop-1', ordinal: 1, displayName: '合成客户甲', revision: 1, sceneId: projection.sceneId,
    sceneTitle: projection.sceneTitle, taskTitle: projection.taskTitle, stepIndex: 1, waiting: null }],
  access: { kind: 'executable', hostEpoch: 9 }, view: { kind: 'sop', taskId: 'sop-1' }, viewEpoch: 1, transition: null, projection,
};

afterEach(() => { delete window.sopFloating; });

it('collapses to an independently expandable task bar without ending or advancing the flow', async () => {
  let publish: (value: SopFloatingSnapshot) => void = () => undefined;
  const api: SopFloatingApi = {
    current: vi.fn(async () => initial), ready: vi.fn(async () => true),
    command: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })), copyCurrent: vi.fn(async (): Promise<SopCopyResult> => ({ ok: false, message: '不可复制' })),
    renameCurrent: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })), windowIntent: vi.fn(async () => true),
    draftCurrent: vi.fn(async () => ({ ok: true, draft: null })), draftStart: vi.fn(async () => ({ ok: true, draft: null })),
    draftUpdate: vi.fn(async () => true), draftDiscard: vi.fn(async () => true),
    onProjection: vi.fn(callback => { publish = callback; return () => undefined; }),
  };
  window.sopFloating = api;
  render(<FloatingSopApp />);
  fireEvent.click(await screen.findByRole('button', { name: '收起' }));
  await waitFor(() => expect(api.windowIntent).toHaveBeenCalledWith({ type: 'hide', taskId: 'sop-1', hostEpoch: 9 }));
  act(() => publish({ ...initial, sequence: 2, collapsed: true }));
  const bookmark = await screen.findByRole('button', { name: '展开流程' });
  expect(bookmark).toBeVisible();
  expect(bookmark).toHaveTextContent('合成客户甲');
  fireEvent.mouseEnter(bookmark);
  fireEvent.focus(bookmark);
  expect(api.windowIntent).toHaveBeenCalledTimes(1);
  expect(bookmark).toHaveAccessibleDescription('合成客户甲 · 步骤 1 · 核实凭证');
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(screen.queryByText('步骤 1 · 核实凭证')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '核实凭证' })).not.toBeInTheDocument();
  vi.mocked(api.windowIntent).mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: '展开流程' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('展开失败，点击重试');
  fireEvent.click(screen.getByRole('button', { name: '展开流程' }));
  await waitFor(() => expect(api.windowIntent).toHaveBeenCalledTimes(3));
  expect(api.windowIntent).toHaveBeenLastCalledWith({ type: 'expand', taskId: 'sop-1', hostEpoch: 9 });
  act(() => publish({ ...initial, sequence: 3 }));
  expect(await screen.findByRole('heading', { name: '核实凭证' })).toBeVisible();
  expect(api.command).not.toHaveBeenCalled();
  expect(api.copyCurrent).not.toHaveBeenCalled();
});

it('retries a failed collapsed-window preparation without exposing executable actions', async () => {
  const preview: SopFloatingSnapshot = { ...initial, collapsed: true, access: { kind: 'preview', mountId: 7 } };
  const api: SopFloatingApi = {
    current: vi.fn(async () => preview), ready: vi.fn(async () => false),
    command: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })),
    copyCurrent: vi.fn(async (): Promise<SopCopyResult> => ({ ok: false, message: '不可复制' })),
    renameCurrent: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })), windowIntent: vi.fn(async () => true),
    draftCurrent: vi.fn(async () => ({ ok: true, draft: null })), draftStart: vi.fn(async () => ({ ok: true, draft: null })),
    draftUpdate: vi.fn(async () => true), draftDiscard: vi.fn(async () => true),
    onProjection: vi.fn(() => () => undefined),
  };
  window.sopFloating = api;
  render(<FloatingSopApp />);
  const retry = await screen.findByRole('button', { name: '重新读取流程' });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);
  await waitFor(() => expect(api.ready).toHaveBeenCalledTimes(2));
  expect(api.ready).toHaveBeenLastCalledWith({ mountId: 7 });
  expect(api.windowIntent).not.toHaveBeenCalled();
  expect(api.command).not.toHaveBeenCalled();
});
