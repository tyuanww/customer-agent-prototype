import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuerySopWindowControls } from '../../src/renderer/features/sop/QuerySopWindowControls';
import type { QuerySopWindowApi, SopWindowResult } from '../../src/shared/sop-window';

function pointer(type: string, x: number, y: number, buttons = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons, screenX: x, screenY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}
function apiFor(windowIntent: NonNullable<QuerySopWindowApi['windowIntent']>): QuerySopWindowApi {
  return {
    open: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })), entryAvailable: vi.fn(async () => true),
    resumeAvailable: vi.fn(async () => true), windowIntent,
  };
}

describe('SOP window controls', () => {
  it('keeps a resize alive across business revisions in the same view epoch', async () => {
    let activeGesture: number | null = null;
    const windowIntent: NonNullable<QuerySopWindowApi['windowIntent']> = vi.fn(async intent => {
      if (intent.hostEpoch !== 7 || intent.taskId !== 'task-a') return false;
      if (intent.type === 'resize-start') activeGesture = intent.gesture;
      if (intent.type === 'resize-end' && activeGesture === intent.gesture) activeGesture = null;
      return true;
    });
    const api = apiFor(windowIntent);
    const view = render(<QuerySopWindowControls api={api} taskId="task-a" hostEpoch={7} mode="query">{pin => <>{pin(false)}<span>步骤 1</span></>}</QuerySopWindowControls>);
    const edge = view.container.querySelector<HTMLElement>('.sop-resize-se');
    if (!edge) throw new Error('resize edge missing');
    edge.setPointerCapture = vi.fn();
    fireEvent(edge, pointer('pointerdown', 10, 10));
    await waitFor(() => expect(activeGesture).not.toBeNull());
    view.rerender(<QuerySopWindowControls api={api} taskId="task-a" hostEpoch={7} mode="query">{pin => <>{pin(false)}<span>步骤 2</span></>}</QuerySopWindowControls>);
    expect(activeGesture).not.toBeNull();
    fireEvent(edge, pointer('pointermove', 60, 50));
    await waitFor(() => expect(windowIntent).toHaveBeenCalledWith(expect.objectContaining({ type: 'resize', taskId: 'task-a', hostEpoch: 7, dx: 50, dy: 40 })));
    fireEvent(edge, pointer('pointerup', 60, 50, 0));
    await waitFor(() => expect(activeGesture).toBeNull());
    expect(windowIntent).toHaveBeenCalledWith(expect.objectContaining({ type: 'resize-end', taskId: 'task-a', hostEpoch: 7 }));
  });

  it.each(['lostpointercapture', 'blur', 'pointermove'])('settles the last resize on %s without rolling it back', async type => {
    const windowIntent: NonNullable<QuerySopWindowApi['windowIntent']> = vi.fn(async () => true);
    const view = render(<QuerySopWindowControls api={apiFor(windowIntent)} taskId="task-a" hostEpoch={7} mode="floating">{control => control(false)}</QuerySopWindowControls>);
    const edge = view.container.querySelector<HTMLElement>('.sop-resize-se');
    if (!edge) throw new Error('resize edge missing');
    edge.setPointerCapture = vi.fn();
    fireEvent(edge, pointer('pointerdown', 10, 10));
    fireEvent(edge, pointer('pointermove', 200, 200));
    if (type === 'blur') fireEvent(window, new Event('blur'));
    else fireEvent(edge, pointer(type, 200, 200, 0));
    fireEvent(edge, pointer('pointerup', 200, 200, 0));
    await waitFor(() => expect(windowIntent).toHaveBeenCalledWith(expect.objectContaining({ type: 'resize-end' })));
    expect(vi.mocked(windowIntent).mock.calls.filter(([intent]) => intent.type === 'resize-end')).toHaveLength(1);
    expect(windowIntent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'resize-cancel' }));
  });

  it('does not send a departed task gesture as an action for the newly selected task', async () => {
    const windowIntent: NonNullable<QuerySopWindowApi['windowIntent']> = vi.fn(async () => true);
    const api = apiFor(windowIntent);
    const view = render(<QuerySopWindowControls api={api} taskId="task-a" hostEpoch={7} mode="query">{pin => pin(false)}</QuerySopWindowControls>);
    const edge = view.container.querySelector<HTMLElement>('.sop-resize-se');
    if (!edge) throw new Error('resize edge missing');
    edge.setPointerCapture = vi.fn();
    fireEvent(edge, pointer('pointerdown', 10, 10));
    await waitFor(() => expect(windowIntent).toHaveBeenCalledWith(expect.objectContaining({ type: 'resize-start' })));
    view.rerender(<QuerySopWindowControls api={api} taskId="task-b" hostEpoch={8} mode="query">{pin => pin(false)}</QuerySopWindowControls>);
    fireEvent(edge, pointer('pointermove', 60, 50));
    expect(windowIntent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'resize', taskId: 'task-b' }));
    expect(windowIntent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'resize-end', taskId: 'task-b' }));
  });

  it('sends explicit detach and attach intents with the current execution epoch', async () => {
    const windowIntent: NonNullable<QuerySopWindowApi['windowIntent']> = vi.fn(async () => true);
    const api = apiFor(windowIntent);
    const view = render(<QuerySopWindowControls api={api} taskId="task-a" hostEpoch={7} mode="query">{control => control(false)}</QuerySopWindowControls>);
    fireEvent.click(view.getByRole('button', { name: '独立悬浮' }));
    await waitFor(() => expect(windowIntent).toHaveBeenLastCalledWith({ type: 'detach', taskId: 'task-a', hostEpoch: 7 }));
    view.rerender(<QuerySopWindowControls api={api} taskId="task-a" hostEpoch={8} mode="floating">{control => control(false)}</QuerySopWindowControls>);
    fireEvent.click(view.getByRole('button', { name: '合回查询' }));
    await waitFor(() => expect(windowIntent).toHaveBeenLastCalledWith({ type: 'attach', taskId: 'task-a', hostEpoch: 8 }));
  });
  it('waits for the draft to be saved in the session before switching hosts', async () => {
    const windowIntent: NonNullable<QuerySopWindowApi['windowIntent']> = vi.fn(async () => true);
    let finishPreparing: (value: boolean) => void = () => undefined;
    const prepareTransfer = vi.fn(() => new Promise<boolean>(resolve => { finishPreparing = resolve; }));
    const finishTransfer = vi.fn();
    const view = render(<QuerySopWindowControls api={apiFor(windowIntent)} taskId="task-a" hostEpoch={7} mode="query">
      {control => control(false, { prepareTransfer, finishTransfer })}
    </QuerySopWindowControls>);
    fireEvent.click(view.getByRole('button', { name: '独立悬浮' }));
    expect(prepareTransfer).toHaveBeenCalledTimes(1);
    expect(windowIntent).not.toHaveBeenCalled();
    finishPreparing(true);
    await waitFor(() => expect(windowIntent).toHaveBeenCalledWith({ type: 'detach', taskId: 'task-a', hostEpoch: 7 }));
    await waitFor(() => expect(finishTransfer).toHaveBeenCalledTimes(1));
  });
  it('keeps the current host when draft preparation fails', async () => {
    const windowIntent: NonNullable<QuerySopWindowApi['windowIntent']> = vi.fn(async () => true);
    const finishTransfer = vi.fn();
    const view = render(<QuerySopWindowControls api={apiFor(windowIntent)} taskId="task-a" hostEpoch={7} mode="query">
      {control => control(false, { prepareTransfer: async () => false, finishTransfer })}
    </QuerySopWindowControls>);
    fireEvent.click(view.getByRole('button', { name: '独立悬浮' }));
    await waitFor(() => expect(finishTransfer).toHaveBeenCalledTimes(1));
    expect(windowIntent).not.toHaveBeenCalled();
  });
  it('shows a recoverable error when switching windows fails', async () => {
    const api = apiFor(vi.fn(async () => false));
    const view = render(<QuerySopWindowControls api={api} taskId="task-a" hostEpoch={7} mode="query">{control => control(false)}</QuerySopWindowControls>);
    fireEvent.click(view.getByRole('button', { name: '独立悬浮' }));
    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('窗口切换失败，请重试'));
  });
});
