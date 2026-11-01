import { IntakeAntdTheme } from '../../src/renderer/features/dashboard/intake-antd';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() } }));
import { SopWindowController } from '../../src/main/sop-window-controller';
import { QuerySopPanel } from '../../src/renderer/features/sop/QuerySopPanel';
import { projectSop } from '../../src/shared/sop-model';
import { ALLERGY_SOP_TREE, MISSING_ITEM_SOP_TREE, SYNTHETIC_SOP_TREES } from '../../src/shared/synthetic-sops';
import type { QuerySopCommand, QuerySopCopyRequest, SopProjection, SopWindowResult, SopCopyResult } from '../../src/shared/sop-window';
import { SOP_COPY_FEEDBACK_MS } from '../../src/shared/sop-window';

const sessions: SopWindowController[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.destroy()); });

function withTestMatchTerm(projection: SopProjection, edgeId: string, term: string): SopProjection {
  return { ...projection, edges: projection.edges.map(edge => edge.id === edgeId ? { ...edge, matchTerms: [term] } : edge) };
}

async function renderSession(tree = ALLERGY_SOP_TREE, decorate: (projection: SopProjection) => SopProjection = projection => projection) {
  let activeId: string | null = null;
  const session = new SopWindowController({ enabled: () => true, sessionRole: () => 'agent',
    presentation: { selectedTask: () => activeId, showTask: async taskId => { activeId = taskId; return true; }, removeTask: taskId => { if (activeId === taskId) activeId = null; }, changed: () => {} }, writeClipboard: vi.fn() });
  sessions.push(session);
  await session.open(tree.sceneId);
  const api = {
    open: vi.fn(), entryAvailable: vi.fn(), resumeAvailable: vi.fn(),
    command: vi.fn(async (request: QuerySopCommand): Promise<SopWindowResult> => {
      const result = session.command(request);
      view.rerender(element());
      return result;
    }),
    copyCurrent: vi.fn(async (request: QuerySopCopyRequest): Promise<SopCopyResult> => {
      const result = session.copyCurrent(request);
      view.rerender(element());
      return result;
    }),
  };
  function element() {
    const projection = session.current();
    if (!projection) throw new Error('Expected an active SOP session');
    return <IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={decorate(projection)} api={api} onSearch={vi.fn()} onCollapse={vi.fn()} /></IntakeAntdTheme>;
  }
  const view = render(element());
  return { session, api };
}

async function prepareRestartView() {
  const context = await renderSession(ALLERGY_SOP_TREE, projection => withTestMatchTerm(projection, 'has-photo', '已提供照片'));
  fireEvent.change(screen.getByRole('textbox', { name: '客户当前情况' }), { target: { value: '已提供照片' } });
  fireEvent.click(screen.getByRole('button', { name: '索取凭证' }));
  fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent('已复制'));
  screen.getByTestId('sop-scroll-content').scrollTop = 120;
  return context;
}

async function openRestartConfirmation() {
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '重新开始' }));
  return within(await screen.findByRole('dialog'));
}

const syntheticDecisions = SYNTHETIC_SOP_TREES.flatMap(tree => tree.nodes
  .filter(node => node.kind === 'decision').map(node => ({ nodeId: node.id, tree })));

function renderStep(nodeId = 'voucher-ask', overrides: Partial<SopProjection> = {}, tree = ALLERGY_SOP_TREE) {
  const api = { open: vi.fn(), entryAvailable: vi.fn(), resumeAvailable: vi.fn(), command: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })), copyCurrent: vi.fn(async (request: QuerySopCopyRequest): Promise<SopCopyResult> => ({ ok: true, outcome: 'copied-stayed', reason: 'decision', source: { taskId: request.taskId, revision: request.revision, stepIndex: request.stepIndex }, sourceTitle: '测试步骤', copyGeneration: 1 })) };
  const projection = { ...projectSop({ tree, progress: { sceneId: tree.sceneId, nodeId, stepIndex: 1 }, role: 'agent', taskId: 'test-task', revision: 7 }), ...overrides };
  const onSearch = vi.fn();
  const onCollapse = vi.fn();
  const view = render(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={projection} api={api} onSearch={onSearch} onCollapse={onCollapse} /></IntakeAntdTheme>);
  return { api, onSearch, onCollapse, projection, view };
}

