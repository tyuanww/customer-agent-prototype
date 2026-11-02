import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SopLibraryModule } from '../../src/renderer/features/dashboard/SopLibraryModule';

it('shows the unpublished business capability without legacy CSV actions', () => {
  render(<SopLibraryModule sop={{ state: 'not-published' }} />);
  expect(screen.getByTestId('module-sop')).toHaveTextContent('SOP 流程发布后会显示在这里');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).toBeNull();
});

it.each([
  [undefined, '请先登录后再管理 SOP。'],
  [{ state: 'closed' } as const, '没有权限，请找人开通。'],
  [{ state: 'unavailable' } as const, 'SOP 暂时不可用。'],
])('keeps login, authorization and failures distinct from unpublished content', (sop, text) => {
  render(<SopLibraryModule sop={sop} />);
  expect(screen.getByTestId('module-sop')).toHaveTextContent(text);
  expect(screen.queryByText('SOP 流程发布后会显示在这里')).not.toBeInTheDocument();
});

it('does not expose a legacy catalog as a published graph', () => {
  render(<SopLibraryModule sop={{ state: 'open', nodes: [{ nodeId: 'old', parentNodeId: null,
    title: '旧目录标题', body: '旧目录正文', sortKey: 0, version: 1, lifecycle: 'active' }] }} />);
  expect(screen.queryByText('旧目录标题')).not.toBeInTheDocument();
  expect(screen.getByTestId('module-sop')).toHaveTextContent('SOP 暂时不可用。');
});
