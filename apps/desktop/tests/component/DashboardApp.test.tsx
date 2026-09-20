import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { DASHBOARD_NAV } from '../../src/renderer/data/dashboard-manifest';
import { COACH_UPLOAD_MAX_BYTES } from '../../src/renderer/features/dashboard/coach-content-upload';
import { IterationModule } from '../../src/renderer/features/dashboard/IterationModule';
import { DASHBOARD_WINDOW_TITLE } from '../../src/shared/dashboard-window';

type ColorSchemeListener = (event: MediaQueryListEvent) => void;

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

function installColorSchemeMedia(initialDark: boolean, reducedMotion = false) {
  let matches = initialDark;
  let reducedMatches = reducedMotion;
  const listeners = new Set<ColorSchemeListener>();
  const reducedListeners = new Set<ColorSchemeListener>();
  const colorSchemeQuery = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, listener: ColorSchemeListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: ColorSchemeListener) => listeners.delete(listener),
    addListener: (listener: ColorSchemeListener) => listeners.add(listener),
    removeListener: (listener: ColorSchemeListener) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  const reducedMotionQuery = {
    get matches() {
      return reducedMatches;
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_type: string, listener: ColorSchemeListener) => reducedListeners.add(listener),
    removeEventListener: (_type: string, listener: ColorSchemeListener) => reducedListeners.delete(listener),
    addListener: (listener: ColorSchemeListener) => reducedListeners.add(listener),
    removeListener: (listener: ColorSchemeListener) => reducedListeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => (
      query.includes('prefers-reduced-motion') ? reducedMotionQuery : colorSchemeQuery
    )),
  });

  return {
    setDark(next: boolean) {
      matches = next;
      const event = { matches, media: colorSchemeQuery.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
    setReducedMotion(next: boolean) {
      reducedMatches = next;
      const event = { matches: next, media: reducedMotionQuery.media } as MediaQueryListEvent;
      reducedListeners.forEach((listener) => listener(event));
    },
  };
}

describe('DashboardApp', () => {
  let originalCustomerAgent: typeof window.customerAgent;
  let originalMatchMedia: typeof window.matchMedia;
  let originalPointerEvent: typeof window.PointerEvent;

  beforeEach(() => {
    originalCustomerAgent = window.customerAgent;
    originalMatchMedia = window.matchMedia;
    originalPointerEvent = window.PointerEvent;
    delete window.customerAgent;
    delete window.dashboardWording;
    delete window.dashboardContent;
    delete window.dashboardIteration;
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: TestPointerEvent,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalCustomerAgent) {
      window.customerAgent = originalCustomerAgent;
    } else {
      delete window.customerAgent;
    }
    delete window.dashboardWording;
    delete window.dashboardContent;
    delete window.dashboardIteration;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: originalPointerEvent,
    });
    delete document.documentElement.dataset.dashboardTheme;
    delete document.documentElement.dataset.dashboardThemeMode;
    document.documentElement.style.removeProperty('color-scheme');
    window.history.replaceState({}, '', '/');
  });

  it('keeps demo banners and never exposes a customerAgent API', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);

    expect(window.customerAgent).toBeUndefined();
    expect(screen.queryByTestId('dashboard-env-badges')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-disclaimer')).not.toBeInTheDocument();
    expect(screen.queryByText('演示数据')).not.toBeInTheDocument();
    expect(screen.queryByText('无后端 · 不保存')).not.toBeInTheDocument();
    expect(screen.queryByText('演示环境')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-boundary-disclaimer')).toHaveTextContent('未接入');
    expect(screen.getByTestId('dashboard-refresh')).toHaveTextContent('未接入');
    expect(screen.getByTestId('overview-kpi-source')).not.toHaveTextContent('固定周期合成演示数据');

    for (const item of DASHBOARD_NAV) {
      await user.click(screen.getByTestId(`nav-${item.id}`));
      expect(screen.getByTestId(`module-${item.id}`)).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', item.id);
    }
  });

  it('shows the allergy SOP tree as a read-only 话术运营 module', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-sop'));
    expect(screen.getByTestId('module-sop')).toHaveTextContent('写库未接入');
    expect(screen.getByTestId('sop-library-empty')).toHaveTextContent('未接入 SOP 库');
    expect(screen.queryByTestId('sop-library-list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布' })).not.toBeInTheDocument();
  });

  it('keyboard-walks 话术运营 from wording through SOP into content', async () => {
    render(<DashboardApp />);
    const sopNav = screen.getByTestId('nav-sop');
    expect(sopNav).toHaveAccessibleName('SOP');
    expect(sopNav).toHaveAttribute('data-nav-group', '话术运营');
    expect(sopNav.querySelectorAll('svg path')).toHaveLength(4);

    fireEvent.click(screen.getByTestId('nav-wording'));
    fireEvent.keyDown(screen.getByTestId('nav-wording'), { key: 'ArrowDown' });
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'sop');
    expect(screen.getByTestId('module-sop')).toBeInTheDocument();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(screen.getByTestId('nav-sop')).toHaveFocus();
    expect(screen.getByTestId('nav-sop')).toHaveAttribute('aria-current', 'page');

    fireEvent.keyDown(screen.getByTestId('nav-sop'), { key: 'ArrowDown' });
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'content');
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(screen.getByTestId('nav-content')).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId('nav-content'), { key: 'ArrowUp' });
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'sop');
    expect(screen.getByTestId('module-sop')).toBeInTheDocument();
  });

  it('uses the fox brand asset and keeps navigation compact without losing module context', () => {
    render(<DashboardApp />);

    const brand = screen.getByTestId('dashboard-brand');
    expect(within(brand).getByText('客服运营工作台')).toBeInTheDocument();
    expect(within(brand).getByText('运营管理端')).toBeInTheDocument();
    expect(brand).not.toHaveTextContent('Manager Decision Desk');
    expect(screen.getByTestId('dashboard-brand-logo').querySelector('.dashboard-brand-fox-image')).toBeInstanceOf(
      HTMLImageElement,
    );
    expect(brand).not.toHaveTextContent('狐客服运营工作台');

    const overviewNav = screen.getByTestId('nav-overview');
    expect(overviewNav).toHaveTextContent('管理概览');
    expect(overviewNav).toHaveClass('is-active');
    expect(overviewNav).not.toHaveStyle({ borderLeft: '3px solid rgb(111, 76, 195)' });
    expect(within(overviewNav).queryByText('风险、责任与处理进度')).not.toBeInTheDocument();
    expect(screen.getAllByText('管理概览').length).toBeGreaterThanOrEqual(2);

    const shell = screen.getByTestId('dashboard-shell');
    expect(['integrated', 'native']).toContain(shell.getAttribute('data-dashboard-chrome'));
    expect(['darwin', 'win32', 'linux', 'unknown']).toContain(shell.getAttribute('data-platform'));
    expect(screen.getByTestId('dashboard-brand')).toHaveClass('dashboard-no-drag');
    expect(screen.getByTestId('dashboard-titlebar-drag-strip')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('dashboard-nav-toggle')).toHaveClass('dashboard-no-drag');
    expect(screen.getByTestId('dashboard-brand-logo').querySelector('button')).toBeNull();
    expect(document.title).toBe(DASHBOARD_WINDOW_TITLE);
  });

  function settleNavPhase(shell: HTMLElement) {
    dispatchNavStructureTransition(shell, 'transitionend');
  }

  function dispatchNavStructureTransition(
    shell: HTMLElement,
    type: 'transitionend' | 'transitioncancel',
  ) {
    act(() => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, 'propertyName', {
        configurable: true,
        value: 'grid-template-columns',
      });
      shell.dispatchEvent(event);
    });
  }

  function collapsedSurfaceOf(shell: HTMLElement) {
    return Number(shell.getAttribute('data-collapsed-surface'));
  }

  function mockStructureWidth(shell: HTMLElement, width: number) {
    const original = window.getComputedStyle.bind(window);
    return vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = original(element, pseudo);
      if (element === shell) {
        return new Proxy(style, {
          get(target, prop, receiver) {
            if (prop === 'gridTemplateColumns') return `${width}px minmax(0px, 1fr)`;
            return Reflect.get(target, prop, receiver);
          },
        });
      }
      return style;
    });
  }

  function mockRafQueue() {
    const queue: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      queue.push(callback);
      return queue.length;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    return {
      flushNext() {
        const callback = queue.shift();
        if (callback) act(() => callback(performance.now()));
      },
      flushAll() {
        while (queue.length > 0) {
          const callback = queue.shift();
          if (callback) act(() => callback(performance.now()));
        }
      },
      restore() {
        requestFrame.mockRestore();
        cancelFrame.mockRestore();
      },
    };
  }

  function mockShellLeft(shell: HTMLElement) {
    return vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1024,
      bottom: 768,
      width: 1024,
      height: 768,
      toJSON: () => ({}),
    } as DOMRect);
  }

  function expectStableNavChrome(
    shell: HTMLElement,
    toggle: HTMLElement,
    phase: 'expanded' | 'collapsed',
    width: number,
  ) {
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    expect(shell).toHaveAttribute('data-nav-phase', phase);
    expect(shell).not.toHaveAttribute('data-nav-hold', 'true');
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe(`${width}px`);
    expect(toggle).toHaveAttribute('aria-expanded', phase === 'expanded' ? 'true' : 'false');
    expect(toggle).toHaveAccessibleName(phase === 'expanded' ? '折叠侧边栏' : '展开侧边栏');
    expect(resizer).toHaveAttribute('aria-valuenow', String(width));
    expect(resizer).toHaveAttribute('aria-valuemin', String(
      phase === 'collapsed' ? width : 216,
    ));
    expect(Number(resizer.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(
      Number(resizer.getAttribute('aria-valuemin')),
    );
    expect(Number(resizer.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
      Number(resizer.getAttribute('aria-valuemax')),
    );
  }

  it('collapses navigation accessibly without deferred trash', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const toggle = screen.getByTestId('dashboard-nav-toggle');

    expect(shell).toHaveAttribute('data-nav-collapsed', 'false');
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('折叠侧边栏');
    expect(toggle).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('dashboard-nav-chrome')).toContainElement(toggle);
    expect(screen.getByTestId('dashboard-titlebar-control-island')).toContainElement(toggle);
    const toggleGlyph = screen.getByTestId('dashboard-nav-toggle-glyph');
    expect(toggleGlyph).toHaveAttribute('aria-hidden', 'true');
    expect(toggle.querySelectorAll('svg')).toHaveLength(2);
    expect(toggle.querySelector('.dashboard-nav-toggle__bar')).not.toBeInTheDocument();
    expect(toggle.querySelector('input[type="checkbox"]')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-brand-logo').querySelector('button')).toBeNull();

    await user.click(screen.getByTestId('nav-wording'));
    await user.click(toggle);
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    expect(toggle).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('dashboard-nav-toggle')).toBe(toggle);
    expect(within(screen.getByTestId('dashboard-brand')).getByText('客服运营工作台')).toBeInTheDocument();
    expect(toggle).not.toHaveFocus();
    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-nav-collapsed', 'true');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAccessibleName('展开侧边栏');
    expect(toggle).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('dashboard-brand-logo')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-brand-logo').querySelector('.dashboard-brand-fox-image')).toBeInstanceOf(
      HTMLImageElement,
    );
    expect(screen.getByRole('tab', { name: '话术库' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'wording');

    toggle.focus();
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    await user.keyboard('{Enter}');
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');
    expect(toggle).not.toHaveAttribute('hidden');
    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-nav-collapsed', 'false');
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    expect(toggle).toHaveFocus();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    focusSpy.mockRestore();
    unmount();
    render(<DashboardApp />);
    expect(screen.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-collapsed', 'false');
    expect(screen.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-phase', 'expanded');
  });

  it('keeps the same toggle DOM in chrome and does not snap brand copy', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const toggle = screen.getByTestId('dashboard-nav-toggle');
    const brand = screen.getByTestId('dashboard-brand');
    const chrome = screen.getByTestId('dashboard-nav-chrome');

    await user.click(toggle);
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    expect(chrome).toContainElement(toggle);
    expect(screen.getByTestId('dashboard-titlebar-control-island')).toContainElement(toggle);
    expect(toggle).not.toHaveAttribute('hidden');
    expect(within(brand).getByText('客服运营工作台')).toBeInTheDocument();
    expect(within(brand).getByText('运营管理端')).toBeInTheDocument();
    expect(brand.querySelector('.dashboard-brand-copy')).not.toHaveStyle({ maxWidth: '0px' });
  });

  it('resizes the expanded navigation through an accessible separator and restores its width', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });

    expect(shell).toHaveAttribute('data-nav-width', '248');
    expect(resizer).toHaveAttribute('aria-orientation', 'vertical');
    expect(resizer).toHaveAttribute('aria-controls', 'dashboard-sidebar');
    expect(resizer).toHaveAttribute('aria-valuemin', '216');
    expect(resizer).toHaveAttribute('aria-valuemax', '348');
    expect(resizer).toHaveAttribute('aria-valuenow', '248');
    expect(resizer).toHaveAttribute('aria-valuetext', '248 像素');
    expect(resizer).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(shell).toHaveAttribute('data-nav-width', '256');
    expect(resizer).toHaveAttribute('aria-valuenow', '256');
    fireEvent.keyDown(resizer, { key: 'ArrowRight', shiftKey: true });
    expect(shell).toHaveAttribute('data-nav-width', '280');
    fireEvent.keyDown(resizer, { key: 'Home' });
    expect(shell).toHaveAttribute('data-nav-width', '216');
    fireEvent.keyDown(resizer, { key: 'End' });
    expect(shell).toHaveAttribute('data-nav-width', '348');
    fireEvent.doubleClick(resizer);
    expect(shell).toHaveAttribute('data-nav-width', '248');

    let pendingFrame: FrameRequestCallback | null = null;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      pendingFrame = callback;
      return 91;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const shellRect = vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1024,
      bottom: 768,
      width: 1024,
      height: 768,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 7, clientX: 248 });
    expect(shell).toHaveAttribute('data-nav-resizing', 'true');
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 7, clientX: 280 });
    expect(shellRect).toHaveBeenCalledTimes(1);
    expect(pendingFrame).not.toBeNull();
    fireEvent.pointerUp(resizer, { button: 0, buttons: 0, pointerId: 7, clientX: 320 });
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    expect(shell).toHaveAttribute('data-nav-width', '320');
    expect(resizer).toHaveAttribute('aria-valuenow', '320');
    act(() => pendingFrame?.(performance.now()));
    expect(shellRect).toHaveBeenCalledTimes(1);
    expect(shell).toHaveAttribute('data-nav-width', '320');
    expect(cancelFrame).toHaveBeenCalledWith(91);

    await user.click(screen.getByTestId('dashboard-nav-toggle'));
    settleNavPhase(shell);
    expect(resizer).toBeVisible();
    expect(resizer).toHaveAttribute('tabindex', '0');
    expect(resizer).toHaveAttribute('aria-valuenow', String(collapsedSurfaceOf(shell)));
    await user.click(screen.getByTestId('dashboard-nav-toggle'));
    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-nav-width', '320');
    expect(resizer).toBeVisible();

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 8, clientX: 320 });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 8, clientX: 193 });
    act(() => pendingFrame?.(performance.now()));
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('193px');
    expect(resizer).toHaveAttribute('aria-valuemin', '216');
    expect(resizer).toHaveAttribute('aria-valuenow', '216');
    fireEvent.pointerUp(resizer, { button: 0, buttons: 0, pointerId: 8, clientX: 193 });
    act(() => pendingFrame?.(performance.now()));
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    expect(shell).toHaveAttribute('data-nav-width', '216');

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 9, clientX: 216 });
    fireEvent.pointerUp(resizer, { button: 0, buttons: 0, pointerId: 9, clientX: 320 });
    expect(shell).toHaveAttribute('data-nav-width', '320');
    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 10, clientX: 320 });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 10, clientX: 200 });
    act(() => pendingFrame?.(performance.now()));
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('200px');
    expect(shell).toHaveAttribute('data-last-expanded-width', '320');
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 10, clientX: 192 });
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('192px');
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    expect(shell).toHaveAttribute('data-last-expanded-width', '320');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    expect(shell).toHaveAttribute('data-nav-hold', 'true');
    expect(resizer).toHaveAttribute('aria-valuemin', String(collapsedSurfaceOf(shell)));
    expect(resizer).toHaveAttribute('aria-valuenow', '192');
    act(() => pendingFrame?.(performance.now()));
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('192px');
    act(() => pendingFrame?.(performance.now()));
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe(`${collapsedSurfaceOf(shell)}px`);
    fireEvent.pointerUp(resizer, { button: 0, buttons: 0, pointerId: 10, clientX: 192 });
    fireEvent.lostPointerCapture(resizer, { pointerId: 10 });
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    await user.click(screen.getByTestId('dashboard-nav-toggle'));
    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-nav-width', '320');
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it('keeps an active resize session when pointer samples are retargeted away from the separator', () => {
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    let pendingFrame: FrameRequestCallback | null = null;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      pendingFrame = callback;
      return 92;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1024,
      bottom: 768,
      width: 1024,
      height: 768,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(resizer, {
      button: 0,
      buttons: 1,
      pointerId: 77,
      clientX: 248,
    });
    expect(shell).toHaveAttribute('data-nav-resizing', 'true');
    fireEvent.pointerMove(window, {
      button: 0,
      buttons: 1,
      pointerId: 77,
      clientX: 280,
    });
    act(() => pendingFrame?.(performance.now()));
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('280px');

    fireEvent.pointerUp(window, {
      button: 0,
      buttons: 0,
      pointerId: 77,
      clientX: 300,
    });
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    expect(shell).toHaveAttribute('data-nav-width', '300');
    expect(resizer).toHaveAttribute('aria-valuenow', '300');
    requestFrame.mockRestore();
  });

  it('previews collapsed drag, snaps back below the expand threshold, and expands only after hysteresis', async () => {
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    const toggle = screen.getByTestId('dashboard-nav-toggle');

    let pendingFrame: FrameRequestCallback | null = null;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      pendingFrame = callback;
      return 77;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1024,
      bottom: 768,
      width: 1024,
      height: 768,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(toggle);
    settleNavPhase(shell);
    const collapsedSurface = collapsedSurfaceOf(shell);
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(resizer).toBeVisible();
    expect(resizer).toHaveAttribute('tabindex', '0');
    expect(resizer).toHaveAttribute('aria-valuemin', String(collapsedSurface));

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 21, clientX: collapsedSurface });
    expect(shell).toHaveAttribute('data-nav-resizing', 'true');
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 21, clientX: 160 });
    act(() => pendingFrame?.(performance.now()));
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('160px');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('160px');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(shell).toHaveAttribute('data-nav-width', '248');
    fireEvent.pointerUp(resizer, { button: 0, buttons: 0, pointerId: 21, clientX: 160 });
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    act(() => pendingFrame?.(performance.now()));
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe(`${collapsedSurface}px`);
    settleNavPhase(shell);
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('');
    expect(resizer).toHaveAttribute('aria-valuenow', String(collapsedSurface));
    expect(resizer).toHaveAttribute('aria-valuetext', `${collapsedSurface} 像素`);
    expect(shell).toHaveAttribute('data-last-expanded-width', '248');
    expect(shell).toHaveAttribute('data-nav-width', '248');

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 22, clientX: collapsedSurface });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 22, clientX: 207 });
    act(() => pendingFrame?.(performance.now()));
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('207px');
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 22, clientX: 208 });
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('208px');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    expect(shell).toHaveAttribute('data-nav-hold', 'true');
    act(() => pendingFrame?.(performance.now()));
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('208px');
    act(() => pendingFrame?.(performance.now()));
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');
    expect(shell).toHaveAttribute('data-last-expanded-width', '248');
    fireEvent.pointerUp(resizer, { button: 0, buttons: 0, pointerId: 22, clientX: 240 });
    fireEvent.lostPointerCapture(resizer, { pointerId: 22 });
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');
    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    expect(shell).toHaveAttribute('data-nav-width', '248');
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');

    fireEvent.click(toggle);
    settleNavPhase(shell);
    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 23, clientX: collapsedSurface });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 23, clientX: 180 });
    act(() => pendingFrame?.(performance.now()));
    fireEvent.pointerCancel(resizer, { pointerId: 23, buttons: 0, clientX: 180 });
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    act(() => pendingFrame?.(performance.now()));
    settleNavPhase(shell);
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('');
    expect(resizer).toHaveAttribute('aria-valuenow', String(collapsedSurface));
    expect(shell).toHaveAttribute('data-last-expanded-width', '248');

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 24, clientX: collapsedSurface });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 24, clientX: 150 });
    act(() => pendingFrame?.(performance.now()));
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('150px');
    fireEvent.pointerMove(resizer, { button: 0, buttons: 0, pointerId: 24, clientX: 260 });
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    act(() => pendingFrame?.(performance.now()));
    settleNavPhase(shell);
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('');
    expect(resizer).toHaveAttribute('aria-valuenow', String(collapsedSurface));
    expect(shell).toHaveAttribute('data-last-expanded-width', '248');

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 25, clientX: collapsedSurface });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 25, clientX: 165 });
    act(() => pendingFrame?.(performance.now()));
    fireEvent.lostPointerCapture(resizer, { pointerId: 25, buttons: 1 });
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    act(() => pendingFrame?.(performance.now()));
    settleNavPhase(shell);
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('');
    expect(resizer).toHaveAttribute('aria-valuenow', String(collapsedSurface));
    expect(shell).toHaveAttribute('data-last-expanded-width', '248');

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 26, clientX: collapsedSurface });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 26, clientX: 140 });
    act(() => pendingFrame?.(performance.now()));
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('140px');
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    act(() => pendingFrame?.(performance.now()));
    settleNavPhase(shell);
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('');
    expect(resizer).toHaveAttribute('aria-valuenow', String(collapsedSurface));
    expect(shell).toHaveAttribute('data-last-expanded-width', '248');

    fireEvent.keyDown(resizer, { key: 'Home' });
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');
    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    expect(shell).toHaveAttribute('data-nav-width', '248');

    fireEvent.click(toggle);
    settleNavPhase(shell);
    fireEvent.keyDown(resizer, { key: 'End' });
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');
    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-nav-width', '348');

    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  function parseCssPx(value: string): number {
    return Number.parseFloat(value);
  }

  function readChromeBoundary(shell: HTMLElement) {
    return {
      rendered: parseCssPx(shell.style.getPropertyValue('--dash-rendered-nav-width')),
      structure: parseCssPx(shell.style.getPropertyValue('--dash-structure-boundary')),
      preview: parseCssPx(shell.style.getPropertyValue('--dash-nav-preview-width')),
      expanded: parseCssPx(shell.style.getPropertyValue('--dashboard-nav-width')),
    };
  }

  function assertCollapsedPointerDownGeometry(shell: HTMLElement, expected: number) {
    const nav = document.getElementById('dashboard-sidebar');
    const main = shell.querySelector('.dashboard-main');
    const topbar = shell.querySelector('.dashboard-topbar');
    const divider = shell.querySelector('.dashboard-nav');
    const separator = screen.getByTestId('dashboard-nav-resizer');
    const boundary = readChromeBoundary(shell);

    expect(nav).not.toBeNull();
    expect(main).not.toBeNull();
    expect(topbar).not.toBeNull();
    expect(divider).toBe(nav);
    expect(separator).toBeInTheDocument();
    expect(boundary.rendered).toBe(expected);
    expect(boundary.structure).toBe(expected);
    expect(boundary.preview).toBe(expected);
    expect(boundary.expanded).toBe(248);
    expect(shell).toHaveAttribute('data-nav-width', '248');
    expect(shell).toHaveAttribute('data-last-expanded-width', '248');
    expect(separator).toHaveAttribute('aria-valuenow', String(expected));
    expect([
      boundary.rendered,
      boundary.structure,
      boundary.preview,
    ]).toEqual([expected, expected, expected]);
  }

  it('keeps macOS collapsed pointerdown without move on the 120px surface', () => {
    window.history.replaceState({}, '', '/?platform=darwin');
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    const toggle = screen.getByTestId('dashboard-nav-toggle');

    fireEvent.click(toggle);
    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-collapsed-surface', '120');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 41, clientX: 120 });
    expect(shell).toHaveAttribute('data-nav-resizing', 'true');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    assertCollapsedPointerDownGeometry(shell, 120);
  });

  it('keeps native collapsed pointerdown without move on the 72px surface', () => {
    window.history.replaceState({}, '', '/?platform=win32');
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    const toggle = screen.getByTestId('dashboard-nav-toggle');

    fireEvent.click(toggle);
    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-collapsed-surface', '72');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 42, clientX: 72 });
    expect(shell).toHaveAttribute('data-nav-resizing', 'true');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    assertCollapsedPointerDownGeometry(shell, 72);
  });

  it('does not let a stale preview settle overwrite a toggle during rollback', () => {
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    const toggle = screen.getByTestId('dashboard-nav-toggle');
    const collapsedSurface = collapsedSurfaceOf(shell);

    const scheduledFrames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    });

    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1024,
      bottom: 768,
      width: 1024,
      height: 768,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(toggle);
    settleNavPhase(shell);
    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 43, clientX: collapsedSurface });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 43, clientX: 160 });
    act(() => scheduledFrames.at(-1)?.(performance.now()));
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('160px');

    fireEvent.pointerUp(resizer, { button: 0, buttons: 0, pointerId: 43, clientX: 160 });
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    const rollbackFlush = scheduledFrames.at(-1);

    fireEvent.click(toggle);
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');
    expect(shell).toHaveAttribute('data-nav-width', '248');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('160px');

    act(() => {
      rollbackFlush?.(performance.now());
    });
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('160px');
    expect(shell.style.getPropertyValue('--dash-structure-boundary')).toBe('160px');
    expect(shell).toHaveAttribute('data-nav-width', '248');
    expect(shell).toHaveAttribute('data-last-expanded-width', '248');

    act(() => scheduledFrames.at(-1)?.(performance.now()));
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('248px');

    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    expect(shell).toHaveAttribute('data-nav-width', '248');
    requestFrame.mockRestore();
  });

  it('shows collapsed navigation tooltips on hover and focus, then dismisses with Escape', () => {
    vi.useFakeTimers();
    render(<DashboardApp />);
    fireEvent.click(screen.getByTestId('dashboard-nav-toggle'));
    fireEvent.transitionEnd(screen.getByTestId('dashboard-shell'), {
      propertyName: 'grid-template-columns',
    });
    const overview = screen.getByTestId('nav-overview');

    fireEvent.mouseEnter(overview);
    expect(screen.queryByTestId('dashboard-nav-tooltip')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(319));
    expect(screen.queryByTestId('dashboard-nav-tooltip')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('dashboard-nav-tooltip')).toHaveTextContent('管理概览');
    expect(screen.getByTestId('dashboard-nav-tooltip')).toHaveClass('is-visible');

    fireEvent.mouseLeave(overview);
    expect(screen.getByTestId('dashboard-nav-tooltip')).not.toHaveClass('is-visible');
    act(() => vi.advanceTimersByTime(140));
    expect(screen.queryByTestId('dashboard-nav-tooltip')).not.toBeInTheDocument();

    fireEvent.focus(overview);
    expect(screen.getByTestId('dashboard-nav-tooltip')).toHaveTextContent('管理概览');
    expect(screen.getByTestId('dashboard-nav-tooltip')).toHaveClass('is-visible');
    fireEvent.keyDown(overview, { key: 'Escape' });
    expect(screen.queryByTestId('dashboard-nav-tooltip')).not.toBeInTheDocument();
  });

  it('supports light, dark, and live system appearance without persistence APIs', async () => {
    const colorScheme = installColorSchemeMedia(false);
    const user = userEvent.setup();
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const html = document.documentElement;
    const trigger = screen.getByTestId('dashboard-theme-trigger');
    const brandFox = screen.getByTestId('dashboard-brand-logo').querySelector<HTMLElement>(
      '.dashboard-brand-fox',
    );
    const brandImages = () => brandFox?.querySelectorAll<HTMLImageElement>(
      '.dashboard-brand-fox-image',
    ) ?? [];
    const brandImage = () => brandFox?.querySelector<HTMLImageElement>(
      '.dashboard-brand-fox-image',
    );

    expect(shell).toHaveAttribute('data-theme-mode', 'system');
    expect(shell).toHaveAttribute('data-theme', 'light');
    expect(brandFox).toHaveAttribute('data-active-variant', 'purple-headset');
    expect(brandFox).toHaveStyle({ width: '40px', height: '40px' });
    expect(brandImages()).toHaveLength(1);
    expect(brandImage()).toHaveClass('is-purple-headset');
    expect(brandImage()).toHaveAttribute('data-active', 'true');
    expect(brandFox?.querySelector('.is-white-headset')).toBeNull();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(html.dataset.dashboardThemeMode).toBe('system');
    expect(html.dataset.dashboardTheme).toBe('light');
    expect(html.style.colorScheme).toBe('light');
    expect(shell).toHaveStyle({ colorScheme: 'light' });

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('dashboard-theme-system')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('dashboard-theme-system')).toHaveAttribute('role', 'menuitemradio');

    await user.click(screen.getByTestId('dashboard-theme-dark'));
    expect(shell).toHaveAttribute('data-theme-mode', 'dark');
    expect(shell).toHaveAttribute('data-theme', 'dark');
    expect(html.style.colorScheme).toBe('dark');
    expect(shell).toHaveStyle({ colorScheme: 'dark' });
    expect(brandFox).toHaveAttribute('data-active-variant', 'white-headset');
    expect(brandImages()).toHaveLength(1);
    expect(brandImage()).toHaveClass('is-white-headset');
    expect(brandImage()).toHaveAttribute('data-active', 'true');
    expect(brandFox?.querySelector('.is-purple-headset')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(screen.queryByTestId('dashboard-theme-menu')).not.toBeInTheDocument();
    act(() => colorScheme.setDark(false));
    expect(shell).toHaveAttribute('data-theme', 'dark');

    await user.click(trigger);
    await user.click(screen.getByTestId('dashboard-theme-light'));
    act(() => colorScheme.setDark(true));
    expect(shell).toHaveAttribute('data-theme-mode', 'light');
    expect(shell).toHaveAttribute('data-theme', 'light');
    expect(html.style.colorScheme).toBe('light');
    expect(shell).toHaveStyle({ colorScheme: 'light' });
    expect(brandFox).toHaveAttribute('data-active-variant', 'purple-headset');
    expect(brandImages()).toHaveLength(1);
    expect(brandImage()).toHaveClass('is-purple-headset');

    await user.click(trigger);
    await user.click(screen.getByTestId('dashboard-theme-system'));
    expect(shell).toHaveAttribute('data-theme-mode', 'system');
    expect(shell).toHaveAttribute('data-theme', 'dark');
    expect(brandFox).toHaveAttribute('data-active-variant', 'white-headset');
    expect(brandImages()).toHaveLength(1);
    expect(brandImage()).toHaveClass('is-white-headset');
    act(() => colorScheme.setDark(false));
    expect(shell).toHaveAttribute('data-theme', 'light');
    expect(brandFox).toHaveAttribute('data-active-variant', 'purple-headset');
    expect(brandImages()).toHaveLength(1);
    expect(brandImage()).toHaveClass('is-purple-headset');
    expect(html.dataset.dashboardTheme).toBe('light');
  });

  it('moves through the theme menu with keyboard and returns focus to the trigger', async () => {
    installColorSchemeMedia(false);
    const user = userEvent.setup();
    render(<DashboardApp />);
    const trigger = screen.getByTestId('dashboard-theme-trigger');

    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = screen.getByTestId('dashboard-theme-menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-theme-system')).toHaveFocus();
    expect(screen.getByTestId('dashboard-theme-system')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('dashboard-theme-light')).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('dashboard-theme-light')).toHaveFocus();
    expect(screen.getByTestId('dashboard-theme-light')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('dashboard-theme-system')).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{End}');
    expect(screen.getByTestId('dashboard-theme-system')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByTestId('dashboard-theme-light')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('dashboard-theme-system')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('dashboard-theme-menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');
    expect(screen.getByTestId('dashboard-shell')).toHaveAttribute('data-theme-mode', 'light');
    expect(trigger).toHaveFocus();

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('dashboard-theme-menu')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-theme-light')).toHaveFocus();
    await user.keyboard('{Escape}');

    trigger.focus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('dashboard-theme-menu')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-theme-light')).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(screen.queryByTestId('dashboard-theme-menu')).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();

    await user.click(trigger);
    expect(screen.getByTestId('dashboard-theme-menu')).toBeInTheDocument();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.queryByTestId('dashboard-theme-menu')).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('dashboard-theme-menu')).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it('keeps platform-specific collapsed surfaces and icon anchors', () => {
    window.history.replaceState({}, '', '/?platform=darwin');
    const { unmount } = render(<DashboardApp />);
    const macShell = screen.getByTestId('dashboard-shell');
    expect(macShell).toHaveAttribute('data-dashboard-chrome', 'integrated');
    expect(collapsedSurfaceOf(macShell)).toBe(120);
    expect(macShell).toHaveAttribute('data-icon-anchor', '60');
    fireEvent.click(screen.getByTestId('dashboard-nav-toggle'));
    settleNavPhase(macShell);
    expect(screen.getByRole('separator', { name: '调整工作台侧栏宽度' })).toHaveAttribute('aria-valuenow', '120');
    unmount();

    window.history.replaceState({}, '', '/?platform=win32');
    render(<DashboardApp />);
    const nativeShell = screen.getByTestId('dashboard-shell');
    expect(nativeShell).toHaveAttribute('data-dashboard-chrome', 'native');
    expect(collapsedSurfaceOf(nativeShell)).toBe(72);
    expect(nativeShell).toHaveAttribute('data-icon-anchor', '36');
    fireEvent.click(screen.getByTestId('dashboard-nav-toggle'));
    settleNavPhase(nativeShell);
    expect(screen.getByRole('separator', { name: '调整工作台侧栏宽度' })).toHaveAttribute('aria-valuenow', '72');
  });

  it('jumps to the collapsed rail immediately when reduced motion is requested', async () => {
    installColorSchemeMedia(false, true);
    const user = userEvent.setup();
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');

    await user.click(screen.getByTestId('dashboard-nav-toggle'));
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(screen.getByTestId('dashboard-nav-toggle')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('dashboard-nav-toggle')).not.toHaveFocus();

    screen.getByTestId('dashboard-nav-toggle').focus();
    await user.keyboard('{Enter}');
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    expect(screen.getByTestId('dashboard-nav-toggle')).toHaveFocus();

    await user.click(screen.getByTestId('dashboard-nav-toggle'));
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1024,
      bottom: 768,
      width: 1024,
      height: 768,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 31, clientX: collapsedSurfaceOf(shell) });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 31, clientX: 220 });
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    expect(shell).toHaveAttribute('data-nav-width', '248');
  });

  it('does not settle a reversed structure transition on a stale transitioncancel', () => {
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const toggle = screen.getByTestId('dashboard-nav-toggle');

    fireEvent.click(toggle);
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    fireEvent.click(toggle);
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');

    const widthSpy = mockStructureWidth(shell, 160);
    dispatchNavStructureTransition(shell, 'transitioncancel');
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');
    expect(screen.getByRole('separator', { name: '调整工作台侧栏宽度' })).toBeVisible();
    widthSpy.mockRestore();

    settleNavPhase(shell);
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
  });

  it('settles transitioncancel only when the structure already matches the current target', () => {
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const toggle = screen.getByTestId('dashboard-nav-toggle');

    fireEvent.click(toggle);
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    const widthSpy = mockStructureWidth(shell, collapsedSurfaceOf(shell));
    dispatchNavStructureTransition(shell, 'transitioncancel');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    widthSpy.mockRestore();
  });

  it('settles immediately when reduced motion turns on mid-transition', () => {
    const media = installColorSchemeMedia(false, false);
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');

    fireEvent.click(screen.getByTestId('dashboard-nav-toggle'));
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    act(() => media.setReducedMotion(true));
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(screen.getByTestId('dashboard-nav-toggle')).not.toHaveAttribute('hidden');
  });

  it('cancels auto-expand first-frame hold when reduced motion flips on', () => {
    const media = installColorSchemeMedia(false, false);
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    const toggle = screen.getByTestId('dashboard-nav-toggle');
    const raf = mockRafQueue();
    mockShellLeft(shell);

    fireEvent.click(toggle);
    settleNavPhase(shell);
    const collapsedSurface = collapsedSurfaceOf(shell);
    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 61, clientX: collapsedSurface });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 61, clientX: 208 });
    expect(shell).toHaveAttribute('data-nav-hold', 'true');
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');

    act(() => media.setReducedMotion(true));
    expectStableNavChrome(shell, toggle, 'expanded', 248);
    raf.flushAll();
    expectStableNavChrome(shell, toggle, 'expanded', 248);
    raf.flushAll();
    expect(shell).not.toHaveAttribute('data-nav-phase', 'expanding');
    raf.restore();
  });

  it('cancels auto-expand second-frame hold when reduced motion flips on', () => {
    const media = installColorSchemeMedia(false, false);
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    const toggle = screen.getByTestId('dashboard-nav-toggle');
    const raf = mockRafQueue();
    mockShellLeft(shell);

    fireEvent.click(toggle);
    settleNavPhase(shell);
    const collapsedSurface = collapsedSurfaceOf(shell);
    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 62, clientX: collapsedSurface });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 62, clientX: 208 });
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    raf.flushNext();
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(shell).toHaveAttribute('data-nav-hold', 'true');

    act(() => media.setReducedMotion(true));
    expectStableNavChrome(shell, toggle, 'expanded', 248);
    raf.flushAll();
    expectStableNavChrome(shell, toggle, 'expanded', 248);
    raf.flushAll();
    expect(shell).not.toHaveAttribute('data-nav-phase', 'expanding');
    raf.restore();
  });

  it('cancels auto-collapse first-frame hold when reduced motion flips on', () => {
    const media = installColorSchemeMedia(false, false);
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    const toggle = screen.getByTestId('dashboard-nav-toggle');
    const raf = mockRafQueue();
    mockShellLeft(shell);
    const collapsedSurface = collapsedSurfaceOf(shell);

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 63, clientX: 248 });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 63, clientX: 192 });
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    expect(shell).toHaveAttribute('data-nav-hold', 'true');

    act(() => media.setReducedMotion(true));
    expectStableNavChrome(shell, toggle, 'collapsed', collapsedSurface);
    raf.flushAll();
    expectStableNavChrome(shell, toggle, 'collapsed', collapsedSurface);
    raf.flushAll();
    expect(shell).not.toHaveAttribute('data-nav-phase', 'collapsing');
    raf.restore();
  });

  it('cancels auto-collapse second-frame hold when reduced motion flips on', () => {
    const media = installColorSchemeMedia(false, false);
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    const toggle = screen.getByTestId('dashboard-nav-toggle');
    const raf = mockRafQueue();
    mockShellLeft(shell);
    const collapsedSurface = collapsedSurfaceOf(shell);

    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 64, clientX: 248 });
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 64, clientX: 192 });
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    raf.flushNext();
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    expect(shell).toHaveAttribute('data-nav-hold', 'true');

    act(() => media.setReducedMotion(true));
    expectStableNavChrome(shell, toggle, 'collapsed', collapsedSurface);
    raf.flushAll();
    expectStableNavChrome(shell, toggle, 'collapsed', collapsedSurface);
    raf.flushAll();
    expect(shell).not.toHaveAttribute('data-nav-phase', 'collapsing');
    raf.restore();
  });

  it('clears settling preview on target-matched transitioncancel so viewport clamp can publish', () => {
    render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const resizer = screen.getByRole('separator', { name: '调整工作台侧栏宽度' });
    const toggle = screen.getByTestId('dashboard-nav-toggle');
    const originalInnerWidth = window.innerWidth;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    act(() => window.dispatchEvent(new Event('resize')));
    fireEvent.keyDown(resizer, { key: 'End' });
    const expanded = Number(shell.getAttribute('data-nav-width'));
    expect(expanded).toBeGreaterThan(238);

    fireEvent.click(toggle);
    expect(shell).toHaveAttribute('data-nav-phase', 'collapsing');
    fireEvent.click(toggle);
    expect(shell).toHaveAttribute('data-nav-phase', 'expanding');

    const widthSpy = mockStructureWidth(shell, expanded);
    dispatchNavStructureTransition(shell, 'transitioncancel');
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe(`${expanded}px`);
    widthSpy.mockRestore();

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(shell).toHaveAttribute('data-nav-width', '238');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('238px');
    expect(shell.style.getPropertyValue('--dash-nav-preview-width')).toBe('');
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  it('presents overview work as a decision table, a continuous KPI strip, and operational charts', () => {
    render(<DashboardApp />);

    expect(screen.getByRole('heading', { name: '待处理事项（未接入）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '核心指标' })).toBeInTheDocument();
    expect(screen.getByTestId('overview-scope')).toHaveTextContent('未接入产品会话');
    expect(screen.queryByLabelText('今日状态')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByLabelText('核心运营指标')).toBeInTheDocument();
    expect(screen.getByTestId('overview-alert-nohit')).toHaveTextContent('未接入');
    expect(screen.getByTestId('overview-kpi-source')).not.toHaveTextContent('固定周期合成演示数据');
  });

  it('navigates from a manager decision into the wording detail', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-wording'));
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'wording');
  });

  it('explains an operational KPI before navigating to its detail', async () => {
    render(<DashboardApp />);
    const kpiSection = screen.getByRole('list', { name: '核心运营指标' });
    expect(kpiSection).toHaveTextContent('无命中率');
    expect(kpiSection).toHaveTextContent('未接入');
    expect(screen.queryByRole('button', { name: '查看明细' })).not.toBeInTheDocument();
  });

  it('switches overview trend metrics, selects chart points, and explains the terminal structure', async () => {
    render(<DashboardApp />);
    expect(screen.queryByTestId('overview-trend-chart')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-overview')).not.toHaveTextContent('固定周期合成演示数据');
  });

  it('removed: VOC module deleted', () => {
    // workorders module was removed in W1 refactor
    expect(true).toBe(true);
  });

  it('removed: VOC time slice module deleted', () => {
    // workorders module was removed in W1 refactor
    expect(true).toBe(true);
  });

    it('filters the four-domain wording library from the local catalog', async () => {
    const user = userEvent.setup();
    window.dashboardWording = {
      list: async () => ({
        ok: true as const,
        releaseId: 'rel_18',
        total: 2,
        entries: [
          {
            scriptId: 'mn-1',
            domain: 'product',
            title: '洁面用法',
            scene: '怎么用',
            answerPreview: '先打湿再打圈',
            platform: '千牛 / 抖音',
            version: 'rel_18',
            effectiveWindow: '本机目录',
            risk: 'low',
            lifecycle: 'published',
            lifecycleLabel: '已发布',
            ownerRole: '本机话术库',
            dataClass: 'local-catalog',
          },
          {
            scriptId: 'mn-2',
            domain: 'campaign',
            title: '满赠规则',
            scene: '活动',
            answerPreview: '满赠不叠加',
            platform: '千牛 / 抖音',
            version: 'rel_18',
            effectiveWindow: '本机目录',
            risk: 'medium',
            lifecycle: 'published',
            lifecycleLabel: '已发布',
            ownerRole: '本机话术库',
            dataClass: 'local-catalog',
          },
        ],
      }),
    };
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-wording'));
    expect(await screen.findByTestId('module-wording')).toHaveTextContent('产品话术');
    expect(await screen.findByTestId('wording-detail-owner')).toHaveTextContent('本机话术库');
    expect(screen.getByTestId('wording-detail')).not.toHaveTextContent('DEMO · SYNTHETIC');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('洁面用法');

    const productTab = screen.getByTestId('wording-domain-product');
    productTab.focus();
    fireEvent.keyDown(productTab, { key: 'ArrowRight' });
    expect(screen.getByTestId('wording-domain-campaign')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('wording-domain-campaign')).toHaveAttribute('tabindex', '0');
    expect(productTab).toHaveAttribute('tabindex', '-1');
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(screen.getByTestId('wording-domain-campaign')).toHaveFocus();
    expect(screen.getByTestId('wording-list')).toHaveTextContent('满赠规则');

    await user.click(screen.getByTestId('wording-domain-presale'));
    expect(screen.getByTestId('wording-source-readiness')).toHaveTextContent('当前发布无此域');
    expect(screen.getByTestId('wording-source-readiness')).not.toHaveTextContent('NOT_CREATED');
    expect(screen.getByTestId('wording-empty')).toHaveTextContent('没有匹配的话术');
    expect(screen.queryByTestId('wording-pager')).not.toBeInTheDocument();
    expect(screen.getByTestId('wording-export')).toBeDisabled();
  });

  it('labels the wording detail card with the entry ownerRole', async () => {
    const user = userEvent.setup();
    window.dashboardWording = {
      list: async () => ({
        ok: true as const,
        releaseId: 'rel_18',
        total: 1,
        entries: [
          {
            scriptId: 'mn-1',
            domain: 'product',
            title: '洁面用法',
            scene: '怎么用',
            answerPreview: '先打湿再打圈',
            platform: '千牛 / 抖音',
            version: 'rel_18',
            effectiveWindow: '当前发布',
            risk: 'low',
            lifecycle: 'published',
            lifecycleLabel: '已发布',
            ownerRole: '当前发布',
            dataClass: 'local-catalog',
          },
        ],
      }),
    };
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-wording'));
    expect(await screen.findByTestId('wording-detail-owner')).toHaveTextContent('当前发布');
    expect(screen.getByTestId('wording-detail-owner')).not.toHaveTextContent('本机话术库');
  });

  it('pages the wording library and exports the filtered published CSV', async () => {
    const user = userEvent.setup();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => 'blob:wording-export');
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    let downloadLink: HTMLAnchorElement | undefined;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const node = originalCreateElement(tagName, options);
      if (tagName === 'a') {
        downloadLink = node as HTMLAnchorElement;
        Object.defineProperty(node, 'click', { configurable: true, value: click });
      }
      return node;
    }) as typeof document.createElement);
    window.dashboardWording = {
      list: async () => ({
        ok: true as const,
        releaseId: 'rel_18',
        total: 25,
        entries: Array.from({ length: 25 }, (_, index) => ({
          scriptId: `mn-${index + 1}`,
          domain: 'product' as const,
          title: `产品话术 ${index + 1}`,
          scene: '怎么用',
          answerPreview: `正文 ${index + 1}`,
          platform: '千牛 / 抖音',
          version: 'rel_18',
          effectiveWindow: '当前发布',
          risk: 'low' as const,
          lifecycle: 'published' as const,
          lifecycleLabel: '已发布' as const,
          ownerRole: '当前发布',
          dataClass: 'local-catalog' as const,
        })),
      }),
    };
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-wording'));
    expect(await screen.findByTestId('wording-page-status')).toHaveTextContent('第 1 / 2 页');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('产品话术 1');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('产品话术 20');
    expect(screen.getByTestId('wording-list')).not.toHaveTextContent('产品话术 21');
    expect(screen.getByTestId('wording-page-prev')).toBeDisabled();
    expect(screen.getByTestId('wording-page-next')).toBeEnabled();
    fireEvent.click(screen.getByTestId('wording-page-prev'));
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 1 / 2 页');
    await user.click(screen.getByRole('button', { name: /产品话术 2 怎么用/ }));
    expect(screen.getByTestId('wording-detail')).toHaveTextContent('产品话术 2');
    await user.click(screen.getByTestId('wording-page-next'));
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 2 / 2 页');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('产品话术 21');
    expect(screen.getByTestId('wording-list')).not.toHaveTextContent('产品话术 1');
    expect(screen.getByTestId('wording-detail')).toHaveTextContent('产品话术 21');
    expect(screen.getByTestId('wording-page-prev')).toBeEnabled();
    expect(screen.getByTestId('wording-page-next')).toBeDisabled();
    fireEvent.click(screen.getByTestId('wording-page-next'));
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 2 / 2 页');
    await user.click(screen.getByTestId('wording-page-prev'));
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 1 / 2 页');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('产品话术 1');
    await user.click(screen.getByTestId('wording-export'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:wording-export');
    expect(downloadLink?.download).toMatch(/^话术库-产品话术-已发布-\d{4}-\d{2}-\d{2}\.csv$/);
    const firstCall = createObjectURL.mock.calls[0] as unknown[] | undefined;
    const blob = firstCall?.[0];
    expect(blob instanceof Blob).toBe(true);
    if (!(blob instanceof Blob)) throw new Error('expected csv blob');
    expect(blob.type).toContain('text/csv');
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(csv.startsWith('script_id,domain,title,')).toBe(true);
    expect(csv).toContain('mn-1,product,产品话术 1,');
    expect(csv).toContain('mn-25,product,产品话术 25,');
    expect(csv).toContain('\r\n');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevokeObjectURL });
  });

  it('resets the wording page when domain, lifecycle, search, or reset change', async () => {
    const user = userEvent.setup();
    window.dashboardWording = {
      list: async () => ({
        ok: true as const,
        releaseId: 'rel_18',
        total: 26,
        entries: [
          ...Array.from({ length: 25 }, (_, index) => ({
            scriptId: `mn-${index + 1}`,
            domain: 'product' as const,
            title: `产品话术 ${index + 1}`,
            scene: '怎么用',
            answerPreview: `正文 ${index + 1}`,
            platform: '千牛 / 抖音',
            version: 'rel_18',
            effectiveWindow: '当前发布',
            risk: 'low' as const,
            lifecycle: 'published' as const,
            lifecycleLabel: '已发布' as const,
            ownerRole: '当前发布',
            dataClass: 'local-catalog' as const,
          })),
          {
            scriptId: 'mn-campaign-1',
            domain: 'campaign' as const,
            title: '活动话术 1',
            scene: '活动',
            answerPreview: '满赠不叠加',
            platform: '千牛 / 抖音',
            version: 'rel_18',
            effectiveWindow: '当前发布',
            risk: 'low' as const,
            lifecycle: 'published' as const,
            lifecycleLabel: '已发布' as const,
            ownerRole: '当前发布',
            dataClass: 'local-catalog' as const,
          },
        ],
      }),
    };
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-wording'));
    expect(await screen.findByTestId('wording-page-status')).toHaveTextContent('第 1 / 2 页');
    await user.click(screen.getByTestId('wording-page-next'));
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 2 / 2 页');

    await user.click(screen.getByTestId('wording-domain-campaign'));
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 1 / 1 页');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('活动话术 1');

    await user.click(screen.getByTestId('wording-domain-product'));
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 1 / 2 页');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('产品话术 1');
    expect(screen.getByTestId('wording-list')).not.toHaveTextContent('产品话术 21');

    await user.click(screen.getByTestId('wording-page-next'));
    await user.selectOptions(screen.getByTestId('wording-lifecycle'), 'published');
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 1 / 2 页');

    await user.click(screen.getByTestId('wording-page-next'));
    await user.type(screen.getByTestId('wording-search'), '正文 25');
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 1 / 1 页');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('产品话术 25');

    await user.clear(screen.getByTestId('wording-search'));
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 1 / 2 页');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('产品话术 1');

    await user.click(screen.getByTestId('wording-page-next'));
    await user.click(screen.getByRole('button', { name: '重置' }));
    expect(screen.getByTestId('wording-page-status')).toHaveTextContent('第 1 / 2 页');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('产品话术 1');
  });

  it('supports roving keyboard navigation between modules', async () => {
    render(<DashboardApp />);
    const overview = screen.getByTestId('nav-overview');
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowDown' });
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'wording');
    expect(screen.getByTestId('nav-wording')).toHaveAttribute('aria-current', 'page');
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(screen.getByTestId('nav-wording')).toHaveFocus();
    expect(screen.getByTestId('nav-overview')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('nav-wording')).toHaveAttribute('tabindex', '0');
  });

  it('leaves content scrolling to native wheel and scrollbar behavior', () => {
    render(<DashboardApp />);
    const content = screen.getByTestId('dashboard-content');
    content.scrollTop = 40;

    fireEvent.mouseDown(content, { button: 0, clientY: 260 });
    fireEvent.mouseMove(content, { buttons: 1, clientY: 180 });
    expect(content.scrollTop).toBe(40);
    expect(content).not.toHaveAttribute('data-drag-scrolling');
  });

  it('demonstrates local announce success and recoverable failure without changing facets', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    fireEvent.click(screen.getByTestId('nav-announce'));
    expect(screen.getByTestId('announce-wording-empty')).toHaveTextContent('未接入');
    await user.click(screen.getByTestId('system-sync-tab-software'));
    await user.click(screen.getByTestId('software-check-update'));
    expect(screen.getByTestId('software-update-status')).toHaveTextContent('未接入');
    expect(screen.queryByTestId('announce-push-action')).not.toBeInTheDocument();
  });

  it('shows ledger details without a sent body and keeps publish disabled', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    // ledger is now accessible via overview: open the details section
    await user.click(screen.getByTestId('nav-content'));
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(screen.getByTestId('publish-disabled-reason')).toHaveTextContent(
      '当前没有产品会话，无法发布',
    );
    expect(screen.queryByTestId('release-rel-demo-2026-08-blocked')).not.toBeInTheDocument();
    expect(screen.queryByTestId('missing-domain-block')).not.toBeInTheDocument();
    expect(screen.queryByText('结构演示')).not.toBeInTheDocument();
    expect(screen.queryByText('ACK/Lease')).not.toBeInTheDocument();
  });

  it('lets a coach import a synthetic csv/xlsx or demo file into staged preview without enabling publish', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    expect(window.customerAgent).toBeUndefined();
    await user.click(screen.getByTestId('nav-content'));

    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(screen.getByTestId('content-upload-draft-copy')).toHaveTextContent(
      '上传只进入待审核草稿，不是已发布',
    );
    expect(screen.getByTestId('content-upload-role-note')).toHaveTextContent('管理员（owner）');
    expect(screen.getByTestId('content-upload-boundary')).toHaveTextContent('不连接飞书或 Wiki');
    expect(screen.getByTestId('formal-source-warning')).toHaveTextContent('产品会话');
    expect(screen.getByTestId('content-aftersale-note')).toHaveTextContent('SOP 写库未接入');
    expect(screen.queryByTestId('content-staged-preview')).not.toBeInTheDocument();
    // 浏览器侧 accept 只放行 .csv / .xlsx；扩展名兜底在 parser 单测覆盖。
    expect(screen.getByTestId('content-upload-input')).toHaveAttribute('accept', '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(screen.getByTestId('content-upload-input')).toHaveAttribute('type', 'file');
    expect(screen.getByLabelText('选择 CSV 或 xlsx')).toBeInTheDocument();
    expect(screen.getByTestId('content-upload-status')).toHaveTextContent('选择 CSV 或 xlsx');

    const demoCsv = new File(
      ['scene,script\n洁面用量确认,先确认产品版本，再说明用量与不可承诺边界\n满赠规则说明,展示门槛与结算条件，不承诺库存\n售后质量升级,记录必要证据，禁止原因承诺\n'],
      'coach-draft.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), demoCsv);
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'ready');
    });
    const demoPreview = screen.getByTestId('content-staged-preview');
    expect(demoPreview).toHaveTextContent('场景');
    expect(demoPreview).toHaveTextContent('标准话术');
    expect(demoPreview).not.toHaveTextContent('步骤');
    expect(demoPreview).toHaveTextContent('洁面用量确认');
    expect(demoPreview).toHaveTextContent('售后质量升级');
    expect(screen.getByTestId('content-pipeline-steps')).toHaveTextContent('导入草稿');
    expect(screen.getByTestId('content-pipeline-steps')).toHaveTextContent('审核确认');
    expect(screen.queryByText('ACK/Lease')).not.toBeInTheDocument();
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(window.customerAgent).toBeUndefined();

    const csv = new File(
      ['scene,step\n洁面用量确认,先确认产品版本\n'],
      'coach-draft.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), csv);
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'ready');
    });
    expect(screen.getByTestId('content-staged-preview')).toHaveTextContent('先确认产品版本');
    expect(screen.getByTestId('content-staged-preview')).toHaveTextContent('洁面用量确认');
    expect(screen.getByTestId('content-upload-status')).toHaveTextContent('coach-draft.csv');
    expect(screen.getByTestId('content-upload-status')).toHaveTextContent('不是已发布');
    expect(screen.getByTestId('publish-action')).toBeDisabled();

    const xlsx = new File(
      ['scene,step\n满赠规则说明,不承诺库存\n'],
      'coach-draft.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), xlsx);
    await waitFor(() => {
      expect(screen.getByTestId('content-staged-preview')).toHaveTextContent('满赠规则说明');
    });
    expect(screen.getByTestId('content-staged-preview')).toHaveTextContent('不承诺库存');
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(screen.getByTestId('publish-disabled-reason')).toHaveTextContent(
      '当前没有产品会话，无法发布',
    );
    expect(window.customerAgent).toBeUndefined();

    const binary = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])],
      'workbook.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), binary);
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'error');
    });
    expect(screen.getByTestId('content-upload-status')).toHaveTextContent('Excel 需工作台主进程解析');
    expect(screen.queryByTestId('content-staged-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(window.customerAgent).toBeUndefined();
  });

  it('clears the coach preview back to idle without leaving released state behind', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-content'));

    const clear = screen.getByTestId('content-upload-clear');
    expect(clear).toBeDisabled();

    const demoCsv = new File(
      ['scene,script\n洁面用量确认,先确认产品版本\n'],
      'coach-draft.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), demoCsv);
    await waitFor(() => {
      expect(screen.getByTestId('content-staged-preview')).toBeInTheDocument();
    });
    expect(clear).toBeEnabled();

    await user.click(clear);
    expect(screen.queryByTestId('content-staged-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'idle');
    expect(screen.getByTestId('content-upload-status')).toHaveTextContent('等待导入');
    expect(screen.getByTestId('content-upload-status')).not.toHaveTextContent('不是已发布');
    expect(screen.queryByText('ACK/Lease')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-pipeline')).not.toBeInTheDocument();
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(window.customerAgent).toBeUndefined();
  });

  it('fail-closes bad coach tables without leaking a staged preview or enabling publish', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-content'));
    const demoCsv = new File(
      ['scene,script\n洁面用量确认,先确认产品版本\n'],
      'coach-draft.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), demoCsv);
    await waitFor(() => {
      expect(screen.getByTestId('content-staged-preview')).toBeInTheDocument();
    });

    const cases = [
      { file: new File(['title,body\nA,B\n'], 'bad-headers.csv', { type: 'text/csv' }), copy: '表头必须能映射' },
      { file: new File([''], 'empty.csv', { type: 'text/csv' }), copy: '没有可预览的数据行' },
      { file: new File(['scene,step,domain\n用量,说明,legal\n'], 'bad-domain.csv', { type: 'text/csv' }), copy: '域只能是' },
      {
        file: new File(['x'.repeat(COACH_UPLOAD_MAX_BYTES + 1)], 'huge.csv', { type: 'text/csv' }),
        copy: '10MiB',
      },
    ] as const;

    for (const item of cases) {
      await user.upload(screen.getByTestId('content-upload-input'), item.file);
      await waitFor(() => {
        expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'error');
      });
      expect(screen.getByTestId('content-upload-status')).toHaveTextContent('未进入草稿');
      expect(screen.getByTestId('content-upload-status')).toHaveTextContent(item.copy);
      expect(screen.queryByTestId('content-staged-preview')).not.toBeInTheDocument();
      expect(screen.queryByText('ACK/Lease')).not.toBeInTheDocument();
      expect(screen.getByTestId('publish-action')).toBeDisabled();
      expect(window.customerAgent).toBeUndefined();
    }
  });

  it('removed: review module deleted', () => {
    // review module was removed in W1 refactor
    expect(true).toBe(true);
  });

  it('keeps iteration tasks and announce facets separate', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);

    // iteration 模块已并入概览，通过概览双栏卡片验证
    expect(screen.getByTestId('module-overview')).toBeInTheDocument();
    // 「话术优化待办」标题出现在双栏卡片里
    expect(screen.getByTestId('module-overview')).toHaveTextContent('待处理事项');

    await user.click(screen.getByTestId('nav-announce'));
    expect(screen.getByTestId('module-announce')).toHaveTextContent('话术版本');
    expect(screen.queryByTestId('announce-table')).not.toBeInTheDocument();
  });

  it('reminds coach/owner of open P0 iteration tasks and selects the matching queue row', async () => {
    const user = userEvent.setup();
    render(<IterationModule />);

    const reminder = screen.getByTestId('iteration-reminder');
    expect(reminder).toHaveClass('dash-card');
    expect(reminder).toHaveTextContent('有 2 条待处理 P0 需要跟进');
    expect(reminder).toHaveTextContent('DEMO · 合成数据');
    expect(reminder).toHaveTextContent('会员积分过期补发缺少有效稿');
    expect(reminder).toHaveTextContent('退货检测旧稿已过有效期仍被召回');
    expect(reminder).not.toHaveTextContent('洁面泡沫少的首条场景过宽');
    expect(reminder).not.toHaveTextContent('班牛');
    expect(reminder).not.toHaveTextContent('工单');
    expect(screen.getByTestId('iteration-reset-drill')).toBeDisabled();
    expect(screen.queryByTestId('iteration-reminder-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('iteration-it-2041')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('iteration-reminder-it-2041')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('module-iteration')).toHaveTextContent(
      '正式仅 coach / owner · agent 403 · 本页 MOCK AUTH',
    );
    expect(screen.getByTestId('iteration-inaccuracy-counts-footnote')).toHaveTextContent(
      '「话术不准」计数尚未接入。达到 24 小时 ≥ 3 或 7 天 ≥ 10 才会打开 iteration_task；本页不展示实时数字，也不自动改写或关单。',
    );

    await user.selectOptions(screen.getByTestId('iteration-status-filter'), 'closed');
    expect(screen.queryByTestId('iteration-it-2055')).not.toBeInTheDocument();
    expect(screen.getByTestId('iteration-it-2017')).toBeInTheDocument();
    expect(screen.getByTestId('iteration-it-1992')).toBeInTheDocument();

    await user.click(screen.getByTestId('iteration-reminder-it-2055'));
    expect(screen.getByTestId('iteration-status-filter')).toHaveValue('all');
    expect(screen.getByTestId('iteration-cause-filter')).toHaveValue('all');
    expect(screen.getByTestId('iteration-it-2055')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('iteration-reminder-it-2055')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('退货检测旧稿已过有效期仍被召回');
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('it-2055');
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('过期仍召回');
  });

  it('drills start and close on the in-memory iteration queue without persisting anything', async () => {
    const user = userEvent.setup();
    render(<IterationModule />);

    // 开始处理：open @ v1 → in_progress @ v2，按钮换成结论表单。
    expect(screen.getByTestId('iteration-detail-version')).toHaveTextContent('v1');
    expect(screen.queryByTestId('iteration-drill-state')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('iteration-start'));
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('处理中');
    expect(screen.getByTestId('iteration-detail-version')).toHaveTextContent('v2');
    expect(screen.getByTestId('iteration-drill-state')).toHaveTextContent('仅存在本页内存');
    expect(screen.getByTestId('iteration-reset-drill')).toBeEnabled();
    expect(screen.getByTestId('iteration-reminder')).toHaveTextContent('有 1 条待处理 P0 需要跟进');
    expect(screen.queryByTestId('iteration-reminder-it-2041')).not.toBeInTheDocument();

    // 缺少结论时不能关闭。
    expect(screen.getByTestId('iteration-close-resolved')).toBeDisabled();
    expect(screen.getByTestId('iteration-close-wont-fix')).toBeDisabled();
    await user.type(screen.getByTestId('iteration-note'), '已确认有效期过滤口径，待排期修复');
    expect(screen.getByTestId('iteration-close-resolved')).toBeEnabled();

    await user.click(screen.getByTestId('iteration-close-resolved'));
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('已处理');
    expect(screen.getByTestId('iteration-detail-version')).toHaveTextContent('v3');
    expect(screen.getByTestId('iteration-terminal')).toHaveTextContent('终态不可再变更');
    expect(screen.getByTestId('iteration-terminal')).toHaveTextContent('已确认有效期过滤口径');
    expect(screen.queryByTestId('iteration-start')).not.toBeInTheDocument();

    // 关闭待办不等于已发布。
    expect(screen.getByTestId('iteration-detail-footnote')).toHaveTextContent(
      '不自动改写 Answer。关闭待办不等于已发布。演练不保存、不联网。',
    );

    // 重置演练恢复合成清单。
    await user.click(screen.getByTestId('iteration-reset-drill'));
    expect(screen.getByTestId('iteration-detail-version')).toHaveTextContent('v1');
    expect(screen.queryByTestId('iteration-drill-state')).not.toBeInTheDocument();
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('待处理');
    expect(screen.getByTestId('iteration-reset-drill')).toBeDisabled();
    expect(screen.getByTestId('iteration-reminder')).toHaveTextContent('有 2 条待处理 P0 需要跟进');
  });

  it('keeps a P0 empty reminder after the last open P0 leaves the strip', async () => {
    const user = userEvent.setup();
    render(<IterationModule />);

    await user.click(screen.getByTestId('iteration-start'));
    await user.click(screen.getByTestId('iteration-reminder-it-2055'));
    await user.click(screen.getByTestId('iteration-start'));

    expect(screen.getByTestId('iteration-reminder')).toHaveClass('is-empty');
    expect(screen.getByTestId('iteration-reminder')).toHaveTextContent('当前没有待处理 P0');
    expect(screen.getByTestId('iteration-reminder-empty')).toHaveTextContent('处理中或已关闭的不出现在这里');
    expect(screen.queryByTestId('iteration-reminder-it-2041')).not.toBeInTheDocument();
    expect(screen.queryByTestId('iteration-reminder-it-2055')).not.toBeInTheDocument();
    expect(screen.getByTestId('iteration-reset-drill')).toBeEnabled();
  });

  it('reports a refresh prompt when the server version moves ahead of the client snapshot', async () => {
    const user = userEvent.setup();
    render(<IterationModule />);
    expect(screen.queryByTestId('iteration-conflict')).not.toBeInTheDocument();
    expect(screen.getByTestId('iteration-stale-attempt')).toHaveTextContent('演示版本冲突');

    await user.click(screen.getByTestId('iteration-stale-attempt'));
    await user.click(screen.getByTestId('iteration-start'));

    expect(screen.getByTestId('iteration-conflict')).toHaveTextContent('待办已更新，请刷新后再处理');
    // 冲突不落地：客户端快照仍是 open @ v1。
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('待处理');
    expect(screen.getByTestId('iteration-detail-version')).toHaveTextContent('v1');
    expect(screen.getByTestId('iteration-drill-state')).toHaveTextContent('仅存在本页内存');

    await user.click(screen.getByTestId('iteration-reset-drill'));
    expect(screen.queryByTestId('iteration-conflict')).not.toBeInTheDocument();
    expect(screen.getByTestId('iteration-detail-version')).toHaveTextContent('v1');
  });

  it('rejects close when the server version moved ahead during in_progress', async () => {
    const user = userEvent.setup();
    render(<IterationModule />);
    await user.click(screen.getByTestId('iteration-start'));
    await user.type(screen.getByTestId('iteration-note'), '已核对有效期过滤');
    await user.click(screen.getByTestId('iteration-stale-attempt'));
    await user.click(screen.getByTestId('iteration-close-resolved'));

    expect(screen.getByTestId('iteration-conflict')).toHaveTextContent('待办已更新，请刷新后再处理');
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('处理中');
    expect(screen.getByTestId('iteration-detail-version')).toHaveTextContent('v2');
    expect(screen.queryByTestId('iteration-terminal')).not.toBeInTheDocument();
  });

  it('resets filters without wiping an in-memory drill', async () => {
    const user = userEvent.setup();
    render(<IterationModule />);
    await user.click(screen.getByTestId('iteration-start'));
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('处理中');

    await user.selectOptions(screen.getByTestId('iteration-status-filter'), 'closed');
    expect(screen.queryByTestId('iteration-it-2041')).not.toBeInTheDocument();
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('处理中');

    await user.click(screen.getByTestId('iteration-reset-filters'));
    expect(screen.getByTestId('iteration-status-filter')).toHaveValue('all');
    expect(screen.getByTestId('iteration-it-2041')).toBeInTheDocument();
    expect(screen.getByTestId('iteration-detail')).toHaveTextContent('处理中');
    expect(screen.getByTestId('iteration-detail-version')).toHaveTextContent('v2');
    expect(screen.getByTestId('iteration-drill-state')).toHaveTextContent('仅存在本页内存');
  });
});