describe('SOP explicit navigation', () => {
  it('keeps previous and next visible but cannot bypass a decision', () => {
    const { api } = renderStep();
    expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.keyDown(window, { key: 'F8' });
    expect(api.command).not.toHaveBeenCalled();
  });

  it('returns to the actual previous step only after confirming the cleared records', async () => {
    const { api } = renderStep('classify', { stepIndex: 4, history: [
      { stepIndex: 1, nodeId: 'collect', title: '较早步骤', instruction: '较早说明', choiceLabel: null, confirmedRequirements: [] },
      { stepIndex: 3, nodeId: 'recheck', title: '实际上一条', instruction: '上一步说明', choiceLabel: null, confirmedRequirements: [] },
      { stepIndex: 4, nodeId: 'classify', title: '当前步骤', instruction: '当前说明', choiceLabel: null, confirmedRequirements: [] },
    ] }, MISSING_ITEM_SOP_TREE);
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('将清除这一步及后续的选择和确认记录，已复制内容无法撤回。')).toBeInTheDocument();
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: '取消' }));
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '返回并清除后续进度' }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith({ hostEpoch: 1, type: 'rewind', targetStepIndex: 3, taskId: 'test-task', revision: 7, stepIndex: 4 }));
  });

  it('marks a selected decision while submitting, then permits retry on failure', async () => {
    const { api } = renderStep();
    let finish: (value: SopWindowResult) => void = () => undefined;
    api.command.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const chosen = screen.getByRole('button', { name: /已给照片/ });
    fireEvent.click(chosen);
    expect(chosen).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: /未给照片/ })).toBeDisabled();
    fireEvent.click(chosen);
    expect(api.command).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: false, code: 'FAILED', message: '流程暂不可用' }));
    expect(await screen.findByText('流程暂不可用')).toBeVisible();
    expect(chosen).toBeEnabled();
    expect(chosen).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { name: '核实凭证' })).toBeVisible();
  });

  it('clears a successful copy-and-advance message when returning to an earlier step', async () => {
    const { session } = await renderSession(MISSING_ITEM_SOP_TREE);
    fireEvent.click(screen.getByRole('checkbox', { name: '已核对订单应收数量' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked());
    fireEvent.click(screen.getByRole('checkbox', { name: '已核对实收数量和包裹信息' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '已核对实收数量和包裹信息' })).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: '复制确认收到材料' }));
    await waitFor(() => expect(screen.getByTestId('sop-feedback')).toHaveTextContent('已复制步骤 1，已进入下一步'));
    expect(session.current()?.stepIndex).toBe(2);
    fireEvent.click(screen.getByText('已走步骤'));
    fireEvent.click(screen.getByText('步骤 1 核对订单与实收数量'));
    fireEvent.click(screen.getByRole('button', { name: '返回此步' }));
    fireEvent.click(await screen.findByRole('button', { name: '返回并清除后续进度' }));
    await waitFor(() => expect(session.current()?.stepIndex).toBe(1));
    await waitFor(() => expect(screen.getByTestId('sop-feedback')).not.toHaveTextContent('已复制'));
    expect(screen.getByRole('checkbox', { name: '已核对订单应收数量' })).not.toBeChecked();
  });

  it('clears the current situation, recommendations, expanded wording, copy feedback and scroll after restarting the first step', async () => {
    const { session } = await prepareRestartView();
    const before = session.current();
    expect(screen.getByText(/推荐 · 匹配/)).toBeVisible();
    expect(screen.getByRole('button', { name: '索取凭证' })).toHaveAttribute('aria-expanded', 'true');
    const confirmation = await openRestartConfirmation();
    fireEvent.click(confirmation.getByRole('button', { name: '重新开始' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '客户当前情况' })).toHaveValue(''));
    expect(screen.queryByText(/推荐 · 匹配/)).toBeNull();
    expect(screen.getByRole('button', { name: '索取凭证' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent(/^复制$/);
    expect(screen.getByTestId('sop-scroll-content').scrollTop).toBe(0);
    expect(session.current()).toMatchObject({ sceneId: before?.sceneId, nodeId: before?.nodeId, stepIndex: 1, copied: false });
    expect(session.current()?.revision).not.toBe(before?.revision);
  });
  it.each(['cancel', 'failure', 'reject'] as const)('preserves the current view when restarting ends in %s', async outcome => {
    const { api, session } = await prepareRestartView();
    const before = session.current();
    if (outcome === 'failure') api.command.mockResolvedValueOnce({ ok: false, code: 'FAILED', message: '流程暂不可用' });
    if (outcome === 'reject') api.command.mockRejectedValueOnce(new Error('IPC unavailable'));
    const confirmation = await openRestartConfirmation();
    fireEvent.click(confirmation.getByRole('button', { name: outcome === 'cancel' ? '取消' : '重新开始' }));
    if (outcome === 'cancel') expect(api.command).not.toHaveBeenCalled();
    else expect(await screen.findByText(outcome === 'failure' ? '流程暂不可用' : '操作失败，请重试')).toBeVisible();
    expect(screen.getByRole('textbox', { name: '客户当前情况' })).toHaveValue('已提供照片');
    expect(screen.getByText(/推荐 · 匹配/)).toBeVisible();
    expect(screen.getByRole('button', { name: '索取凭证' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '复制索取凭证' })).toBeEnabled();
    expect(screen.getByTestId('sop-scroll-content').scrollTop).toBe(120);
    expect(session.current()).toEqual(before);
  });
  it('preserves current input and expanded wording through copy, wait and resume revisions', async () => {
    const { session } = await prepareRestartView();
    const beforeWait = session.current()?.revision;
    expect(screen.getByRole('textbox', { name: '客户当前情况' })).toHaveValue('已提供照片');
    expect(screen.getByRole('button', { name: '索取凭证' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '等待客户' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '继续处理' })).toBeEnabled());
    expect(session.current()?.revision).not.toBe(beforeWait);
    fireEvent.click(screen.getByRole('button', { name: '继续处理' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '继续处理' })).toBeNull());
    expect(screen.getByRole('textbox', { name: '客户当前情况' })).toHaveValue('已提供照片');
    expect(screen.getByText(/推荐 · 匹配/)).toBeVisible();
    expect(screen.getByRole('button', { name: '索取凭证' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('sop-scroll-content').scrollTop).toBe(120);
  });
  it('preserves expanded wording through requirement revisions', async () => {
    const { session } = await renderSession(MISSING_ITEM_SOP_TREE);
    const before = session.current()?.revision;
    fireEvent.click(screen.getByRole('button', { name: '索取数量与包裹信息' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '已核对订单应收数量' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeChecked());
    expect(session.current()?.revision).not.toBe(before);
    expect(screen.getByRole('button', { name: '索取数量与包裹信息' })).toHaveAttribute('aria-expanded', 'true');
  });
  it('shows task images and reveals only the opened wording and knowledge images without advancing', () => {
    const { api, projection } = renderStep('collect', {}, MISSING_ITEM_SOP_TREE);
    expect(screen.getByRole('img', { name: '合成示例：订单三件，实收两件' })).toHaveAttribute('src', projection.images[0]?.dataUrl);
    expect(screen.queryByRole('img', { name: '合成示例：包裹外观与包裹信息' })).toBeNull();
    expect(screen.queryByRole('img', { name: '合成示例：订单分为已送达和在途两个包裹' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '索取数量与包裹信息' }));
    expect(screen.getByRole('img', { name: '合成示例：包裹外观与包裹信息' })).toBeVisible();
    fireEvent.click(screen.getByText('少件与分包发货'));
    expect(screen.getByRole('img', { name: '合成示例：订单分为已送达和在途两个包裹' })).toBeVisible();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.copyCurrent).not.toHaveBeenCalled();
  });
  it('shows a visible fallback when an image cannot be decoded', () => {
    const { api } = renderStep('collect', {}, MISSING_ITEM_SOP_TREE);
    const caption = screen.getByText('合成示例：订单三件，实收两件');
    expect(caption).toHaveAttribute('aria-hidden', 'true');
    fireEvent.error(screen.getByRole('img', { name: '合成示例：订单三件，实收两件' }));
    expect(screen.getByRole('status')).toHaveTextContent('图片无法显示');
    expect(caption).toBeVisible();
    expect(caption).not.toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: '重新读取图片' })).toBeNull();
    expect(api.command).not.toHaveBeenCalled();
    expect(api.copyCurrent).not.toHaveBeenCalled();
  });
  it('preserves repeated image placements in order and handles each display independently', () => {
    const image = MISSING_ITEM_SOP_TREE.nodes[0]!.images![0]!;
    const other = MISSING_ITEM_SOP_TREE.nodes[0]!.knowledge[0]!.images![0]!;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderStep('collect', { images: [image, other, image] }, MISSING_ITEM_SOP_TREE);
      expect(screen.getAllByRole('img', { name: /^合成示例：/ }).map(item => item.getAttribute('alt'))).toEqual([image.alt, other.alt, image.alt]);
      const images = screen.getAllByRole('img', { name: image.alt });
      expect(images).toHaveLength(2);
      expect(images[0]).toHaveAttribute('src', image.dataUrl);
      expect(images[1]).toHaveAttribute('src', image.dataUrl);
      expect(errors.mock.calls.some(call => /same key|unique .key./i.test(String(call[0])))).toBe(false);
      fireEvent.error(images[0]);
      expect(screen.getByRole('status')).toHaveTextContent('图片无法显示');
      expect(screen.getAllByRole('img', { name: image.alt })).toHaveLength(1);
      expect(screen.getByRole('img', { name: image.alt })).toBeVisible();
    } finally { errors.mockRestore(); }
  });
  it('keeps wording collapsed while copying without navigating', async () => {
    const { api, projection } = renderStep();
    const script = projection.scripts[0];
    if (!script || script.unpublished) throw new Error('Expected an available synthetic wording');
    expect(screen.getByText(script.answerText)).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
    await waitFor(() => expect(api.copyCurrent).toHaveBeenCalledWith({ hostEpoch: 1, taskId: 'test-task', revision: 7, stepIndex: 1, scriptId: script.scriptId }));
    expect(api.command).not.toHaveBeenCalled();
    expect(screen.getByText(script.answerText)).not.toBeVisible();
  });
  it('marks the copied wording inline and keeps the error feedback outside the scroll body', async () => {
    const { api } = renderStep();
    const body = screen.getByTestId('sop-scroll-content');
    const feedback = screen.getByTestId('sop-feedback');
    expect(body.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent('已复制'));
    expect(api.command).not.toHaveBeenCalled();
  });

  it('exposes the step title as a live, focusable heading', () => {
    const { projection } = renderStep();
    const title = screen.getByRole('heading', { name: projection.taskTitle });
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(title).toHaveAttribute('aria-live', 'polite');
  });
  it('resets the body scroll and focuses the new step title after navigation', async () => {
    const { projection, view } = renderStep();
    const body = screen.getByTestId('sop-scroll-content');
    body.scrollTop = 120;
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={{ ...projection, nodeId: 'collect', stepIndex: 2, taskTitle: '下一步任务' }}
      api={{ command: vi.fn(async (): Promise<SopWindowResult> => ({ ok: true })), copyCurrent: vi.fn(async (request: QuerySopCopyRequest): Promise<SopCopyResult> => ({ ok: true, outcome: 'copied-stayed', reason: 'decision', source: { taskId: request.taskId, revision: request.revision, stepIndex: request.stepIndex }, sourceTitle: '测试步骤', copyGeneration: 1 })) }}
      onSearch={vi.fn()} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    await waitFor(() => expect(body.scrollTop).toBe(0));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '下一步任务' }));
  });
  it('expands a wording independently of copying or task progress', () => {
    const { api, projection } = renderStep();
    const script = projection.scripts[0];
    if (!script || script.unpublished) throw new Error('Expected an available synthetic wording');
    fireEvent.click(screen.getByRole('button', { name: '索取凭证' }));
    expect(screen.getByText(script.answerText)).toBeVisible();
    expect(api.copyCurrent).not.toHaveBeenCalled();
    expect(api.command).not.toHaveBeenCalled();
  });
  it('does not guess a shortcut target when several wordings exist', async () => {
    const { api } = renderStep('collect', {}, MISSING_ITEM_SOP_TREE);
    fireEvent.keyDown(window, { key: 'F6' });
    expect(api.copyCurrent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '复制话术' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '复制确认收到材料' }));
    await waitFor(() => expect(api.copyCurrent).toHaveBeenCalledWith({ hostEpoch: 1, taskId: 'test-task', revision: 7, stepIndex: 1, scriptId: 'syn-missing-ack' }));
    expect(api.command).not.toHaveBeenCalled();
  });
  it('copies only the selected wording with F6', async () => {
    const { api } = renderStep('collect', { selectedScriptId: 'syn-missing-ask' }, MISSING_ITEM_SOP_TREE);
    fireEvent.keyDown(window, { key: 'F6' });
    await waitFor(() => expect(api.copyCurrent).toHaveBeenCalledWith({ hostEpoch: 1, taskId: 'test-task', revision: 7, stepIndex: 1, scriptId: 'syn-missing-ask' }));
  });
  it('shows task requirements while wordings are folded', () => {
    const { api } = renderStep('collect', {}, MISSING_ITEM_SOP_TREE);
    expect(screen.getByText('核对订单应收数量、客户实收数量和包裹信息。')).toBeVisible();
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '已核对订单应收数量' }));
    expect(api.command).toHaveBeenCalledWith({ hostEpoch: 1, type: 'check', requirementId: 'ordered', checked: true, taskId: 'test-task', revision: 7, stepIndex: 1 });
    fireEvent.keyDown(window, { key: 'F8' });
    expect(api.command).toHaveBeenCalledOnce();
  });
  it('cannot bypass decisions with F8 and exposes the criterion', () => {
    const { api } = renderStep('classify', {}, MISSING_ITEM_SOP_TREE);
    fireEvent.keyDown(window, { key: 'F8' });
    expect(api.command).not.toHaveBeenCalled();
    expect(screen.getByText('未能核实包裹状态或数量')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /信息不足/ }));
    expect(api.command).toHaveBeenCalledWith({ hostEpoch: 1, type: 'choose', edgeId: 'unknown', taskId: 'test-task', revision: 7, stepIndex: 1 });
  });
  it.each(['severity', 'reassess-situation'])('offers explicit allergy choices without an unreliable recommendation in %s', nodeId => {
    const { api } = renderStep(nodeId);
    expect(screen.queryByRole('textbox', { name: '客户当前情况' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /客户描述轻微/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /客户描述明显不适/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /信息.*不足/ })).toBeEnabled();
    expect(api.command).not.toHaveBeenCalled();
  });
  it.each(syntheticDecisions)('keeps synthetic decision $nodeId manual without a recommendation input', ({ nodeId, tree }) => {
    const { projection, api } = renderStep(nodeId, {}, tree);
    expect(screen.queryByRole('textbox', { name: '客户当前情况' })).not.toBeInTheDocument();
    expect(screen.queryByText(/推荐 · 匹配/)).not.toBeInTheDocument();
    for (const edge of projection.edges) expect(screen.getByText(edge.label).closest('button')).toBeEnabled();
    expect(api.command).not.toHaveBeenCalled();
  });
  it('recommends matching current choices without advancing until the operator chooses', async () => {
    const sample = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: { sceneId: MISSING_ITEM_SOP_TREE.sceneId, nodeId: 'classify', stepIndex: 1 }, role: 'agent', taskId: 'test-task', revision: 7 });
    const { api } = renderStep('classify', { edges: withTestMatchTerm(sample, 'split', '分包').edges }, MISSING_ITEM_SOP_TREE);
    fireEvent.change(screen.getByRole('textbox', { name: '客户当前情况' }), { target: { value: '订单是分包发货' } });
    expect(screen.getByText('推荐 · 匹配 分包')).toBeVisible();
    expect(screen.getByRole('button', { name: /信息不足/ })).toBeVisible();
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /还有包裹在途/ }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith({ hostEpoch: 1, type: 'choose', edgeId: 'split', taskId: 'test-task', revision: 7, stepIndex: 1 }));
  });
  it('keeps every legal choice available when the input does not match', () => {
    const sample = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: { sceneId: MISSING_ITEM_SOP_TREE.sceneId, nodeId: 'classify', stepIndex: 1 }, role: 'agent', taskId: 'test-task', revision: 7 });
    const { api } = renderStep('classify', { edges: withTestMatchTerm(sample, 'split', '分包').edges }, MISSING_ITEM_SOP_TREE);
    fireEvent.change(screen.getByRole('textbox', { name: '客户当前情况' }), { target: { value: '没有合适的线索' } });
    expect(screen.queryByText(/推荐 · 匹配/)).toBeNull();
    expect(screen.getByRole('button', { name: /信息不足/ })).toBeEnabled();
    expect(api.command).not.toHaveBeenCalled();
  });
  it('ignores held keys, modifiers and composition', () => {
    const { api } = renderStep('record-discomfort');
    fireEvent.keyDown(window, { key: 'F8', repeat: true });
    fireEvent.keyDown(window, { key: 'F8', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'F8', isComposing: true });
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'F8' });
    expect(api.command).toHaveBeenCalledWith({ hostEpoch: 1, type: 'next', taskId: 'test-task', revision: 7, stepIndex: 1 });
  });
  it('keeps waiting read-only until explicitly resumed', () => {
    const { api } = renderStep('collect', { waiting: 'customer' }, MISSING_ITEM_SOP_TREE);
    fireEvent.keyDown(window, { key: 'F6' });
    expect(api.copyCurrent).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '继续处理' }));
    expect(api.command).toHaveBeenCalledWith({ hostEpoch: 1, type: 'resume', taskId: 'test-task', revision: 7, stepIndex: 1 });
  });
  it('returning to search does not end the flow', async () => {
    const { api, onSearch } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: '返回搜索' }));
    await waitFor(() => expect(onSearch).toHaveBeenCalledOnce());
    expect(api.command).not.toHaveBeenCalled();
  });
  it('reports copy failure without navigating or folding', async () => {
    const { api, onCollapse } = renderStep();
    api.copyCurrent.mockResolvedValueOnce({ ok: false, message: '剪贴板暂不可用' });
    fireEvent.click(screen.getByRole('button', { name: '复制话术' }));
    expect(await screen.findByText('剪贴板暂不可用')).toBeVisible();
    expect(api.command).not.toHaveBeenCalled();
    expect(onCollapse).not.toHaveBeenCalled();
  });
  it('reads history without navigation and confirms a rewind', async () => {
    const { api } = renderStep('classify', { stepIndex: 2, history: [
      { stepIndex: 1, nodeId: 'collect', title: '核对订单与实收数量', instruction: '核对订单应收数量、客户实收数量和包裹信息。', choiceLabel: null, confirmedRequirements: [] },
      { stepIndex: 2, nodeId: 'classify', title: '确认数量差异原因', instruction: '根据已核实的信息选择路径。', choiceLabel: null, confirmedRequirements: [] },
    ] }, MISSING_ITEM_SOP_TREE);
    fireEvent.click(screen.getByText('已走步骤'));
    fireEvent.click(screen.getByText('步骤 1 核对订单与实收数量'));
    expect(screen.getByText('核对订单应收数量、客户实收数量和包裹信息。')).toBeVisible();
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回此步' }));
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: '返回并清除后续进度' }));
    await waitFor(() => expect(api.command).toHaveBeenCalledWith({ hostEpoch: 1, type: 'rewind', targetStepIndex: 1, taskId: 'test-task', revision: 7, stepIndex: 2 }));
  });
  it('asks before clearing terminal progress', async () => {
    const { api } = renderStep('followup-recorded');
    fireEvent.click(screen.getByRole('button', { name: '结束流程' }));
    expect(api.command).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    expect(api.command).not.toHaveBeenCalled();
  });
});


