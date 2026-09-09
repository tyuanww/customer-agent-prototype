import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryApp } from '../../src/renderer/QueryApp';
import { SYNTHETIC_SCRIPTS } from '../../src/renderer/data/synthetic-scripts';
import {
  COPY_SUCCESS_MESSAGE,
  EMPTY_QUERY_MESSAGE,
  MAX_QUERY_CHARS,
  QUERY_TOO_LONG_MESSAGE,
} from '../../src/shared/contracts';
import {
  IDENTITY_FOX_VISUAL_TRANSFORM,
  type OverlayCommand,
} from '../../src/shared/overlay-events';

const copyText = vi.fn();
const getWindowContext = vi.fn();
const openSearch = vi.fn();
const openDashboard = vi.fn();
const dismiss = vi.fn();
const reportUiPhase = vi.fn();
const reportHandoffMilestone = vi.fn();
const reportQueryLayout = vi.fn();
const resizeQueryHeight = vi.fn();
const moveFoxBy = vi.fn();
const setFoxPeek = vi.fn();
const commandListeners = new Set<(command: OverlayCommand) => void>();

function dispatchAnimationEnd(target: Element, animationName: string): void {
  const event = new Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: animationName });
  fireEvent(target, event);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function searchCleanser(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('question-input'), '澄芽氨基酸洁面怎么用');
  await user.click(screen.getByTestId('search-button'));
  await screen.findByTestId('copy-button-1');
}

