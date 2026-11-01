import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { canStartBackgroundDrag, useWindowDrag } from '../../src/renderer/lib/use-window-drag';

function pointer(type: string, x: number, y: number, buttons = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons, clientX: x, clientY: y, screenX: x, screenY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}
function DragSurface({ move, action }: { move: (x: number, y: number, finished: boolean) => void; action: () => void }) {
  const drag = useWindowDrag(move, () => {}, { canStart: canStartBackgroundDrag });
  return <div data-testid="surface" {...drag}><button onClick={action}>打开待办</button><input aria-label="问题" /><p>可以选择的正文</p><span>话术标题</span><div data-testid="space" /></div>;
}

describe('Query background dragging', () => {
  it('moves only blank space and keeps a blank click inert', () => {
    const move = vi.fn(), action = vi.fn();
    const view = render(<DragSurface move={move} action={action} />);
    const root = view.getByTestId('surface');
    root.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    fireEvent(root, pointer('pointerdown', 100, 100));
    fireEvent(root, pointer('pointerup', 100, 100, 0));
    expect(move).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    fireEvent(root, pointer('pointerdown', 100, 100));
    fireEvent(root, pointer('pointermove', 130, 120));
    fireEvent(root, pointer('pointerup', 130, 120, 0));
    expect(move.mock.calls).toEqual([[30, 20, false], [0, 0, true]]);
  });
  it('does not capture buttons, text input, selectable text or resize-edge space', () => {
    const move = vi.fn(), action = vi.fn();
    const view = render(<DragSurface move={move} action={action} />);
    const root = view.getByTestId('surface');
    root.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    for (const target of [view.getByRole('button'), view.getByRole('textbox'), view.getByText('可以选择的正文'), view.getByText('话术标题')]) {
      fireEvent(target, pointer('pointerdown', 100, 100));
      fireEvent(target, pointer('pointermove', 130, 120));
      fireEvent(target, pointer('pointerup', 130, 120, 0));
    }
    fireEvent(root, pointer('pointerdown', 2, 100));
    fireEvent(root, pointer('pointermove', 30, 120));
    fireEvent(root, pointer('pointerup', 30, 120, 0));
    expect(move).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button'));
    expect(action).toHaveBeenCalledOnce();
    fireEvent.change(view.getByRole('textbox'), { target: { value: '少件问题' } });
    expect(view.getByRole('textbox')).toHaveValue('少件问题');
  });
});