describe('SOP execution lease', () => {
  it('automatically clears stayed copy feedback after the configured duration', async () => {
    vi.useFakeTimers();
    try {
      renderStep();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' })); });
      expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent('已复制');
      expect(screen.getByTestId('sop-feedback')).toHaveTextContent('已复制');
      act(() => { vi.advanceTimersByTime(SOP_COPY_FEEDBACK_MS); });
      expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent(/^复制$/);
      expect(screen.getByTestId('sop-feedback')).not.toHaveTextContent('已复制');
    } finally { vi.useRealTimers(); }
  });

  it('automatically clears copy-and-advance feedback on the next step', async () => {
    vi.useFakeTimers();
    try {
      const { api, projection, view } = renderStep('collect', {}, MISSING_ITEM_SOP_TREE);
      api.copyCurrent.mockResolvedValueOnce({ ok: true, outcome: 'copied-advanced', source: { taskId: projection.taskId, stepIndex: 1, revision: 7 }, sourceTitle: projection.taskTitle, copyGeneration: 1 });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制确认收到材料' })); });
      const next = projectSop({ tree: MISSING_ITEM_SOP_TREE, progress: { sceneId: MISSING_ITEM_SOP_TREE.sceneId, nodeId: 'classify', stepIndex: 2 }, role: 'agent', taskId: 'test-task', revision: 8 });
      view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={next} api={api} copyGeneration={1} onCollapse={vi.fn()} /></IntakeAntdTheme>);
      expect(screen.getByTestId('sop-feedback')).toHaveTextContent('已复制步骤 1，已进入下一步');
      act(() => { vi.advanceTimersByTime(SOP_COPY_FEEDBACK_MS); });
      expect(screen.getByTestId('sop-feedback')).not.toHaveTextContent('已复制');
    } finally { vi.useRealTimers(); }
  });

  it('clears stayed feedback when Main reports that its copy indicator expired', async () => {
    const { api, projection, view } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
    await waitFor(() => expect(screen.getByTestId('sop-feedback')).toHaveTextContent('已复制'));
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={{ ...projection, copied: true }} api={api} copyGeneration={1} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent('已复制');
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={{ ...projection, copied: false }} api={api} copyGeneration={1} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    expect(screen.getByTestId('sop-feedback')).not.toHaveTextContent('已复制');
    expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent(/^复制$/);
  });

  it('does not revive stayed feedback after Main has already reported its expiry', async () => {
    const { api, projection, view } = renderStep();
    let finish: (value: SopCopyResult) => void = () => undefined;
    api.copyCurrent.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={{ ...projection, copied: false }} api={api} copyGeneration={1} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    await act(async () => finish({ ok: true, outcome: 'copied-stayed', reason: 'decision', source: { taskId: projection.taskId, stepIndex: 1, revision: 7 }, sourceTitle: projection.taskTitle, copyGeneration: 1 }));
    expect(screen.getByTestId('sop-feedback')).not.toHaveTextContent('已复制');
    expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent(/^复制$/);
  });

  it('does not let an older timer clear newer copy feedback', async () => {
    vi.useFakeTimers();
    try {
      const { api, projection } = renderStep();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' })); });
      act(() => { vi.advanceTimersByTime(SOP_COPY_FEEDBACK_MS / 2); });
      api.copyCurrent.mockResolvedValueOnce({ ok: true, outcome: 'copied-stayed', reason: 'decision', source: { taskId: projection.taskId, stepIndex: 1, revision: 7 }, sourceTitle: projection.taskTitle, copyGeneration: 2 });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' })); });
      act(() => { vi.advanceTimersByTime(SOP_COPY_FEEDBACK_MS / 2); });
      expect(screen.getByTestId('sop-feedback')).toHaveTextContent('已复制');
      act(() => { vi.advanceTimersByTime(SOP_COPY_FEEDBACK_MS / 2); });
      expect(screen.getByTestId('sop-feedback')).not.toHaveTextContent('已复制');
    } finally { vi.useRealTimers(); }
  });

  it('does not restore copy feedback after leaving and returning to a task', async () => {
    const { api, projection, view } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
    await waitFor(() => expect(screen.getByTestId('sop-feedback')).toHaveTextContent('已复制'));
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={2} projection={{ ...projection, taskId: 'other-task' }} api={api} copyGeneration={1} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={3} projection={projection} api={api} copyGeneration={1} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    expect(screen.getByTestId('sop-feedback')).not.toHaveTextContent('已复制');
    expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent(/^复制$/);
  });

  it('clears previous copy feedback when another task copies successfully', async () => {
    const { api, projection, view } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
    await waitFor(() => expect(screen.getByTestId('sop-feedback')).toHaveTextContent('已复制'));
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={projection} api={api} copyGeneration={2} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    expect(screen.getByTestId('sop-feedback')).not.toHaveTextContent('已复制');
    expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent(/^复制$/);
  });

  it('does not revive an older copy response after a newer clipboard generation', async () => {
    const { api, projection, view } = renderStep();
    let finish: (value: SopCopyResult) => void = () => undefined;
    api.copyCurrent.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={projection} api={api} copyGeneration={2} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    await act(async () => finish({ ok: true, outcome: 'copied-stayed', reason: 'decision', source: { taskId: projection.taskId, stepIndex: projection.stepIndex, revision: projection.revision }, sourceTitle: projection.taskTitle, copyGeneration: 1 }));
    expect(screen.getByTestId('sop-feedback')).not.toHaveTextContent('已复制');
    expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent(/^复制$/);
  });

  it('checks a received snapshot before rendering a late copy response', async () => {
    const { api, projection, view } = renderStep();
    let latest = 0;
    let finish: (value: SopCopyResult) => void = () => undefined;
    api.copyCurrent.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={projection} api={api} copyGeneration={0} readCopyGeneration={() => latest} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
    latest = 2;
    await act(async () => finish({ ok: true, outcome: 'copied-stayed', reason: 'decision', source: { taskId: projection.taskId, stepIndex: projection.stepIndex, revision: projection.revision }, sourceTitle: projection.taskTitle, copyGeneration: 1 }));
    expect(screen.getByTestId('sop-feedback')).not.toHaveTextContent('已复制');
    expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent(/^复制$/);
  });

  it('blocks commands, copying and shortcuts in a migration preview', () => {
    const { api, projection, view } = renderStep('collect', {}, MISSING_ITEM_SOP_TREE);
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={null} projection={projection} api={api} onSearch={vi.fn()} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    expect(screen.getByRole('button', { name: '复制确认收到材料' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '已核对订单应收数量' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'F6' });
    fireEvent.keyDown(window, { key: 'F8' });
    expect(api.copyCurrent).not.toHaveBeenCalled();
    expect(api.command).not.toHaveBeenCalled();
  });
  it('keeps accepted copy feedback when a rename increments the revision', async () => {
    const { api, projection, view } = renderStep();
    let resolve: (result: SopCopyResult) => void = () => { throw new Error('copy not started'); };
    api.copyCurrent.mockImplementationOnce(() => new Promise<SopCopyResult>(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={{ ...projection, revision: projection.revision + 1 }} api={api} onSearch={vi.fn()} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    await act(async () => { resolve({ ok: true, outcome: 'copied-stayed', reason: 'decision', source: { taskId: projection.taskId, stepIndex: projection.stepIndex, revision: projection.revision }, sourceTitle: projection.taskTitle, copyGeneration: 1 }); });
    await waitFor(() => expect(screen.getByRole('button', { name: '复制索取凭证' })).toHaveTextContent('已复制'));
  });
  it('discards a copy response after its execution host changes', async () => {
    const { api, projection, view } = renderStep();
    let resolve: (result: SopCopyResult) => void = () => { throw new Error('copy not started'); };
    api.copyCurrent.mockImplementationOnce(() => new Promise<SopCopyResult>(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: '复制索取凭证' }));
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={2} projection={projection} api={api} onSearch={vi.fn()} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    await act(async () => { resolve({ ok: true, outcome: 'copied-stayed', reason: 'decision', source: { taskId: projection.taskId, stepIndex: projection.stepIndex, revision: projection.revision }, sourceTitle: projection.taskTitle, copyGeneration: 1 }); });
    await waitFor(() => expect(screen.getByRole('button', { name: '复制索取凭证' })).not.toHaveTextContent('已复制'));
  });
  it('shows a complete task nickname and retains the process identity in the header', () => {
    const { api, projection, view } = renderStep();
    const taskLabel = '小林售后处理中的长昵称';
    const task = { taskId: projection.taskId, ordinal: 1, displayName: taskLabel, revision: projection.revision,
      sceneId: projection.sceneId, sceneTitle: projection.sceneTitle, taskTitle: projection.taskTitle,
      stepIndex: projection.stepIndex, waiting: projection.waiting };
    view.rerender(<IntakeAntdTheme><QuerySopPanel hostEpoch={1} projection={projection} task={task} api={api} onSearch={vi.fn()} onCollapse={vi.fn()} /></IntakeAntdTheme>);
    expect(screen.getByLabelText(taskLabel)).toHaveTextContent(taskLabel);
    expect(screen.getByText(projection.sceneTitle)).toBeVisible();
  });

});
