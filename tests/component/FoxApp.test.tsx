import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoxApp } from '../../src/renderer/FoxApp';
import { QueryApp } from '../../src/renderer/QueryApp';
import { splitDragDelta } from '../../src/renderer/lib/use-window-drag';
import { FOX_RETRACT_DURATION_MS } from '../../src/shared/fox-motion';
import { FOX_SLEEP_AFTER_MS } from '../../src/shared/fox-presence';
import type { FoxDragSettleAck, OverlayCommand } from '../../src/shared/overlay-events';
import { IDENTITY_FOX_VISUAL_TRANSFORM } from '../../src/shared/overlay-events';

const copyText = vi.fn();
const getPlatform = vi.fn();
const getWindowContext = vi.fn();
const openSearch = vi.fn();
const openDashboard = vi.fn();
const dismiss = vi.fn();
const reportUiPhase = vi.fn();
const moveFoxBy = vi.fn();
const commitFoxDragSettle = vi.fn();
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

function dispatchClientPointer(
  target: Element,
  type: string,
  init: { clientX: number; clientY: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
  });
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
    moveFoxBy.mockResolvedValue(null);
    commitFoxDragSettle.mockReset();
    commitFoxDragSettle.mockResolvedValue(undefined);
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
      commitFoxDragSettle,
      setFoxPeek,
      onOverlayCommand(handler: (command: OverlayCommand) => void) {
        commandListeners.add(handler);
        return () => {
          commandListeners.delete(handler);
        };
      },
    };
  });

  it('uses a purple breathe halo that pauses for warning and handoff', () => {
    render(<FoxApp />);
    const idle = screen.getByTestId('fox-idle');
    expect(idle).toHaveAttribute('data-halo', 'purple-breathe');
    expect(idle).not.toHaveClass('is-halo-paused');

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'shortcut-status',
          registered: false,
          accelerator: 'CommandOrControl+Shift+Space',
          message: '快捷键不可用',
        });
      }
    });
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-halo', 'paused');
    expect(screen.getByTestId('fox-idle')).toHaveClass('is-halo-paused');
    expect(screen.getByTestId('shortcut-fallback-dot')).toBeInTheDocument();
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
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-halo', 'paused');
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'none', epoch: 1 });
      }
    });
    expect(screen.getByTestId('fox-idle')).not.toHaveClass('is-handoff-frozen');
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-halo', 'purple-breathe');
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
      expect(moveFoxBy).toHaveBeenCalledWith(0, 0, true, 1);
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

    expect(moveFoxBy).toHaveBeenCalledWith(6, 0, false, 1);
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

    expect(moveFoxBy).toHaveBeenLastCalledWith(0, 0, true, 1);
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

    expect(moveFoxBy).toHaveBeenLastCalledWith(0, 0, true, 1);
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

    expect(moveFoxBy).toHaveBeenLastCalledWith(0, 0, true, 1);
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

  it.each([
    ['pointercancel', (fox: HTMLElement) => {
      dispatchPointer(fox, 'pointercancel', { pointerId: 19 });
    }],
    ['lostpointercapture', (fox: HTMLElement) => {
      dispatchPointer(fox, 'lostpointercapture', { pointerId: 19 });
    }],
    ['blur', () => {
      window.dispatchEvent(new Event('blur'));
    }],
    ['buttons0', (fox: HTMLElement) => {
      dispatchPointer(fox, 'pointermove', {
        button: 0,
        buttons: 0,
        pointerId: 19,
        screenX: 10,
        screenY: 10,
      });
    }],
  ] as const)(
    'clears a dock drag session after %s before the movement threshold',
    (_reason, finishGesture) => {
      render(<FoxApp />);
      const fox = screen.getByTestId('fox-button');
      const idle = screen.getByTestId('fox-idle');
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'sync-fox-edge', edge: 'left', epoch: 18 });
        }
      });

      dispatchPointer(fox, 'pointerdown', {
        button: 0,
        buttons: 1,
        pointerId: 19,
        screenX: 10,
        screenY: 10,
      });
      expect(idle).toHaveAttribute('data-fox-drag-session', 'left');

      act(() => {
        finishGesture(fox);
      });

      expect(moveFoxBy).not.toHaveBeenCalled();
      expect(idle).toHaveAttribute('data-fox-transient', 'none');
      expect(idle).toHaveAttribute('data-fox-drag-session', 'none');
      expect(idle).toHaveAttribute('data-fox-settling', 'false');
    },
  );

  it('finishes exactly once on pointercancel after the drag threshold and does not open search', () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 27,
      screenX: 20,
      screenY: 20,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 27,
      screenX: 48,
      screenY: 24,
    });
    expect(idle).toHaveAttribute('data-fox-pose', 'dragging');
    expect(moveFoxBy).toHaveBeenCalled();
    const callsAfterMove = moveFoxBy.mock.calls.length;
    dispatchPointer(fox, 'pointercancel', { pointerId: 27 });
    expect(moveFoxBy).toHaveBeenLastCalledWith(0, 0, true, 1);
    expect(moveFoxBy.mock.calls.length).toBe(callsAfterMove + 1);
    expect(openSearch).not.toHaveBeenCalled();
    expect(idle).toHaveAttribute('data-fox-transient', 'none');
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 27,
      screenX: 80,
      screenY: 40,
    });
    expect(moveFoxBy).toHaveBeenCalledTimes(callsAfterMove + 1);
    fireEvent.click(fox, { detail: 1 });
    expect(openSearch).not.toHaveBeenCalled();
  });

  it('recovers a valid late final settle after the visual watchdog without opening Query itself', async () => {
    vi.useFakeTimers();
    let resolveStale: ((ack: FoxDragSettleAck | null) => void) | null = null;
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) return Promise.resolve(null);
      return new Promise<FoxDragSettleAck | null>((resolve) => {
        resolveStale = resolve;
      });
    });
    try {
      render(<FoxApp />);
      const fox = screen.getByTestId('fox-button');
      const idle = screen.getByTestId('fox-idle');
      dispatchPointer(fox, 'pointerdown', {
        button: 0,
        buttons: 1,
        pointerId: 28,
        screenX: 20,
        screenY: 20,
      });
      dispatchPointer(fox, 'pointermove', {
        button: 0,
        buttons: 1,
        pointerId: 28,
        screenX: 50,
        screenY: 28,
      });
      act(() => {
        dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 28, screenX: 50, screenY: 28 });
      });
      expect(idle).toHaveAttribute('data-fox-settling', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(idle).toHaveAttribute('data-fox-settling', 'false');
      await act(async () => {
        resolveStale?.({ edge: 'right', epoch: 44, generation: 1, settleId: 44 });
        await Promise.resolve();
      });
      expect(idle).toHaveAttribute('data-dock-edge', 'right');
      expect(commitFoxDragSettle).toHaveBeenCalledWith(44);
      expect(openSearch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits the buffered normal settle echo when the drag settle watchdog aborts', async () => {
    vi.useFakeTimers();
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) return Promise.resolve(null);
      return new Promise<FoxDragSettleAck | null>(() => undefined);
    });
    try {
      render(<FoxApp />);
      const fox = screen.getByTestId('fox-button');
      const idle = screen.getByTestId('fox-idle');
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'left', epoch: 50 });
        }
      });
      dispatchPointer(fox, 'pointerdown', {
        button: 0,
        buttons: 1,
        pointerId: 29,
        screenX: 20,
        screenY: 20,
      });
      dispatchPointer(fox, 'pointermove', {
        button: 0,
        buttons: 1,
        pointerId: 29,
        screenX: 50,
        screenY: 28,
      });
      act(() => {
        dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 29, screenX: 50, screenY: 28 });
      });
      expect(idle).toHaveAttribute('data-fox-settling', 'true');
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'right', epoch: 51 });
        }
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(idle).toHaveAttribute('data-fox-settling', 'false');
      expect(idle).toHaveAttribute('data-dock-edge', 'right');
      expect(idle.style.getPropertyValue('--fox-session-x')).toBe('');
      expect(commitFoxDragSettle).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits a buffered settle echo before a new pointer generation starts', () => {
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) return Promise.resolve(null);
      return new Promise<FoxDragSettleAck | null>(() => undefined);
    });
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'left', epoch: 60 });
      }
    });
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 30,
      screenX: 20,
      screenY: 20,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 30,
      screenX: 50,
      screenY: 28,
    });
    act(() => {
      dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 30, screenX: 50, screenY: 28 });
    });
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'right', epoch: 61 });
      }
    });
    expect(idle).toHaveAttribute('data-fox-settling', 'true');
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 31,
      screenX: 24,
      screenY: 20,
    });
    expect(idle).toHaveAttribute('data-fox-settling', 'false');
    expect(idle).toHaveAttribute('data-dock-edge', 'right');
    dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 31, screenX: 24, screenY: 20 });
  });

  it('ignores drag A ACK while drag B is settling and only commits drag B', async () => {
    const finishedResolvers: Array<(ack: FoxDragSettleAck | null) => void> = [];
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) return Promise.resolve(null);
      return new Promise<FoxDragSettleAck | null>((resolve) => {
        finishedResolvers.push(resolve);
      });
    });
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');

    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 32,
      screenX: 20,
      screenY: 20,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 32,
      screenX: 50,
      screenY: 28,
    });
    act(() => {
      dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 32, screenX: 50, screenY: 28 });
    });
    expect(finishedResolvers).toHaveLength(1);
    expect(idle).toHaveAttribute('data-fox-settling', 'true');

    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 33,
      screenX: 24,
      screenY: 20,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 33,
      screenX: 58,
      screenY: 26,
    });
    act(() => {
      dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 33, screenX: 58, screenY: 26 });
    });
    expect(finishedResolvers).toHaveLength(2);
    expect(idle).toHaveAttribute('data-fox-settling', 'true');

    await act(async () => {
      finishedResolvers[0]?.({ edge: 'right', epoch: 70, generation: 1, settleId: 70 });
      await Promise.resolve();
    });
    expect(idle).toHaveAttribute('data-fox-settling', 'true');
    expect(idle).toHaveAttribute('data-dock-edge', 'none');
    expect(openSearch).not.toHaveBeenCalled();

    await act(async () => {
      finishedResolvers[1]?.({ edge: 'left', epoch: 71, generation: 2, settleId: 71 });
      await Promise.resolve();
    });
    expect(idle).toHaveAttribute('data-fox-settling', 'false');
    expect(idle).toHaveAttribute('data-dock-edge', 'left');
    expect(commitFoxDragSettle).toHaveBeenCalledTimes(1);
    expect(commitFoxDragSettle).toHaveBeenCalledWith(71);
    expect(openSearch).not.toHaveBeenCalled();
  });

  it('does not let an older fox-edge echo override a newer settle ACK', async () => {
    let resolveAck: ((ack: FoxDragSettleAck | null) => void) | null = null;
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) return Promise.resolve(null);
      return new Promise<FoxDragSettleAck | null>((resolve) => {
        resolveAck = resolve;
      });
    });
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 34,
      screenX: 20,
      screenY: 20,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 34,
      screenX: 50,
      screenY: 28,
    });
    act(() => {
      dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 34, screenX: 50, screenY: 28 });
    });
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'right', epoch: 10 });
      }
    });
    await act(async () => {
      resolveAck?.({ edge: 'left', epoch: 11, generation: 1, settleId: 11 });
      await Promise.resolve();
    });
    expect(idle).toHaveAttribute('data-fox-settling', 'false');
    expect(idle).toHaveAttribute('data-dock-edge', 'left');
  });

  it('keeps buffered sync epochs monotonic and lets the newest sync override an older settle ACK', async () => {
    let resolveAck: ((ack: FoxDragSettleAck | null) => void) | null = null;
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) return Promise.resolve(null);
      return new Promise<FoxDragSettleAck | null>((resolve) => {
        resolveAck = resolve;
      });
    });
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 35,
      screenX: 20,
      screenY: 20,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 35,
      screenX: 50,
      screenY: 28,
    });
    act(() => {
      dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 35, screenX: 50, screenY: 28 });
    });
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'sync-fox-edge', edge: 'right', epoch: 22 });
        listener({ type: 'sync-fox-edge', edge: 'left', epoch: 21 });
      }
    });
    await act(async () => {
      resolveAck?.({ edge: 'left', epoch: 20, generation: 1, settleId: 20 });
      await Promise.resolve();
    });
    expect(idle).toHaveAttribute('data-fox-settling', 'false');
    expect(idle).toHaveAttribute('data-dock-edge', 'right');
    expect(commitFoxDragSettle).toHaveBeenCalledWith(20);
    expect(openSearch).not.toHaveBeenCalled();
  });

  it('uses the final settle command as a watchdog-independent commit path and deduplicates the IPC reply', async () => {
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) return Promise.resolve(null);
      return new Promise<FoxDragSettleAck | null>(() => undefined);
    });
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 36,
      screenX: 20,
      screenY: 20,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 36,
      screenX: 50,
      screenY: 28,
    });
    dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 36, screenX: 50, screenY: 28 });
    expect(idle).toHaveAttribute('data-fox-settling', 'true');

    const finalCommand: OverlayCommand = {
      type: 'fox-drag-settled',
      edge: 'right',
      epoch: 30,
      generation: 1,
      settleId: 30,
    };
    act(() => {
      for (const listener of commandListeners) listener(finalCommand);
      for (const listener of commandListeners) listener(finalCommand);
    });

    await waitFor(() => {
      expect(commitFoxDragSettle).toHaveBeenCalledWith(30);
    });
    expect(commitFoxDragSettle).toHaveBeenCalledTimes(1);
    expect(idle).toHaveAttribute('data-dock-edge', 'right');
    expect(idle).toHaveAttribute('data-fox-settling', 'false');
  });

  it('defers an old final settle across a new no-move pointer generation, then commits after click dispatch', async () => {
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) return Promise.resolve(null);
      return new Promise<FoxDragSettleAck | null>(() => undefined);
    });
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 37,
      screenX: 20,
      screenY: 20,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 37,
      screenX: 50,
      screenY: 28,
    });
    dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 37, screenX: 50, screenY: 28 });

    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 38,
      screenX: 24,
      screenY: 20,
    });
    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'fox-drag-settled',
          edge: 'left',
          epoch: 31,
          generation: 1,
          settleId: 31,
        });
      }
    });
    expect(commitFoxDragSettle).not.toHaveBeenCalled();

    dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 38, screenX: 24, screenY: 20 });
    await waitFor(() => {
      expect(openSearch).toHaveBeenCalledTimes(1);
      expect(commitFoxDragSettle).toHaveBeenCalledWith(31);
    });
  });

  it('invalidates a pending settle on unmount so a late reply cannot commit Main', async () => {
    let resolveFinished: ((ack: FoxDragSettleAck | null) => void) | null = null;
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) return Promise.resolve(null);
      return new Promise<FoxDragSettleAck | null>((resolve) => {
        resolveFinished = resolve;
      });
    });
    const view = render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 39,
      screenX: 20,
      screenY: 20,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 39,
      screenX: 50,
      screenY: 28,
    });
    dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 39, screenX: 50, screenY: 28 });
    view.unmount();

    await act(async () => {
      resolveFinished?.({ edge: 'right', epoch: 32, generation: 1, settleId: 32 });
      await Promise.resolve();
    });
    expect(commitFoxDragSettle).not.toHaveBeenCalled();
  });

  it('does not fall asleep after being hidden and restarts the clock when visible again', () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      render(<FoxApp />);
      const idle = screen.getByTestId('fox-idle');
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      act(() => {
        vi.advanceTimersByTime(14_000);
      });
      expect(idle).toHaveAttribute('data-fox-pose', 'idle');
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(idle).toHaveAttribute('data-fox-pose', 'idle');
      act(() => {
        vi.advanceTimersByTime(8_000);
      });
      expect(idle).toHaveAttribute('data-fox-pose', 'drowsy');
    } finally {
      vi.useRealTimers();
    }
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
    expect(idle).toHaveAttribute('data-dock-ready-travel-px', '3');
    expect(idle).toHaveAttribute('data-dock-ready-rise-px', '2');
    expect(idle).toHaveAttribute('data-dock-ready-tilt-deg', '5');
    expect(idle).toHaveAttribute('data-dock-ready-max-scale', '1.035');
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
        listener({ type: 'collapse', anchor: 'left', dockEdge: 'none', animate: true, handoffCenterX: 44, handoffCenterY: 44 });
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
        listener({ type: 'collapse', anchor: 'right', dockEdge: 'right', animate: false, handoffCenterX: 600, handoffCenterY: 44 });
      }
    });
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-closing', 'false');
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
  });

  it('coalesces local whole-head follow into one rAF and resets on leave', () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 88,
      height: 88,
      top: 0,
      left: 0,
      right: 88,
      bottom: 88,
      toJSON() {
        return {};
      },
    } as DOMRect);

    try {
      render(<FoxApp />);
      const idle = screen.getByTestId('fox-idle');
      expect(idle).toHaveAttribute('data-fox-pose', 'idle');
      expect(idle).toHaveAttribute('data-fox-ambient', 'awake');

      dispatchClientPointer(idle, 'pointermove', { clientX: 72, clientY: 18 });
      dispatchClientPointer(idle, 'pointermove', { clientX: 80, clientY: 8 });
      expect(frames).toHaveLength(1);
      act(() => {
        frames[0](0);
      });
      const followX = Number.parseFloat(idle.style.getPropertyValue('--fox-follow-x'));
      const followRot = Number.parseFloat(idle.style.getPropertyValue('--fox-follow-rot'));
      expect(Math.abs(followX)).toBeLessThanOrEqual(1.75);
      expect(Math.abs(followRot)).toBeLessThanOrEqual(2);
      expect(followX).not.toBe(0);
      expect(idle).toHaveAttribute('data-fox-follow', 'true');
      expect(idle).toHaveAttribute('data-fox-ambient', 'following-local');
      expect(idle).toHaveAttribute('data-fox-pose', 'following-local');
      expect(idle).toHaveAttribute('data-fox-headset-signal', 'true');
      expect(screen.getByTestId('fox-headset-signal')).toHaveAttribute('aria-hidden', 'true');

      fireEvent.pointerLeave(idle);
      expect(frames).toHaveLength(2);
      act(() => {
        frames[1](0);
      });
      expect(idle).toHaveAttribute('data-fox-follow', 'false');
      expect(idle.style.getPropertyValue('--fox-follow-x')).toBe('');
      expect(idle).toHaveAttribute('data-fox-pose', 'idle');
      expect(idle).toHaveAttribute('data-fox-headset-signal', 'false');
      expect(screen.queryByTestId('fox-headset-signal')).toBeNull();
    } finally {
      raf.mockRestore();
    }
  });

  it('walks awake to drowsy to sleeping and cancels stale tokens on activity, fox-edge, open, and unmount', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<FoxApp />);
      const idle = screen.getByTestId('fox-idle');
      expect(idle).toHaveAttribute('data-fox-ambient', 'awake');

      act(() => {
        vi.advanceTimersByTime(7999);
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'awake');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'drowsy');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'drowsy');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-expression', 'drowsy');
      expect(screen.getByTestId('fox-expression-layer')).toHaveAttribute('data-expression-state', 'drowsy');
      expect(screen.getByTestId('fox-expression-awake')).toBeInTheDocument();
      expect(screen.getByTestId('fox-expression-drowsy')).toHaveAttribute('fill', 'none');
      expect(screen.getByTestId('fox-expression-drowsy')).toHaveAttribute('stroke', '#A45C4A');
      expect(screen.getByTestId('fox-expression-drowsy').querySelector('path')?.getAttribute('d') ?? '').toContain('Q29.7 49.35');
      expect(screen.getByTestId('fox-expression-closed')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5999);
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'drowsy');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'sleeping');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'sleeping');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-expression', 'closed');
      expect(screen.getByTestId('fox-expression-layer')).toHaveAttribute('data-expression-state', 'closed');
      expect(screen.getByTestId('fox-expression-closed')).toHaveAttribute('fill', 'none');
      expect(screen.getByTestId('fox-expression-closed')).toHaveAttribute('stroke', '#A45C4A');
      expect(screen.getByTestId('fox-expression-closed-lid')).toHaveAttribute('stroke-width', '1.7');
      expect(screen.getByTestId('fox-expression-closed-lid').getAttribute('d') ?? '').toBe('M25 45.68 Q29.7 50.85 34.4 45.68');
      expect(screen.getByTestId('fox-expression-closed-stem').getAttribute('d') ?? '').toBe('M29.7 48.62 L29.7 51.82');
      expect(screen.getByTestId('fox-expression-layer').querySelector('.fox-expression-cover')).toHaveAttribute('fill', '#F9D6C5');
      expect(screen.getByTestId('fox-sleep-mark')).toHaveTextContent('zZZ');
      expect(screen.queryByTestId('fox-headset-signal')).toBeNull();
      const shadow = screen.getByTestId('fox-ground-shadow');
      const head = document.querySelector('.fox-head');
      expect(head).not.toBeNull();
      expect(head?.contains(shadow)).toBe(false);
      expect(shadow.parentElement).toBe(screen.getByTestId('fox-button'));

      fireEvent.focus(screen.getByTestId('fox-button'));
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'awake');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'idle');
      expect(screen.getByTestId('fox-expression-layer')).toHaveAttribute('data-expression-state', 'awake');

      act(() => {
        vi.advanceTimersByTime(14000);
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'sleeping');

      fireEvent.pointerMove(idle, { clientX: 20, clientY: 20 });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'awake');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'idle');

      act(() => {
        vi.advanceTimersByTime(8000);
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'drowsy');
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'left', epoch: 41 });
        }
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'awake');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'snap');

      fireEvent.pointerDown(screen.getByTestId('fox-button'), {
        button: 0,
        buttons: 1,
        pointerId: 21,
        screenX: 10,
        screenY: 10,
      });
      fireEvent.pointerUp(screen.getByTestId('fox-button'), {
        button: 0,
        pointerId: 21,
        screenX: 10,
        screenY: 10,
      });
      expect(openSearch).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'handoff');

      unmount();
      act(() => {
        vi.advanceTimersByTime(20000);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('consumes a one-shot wake headset pulse when a higher-priority snap interrupts it', async () => {
    vi.useFakeTimers();
    try {
      render(<FoxApp />);
      act(() => {
        vi.advanceTimersByTime(FOX_SLEEP_AFTER_MS);
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'sleeping');

      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'left', epoch: 71 });
        }
      });
      const idle = screen.getByTestId('fox-idle');
      expect(idle).toHaveAttribute('data-fox-structural', 'snap');
      expect(idle).toHaveAttribute('data-fox-headset-signal', 'false');

      const head = document.querySelector('.fox-head');
      expect(head).not.toBeNull();
      await act(async () => {
        dispatchAnimationEnd(head as Element, 'fox-snap-left');
        await Promise.resolve();
      });
      expect(idle).toHaveAttribute('data-fox-structural', 'none');
      expect(idle).toHaveAttribute('data-fox-headset-signal', 'false');
      expect(screen.queryByTestId('fox-headset-signal')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies press then directional drag and a one-shot annoyed-drag without delaying the first open', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');

    fireEvent.pointerDown(fox, {
      button: 0,
      buttons: 1,
      pointerId: 31,
      screenX: 10,
      screenY: 10,
    });
    expect(idle).toHaveAttribute('data-fox-transient', 'pressed');
    expect(idle).toHaveAttribute('data-fox-pose', 'pressed');

    fireEvent.pointerUp(fox, {
      button: 0,
      pointerId: 31,
      screenX: 10,
      screenY: 10,
    });
    await waitFor(() => {
      expect(openSearch).toHaveBeenCalledTimes(1);
    });

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'sync-fox-edge', edge: 'left', epoch: 50 });
      }
    });
    openSearch.mockClear();

    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 32,
      screenX: 10,
      screenY: 10,
    });
    expect(idle).toHaveAttribute('data-fox-transient', 'pressed');
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 32,
      screenX: 12,
      screenY: 10,
    });
    expect(idle).toHaveAttribute('data-fox-transient', 'pressed');
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 32,
      screenX: 48,
      screenY: 8,
    });
    expect(idle).toHaveAttribute('data-fox-transient', 'dragging');
    expect(idle).toHaveAttribute('data-fox-pose', 'dragging');
    expect(idle).toHaveAttribute('data-fox-expression', 'strained');
    expect(screen.getByTestId('fox-expression-layer')).toHaveAttribute('data-expression-state', 'strained');
    expect(screen.getByTestId('fox-expression-strained')).toHaveAttribute('stroke', '#A45C4A');
    expect(screen.queryByTestId('fox-headset-signal')).toBeNull();
    act(() => {
      frames.at(-1)?.(0);
    });
    expect(Number.parseFloat(idle.style.getPropertyValue('--fox-drag-rot'))).toBeGreaterThan(0);
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'none', epoch: 51 });
      }
    });
    expect(idle).toHaveAttribute('data-fox-transient', 'dragging');
    expect(idle).toHaveAttribute('data-fox-pose', 'dragging');
    expect(idle.style.getPropertyValue('--fox-drag-rot')).not.toBe('');

    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 32,
      screenX: 220,
      screenY: 8,
    });
    expect(idle).toHaveAttribute('data-fox-transient', 'annoyed-drag');
    expect(idle).toHaveAttribute('data-fox-pose', 'annoyed-drag');
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'sync-fox-edge', edge: 'none', epoch: 52 });
      }
    });
    expect(idle).toHaveAttribute('data-fox-transient', 'annoyed-drag');
    expect(idle).toHaveAttribute('data-fox-drag-session', 'left');
    dispatchPointer(fox, 'pointerup', {
      button: 0,
      pointerId: 32,
      screenX: 220,
      screenY: 8,
    });
    expect(openSearch).not.toHaveBeenCalled();
    expect(idle).toHaveAttribute('data-fox-transient', 'none');
  });

  it('enters annoyed-drag while held still and cancels the one-shot timer on release', () => {
    vi.useFakeTimers();
    try {
      render(<FoxApp />);
      const fox = screen.getByTestId('fox-button');
      const idle = screen.getByTestId('fox-idle');

      dispatchPointer(fox, 'pointerdown', {
        button: 0,
        buttons: 1,
        pointerId: 33,
        screenX: 10,
        screenY: 10,
      });
      dispatchPointer(fox, 'pointermove', {
        button: 0,
        buttons: 1,
        pointerId: 33,
        screenX: 30,
        screenY: 10,
      });
      expect(idle).toHaveAttribute('data-fox-transient', 'dragging');

      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(idle).toHaveAttribute('data-fox-transient', 'annoyed-drag');

      dispatchPointer(fox, 'pointerup', {
        button: 0,
        pointerId: 33,
        screenX: 30,
        screenY: 10,
      });
      expect(idle).toHaveAttribute('data-fox-transient', 'none');
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(idle).toHaveAttribute('data-fox-transient', 'none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops follow and drag wobble immediately when reduced motion turns on', () => {
    let matches = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        get matches() {
          return matches;
        },
        addEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) {
          listeners.add(listener);
        },
        removeEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) {
          listeners.delete(listener);
        },
      })),
    });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 88,
      height: 88,
      top: 0,
      left: 0,
      right: 88,
      bottom: 88,
      toJSON() {
        return {};
      },
    } as DOMRect);

    try {
      render(<FoxApp />);
      const idle = screen.getByTestId('fox-idle');
      dispatchClientPointer(idle, 'pointermove', { clientX: 80, clientY: 10 });
      act(() => {
        frames[0]?.(0);
      });
      expect(idle).toHaveAttribute('data-fox-follow', 'true');

      matches = true;
      act(() => {
        for (const listener of listeners) {
          listener({ matches: true } as MediaQueryListEvent);
        }
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'static');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-follow', 'false');
      expect(screen.getByTestId('fox-idle').style.getPropertyValue('--fox-follow-x')).toBe('');
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it('keeps a static closed eye and Z sleep state, then wakes into semantic drag under reduced motion', () => {
    vi.useFakeTimers();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    try {
      render(<FoxApp />);
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'static');
      act(() => {
        vi.advanceTimersByTime(FOX_SLEEP_AFTER_MS);
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-pose', 'sleeping');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-expression', 'closed');
      expect(screen.getByTestId('fox-expression-layer')).toHaveAttribute('data-expression-state', 'closed');
      expect(screen.getByTestId('fox-expression-closed')).toBeInTheDocument();
      expect(screen.getByTestId('fox-sleep-mark')).toHaveTextContent('zZZ');
      expect(screen.queryByTestId('fox-headset-signal')).toBeNull();
      const fox = screen.getByTestId('fox-button');
      dispatchPointer(fox, 'pointerdown', {
        button: 0,
        buttons: 1,
        pointerId: 64,
        screenX: 20,
        screenY: 20,
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-ambient', 'awake');
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-transient', 'pressed');
      dispatchPointer(fox, 'pointermove', {
        button: 0,
        buttons: 1,
        pointerId: 64,
        screenX: 36,
        screenY: 20,
      });
      expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-transient', 'dragging');
      expect(screen.getByTestId('fox-idle').style.getPropertyValue('--fox-drag-rot')).toBe('');
      dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 64, screenX: 36, screenY: 20 });
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
      vi.useRealTimers();
    }
  });

  it('drops the rectangular fox outline on pointer drag and keeps a non-rect keyboard focus ring', () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    const ring = screen.getByTestId('fox-focus-ring');
    expect(fox).toHaveClass('fox-button');
    expect(fox.style.outline).toBe('');
    expect(ring).toBeInTheDocument();

    fireEvent.focus(fox);
    expect(idle).toHaveAttribute('data-fox-keyboard-focus', 'false');

    const matchesSpy = vi.spyOn(fox, 'matches').mockImplementation((selector: string) => selector === ':focus-visible');
    fireEvent.focus(fox);
    expect(idle).toHaveAttribute('data-fox-keyboard-focus', 'true');

    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 71,
      screenX: 40,
      screenY: 40,
    });
    expect(idle).toHaveAttribute('data-fox-keyboard-focus', 'false');
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 71,
      screenX: 80,
      screenY: 44,
    });
    expect(idle).toHaveAttribute('data-fox-pose', 'dragging');
    expect(idle).toHaveAttribute('data-fox-keyboard-focus', 'false');
    expect(fox.style.outline).toBe('');
    expect(ring).toHaveAttribute('aria-hidden', 'true');
    dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 71, screenX: 80, screenY: 44 });
    matchesSpy.mockRestore();
  });

  it('keeps a single canonical fox image without visor slits or white glints', () => {
    const { unmount } = render(<FoxApp />);
    expect(document.querySelector('.fox-head-image')).toBeInTheDocument();
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-fox-expression', 'none');
    expect(screen.getByTestId('fox-expression-layer')).toHaveAttribute('data-expression-state', 'awake');
    expect(screen.getByTestId('fox-expression-awake')).toHaveAttribute('fill', '#A45C4A');
    expect(screen.getByTestId('fox-expression-awake').querySelector('ellipse')).toBeNull();
    expect(screen.getByTestId('fox-expression-layer').querySelector('.fox-expression-cover')).toHaveAttribute('fill', '#F9D6C5');
    expect(screen.queryByTestId('fox-headset-signal')).toBeNull();
    expect(document.querySelector('[data-testid="fox-visor-layer"]')).toBeNull();
    expect(document.querySelector('[data-testid="fox-eye-slit-left"]')).toBeNull();
    expect(document.querySelector('[data-testid="fox-eye-glint-left"]')).toBeNull();
    expect(screen.getByTestId('fox-idle')).not.toHaveAttribute('data-eye-follow-max-px');
    expect(screen.getByTestId('fox-idle')).toHaveAttribute('data-settle-watchdog-ms', '1600');
    unmount();

    render(<QueryApp />);
    expect(document.querySelector('.fox-head-image')).toBeInTheDocument();
    expect(screen.getByTestId('fox-expression-layer')).toHaveAttribute('data-expression-state', 'awake');
    expect(screen.getByTestId('fox-expression-awake')).toHaveAttribute('fill', '#A45C4A');
    expect(screen.queryByTestId('fox-headset-signal')).toBeNull();
    expect(document.querySelector('[data-testid="fox-visor-layer"]')).toBeNull();
    expect(document.querySelector('[data-testid="fox-eye-slit-left"]')).toBeNull();
  });

  it('starts a docked session from pointerdown and keeps net-outward gestures docked', () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'left', epoch: 80 });
      }
    });
    expect(idle).toHaveAttribute('data-dock-edge', 'left');

    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 72,
      screenX: 40,
      screenY: 80,
    });
    expect(idle).toHaveAttribute('data-fox-drag-session', 'left');
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 72,
      screenX: 20,
      screenY: 100,
    });
    expect(idle).toHaveAttribute('data-dock-edge', 'left');
    expect(idle).toHaveAttribute('data-fox-drag-session', 'left');
    expect(idle).toHaveClass('is-docked-left');
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 72,
      screenX: 30,
      screenY: 100,
    });
    expect(idle).toHaveAttribute('data-dock-edge', 'left');
    expect(idle).toHaveClass('is-docked-left');
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 72,
      screenX: 50,
      screenY: 100,
    });
    expect(idle).toHaveAttribute('data-dock-edge', 'none');
    expect(idle).toHaveAttribute('data-fox-drag-session', 'left');
    expect(Number.parseFloat(idle.style.getPropertyValue('--fox-session-x'))).toBeLessThan(0);
    expect(moveFoxBy).toHaveBeenCalled();
    dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 72, screenX: 50, screenY: 100 });
  });

  it('atomically undocks an inward drag and compensates the head without a peek-zero hop', () => {
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'left', epoch: 81 });
      }
    });
    expect(idle).toHaveAttribute('data-peeking', 'false');

    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 73,
      screenX: 20,
      screenY: 80,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 73,
      screenX: 36,
      screenY: 80,
    });
    expect(idle).toHaveAttribute('data-dock-edge', 'none');
    expect(idle).toHaveAttribute('data-peeking', 'false');
    expect(idle).toHaveAttribute('data-retracting', 'false');
    expect(idle).toHaveAttribute('data-fox-drag-session', 'left');
    expect(idle).toHaveAttribute('data-fox-peek-armed', 'false');
    expect(Number.parseFloat(idle.style.getPropertyValue('--fox-session-x'))).toBeLessThan(0);
    dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 73, screenX: 36, screenY: 80 });
  });

  it('does not peek after snap or drag until pointerleave then enter', async () => {
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) =>
      Promise.resolve(finished
        ? { edge: 'left', epoch: 83, generation: 1, settleId: 83 }
        : null));
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'left', epoch: 82 });
      }
    });
    fireEvent.pointerEnter(fox);
    expect(idle).toHaveAttribute('data-peeking', 'true');
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 74,
      screenX: 20,
      screenY: 80,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 74,
      screenX: 48,
      screenY: 80,
    });
    expect(idle).toHaveAttribute('data-fox-peek-armed', 'false');
    fireEvent.pointerEnter(fox);
    expect(idle).toHaveAttribute('data-peeking', 'false');
    dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 74, screenX: 48, screenY: 80 });
    await waitFor(() => {
      expect(idle).toHaveAttribute('data-fox-settling', 'false');
    });
    fireEvent.pointerEnter(fox);
    expect(idle).toHaveAttribute('data-peeking', 'false');
    fireEvent.pointerLeave(fox);
    expect(idle).toHaveAttribute('data-fox-peek-armed', 'true');
    fireEvent.pointerEnter(fox);
    expect(idle).toHaveAttribute('data-peeking', 'true');
  });

  it('resets visor offsets before opening search so the handoff first frame stays centered', async () => {
    render(<FoxApp />);
    const idle = screen.getByTestId('fox-idle');
    idle.style.setProperty('--fox-session-x', '-34.00px');
    fireEvent.click(screen.getByTestId('fox-button'));
    await waitFor(() => {
      expect(openSearch).toHaveBeenCalledTimes(1);
    });
    expect(idle.style.getPropertyValue('--fox-session-x')).toBe('');
    expect(idle).toHaveAttribute('data-fox-settling', 'false');
    expect(idle).toHaveClass('is-handoff-frozen');
    const transform = openSearch.mock.calls[0]?.[0];
    expect(transform).toMatchObject({
      a: expect.any(Number),
      b: expect.any(Number),
      c: expect.any(Number),
      d: expect.any(Number),
      e: expect.any(Number),
      f: expect.any(Number),
    });
  });

  it('keeps session compensation across pointerup and late move echoes until the settle ack', async () => {
    let resolveFinished: ((ack: FoxDragSettleAck | null) => void) | null = null;
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) {
        return Promise.resolve(null);
      }
      return new Promise<FoxDragSettleAck | null>((resolve) => {
        resolveFinished = resolve;
      });
    });
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    const ring = screen.getByTestId('fox-focus-ring');
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'left', epoch: 90 });
      }
    });
    const matchesSpy = vi.spyOn(fox, 'matches').mockImplementation((selector: string) => selector === ':focus-visible');
    fireEvent.focus(fox);
    expect(idle).toHaveAttribute('data-fox-keyboard-focus', 'true');
    Object.defineProperty(ring, 'isConnected', { configurable: true, value: true });
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 91,
      screenX: 20,
      screenY: 80,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 91,
      screenX: 26,
      screenY: 80,
    });
    expect(idle).toHaveAttribute('data-dock-edge', 'none');
    const sessionBeforeUp = idle.style.getPropertyValue('--fox-session-x');
    expect(Number.parseFloat(sessionBeforeUp)).toBeLessThan(0);
    dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 91, screenX: 26, screenY: 80 });
    expect(idle).toHaveAttribute('data-fox-settling', 'true');
    expect(idle.style.getPropertyValue('--fox-session-x')).toBe(sessionBeforeUp);
    expect(idle).toHaveAttribute('data-fox-drag-session', 'left');
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'none', epoch: 91 });
      }
    });
    expect(idle).toHaveAttribute('data-fox-settling', 'true');
    expect(idle.style.getPropertyValue('--fox-session-x')).toBe(sessionBeforeUp);
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'sync-fox-edge', edge: 'right', epoch: 92 });
      }
    });
    expect(idle).toHaveAttribute('data-fox-settling', 'true');
    expect(idle.style.getPropertyValue('--fox-session-x')).toBe(sessionBeforeUp);
    act(() => {
      resolveFinished?.({ edge: 'left', epoch: 93, generation: 1, settleId: 93 });
    });
    await waitFor(() => {
      expect(idle).toHaveAttribute('data-fox-settling', 'false');
    });
    expect(idle.style.getPropertyValue('--fox-session-x')).toBe('');
    expect(idle).toHaveAttribute('data-dock-edge', 'left');
    matchesSpy.mockRestore();
  });

  it('commits the dock drag final frame to Main without opening Query in Renderer', async () => {
    let resolveFinished: ((ack: FoxDragSettleAck | null) => void) | null = null;
    moveFoxBy.mockImplementation((_dx: number, _dy: number, finished: boolean) => {
      if (!finished) {
        return Promise.resolve(null);
      }
      return new Promise<FoxDragSettleAck | null>((resolve) => {
        resolveFinished = resolve;
      });
    });
    render(<FoxApp />);
    const fox = screen.getByTestId('fox-button');
    const idle = screen.getByTestId('fox-idle');
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'fox-edge', edge: 'left', epoch: 94 });
      }
    });
    dispatchPointer(fox, 'pointerdown', {
      button: 0,
      buttons: 1,
      pointerId: 94,
      screenX: 20,
      screenY: 80,
    });
    dispatchPointer(fox, 'pointermove', {
      button: 0,
      buttons: 1,
      pointerId: 94,
      screenX: 30,
      screenY: 80,
    });
    dispatchPointer(fox, 'pointerup', {
      button: 0,
      pointerId: 94,
      screenX: 30,
      screenY: 80,
    });
    expect(openSearch).not.toHaveBeenCalled();
    expect(idle).toHaveAttribute('data-fox-settling', 'true');
    act(() => {
      resolveFinished?.({ edge: 'left', epoch: 95, generation: 1, settleId: 95 });
    });
    await waitFor(() => {
      expect(commitFoxDragSettle).toHaveBeenCalledWith(95);
    });
    expect(idle).toHaveAttribute('data-fox-settling', 'false');
    expect(openSearch).not.toHaveBeenCalled();
    expect(idle).not.toHaveClass('is-handoff-frozen');
  });

  it('preserves an active reduced-motion drag session across an edge-none echo', () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: String(query).includes('prefers-reduced-motion'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    try {
      render(<FoxApp />);
      const fox = screen.getByTestId('fox-button');
      const idle = screen.getByTestId('fox-idle');
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'left', epoch: 92 });
        }
      });
      dispatchPointer(fox, 'pointerdown', {
        button: 0,
        buttons: 1,
        pointerId: 92,
        screenX: 20,
        screenY: 80,
      });
      dispatchPointer(fox, 'pointermove', {
        button: 0,
        buttons: 1,
        pointerId: 92,
        screenX: 48,
        screenY: 80,
      });
      expect(idle).toHaveAttribute('data-fox-transient', 'dragging');
      expect(idle).toHaveAttribute('data-fox-drag-session', 'left');
      expect(idle).toHaveAttribute('data-dock-edge', 'none');
      const sessionX = idle.style.getPropertyValue('--fox-session-x');
      expect(Number.parseFloat(sessionX)).toBeLessThan(0);
      expect(idle.style.getPropertyValue('--fox-drag-rot')).toBe('');
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'fox-edge', edge: 'none', epoch: 93 });
        }
      });
      expect(idle).toHaveAttribute('data-fox-drag-session', 'left');
      expect(idle.style.getPropertyValue('--fox-session-x')).toBe(sessionX);
      dispatchPointer(fox, 'pointerup', { button: 0, pointerId: 92, screenX: 48, screenY: 80 });
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });
});
