import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoxApp } from '../../src/renderer/FoxApp';
import { QueryApp } from '../../src/renderer/QueryApp';
import { splitDragDelta } from '../../src/renderer/lib/use-window-drag';
import { FOX_RETRACT_DURATION_MS } from '../../src/shared/fox-motion';
import type { OverlayCommand } from '../../src/shared/overlay-events';
import { IDENTITY_FOX_VISUAL_TRANSFORM } from '../../src/shared/overlay-events';

const copyText = vi.fn();
const getPlatform = vi.fn();
const getWindowContext = vi.fn();
const openSearch = vi.fn();
const openDashboard = vi.fn();
const dismiss = vi.fn();
const reportUiPhase = vi.fn();
const moveFoxBy = vi.fn();
const setFoxPeek = vi.fn();
const commandListeners = new Set<(command: OverlayCommand) => void>();

function dispatchPointer(
  target: Element,
  type: string,
  init: Record<string, number>,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  fireEvent(target, event);
}

function dispatchAnimationEnd(target: Element, animationName: string): void {
  const event = new Event('animationend', { bubbles: true, cancelable: false });
  Object.defineProperty(event, 'animationName', { configurable: true, value: animationName });
  fireEvent(target, event);
}

describe('FoxApp', () => {
  beforeEach(() => {
    vi.useRealTimers();
    copyText.mockReset();
    getPlatform.mockReset();
    getWindowContext.mockReset();
    openSearch.mockReset();
    openDashboard.mockReset();
    dismiss.mockReset();
    reportUiPhase.mockReset();
    moveFoxBy.mockReset();
    setFoxPeek.mockReset();
    setFoxPeek.mockResolvedValue(undefined);
    getPlatform.mockResolvedValue({ platform: 'darwin' });
    commandListeners.clear();
    getWindowContext.mockResolvedValue({
      role: 'fox',
      phase: 'FOX_IDLE',
      shortcut: {
        registered: true,
        accelerator: 'CommandOrControl+Shift+Space',
        message: '',
      },
      testHarness: false,
    });
    window.customerAgent = {
      copyText,
      getPlatform,
      getWindowContext,
      openSearch,
      openDashboard,
      dismiss,
      reportUiPhase,
      moveFoxBy,
      setFoxPeek,
      onOverlayCommand(handler: (command: OverlayCommand) => void) {
        commandListeners.add(handler);
        return () => {
          commandListeners.delete(handler);
        };
      },
    };
  });

  it('opens search on a click that is not a drag', async () => {
    render(<FoxApp />);
    fireEvent.pointerDown(screen.getByTestId('fox-button'), {
      button: 0,
      screenX: 10,
      screenY: 10,
    });
    fireEvent.pointerUp(screen.getByTestId('fox-button'), { screenX: 10, screenY: 10 });
    await waitFor(() => {
      expect(openSearch).toHaveBeenCalledTimes(1);
    });
    expect(openSearch).toHaveBeenCalledWith(IDENTITY_FOX_VISUAL_TRANSFORM);
    expect(screen.getByTestId('fox-idle')).toHaveClass('is-handoff-frozen');
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'none', epoch: 1 });
      }
    });
    expect(screen.getByTestId('fox-idle')).not.toHaveClass('is-handoff-frozen');
    expect(moveFoxBy).not.toHaveBeenCalled();
  });

  it('supports repeated keyboard activation without a pointer event', async () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');

    fireEvent.click(fox, { detail: 0 });
    fireEvent.click(fox, { detail: 0 });

    await waitFor(() => {
      expect(openSearch).toHaveBeenCalledTimes(2);
    });
  });

  it('leaves macOS Ctrl+click to the native context menu without opening search', () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');

    // jsdom does not expose PointerEvent, so Testing Library would otherwise
    // create a generic Event and silently drop ctrlKey/pointerId. Use mouse
    // events named as pointer events to exercise the real browser contract.
    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      ctrlKey: true,
      screenX: 10,
      screenY: 10,
    });
    Object.defineProperty(pointerDown, 'pointerId', { value: 2 });
    fireEvent(fox, pointerDown);
    const pointerUp = new MouseEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
      screenX: 10,
      screenY: 10,
    });
    Object.defineProperty(pointerUp, 'pointerId', { value: 2 });
    fireEvent(fox, pointerUp);
    const contextMenu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      ctrlKey: true,
    });
    fox.dispatchEvent(contextMenu);
    fireEvent.click(fox, { detail: 1, button: 0, ctrlKey: true });

    expect(contextMenu.defaultPrevented).toBe(false);
    expect(openSearch).not.toHaveBeenCalled();
    expect(moveFoxBy).not.toHaveBeenCalled();
  });

  it('drags the fox without opening search', async () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    fireEvent.pointerDown(fox, {
      button: 0,
      buttons: 1,
      pointerId: 1,
      screenX: 10,
      screenY: 10,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(fox, {
      button: 0,
      buttons: 1,
      pointerId: 1,
      screenX: 48,
      screenY: 36,
      clientX: 48,
      clientY: 36,
    });
    fireEvent.pointerUp(fox, {
      button: 0,
      pointerId: 1,
      screenX: 48,
      screenY: 36,
      clientX: 48,
      clientY: 36,
    });
    await waitFor(() => {
      expect(moveFoxBy).toHaveBeenCalledWith(0, 0, true);
    });
    expect(splitDragDelta(38, 26)).toEqual([{ dx: 38, dy: 26 }]);
    expect(openSearch).not.toHaveBeenCalled();
  });

  it('keeps screen coordinates continuous when dragging from physical x zero', () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 6,
      screenX: 0,
      screenY: 100,
      clientX: 40,
      clientY: 20,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 6,
      screenX: 6,
      screenY: 100,
      clientX: 46,
      clientY: 20,
    });

    expect(moveFoxBy).toHaveBeenCalledWith(6, 0, false);
  });

  it('finishes a moved drag when a later pointermove reports buttons=0', () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 7,
      screenX: 10,
      screenY: 10,
      clientX: 10,
      clientY: 10,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 7,
      screenX: 42,
      screenY: 34,
      clientX: 42,
      clientY: 34,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 0,
      pointerId: 7,
      screenX: 70,
      screenY: 60,
      clientX: 70,
      clientY: 60,
    });

    expect(moveFoxBy).toHaveBeenLastCalledWith(0, 0, true);
    const callsAfterRelease = moveFoxBy.mock.calls.length;
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 0,
      pointerId: 7,
      screenX: 90,
      screenY: 80,
      clientX: 90,
      clientY: 80,
    });
    fireEvent.click(fox, { detail: 1 });
    expect(moveFoxBy).toHaveBeenCalledTimes(callsAfterRelease);
    expect(openSearch).not.toHaveBeenCalled();
  });

  it('finishes a moved drag on lostpointercapture and ignores later moves', () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    fireEvent.pointerDown(fox, {
      button: 0,
      buttons: 1,
      pointerId: 8,
      screenX: 10,
      screenY: 10,
    });
    fireEvent.pointerMove(fox, {
      buttons: 1,
      pointerId: 8,
      screenX: 44,
      screenY: 28,
    });
    fireEvent.lostPointerCapture(fox, { pointerId: 8 });

    expect(moveFoxBy).toHaveBeenLastCalledWith(0, 0, true);
    const callsAfterCaptureLoss = moveFoxBy.mock.calls.length;
    fireEvent.pointerMove(fox, {
      buttons: 1,
      pointerId: 8,
      screenX: 70,
      screenY: 60,
    });
    expect(moveFoxBy).toHaveBeenCalledTimes(callsAfterCaptureLoss);
    expect(openSearch).not.toHaveBeenCalled();
  });

  it('finishes a moved drag when the renderer window blurs', () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    fireEvent.pointerDown(fox, {
      button: 0,
      buttons: 1,
      pointerId: 9,
      screenX: 10,
      screenY: 10,
    });
    fireEvent.pointerMove(fox, {
      buttons: 1,
      pointerId: 9,
      screenX: 46,
      screenY: 30,
    });
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(moveFoxBy).toHaveBeenLastCalledWith(0, 0, true);
    const callsAfterBlur = moveFoxBy.mock.calls.length;
    fireEvent.pointerMove(fox, {
      buttons: 1,
      pointerId: 9,
      screenX: 78,
      screenY: 64,
    });
    expect(moveFoxBy).toHaveBeenCalledTimes(callsAfterBlur);
    expect(openSearch).not.toHaveBeenCalled();
  });

  it('splits a fast drag into safe bounded movement events', () => {
    const chunks = splitDragDelta(600, -300);
    expect(chunks).toHaveLength(3);
    expect(chunks.every(({ dx, dy }) => Math.abs(dx) <= 240 && Math.abs(dy) <= 240)).toBe(true);
    expect(chunks.reduce((sum, item) => sum + item.dx, 0)).toBe(600);
    expect(chunks.reduce((sum, item) => sum + item.dy, 0)).toBe(-300);
  });

  it('surfaces a shortcut failure on the fox instead of failing silently', async () => {
    getWindowContext.mockResolvedValue({
      role: 'fox',
      phase: 'FOX_IDLE',
      shortcut: {
        registered: false,
        accelerator: 'CommandOrControl+Shift+Space',
        message: '全局快捷键注册失败',
      },
      testHarness: false,
    });
    render(<FoxApp />);
    expect(await screen.findByTestId('shortcut-fallback-dot')).toBeInTheDocument();
    expect(screen.getByTestId('fox-button')).toHaveAccessibleName(/全局快捷键注册失败|打开话术查询/);
  });

  it('peeks on the first intentional edge entry and retracts after its exit motion', async () => {
    vi.useFakeTimers();
    try {
      render(<FoxApp />);
      const fox = screen.getByTestId('fox-button');

      fireEvent.pointerEnter(fox);
      expect(setFoxPeek).not.toHaveBeenCalled();

      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'left', epoch: 1 });
        }
      });
      fireEvent.pointerEnter(fox);
      fireEvent.pointerEnter(fox);
      expect(setFoxPeek).toHaveBeenLastCalledWith('peek', 1);
      expect(setFoxPeek).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-peeking', 'true');

      fireEvent.pointerLeave(fox);
      fireEvent.pointerLeave(fox);
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-peeking', 'false');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-retracting', 'true');
      expect(setFoxPeek).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(FOX_RETRACT_DURATION_MS + 80);
        await Promise.resolve();
      });
      expect(setFoxPeek).toHaveBeenLastCalledWith('retract', 1);
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-retracting', 'false');

      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'none', epoch: 2 });
        }
      });
      fireEvent.pointerEnter(fox);
      expect(setFoxPeek).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a delayed retract when a newer fox epoch arrives', () => {
    vi.useFakeTimers();
    try {
      render(<FoxApp />);
      const fox = screen.getByTestId('fox-button');
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'left', epoch: 10 });
        }
      });
      fireEvent.pointerEnter(fox);
      fireEvent.pointerLeave(fox);

      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'right', epoch: 11 });
        }
        vi.advanceTimersByTime(FOX_RETRACT_DURATION_MS);
      });

      expect(setFoxPeek).toHaveBeenCalledTimes(1);
      expect(setFoxPeek).toHaveBeenLastCalledWith('peek', 10);
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-retracting', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the retract timer when the pointer re-enters during the glide-back', () => {
    vi.useFakeTimers();
    try {
      render(<FoxApp />);
      const fox = screen.getByTestId('fox-button');
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'left', epoch: 12 });
        }
      });

      fireEvent.pointerEnter(fox);
      fireEvent.pointerLeave(fox);
      act(() => {
        vi.advanceTimersByTime(FOX_RETRACT_DURATION_MS / 2);
      });
      fireEvent.pointerEnter(fox);
      act(() => {
        vi.advanceTimersByTime(FOX_RETRACT_DURATION_MS);
      });

      expect(setFoxPeek).toHaveBeenCalledTimes(2);
      expect(setFoxPeek.mock.calls).toEqual([
        ['peek', 12],
        ['peek', 12],
      ]);
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-peeking', 'true');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-retracting', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retracts immediately when reduced motion is requested', () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    try {
      render(<FoxApp />);
      const fox = screen.getByTestId('fox-button');
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'right', epoch: 13 });
        }
      });
      expect(setFoxPeek).toHaveBeenLastCalledWith('retract', 13);
      setFoxPeek.mockClear();

      fireEvent.pointerEnter(fox);
      fireEvent.pointerLeave(fox);

      expect(setFoxPeek.mock.calls).toEqual([
        ['peek', 13],
        ['retract', 13],
      ]);
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-retracting', 'false');
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it('exposes idle motion parameters and only replays snap after a real edge transition', async () => {
    render(<FoxApp />);
    const idle = screen.getByTestId('fox-idle');
    expect(idle).toHaveAttribute('data-idle-duration-ms', '3000');
    expect(idle).toHaveAttribute('data-idle-float-px', '4');
    expect(idle).toHaveAttribute('data-idle-swing-deg', '2');
    expect(idle).toHaveAttribute('data-idle-max-scale', '1.04');
    expect(idle).toHaveAttribute('data-snap-duration-ms', '480');
    expect(idle).toHaveAttribute('data-peek-duration-ms', '420');
    expect(idle).toHaveAttribute('data-retract-duration-ms', '300');
    expect(idle).toHaveAttribute('data-peek-travel-px', '36');

    await waitFor(() => {
      expect(commandListeners.size).toBeGreaterThan(0);
    });

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'left', epoch: 3 });
      }
    });
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', 'left');
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-snapping', 'true');
    expect(screen.getByTestId('fox-idle')).toHaveClass('is-docked-left');
    const firstToken = Number(screen.getByTestId('fox-idle').getAttribute('data-snap-token'));
    expect(document.querySelector('.fox-head')).toHaveClass('is-snapping-left');

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'left', epoch: 4 });
      }
    });
    const secondToken = Number(screen.getByTestId('fox-idle').getAttribute('data-snap-token'));
    expect(secondToken).toBe(firstToken);
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-snapping', 'false');

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'sync-fox-edge', edge: 'right', epoch: 5 });
      }
    });
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', 'right');
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-snapping', 'false');
    expect(Number(screen.getByTestId('fox-idle').getAttribute('data-snap-token'))).toBe(
      secondToken,
    );

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'none', epoch: 6 });
        listener({ type: 'fox-edge', edge: 'left', epoch: 7 });
      }
    });
    const redockedToken = Number(screen.getByTestId('fox-idle').getAttribute('data-snap-token'));
    expect(redockedToken).toBeGreaterThan(secondToken);

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'right', epoch: 8 });
      }
    });
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-dock-edge', 'right');
    expect(document.querySelector('.fox-head')).toHaveClass('is-snapping-right');
  });

  it('keeps the retract end frame until the native bounds update resolves', async () => {
    vi.useFakeTimers();
    let resolveRetract: (() => void) | undefined;
    try {
      setFoxPeek
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(
          () => new Promise<void>((resolve) => {
            resolveRetract = resolve;
          }),
        );
      render(<FoxApp />);
      const fox = screen.getByTestId('fox-button');
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'left', epoch: 21 });
        }
      });
      fireEvent.pointerEnter(fox);
      fireEvent.pointerLeave(fox);

      act(() => {
        dispatchAnimationEnd(
          document.querySelector('.fox-head') as Element,
          'fox-retract-left',
        );
      });
      expect(setFoxPeek).toHaveBeenLastCalledWith('retract', 21);
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-retracting', 'true');

      await act(async () => {
        resolveRetract?.();
        await Promise.resolve();
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-retracting', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('parks the query DOM after both animated and immediate closes', async () => {
    getWindowContext.mockResolvedValue({
      role: 'query',
      phase: 'SEARCH_INPUT',
      shortcut: {
        registered: true,
        accelerator: 'CommandOrControl+Shift+Space',
        message: '',
      },
      testHarness: false,
    });
    render(<QueryApp />);
    await waitFor(() => {
      expect(commandListeners.size).toBeGreaterThan(0);
    });

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', anchor: 'left', animate: false });
      }
    });
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'collapse', anchor: 'left', dockEdge: 'none', animate: true });
      }
    });
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-closing', 'true');
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-parked', 'false');
    dispatchAnimationEnd(document.querySelector('.glass-shell') as Element, 'query-shell-fold');
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-closing', 'false');
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', anchor: 'right', animate: false });
        listener({ type: 'collapse', anchor: 'right', dockEdge: 'right', animate: false });
      }
    });
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-closing', 'false');
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
  });
});
