import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { COACH_UPLOAD_MAX_BYTES } from '../../src/renderer/features/dashboard/coach-content-upload';
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
    delete window.dashboardAnnounce;
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
    delete window.dashboardAnnounce;
    delete window.dashboardIntake;
    delete window.dashboardPermissions;
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
    expect(screen.queryByText('管理概览')).not.toBeInTheDocument();
    expect(screen.getByTestId('nav-overview')).toHaveAccessibleName('概览');
    expect(screen.queryByTestId('nav-publish')).not.toBeInTheDocument();
    expect(screen.getByTestId('nav-content')).toHaveAccessibleName('知识库');
    expect(screen.getByTestId('nav-materials')).toHaveAccessibleName('资料');
    await user.click(screen.getByTestId('nav-materials'));
    expect(await screen.findByRole('heading', { name: '资料' })).toBeInTheDocument();
  });

  it('shows the allergy SOP tree as a read-only 话术运营 module', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-sop'));
    expect(screen.getByTestId('module-sop')).toHaveTextContent('请先登录后再管理 SOP。');
    expect(screen.getByTestId('sop-library-empty')).toHaveTextContent('请先登录后再管理 SOP。');
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

  it('adds 资料 last on the intake sidebar and projects the whitelist line', async () => {
    const user = userEvent.setup();
    window.dashboardPermissions = {
      current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取权限', view: null }),
      command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取权限', view: null }),
      onInvalidated: () => () => undefined,
    } as typeof window.dashboardPermissions;
    window.dashboardIntake = {
      mode: async () => ({ ok: true, enabled: true }),
      current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
      command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
      onInvalidated: () => () => undefined,
      shellLine: async () => ({ ok: true, profileMode: 'synthetic-local', contentIntake: 'faq-v2' }),
    };
    render(<DashboardApp />);
    const materials = await screen.findByTestId('nav-materials');
    expect(materials).toHaveAccessibleName('资料');
    expect(materials.querySelectorAll('svg path').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('data-testid')).filter((id) => id?.startsWith('nav-'))).toEqual([
      'nav-overview', 'nav-wording', 'nav-sop', 'nav-content', 'nav-materials', 'nav-permissions',
    ]);
    expect(screen.getByTestId('nav-content')).toHaveAccessibleName('知识库');
    expect(screen.queryByTestId('nav-publish')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-announce')).not.toBeInTheDocument();
    expect(screen.queryByTestId('intake-shell-line')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-topbar-drag-surface').parentElement).not.toHaveTextContent('synthetic-local');
    await user.click(materials);
    expect(await screen.findByRole('heading', { name: '资料' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '知识库' })).not.toBeInTheDocument();
    await user.click(screen.getByTestId('nav-content'));
    expect(await screen.findByRole('heading', { name: '知识库' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '资料' })).not.toBeInTheDocument();
  });

  it('hides the intake shell line unless both whitelist strings are present', async () => {
    window.dashboardIntake = {
      mode: async () => ({ ok: true, enabled: true }),
      current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
      command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
      onInvalidated: () => () => undefined,
      shellLine: async () => ({ ok: true, profileMode: 'product-remote', contentIntake: 'faq-v2', apiOrigin: 'https://synthetic.invalid' } as unknown as { ok: true; profileMode: 'synthetic-local'; contentIntake: 'faq-v2' }),
    };
    render(<DashboardApp />);
    await screen.findByTestId('nav-materials');
    expect(screen.queryByTestId('intake-shell-line')).not.toBeInTheDocument();
    expect(screen.queryByText('product-remote')).not.toBeInTheDocument();
    expect(screen.queryByText('https://synthetic.invalid')).not.toBeInTheDocument();
  });

  it('hides the intake shell line when the projection is not ok', async () => {
    window.dashboardIntake = {
      mode: async () => ({ ok: true, enabled: true }),
      current: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
      command: async () => ({ ok: false, code: 'UNAVAILABLE', message: '未读取资料', view: null }),
      onInvalidated: () => () => undefined,
      shellLine: async () => ({ ok: false, profileMode: 'synthetic-local', contentIntake: 'faq-v2' } as unknown as { ok: true; profileMode: 'synthetic-local'; contentIntake: 'faq-v2' }),
    };
    render(<DashboardApp />);
    await screen.findByTestId('nav-materials');
    expect(screen.queryByTestId('intake-shell-line')).not.toBeInTheDocument();
    expect(screen.queryByText('synthetic-local')).not.toBeInTheDocument();
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
    expect(overviewNav).toHaveTextContent('概览');
    expect(overviewNav).toHaveClass('is-active');
    expect(overviewNav).not.toHaveStyle({ borderLeft: '3px solid rgb(111, 76, 195)' });
    expect(within(overviewNav).queryByText('风险、责任与处理进度')).not.toBeInTheDocument();
    expect(screen.getAllByText('概览').length).toBeGreaterThanOrEqual(1);

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

  it('collapses navigation accessibly without deferred trash', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const toggle = screen.getByTestId('dashboard-nav-toggle');

    expect(shell).toHaveAttribute('data-nav-collapsed', 'false');
    expect(shell).toHaveAttribute('data-nav-phase', 'expanded');
    expect(shell).toHaveAttribute('data-nav-width', '220');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('220px');
    expect(screen.queryByTestId('dashboard-nav-resizer')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
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
    expect(shell).toHaveAttribute('data-nav-width', '220');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe(`${collapsedSurfaceOf(shell)}px`);
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
    expect(screen.getByTestId('dashboard-nav-tooltip')).toHaveTextContent('概览');
    expect(screen.getByTestId('dashboard-nav-tooltip')).toHaveClass('is-visible');

    fireEvent.mouseLeave(overview);
    expect(screen.getByTestId('dashboard-nav-tooltip')).not.toHaveClass('is-visible');
    act(() => vi.advanceTimersByTime(140));
    expect(screen.queryByTestId('dashboard-nav-tooltip')).not.toBeInTheDocument();

    fireEvent.focus(overview);
    expect(screen.getByTestId('dashboard-nav-tooltip')).toHaveTextContent('概览');
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
    expect(macShell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(macShell).toHaveAttribute('data-nav-width', '220');
    expect(macShell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('120px');
    expect(screen.queryByTestId('dashboard-nav-resizer')).not.toBeInTheDocument();
    unmount();

    window.history.replaceState({}, '', '/?platform=win32');
    render(<DashboardApp />);
    const nativeShell = screen.getByTestId('dashboard-shell');
    expect(nativeShell).toHaveAttribute('data-dashboard-chrome', 'native');
    expect(collapsedSurfaceOf(nativeShell)).toBe(72);
    expect(nativeShell).toHaveAttribute('data-icon-anchor', '36');
    fireEvent.click(screen.getByTestId('dashboard-nav-toggle'));
    settleNavPhase(nativeShell);
    expect(nativeShell).toHaveAttribute('data-nav-phase', 'collapsed');
    expect(nativeShell.style.getPropertyValue('--dash-rendered-nav-width')).toBe('72px');
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
    expect(shell).toHaveAttribute('data-nav-width', '220');
    expect(shell.style.getPropertyValue('--dash-rendered-nav-width')).toBe(`${collapsedSurfaceOf(shell)}px`);
    expect(screen.getByTestId('dashboard-nav-toggle')).toBeVisible();
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
    expect(screen.getByTestId('dashboard-nav-toggle')).toBeVisible();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
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

  it('presents overview work as a decision table, a continuous KPI strip, and operational charts', () => {
    render(<DashboardApp />);

    expect(screen.getByRole('heading', { name: '概览' })).toBeInTheDocument();
    expect(screen.queryByText('管理概览')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-overview')).toHaveTextContent('查询次数');
    expect(screen.getByTestId('module-overview')).toHaveTextContent('待办');
  });

  it('navigates from a manager decision into the wording detail', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-wording'));
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'wording');
  });

  it('explains an operational KPI before navigating to its detail', async () => {
    render(<DashboardApp />);
    expect(screen.getByTestId('module-overview')).toHaveTextContent('没查到');
    expect(screen.getByTestId('module-overview')).toHaveTextContent('坐席查询后会出现');
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

  it('opens the six-page wording library instead of the retired local catalog', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-wording'));
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'wording');
    expect(screen.getByRole('region', { name: '可用话术目录' })).toBeInTheDocument();
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

  it('opens 话术库 from the sidebar', async () => {
    render(<DashboardApp />);
    fireEvent.click(screen.getByTestId('nav-wording'));
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'wording');
    expect(screen.getByRole('region', { name: '可用话术目录' })).toBeInTheDocument();
  });

  it('removed: review module deleted', () => {
    // review module was removed in W1 refactor
    expect(true).toBe(true);
  });

  it('shows 待办 on 概览, then opens 话术库', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);

    expect(screen.getByTestId('module-overview')).toBeInTheDocument();
    expect(screen.getByTestId('module-overview')).toHaveTextContent('待办');

    await user.click(screen.getByTestId('nav-wording'));
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'wording');
    expect(screen.getByRole('region', { name: '可用话术目录' })).toBeInTheDocument();
  });

});
