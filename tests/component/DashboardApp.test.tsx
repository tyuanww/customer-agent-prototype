import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { DASHBOARD_NAV } from '../../src/renderer/data/dashboard-manifest';

type ColorSchemeListener = (event: MediaQueryListEvent) => void;

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

function installColorSchemeMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<ColorSchemeListener>();
  const mediaQuery = {
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

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => mediaQuery),
  });

  return {
    setDark(next: boolean) {
      matches = next;
      const event = { matches, media: mediaQuery.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
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
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: TestPointerEvent,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalCustomerAgent) {
      window.customerAgent = originalCustomerAgent;
    } else {
      delete window.customerAgent;
    }
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
  });

  it('keeps demo banners and never exposes a customerAgent API', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);

    expect(window.customerAgent).toBeUndefined();
    const envBadges = screen.getByTestId('dashboard-env-badges');
    expect(within(envBadges).getAllByRole('listitem')).toHaveLength(1);
    expect(envBadges).toHaveTextContent('演示数据');
    expect(screen.getByTestId('dashboard-disclaimer')).toHaveTextContent(
      '话术正文与 VOC 明细均为合成镜像',
    );
    expect(screen.getByTestId('dashboard-disclaimer')).toHaveTextContent('无后端');
    expect(screen.getByTestId('dashboard-refresh')).toHaveTextContent('固定快照');

    await user.click(screen.getByText('演示环境'));
    const boundary = screen.getByTestId('dashboard-boundary-details');
    expect(boundary).toHaveAttribute('open');
    expect(boundary).toHaveTextContent('MOCK AUTH');
    expect(boundary).toHaveTextContent('SYNTHETIC DATA');
    expect(boundary).toHaveTextContent('NO BACKEND');
    expect(boundary).toHaveTextContent('不保存');

    await user.click(screen.getByText('查看 Demo 技术指标与数据边界'));
    expect(screen.getByTestId('adopted-disclaimer')).toBeVisible();
    expect(screen.getByTestId('adopted-disclaimer')).toHaveTextContent('不等于已发送');

    for (const item of DASHBOARD_NAV) {
      await user.click(screen.getByTestId(`nav-${item.id}`));
      expect(screen.getByTestId(`module-${item.id}`)).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', item.id);
    }
  });

  it('uses the fox brand asset and keeps navigation compact without losing module context', () => {
    render(<DashboardApp />);

    const brand = screen.getByTestId('dashboard-brand');
    expect(within(brand).getByText('客服运营工作台')).toBeInTheDocument();
    expect(within(brand).getByText('运营管理端')).toBeInTheDocument();
    expect(brand).not.toHaveTextContent('Manager Decision Desk');
    expect(screen.getByTestId('dashboard-brand-logo').querySelector('.fox-head-image')).toBeInstanceOf(
      HTMLImageElement,
    );
    expect(brand).not.toHaveTextContent('狐客服运营工作台');

    const overviewNav = screen.getByTestId('nav-overview');
    expect(overviewNav).toHaveTextContent('管理概览');
    expect(within(overviewNav).queryByText('风险、责任与处理进度')).not.toBeInTheDocument();
    expect(screen.getAllByText('管理概览')).toHaveLength(2);
  });

  it('collapses navigation accessibly and keeps the deferred trash item inert', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DashboardApp />);
    const shell = screen.getByTestId('dashboard-shell');
    const toggle = screen.getByTestId('dashboard-nav-toggle');
    const trash = screen.getByTestId('nav-workorder-trash');

    expect(shell).toHaveAttribute('data-nav-collapsed', 'false');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('折叠工作台导航');
    expect(toggle).toHaveAttribute('data-variant', 'collapse');
    const toggleGlyph = screen.getByTestId('dashboard-nav-toggle-glyph');
    expect(toggleGlyph).toHaveAttribute('aria-hidden', 'true');
    expect(toggleGlyph.querySelectorAll('svg')).toHaveLength(2);
    expect(toggleGlyph.querySelector('.dashboard-nav-toggle-icon__state.is-close')).toBeInTheDocument();
    expect(toggleGlyph.querySelector('.dashboard-nav-toggle-icon__state.is-open')).toBeInTheDocument();
    expect(toggle.querySelector('.dashboard-nav-toggle__bar')).not.toBeInTheDocument();
    expect(toggle.querySelector('input[type="checkbox"]')).not.toBeInTheDocument();
    expect(trash).toBeDisabled();
    expect(trash).toHaveAttribute('aria-disabled', 'true');
    expect(trash).toHaveAccessibleName('工单垃圾桶，二期待实施');
    expect(trash).not.toHaveAttribute('role', 'tab');
    fireEvent.click(trash);
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'overview');

    await user.click(screen.getByTestId('nav-workorders'));
    await user.click(toggle);
    expect(shell).toHaveAttribute('data-nav-collapsed', 'true');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAccessibleName('展开工作台导航');
    expect(toggle).toHaveAttribute('data-variant', 'expand-overlay');
    expect(toggleGlyph.querySelectorAll('svg')).toHaveLength(2);
    expect(toggle).not.toHaveFocus();
    expect(screen.getByTestId('dashboard-brand-logo')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'VOC / 工单洞察' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'workorders');

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(shell).toHaveAttribute('data-nav-collapsed', 'false');
    expect(toggle).toHaveAttribute('data-variant', 'collapse');
    unmount();
    render(<DashboardApp />);
    expect(screen.getByTestId('dashboard-shell')).toHaveAttribute('data-nav-collapsed', 'false');
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
    fireEvent.pointerDown(resizer, { button: 0, buttons: 1, pointerId: 7, clientX: 248 });
    expect(shell).toHaveAttribute('data-nav-resizing', 'true');
    fireEvent.pointerMove(resizer, { button: 0, buttons: 1, pointerId: 7, clientX: 280 });
    expect(pendingFrame).not.toBeNull();
    fireEvent.pointerUp(resizer, { button: 0, buttons: 0, pointerId: 7, clientX: 320 });
    expect(shell).toHaveAttribute('data-nav-resizing', 'false');
    expect(shell).toHaveAttribute('data-nav-width', '320');
    expect(resizer).toHaveAttribute('aria-valuenow', '320');
    act(() => pendingFrame?.(performance.now()));
    expect(shell).toHaveAttribute('data-nav-width', '320');
    expect(cancelFrame).toHaveBeenCalledWith(91);
    requestFrame.mockRestore();
    cancelFrame.mockRestore();

    await user.click(screen.getByTestId('dashboard-nav-toggle'));
    expect(resizer).not.toBeVisible();
    expect(resizer).toHaveAttribute('tabindex', '-1');
    await user.click(screen.getByTestId('dashboard-nav-toggle'));
    expect(shell).toHaveAttribute('data-nav-width', '320');
    expect(resizer).toBeVisible();
  });

  it('shows collapsed navigation tooltips on hover and focus, then dismisses with Escape', () => {
    vi.useFakeTimers();
    render(<DashboardApp />);
    fireEvent.click(screen.getByTestId('dashboard-nav-toggle'));
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

    expect(shell).toHaveAttribute('data-theme-mode', 'system');
    expect(shell).toHaveAttribute('data-theme', 'light');
    expect(screen.getByTestId('dashboard-theme-system')).toHaveAttribute('aria-pressed', 'true');
    expect(html.dataset.dashboardThemeMode).toBe('system');
    expect(html.dataset.dashboardTheme).toBe('light');
    expect(html.style.colorScheme).toBe('light');

    await user.click(screen.getByTestId('dashboard-theme-dark'));
    expect(shell).toHaveAttribute('data-theme-mode', 'dark');
    expect(shell).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByTestId('dashboard-theme-dark')).toHaveAttribute('aria-pressed', 'true');
    act(() => colorScheme.setDark(false));
    expect(shell).toHaveAttribute('data-theme', 'dark');

    await user.click(screen.getByTestId('dashboard-theme-light'));
    act(() => colorScheme.setDark(true));
    expect(shell).toHaveAttribute('data-theme-mode', 'light');
    expect(shell).toHaveAttribute('data-theme', 'light');

    await user.click(screen.getByTestId('dashboard-theme-system'));
    expect(shell).toHaveAttribute('data-theme-mode', 'system');
    expect(shell).toHaveAttribute('data-theme', 'dark');
    act(() => colorScheme.setDark(false));
    expect(shell).toHaveAttribute('data-theme', 'light');
    expect(html.dataset.dashboardTheme).toBe('light');
  });

  it('presents overview work as a decision table, a continuous KPI strip, and operational charts', () => {
    render(<DashboardApp />);

    expect(screen.getByRole('heading', { name: '待处理决策（3）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '数据质量与内容健康' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '检索趋势与操作终态' })).toBeInTheDocument();
    expect(screen.queryByText('今天需要你拍板')).not.toBeInTheDocument();
    expect(screen.queryByText('10 秒判断：哪里在恶化、为什么、让谁处理')).not.toBeInTheDocument();

    const decisions = screen.getByRole('table', { name: '待处理决策' });
    expect(within(decisions).getAllByRole('columnheader').map((item) => item.textContent)).toEqual([
      '优先级',
      '决策事项与影响',
      '责任与下一步',
      '状态 / 处理窗口',
      '操作',
    ]);
    expect(within(decisions).getAllByRole('row')).toHaveLength(4);
    const sourceDecision = screen.getByTestId('decision-decision-source-gap');
    expect(sourceDecision).toHaveTextContent('2 个正式来源域阻断发布链路');
    expect(sourceDecision).toHaveTextContent('Content Lead + 客服业务 Owner');
    expect(sourceDecision).toHaveTextContent('发布阻断');
    expect(sourceDecision).toHaveTextContent('G0 前关闭');

    const healthStrip = screen.getByTestId('overview-health-strip');
    expect(within(healthStrip).getAllByRole('listitem')).toHaveLength(4);
    expect(healthStrip.querySelectorAll('.dash-card')).toHaveLength(0);
    expect(screen.getByTestId('dashboard-scope')).toHaveTextContent('06/22–08/13');
    expect(screen.getByTestId('dashboard-scope')).toHaveTextContent('去标识合成镜像');
  });

  it('navigates from a manager decision into the interactive VOC view', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    const decision = screen.getByTestId('decision-decision-voc-risk');
    await user.click(within(decision).getByRole('button', { name: '查看：VOC 风险项需要归因，不看一条总均值' }));
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'workorders');
    await user.selectOptions(screen.getByTestId('voc-product-filter'), '棉片');
    await user.click(screen.getByTestId('voc-insight-foreign-matter'));
    expect(screen.getByTestId('voc-detail')).toHaveTextContent('黑点 / 头发丝');
    expect(screen.getByTestId('voc-detail')).toHaveTextContent('人工升级');
  });

  it('explains an operational KPI before navigating to its detail', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);

    await user.click(screen.getByTestId('overview-health-high-risk-voc'));
    const definition = screen.getByTestId('overview-health-definition');
    expect(definition).toHaveTextContent('工作簿结构镜像');
    expect(definition).toHaveTextContent('不等于投诉率');
    await user.click(within(definition).getByRole('button', { name: '查看明细' }));
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'workorders');
  });

  it('switches overview trend metrics, selects chart points, and explains the terminal structure', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);

    expect(screen.getByTestId('overview-trend-chart')).toBeInTheDocument();
    await user.click(screen.getByTestId('overview-trend-metric-noHitRate'));
    expect(screen.getByTestId('overview-trend-feedback')).toHaveTextContent('8.4%');
    await user.click(screen.getByTestId('overview-trend-point-0'));
    expect(screen.getByTestId('overview-trend-feedback')).toHaveTextContent('06/22–06/28');
    expect(screen.getByTestId('overview-trend-feedback')).toHaveTextContent('12.8%');

    await user.click(screen.getByTestId('overview-structure-risk_escalated'));
    expect(screen.getByTestId('overview-structure-feedback')).toHaveTextContent('风险升级');
    expect(screen.getByTestId('overview-structure-feedback')).toHaveTextContent('必须人工处理');
  });

  it('links VOC severity, Pareto, heatmap, and manager detail without exposing raw text', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-workorders'));

    await user.click(screen.getByTestId('voc-severity-risk'));
    expect(screen.getByTestId('voc-filter-status')).toHaveTextContent('1 个问题簇');
    expect(screen.getByTestId('voc-filter-status')).toHaveTextContent('148 条合成聚合');
    await user.click(screen.getByTestId('voc-heat-foreign-matter-0'));
    expect(screen.getByTestId('voc-product-filter')).toHaveValue('面膜');
    expect(screen.getByTestId('voc-detail')).toHaveTextContent('93');
    expect(screen.getByTestId('voc-detail')).toHaveTextContent('3.9%');
    expect(screen.getByTestId('voc-detail')).toHaveTextContent('人工升级');
    expect(screen.getByTestId('module-workorders')).toHaveTextContent('无客户原文');
  });

  it('applies year, month, and day VOC slices to KPIs, Pareto, heatmap, and detail', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-workorders'));

    expect(screen.getByTestId('voc-period-filter')).toHaveValue('year-2026');
    expect(screen.getByTestId('voc-period-ticket-count')).toHaveTextContent('2,400');

    await user.click(screen.getByTestId('voc-grain-month'));
    expect(screen.getByTestId('voc-period-filter')).toHaveValue('month-2026-08');
    expect(screen.getByTestId('voc-filter-status')).toHaveTextContent('2026 年 8 月（截至 13 日）');
    expect(screen.getByTestId('voc-period-ticket-count')).toHaveTextContent('820');
    expect(screen.getByTestId('voc-insight-foreign-matter')).toHaveTextContent('61');
    expect(screen.getByTestId('voc-heat-foreign-matter-0')).toHaveTextContent('39');

    await user.click(screen.getByTestId('voc-grain-day'));
    expect(screen.getByTestId('voc-period-filter')).toHaveValue('day-2026-08-13');
    expect(screen.getByTestId('voc-period-ticket-count')).toHaveTextContent('122');
    expect(screen.getByTestId('voc-insight-foreign-matter')).toHaveTextContent('10');
    expect(screen.getByTestId('voc-heat-foreign-matter-0')).toHaveTextContent('6');

    await user.selectOptions(screen.getByTestId('voc-period-filter'), 'day-2026-08-12');
    await user.selectOptions(screen.getByTestId('voc-product-filter'), '面膜');
    await user.click(screen.getByTestId('voc-severity-risk'));
    expect(screen.getByTestId('voc-filter-status')).toHaveTextContent('2026 年 8 月 12 日');
    expect(screen.getByTestId('voc-filter-status')).toHaveTextContent('1 个问题簇 / 4 条合成聚合');
    expect(screen.getByTestId('voc-detail')).toHaveTextContent('4');
    expect(screen.getByTestId('voc-heat-foreign-matter-0')).toHaveTextContent('4');

    await user.click(screen.getByTestId('voc-reset'));
    expect(screen.getByTestId('voc-grain-year')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('voc-period-filter')).toHaveValue('year-2026');
    expect(screen.getByTestId('voc-product-filter')).toHaveValue('全部产品线');
    expect(screen.getByTestId('voc-severity-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('voc-period-ticket-count')).toHaveTextContent('2,400');
  });

  it('filters the four-domain wording library and keeps missing sources visible', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-wording'));
    expect(screen.getByTestId('module-wording')).toHaveTextContent('产品话术');
    expect(screen.getByTestId('wording-detail')).toHaveTextContent('DEMO · SYNTHETIC');

    await user.click(screen.getByTestId('wording-domain-presale'));
    expect(screen.getByTestId('wording-source-readiness')).toHaveTextContent('NOT_CREATED');
    expect(screen.getByTestId('wording-source-readiness')).toHaveTextContent('UPSTREAM_AUTHORING');
    await user.selectOptions(screen.getByTestId('wording-lifecycle'), 'demo_effective');
    expect(screen.getByTestId('wording-empty')).toHaveTextContent('没有匹配');
    await user.selectOptions(screen.getByTestId('wording-lifecycle'), 'structure_sample');
    expect(screen.getByTestId('wording-list')).toHaveTextContent('结构样例 · 未发布');
  });

  it('supports roving keyboard navigation between modules', async () => {
    render(<DashboardApp />);
    const overview = screen.getByTestId('nav-overview');
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowDown' });
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('data-active-module', 'workorders');
    expect(screen.getByTestId('nav-workorders')).toHaveAttribute('aria-current', 'page');
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(screen.getByTestId('nav-workorders')).toHaveFocus();
    expect(screen.getByTestId('nav-overview')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('nav-workorders')).toHaveAttribute('tabindex', '0');
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

  it('demonstrates local announce success and recoverable failure without changing facets', () => {
    vi.useFakeTimers();
    render(<DashboardApp />);
    fireEvent.click(screen.getByTestId('nav-announce'));
    fireEvent.click(screen.getByRole('button', { name: '夜间增量公告（合成）' }));
    const outcome = screen.getByTestId('announce-push-outcome');
    const action = screen.getByTestId('announce-push-action');
    const status = screen.getByTestId('announce-push-status');
    const nightlyRow = screen.getByRole('button', { name: '夜间增量公告（合成）' }).closest('tr');

    expect(screen.getByTestId('announce-push-panel')).toHaveTextContent('不联网、不发送、不保存');
    fireEvent.change(outcome, { target: { value: 'success' } });
    fireEvent.click(action);
    expect(action).toBeDisabled();
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('未连接任何公告服务');
    act(() => vi.advanceTimersByTime(480));
    expect(status).toHaveAttribute('data-state', 'success');
    expect(status).toHaveTextContent('未发送');
    expect(nightlyRow).toHaveTextContent('未 ACK');

    fireEvent.change(outcome, { target: { value: 'error' } });
    fireEvent.click(action);
    act(() => vi.advanceTimersByTime(480));
    expect(status).toHaveAttribute('data-state', 'error');
    expect(status).toHaveTextContent('安全停止');
    expect(action).toBeEnabled();
    expect(action).toHaveTextContent('重新演练');

    fireEvent.click(screen.getByRole('button', { name: 'rel-demo-2026-08-blocked' }));
    expect(action).toBeDisabled();
    expect(outcome).toBeDisabled();
    expect(status).toHaveTextContent('尚未发布');
  });

  it('shows ledger details without a sent body and keeps publish disabled', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-ledger'));
    await user.click(screen.getByRole('button', { name: /澄芽氨基酸洁面/ }));
    expect(screen.getByTestId('ledger-detail')).toHaveTextContent('root question');
    expect(screen.getByTestId('ledger-detail')).not.toHaveTextContent('已发送');
    expect(screen.getByTestId('ledger-detail').textContent).not.toMatch(/请先取约一颗黄豆/);

    await user.click(screen.getByTestId('nav-content'));
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(screen.getByTestId('publish-disabled-reason')).toHaveTextContent(
      '演示禁用 · 正式需 owner + G0/Ddev',
    );
    await user.click(screen.getByTestId('release-rel-demo-2026-08-blocked'));
    expect(screen.getByTestId('missing-domain-block')).toHaveTextContent('缺域即阻断');
  });

  it('keeps modified, sent, and applicable offline review dimensions separate', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-review'));

    expect(screen.getByTestId('review-inference-boundary')).toHaveTextContent(
      '不能推断已发送、已采纳、未修改或回答正确',
    );
    expect(screen.getByTestId('review-dimension-panel')).toHaveTextContent('是否修改');
    await user.click(screen.getByTestId('review-outcome-rewrite'));
    expect(screen.getByTestId('review-outcome-detail')).toHaveTextContent('重写');

    await user.click(screen.getByTestId('review-dimension-sent'));
    expect(screen.getByTestId('review-dimension-panel')).toHaveTextContent('是否实际发送给客户');
    expect(screen.getByTestId('review-outcome-list')).toHaveTextContent('确认已发送');
    expect(screen.getByTestId('review-outcome-list')).toHaveTextContent('不可核验');

    await user.click(screen.getByTestId('review-dimension-applicable'));
    expect(screen.getByTestId('review-dimension-panel')).toHaveTextContent('平台、商品、活动窗口');
    expect(screen.getByTestId('review-strata')).toHaveTextContent('高风险问题');
  });

  it('keeps workorder analysis, iteration tasks, announce facets, and architecture statuses separate', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);

    await user.click(screen.getByTestId('nav-workorders'));
    expect(screen.getByTestId('workorder-no-writeback')).toHaveTextContent('不写回班牛');
    expect(screen.queryByTestId('upload-input')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('nav-iteration'));
    expect(screen.getByTestId('iteration-it-2041')).toHaveTextContent('open');
    expect(screen.getByTestId('iteration-it-2048')).toHaveTextContent('in_progress');
    expect(screen.getByTestId('iteration-it-2017')).toHaveTextContent('resolved');
    expect(screen.getByTestId('iteration-it-1992')).toHaveTextContent('wont_fix');

    await user.click(screen.getByTestId('nav-announce'));
    expect(screen.getByTestId('announce-table')).toHaveTextContent('已 ACK');
    expect(screen.getByTestId('announce-table')).toHaveTextContent('租约失效');
    expect(screen.getByTestId('announce-table')).not.toHaveTextContent('已同步');
    expect(screen.getByTestId('announce-no-synced')).toBeInTheDocument();

    await user.click(screen.getByTestId('nav-architecture'));
    expect(screen.getByTestId('arch-node-float')).toHaveTextContent('DEMO 已实现');
    expect(screen.getByTestId('arch-node-dashboard')).toHaveTextContent('视觉模拟');
    expect(screen.getByTestId('arch-node-search')).toHaveTextContent('正式未接入');
    expect(screen.getByTestId('arch-node-search')).toHaveTextContent('红线');
    expect(screen.getByTestId('arch-node-llm')).toHaveTextContent('默认关闭');
  });
});
