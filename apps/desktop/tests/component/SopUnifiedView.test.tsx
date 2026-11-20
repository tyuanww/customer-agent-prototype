import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SopApp } from '../../src/renderer/SopApp';
import type { SopUnifiedProjection } from '../../src/shared/sop-unified';
import type { SopWindowChrome } from '../../src/shared/sop-window';

const projection = {
  projectionVersion: 'sop-unified-v11', sessionId: 2, state: 'ready', shops: [], notice: '', busy: false, copied: false, title: '合成完整图',
  node: { kind: 'decision', title: '合成判断任务', stage: '人工核对', instruction: '仅按明确依据选择。', nextKey: '', canAdvance: false,
    requirements: [{ key: 'req-one', label: '合成确认甲', ordinal: 1, confirmed: false }],
    knowledge: [{ title: '合成知识', body: '合成知识正文。', resource: 'synthetic-resource', owner: 'knowledge' }],
    media: [{ key: 'media-one', alt: '合成图文', owner: 'knowledge', required: true, state: 'unavailable', image: null }],
    scripts: [{ key: 'copy-one', title: '合成话术甲', body: '合成甲。\n  原文空格。', relation: 'alternative', condition: '合成条件甲', risk: 'low', canCopy: false },
      { key: 'copy-two', title: '合成话术乙', body: '合成乙。', relation: 'complementary', condition: '合成条件乙', risk: 'medium', canCopy: true }],
    choices: [{ key: 'yes', label: '符合', criterion: '合成记录有明确标记', unableToDetermine: false, ordinal: 1 },
      { key: 'unknown', label: '证据不足', criterion: '合成记录无法核实', unableToDetermine: true, ordinal: 2 }] },
} satisfies SopUnifiedProjection;
const unifiedCommand = vi.fn(async () => ({ ok: true as const }));
beforeEach(() => {
  unifiedCommand.mockClear();
  window.sopWindow = { unifiedCommand, close: vi.fn(), endFlow: vi.fn(), restart: vi.fn(), chooseEdge: vi.fn(),
    nextStep: vi.fn(), moveBy: vi.fn(), reportLayout: vi.fn(), copyCurrent: vi.fn(), onProjection: vi.fn() };
});
afterEach(() => { delete window.sopWindow; });
it('renders full authorized task semantics and sends only selected typed intent', async () => {
  render(<SopApp projection={projection} />);
  expect(screen.getByText('合成知识正文。')).toBeVisible();
  expect(screen.getByText('知识资料 synthetic-resource')).toBeVisible();
  expect(screen.getByText('择一话术 / 合成条件甲')).toBeVisible();
  expect(screen.getByText('补充话术 / 合成条件乙')).toBeVisible();
  expect(screen.getByText('判断依据 合成记录有明确标记')).toBeVisible();
  expect(screen.getByRole('button', { name: '证据不足 / 无法判断' })).toBeDisabled();
  const copies = screen.getAllByRole('button', { name: '复制话术' });
  expect(copies[0]).toBeDisabled(); fireEvent.click(copies[1]!);
  await waitFor(() => expect(unifiedCommand).toHaveBeenCalledWith({ kind: 'copy', key: 'copy-two' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '1. 合成确认甲' }));
  await waitFor(() => expect(unifiedCommand).toHaveBeenCalledWith({ kind: 'confirm', key: 'req-one' }));
  expect(unifiedCommand.mock.calls.flat()).not.toContain('合成乙。');
});
it('removes protected body and images while paused, and provides recovery', async () => {
  const { rerender } = render(<SopApp projection={projection} />);
  rerender(<SopApp projection={{ ...projection, state: 'paused', title: '', node: null, notice: '请重新确认。' }} />);
  expect(screen.queryByText('合成知识正文。')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '复制话术' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新确认并继续' }));
  await waitFor(() => expect(unifiedCommand).toHaveBeenCalledWith({ kind: 'refresh' }));
});
it('renders a pending close with the original-request recovery intent', async () => {
  render(<SopApp projection={{ ...projection, state: 'closing', title: '', node: null, notice: '结束结果尚未确认。' }} />);
  fireEvent.click(screen.getByRole('button', { name: '按原请求确认结束' }));
  await waitFor(() => expect(unifiedCommand).toHaveBeenCalledWith({ kind: 'clear' }));
});

it('keeps authorized optional-image loading separate from action readiness', async () => {
  if (projection.state !== 'ready') throw new Error('Expected ready fixture');
  render(<SopApp projection={{ ...projection, node: { ...projection.node, canAdvance: true,
    media: [{ ...projection.node.media[0]!, required: false, state: 'loading', image: null }],
  } }} />);
  expect(screen.getByText('图片正在读取。')).toBeVisible();
  expect(screen.getByText('合成知识正文。')).toBeVisible();
  expect(screen.queryByRole('button', { name: '重试图片' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '证据不足 / 无法判断' })).toBeEnabled();
  fireEvent.click(screen.getAllByRole('button', { name: '复制话术' })[1]!);
  await waitFor(() => expect(unifiedCommand).toHaveBeenCalledWith({ kind: 'copy', key: 'copy-two' }));
});

it('displays only the instance name while parked and restores the same step', async () => {
  const chrome = new Set<(value: SopWindowChrome) => void>();
  const api = window.sopWindow!;
  api.reportLayout = async ({ sessionId, sequence }) => ({ ok: true, sessionId, sequence, width: 600, height: 320 });
  api.onProjection = cb => {
    cb({ ...projection, instanceName: '合成办理甲' });
    return () => undefined;
  };
  api.onChrome = cb => {
    chrome.add(cb);
    return () => { chrome.delete(cb); };
  };
  const bookmark = vi.fn(async () => ({ ok: true as const }));
  api.bookmark = bookmark;
  render(<SopApp />);
  expect(screen.getByRole('heading', { name: '合成判断任务' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '贴边暂放' }));
  await waitFor(() => expect(bookmark).toHaveBeenCalledExactlyOnceWith('park'));
  act(() => { for (const notify of chrome) notify({ kind: 'parked', name: '合成办理甲' }); });
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.queryByText('合成知识正文。')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '恢复 合成办理甲' }));
  expect(bookmark).toHaveBeenLastCalledWith('restore');
  act(() => { for (const notify of chrome) notify({ kind: 'expanded' }); });
  expect(screen.getByRole('heading', { name: '合成判断任务' })).toBeVisible();
  expect(screen.getByText('合成知识正文。')).toBeVisible();
});
