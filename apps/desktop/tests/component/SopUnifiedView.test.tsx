import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  const knowledge = screen.getByText('合成知识正文。');
  const disclosure = screen.getByText('补充资料与知识');
  expect(knowledge).not.toBeVisible();
  fireEvent.click(disclosure);
  expect(knowledge).toBeVisible();
  expect(screen.getByText('知识资料 synthetic-resource')).toBeVisible();
  fireEvent.click(disclosure);
  expect(knowledge).not.toBeVisible();
  expect(screen.getByText('择一话术 / 合成条件甲')).toBeVisible();
  expect(screen.getByText('补充话术 / 合成条件乙')).toBeVisible();
  expect(screen.getByText('判断依据 合成记录有明确标记')).toBeVisible();
  const choice = screen.getByRole('button', { name: '证据不足 / 无法判断' });
  expect(choice).toBeDisabled();
  expect(choice).toHaveAccessibleDescription(/待确认：合成确认甲.*必需图片「合成图文」暂不可用/);
  const copies = screen.getAllByRole('button', { name: '复制话术' });
  expect(copies[0]).toBeDisabled(); fireEvent.click(copies[1]!);
  await waitFor(() => expect(unifiedCommand).toHaveBeenCalledWith({ kind: 'copy', key: 'copy-two' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '1. 合成确认甲' }));
  await waitFor(() => expect(unifiedCommand).toHaveBeenCalledWith({ kind: 'confirm', key: 'req-one' }));
  expect(unifiedCommand.mock.calls.flat()).not.toContain('合成乙。');
});
it('removes protected body and images while paused, and provides recovery', async () => {
  const { rerender } = render(<SopApp projection={projection} />);
  fireEvent.click(screen.getByText('补充资料与知识'));
  expect(screen.getByText('合成知识正文。')).toBeVisible();
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

it('names the remaining requirements and waits for the trusted projection after image recovery', async () => {
  const [requirement] = projection.node.requirements;
  const [image] = projection.node.media;
  const action = { ...projection, node: {
    ...projection.node, kind: 'action', nextKey: 'next-step',
    requirements: [{ ...requirement!, confirmed: true }, { key: 'req-two', label: '合成确认乙', ordinal: 2, confirmed: false }],
  } } satisfies SopUnifiedProjection;
  const { rerender } = render(<SopApp projection={action} />);
  const next = screen.getByRole('button', { name: '下一步' });
  const confirmation = screen.getByRole('checkbox', { name: '2. 合成确认乙' });
  expect(next).toBeDisabled();
  expect(next).toHaveAccessibleDescription('待确认：合成确认乙 必需图片「合成图文」暂不可用。');
  fireEvent.click(confirmation);
  await waitFor(() => expect(unifiedCommand).toHaveBeenCalledExactlyOnceWith({ kind: 'confirm', key: 'req-two' }));
  expect(confirmation).not.toBeChecked();
  const confirmed = { ...action.node, requirements: action.node.requirements.map(item => ({ ...item, confirmed: true })) };
  rerender(<SopApp projection={{ ...action, node: confirmed }} />);
  expect(next).toHaveAccessibleDescription('必需图片「合成图文」暂不可用。');
  const requiredImages = within(screen.getByRole('region', { name: '必需图片' }));
  fireEvent.click(requiredImages.getByRole('button', { name: '重试图片' }));
  await waitFor(() => expect(unifiedCommand).toHaveBeenLastCalledWith({ kind: 'media', key: 'media-one' }));
  expect(next).toBeDisabled();

  rerender(<SopApp projection={{ ...action, node: { ...confirmed, media: [{ ...image!, state: 'loading', image: null }] } }} />);
  expect(next).toHaveAccessibleDescription('必需图片「合成图文」正在读取。');
  const ready = { ...confirmed, media: [{ ...image!, state: 'ready', image: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }] } satisfies SopUnifiedProjection['node'];
  rerender(<SopApp projection={{ ...action, node: ready }} />);
  expect(requiredImages.getByRole('img', { name: '合成图文' })).toBeVisible();
  expect(next).toBeDisabled();
  expect(next).toHaveAccessibleDescription('当前无法继续。');

  rerender(<SopApp projection={{ ...action, node: { ...ready, canAdvance: true } }} />);
  expect(next).toBeEnabled();
  expect(next).not.toHaveAccessibleDescription();
  fireEvent.click(next);
  await waitFor(() => expect(unifiedCommand).toHaveBeenLastCalledWith({ kind: 'next', key: 'next-step' }));
});

it('keeps authorized optional-image loading separate from action readiness', async () => {
  const optional = { ...projection, node: { ...projection.node, canAdvance: true,
    requirements: projection.node.requirements.map(item => ({ ...item, confirmed: true })),
    media: [{ ...projection.node.media[0]!, required: false, state: 'loading', image: null }],
  } } satisfies SopUnifiedProjection;
  const { rerender } = render(<SopApp projection={optional} />);
  expect(screen.getByText('图片正在读取。')).toBeVisible();
  expect(screen.queryByRole('button', { name: '重试图片' })).not.toBeInTheDocument();
  const choice = screen.getByRole('button', { name: '证据不足 / 无法判断' });
  expect(choice).toBeEnabled();
  rerender(<SopApp projection={{ ...optional, node: { ...optional.node,
    media: [{ ...optional.node.media[0]!, state: 'unavailable' }],
  } }} />);
  expect(screen.getByRole('button', { name: '重试图片' })).toBeEnabled();
  expect(choice).toBeEnabled();
  expect(choice).not.toHaveAccessibleDescription();
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
  fireEvent.click(screen.getByText('补充资料与知识'));
  expect(screen.getByText('合成知识正文。')).toBeVisible();
});
