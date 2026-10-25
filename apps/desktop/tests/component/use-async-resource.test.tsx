import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { type AsyncResource } from '../../src/shared/async-resource';
import { useAsyncResource } from '../../src/renderer/features/dashboard/use-async-resource';

function Probe({
  read,
  initial,
  retainReady = false,
}: {
  read: () => Promise<AsyncResource<string>>;
  initial: AsyncResource<string>;
  retainReady?: boolean;
}) {
  const { resource, reload } = useAsyncResource(read, [], initial, { retainReady });
  const text = resource.status === 'ready'
    ? resource.value
    : resource.status === 'error' || resource.status === 'forbidden'
      ? resource.message
      : resource.status;
  return <div>
    <p data-testid="read">{text}</p>
    <button type="button" onClick={reload}>再读</button>
  </div>;
}

it('does not read again while the first state is forbidden', () => {
  const read = vi.fn(async () => ({ status: 'forbidden' as const, message: '请先登录。' }));
  render(<Probe initial={{ status: 'forbidden', message: '请先登录。' }} read={read} />);
  expect(screen.getByTestId('read')).toHaveTextContent('请先登录。');
  expect(read).not.toHaveBeenCalled();
});

it('shows the logged-out sentence without a loading flash when the read is missing', async () => {
  render(<Probe
    initial={{ status: 'forbidden', message: '请先登录。' }}
    read={async () => ({ status: 'forbidden', message: '请先登录。' })}
  />);
  expect(screen.getByTestId('read')).toHaveTextContent('请先登录。');
  expect(screen.getByTestId('read')).not.toHaveTextContent('loading');
});

it('keeps a ready value on screen while the next read is in flight', async () => {
  const user = userEvent.setup();
  let resolveNext: (value: AsyncResource<string>) => void = () => undefined;
  const read = vi.fn(() => new Promise<AsyncResource<string>>((resolve) => {
    resolveNext = resolve;
  }));
  function Harness() {
    const [initial] = useState<AsyncResource<string>>({ status: 'ready', value: '原先的目录' });
    return <Probe read={read} initial={initial} retainReady />;
  }
  render(<Harness />);
  expect(screen.getByTestId('read')).toHaveTextContent('原先的目录');
  await user.click(screen.getByRole('button', { name: '再读' }));
  expect(screen.getByTestId('read')).toHaveTextContent('原先的目录');
  resolveNext({ status: 'ready', value: '新的目录' });
  expect(await screen.findByText('新的目录')).toBeInTheDocument();
});

it('replaces an error with the next ready value', async () => {
  const user = userEvent.setup();
  const read = vi.fn()
    .mockResolvedValueOnce({ status: 'error', message: '没读到。' } satisfies AsyncResource<string>)
    .mockResolvedValueOnce({ status: 'ready', value: '三条' } satisfies AsyncResource<string>);
  render(<Probe read={read} initial={{ status: 'loading' }} />);
  expect(await screen.findByText('没读到。')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '再读' }));
  expect(await screen.findByText('三条')).toBeInTheDocument();
});
