import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useQuerySop } from '../../src/renderer/features/sop/use-query-sop';
import { projectSop } from '../../src/shared/sop-model';
import { MISSING_ITEM_SOP_TREE } from '../../src/shared/synthetic-sops';
import type { QuerySopSnapshot } from '../../src/shared/sop-window';

const projection = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: { sceneId: MISSING_ITEM_SOP_TREE.sceneId, nodeId: 'collect', stepIndex: 1 }, role: 'agent', taskId: 'task-a', revision: 1 });
const ready: Extract<QuerySopSnapshot, { kind: 'ready' }> = {
  kind: 'ready', sequence: 1, copyGeneration: 0, viewEpoch: 1,
  tasks: [{ taskId: projection.taskId, revision: 1, ordinal: 1, displayName: null, sceneId: projection.sceneId, sceneTitle: projection.sceneTitle, taskTitle: projection.taskTitle, stepIndex: 1, waiting: null }], transition: null,
  mode: 'query', access: { kind: 'executable', hostEpoch: 1 }, view: { kind: 'sop', taskId: projection.taskId }, projection,
};
afterEach(() => { delete window.customerAgent; });

it.each(['recover', 'open'] as const)('keeps invalid projections unavailable until an explicit %s succeeds', async action => {
  let notify: (value: unknown) => void = () => undefined;
  const current = vi.fn(async () => ready);
  Object.defineProperty(window, 'customerAgent', { configurable: true, value: { sopWindow: {
    current, onProjection: (callback: typeof notify) => { notify = callback; return () => undefined; },
    open: vi.fn(async () => ({ ok: true })),
  } } });
  const { result } = renderHook(() => useQuerySop());
  await waitFor(() => expect(result.current.snapshot?.kind).toBe('ready'));
  act(() => { notify({ malformed: true }); });
  expect(result.current.snapshot?.kind).toBe('unavailable');
  await act(async () => { fireEvent.focus(window); });
  await act(async () => { fireEvent(document, new Event('visibilitychange')); });
  expect(result.current.snapshot?.kind).toBe('unavailable');
  act(() => { notify({ ...ready, sequence: 2 }); });
  expect(result.current.snapshot?.kind).toBe('unavailable');
  act(() => { notify({ kind: 'unavailable', message: '授权已撤销' }); });
  expect(result.current.snapshot).toEqual({ kind: 'unavailable', message: '授权已撤销' });
  await act(async () => {
    if (action === 'recover') result.current.recover();
    else result.current.open('synthetic-scene');
  });
  await waitFor(() => expect(result.current.snapshot?.kind).toBe('ready'));
});

it.each(['cancel', 'revoke'] as const)('rejects a late recovery projection after %s', async interruption => {
  let notify: (value: unknown) => void = () => undefined;
  let finish: (value: QuerySopSnapshot) => void = () => undefined;
  const current = vi.fn(async () => ready as QuerySopSnapshot);
  Object.defineProperty(window, 'customerAgent', { configurable: true, value: { sopWindow: {
    current, onProjection: (callback: typeof notify) => { notify = callback; return () => undefined; },
  } } });
  const { result } = renderHook(() => useQuerySop());
  await waitFor(() => expect(result.current.snapshot?.kind).toBe('ready'));
  act(() => { notify({ malformed: true }); });
  current.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => { result.current.recover(); });
  act(() => {
    if (interruption === 'cancel') result.current.cancelPending();
    else notify({ kind: 'unavailable', message: '授权已撤销' });
    notify({ ...ready, sequence: 2 });
  });
  await act(async () => { finish(ready); });
  expect(result.current.snapshot?.kind).toBe('unavailable');
});

it('accepts an explicit open preview so Main can complete its ready handshake', async () => {
  let notify: (value: unknown) => void = () => undefined;
  let acknowledge: () => void = () => undefined;
  const current = vi.fn(async () => ready);
  Object.defineProperty(window, 'customerAgent', { configurable: true, value: { sopWindow: {
    current, onProjection: (callback: typeof notify) => { notify = callback; return () => undefined; },
    ready: vi.fn(async () => { acknowledge(); return true; }),
    open: vi.fn(async () => {
      await new Promise<void>(resolve => {
        acknowledge = resolve;
        notify({ ...ready, sequence: 2, access: { kind: 'preview', mountId: 4 } });
      });
      return { ok: true };
    }),
  } } });
  const { result } = renderHook(() => useQuerySop());
  await waitFor(() => expect(result.current.snapshot?.kind).toBe('ready'));
  act(() => { notify({ malformed: true }); result.current.open('missing-item-demo'); });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(result.current.snapshot?.kind).toBe('ready');
});

it('accepts a newer Main preview from a floating-window handoff while unavailable', async () => {
  let notify: (value: unknown) => void = () => undefined;
  const acknowledge = vi.fn(async () => true);
  Object.defineProperty(window, 'customerAgent', { configurable: true, value: { sopWindow: {
    current: vi.fn(async () => ready), ready: acknowledge,
    onProjection: (callback: typeof notify) => { notify = callback; return () => undefined; },
  } } });
  const { result } = renderHook(() => useQuerySop());
  await waitFor(() => expect(result.current.snapshot?.kind).toBe('ready'));
  act(() => { notify({ malformed: true }); });
  act(() => { notify({ ...ready, sequence: 2, access: { kind: 'preview', mountId: 5 } }); });
  await waitFor(() => expect(acknowledge).toHaveBeenCalledWith({ mountId: 5 }));
  act(() => { notify({ ...ready, sequence: 3, access: { kind: 'executable', hostEpoch: 2 } }); });
  expect(result.current.snapshot?.kind).toBe('ready');
});
