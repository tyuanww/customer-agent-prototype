import { emptyIntakeQueryContext } from '../../src/shared/content-intake-query';
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
  FORBIDDEN_INACCURACY_STATUS_PHRASES,
  SCRIPT_INACCURACY_ACTION_LABEL,
  SCRIPT_INACCURACY_RECORDED_STATUS,
} from '../../src/renderer/features/search/query-view';
import { productCatalogEntries } from '../../src/shared/product-catalog';
import { observeSessionJob } from '../../src/shared/product-session';
import { projectSop, startSopProgress } from '../../src/shared/sop-model';
import { ALLERGY_SOP_TREE, MISSING_ITEM_SOP_TREE } from '../../src/shared/synthetic-sops';
import { SOP_UNAVAILABLE, type QuerySopSnapshot, type SopProjection, type SopTaskSummary, type SopWindowResult, type SopDraft, type SopShowQueryRequest } from '../../src/shared/sop-window';
import type { QuerySopNavigation, QuerySopView } from '../../src/shared/query-sop-window';
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
const sopOpen = vi.fn();
const sopEntryAvailable = vi.fn();
const sopResumeAvailable = vi.fn();
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

function activateQuery(anchor: 'left' | 'right' = 'left') {
  act(() => {
    for (const listener of commandListeners) {
      listener({ type: 'activate-search', anchor, animate: false });
    }
  });
}

function activateQueryIfParked() {
  if (screen.getByTestId('query-shell').getAttribute('data-parked') === 'true') {
    activateQuery();
  }
}

async function searchCleanser(user: ReturnType<typeof userEvent.setup>) {
  activateQueryIfParked();
  await user.type(screen.getByTestId('question-input'), '澄芽氨基酸洁面怎么用');
  await user.click(screen.getByTestId('search-button'));
  await screen.findByTestId('copy-button-1');
}

function sopSnapshot(projections: readonly SopProjection[], view: QuerySopView, sequence: number, viewEpoch = sequence): Extract<QuerySopSnapshot, { kind: 'ready' }> {
  const tasks: SopTaskSummary[] = projections.map((projection, index) => ({
    taskId: projection.taskId, displayName: null, ordinal: Number(/^task-(\d+)$/.exec(projection.taskId)?.[1]) || index + 1, revision: projection.revision, sceneId: projection.sceneId,
    sceneTitle: projection.sceneTitle, taskTitle: projection.taskTitle, stepIndex: projection.stepIndex, waiting: projection.waiting,
  }));
  const shared = { sequence, copyGeneration: 0, viewEpoch, tasks, transition: null };
  if (view.kind === 'sop') {
    const projection = projections.find(item => item.taskId === view.taskId);
    if (!projection) throw new Error('SOP test view must have a matching task');
    return { kind: 'ready', ...shared, mode: 'query', access: { kind: 'executable', hostEpoch: viewEpoch }, view, projection };
  }
  return { kind: 'ready', ...shared, mode: 'query', access: { kind: 'none' }, view, projection: null };
}

function connectSop() {
  const api = window.customerAgent?.sopWindow;
  if (!api) throw new Error('Missing SOP API');
  let state: QuerySopSnapshot = sopSnapshot([], { kind: 'query-home' }, 1);
  let projections: SopProjection[] = [];
  let ordinal = 0;
  let sequence = 1;
  let nextDraftId = 0;
  const drafts = new Map<string, SopDraft>();
  let listener: ((value: QuerySopSnapshot) => void) | undefined;
  const publish = (value: QuerySopSnapshot) => {
    state = value;
    if (value.kind === 'ready') {
      sequence = Math.max(sequence, value.sequence);
      if (value.projection) {
        const projected = value.projection;
        projections = projections.some(item => item.taskId === projected.taskId)
          ? projections.map(item => item.taskId === projected.taskId ? projected : item)
          : [...projections, projected];
      }
      projections = projections.filter(item => value.tasks.some(task => task.taskId === item.taskId));
      for (const taskId of drafts.keys()) if (!value.tasks.some(task => task.taskId === taskId)) drafts.delete(taskId);
    }
    listener?.(value);
  };
  const current = vi.fn(async () => state);
  const navigate = vi.fn(async (request: QuerySopNavigation): Promise<SopWindowResult> => {
    if (state.kind !== 'ready' || state.viewEpoch !== request.viewEpoch) return { ok: false, code: 'INVALID', message: '视图已变化，请重试' };
    if (request.type === 'home' || request.type === 'results') {
      publish(sopSnapshot(projections, { kind: request.type === 'home' ? 'query-home' : 'query-results' }, ++sequence));
    } else if (request.type === 'restore') {
      const task = projections.find(item => item.taskId === request.taskId && item.revision === request.revision);
      if (!task) return { ok: false, code: 'INVALID', message: '待办已变化，请重新选择' };
      publish(sopSnapshot(projections, { kind: 'sop', taskId: task.taskId }, ++sequence));
    }
    return { ok: true };
  });
  api.current = current;
  api.draftCurrent = async ({ taskId }) => ({ ok: true, draft: drafts.get(taskId) ?? null });
  api.draftStart = async ({ taskId, revision }) => {
    const task = state.kind === 'ready' ? state.tasks.find(item => item.taskId === taskId) : undefined;
    if (!task || task.revision !== revision) return { ok: false };
    const draft = drafts.get(taskId) ?? { draftId: ++nextDraftId, revision, initialName: task.displayName,
      value: task.displayName ?? `${task.sceneTitle} #${task.ordinal}`, sequence: 0 };
    drafts.set(taskId, draft);
    return { ok: true, draft };
  };
  api.draftUpdate = async ({ taskId, draftId, sequence: draftSequence, value }) => {
    const draft = drafts.get(taskId);
    if (!draft || draft.draftId !== draftId || draftSequence <= draft.sequence) return false;
    drafts.set(taskId, { ...draft, sequence: draftSequence, value });
    return true;
  };
  api.draftDiscard = async ({ taskId, draftId }) => {
    if (drafts.get(taskId)?.draftId !== draftId) return false;
    drafts.delete(taskId);
    return true;
  };
  api.navigate = navigate;
  api.onProjection = callback => { listener = callback; return () => { listener = undefined; }; };
  api.windowIntent = vi.fn(async () => true);
  api.command = vi.fn(async (request): Promise<SopWindowResult> => {
    if (request.type !== 'end' || state.kind !== 'ready') return { ok: false, code: 'INVALID', message: '流程操作无效' };
    const task = projections.find(item => item.taskId === request.taskId && item.revision === request.revision && item.stepIndex === request.stepIndex);
    if (!task) return { ok: false, code: 'INVALID', message: '步骤已变化，请按当前步骤操作' };
    projections = projections.filter(item => item.taskId !== request.taskId);
    const view = state.view.kind === 'sop' && state.view.taskId === request.taskId ? { kind: 'query-home' as const } : state.view;
    publish(sopSnapshot(projections, view, ++sequence));
    return { ok: true };
  });
  api.endTask = request => api.command!({ ...request, type: 'end', hostEpoch: 1 });
  sopOpen.mockImplementation(async (sceneId: string): Promise<SopWindowResult> => {
    const tree = sceneId === MISSING_ITEM_SOP_TREE.sceneId ? MISSING_ITEM_SOP_TREE : ALLERGY_SOP_TREE;
    const projection = projectSop({ tree, progress: startSopProgress(tree), role: 'agent', taskId: `task-${++ordinal}`, revision: 1 });
    projections = [...projections, projection];
    publish(sopSnapshot(projections, { kind: 'sop', taskId: projection.taskId }, ++sequence));
    return { ok: true };
  });
  return { api, current, navigate, publish, snapshot: () => state, readState: (value: QuerySopSnapshot) => { state = value; } };
}