describe('QueryApp', () => {
  beforeEach(() => {
    copyText.mockReset();
    getWindowContext.mockReset();
    openSearch.mockReset();
    openDashboard.mockReset();
    dismiss.mockReset();
    reportUiPhase.mockReset();
    reportHandoffMilestone.mockReset();
    reportQueryLayout.mockReset();
    resizeQueryHeight.mockReset();
    moveFoxBy.mockReset();
    setFoxPeek.mockReset();
    reportHandoffMilestone.mockResolvedValue(undefined);
    reportQueryLayout.mockImplementation(async (request: {
      sessionId: number;
      sequence: number;
      phase: 'SEARCH_INPUT' | 'RESULTS' | 'EMPTY' | 'ERROR' | 'COPIED';
      resultCount: 0 | 1 | 2 | 3;
    }) => ({
      ok: true,
      sessionId: request.sessionId,
      sequence: request.sequence,
      phase: request.phase,
      resultCount: request.resultCount,
      height: 312,
      resizeEdge: 'bottom',
    }));
    resizeQueryHeight.mockImplementation(async (request: { sessionId: number; sequence: number }) => ({
      ok: true,
      sessionId: request.sessionId,
      sequence: request.sequence,
      phase: 'RESULTS',
      resultCount: 3,
      height: 360,
      resizeEdge: 'bottom',
    }));
    commandListeners.clear();
    copyText.mockResolvedValue({ ok: true });
    openDashboard.mockResolvedValue({ ok: true });
    getWindowContext.mockResolvedValue({
      role: 'query',
      phase: 'SEARCH_INPUT',
      platform: 'darwin',
      shortcut: {
        registered: true,
        accelerator: 'CommandOrControl+Shift+Space',
        message: '',
      },
      testHarness: false,
    });
    window.customerAgent = {
      copyText,
      getWindowContext,
      openSearch,
      openDashboard,
      dismiss,
      reportUiPhase,
      reportHandoffMilestone,
      reportQueryLayout,
      resizeQueryHeight,
      moveFoxBy,
      commitFoxDragSettle: vi.fn(),
      setFoxPeek,
      onOverlayCommand(handler) {
        commandListeners.add(handler);
        return () => {
          commandListeners.delete(handler);
        };
      },
    };
  });

  function connectProduct(options: { noHit?: boolean } = {}) {
    const view = { ok: true as const, enabled: true, signedIn: true, sessionEpoch: 10, userId: 'usr_synthetic', role: 'agent' as const, authMode: 'mock' as const, expiresAt: new Date(Date.now() + 800_000).toISOString() };
    window.customerAgent!.product = { sessionStatus: vi.fn().mockResolvedValue(view), login: vi.fn().mockResolvedValue(view), logout: vi.fn(), onSessionChanged: () => () => {} };
    const search = vi.fn(async (r: import('../../src/shared/product-search').ProductSearchRequest) => ({
      ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, queryId: '11111111-1111-4111-8111-111111111111',
      hitStatus: options.noHit ? 'no_hit' as const : 'hit' as const,
      releaseId: 'rel-synthetic', telemetryStatus: 'recorded' as 'recorded' | 'collection_disabled',
      candidates: options.noHit ? [] : [{ rank: 1, release_id: 'rel-synthetic', script_id: 'script-synthetic', script_version: 1,
        content_hash: 'a'.repeat(64), title: '合成发货', category: 'presale' as const, answer_text: '合成订单 {订单号}', platform_scope: [r.platform],
        product_scope_type: 'storewide' as const, product_scope_refs: [], effective_from: '2026-01-01T00:00:00Z', effective_to: null,
        intent_taxonomy_version: 'itax_synthetic_v1', intent_id: 'intent_synthetic_shipping', risk_level: 'low' as const, risk_categories: [], has_conflict: false, placeholder_keys: ['order_id' as const] }],
    }));
    const copyAdopt = vi.fn(async (r: import('../../src/shared/product-search').ProductCopyRequest) => ({ ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, copied: true as const, eventStatus: 'recorded' as const }));
    window.customerAgent!.productSearch = { search, copyAdopt, cancelSearch: vi.fn(async r => ({ ok: true, ...r, cancelled: true })) };
    const invalidate: Array<(value: { sessionEpoch: number; reason: 'expired' }) => void> = [];
    window.customerAgent!.productAnnounce = {
      refresh: vi.fn(async r => ({ ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, releaseId: 'rel-synthetic', releaseSeq: 13,
        leaseExpiresAt: new Date(Date.now() + 600_000).toISOString(), announcement: { title: '合成公告', summary: '只读', createdAt: '2026-09-09T00:00:00.000Z' } })),
      onInvalidated(listener) { invalidate.push(listener); return () => {}; },
    };
    const escalate = vi.fn(async (r: import('../../src/shared/product-help').ProductEscalateRequest) => ({
      ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, escalateId: 'esc_synthetic',
      action: r.action, opened: true, eventStatus: 'recorded' as const,
    }));
    const recordTerminal = vi.fn(async (r: import('../../src/shared/product-help').ProductTerminalRequest) => ({
      ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, recorded: true,
    }));
    window.customerAgent!.productHelp = { escalate, recordTerminal };
    return { search, copyAdopt, invalidate, escalate, recordTerminal };
  }
  async function prepareProductQuery() {
    render(<QueryApp />); await screen.findByRole('button', { name: 'agent · 退出' });
    await screen.findByTestId('announce-banner');
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成发货问题' } });
    fireEvent.click(screen.getByTestId('search-button'));
    fireEvent.change(await screen.findByLabelText('查询平台'), { target: { value: 'qianniu' } });
  }
  it('sends explicitly selected platform and SKU to the product adapter', async () => {
    const f = connectProduct(); await prepareProductQuery();
    fireEvent.change(screen.getByLabelText('查询平台'), { target: { value: 'douyin' } });
    fireEvent.change(screen.getByLabelText('商品范围'), { target: { value: 'sku' } });
    fireEvent.change(screen.getByLabelText('合成商品标识'), { target: { value: 'sku_synthetic_blue' } });
    fireEvent.click(screen.getByTestId('search-button')); await screen.findByTestId('copy-button-1');
    expect(f.search).toHaveBeenCalledWith(expect.objectContaining({ platform: 'douyin', productContextType: 'sku', productContextRef: 'sku_synthetic_blue', platformSource: 'manual' }));
  });
  it('ignores a late product search after the question changes, without fixture fallback', async () => {
    const f = connectProduct(); await prepareProductQuery();
    const pending = deferred<Awaited<ReturnType<typeof f.search>>>(); const response = f.search.getMockImplementation()!;
    f.search.mockImplementationOnce(() => pending.promise); fireEvent.click(screen.getByTestId('search-button'));
    const request = f.search.mock.calls[0][0];
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '另一个问题' } });
    await act(async () => pending.resolve(await response(request)));
    expect(screen.queryByTestId('copy-button-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-input')).toHaveValue('另一个问题');
  });
  it.each(['unrecorded', 'disabled'] as const)('shows copy as copy when the product event is %s', async eventStatus => {
    const f = connectProduct();
    if (eventStatus === 'disabled') { const response = f.search.getMockImplementation()!; f.search.mockImplementation(async r => ({ ...await response(r), telemetryStatus: 'collection_disabled' })); }
    window.customerAgent!.productSearch!.copyAdopt = vi.fn(async (r: import('../../src/shared/product-search').ProductCopyRequest) => ({ ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, copied: true as const, eventStatus }));
    await prepareProductQuery(); fireEvent.click(screen.getByTestId('search-button')); await screen.findByTestId('copy-button-1');
    fireEvent.change(screen.getByLabelText('合成订单号'), { target: { value: 'SYNTHETIC-A' } });
    fireEvent.click(screen.getByTestId('copy-button-1')); await screen.findByTestId('toast');
    expect(screen.getByTestId('toast')).toHaveTextContent('已复制');
    if (eventStatus === 'unrecorded') expect(screen.getByTestId('toast')).toHaveTextContent('事件未记录');
    if (eventStatus === 'disabled') expect(screen.getByTestId('match-reason-1')).toHaveTextContent('不记录事件');
    expect(copyText).not.toHaveBeenCalled(); expect(f.search).toHaveBeenCalledTimes(1);
  });
  it('clears candidates when the current announcement is invalidated', async () => {
    const f = connectProduct(); await prepareProductQuery(); fireEvent.click(screen.getByTestId('search-button'));
    await screen.findByTestId('copy-button-1');
    expect(screen.getByTestId('announce-banner')).toHaveTextContent('ACK 不是已读');
    await act(async () => { f.invalidate.forEach(listener => listener({ sessionEpoch: 10, reason: 'expired' })); });
    expect(screen.queryByTestId('copy-button-1')).not.toBeInTheDocument();
    expect(screen.getByText('当前版本已失效，请重新核验')).toBeInTheDocument();
    expect(screen.queryByText('已读')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('retry-button'));
    await screen.findByTestId('announce-banner');
    expect(window.customerAgent!.productAnnounce!.refresh).toHaveBeenCalled();
  });
  it('reports a product network failure without using a matching S0 fixture', async () => {
    const f = connectProduct(); await prepareProductQuery();
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '澄芽氨基酸洁面怎么用' } });
    f.search.mockRejectedValueOnce(new Error('synthetic network failure')); fireEvent.click(screen.getByTestId('search-button'));
    await screen.findByText('查询服务暂不可用，请重试'); expect(screen.queryByTestId('copy-button-1')).not.toBeInTheDocument();
  });
  it('clears old order values on new queries and locks placeholders during copying', async () => {
    const f = connectProduct(); await prepareProductQuery(); fireEvent.click(screen.getByTestId('search-button')); await screen.findByLabelText('合成订单号');
    fireEvent.change(screen.getByLabelText('合成订单号'), { target: { value: 'SYNTHETIC-A' } });
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '第二个订单' } }); fireEvent.click(screen.getByTestId('search-button'));
    expect(await screen.findByLabelText('合成订单号')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('合成订单号'), { target: { value: 'SYNTHETIC-B' } });
    const pending = deferred<Awaited<ReturnType<typeof f.copyAdopt>>>(); const response = f.copyAdopt.getMockImplementation()!;
    f.copyAdopt.mockImplementationOnce(() => pending.promise); fireEvent.click(screen.getByTestId('copy-button-1'));
    expect(screen.getByLabelText('合成订单号')).toBeDisabled();
    expect(f.copyAdopt).toHaveBeenCalledWith(expect.objectContaining({ placeholderValues: { order_id: 'SYNTHETIC-B' } }));
    await act(async () => pending.resolve(await response(f.copyAdopt.mock.calls[0][0])));
  });

  it('offers synthetic help on no-hit without claiming a transfer', async () => {
    const f = connectProduct({ noHit: true });
    await prepareProductQuery();
    fireEvent.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('no-hit')).toHaveTextContent('没找到可用话术');
    expect(screen.getByTestId('help-status')).toHaveTextContent('待核实');
    expect(screen.queryByText('已转交成功')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('copy-contact-button'));
    await waitFor(() => expect(screen.getByTestId('help-status')).toHaveTextContent('已复制联系方式'));
    expect(f.escalate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'copy_contact', queryId: '11111111-1111-4111-8111-111111111111',
    }));
    fireEvent.click(screen.getByTestId('open-help-button'));
    await waitFor(() => expect(screen.getByTestId('help-status')).toHaveTextContent('已打开入口'));
    expect(f.escalate).toHaveBeenCalledWith(expect.objectContaining({ action: 'open_feishu' }));
    expect(f.recordTerminal).not.toHaveBeenCalled();
    expect(screen.queryByText('已转交成功')).not.toBeInTheDocument();
  });

  it('records no_hit_exit when leaving empty results and surfaces an open failure', async () => {
    const f = connectProduct({ noHit: true });
    await prepareProductQuery();
    fireEvent.click(screen.getByTestId('search-button'));
    await screen.findByTestId('no-hit-help');
    f.escalate.mockResolvedValueOnce({
      ok: true as const, sessionEpoch: 10, generation: 1, escalateId: 'esc_synthetic',
      action: 'open_feishu' as const, opened: false, eventStatus: 'recorded' as const,
    });
    fireEvent.click(screen.getByTestId('open-help-button'));
    await screen.findByText('入口未打开');
    expect(screen.getByTestId('help-status')).toHaveTextContent('待核实');
    fireEvent.click(screen.getByTestId('no-hit-exit-button'));
    expect(f.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'no_hit_exit' }));
    expect(dismiss).toHaveBeenCalled();
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'collapse', anchor: 'left', dockEdge: 'none', animate: false, handoffCenterX: 44, handoffCenterY: 44 });
      }
    });
    expect(f.recordTerminal).toHaveBeenCalledTimes(1);
  });

  it('blocks fixture search in product mode and exposes login/logout without credentials', async () => {
    const signedOut = { ok: true as const, enabled: true, signedIn: false, sessionEpoch: 1, userId: null, role: null, authMode: null, expiresAt: null };
    const signedIn = { ...signedOut, signedIn: true, userId: 'usr_synthetic_agent', role: 'agent' as const, authMode: 'mock' as const, expiresAt: new Date(Date.now() + 900_000).toISOString() };
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(signedOut),
      login: vi.fn()
        .mockResolvedValueOnce({ ...signedIn, sessionEpoch: 3 })
        .mockResolvedValueOnce({ ...signedIn, sessionEpoch: 5 }),
      logout: vi.fn().mockResolvedValue({ ...signedOut, sessionEpoch: 4 }),
      onSessionChanged: () => () => {},
    };
    render(<QueryApp />);
    expect(await screen.findByTestId('session-notice-unsigned')).toHaveTextContent('请先合成登录');
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '澄芽氨基酸洁面怎么用' } });
    fireEvent.click(screen.getByTestId('search-button'));
    expect(screen.queryByTestId('copy-button-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '合成登录' }));
    await screen.findByRole('button', { name: 'agent · 退出' });
    expect(screen.getByTestId('session-notice-success')).toHaveTextContent('合成登录成功，请确认平台和商品后查询');
    expect(screen.getByTestId('session-notice-success')).toHaveClass('is-success');
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-input')).not.toHaveAttribute('aria-invalid');
    expect(document.body.textContent).not.toContain('access_token');
    fireEvent.click(screen.getByRole('button', { name: 'agent · 退出' }));
    expect(await screen.findByTestId('session-notice-unsigned')).toHaveTextContent('已退出，请先登录');
    expect(screen.queryByTestId('session-notice-success')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '合成登录' }));
    expect(await screen.findByTestId('session-notice-success')).toHaveTextContent('合成登录成功，请确认平台和商品后查询');
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
  });

  it('restores a signed-in session without a residual invalid banner', async () => {
    connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: 'agent · 退出' });
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-notice-success')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-notice-unsigned')).not.toBeInTheDocument();
    expect(screen.queryByText('合成登录成功，请确认平台和商品后查询')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-input')).not.toHaveAttribute('aria-invalid');
  });

  it('distinguishes expiry and login failure from unsigned guidance', async () => {
    const signedOut = { ok: true as const, enabled: true, signedIn: false, sessionEpoch: 1, userId: null, role: null, authMode: null, expiresAt: null };
    const signedIn = { ...signedOut, signedIn: true, sessionEpoch: 8, userId: 'usr_synthetic_agent', role: 'agent' as const, authMode: 'mock' as const, expiresAt: new Date(Date.now() + 900_000).toISOString() };
    let listener: (value: import('../../src/shared/product-session').ProductSessionResult) => void = () => {};
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(signedIn),
      login: vi.fn().mockResolvedValue({
        ok: false as const,
        sessionEpoch: 10,
        code: 'UNAVAILABLE' as const,
        message: '服务暂不可用，请重试',
      }),
      logout: vi.fn(),
      onSessionChanged: handler => { listener = handler; return () => {}; },
    };
    render(<QueryApp />);
    await screen.findByRole('button', { name: 'agent · 退出' });
    act(() => listener({ ...signedOut, sessionEpoch: 9 }));
    expect(await screen.findByTestId('session-notice-expired')).toHaveTextContent('登录已失效，请重新登录');
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '合成登录' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '合成登录' }));
    expect(await screen.findByTestId('session-notice-failed')).toHaveTextContent('服务暂不可用，请重试');
    expect(screen.queryByTestId('session-notice-success')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-input')).not.toHaveAttribute('aria-invalid');
  });

  it('treats a restored unauthorized session as expired rather than login success', async () => {
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue({
        ok: false as const,
        sessionEpoch: 1,
        code: 'UNAUTHORIZED' as const,
        message: '请先登录，或重新登录后继续',
      }),
      login: vi.fn(),
      logout: vi.fn(),
      onSessionChanged: () => () => {},
    };
    render(<QueryApp />);
    expect(await screen.findByTestId('session-notice-expired')).toHaveTextContent('登录已失效，请重新登录');
    expect(screen.queryByTestId('session-notice-success')).not.toBeInTheDocument();
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
  });

  it('ignores delayed old session events without clearing current UI', async () => {
    const pending = deferred<import('../../src/shared/product-session').ProductSessionResult>();
    const signedOut = { ok: true as const, enabled: true, signedIn: false, sessionEpoch: 1, userId: null, role: null, authMode: null, expiresAt: null };
    const signedIn = { ...signedOut, signedIn: true, sessionEpoch: 3, userId: 'usr_synthetic_agent', role: 'agent' as const, authMode: 'mock' as const, expiresAt: new Date(Date.now() + 900_000).toISOString() };
    let listener: (value: import('../../src/shared/product-session').ProductSessionResult) => void = () => {};
    window.customerAgent!.product = { sessionStatus: () => pending.promise, login: vi.fn().mockResolvedValue(signedIn), logout: vi.fn().mockResolvedValue(signedOut), onSessionChanged: handler => { listener = handler; return () => {}; } };
    render(<QueryApp />);
    fireEvent.click(screen.getByRole('button', { name: '合成登录' }));
    await screen.findByRole('button', { name: 'agent · 退出' });
    await act(async () => { pending.resolve(signedOut); });
    act(() => listener(signedOut));
    expect(screen.getByRole('button', { name: 'agent · 退出' })).toBeInTheDocument();
    expect(screen.queryByText('请先合成登录')).not.toBeInTheDocument();
  });

  afterEach(() => {
    commandListeners.clear();
    delete window.customerAgent;
    vi.useRealTimers();
  });

  it('focuses and selects existing query text when the overlay expands', async () => {
    render(<QueryApp />);
    const input = screen.getByTestId('question-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '澄芽洁面' } });
    for (const listener of commandListeners) {
      listener({ type: 'activate-search', anchor: 'left', animate: true });
    }
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('澄芽洁面'.length);
  });

  it('reconciles passive focus when the normal opening animation finishes', () => {
    render(<QueryApp />);
    const input = screen.getByTestId('question-input') as HTMLInputElement;
    const fox = screen.getByTestId('capsule-fox') as HTMLButtonElement;
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', anchor: 'left', animate: true });
      }
    });
    fox.focus();
    expect(fox).toHaveFocus();
    dispatchAnimationEnd(document.querySelector('.glass-shell') as Element, 'query-shell-unfold');
    expect(input).toHaveFocus();
  });

  it('does not steal focus after the user interacts during opening', () => {
    render(<QueryApp />);
    const fox = screen.getByTestId('capsule-fox') as HTMLButtonElement;
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', anchor: 'left', animate: true });
      }
    });
    fireEvent.pointerDown(fox, { pointerId: 1, button: 0 });
    fox.focus();
    dispatchAnimationEnd(document.querySelector('.glass-shell') as Element, 'query-shell-unfold');
    expect(fox).toHaveFocus();
  });

  it('reconciles passive focus through the opening watchdog fallback', () => {
    vi.useFakeTimers();
    render(<QueryApp />);
    const input = screen.getByTestId('question-input') as HTMLInputElement;
    const fox = screen.getByTestId('capsule-fox') as HTMLButtonElement;
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', anchor: 'left', animate: true });
      }
    });
    fox.focus();
    expect(fox).toHaveFocus();

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(input).toHaveFocus();
  });

  it('restores native-window focus without selecting and overwriting an entered question', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    const input = screen.getByTestId('question-input') as HTMLInputElement;
    for (const listener of commandListeners) {
      listener({ type: 'activate-search', anchor: 'left', animate: false });
    }
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: '已有问题' } });
    input.setSelectionRange('已有问题'.length, '已有问题'.length);

    fireEvent(window, new Event('focus'));
    await user.keyboard('继续');

    expect(input).toHaveValue('已有问题继续');
  });

  it('synchronizes a display-driven anchor change without restarting the query session', async () => {
    render(<QueryApp />);
    const shell = screen.getByTestId('query-shell');
    const input = screen.getByTestId('question-input') as HTMLInputElement;
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', anchor: 'left', animate: false });
      }
    });
    fireEvent.change(input, { target: { value: '保留中的问题' } });

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'sync-query-anchor', anchor: 'right' });
      }
    });

    expect(shell).toHaveAttribute('data-anchor', 'right');
    expect(input).toHaveValue('保留中的问题');
  });

  it('arms the hidden shared-element frame before opening and accepts typing after a close/reopen', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    const shell = screen.getByTestId('query-shell');
    const input = screen.getByTestId('question-input');
    const clickedTransform = { a: 1.04, b: 0.08, c: -0.08, d: 1.04, e: 3, f: -4 };

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'prepare-search',
          handoffId: 11,
          anchor: 'right',
          handoffCenterX: 600,
          handoffCenterY: 44,
          foxVisualTransform: clickedTransform,
        });
      }
    });
    expect(shell).toHaveAttribute('data-parked', 'true');
    expect(shell).toHaveAttribute('data-opening', 'false');
    expect(shell.style.getPropertyValue('--query-handoff-fox-a')).toBe('1.04');
    expect(shell.style.getPropertyValue('--query-handoff-fox-b')).toBe('0.08');
    expect(shell.style.getPropertyValue('--query-handoff-fox-e')).toBe('3');
    expect(shell.style.getPropertyValue('--query-handoff-fox-f')).toBe('-4');
    await waitFor(() =>
      expect(reportHandoffMilestone).toHaveBeenCalledWith(11, 'open-armed'),
    );

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', handoffId: 11, anchor: 'right', animate: true });
      }
    });
    expect(shell).toHaveAttribute('data-parked', 'false');
    expect(shell).toHaveAttribute('data-opening', 'true');
    await waitFor(() => expect(input).toHaveFocus());
    dispatchAnimationEnd(document.querySelector('.glass-shell') as Element, 'query-shell-unfold');
    expect(reportHandoffMilestone).toHaveBeenCalledWith(11, 'open-finished');

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'collapse',
          handoffId: 12,
          anchor: 'right',
          dockEdge: 'right',
          animate: true,
          handoffCenterX: 600,
          handoffCenterY: 44,
        });
      }
    });
    expect(input).not.toHaveFocus();
    dispatchAnimationEnd(document.querySelector('.glass-shell') as Element, 'query-shell-fold');
    expect(shell).toHaveAttribute('data-parked', 'true');
    expect(reportHandoffMilestone).toHaveBeenCalledWith(12, 'close-finished');

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'prepare-search',
          handoffId: 13,
          anchor: 'right',
          handoffCenterX: 600,
          handoffCenterY: 44,
          foxVisualTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
        });
      }
    });
    await waitFor(() =>
      expect(reportHandoffMilestone).toHaveBeenCalledWith(13, 'open-armed'),
    );
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', handoffId: 13, anchor: 'right', animate: false });
      }
    });
    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard('重开立即输入');
    expect(input).toHaveValue('重开立即输入');
  });

  it('collapses when the capsule fox is clicked, but keeps drag as movement only', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    const fox = screen.getByTestId('capsule-fox');

    expect(fox).toHaveAccessibleName('点击收起查询，拖拽移动查询窗');
    expect(screen.getByTestId('query-fox-focus-ring')).toBeInTheDocument();
    await user.click(fox);
    expect(dismiss).toHaveBeenCalledTimes(1);

    dismiss.mockClear();
    fireEvent.pointerDown(fox, {
      button: 0,
      buttons: 1,
      pointerId: 7,
      screenX: 20,
      screenY: 20,
    });
    fireEvent.pointerMove(fox, {
      buttons: 1,
      pointerId: 7,
      screenX: 42,
      screenY: 36,
    });
    fireEvent.pointerUp(fox, {
      button: 0,
      buttons: 0,
      pointerId: 7,
      screenX: 42,
      screenY: 36,
    });
    expect(moveFoxBy).toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('replays entry motion and exposes an explicit mirrored closing state', async () => {
    render(<QueryApp />);
    const shell = screen.getByTestId('query-shell');

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', anchor: 'right', animate: true });
      }
    });
    await waitFor(() => expect(shell).toHaveAttribute('data-opening', 'true'));
    expect(shell).toHaveAttribute('data-anchor', 'right');
    expect(shell).toHaveAttribute('data-open-duration-ms', '260');

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'collapse', anchor: 'right', dockEdge: 'right', animate: true, handoffCenterX: 600, handoffCenterY: 44 });
      }
    });
    expect(shell).toHaveAttribute('data-opening', 'false');
    expect(shell).toHaveAttribute('data-closing', 'true');
    expect(shell).toHaveAttribute('data-close-duration-ms', '200');
  });

  it('shows an explicit empty-query hint and does not invent results', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('validation-error')).toHaveTextContent(EMPTY_QUERY_MESSAGE);
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();
    expect(reportUiPhase).toHaveBeenCalledWith('SEARCH_INPUT', 0);
  });

  it('keeps DeepSeek as an OFF disclosure-only reservation', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    const toggle = screen.getByTestId('deep-thinking-toggle');
    reportUiPhase.mockClear();

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('aria-describedby', 'deep-thinking-description');
    expect(screen.queryByTestId('deep-thinking-panel')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('deep-thinking-panel')).toHaveTextContent('DeepSeek 辅助重排预留');
    expect(screen.getByTestId('deep-thinking-panel')).toHaveTextContent(
      '当前 OFF · 未接入 · 不生成 · 不改写 · 不发送',
    );
    expect(reportUiPhase).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    expect(openDashboard).not.toHaveBeenCalled();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('question-input')).toBeInTheDocument();
  });

  it('keeps the same fixture ranking after opening the DeepSeek reservation note', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await user.type(screen.getByTestId('question-input'), '澄芽氨基酸洁面怎么用');
    await user.click(screen.getByTestId('deep-thinking-toggle'));
    await user.click(screen.getByTestId('deep-thinking-toggle'));
    await user.click(screen.getByTestId('search-button'));

    const cards = await screen.findAllByTestId(/script-card-[123]/);
    expect(cards).toHaveLength(3);
    const expectedLead = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-prod-001');
    expect(expectedLead).toBeDefined();
    expect(within(cards[0]).getByTestId('answer-text-1')).toHaveTextContent(
      expectedLead?.answerText ?? '',
    );
  });

  it('exposes distinct SEARCHING, RESULTS, COPIED and EMPTY fox states', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    const fox = screen.getByTestId('capsule-fox');

    await user.type(screen.getByTestId('question-input'), '澄芽氨基酸洁面怎么用');
    await user.click(screen.getByTestId('search-button'));
    expect(fox).toHaveAttribute('data-fox-state', 'SEARCHING');
    await screen.findByTestId('copy-button-1');
    expect(fox).toHaveAttribute('data-fox-state', 'RESULTS');
    await user.click(screen.getByTestId('copy-button-1'));
    expect(await screen.findByTestId('toast')).toHaveTextContent(COPY_SUCCESS_MESSAGE);
    expect(fox).toHaveAttribute('data-fox-state', 'COPIED');

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'collapse', anchor: 'left', dockEdge: 'none', animate: false, handoffCenterX: 44, handoffCenterY: 44 });
        listener({ type: 'activate-search', anchor: 'left', animate: true });
      }
    });
    await user.type(screen.getByTestId('question-input'), '今天中午虚构星球食堂有没有排骨汤');
    await user.click(screen.getByTestId('search-button'));
    await screen.findByTestId('no-hit');
    expect(fox).toHaveAttribute('data-fox-state', 'EMPTY');
  });

  it('does not submit while a Chinese IME composition is active', async () => {
    render(<QueryApp />);
    const input = screen.getByTestId('question-input');
    fireEvent.change(input, { target: { value: '澄' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: '澄芽氨基酸洁面怎么用' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 13 });
    expect(await screen.findByTestId('script-card-1')).toBeInTheDocument();
  });

  it('reports RESULTS with 1, 2, and 3 candidates for the demo queries', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    openQuerySession(4);

    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '面膜过敏怎么办' } });
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('script-card-1')).toBeVisible();
    expect(screen.queryByTestId('script-card-2')).not.toBeInTheDocument();
    expect(reportUiPhase).toHaveBeenCalledWith('RESULTS', 1);

    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: '澄芽洁面和雾屿精华能一起用吗' },
    });
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('script-card-2')).toBeVisible();
    expect(screen.queryByTestId('script-card-3')).not.toBeInTheDocument();
    expect(reportUiPhase).toHaveBeenCalledWith('RESULTS', 2);

    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: '澄芽氨基酸洁面怎么用' },
    });
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('script-card-3')).toBeVisible();
    expect(reportUiPhase).toHaveBeenCalledWith('RESULTS', 3);
    await waitFor(() => expect(reportQueryLayout).toHaveBeenCalled());
    const layoutRequest = reportQueryLayout.mock.calls.at(-1)?.[0] as {
      desiredHeight: number;
      phase: string;
      resultCount: number;
      sequence: number;
    };
    expect(layoutRequest.phase).toBe('RESULTS');
    expect(layoutRequest.resultCount).toBe(3);
    expect(Number.isFinite(layoutRequest.desiredHeight)).toBe(true);
    expect(layoutRequest.desiredHeight).toBeGreaterThan(0);
    expect(screen.getByTestId('query-resize-grip')).toHaveAttribute('role', 'separator');
    expect(screen.getByTestId('query-resize-grip')).toHaveAttribute('aria-orientation', 'horizontal');
    expect(screen.getByTestId('query-resize-grip')).toHaveAttribute('aria-valuenow', '312');
    expect(screen.getByTestId('query-resize-grip')).toHaveAttribute('data-edge', 'bottom');
    expect(screen.getByTestId('result-content')).toBeInTheDocument();
  });

  it('shows a stable Top 3 without numeric match scores', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);

    const list = screen.getByTestId('result-list');
    const cards = within(list).getAllByTestId(/script-card-/);
    expect(cards).toHaveLength(3);
    expect(screen.getByTestId('script-card-1')).toHaveClass('is-lead');
    expect(screen.getByTestId('match-reason-1')).toHaveTextContent('精确问法');
    expect(list.textContent).not.toContain('匹配分');
    expect(list.textContent).not.toMatch(/匹配分\s*\d+/);
    expect(copyText).not.toHaveBeenCalled();
  });

  it('renders the original synthetic aftersales wording for a natural category question', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await user.type(screen.getByTestId('question-input'), '面膜过敏怎么办');
    await user.click(screen.getByTestId('search-button'));

    const lead = await screen.findByTestId('script-card-1');
    const expected = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-after-002');
    expect(expected).toBeDefined();
    expect(within(lead).getByTestId('answer-text-1')).toHaveTextContent(
      expected?.answerText ?? '',
    );
    expect(within(lead).getByTestId('match-reason-1')).toHaveTextContent('品类问题');
    expect(screen.queryByTestId('no-hit')).not.toBeInTheDocument();
    expect(lead.textContent).not.toContain('匹配分');
  });

  it('keeps result cards mounted long enough to play the closing fade', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'collapse', anchor: 'left', dockEdge: 'none', animate: true, handoffCenterX: 44, handoffCenterY: 44 });
      }
    });

    expect(screen.getByTestId('question-input')).toHaveValue('');
    expect(screen.getByTestId('result-list')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('result-list')).not.toBeInTheDocument());
  });

  it('shows searching feedback before revealing results', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await user.type(screen.getByTestId('question-input'), '澄芽氨基酸洁面怎么用');
    await user.click(screen.getByTestId('search-button'));

    expect(screen.getByTestId('searching-indicator')).toHaveTextContent('检索中');
    expect(screen.getByTestId('query-shell')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();
    expect(await screen.findByTestId('script-card-3')).toBeVisible();
  });

  it('uses a synchronous single-flight guard for same-tick duplicate search submissions', async () => {
    render(<QueryApp />);
    const input = screen.getByTestId('question-input');
    fireEvent.change(input, { target: { value: '澄芽氨基酸洁面怎么用' } });

    fireEvent.click(screen.getByTestId('search-button'));
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });

    expect(screen.getByTestId('searching-indicator')).toBeInTheDocument();
    expect(await screen.findByTestId('script-card-3')).toBeVisible();
    expect(
      reportUiPhase.mock.calls.filter(([nextPhase]) => nextPhase === 'SEARCH_INPUT'),
    ).toHaveLength(1);
    expect(reportUiPhase.mock.calls.filter(([nextPhase]) => nextPhase === 'RESULTS')).toHaveLength(1);
  });

  it('cancels a pending search when the question changes so old results cannot mismatch the input', async () => {
    vi.useFakeTimers();
    render(<QueryApp />);
    const input = screen.getByTestId('question-input');
    fireEvent.change(input, { target: { value: '澄芽氨基酸洁面怎么用' } });
    fireEvent.click(screen.getByTestId('search-button'));
    expect(screen.getByTestId('searching-indicator')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '今天中午虚构星球食堂有没有排骨汤' } });
    expect(screen.queryByTestId('searching-indicator')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(input).toHaveValue('今天中午虚构星球食堂有没有排骨汤');
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('no-hit')).not.toBeInTheDocument();
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-phase', 'SEARCH_INPUT');
  });

  it('uses number keys to copy the matching result but never hijacks input typing', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    const second = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-prod-001-care');
    expect(second).toBeDefined();

    fireEvent.keyDown(window, { key: '2', code: 'Digit2' });
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(second?.answerText));

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'collapse', anchor: 'left', dockEdge: 'none', animate: false, handoffCenterX: 44, handoffCenterY: 44 });
      }
    });
    copyText.mockClear();
    const input = screen.getByTestId('question-input');
    fireEvent.keyDown(input, { key: '1', code: 'Digit1' });
    expect(copyText).not.toHaveBeenCalled();
  });

  it('does not hijack numeric typing when the user returns to the input from RESULTS', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    const input = screen.getByTestId('question-input');

    fireEvent.pointerDown(input);
    await user.click(input);
    await user.type(input, '1');

    expect(copyText).not.toHaveBeenCalled();
    expect(input).toHaveValue('澄芽氨基酸洁面怎么用1');
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-phase', 'SEARCH_INPUT');
    expect(reportUiPhase).toHaveBeenLastCalledWith('SEARCH_INPUT', 0);
  });

  it('supports Numpad selection while blocking repeat, modifiers, and IME key events', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    const second = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-prod-001-care');
    expect(second).toBeDefined();

    fireEvent.keyDown(window, { key: '1', code: 'Digit1', repeat: true });
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', ctrlKey: true });
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true });
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', altKey: true });
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', shiftKey: true });
    fireEvent.keyDown(window, {
      key: '1',
      code: 'Digit1',
      isComposing: true,
      keyCode: 229,
    });
    expect(copyText).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: '2', code: 'Numpad2' });
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(second?.answerText));
  });

  it('ignores a number shortcut when that result rank does not exist', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await user.type(screen.getByTestId('question-input'), '月白防晒闷痘吗');
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('script-card-2')).toBeVisible();
    expect(screen.queryByTestId('script-card-3')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: '3', code: 'Numpad3' });
    expect(copyText).not.toHaveBeenCalled();
  });

  it('auto-dismisses only after successful copy feedback', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('copy-button-1'));
    expect(await screen.findByTestId('toast')).toHaveTextContent(COPY_SUCCESS_MESSAGE);
    expect(dismiss).not.toHaveBeenCalled();
    await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1), { timeout: 1_500 });
  });

  it('locks every copy entry point during COPIED feedback', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('copy-button-1'));
    expect(await screen.findByTestId('toast')).toHaveTextContent(COPY_SUCCESS_MESSAGE);

    expect(screen.getByTestId('copy-button-2')).toBeDisabled();
    fireEvent.click(screen.getByTestId('copy-button-2'));
    fireEvent.keyDown(window, { key: '2', code: 'Digit2' });
    expect(copyText).toHaveBeenCalledTimes(1);
  });

  it('never surfaces expired campaign copy in the result list', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await user.type(screen.getByTestId('question-input'), '青禾会员日积分怎么兑');
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('no-hit')).toHaveTextContent('没找到可用话术');
    expect(screen.queryByTestId('no-hit-help')).not.toBeInTheDocument();
    expect(screen.queryByText(/QINGHE_EXPIRED_DEMO_BODY/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();
  });

  it('copies original answer text and only says 已复制', async () => {
    const user = userEvent.setup();
    const cleanser = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-prod-001');
    expect(cleanser).toBeDefined();

    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('copy-button-1'));

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(cleanser?.answerText);
    });
    expect(await screen.findByTestId('toast')).toHaveTextContent(COPY_SUCCESS_MESSAGE);
    expect(screen.queryByText('已发送')).not.toBeInTheDocument();
    expect(screen.queryByText('已采纳')).not.toBeInTheDocument();
    expect(reportUiPhase).toHaveBeenCalledWith('COPIED', 3);
  });

  it('dismisses with Esc after copy without implying the reply was sent', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('copy-button-1'));
    await screen.findByTestId('toast');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dismiss).toHaveBeenCalled();
    expect(screen.queryByText('已发送')).not.toBeInTheDocument();
  });

  it('clears customer text and transient results when the overlay collapses', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('copy-button-1'));
    await screen.findByTestId('toast');

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'collapse', anchor: 'left', dockEdge: 'none', animate: false, handoffCenterX: 44, handoffCenterY: 44 });
      }
    });

    expect(screen.getByTestId('question-input')).toHaveValue('');
    expect(screen.queryByTestId('result-pane')).not.toBeInTheDocument();
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });

  it('shows a recoverable copy error with retry', async () => {
    const user = userEvent.setup();
    copyText.mockResolvedValue({ ok: false, message: '复制失败，请重试' });
    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('copy-button-1'));
    expect(await screen.findByTestId('error-state')).toHaveTextContent('复制失败，请重试');
    expect(screen.getByTestId('retry-button')).toBeInTheDocument();
  });

  it('never auto-dismisses after a failed copy', async () => {
    const user = userEvent.setup();
    copyText.mockResolvedValue({ ok: false, message: '复制失败，请重试' });
    render(<QueryApp />);
    await searchCleanser(user);
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-button-1'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('error-state')).toHaveTextContent('复制失败，请重试');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(dismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-state')).toBeInTheDocument();
  });

  it('cancels an old success-dismiss timer when a new session opens', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-button-1'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('toast')).toHaveTextContent(COPY_SUCCESS_MESSAGE);
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'collapse', anchor: 'left', dockEdge: 'none', animate: false, handoffCenterX: 44, handoffCenterY: 44 });
        listener({ type: 'activate-search', anchor: 'left', animate: true });
      }
    });
    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: '新会话问题' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(dismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('question-input')).toHaveValue('新会话问题');
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });

  it('ignores a late copy promise after collapse and reopen', async () => {
    const user = userEvent.setup();
    const lateCopy = deferred<{ ok: true } | { ok: false; message: string }>();
    copyText.mockReturnValueOnce(lateCopy.promise);
    render(<QueryApp />);
    await searchCleanser(user);
    fireEvent.click(screen.getByTestId('copy-button-1'));

    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'collapse', anchor: 'right', dockEdge: 'none', animate: false, handoffCenterX: 556, handoffCenterY: 44 });
        listener({ type: 'activate-search', anchor: 'right', animate: true });
      }
    });
    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: '重开后的问题' },
    });
    await act(async () => {
      lateCopy.resolve({ ok: true });
      await lateCopy.promise;
      await Promise.resolve();
    });

    expect(screen.getByTestId('question-input')).toHaveValue('重开后的问题');
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-phase', 'SEARCH_INPUT');
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('rejects a 2001-character query without searching the fixture', async () => {
    render(<QueryApp />);
    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: '啊'.repeat(MAX_QUERY_CHARS + 1) },
    });
    fireEvent.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('validation-error')).toHaveTextContent(QUERY_TOO_LONG_MESSAGE);
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();
  });

  it('shows the shortcut fallback when registration failed', async () => {
    getWindowContext.mockResolvedValue({
      role: 'query',
      phase: 'SEARCH_INPUT',
      platform: 'darwin',
      shortcut: {
        registered: false,
        accelerator: 'CommandOrControl+Shift+Space',
        message: '全局快捷键 ⌘⇧空格 注册失败，可能被系统或其他软件占用。请点击狐狸头打开查询窗。',
      },
      testHarness: false,
    });
    render(<QueryApp />);
    expect(await screen.findByTestId('shortcut-fallback')).toHaveTextContent('注册失败');
  });

  it.each([
    ['darwin', '⌘⇧空格'],
    ['win32', 'Ctrl+Shift+Space'],
  ] as const)(
    'renders the %s shortcut label from the window context platform',
    async (platform, shortcutLabel) => {
      getWindowContext.mockResolvedValue({
        role: 'query',
        phase: 'SEARCH_INPUT',
        platform,
        shortcut: {
          registered: true,
          accelerator: 'CommandOrControl+Shift+Space',
          message: '',
        },
        testHarness: false,
      });

      render(<QueryApp />);

      await waitFor(() => expect(getWindowContext).toHaveBeenCalledTimes(1));
      await waitFor(() => {
        expect(document.getElementById('query-guidance')).toHaveTextContent(shortcutLabel);
      });
    },
  );

  it('measures shortcut and status banners as independent layout owners', async () => {
    getWindowContext.mockResolvedValue({
      role: 'query',
      phase: 'SEARCH_INPUT',
      platform: 'darwin',
      shortcut: {
        registered: false,
        accelerator: 'CommandOrControl+Shift+Space',
        message: '全局快捷键注册失败',
      },
      testHarness: false,
    });
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function measuredHeight(this: HTMLElement) {
        if (this.classList.contains('query-capsule')) return 88;
        if (this.classList.contains('shortcut-banner')) return 24;
        if (this.classList.contains('status-banner')) return 80;
        return 0;
      });
    const domRect = (top: number, bottom: number) => ({
      x: 0,
      y: top,
      top,
      bottom,
      left: 0,
      right: 0,
      width: 0,
      height: Math.max(0, bottom - top),
      toJSON: () => ({}),
    }) as DOMRect;
    const boundingClientRect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function measuredRect(this: HTMLElement) {
        if (this.classList.contains('query-shell')) return domRect(40, 40);
        if (this.classList.contains('shortcut-banner')) return domRect(208, 232);
        if (this.classList.contains('status-banner')) return domRect(204, 284);
        return domRect(200, 248);
      });

    try {
      const user = userEvent.setup();
      render(<QueryApp />);
      expect(await screen.findByTestId('shortcut-fallback')).toBeVisible();
      await user.type(screen.getByTestId('question-input'), '今天中午虚构星球食堂有没有排骨汤');
      await user.click(screen.getByTestId('search-button'));
      expect(await screen.findByTestId('no-hit')).toBeVisible();
      expect(screen.getByTestId('shortcut-fallback')).toBeVisible();
      await waitFor(() => {
        const emptyRequest = reportQueryLayout.mock.calls
          .map(([request]) => request as { phase: string; desiredHeight: number })
          .reverse()
          .find((request) => request.phase === 'EMPTY');
        // Intrinsic is 88 + 24 + 80 + 12 = 204. The DOM branch must instead
        // use the lower status-banner edge: 284 - shellTop 40 + 12 = 256.
        expect(emptyRequest?.desiredHeight).toBe(256);
      });
    } finally {
      boundingClientRect.mockRestore();
      offsetHeight.mockRestore();
    }
  });

  it('offers a secondary dashboard entry that does not search', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    const dashboardEntry = screen.getByTestId('open-dashboard');
    expect(dashboardEntry).toHaveAccessibleName('打开运营工作台');
    expect(dashboardEntry).toHaveAttribute('title', '打开运营工作台');
    expect(dashboardEntry).not.toHaveTextContent('工作台');
    expect(dashboardEntry.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    await user.click(dashboardEntry);
    expect(openDashboard).toHaveBeenCalledTimes(1);
    expect(copyText).not.toHaveBeenCalled();
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();
  });

  it('keeps query usable and offers retry feedback when dashboard opening fails', async () => {
    const user = userEvent.setup();
    openDashboard
      .mockResolvedValueOnce({ ok: false, message: '工作台未打开，请重试。查询窗口仍保持可用。' })
      .mockResolvedValueOnce({ ok: true });
    render(<QueryApp />);

    await user.click(screen.getByTestId('open-dashboard'));
    expect(await screen.findByTestId('error-state')).toHaveTextContent('工作台未打开，请重试');
    expect(screen.getByTestId('question-input')).toBeVisible();
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('retry-button'));
    expect(openDashboard).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
    });
  });

  it('does not pretend success when dashboard opening rejects', async () => {
    const user = userEvent.setup();
    openDashboard.mockRejectedValueOnce(new Error('dashboard failed'));
    render(<QueryApp />);

    await user.click(screen.getByTestId('open-dashboard'));
    expect(await screen.findByTestId('error-state')).toHaveTextContent('工作台未打开，请重试');
    expect(screen.getByTestId('question-input')).toBeVisible();
  });

  function openQuerySession(handoffId: number) {
    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'prepare-search',
          handoffId,
          anchor: 'left',
          handoffCenterX: 44,
          handoffCenterY: 44,
          foxVisualTransform: IDENTITY_FOX_VISUAL_TRANSFORM,
        });
      }
    });
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', handoffId, anchor: 'left', animate: false });
      }
    });
  }

  it('ignores stale layout ACKs from another session and keeps the new session waiting', async () => {
    const pending = deferred<{
      ok: boolean;
      sessionId: number;
      sequence: number;
      phase: 'RESULTS';
      resultCount: 3;
      height: number;
      resizeEdge: 'bottom';
    }>();
    reportQueryLayout.mockImplementation(() => pending.promise);
    const user = userEvent.setup();
    render(<QueryApp />);
    openQuerySession(4);
    await user.type(screen.getByTestId('question-input'), '澄芽氨基酸洁面怎么用');
    await user.click(screen.getByTestId('search-button'));
    await screen.findByTestId('script-card-1');
    await waitFor(() =>
      expect(screen.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'false'),
    );

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'query-layout-ack',
          sessionId: 1,
          sequence: 1,
          phase: 'RESULTS',
          resultCount: 3,
          height: 620,
          resizeEdge: 'bottom',
        });
      }
    });
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'false');
    expect(screen.getByTestId('query-resize-grip')).not.toHaveAttribute('aria-valuenow', '620');

    openQuerySession(9);
    await user.type(screen.getByTestId('question-input'), '澄芽氨基酸洁面怎么用');
    await user.click(screen.getByTestId('search-button'));
    await screen.findByTestId('script-card-1');
    await waitFor(() =>
      expect(screen.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'false'),
    );
    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'query-layout-ack',
          sessionId: 4,
          sequence: 2,
          phase: 'RESULTS',
          resultCount: 3,
          height: 620,
          resizeEdge: 'bottom',
        });
      }
    });
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'false');

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'query-layout-ack',
          sessionId: 9,
          sequence: 3,
          phase: 'RESULTS',
          resultCount: 3,
          height: 430,
          resizeEdge: 'top',
        });
      }
    });
    await waitFor(() =>
      expect(screen.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'true'),
    );
    expect(screen.getByTestId('query-resize-grip')).toHaveAttribute('aria-valuenow', '430');
    expect(screen.getByTestId('query-resize-grip')).toHaveAttribute('data-edge', 'top');
  });

  it('rejects a second resize pointer, rolls back cancel after height changes, then allows another drag', async () => {
    let liveHeight = 312;
    resizeQueryHeight.mockImplementation(async (request: {
      type: string;
      sessionId: number;
      sequence: number;
      deltaY?: number;
    }) => {
      if (request.type === 'update') {
        liveHeight = 400;
      }
      if (request.type === 'cancel') {
        liveHeight = 312;
      }
      return {
        ok: true,
        sessionId: request.sessionId,
        sequence: request.sequence,
        phase: 'RESULTS' as const,
        resultCount: 3 as const,
        height: liveHeight,
        resizeEdge: 'bottom' as const,
      };
    });
    const user = userEvent.setup();
    render(<QueryApp />);
    openQuerySession(4);
    await searchCleanser(user);
    await waitFor(() =>
      expect(screen.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'true'),
    );
    const grip = screen.getByTestId('query-resize-grip');
    const captured = new Set<number>();
    Object.assign(grip, {
      setPointerCapture(id: number) {
        captured.add(id);
      },
      hasPointerCapture(id: number) {
        return captured.has(id);
      },
      releasePointerCapture(id: number) {
        captured.delete(id);
      },
    });
    let pendingFrame: FrameRequestCallback | null = null;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      pendingFrame = callback;
      return 17;
    });

    fireEvent.pointerDown(grip, { button: 0, buttons: 1, pointerId: 3, screenY: 400 });
    expect(resizeQueryHeight.mock.calls.filter((call) => call[0].type === 'begin')).toHaveLength(1);
    fireEvent.pointerDown(grip, { button: 0, buttons: 1, pointerId: 4, screenY: 410 });
    expect(resizeQueryHeight.mock.calls.filter((call) => call[0].type === 'begin')).toHaveLength(1);

    fireEvent.pointerMove(grip, { buttons: 1, pointerId: 3, screenY: 460, clientY: 460 });
    expect(pendingFrame).not.toBeNull();
    act(() => pendingFrame?.(performance.now()));
    await waitFor(() => expect(resizeQueryHeight).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'update' }),
    ));
    await waitFor(() => expect(grip).toHaveAttribute('aria-valuenow', '400'));

    fireEvent.pointerCancel(grip, { pointerId: 3 });
    await waitFor(() => expect(grip).toHaveAttribute('aria-valuenow', '312'));
    expect(captured.has(3)).toBe(false);

    fireEvent.blur(window);
    fireEvent.pointerDown(grip, { button: 0, buttons: 1, pointerId: 5, screenY: 400 });
    expect(resizeQueryHeight.mock.calls.filter((call) => call[0].type === 'begin')).toHaveLength(2);
    raf.mockRestore();
  });

  it('applies a matching fallback ACK then lets the next natural layout succeed', async () => {
    const pending = deferred<{
      ok: boolean;
      sessionId: number;
      sequence: number;
      phase: 'RESULTS';
      resultCount: 3;
      height: number;
      resizeEdge: 'bottom';
    }>();
    reportQueryLayout.mockImplementation(() => pending.promise);
    const user = userEvent.setup();
    render(<QueryApp />);
    openQuerySession(4);
    await user.type(screen.getByTestId('question-input'), '澄芽氨基酸洁面怎么用');
    await user.click(screen.getByTestId('search-button'));
    await screen.findByTestId('script-card-3');
    await waitFor(() =>
      expect(screen.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'false'),
    );

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'query-layout-ack',
          sessionId: 4,
          sequence: 2,
          phase: 'EMPTY',
          resultCount: 0,
          height: 240,
          resizeEdge: 'bottom',
        });
      }
    });
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'false');

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'query-layout-ack',
          sessionId: 4,
          sequence: 2,
          phase: 'RESULTS',
          resultCount: 3,
          height: 430,
          resizeEdge: 'bottom',
        });
      }
    });
    await waitFor(() =>
      expect(screen.getByTestId('query-shell')).toHaveAttribute('data-layout-ready', 'true'),
    );
    expect(screen.getByTestId('query-resize-grip')).toHaveAttribute('aria-valuenow', '430');

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'query-layout-ack',
          sessionId: 4,
          sequence: 2,
          phase: 'RESULTS',
          resultCount: 3,
          height: 620,
          resizeEdge: 'bottom',
        });
      }
    });
    expect(screen.getByTestId('query-resize-grip')).toHaveAttribute('aria-valuenow', '430');

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'query-layout-ack',
          sessionId: 4,
          sequence: 1,
          phase: 'RESULTS',
          resultCount: 3,
          height: 340,
          resizeEdge: 'bottom',
        });
      }
    });
    expect(screen.getByTestId('query-resize-grip')).toHaveAttribute('aria-valuenow', '430');

    reportQueryLayout.mockImplementation(async (request: {
      sessionId: number;
      sequence: number;
      phase: 'RESULTS';
      resultCount: 3;
    }) => ({
      ok: true,
      sessionId: request.sessionId,
      sequence: request.sequence,
      phase: request.phase,
      resultCount: request.resultCount,
      height: 480,
      resizeEdge: 'bottom' as const,
    }));
    await user.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(reportQueryLayout).toHaveBeenCalled());
    const nextRequest = reportQueryLayout.mock.calls.at(-1)?.[0] as { sequence: number };
    expect(nextRequest.sequence).toBe(3);
    await waitFor(() =>
      expect(screen.getByTestId('query-resize-grip')).toHaveAttribute('aria-valuenow', '480'),
    );
  });

  it('cancels immediately on lostpointercapture even when buttons is still 1', async () => {
    let liveHeight = 312;
    resizeQueryHeight.mockImplementation(async (request: {
      type: string;
      sessionId: number;
      sequence: number;
    }) => {
      if (request.type === 'update') {
        liveHeight = 400;
      }
      if (request.type === 'cancel') {
        liveHeight = 312;
      }
      return {
        ok: true,
        sessionId: request.sessionId,
        sequence: request.sequence,
        phase: 'RESULTS' as const,
        resultCount: 3 as const,
        height: liveHeight,
        resizeEdge: 'bottom' as const,
      };
    });
    const user = userEvent.setup();
    render(<QueryApp />);
    openQuerySession(4);
    await searchCleanser(user);
    const grip = screen.getByTestId('query-resize-grip');
    const captured = new Set<number>();
    Object.assign(grip, {
      setPointerCapture(id: number) {
        captured.add(id);
      },
      hasPointerCapture(id: number) {
        return captured.has(id);
      },
      releasePointerCapture(id: number) {
        captured.delete(id);
      },
    });
    let pendingFrame: FrameRequestCallback | null = null;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      pendingFrame = callback;
      return 21;
    });

    fireEvent.pointerDown(grip, { button: 0, buttons: 1, pointerId: 8, screenY: 400 });
    fireEvent.pointerMove(grip, { buttons: 1, pointerId: 8, screenY: 460, clientY: 460 });
    act(() => pendingFrame?.(performance.now()));
    await waitFor(() => expect(grip).toHaveAttribute('aria-valuenow', '400'));

    fireEvent.lostPointerCapture(grip, { pointerId: 8, buttons: 1 });
    await waitFor(() => expect(grip).toHaveAttribute('aria-valuenow', '312'));
    fireEvent.pointerUp(grip, { pointerId: 8, buttons: 0 });
    fireEvent.blur(window);
    expect(resizeQueryHeight.mock.calls.filter((call) => (
      call[0].type === 'cancel' || call[0].type === 'end'
    ))).toHaveLength(1);
    expect(captured.has(8)).toBe(false);

    fireEvent.pointerDown(grip, { button: 0, buttons: 1, pointerId: 9, screenY: 400 });
    expect(resizeQueryHeight.mock.calls.filter((call) => call[0].type === 'begin')).toHaveLength(2);
    raf.mockRestore();
  });
});
