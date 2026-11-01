import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { IntakeAntdTheme } from '../../src/renderer/features/dashboard/intake-antd';
import { QuerySopPanel } from '../../src/renderer/features/sop/QuerySopPanel';
import { projectSop, startSopProgress } from '../../src/shared/sop-model';
import { ALLERGY_SOP_TREE } from '../../src/shared/synthetic-sops';

it('removes unavailable wording from the current view and retains the way back', async () => {
  const progress = startSopProgress(ALLERGY_SOP_TREE);
  const source = ALLERGY_SOP_TREE.nodes.find(node => node.id === progress.nodeId)?.scripts[0];
  if (!source) throw new Error('Missing synthetic wording');
  const project = (published: ReadonlySet<string> | 'fixture') => projectSop({
    tree: ALLERGY_SOP_TREE, progress, role: 'agent', taskId: 'task-a', revision: 1, published,
  });
  const api = { open: vi.fn(), entryAvailable: vi.fn(), resumeAvailable: vi.fn(), copyCurrent: vi.fn(), command: vi.fn() };
  const onSearch = vi.fn();
  const element = (published: ReadonlySet<string> | 'fixture') => <IntakeAntdTheme>
    <QuerySopPanel hostEpoch={1} projection={project(published)} api={api} onSearch={onSearch} onCollapse={vi.fn()} />
  </IntakeAntdTheme>;
  const view = render(element('fixture'));
  fireEvent.click(screen.getByRole('button', { name: source.title }));
  expect(screen.getByText(source.answerText)).toBeVisible();
  view.rerender(element(new Set()));
  expect(screen.queryByText(source.title)).toBeNull();
  expect(screen.queryByText(source.condition)).toBeNull();
  expect(screen.queryByText(source.answerText)).toBeNull();
  expect(screen.getByText('该话术当前不可用')).toBeVisible();
  expect(screen.getByRole('button', { name: '复制话术' })).toBeDisabled();
  fireEvent.keyDown(window, { key: 'F6' });
  expect(api.copyCurrent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回搜索' }));
  await waitFor(() => expect(onSearch).toHaveBeenCalledOnce());
  expect(api.command).not.toHaveBeenCalled();
});