describe('QueryApp', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true,
    } satisfies MediaQueryList));
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
    sopOpen.mockReset();
    sopEntryAvailable.mockReset();
    sopResumeAvailable.mockReset();
    sopOpen.mockResolvedValue({ ok: true });
    sopEntryAvailable.mockResolvedValue(true);
    sopResumeAvailable.mockResolvedValue(false);
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
      sopWindow: {
        open: sopOpen,
        entryAvailable: sopEntryAvailable,
        resumeAvailable: sopResumeAvailable,
      },
      onOverlayCommand(handler) {
        commandListeners.add(handler);
        return () => {
          commandListeners.delete(handler);
        };
      },
    };
  });

  function connectProduct(options: { noHit?: boolean; searchAllowed?: boolean } = {}) {
    const view = { ok: true as const, enabled: true, signedIn: true, sessionEpoch: 10, userId: 'usr_synthetic', role: 'agent' as const, authMode: 'mock' as const, expiresAt: new Date(Date.now() + 800_000).toISOString(), displayName: 'synthetic',
      // The search entry reads this bit, which the server derives from the query source set.
      // Omitting it would leave the default job unresolved and exercise a different branch.
      job: observeSessionJob({ title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }],
        actions: { query: options.searchAllowed !== false, import: false, publish: false, rollback: false } }) };
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(view),
      login: vi.fn().mockResolvedValue(view),
      logout: vi.fn(),
      currentNotice: vi.fn().mockResolvedValue({
        ok: false as const,
        code: 'GONE' as const,
        sessionEpoch: view.sessionEpoch,
        message: '登录请求已过期，请重试',
      }),
      decideNotice: vi.fn(),
      onSessionChanged: () => () => {},
    };
    const search = vi.fn(async (r: import('../../src/shared/product-search').ProductSearchRequest) => ({
      ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, queryId: '11111111-1111-4111-8111-111111111111',
      hitStatus: options.noHit ? 'no_hit' as const : 'hit' as const,
      releaseId: 'rel-synthetic', telemetryStatus: 'recorded' as 'recorded' | 'collection_disabled',
      candidates: options.noHit ? [] : [{ rank: 1, release_id: 'rel-synthetic', script_id: 'script-synthetic', script_version: 1,
        content_hash: 'a'.repeat(64), title: '合成发货', category: 'presale' as const, answer_text: '合成订单 {订单号}',
        platform_scope: (r.platform === 'douyin' ? ['douyin'] : r.platform === 'qianniu' ? ['qianniu'] : ['qianniu', 'douyin']) as Array<'qianniu' | 'douyin'>,
        product_scope_type: 'storewide' as const, product_scope_refs: [], effective_from: '2026-01-01T00:00:00Z', effective_to: null,
        intent_taxonomy_version: 'itax_synthetic_v1', intent_id: 'intent_synthetic_shipping', risk_level: 'low' as const, risk_categories: [], has_conflict: false, placeholder_keys: ['order_id' as const] }],
    }));
    const copyAdopt = vi.fn(async (r: import('../../src/shared/product-search').ProductCopyRequest) => ({ ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, copied: true as const, eventStatus: 'recorded' as const }));
    window.customerAgent!.productSearch = {
      search, copyAdopt, cancelSearch: vi.fn(async r => ({ ok: true, ...r, cancelled: true })),
      retrievalPreference: vi.fn(async () => ({ smartEnabled: true })),
      setRetrievalPreference: vi.fn(async (next) => next),
    };
    const invalidate: Array<(value: { sessionEpoch: number; reason: 'expired' | 'replaced' | 'signed_out' | 'unavailable' | 'source_gate' }) => void> = [];
    const contentUpdated: Array<(value: import('../../src/shared/product-announce').ProductAnnounceContentUpdate) => void> = [];
    window.customerAgent!.productAnnounce = {
      refresh: vi.fn(async r => ({ ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, releaseId: 'rel-synthetic', releaseSeq: 13,
        leaseExpiresAt: new Date(Date.now() + 600_000).toISOString(), announcement: { title: '合成公告', summary: '只读', createdAt: '2026-09-09T00:00:00.000Z' } })),
      onInvalidated(listener) { invalidate.push(listener); return () => {}; },
      onContentUpdated(listener) { contentUpdated.push(listener); return () => {}; },
      unread: vi.fn(async () => ({ ok: true as const, signedIn: true as const, unread: false, domains: [] as const })),
      markRead: vi.fn(async () => {}),
    };
    const escalate = vi.fn(async (r: import('../../src/shared/product-help').ProductEscalateRequest) => ({
      ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, escalateId: 'esc_synthetic',
      action: r.action, opened: true, eventStatus: 'recorded' as const,
    }));
    const recordTerminal = vi.fn(async (r: import('../../src/shared/product-help').ProductTerminalRequest) => ({
      ok: true as const, sessionEpoch: r.sessionEpoch, generation: r.generation, recorded: true,
    }));
    window.customerAgent!.productHelp = { escalate, recordTerminal };
    window.customerAgent!.productCatalog = {
      list: vi.fn().mockResolvedValue({ ok: true as const, entries: productCatalogEntries() }),
    };
    return { search, copyAdopt, invalidate, contentUpdated, escalate, recordTerminal };
  }
  async function prepareProductQuery() {
    render(<QueryApp />); await screen.findByRole('button', { name: /· 退出$/ });
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成发货问题' } });
    fireEvent.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(window.customerAgent!.productSearch!.search).toHaveBeenCalled());
  }
  it('refreshes the announcement before every product search', async () => {
    connectProduct();
    await prepareProductQuery();
    const refresh = window.customerAgent!.productAnnounce!.refresh as ReturnType<typeof vi.fn>;
    const before = refresh.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(before));
  });

  it('searches storewide after login without platform or product pickers', async () => {
    const f = connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    expect(screen.queryByTestId('announce-banner')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成发货问题' } });
    fireEvent.click(screen.getByTestId('search-button'));
    await screen.findByTestId('copy-button-1');
    expect(f.search).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'all', productUnscoped: false, productContextType: null, productContextRef: null, platformSource: 'manual',
    }));
    expect(screen.queryByLabelText('查询平台')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('商品范围')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('查询品类')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('查询具体款')).not.toBeInTheDocument();
  });
  it('ignores a late product search after the question changes, without fixture fallback', async () => {
    const f = connectProduct(); await prepareProductQuery();
    f.search.mockClear();
    const pending = deferred<Awaited<ReturnType<typeof f.search>>>(); const response = f.search.getMockImplementation()!;
    f.search.mockImplementationOnce(() => pending.promise); fireEvent.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(f.search).toHaveBeenCalled());
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
    await prepareProductQuery(); await screen.findByTestId('copy-button-1');
    fireEvent.change(screen.getByLabelText('订单号'), { target: { value: 'SYNTHETIC-A' } });
    fireEvent.click(screen.getByTestId('copy-button-1')); await screen.findByTestId('toast');
    expect(screen.getByTestId('toast')).toHaveTextContent('已复制');
    if (eventStatus === 'unrecorded') expect(screen.getByTestId('toast')).toHaveTextContent('事件未记录');
    if (eventStatus === 'disabled') expect(screen.getByTestId('match-reason-1')).toHaveTextContent('不记录事件');
    expect(copyText).not.toHaveBeenCalled(); expect(f.search).toHaveBeenCalledTimes(1);
  });
  it('does not treat source_gate as an expired announcement during search', async () => {
    const f = connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    const input = screen.getByTestId('question-input');
    fireEvent.change(input, { target: { value: '什么时候发货' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await act(async () => { f.invalidate.forEach(listener => listener({ sessionEpoch: 10, reason: 'source_gate' })); });
    expect(screen.queryByText('当前版本已失效，请重新核验')).not.toBeInTheDocument();
    expect(screen.getByText('内容暂不可用，请联系话术师核实')).toBeInTheDocument();
  });

  it('shows unavailable copy instead of a blank overlay when announce drops during search', async () => {
    const f = connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '什么时候发货' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await act(async () => { f.invalidate.forEach(listener => listener({ sessionEpoch: 10, reason: 'unavailable' })); });
    expect(screen.queryByText('当前版本已失效，请重新核验')).not.toBeInTheDocument();
    expect(screen.getByText('服务暂不可用，请重试')).toBeInTheDocument();
  });

  it('does not treat a replaced session epoch as an expired announcement', async () => {
    const f = connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    await act(async () => { f.invalidate.forEach(listener => listener({ sessionEpoch: 10, reason: 'replaced' })); });
    expect(screen.queryByText('当前版本已失效，请重新核验')).not.toBeInTheDocument();
    expect(screen.queryByTestId('announce-banner')).not.toBeInTheDocument();
  });
  it('clears candidates when the current announcement is invalidated', async () => {
    const f = connectProduct(); await prepareProductQuery(); fireEvent.click(screen.getByTestId('search-button'));
    await screen.findByTestId('copy-button-1');
    expect(screen.queryByTestId('announce-banner')).not.toBeInTheDocument();
    await act(async () => { f.invalidate.forEach(listener => listener({ sessionEpoch: 10, reason: 'expired' })); });
    expect(screen.queryByTestId('copy-button-1')).not.toBeInTheDocument();
    expect(screen.getByText('当前版本已失效，请重新核验')).toBeInTheDocument();
    expect(screen.queryByText('已读')).not.toBeInTheDocument();
    const refresh = window.customerAgent!.productAnnounce!.refresh as ReturnType<typeof vi.fn>;
    refresh.mockClear();
    fireEvent.click(screen.getByTestId('retry-button'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText('ACK 不是已读')).not.toBeInTheDocument();
  });
  it('keeps an idle signed-in overlay on the announce slot when the lease expires', async () => {
    const f = connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    expect(screen.queryByText('ACK 不是已读')).not.toBeInTheDocument();
    expect(screen.queryByTestId('announce-banner')).not.toBeInTheDocument();
    await act(async () => { f.invalidate.forEach(listener => listener({ sessionEpoch: 10, reason: 'expired' })); });
    expect(screen.getByTestId('announce-banner')).toHaveTextContent('当前版本已失效，请重新核验');
    expect(screen.getByTestId('announce-banner')).toHaveClass('is-invalid');
    expect(screen.queryByText('查询未完成')).not.toBeInTheDocument();
    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument();
  });
  it('keeps Top 3 and shows a muted banner when the release changes mid-conversation', async () => {
    const f = connectProduct();
    await prepareProductQuery();
    fireEvent.click(screen.getByTestId('search-button'));
    await screen.findByTestId('copy-button-1');
    const before = screen.getByTestId('answer-text-1').textContent;
    act(() => {
      f.contentUpdated.forEach(listener => listener({
        sessionEpoch: 10,
        releaseId: 'rel_25',
        summary: '售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用',
        domainHashes: { product: 'p', campaign: 'c', presale: 's2', aftersale: 'a' },
        unreadDomains: ['presale'],
      }));
    });
    // 软更新不得抽空 Top 3。
    expect(screen.getByTestId('copy-button-1')).toBeInTheDocument();
    expect(screen.getByTestId('answer-text-1').textContent).toBe(before);
    const banner = screen.getByTestId('announce-content-updated-banner');
    expect(banner).toHaveTextContent('售前话术已更新');
    expect(banner).toHaveClass('is-muted');
    expect(banner).not.toHaveClass('is-invalid');
    expect(screen.queryByTestId('announce-banner')).not.toBeInTheDocument();
    // 横幅可关：点「知道了」即已读并清掉。
    const markRead = window.customerAgent!.productAnnounce!.markRead as ReturnType<typeof vi.fn>;
    markRead.mockClear();
    fireEvent.click(screen.getByTestId('announce-content-updated-dismiss'));
    expect(markRead).toHaveBeenCalledWith(['presale']);
    expect(screen.queryByTestId('announce-content-updated-banner')).not.toBeInTheDocument();
    // 关掉后 Top 3 仍在。
    expect(screen.getByTestId('copy-button-1')).toBeInTheDocument();
  });

  it('does not mark read while the window is hidden, then marks read after it becomes visible', async () => {
    const f = connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    const markRead = window.customerAgent!.productAnnounce!.markRead as ReturnType<typeof vi.fn>;
    const fire = (domains: readonly string[]) => act(() => {
      f.contentUpdated.forEach(listener => listener({
        sessionEpoch: 10, releaseId: 'rel_25', summary: null,
        domainHashes: { product: 'p', campaign: 'c', presale: 's2', aftersale: 'a' },
        unreadDomains: domains as import('../../src/shared/library-delta').LibraryDomain[],
      }));
    });

    vi.useFakeTimers();
    markRead.mockClear();
    // 收起（隐藏）状态下到达：横幅被记住，但不排已读计时。
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'collapse', anchor: 'left', dockEdge: 'none', animate: false, handoffCenterX: 44, handoffCenterY: 44 });
      }
    });
    fire(['presale']);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
    expect(markRead).not.toHaveBeenCalled();

    // 展开后 1s 内自动清点（补排计时器，不卡住）。
    vi.useRealTimers();
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', anchor: 'left', animate: false });
      }
    });
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(['presale']), { timeout: 2_000 });
    expect(screen.queryByTestId('announce-content-updated-banner')).not.toBeInTheDocument();
  });

  it('does not mark read while document.hidden, then arms the 1s timer after visibilitychange', async () => {
    const f = connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    act(() => {
      for (const listener of commandListeners) {
        listener({ type: 'activate-search', anchor: 'left', animate: false });
      }
    });
    const markRead = window.customerAgent!.productAnnounce!.markRead as ReturnType<typeof vi.fn>;
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    try {
      vi.useFakeTimers();
      markRead.mockClear();
      act(() => {
        f.contentUpdated.forEach((listener) => listener({
          sessionEpoch: 10, releaseId: 'rel_25', summary: null,
          domainHashes: { product: 'p', campaign: 'c', presale: 's2', aftersale: 'a' },
          unreadDomains: ['presale'],
        }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
      expect(markRead).not.toHaveBeenCalled();
      hidden = false;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
      expect(markRead).toHaveBeenCalledWith(['presale']);
    } finally {
      vi.useRealTimers();
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    }
  });

  it('still clears results and shows is-invalid on an expired announcement, never on content-updated', async () => {
    const f = connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    act(() => {
      f.contentUpdated.forEach(listener => listener({
        sessionEpoch: 10, releaseId: 'rel_25', summary: null,
        domainHashes: { product: 'p', campaign: 'c', presale: 's2', aftersale: 'a' },
        unreadDomains: ['presale'],
      }));
    });
    // content-updated 是软信号：不抽空、以 muted 展示。
    expect(screen.getByTestId('announce-content-updated-banner')).toHaveClass('is-muted');
    expect(screen.queryByTestId('announce-banner')).not.toBeInTheDocument();
    await act(async () => { f.invalidate.forEach(listener => listener({ sessionEpoch: 10, reason: 'expired' })); });
    expect(screen.getByTestId('announce-banner')).toHaveTextContent('当前版本已失效，请重新核验');
    expect(screen.getByTestId('announce-banner')).toHaveClass('is-invalid');
    expect(screen.queryByTestId('announce-content-updated-banner')).not.toBeInTheDocument();
  });

  it('reports a product network failure without using a matching S0 fixture', async () => {
    const f = connectProduct(); await prepareProductQuery();
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '澄芽氨基酸洁面怎么用' } });
    f.search.mockRejectedValueOnce(new Error('synthetic network failure')); fireEvent.click(screen.getByTestId('search-button'));
    await screen.findByText('查询服务暂不可用，请重试'); expect(screen.queryByTestId('copy-button-1')).not.toBeInTheDocument();
  });
  it('clears old order values on new queries and locks placeholders during copying', async () => {
    const f = connectProduct(); await prepareProductQuery(); fireEvent.click(screen.getByTestId('search-button')); await screen.findByLabelText('订单号');
    fireEvent.change(screen.getByLabelText('订单号'), { target: { value: 'SYNTHETIC-A' } });
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '第二个订单' } }); fireEvent.click(screen.getByTestId('search-button'));
    expect(await screen.findByLabelText('订单号')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('订单号'), { target: { value: 'SYNTHETIC-B' } });
    const pending = deferred<Awaited<ReturnType<typeof f.copyAdopt>>>(); const response = f.copyAdopt.getMockImplementation()!;
    f.copyAdopt.mockImplementationOnce(() => pending.promise); fireEvent.click(screen.getByTestId('copy-button-1'));
    expect(screen.getByLabelText('订单号')).toBeDisabled();
    expect(f.copyAdopt).toHaveBeenCalledWith(expect.objectContaining({ placeholderValues: { order_id: 'SYNTHETIC-B' } }));
    await act(async () => pending.resolve(await response(f.copyAdopt.mock.calls[0][0])));
  });

  it('shows the denial sentence and no results when the query bit is false', async () => {
    // The plan's fourth button is search. A closed query source set must not run a search at
    // all, and it must say why instead of showing the ordinary no-hit sentence.
    // prepareProductQuery waits for a search call, so this drives the two steps itself.
    const f = connectProduct({ searchAllowed: false });
    render(<QueryApp />); await screen.findByRole('button', { name: /· 退出$/ });
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成发货问题' } });
    fireEvent.click(screen.getByTestId('search-button'));
    expect(await screen.findByText('没有权限，请找人开通。')).toBeInTheDocument();
    // The IPC search never ran, so nothing could leak from an unfiltered read.
    expect(f.search).not.toHaveBeenCalled();
    expect(screen.queryByTestId('no-hit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('copy-button-1')).not.toBeInTheDocument();
  });

  it('offers synthetic help on no-hit without claiming a transfer', async () => {
    const f = connectProduct({ noHit: true });
    await prepareProductQuery();
    fireEvent.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('no-hit')).toHaveTextContent('没找到可用话术');
    expect(screen.getByTestId('help-status')).toHaveTextContent('待核实');
    expect(screen.queryByTestId('report-inaccuracy-button-1')).not.toBeInTheDocument();
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
    const signedOut = { ok: true as const, enabled: true, signedIn: false, sessionEpoch: 1, userId: null, role: null, authMode: null, expiresAt: null, displayName: null, job: null };
    const signedIn = { ...signedOut, signedIn: true, userId: 'usr_synthetic_agent', role: 'agent' as const, authMode: 'mock' as const, expiresAt: new Date(Date.now() + 900_000).toISOString(), displayName: 'synthetic_agent' };
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(signedOut),
      login: vi.fn()
        .mockResolvedValueOnce({ ...signedIn, sessionEpoch: 3 })
        .mockResolvedValueOnce({ ...signedIn, sessionEpoch: 5 }),
      logout: vi.fn().mockResolvedValue({ ...signedOut, sessionEpoch: 4 }),
      onSessionChanged: () => () => {},
    };
    render(<QueryApp />);
    expect(screen.getByTestId('question-input')).toHaveAttribute('placeholder', '登录后查询话术');
    expect(screen.queryByTestId('session-notice-unsigned')).not.toBeInTheDocument();
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '澄芽氨基酸洁面怎么用' } });
    fireEvent.click(screen.getByTestId('search-button'));
    expect(screen.queryByTestId('copy-button-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await screen.findByRole('button', { name: /· 退出$/ });
    expect(screen.getByTestId('question-input')).toHaveAttribute('placeholder', '输入或粘贴客户问题，回车查询');
    expect(screen.queryByTestId('session-notice-success')).not.toBeInTheDocument();
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-input')).not.toHaveAttribute('aria-invalid');
    expect(document.body.textContent).not.toContain('access_token');
    fireEvent.click(screen.getByRole('button', { name: /· 退出$/ }));
    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByTestId('question-input')).toHaveAttribute('placeholder', '登录后查询话术');
    expect(screen.queryByTestId('session-notice-success')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('button', { name: /· 退出$/ })).toBeInTheDocument();
    expect(screen.getByTestId('question-input')).toHaveAttribute('placeholder', '输入或粘贴客户问题，回车查询');
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
  });

  it('shows the release banner after login instead of a failed query', async () => {
    const signedOut = { ok: true as const, enabled: true, signedIn: false, sessionEpoch: 1, userId: null, role: null, authMode: null, expiresAt: null, displayName: null, job: null };
    const signedIn = {
      ...signedOut,
      signedIn: true,
      sessionEpoch: 3,
      userId: 'usr_synthetic_agent',
      role: 'agent' as const,
      authMode: 'mock' as const,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      displayName: 'synthetic_agent',
    };
    let sessionListener: (value: import('../../src/shared/product-session').ProductSessionResult) => void = () => {};
    const invalidate: Array<(value: { sessionEpoch: number; reason: 'signed_out' | 'expired' | 'unavailable' | 'replaced' | 'source_gate' }) => void> = [];
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(signedOut),
      login: vi.fn().mockImplementation(async () => {
        sessionListener({ ...signedOut, sessionEpoch: 2 });
        invalidate.forEach((listener) => listener({ sessionEpoch: 2, reason: 'signed_out' }));
        sessionListener(signedIn);
        return signedIn;
      }),
      logout: vi.fn(),
      onSessionChanged: (handler) => {
        sessionListener = handler;
        return () => {};
      },
    };
    window.customerAgent!.productAnnounce = {
      refresh: vi.fn(async (r) => ({
        ok: true as const,
        sessionEpoch: r.sessionEpoch,
        generation: r.generation,
        releaseId: 'rel_18',
        releaseSeq: 18,
        leaseExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        announcement: { title: '合成栈种子发布', summary: 'synthetic stack seed', createdAt: '2026-09-09T00:00:00.000Z' },
      })),
      onInvalidated(listener) {
        invalidate.push(listener);
        return () => {};
      },
      onContentUpdated() { return () => {}; },
      unread: vi.fn(async () => ({ ok: true as const, signedIn: true as const, unread: false, domains: [] as const })),
      markRead: vi.fn(async () => {}),
    };
    render(<QueryApp />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await screen.findByRole('button', { name: /· 退出$/ });
    expect(screen.queryByTestId('announce-banner')).not.toBeInTheDocument();
    expect(screen.queryByText('ACK 不是已读')).not.toBeInTheDocument();
    expect(screen.queryByText('查询未完成')).not.toBeInTheDocument();
    expect(screen.queryByText('当前版本已失效，请重新核验')).not.toBeInTheDocument();
  });

  it('restores a signed-in session without a residual invalid banner', async () => {
    connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-notice-success')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-notice-unsigned')).not.toBeInTheDocument();
    expect(screen.queryByText('合成登录成功，可以直接查询')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-input')).not.toHaveAttribute('aria-invalid');
  });

  it('does not show the collection notice dialog and does not require a decision before search', async () => {
    const f = connectProduct();
    window.customerAgent!.product!.currentNotice = vi.fn().mockResolvedValue({
      ok: true as const,
      sessionEpoch: 10,
      notice: {
        version: 'pilot-notice-v1',
        content: '服务器下发的正式告知正文',
        content_hash: 'a'.repeat(64),
        published_at: '2026-09-30T00:00:00.000Z',
      },
      decision: null,
      decided_at: null,
    });
    window.customerAgent!.product!.decideNotice = vi.fn();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    expect(screen.queryByTestId('notice-backdrop')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成发货问题' } });
    fireEvent.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(f.search).toHaveBeenCalled());
    expect(window.customerAgent!.product!.decideNotice).not.toHaveBeenCalled();
  });

  it('lets search run while the collection notice is still loading', async () => {
    const f = connectProduct();
    const pending = deferred<import('../../src/shared/product-notice').ProductNoticeResult>();
    window.customerAgent!.product!.currentNotice = vi.fn().mockReturnValue(pending.promise);
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    expect(screen.queryByTestId('notice-backdrop')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成发货问题' } });
    fireEvent.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(f.search).toHaveBeenCalled());
  });

  it('distinguishes expiry and login failure from unsigned guidance', async () => {
    const signedOut = { ok: true as const, enabled: true, signedIn: false, sessionEpoch: 1, userId: null, role: null, authMode: null, expiresAt: null, displayName: null, job: null };
    const signedIn = { ...signedOut, signedIn: true, sessionEpoch: 8, userId: 'usr_synthetic_agent', role: 'agent' as const, authMode: 'mock' as const, expiresAt: new Date(Date.now() + 900_000).toISOString(), displayName: 'synthetic_agent' };
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
    await screen.findByRole('button', { name: /· 退出$/ });
    act(() => listener({ ...signedOut, sessionEpoch: 9 }));
    expect(await screen.findByTestId('session-notice-expired')).toHaveTextContent('登录已失效，请重新登录');
    expect(screen.queryByTestId('validation-error')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
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
    const signedOut = { ok: true as const, enabled: true, signedIn: false, sessionEpoch: 1, userId: null, role: null, authMode: null, expiresAt: null, displayName: null, job: null };
    const signedIn = { ...signedOut, signedIn: true, sessionEpoch: 3, userId: 'usr_synthetic_agent', role: 'agent' as const, authMode: 'mock' as const, expiresAt: new Date(Date.now() + 900_000).toISOString(), displayName: 'synthetic_agent' };
    let listener: (value: import('../../src/shared/product-session').ProductSessionResult) => void = () => {};
    window.customerAgent!.product = { sessionStatus: () => pending.promise, login: vi.fn().mockResolvedValue(signedIn), logout: vi.fn().mockResolvedValue(signedOut), onSessionChanged: handler => { listener = handler; return () => {}; } };
    render(<QueryApp />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await screen.findByRole('button', { name: /· 退出$/ });
    await act(async () => { pending.resolve(signedOut); });
    act(() => listener(signedOut));
    expect(screen.getByRole('button', { name: /· 退出$/ })).toBeInTheDocument();
    expect(screen.getByTestId('question-input')).not.toHaveAttribute('placeholder', '登录后查询话术');
  });

  it('keeps login clickable and retries when the authorization page was missed', async () => {
    const signedOut = { ok: true as const, enabled: true, signedIn: false, sessionEpoch: 1, userId: null, role: null, authMode: null, expiresAt: null, displayName: null, job: null };
    const signedIn = { ...signedOut, signedIn: true, sessionEpoch: 4, userId: 'usr_synthetic_owner', role: 'owner' as const, authMode: 'mock' as const, expiresAt: new Date(Date.now() + 900_000).toISOString(), displayName: '管理员' };
    const first = deferred<import('../../src/shared/product-session').ProductSessionResult>();
    const second = deferred<import('../../src/shared/product-session').ProductSessionResult>();
    const login = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(signedOut),
      login,
      logout: vi.fn(),
      onSessionChanged: () => () => {},
    };
    render(<QueryApp />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByTestId('session-notice-waiting')).toHaveTextContent('请在登录页完成授权。如果没有点到授权，可以再次点击登录。');
    const again = screen.getByRole('button', { name: '登录' });
    expect(again).toBeEnabled();
    fireEvent.click(again);
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve(signedIn); });
    expect(await screen.findByRole('button', { name: /· 退出$/ })).toBeInTheDocument();
    await act(async () => { first.resolve({ ...signedOut, sessionEpoch: 2 }); });
    expect(screen.getByRole('button', { name: /· 退出$/ })).toBeInTheDocument();
    expect(screen.queryByTestId('session-notice-waiting')).not.toBeInTheDocument();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(dismiss).toHaveBeenCalledWith(true);

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

  it('finishes reduced-motion collapse without waiting for an animation event', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)', media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true,
    } satisfies MediaQueryList));
    try {
      render(<QueryApp />);
      activateQuery();
      act(() => {
        for (const listener of commandListeners) {
          listener({ type: 'collapse', handoffId: 12, anchor: 'right', dockEdge: 'right', animate: true, handoffCenterX: 600, handoffCenterY: 44 });
        }
      });
      expect(screen.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
      expect(screen.getByTestId('query-shell')).toHaveAttribute('data-closing', 'false');
      expect(reportHandoffMilestone).toHaveBeenCalledWith(12, 'close-finished');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows an explicit empty-query hint and does not invent results', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('validation-error')).toHaveTextContent(EMPTY_QUERY_MESSAGE);
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();
    expect(reportUiPhase).toHaveBeenCalledWith('SEARCH_INPUT', 0);
  });

  it('defaults smart retrieval ON and can turn it off without hiding the input', async () => {
    const user = userEvent.setup();
    connectProduct();
    render(<QueryApp />);
    const toggle = await screen.findByTestId('deep-thinking-toggle');
    reportUiPhase.mockClear();

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).not.toHaveAttribute('aria-pressed');
    expect(toggle).toHaveAttribute('role', 'switch');
    expect(toggle).not.toHaveTextContent('ON');
    expect(toggle).not.toHaveTextContent('OFF');
    expect(toggle.querySelector('.smart-toggle-thumb')).not.toBeNull();
    expect(screen.getByText('智能检索')).toBeInTheDocument();
    expect(screen.getByTestId('question-input')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).not.toHaveTextContent('OFF');
    expect(screen.getByTestId('question-input')).toBeInTheDocument();
    expect(window.customerAgent?.productSearch?.setRetrievalPreference).toHaveBeenCalledWith({ smartEnabled: false });
    expect(reportUiPhase).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    expect(openDashboard).not.toHaveBeenCalled();
  });

  it('does not show DEMO · 合成数据 on live script cards', async () => {
    const f = connectProduct();
    await prepareProductQuery();
    fireEvent.click(screen.getByTestId('search-button'));
    await screen.findByTestId('copy-button-1');
    expect(screen.queryByText('DEMO · 合成数据')).not.toBeInTheDocument();
    expect(screen.queryByTestId('env-badges')).not.toBeInTheDocument();
    expect(f.search).toHaveBeenCalled();
  });

  it('loads persisted smart retrieval OFF and reverts if the write fails', async () => {
    connectProduct();
    window.customerAgent!.productSearch!.retrievalPreference = vi.fn(async () => ({ smartEnabled: false }));
    window.customerAgent!.productSearch!.setRetrievalPreference = vi.fn(async () => {
      throw new Error('preference write failed');
    });
    render(<QueryApp />);
    const toggle = await screen.findByTestId('deep-thinking-toggle');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(toggle).not.toHaveTextContent('OFF');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('cancels an in-flight search when smart retrieval is toggled', async () => {
    const f = connectProduct();
    const pending = deferred<Awaited<ReturnType<typeof f.search>>>();
    f.search.mockImplementationOnce(() => pending.promise);
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成发货问题' } });
    fireEvent.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(f.search).toHaveBeenCalled());
    const cancelSearch = window.customerAgent!.productSearch!.cancelSearch as ReturnType<typeof vi.fn>;
    cancelSearch.mockClear();
    fireEvent.click(screen.getByTestId('deep-thinking-toggle'));
    expect(cancelSearch).toHaveBeenCalled();
    pending.resolve({
      ok: true, sessionEpoch: 10, generation: 1, queryId: '11111111-1111-4111-8111-111111111111',
      hitStatus: 'hit', releaseId: 'rel-synthetic', telemetryStatus: 'recorded', candidates: [],
    });
  });

  it('waits for the retrieval preference write before searching', async () => {
    const f = connectProduct();
    const pending = deferred<{ smartEnabled: boolean }>();
    window.customerAgent!.productSearch!.setRetrievalPreference = vi.fn(() => pending.promise);
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    fireEvent.click(screen.getByTestId('deep-thinking-toggle'));
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成发货问题' } });
    fireEvent.click(screen.getByTestId('search-button'));
    expect(f.search).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ smartEnabled: false }));
    await waitFor(() => expect(f.search).toHaveBeenCalled());
  });

  it('keeps the same fixture ranking after toggling smart retrieval', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    activateQueryIfParked();
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

    activateQueryIfParked();
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
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '今天中午虚构星球食堂有没有排骨汤');
    await user.click(screen.getByTestId('search-button'));
    await screen.findByTestId('no-hit');
    expect(fox).toHaveAttribute('data-fox-state', 'EMPTY');
  });

  it('does not submit while a Chinese IME composition is active', async () => {
    render(<QueryApp />);
    activateQueryIfParked();
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

  it('shows query and associated-card SOP entries bound to the submitted query', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '过敏了怎么办');
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('script-card-1')).toBeVisible();
    expect(screen.getByRole('group', { name: '本次查询相关流程' })).toBeVisible();
    expect(screen.queryByTestId('capsule-sop-entry')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/sop-card-entry-/)).toHaveLength(1);
    const entry = screen.getByTestId('sop-card-open-1-allergy-aftersale-demo');
    expect(entry).toBeVisible();
    const copy = screen.getByTestId('copy-button-1');
    expect(copy.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('copy-button-1')).toBeEnabled();
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
      fireEvent.keyDown(window, { key: 'F7', [modifier]: true });
    }
    expect(sopOpen).not.toHaveBeenCalled();
    await user.click(entry);
    expect(sopOpen).toHaveBeenCalledWith('allergy-aftersale-demo');
    expect(screen.queryByTestId('sop-card-entry-2')).not.toBeInTheDocument();
    await user.clear(screen.getByTestId('question-input'));
    await user.type(screen.getByTestId('question-input'), '尚未提交的其他问题');
    expect(screen.queryByRole('button', { name: /^进入过敏流程$/ })).not.toBeInTheDocument();
  });

  it('does not show the SOP button for usage-plus-allergy or empty results', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '怎么用过敏');
    await user.click(screen.getByTestId('search-button'));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^进入/ })).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '今天中午虚构星球食堂有没有排骨汤' } });
    await user.click(screen.getByTestId('search-button'));
    await screen.findByTestId('no-hit');
    expect(screen.queryByRole('button', { name: /^进入/ })).not.toBeInTheDocument();
  });

  it('shows an error after an invalid SOP update and preserves ordinary search and recovery', async () => {
    const user = userEvent.setup();
    const host = connectSop();
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '过敏了怎么办');
    await user.click(screen.getByTestId('search-button'));
    await user.click(await screen.findByTestId('sop-card-open-1-allergy-aftersale-demo'));
    const panel = await screen.findByRole('region', { name: 'SOP 流程' });
    await user.click(within(panel).getByRole('button', { name: '索取凭证' }));
    const sourceText = ALLERGY_SOP_TREE.nodes[0]?.scripts[0]?.answerText;
    if (!sourceText) throw new Error('Missing synthetic wording');
    expect(screen.getByText(sourceText)).toBeVisible();
    const active = host.snapshot();
    act(() => host.publish(SOP_UNAVAILABLE));
    expect(screen.queryByRole('region', { name: 'SOP 流程' })).toBeNull();
    expect(screen.queryByText(sourceText)).toBeNull();
    expect(within(screen.getByRole('region', { name: 'SOP 待办' })).getByRole('alert')).toHaveTextContent('无法读取流程进度');
    expect(screen.getByTestId('question-input')).toHaveValue('过敏了怎么办');
    expect(screen.getByTestId('copy-button-1')).toBeEnabled();
    host.current.mockRejectedValueOnce(new Error('IPC unavailable'));
    await user.click(screen.getByRole('button', { name: /重新读取$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /重新读取$/ })).not.toHaveClass('ant-btn-loading'));
    expect(within(screen.getByRole('region', { name: 'SOP 待办' })).getByRole('alert')).toHaveTextContent('无法读取流程进度');
    host.current.mockResolvedValueOnce(SOP_UNAVAILABLE);
    await user.click(screen.getByRole('button', { name: /重新读取$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /重新读取$/ })).not.toHaveClass('ant-btn-loading'));
    host.current.mockImplementationOnce(async () => { host.readState(active); return active; });
    await user.click(screen.getByRole('button', { name: /重新读取$/ }));
    expect(await screen.findByRole('region', { name: 'SOP 流程' })).toBeVisible();
    expect(screen.queryByText('无法读取流程进度')).toBeNull();
    await user.click(screen.getByRole('button', { name: '返回搜索' }));
    expect(await screen.findByRole('region', { name: 'SOP 待办' })).toBeVisible();
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('copy-button-1')).toBeEnabled();
    await user.click(screen.getByTestId('copy-button-1'));
    await waitFor(() => expect(copyText).toHaveBeenCalled());
    expect(dismiss).not.toHaveBeenCalled();
    act(() => host.publish(SOP_UNAVAILABLE));
    await user.clear(screen.getByTestId('question-input'));
    await user.type(screen.getByTestId('question-input'), '少件了，没收到全部');
    expect(within(screen.getByRole('region', { name: 'SOP 待办' })).getByRole('alert')).toHaveTextContent('无法读取流程进度');
    await user.click(screen.getByTestId('search-button'));
    sopOpen.mockResolvedValueOnce({ ok: false, code: 'INVALID', message: '最多保留 8 条待办，请先结束一条' });
    await user.click(await screen.findByRole('button', { name: /^进入少件处理$/ }));
    expect(await screen.findAllByText('最多保留 8 条待办，请先结束一条')).not.toHaveLength(0);

    const pending = deferred<QuerySopSnapshot>();
    host.current.mockReturnValueOnce(pending.promise);
    await user.click(screen.getByRole('button', { name: /重新读取$/ }));
    expect(screen.getByRole('button', { name: /重新读取$/ })).toHaveClass('ant-btn-loading');
    act(() => host.publish(sopSnapshot([], { kind: 'query-home' }, 20)));
    await act(async () => { pending.resolve(active); await pending.promise; });
    expect(screen.queryByRole('region', { name: 'SOP 流程' })).toBeNull();
    expect(screen.queryByText('无法读取流程进度')).toBeNull();

    const afterEdit = deferred<QuerySopSnapshot>();
    host.current.mockReturnValueOnce(afterEdit.promise);
    act(() => host.publish(SOP_UNAVAILABLE));
    await user.click(screen.getByRole('button', { name: /重新读取$/ }));
    await user.type(screen.getByTestId('question-input'), 'x');
    await act(async () => { afterEdit.resolve(active); await afterEdit.promise; });
    expect(screen.queryByRole('region', { name: 'SOP 流程' })).toBeNull();
    expect(screen.getByRole('button', { name: /重新读取$/ })).not.toHaveClass('ant-btn-loading');
  });

  it.each(['invalid', 'closed', 'updated', 'different'] as const)('does not restore an old SOP read after a newer %s event', async outcome => {
    const user = userEvent.setup();
    const host = connectSop();
    const projection = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-a', revision: 1 });
    const pending = deferred<QuerySopSnapshot>();
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '过敏了怎么办');
    await user.click(screen.getByTestId('search-button'));
    const entry = await screen.findByTestId('sop-card-open-1-allergy-aftersale-demo');
    await waitFor(() => expect(screen.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-results'));
    host.current.mockReturnValueOnce(pending.promise);
    sopOpen.mockImplementation(async (): Promise<SopWindowResult> => {
      host.publish(sopSnapshot([projection], { kind: 'sop', taskId: projection.taskId }, 10));
      return { ok: true };
    });
    await user.click(entry);
    expect(await screen.findByRole('region', { name: 'SOP 流程' })).toBeVisible();
    const updated = { ...projection, revision: 2, sceneTitle: '更新后的合成流程' };
    const different = { ...projection, taskId: 'task-b', sceneId: 'other-synthetic', sceneTitle: '其他合成流程' };
    act(() => host.publish(outcome === 'invalid' ? SOP_UNAVAILABLE : outcome === 'closed'
      ? sopSnapshot([], { kind: 'query-home' }, 11) : outcome === 'different'
        ? sopSnapshot([different], { kind: 'query-home' }, 11)
        : sopSnapshot([updated], { kind: 'sop', taskId: updated.taskId }, 11)));
    await act(async () => { pending.resolve(sopSnapshot([projection], { kind: 'sop', taskId: projection.taskId }, 10)); await pending.promise; });
    if (outcome === 'updated') expect(screen.getByRole('region', { name: 'SOP 流程' })).toHaveTextContent('更新后的合成流程');
    else expect(screen.queryByRole('region', { name: 'SOP 流程' })).toBeNull();
    if (outcome === 'invalid') expect(within(screen.getByRole('region', { name: 'SOP 待办' })).getByRole('alert')).toHaveTextContent('无法读取流程进度');
    if (outcome === 'closed') expect(screen.queryByText('无法读取流程进度')).toBeNull();
    if (outcome === 'different') expect(screen.getByRole('button', { name: /^其他合成流程 #1 .*步骤 1/ })).toBeVisible();
  });

  it.each(['opening', 'reading', 'collapse'] as const)('cancels the old SOP open intent on %s', async stage => {
    const user = userEvent.setup();
    const host = connectSop();
    const projection = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-a', revision: 1 });
    const opening = deferred<SopWindowResult>();
    const reading = deferred<QuerySopSnapshot>();
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '过敏了怎么办');
    await user.click(screen.getByTestId('search-button'));
    const entry = await screen.findByTestId('sop-card-open-1-allergy-aftersale-demo');
    await waitFor(() => expect(screen.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-results'));
    host.current.mockClear();
    host.current.mockReturnValueOnce(reading.promise);
    sopOpen.mockImplementation(() => stage === 'opening' ? opening.promise : Promise.resolve({ ok: true }));
    await user.click(entry);
    if (stage !== 'opening') await waitFor(() => expect(host.current).toHaveBeenCalledOnce());
    if (stage === 'collapse') fireEvent.keyDown(window, { key: 'Escape' });
    else await user.type(screen.getByTestId('question-input'), 'x');
    await act(async () => {
      if (stage === 'opening') { opening.resolve({ ok: true }); await opening.promise; }
      else { reading.resolve(sopSnapshot([projection], { kind: 'sop', taskId: projection.taskId }, 10)); await reading.promise; }
    });
    expect(screen.queryByRole('region', { name: 'SOP 流程' })).toBeNull();
    if (stage === 'collapse') expect(dismiss).toHaveBeenCalledWith(true);
    else expect(screen.getByTestId('question-input')).toHaveValue('过敏了怎么办x');
    if (stage === 'opening') expect(host.current).not.toHaveBeenCalled();
  });

  it('serializes duplicate SOP opens from the entry and shortcut in the same event turn', async () => {
    const user = userEvent.setup();
    connectSop();
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '过敏了怎么办');
    await user.click(screen.getByTestId('search-button'));
    const entry = await screen.findByTestId('sop-card-open-1-allergy-aftersale-demo');
    const opening = deferred<SopWindowResult>();
    sopOpen.mockImplementation(() => opening.promise);
    act(() => {
      fireEvent.click(entry);
      fireEvent.click(screen.getByTestId('sop-query-open-allergy-aftersale-demo'));
      fireEvent.keyDown(window, { key: 'F7' });
    });
    expect(sopOpen).toHaveBeenCalledOnce();
    await act(async () => { opening.resolve({ ok: false, code: 'FAILED', message: '流程没打开，请重试' }); await opening.promise; });
    expect(screen.getByTestId('sop-card-open-1-allergy-aftersale-demo')).toBeEnabled();
  });

  it('keeps an empty workspace at the original query capsule height', async () => {
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function measuredHeight(this: HTMLElement) {
        return this.classList.contains('query-capsule') ? 88 : 0;
      });
    try {
      connectSop();
      render(<QueryApp />);
      activateQueryIfParked();
      await waitFor(() => expect(reportQueryLayout).toHaveBeenLastCalledWith(expect.objectContaining({
        phase: 'SEARCH_INPUT', resultCount: 0, desiredHeight: 88,
      })));
    } finally { height.mockRestore(); }
  });

  it('returns to the compact home without losing the input, and restores independent same-named tasks', async () => {
    const user = userEvent.setup();
    const host = connectSop();
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '过敏了怎么办');
    await user.click(screen.getByTestId('search-button'));
    await user.click(await screen.findByTestId('sop-card-open-1-allergy-aftersale-demo'));
    await user.click(await screen.findByRole('button', { name: '返回搜索' }));
    await waitFor(() => expect(screen.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-home'));
    expect(screen.getByTestId('question-input')).toHaveValue('过敏了怎么办');
    expect(screen.queryByTestId('result-list')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('question-input')).toHaveFocus());
    await user.click(screen.getByTestId('query-shell'));
    expect(document.activeElement).toBe(document.body);
    await user.keyboard('123');
    expect(copyText).not.toHaveBeenCalled();
    expect(screen.getByTestId('question-input')).toHaveValue('过敏了怎么办');
    await user.keyboard('{F7}');
    expect(sopOpen).toHaveBeenCalledOnce();
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-workspace-view', 'query-home');
    const first = screen.getByRole('button', { name: /^过敏流程 #1 .*步骤 1/ });
    await user.click(first);
    expect(host.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'restore', taskId: 'task-1', revision: 1 }));
    await user.click(await screen.findByRole('button', { name: '返回搜索' }));
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('result-list')).toBeVisible();
    await user.click(await screen.findByTestId('sop-card-open-1-allergy-aftersale-demo'));
    await user.click(await screen.findByRole('button', { name: '返回搜索' }));
    expect(await screen.findByRole('button', { name: /^过敏流程 #1 .*步骤 1/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /^过敏流程 #2 .*步骤 1/ })).toBeVisible();
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('result-list')).toBeVisible();
    expect(screen.getByRole('button', { name: '结束 过敏流程 #1' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '结束 过敏流程 #1' }));
    const confirmation = screen.getByRole('dialog', { name: '结束流程？' });
    await user.click(within(confirmation).getByRole('button', { name: '结束流程' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^过敏流程 #1 .*步骤 1/ })).not.toBeInTheDocument());
    expect(screen.getByTestId('result-list')).toBeVisible();
    expect(screen.getByTestId('question-input')).toHaveValue('过敏了怎么办');
    await user.click(screen.getByRole('button', { name: /^过敏流程 #2 .*步骤 1/ }));
    expect(host.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'restore', taskId: 'task-2', revision: 1 }));
    expect(await screen.findByRole('region', { name: 'SOP 流程' })).toBeVisible();
  });

  it('restores a list nickname draft after opening a different SOP and returning', async () => {
    const user = userEvent.setup();
    const host = connectSop();
    render(<QueryApp />);
    activateQueryIfParked();
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    const second = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: startSopProgress(MISSING_ITEM_SOP_TREE), role: 'agent', taskId: 'task-2', revision: 1 });
    act(() => host.publish(sopSnapshot([first, second], { kind: 'sop', taskId: first.taskId }, 2)));
    act(() => host.publish(sopSnapshot([first, second], { kind: 'sop', taskId: second.taskId }, 3)));
    act(() => host.publish(sopSnapshot([first, second], { kind: 'query-home' }, 4)));
    await user.click(await screen.findByRole('button', { name: '改名' }));
    await user.click(screen.getByRole('button', { name: /^修改 过敏流程 #1 的昵称/ }));
    await user.type(screen.getByRole('textbox', { name: '待办昵称' }), '合成列表草稿');
    await user.click(screen.getByRole('button', { name: /^少件处理 #2 .*步骤 1/ }));
    await user.click(await screen.findByRole('button', { name: '返回搜索' }));
    expect(await screen.findByRole('textbox', { name: '待办昵称' })).toHaveValue('合成列表草稿');
  });

  it('restores independent step and list drafts when returning between SOP and search', async () => {
    const user = userEvent.setup();
    const host = connectSop();
    host.api.renameCurrent = vi.fn(async (): Promise<SopWindowResult> => ({ ok: true }));
    render(<QueryApp />);
    activateQueryIfParked();
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    act(() => host.publish(sopSnapshot([first], { kind: 'sop', taskId: first.taskId }, 2)));
    const edit = await screen.findByRole('button', { name: '编辑流程名称' });
    await waitFor(() => expect(edit).toBeEnabled());
    await user.click(edit);
    await user.clear(screen.getByRole('textbox', { name: '流程名称' }));
    await user.type(screen.getByRole('textbox', { name: '流程名称' }), '步骤草稿');
    await user.click(screen.getByRole('button', { name: '返回搜索' }));
    await user.click(await screen.findByRole('button', { name: '改名' }));
    await user.click(screen.getByRole('button', { name: /^修改 过敏流程 #1 的昵称/ }));
    await user.type(screen.getByRole('textbox', { name: '待办昵称' }), '列表草稿');
    await user.click(screen.getByRole('button', { name: /^过敏流程 #1 .*步骤 1/ }));
    expect(await screen.findByRole('textbox', { name: '流程名称' })).toHaveValue('步骤草稿');
    expect(screen.getByRole('button', { name: '独立悬浮' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '返回搜索' }));
    expect(await screen.findByRole('textbox', { name: '待办昵称' })).toHaveValue('列表草稿');
    expect(host.api.renameCurrent).not.toHaveBeenCalled();
  });

  it('prepares the current draft before acknowledging a request to show ordinary Query', async () => {
    const host = connectSop();
    let request: (value: SopShowQueryRequest) => void = () => undefined;
    host.api.onShowQueryRequest = callback => { request = callback; return () => undefined; };
    host.api.showQueryReady = vi.fn(async () => true);
    host.api.renameCurrent = vi.fn(async (): Promise<SopWindowResult> => ({ ok: true }));
    const user = userEvent.setup();
    render(<QueryApp />);
    activateQueryIfParked();
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    act(() => host.publish(sopSnapshot([first], { kind: 'sop', taskId: first.taskId }, 2)));
    const edit = await screen.findByRole('button', { name: '编辑流程名称' });
    await waitFor(() => expect(edit).toBeEnabled());
    await user.click(edit);
    await user.clear(screen.getByRole('textbox', { name: '流程名称' }));
    await user.type(screen.getByRole('textbox', { name: '流程名称' }), '合成草稿');
    act(() => request({ requestId: 4, taskId: 'task-1', hostEpoch: 2 }));
    await waitFor(() => expect(host.api.showQueryReady).toHaveBeenCalledWith({ requestId: 4, taskId: 'task-1', hostEpoch: 2, accepted: true }));
    expect(screen.getByRole('textbox', { name: '流程名称' })).toHaveValue('合成草稿');
    act(() => request({ requestId: 5, taskId: 'task-2', hostEpoch: 2 }));
    await waitFor(() => expect(host.api.showQueryReady).toHaveBeenCalledWith({ requestId: 5, taskId: 'task-2', hostEpoch: 2, accepted: false }));
  });

  it('does not call a successful navigation a failure when its follow-up read fails', async () => {
    const user = userEvent.setup();
    const host = connectSop();
    render(<QueryApp />);
    activateQueryIfParked();
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    act(() => host.publish(sopSnapshot([first], { kind: 'sop', taskId: first.taskId }, 2)));
    host.current.mockImplementation(async () => {
      const current = host.snapshot();
      if (current.kind === 'ready' && current.view.kind === 'query-home') throw new Error('read failed');
      return current;
    });
    await user.click(await screen.findByRole('button', { name: '返回搜索' }));
    expect(await screen.findByText('无法读取流程进度')).toBeVisible();
    expect(screen.queryByText('流程操作失败，请重试')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'SOP 流程' })).not.toBeInTheDocument();
  });

  it('refreshes the query snapshot on focus after a missed update', async () => {
    const host = connectSop();
    render(<QueryApp />);
    activateQueryIfParked();
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    host.readState(sopSnapshot([first], { kind: 'query-home' }, 2));
    fireEvent.focus(window);
    expect(await screen.findByRole('button', { name: /^过敏流程 #1 .*步骤 1/ })).toBeVisible();
  });

  it('keeps the initial task read when typing without an SOP operation in flight', async () => {
    const user = userEvent.setup();
    const host = connectSop();
    const reading = deferred<QuerySopSnapshot>();
    host.current.mockReturnValueOnce(reading.promise);
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '客户问题');
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    await act(async () => { reading.resolve(sopSnapshot([first], { kind: 'query-home' }, 2)); await reading.promise; });
    expect(await screen.findByRole('button', { name: /^过敏流程 #1 .*步骤 1/ })).toBeVisible();
  });

  it.each(['input', 'search', 'collapse'] as const)('settles a successful nickname save while Query handles %s', async action => {
    const user = userEvent.setup();
    const host = connectSop();
    const saving = deferred<SopWindowResult>();
    host.api.rename = vi.fn(() => saving.promise);
    render(<QueryApp />);
    activateQueryIfParked();
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    act(() => host.publish(sopSnapshot([first], { kind: 'sop', taskId: first.taskId }, 2)));
    act(() => host.publish(sopSnapshot([first], { kind: 'query-home' }, 3)));
    fireEvent.keyDown(await screen.findByRole('button', { name: /^过敏流程 #1 .*步骤 1/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '合成客户' } });
    await user.click(screen.getByRole('button', { name: '保存昵称' }));
    expect(host.api.rename).toHaveBeenCalledOnce();
    if (action === 'collapse') fireEvent.keyDown(window, { key: 'Escape' });
    else {
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: '过敏了怎么办' } });
      if (action === 'search') {
        await user.click(screen.getByTestId('search-button'));
        await waitFor(() => expect(host.navigate).toHaveBeenCalledWith(expect.objectContaining({ type: 'results' })));
        const entry = await screen.findByTestId('sop-card-open-1-allergy-aftersale-demo');
        expect(entry).toBeDisabled();
        fireEvent.click(entry);
        expect(sopOpen).not.toHaveBeenCalled();
      }
    }
    const restore = screen.getByRole('button', { name: /^过敏流程 #1 .*步骤 1/ });
    expect(restore).toBeDisabled();
    fireEvent.click(restore);
    expect(host.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'restore' }));
    const updated = sopSnapshot([{ ...first, revision: 2 }], { kind: 'query-home' }, 100);
    act(() => host.publish({ ...updated, tasks: updated.tasks.map(task => ({ ...task, displayName: '合成客户' })) }));
    await act(async () => { saving.resolve({ ok: true }); await saving.promise; });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '待办昵称' })).not.toBeInTheDocument());
    expect(screen.queryByText('昵称保存失败，请重试')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^合成客户 .*步骤 1/ })).toBeVisible();
  });

  it('shows an actual save failure and retains the draft after typing a query', async () => {
    const user = userEvent.setup();
    const host = connectSop();
    const saving = deferred<SopWindowResult>();
    host.api.rename = vi.fn(() => saving.promise);
    render(<QueryApp />);
    activateQueryIfParked();
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    act(() => host.publish(sopSnapshot([first], { kind: 'sop', taskId: first.taskId }, 2)));
    act(() => host.publish(sopSnapshot([first], { kind: 'query-home' }, 3)));
    fireEvent.keyDown(await screen.findByRole('button', { name: /^过敏流程 #1 .*步骤 1/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '合成草稿' } });
    await user.click(screen.getByRole('button', { name: '保存昵称' }));
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '其他查询' } });
    await act(async () => { saving.resolve({ ok: false, code: 'FAILED', message: '名称保存失败' }); await saving.promise; });
    expect(await screen.findByText('昵称保存失败，请重试')).toBeVisible();
    expect(screen.getByRole('textbox', { name: '待办昵称' })).toHaveValue('合成草稿');
  });

  it('keeps the accepted save reconciliation when a concurrent query navigation is cancelled', async () => {
    const user = userEvent.setup();
    const host = connectSop();
    const saving = deferred<SopWindowResult>();
    const reconciliation = deferred<QuerySopSnapshot>();
    const navigation = deferred<SopWindowResult>();
    host.api.rename = vi.fn(() => saving.promise);
    render(<QueryApp />);
    activateQueryIfParked();
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    act(() => host.publish(sopSnapshot([first], { kind: 'sop', taskId: first.taskId }, 2)));
    act(() => host.publish(sopSnapshot([first], { kind: 'query-home' }, 3)));
    fireEvent.keyDown(await screen.findByRole('button', { name: /^过敏流程 #1 .*步骤 1/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: '待办昵称' }), { target: { value: '合成客户' } });
    await user.click(screen.getByRole('button', { name: '保存昵称' }));
    const reads = host.current.mock.calls.length;
    host.current.mockReturnValueOnce(reconciliation.promise);
    await act(async () => { saving.resolve({ ok: true }); await saving.promise; });
    await waitFor(() => expect(host.current.mock.calls.length).toBeGreaterThan(reads));
    host.navigate.mockImplementationOnce(() => navigation.promise);
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '过敏了怎么办' } });
    await user.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(host.navigate).toHaveBeenCalledWith(expect.objectContaining({ type: 'results' })));
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '新的查询' } });
    const updated = sopSnapshot([{ ...first, revision: 2 }], { kind: 'query-home' }, 100);
    const committed = { ...updated, tasks: updated.tasks.map(task => ({ ...task, displayName: '合成客户' })) };
    host.readState(committed);
    await act(async () => { reconciliation.resolve(committed); await reconciliation.promise; });
    expect(await screen.findByRole('button', { name: /^合成客户 .*步骤 1/ })).toBeVisible();
    expect(screen.queryByText('昵称保存失败，请重试')).not.toBeInTheDocument();
    await act(async () => { navigation.resolve({ ok: true }); await navigation.promise; });
  });

  it.each(['input', 'search', 'collapse'] as const)('reconciles a successful task end while Query handles %s and the update was missed', async action => {
    const user = userEvent.setup();
    const host = connectSop();
    const ending = deferred<SopWindowResult>();
    host.api.endTask = vi.fn(() => ending.promise);
    render(<QueryApp />);
    activateQueryIfParked();
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    act(() => host.publish(sopSnapshot([first], { kind: 'sop', taskId: first.taskId }, 2)));
    act(() => host.publish(sopSnapshot([first], { kind: 'query-home' }, 3)));
    await user.click(await screen.findByRole('button', { name: '结束 过敏流程 #1' }));
    await user.click(within(screen.getByRole('dialog', { name: '结束流程？' })).getByRole('button', { name: '结束流程' }));
    await waitFor(() => expect(host.api.endTask).toHaveBeenCalledOnce());
    if (action === 'collapse') fireEvent.keyDown(window, { key: 'Escape' });
    else {
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: '过敏了怎么办' } });
      if (action === 'search') {
        await user.click(screen.getByTestId('search-button'));
        await waitFor(() => expect(host.navigate).toHaveBeenCalledWith(expect.objectContaining({ type: 'results' })));
        const entry = await screen.findByTestId('sop-card-open-1-allergy-aftersale-demo');
        expect(entry).toBeDisabled();
        fireEvent.click(entry);
        expect(sopOpen).not.toHaveBeenCalled();
      }
    }
    const restore = screen.getByRole('button', { name: /^过敏流程 #1 .*步骤 1/ });
    expect(restore).toBeDisabled();
    fireEvent.click(restore);
    expect(host.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'restore' }));
    host.readState(sopSnapshot([], { kind: 'query-home' }, 100));
    const reads = host.current.mock.calls.length;
    await act(async () => { ending.resolve({ ok: true }); await ending.promise; });
    await waitFor(() => expect(screen.queryByRole('button', { name: '结束 过敏流程 #1' })).not.toBeInTheDocument());
    expect(host.current.mock.calls.length).toBeGreaterThan(reads);
  });

  it('clears both drafts after Main removes the task', async () => {
    const user = userEvent.setup();
    const host = connectSop();
    host.api.renameCurrent = vi.fn(async (): Promise<SopWindowResult> => ({ ok: true }));
    render(<QueryApp />);
    activateQueryIfParked();
    const first = projectSop({ tree: ALLERGY_SOP_TREE, progress: startSopProgress(ALLERGY_SOP_TREE), role: 'agent', taskId: 'task-1', revision: 1 });
    act(() => host.publish(sopSnapshot([first], { kind: 'sop', taskId: first.taskId }, 2)));
    const edit = await screen.findByRole('button', { name: '编辑流程名称' });
    await waitFor(() => expect(edit).toBeEnabled());
    await user.click(edit);
    await user.type(screen.getByRole('textbox', { name: '流程名称' }), '步骤草稿');
    await user.click(screen.getByRole('button', { name: '返回搜索' }));
    await user.click(await screen.findByRole('button', { name: '改名' }));
    await user.click(screen.getByRole('button', { name: /^修改 过敏流程 #1 的昵称/ }));
    await user.type(screen.getByRole('textbox', { name: '待办昵称' }), '列表草稿');
    await user.click(screen.getByRole('button', { name: '结束 过敏流程 #1' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('结束流程？')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '结束流程' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^过敏流程 #1 .*步骤 1/ })).not.toBeInTheDocument());

    act(() => host.publish(sopSnapshot([first], { kind: 'sop', taskId: first.taskId }, 100)));
    expect(await screen.findByRole('button', { name: '编辑流程名称' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: '流程名称' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回搜索' }));
    expect(screen.queryByRole('textbox', { name: '待办昵称' })).not.toBeInTheDocument();
  });

  it('keeps a matched SOP entry visible when ordinary search has no hit', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '少件了，没收到全部');
    await user.click(screen.getByTestId('search-button'));

    expect(await screen.findByTestId('no-hit')).toBeVisible();
    const entry = await screen.findByRole('button', { name: /^进入少件处理$/ });
    expect(entry).toBeVisible();
    await user.click(entry);
    expect(sopOpen).toHaveBeenCalledWith('missing-item-demo');
  });

  it('keeps 少发/长痘 on aftersale Top 3 without a SOP button', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '月白防晒长痘了');
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByTestId('script-card-1')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^进入/ })).not.toBeInTheDocument();
  });

  it('renders the original synthetic aftersales wording for a natural category question', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    activateQueryIfParked();
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
    activateQueryIfParked();
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
    activateQueryIfParked();
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
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(true), { timeout: 1_500 });
  });

  it('clears ordinary copy feedback when a newer SOP copy reaches Main', async () => {
    const host = connectSop();
    copyText.mockResolvedValueOnce({ ok: true, copyGeneration: 1 });
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('copy-button-1'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('已复制');
    const state = host.snapshot();
    if (state.kind !== 'ready') throw new Error('SOP snapshot missing');
    act(() => host.publish({ ...state, sequence: state.sequence + 1, copyGeneration: 2 }));
    await waitFor(() => expect(screen.queryByTestId('toast')).not.toBeInTheDocument());
    expect(screen.getByTestId('copy-button-1')).toBeEnabled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('ignores a late ordinary copy response when a newer SOP copy already succeeded', async () => {
    const host = connectSop();
    const pending = deferred<{ ok: true; copyGeneration: number }>();
    copyText.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('copy-button-1'));
    const state = host.snapshot();
    if (state.kind !== 'ready') throw new Error('SOP snapshot missing');
    act(() => host.publish({ ...state, sequence: state.sequence + 1, copyGeneration: 2 }));
    await act(async () => { pending.resolve({ ok: true, copyGeneration: 1 }); await pending.promise; });
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    expect(screen.getByTestId('copy-button-1')).toBeEnabled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('keeps ordinary copy feedback when its commit is newer than the last SOP copy', async () => {
    const host = connectSop();
    const pending = deferred<{ ok: true; copyGeneration: number }>();
    copyText.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('copy-button-1'));
    const state = host.snapshot();
    if (state.kind !== 'ready') throw new Error('SOP snapshot missing');
    act(() => host.publish({ ...state, sequence: state.sequence + 1, copyGeneration: 2 }));
    await act(async () => { pending.resolve({ ok: true, copyGeneration: 3 }); await pending.promise; });
    expect(await screen.findByTestId('toast')).toHaveTextContent('已复制');
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
    activateQueryIfParked();
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
    const copyButton = screen.getByTestId('copy-button-1');
    const focus = vi.spyOn(copyButton, 'focus');
    screen.getByTestId('question-input').focus();
    fireEvent.click(copyButton);

    expect(focus).toHaveBeenCalledOnce();
    expect(copyButton).toHaveFocus();
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(cleanser?.answerText));
    expect(await screen.findByTestId('toast')).toHaveTextContent(COPY_SUCCESS_MESSAGE);
    expect(screen.queryByText('已发送')).not.toBeInTheDocument();
    expect(screen.queryByText('已采纳')).not.toBeInTheDocument();
    expect(reportUiPhase).toHaveBeenCalledWith('COPIED', 3);
  });

  it('shows a hairline 话术不准 control on query results', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);

    const report = screen.getByTestId('report-inaccuracy-button-1');
    expect(report).toHaveTextContent(SCRIPT_INACCURACY_ACTION_LABEL);
    expect(report).toHaveClass('retry-btn');
    expect(report).not.toHaveClass('copy-btn');
    expect(screen.getByTestId('report-inaccuracy-button-2')).toHaveClass('retry-btn');
    expect(screen.getByTestId('report-inaccuracy-button-3')).toHaveClass('retry-btn');
    expect(screen.getByTestId('copy-button-1')).toHaveTextContent('复制话术');
    expect(screen.queryByTestId('report-status-1')).not.toBeInTheDocument();
  });

  it('records a local inaccuracy report for high-risk scripts without claiming it was processed', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    activateQueryIfParked();
    await user.type(screen.getByTestId('question-input'), '面膜过敏怎么办');
    await user.click(screen.getByTestId('search-button'));

    const lead = await screen.findByTestId('script-card-1');
    expect(within(lead).getByTestId('risk-1')).toHaveTextContent('高风险');
    await user.click(within(lead).getByTestId('report-inaccuracy-button-1'));

    expect(within(lead).getByTestId('report-status-1')).toHaveTextContent(SCRIPT_INACCURACY_RECORDED_STATUS);
    expect(within(lead).getByTestId('report-inaccuracy-button-1')).toBeDisabled();
    expect(screen.getByTestId('capsule-fox')).toHaveAttribute('data-fox-state', 'RESULTS');
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    expect(copyText).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    expect(reportUiPhase).not.toHaveBeenCalledWith('COPIED', expect.anything());
    for (const phrase of FORBIDDEN_INACCURACY_STATUS_PHRASES) {
      expect(lead.textContent).not.toContain(phrase);
    }
  });

  it('keeps the copy path as 已复制 after a local inaccuracy report', async () => {
    const user = userEvent.setup();
    const cleanser = SYNTHETIC_SCRIPTS.find((item) => item.scriptId === 'syn-prod-001');
    expect(cleanser).toBeDefined();

    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('report-inaccuracy-button-1'));
    expect(screen.getByTestId('report-status-1')).toHaveTextContent(SCRIPT_INACCURACY_RECORDED_STATUS);

    await user.click(screen.getByTestId('copy-button-1'));
    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(cleanser?.answerText);
    });
    expect(await screen.findByTestId('toast')).toHaveTextContent(COPY_SUCCESS_MESSAGE);
    expect(screen.getByTestId('copy-button-1')).toHaveTextContent(COPY_SUCCESS_MESSAGE);
    expect(screen.getByTestId('report-status-1')).toHaveTextContent(SCRIPT_INACCURACY_RECORDED_STATUS);
    expect(screen.queryByText('已发送')).not.toBeInTheDocument();
    expect(screen.queryByText('已采纳')).not.toBeInTheDocument();
    expect(screen.queryByText('已处理')).not.toBeInTheDocument();
    expect(reportUiPhase).toHaveBeenCalledWith('COPIED', 3);
  });

  it('does not call copyAdopt when recording a local inaccuracy report', async () => {
    const f = connectProduct();
    window.customerAgent!.productSearch!.reportInaccuracy = vi.fn(async request => ({
      ok: true as const, sessionEpoch: request.sessionEpoch, generation: request.generation, recorded: true,
    }));
    await prepareProductQuery();
    await screen.findByTestId('copy-button-1');

    fireEvent.click(screen.getByTestId('report-inaccuracy-button-1'));
    await waitFor(() => {
      expect(screen.getByTestId('report-status-1')).toHaveTextContent(SCRIPT_INACCURACY_RECORDED_STATUS);
    });
    expect(f.copyAdopt).not.toHaveBeenCalled();
    expect(f.escalate).not.toHaveBeenCalled();
    expect(f.recordTerminal).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });

  it('scopes a local inaccuracy record to the current query session', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('report-inaccuracy-button-1'));
    expect(screen.getByTestId('report-status-1')).toHaveTextContent(SCRIPT_INACCURACY_RECORDED_STATUS);
    await user.click(screen.getByTestId('report-inaccuracy-button-1'));
    expect(screen.getByTestId('report-inaccuracy-button-1')).toBeDisabled();

    await searchCleanser(user);
    expect(screen.queryByTestId('report-status-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-inaccuracy-button-1')).not.toBeDisabled();
  });

  it('calls reportInaccuracy only for live UUID query ids', async () => {
    const f = connectProduct();
    const reportInaccuracy = vi.fn(async (
      request: import('../../src/shared/product-search').ProductInaccuracyRequest,
    ) => ({
      ok: true as const,
      sessionEpoch: request.sessionEpoch,
      generation: request.generation,
      recorded: true,
    }));
    window.customerAgent!.productSearch!.reportInaccuracy = reportInaccuracy;
    await prepareProductQuery();
    fireEvent.click(screen.getByTestId('report-inaccuracy-button-1'));
    await waitFor(() => expect(reportInaccuracy).toHaveBeenCalledWith(expect.objectContaining({
      queryId: '11111111-1111-4111-8111-111111111111',
      scriptId: 'script-synthetic',
    })));
    expect(screen.getByTestId('report-status-1')).toHaveTextContent(SCRIPT_INACCURACY_RECORDED_STATUS);

    reportInaccuracy.mockClear();
    f.search.mockImplementation(async (request) => ({
      ok: true as const,
      sessionEpoch: request.sessionEpoch,
      generation: request.generation,
      queryId: 'local-not-a-uuid',
      hitStatus: 'hit' as const,
      releaseId: 'rel-synthetic',
      telemetryStatus: 'recorded' as const,
      candidates: [{
        rank: 1, release_id: 'rel-synthetic', script_id: 'script-synthetic', script_version: 1,
        content_hash: 'a'.repeat(64), title: '合成发货', category: 'presale' as const,
        answer_text: '合成订单 {订单号}', platform_scope: ['qianniu', 'douyin'] as Array<'qianniu' | 'douyin'>,
        product_scope_type: 'storewide' as const, product_scope_refs: [],
        effective_from: '2026-01-01T00:00:00Z', effective_to: null,
        intent_taxonomy_version: 'itax_synthetic_v1', intent_id: 'intent_synthetic_shipping',
        risk_level: 'low' as const, risk_categories: [], has_conflict: false, placeholder_keys: ['order_id' as const],
      }],
    }));
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '另一发货问题' } });
    fireEvent.click(screen.getByTestId('search-button'));
    await screen.findByTestId('report-inaccuracy-button-1');
    fireEvent.click(screen.getByTestId('report-inaccuracy-button-1'));
    expect(await screen.findByText('话术反馈未记录，请联系话术师。')).toBeInTheDocument();
    expect(screen.queryByTestId('report-status-1')).not.toBeInTheDocument();
    expect(reportInaccuracy).not.toHaveBeenCalled();
  });

  it('still invokes reportInaccuracy for collection_disabled UUID queries', async () => {
    const f = connectProduct();
    f.search.mockImplementation(async (request) => ({
      ok: true as const,
      sessionEpoch: request.sessionEpoch,
      generation: request.generation,
      queryId: '11111111-1111-4111-8111-111111111111',
      hitStatus: 'hit' as const,
      releaseId: 'rel-synthetic',
      telemetryStatus: 'collection_disabled' as const,
      candidates: [{
        rank: 1, release_id: 'rel-synthetic', script_id: 'script-synthetic', script_version: 1,
        content_hash: 'a'.repeat(64), title: '合成发货', category: 'presale' as const,
        answer_text: '合成订单 {订单号}', platform_scope: ['qianniu', 'douyin'] as Array<'qianniu' | 'douyin'>,
        product_scope_type: 'storewide' as const, product_scope_refs: [],
        effective_from: '2026-01-01T00:00:00Z', effective_to: null,
        intent_taxonomy_version: 'itax_synthetic_v1', intent_id: 'intent_synthetic_shipping',
        risk_level: 'low' as const, risk_categories: [], has_conflict: false, placeholder_keys: ['order_id' as const],
      }],
    }));
    const reportInaccuracy = vi.fn(async (
      request: import('../../src/shared/product-search').ProductInaccuracyRequest,
    ) => ({
      ok: true as const,
      sessionEpoch: request.sessionEpoch,
      generation: request.generation,
      recorded: false,
    }));
    window.customerAgent!.productSearch!.reportInaccuracy = reportInaccuracy;
    await prepareProductQuery();
    fireEvent.click(screen.getByTestId('report-inaccuracy-button-1'));
    await waitFor(() => expect(reportInaccuracy).toHaveBeenCalledWith(expect.objectContaining({
      queryId: '11111111-1111-4111-8111-111111111111',
      scriptId: 'script-synthetic',
    })));
    expect(await screen.findByText('话术反馈未记录，请联系话术师。')).toBeInTheDocument();
    expect(screen.queryByTestId('report-status-1')).not.toBeInTheDocument();
  });

  it.each(['failure', 'rejection'] as const)('explains when an inaccuracy report has a %s', async failure => {
    connectProduct();
    const reportInaccuracy = vi.fn(async (
      request: import('../../src/shared/product-search').ProductInaccuracyRequest,
    ) => {
      if (failure === 'rejection') throw new Error('synthetic unavailable');
      return {
        ok: false as const,
        sessionEpoch: request.sessionEpoch,
        generation: request.generation,
        code: 'RATE_LIMITED' as const,
        message: '操作过于频繁，请稍后重试',
      };
    });
    window.customerAgent!.productSearch!.reportInaccuracy = reportInaccuracy;
    await prepareProductQuery();
    fireEvent.click(screen.getByTestId('report-inaccuracy-button-1'));
    await waitFor(() => expect(reportInaccuracy).toHaveBeenCalled());
    expect(await screen.findByText('话术反馈结果未确认，请联系话术师。')).toBeInTheDocument();
    expect(screen.queryByTestId('report-status-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-inaccuracy-button-1')).not.toBeDisabled();
  });

  it('does not claim a product report was recorded when the reporting capability is missing', async () => {
    connectProduct();
    await prepareProductQuery();
    fireEvent.click(screen.getByTestId('report-inaccuracy-button-1'));
    expect(await screen.findByText('话术反馈未记录，请联系话术师。')).toBeInTheDocument();
    expect(screen.queryByTestId('report-status-1')).not.toBeInTheDocument();
  });

  it('does not attach a late report failure to a newer query', async () => {
    const f = connectProduct();
    const pending = deferred<import('../../src/shared/product-search').ProductInaccuracyResult>();
    window.customerAgent!.productSearch!.reportInaccuracy = vi.fn(() => pending.promise);
    await prepareProductQuery();
    fireEvent.click(screen.getByTestId('report-inaccuracy-button-1'));
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '另一发货问题' } });
    fireEvent.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(f.search).toHaveBeenCalledTimes(2));
    await act(async () => pending.resolve({ ok: false, sessionEpoch: 10, generation: 1,
      code: 'UNAVAILABLE', message: '服务暂不可用' }));
    expect(screen.queryByText('话术反馈结果未确认，请联系话术师。')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-status-1')).not.toBeInTheDocument();
  });

  it('dismisses with Esc after copy without implying the reply was sent', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    await searchCleanser(user);
    await user.click(screen.getByTestId('copy-button-1'));
    await screen.findByTestId('toast');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledWith(true);
    expect(screen.queryByText('已发送')).not.toBeInTheDocument();
  });

  it('does not accept typed digits after collapse until search is activated again', async () => {
    const user = userEvent.setup();
    render(<QueryApp />);
    activateQuery();
    await user.type(screen.getByTestId('question-input'), '123');
    expect(screen.getByTestId('question-input')).toHaveValue('123');

    act(() => {
      for (const listener of commandListeners) {
        listener({
          type: 'collapse',
          anchor: 'left',
          dockEdge: 'none',
          animate: false,
          handoffCenterX: 44,
          handoffCenterY: 44,
        });
      }
    });

    const input = screen.getByTestId('question-input');
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('readonly');
    fireEvent.keyDown(window, { key: '4', code: 'Digit4' });
    fireEvent.keyDown(input, { key: '5', code: 'Digit5' });
    fireEvent.keyDown(input, { key: '6', code: 'Digit6' });
    expect(input).toHaveValue('');
    expect(screen.getByTestId('query-shell')).toHaveAttribute('data-parked', 'true');
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
      expect(document.getElementById('query-guidance')).toBeNull();
      expect(screen.queryByText(shortcutLabel)).not.toBeInTheDocument();
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
      activateQueryIfParked();
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

  it('keeps manual search usable when getWindowContext rejects', async () => {
    getWindowContext.mockRejectedValueOnce(new Error('window context unavailable'));
    const user = userEvent.setup();
    render(<QueryApp />);
    await waitFor(() => expect(getWindowContext).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('shortcut-fallback')).not.toBeInTheDocument();
    await searchCleanser(user);
    expect(screen.getByTestId('copy-button-1')).toBeInTheDocument();
    expect(screen.getByTestId('question-input')).toBeEnabled();
  });

  it('measures shortcut and ERROR banners as independent layout owners', async () => {
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
    copyText.mockResolvedValue({ ok: false, message: '复制失败，请重试' });
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
      await searchCleanser(user);
      await user.click(screen.getByTestId('copy-button-1'));
      expect(await screen.findByTestId('error-state')).toBeVisible();
      expect(screen.getByTestId('shortcut-fallback')).toBeVisible();
      await waitFor(() => {
        const errorRequest = reportQueryLayout.mock.calls
          .map(([request]) => request as { phase: string; desiredHeight: number })
          .reverse()
          .find((request) => request.phase === 'ERROR');
        expect(errorRequest?.desiredHeight).toBe(256);
      });
    } finally {
      boundingClientRect.mockRestore();
      offsetHeight.mockRestore();
    }
  });

  it('starts login from the dashboard entry when unsigned, then opens the dashboard', async () => {
    const user = userEvent.setup();
    const signedOut = {
      ok: true as const,
      enabled: true,
      signedIn: false,
      sessionEpoch: 1,
      userId: null,
      role: null,
      authMode: null,
      expiresAt: null,
      displayName: null,
    };
    const signedIn = {
      ...signedOut,
      signedIn: true,
      sessionEpoch: 2,
      userId: 'usr_synthetic_agent',
      role: 'agent' as const,
      authMode: 'mock' as const,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      displayName: 'synthetic_agent',
    };
    const pending = deferred<typeof signedIn>();
    const login = vi.fn().mockReturnValue(pending.promise);
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(signedOut),
      login,
      logout: vi.fn(),
      onSessionChanged: () => () => {},
    };
    render(<QueryApp />);
    await screen.findByRole('button', { name: '登录' });

    await user.click(screen.getByTestId('open-dashboard'));
    expect(login).toHaveBeenCalledOnce();
    expect(openDashboard).not.toHaveBeenCalled();
    await act(async () => pending.resolve(signedIn));
    await screen.findByRole('button', { name: /· 退出$/ });
    await waitFor(() => expect(openDashboard).toHaveBeenCalledTimes(1));
  });

  it('opens the dashboard after an in-flight login when the dashboard entry is clicked second', async () => {
    const user = userEvent.setup();
    const signedOut = {
      ok: true as const,
      enabled: true,
      signedIn: false,
      sessionEpoch: 1,
      userId: null,
      role: null,
      authMode: null,
      expiresAt: null,
      displayName: null,
    };
    const signedIn = {
      ...signedOut,
      signedIn: true,
      sessionEpoch: 2,
      userId: 'usr_synthetic_agent',
      role: 'agent' as const,
      authMode: 'mock' as const,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      displayName: 'synthetic_agent',
    };
    const pending = deferred<typeof signedIn>();
    const login = vi.fn().mockReturnValue(pending.promise);
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(signedOut),
      login,
      logout: vi.fn(),
      onSessionChanged: () => () => {},
    };
    render(<QueryApp />);
    await screen.findByRole('button', { name: '登录' });

    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(login).toHaveBeenCalledOnce();
    await user.click(screen.getByTestId('open-dashboard'));
    expect(login).toHaveBeenCalledOnce();
    expect(openDashboard).not.toHaveBeenCalled();
    await act(async () => pending.resolve(signedIn));
    await waitFor(() => expect(openDashboard).toHaveBeenCalledTimes(1));
  });

  it('does not open the dashboard when login from the dashboard entry fails', async () => {
    const user = userEvent.setup();
    const signedOut = {
      ok: true as const,
      enabled: true,
      signedIn: false,
      sessionEpoch: 1,
      userId: null,
      role: null,
      authMode: null,
      expiresAt: null,
      displayName: null,
    };
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(signedOut),
      login: vi.fn().mockRejectedValue(new Error('login window failed')),
      logout: vi.fn(),
      onSessionChanged: () => () => {},
    };
    render(<QueryApp />);
    await screen.findByRole('button', { name: '登录' });

    await user.click(screen.getByTestId('open-dashboard'));
    await waitFor(() => expect(window.customerAgent?.product?.login).toHaveBeenCalledOnce());
    expect(openDashboard).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('opens the dashboard without logging in again when already signed in', async () => {
    const user = userEvent.setup();
    connectProduct();
    render(<QueryApp />);
    await screen.findByRole('button', { name: /· 退出$/ });
    const login = window.customerAgent?.product?.login as ReturnType<typeof vi.fn>;
    login.mockClear();

    await user.click(screen.getByTestId('open-dashboard'));
    expect(login).not.toHaveBeenCalled();
    expect(openDashboard).toHaveBeenCalledTimes(1);
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
    activateQueryIfParked();
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
    activateQueryIfParked();
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
    activateQueryIfParked();
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
  it.each(['success', 'rejected', 'thrown'] as const)('settles FAQ filter waits after %s and permits an explicit recovered query', async outcome => {
    const user = userEvent.setup();
    const workspace = connectSop();
    sopEntryAvailable.mockResolvedValue(false);
    const session = { ok: true as const, enabled: true, signedIn: true, sessionEpoch: 1,
      userId: 'synthetic', role: 'agent' as const, authMode: 'mock' as const,
      expiresAt: '2099-01-01T00:00:00Z', displayName: '合成坐席' };
    const context = { ok: true as const, ...emptyIntakeQueryContext(), shops: ['shop-a'], shopId: 'shop-a',
      products: [{ id: 'product-a', label: '合成商品' }] };
    const selection = deferred<typeof context | { ok: false; message: string }>();
    const search = vi.fn().mockResolvedValue({ ok: true, rows: [] });
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(session), login: vi.fn(), logout: vi.fn(), onSessionChanged: () => () => {},
      currentNotice: vi.fn().mockResolvedValue({ ok: true, sessionEpoch: 1, decision: 'accepted', decided_at: '2026-01-01T00:00:00Z',
        notice: { version: 'v1', content: '合成告知', content_hash: 'a'.repeat(64), published_at: '2026-01-01T00:00:00Z' } }),
      decideNotice: vi.fn(),
    };
    window.customerAgent!.intakeQuery = {
      mode: vi.fn().mockResolvedValue({ ok: true, enabled: true }), access: vi.fn().mockResolvedValue(context),
      selectConditions: vi.fn().mockReturnValue(outcome === 'thrown' ? selection.promise.then(() => { throw new Error('synthetic transport failure'); }) : selection.promise), selectShop: vi.fn(), search,
      copy: vi.fn(), cancel: vi.fn().mockResolvedValue({ ok: true, cancelled: true }), onInvalidated: () => () => {},
    };
    render(<QueryApp intake />); activateQuery();
    await waitFor(() => expect(screen.getByRole('button', { name: '筛选' })).toHaveClass('intake-filter-toggle'));
    await user.click(screen.getByRole('button', { name: '筛选' }));
    await user.click(await screen.findByText('商品 · 通用'));
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成客户问题' } });
    await user.click(screen.getByRole('checkbox', { name: '合成商品' }));
    expect(screen.getByTestId('search-button')).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId('question-input'), { key: 'Enter', code: 'Enter' });
    expect(await screen.findByText('正在更新查询范围，请稍后查询。')).toBeVisible();
    expect(screen.queryByText('请输入最多 500 字的客户问题。')).not.toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
    if (outcome === 'success') {
      await act(async () => selection.resolve({ ...context, productIds: ['product-a'] }));
    } else {
      await act(async () => {
        if (outcome === 'rejected') selection.resolve({ ok: false, message: '合成资格拒绝，请刷新店铺。' });
        else selection.resolve(context);
      });
      expect(screen.queryByText('正在更新查询范围，请稍后查询。')).not.toBeInTheDocument();
      expect(await screen.findByText(outcome === 'rejected' ? '合成资格拒绝，请刷新店铺。' : '筛选条件更新失败，请刷新店铺。')).toBeVisible();
      expect(search).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: '刷新店铺' }));
      await waitFor(() => expect(screen.getByTestId('search-button')).toBeEnabled());
    }
    expect(screen.queryByText('正在更新查询范围，请稍后查询。')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-input')).toHaveValue('合成客户问题');
    expect(screen.getByTestId('search-button')).toBeEnabled();
    await user.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ queryText: '合成客户问题' })));
    await waitFor(() => expect(workspace.navigate).toHaveBeenCalledWith(expect.objectContaining({ type: 'results' })));
    expect(screen.queryByText('无法读取流程进度')).not.toBeInTheDocument();
    expect(sopOpen).not.toHaveBeenCalled();
  });

  it('keeps FAQ notice visible, ignores stale results and lets a fresh query survive old expiry', async () => {
    const user = userEvent.setup();
    const session = { ok: true as const, enabled: true, signedIn: true, sessionEpoch: 1,
      userId: 'synthetic', role: 'agent' as const, authMode: 'mock' as const,
      expiresAt: '2099-01-01T00:00:00Z', displayName: '合成坐席' };
    const menu = deferred<import('../../src/shared/content-intake-query').IntakeQueryResult<import('../../src/shared/content-intake-query').IntakeQueryContext>>();
    const search = vi.fn().mockResolvedValue({ ok: true, rows: [] });
    let invalidate: (event: import('../../src/shared/content-intake-query').IntakeQueryInvalidationEvent) => void = () => {};
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(session), login: vi.fn().mockResolvedValue(session), logout: vi.fn(), onSessionChanged: () => () => {},
      currentNotice: vi.fn().mockResolvedValue({ ok: true, sessionEpoch: 1, decision: null, decided_at: null,
        notice: { version: 'v1', content: '合成告知', content_hash: 'a'.repeat(64), published_at: '2026-01-01T00:00:00Z' } }),
      decideNotice: vi.fn().mockResolvedValue({ ok: true, sessionEpoch: 1, version: 'v1', decision: 'accepted', decided_at: '2026-01-01T00:00:00Z' }),
    };
    window.customerAgent!.intakeQuery = {
      mode: vi.fn().mockResolvedValue({ ok: true, enabled: true }), access: vi.fn().mockReturnValue(menu.promise),
      selectConditions: vi.fn(),
      selectShop: vi.fn().mockResolvedValue({ ok: true, ...emptyIntakeQueryContext(), shops: ['shop-a'], shopId: 'shop-a' }), search,
      copy: vi.fn().mockResolvedValue({ ok: true, copied: true }), cancel: vi.fn().mockResolvedValue({ ok: true, cancelled: true }),
      onInvalidated: listener => { invalidate = listener; return () => {}; },
    };
    render(<QueryApp intake />); activateQuery();
    expect(screen.queryByText(/MiniMax 只规划/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('notice-backdrop')).not.toBeInTheDocument();
    await act(async () => menu.resolve({ ok: true, ...emptyIntakeQueryContext(), shops: ['shop-a'], shopId: null }));
    await user.click(screen.getByRole('button', { name: '筛选' }));
    await user.selectOptions(screen.getByRole('combobox', { name: '当前店铺' }), 'shop-a');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('shop-a'));
    const pending = deferred<unknown>(); search.mockReturnValueOnce(pending.promise);
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '洁面' } });
    await user.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '已改变的问题' } });
    await act(async () => pending.resolve({ ok: true, rows: [{ kind: 'intake', key: 'old', rank: 1, title: '过期回调', answerText: '不应展示',
      applicabilityNote: '', riskNote: '', releaseId: 'r1', validUntil: '2099-01-01T00:00:00Z' }] }));
    expect(screen.queryByText('不应展示')).not.toBeInTheDocument();
    const fresh = deferred<unknown>(); search.mockReturnValueOnce(fresh.promise);
    await user.click(screen.getByTestId('search-button'));
    act(() => invalidate({ reason: 'expired', contextId: search.mock.calls[0][0].contextId }));
    await act(async () => fresh.resolve({ ok: true, rows: [{ kind: 'intake', key: 'fresh', rank: 1, title: '新资格', answerText: '新的合成话术',
      applicabilityNote: '', riskNote: '', releaseId: 'r2', validUntil: '2099-01-01T00:00:00Z' }] }));
    await user.click(await screen.findByTestId('copy-button-1'));
    expect(window.customerAgent!.intakeQuery!.copy).toHaveBeenCalledWith({ key: 'fresh' });
    expect(copyText).not.toHaveBeenCalled();
  });

  it.each([
    ['facts-expired', 'pending'], ['facts-expired', 'shown'], ['invalidated', 'pending'],
    ['invalidated', 'shown'], ['expired', 'pending'], ['expired', 'shown'],
  ] as const)('keeps a replacement query when an older %s event is delivered after it is %s', async (reason, delivery) => {
    const user = userEvent.setup();
    const session = { ok: true as const, enabled: true, signedIn: true, sessionEpoch: 1,
      userId: 'synthetic', role: 'agent' as const, authMode: 'mock' as const,
      expiresAt: '2099-01-01T00:00:00Z', displayName: '合成坐席' };
    const oldCopy = deferred<import('../../src/shared/content-intake-query').IntakeQueryResult<{ copied: true }>>();
    const newCopy = deferred<import('../../src/shared/content-intake-query').IntakeQueryResult<{ copied: true }>>();
    const replacement = deferred<import('../../src/shared/content-intake-query').IntakeQueryResult<{ rows: import('../../src/shared/content-intake-query').IntakeQueryRow[] }>>();
    let invalidate: (event: import('../../src/shared/content-intake-query').IntakeQueryInvalidationEvent) => void = () => {};
    let deliverOldEvent = () => {};
    const row = (key: string, answerText: string) => ({ kind: 'intake' as const, key, rank: 1 as const, title: key, answerText,
      applicabilityNote: '', riskNote: '', releaseId: 'r1', validUntil: '2099-01-01T00:00:00Z' });
    const search = vi.fn().mockResolvedValueOnce({ ok: true, rows: [row('old', '旧合成正文')] }).mockReturnValueOnce(replacement.promise);
    const copy = vi.fn().mockImplementationOnce(() => { const contextId = search.mock.calls[0][0].contextId;
      deliverOldEvent = () => invalidate({ reason, contextId }); return oldCopy.promise; }).mockReturnValueOnce(newCopy.promise);
    const cancel = vi.fn().mockResolvedValue({ ok: true, cancelled: true });
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(session), login: vi.fn(), logout: vi.fn(), onSessionChanged: () => () => {},
      currentNotice: vi.fn().mockResolvedValue({ ok: true, sessionEpoch: 1, decision: 'accepted', decided_at: '2026-01-01T00:00:00Z',
        notice: { version: 'v1', content: '合成告知', content_hash: 'a'.repeat(64), published_at: '2026-01-01T00:00:00Z' } }),
      decideNotice: vi.fn(),
    };
    window.customerAgent!.intakeQuery = {
      mode: vi.fn().mockResolvedValue({ ok: true, enabled: true }),
      access: vi.fn().mockResolvedValue({ ok: true, ...emptyIntakeQueryContext(), shops: ['shop-a'], shopId: 'shop-a' }),
      selectConditions: vi.fn(), selectShop: vi.fn(), search,
      copy, cancel,
      onInvalidated: listener => { invalidate = listener; return () => {}; },
    };
    render(<QueryApp intake />); activateQuery();
    await waitFor(() => expect(screen.getByTestId('search-button')).toBeEnabled());
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '旧问题' } });
    await user.click(screen.getByTestId('search-button'));
    await user.click(await screen.findByTestId('copy-button-1'));
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '新问题' } });
    await user.click(screen.getByTestId('search-button'));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    const resolveReplacement = async () => act(async () => replacement.resolve({ ok: true, rows: [row('new', '新合成正文')] }));
    if (delivery === 'shown') {
      await resolveReplacement(); expect(await screen.findByText('新合成正文')).toBeVisible();
      await user.click(screen.getByTestId('copy-button-1'));
    }
    const cancellations = cancel.mock.calls.length;
    act(() => deliverOldEvent());
    expect(cancel).toHaveBeenCalledTimes(cancellations);
    if (delivery === 'pending') await resolveReplacement();
    expect(await screen.findByText('新合成正文')).toBeVisible();
    if (delivery === 'pending') await user.click(screen.getByTestId('copy-button-1'));
    await act(async () => oldCopy.resolve({ ok: false, code: 'FACTS_EXPIRED', message: '资料资格过期了，请稍后重试。' }));
    expect(screen.getByText('新合成正文')).toBeVisible();
    await act(async () => newCopy.resolve({ ok: true, copied: true }));
    expect(await screen.findByTestId('toast')).toHaveTextContent(COPY_SUCCESS_MESSAGE);
  });

  it('clears a result and explains expired organization facts while its copy response is pending', async () => {
    const user = userEvent.setup();
    const session = { ok: true as const, enabled: true, signedIn: true, sessionEpoch: 1,
      userId: 'synthetic', role: 'agent' as const, authMode: 'mock' as const,
      expiresAt: '2099-01-01T00:00:00Z', displayName: '合成坐席' };
    const copy = deferred<import('../../src/shared/content-intake-query').IntakeQueryResult<{ copied: true }>>();
    let invalidate: (event: import('../../src/shared/content-intake-query').IntakeQueryInvalidationEvent) => void = () => {};
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(session), login: vi.fn().mockResolvedValue(session), logout: vi.fn(), onSessionChanged: () => () => {},
      currentNotice: vi.fn().mockResolvedValue({ ok: true, sessionEpoch: 1, decision: null, decided_at: null,
        notice: { version: 'v1', content: '合成告知', content_hash: 'a'.repeat(64), published_at: '2026-01-01T00:00:00Z' } }),
      decideNotice: vi.fn().mockResolvedValue({ ok: true, sessionEpoch: 1, version: 'v1', decision: 'accepted', decided_at: '2026-01-01T00:00:00Z' }),
    };
    const search = vi.fn().mockResolvedValue({ ok: true, rows: [{ kind: 'intake', key: 'current', rank: 1, title: '合成标题', answerText: '合成正文',
      applicabilityNote: '', riskNote: '', releaseId: 'r1', validUntil: '2099-01-01T00:00:00Z' }] });
    window.customerAgent!.intakeQuery = {
      mode: vi.fn().mockResolvedValue({ ok: true, enabled: true }),
      access: vi.fn().mockResolvedValue({ ok: true, ...emptyIntakeQueryContext(), shops: ['shop-a'], shopId: 'shop-a' }),
      selectConditions: vi.fn(), selectShop: vi.fn(),
      search,
      copy: vi.fn().mockReturnValue(copy.promise), cancel: vi.fn().mockResolvedValue({ ok: true, cancelled: true }),
      onInvalidated: listener => { invalidate = listener; return () => {}; },
    };
    render(<QueryApp intake />); activateQuery();
    await waitFor(() => expect(screen.getByTestId('search-button')).toBeEnabled());
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成问题' } });
    await user.click(screen.getByTestId('search-button'));
    await user.click(await screen.findByTestId('copy-button-1'));
    act(() => invalidate({ reason: 'facts-expired', contextId: search.mock.calls[0][0].contextId }));
    expect(await screen.findByText('资料资格过期了，请稍后重试。')).toBeVisible();
    expect(screen.queryByText('合成正文')).not.toBeInTheDocument();
    await act(async () => copy.resolve({ ok: false, code: 'FACTS_EXPIRED', message: '资料资格过期了，请稍后重试。' }));
    expect(screen.getByText('资料资格过期了，请稍后重试。')).toBeVisible();
    expect(screen.queryByText(COPY_SUCCESS_MESSAGE)).not.toBeInTheDocument();
  });

  it.each(['facts-expired', 'invalidated', 'expired'] as const)('rejects a late search reply after its own %s event arrives first', async reason => {
    const user = userEvent.setup();
    const session = { ok: true as const, enabled: true, signedIn: true, sessionEpoch: 1,
      userId: 'synthetic', role: 'agent' as const, authMode: 'mock' as const,
      expiresAt: '2099-01-01T00:00:00Z', displayName: '合成坐席' };
    const pending = deferred<import('../../src/shared/content-intake-query').IntakeQueryResult<{ rows: import('../../src/shared/content-intake-query').IntakeQueryRow[] }>>();
    const search = vi.fn().mockReturnValue(pending.promise);
    let invalidate: (event: import('../../src/shared/content-intake-query').IntakeQueryInvalidationEvent) => void = () => {};
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(session), login: vi.fn(), logout: vi.fn(), onSessionChanged: () => () => {},
      currentNotice: vi.fn().mockResolvedValue({ ok: true, sessionEpoch: 1, decision: 'accepted', decided_at: '2026-01-01T00:00:00Z',
        notice: { version: 'v1', content: '合成告知', content_hash: 'a'.repeat(64), published_at: '2026-01-01T00:00:00Z' } }),
      decideNotice: vi.fn(),
    };
    window.customerAgent!.intakeQuery = {
      mode: vi.fn().mockResolvedValue({ ok: true, enabled: true }),
      access: vi.fn().mockResolvedValue({ ok: true, ...emptyIntakeQueryContext(), shops: ['shop-a'], shopId: 'shop-a' }),
      selectConditions: vi.fn(), selectShop: vi.fn(), search, copy: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ ok: true, cancelled: true }),
      onInvalidated: listener => { invalidate = listener; return () => {}; },
    };
    render(<QueryApp intake />); activateQuery();
    await waitFor(() => expect(screen.getByTestId('search-button')).toBeEnabled());
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成问题' } });
    await user.click(screen.getByTestId('search-button'));
    act(() => invalidate({ reason, contextId: search.mock.calls[0][0].contextId }));
    await act(async () => pending.resolve({ ok: true, rows: [{ kind: 'intake', key: 'stale', rank: 1, title: '失效标题', answerText: '失效正文',
      applicabilityNote: '', riskNote: '', releaseId: 'r1', validUntil: '2099-01-01T00:00:00Z' }] }));
    expect(screen.queryByText('失效正文')).not.toBeInTheDocument();
    expect(screen.getByText(reason === 'facts-expired' ? '资料资格过期了，请稍后重试。' : '资料资格已失效，请重新查询。')).toBeVisible();
  });

  it.each(['shop switch', 'logout'] as const)('ignores an old copy event after %s, but clears a current invalidation', async action => {
    const user = userEvent.setup();
    const signedIn = { ok: true as const, enabled: true, signedIn: true, sessionEpoch: 1,
      userId: 'synthetic', role: 'agent' as const, authMode: 'mock' as const,
      expiresAt: '2099-01-01T00:00:00Z', displayName: '合成坐席', job: null };
    const signedOut = { ...signedIn, signedIn: false, sessionEpoch: 2, userId: null, role: null, authMode: null, expiresAt: null, displayName: null };
    const oldCopy = deferred<import('../../src/shared/content-intake-query').IntakeQueryResult<{ copied: true }>>();
    let sessionChanged: (event: import('../../src/shared/product-session').ProductSessionResult) => void = () => {};
    let invalidate: (event: import('../../src/shared/content-intake-query').IntakeQueryInvalidationEvent) => void = () => {};
    const row = (key: string, answerText: string) => ({ kind: 'intake' as const, key, rank: 1 as const, title: key, answerText,
      applicabilityNote: '', riskNote: '', releaseId: 'r1', validUntil: '2099-01-01T00:00:00Z' });
    const context = (shopId: string) => ({ ok: true as const, ...emptyIntakeQueryContext(), shops: ['shop-a', 'shop-b'], shopId });
    const search = vi.fn().mockResolvedValueOnce({ ok: true, rows: [row('old', '旧店合成正文')] })
      .mockResolvedValueOnce({ ok: true, rows: [row('new', '新上下文合成正文')] });
    window.customerAgent!.product = {
      sessionStatus: vi.fn().mockResolvedValue(signedIn), login: vi.fn(), logout: vi.fn(),
      onSessionChanged: listener => { sessionChanged = listener; return () => {}; },
      currentNotice: vi.fn(), decideNotice: vi.fn(),
    };
    window.customerAgent!.intakeQuery = {
      mode: vi.fn().mockResolvedValue({ ok: true, enabled: true }), access: vi.fn().mockResolvedValue(context('shop-a')),
      selectShop: vi.fn(async request => context(request.shopId)), selectConditions: vi.fn(), search,
      copy: vi.fn().mockReturnValue(oldCopy.promise), cancel: vi.fn().mockResolvedValue({ ok: true, cancelled: true }),
      onInvalidated: listener => { invalidate = listener; return () => {}; },
    };
    render(<QueryApp intake />); activateQuery();
    await waitFor(() => expect(screen.getByTestId('search-button')).toBeEnabled());
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '合成问题' } });
    await user.click(screen.getByTestId('search-button'));
    await user.click(await screen.findByTestId('copy-button-1'));
    const oldId = search.mock.calls[0][0].contextId;
    if (action === 'shop switch') {
      await user.click(screen.getByRole('button', { name: '筛选' }));
      await user.selectOptions(screen.getByRole('combobox', { name: '当前店铺' }), 'shop-b');
      await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('shop-b'));
    } else {
      act(() => sessionChanged(signedOut));
      expect(screen.queryByText('旧店合成正文')).not.toBeInTheDocument();
      act(() => sessionChanged({ ...signedIn, sessionEpoch: 3 }));
    }
    await waitFor(() => expect(screen.getByTestId('search-button')).toBeEnabled());
    await user.click(screen.getByTestId('search-button'));
    expect(await screen.findByText('新上下文合成正文')).toBeVisible();
    const newId = search.mock.calls[1][0].contextId;
    expect(newId).not.toBe(oldId);
    act(() => invalidate({ reason: 'facts-expired', contextId: oldId }));
    await act(async () => oldCopy.resolve({ ok: false, code: 'FACTS_EXPIRED', message: '资料资格过期了，请稍后重试。' }));
    expect(screen.getByText('新上下文合成正文')).toBeVisible();
    act(() => invalidate({ reason: 'invalidated', contextId: newId }));
    expect(screen.queryByText('新上下文合成正文')).not.toBeInTheDocument();
    expect(screen.getByText('资料资格已失效，请重新查询。')).toBeVisible();
  });

});
