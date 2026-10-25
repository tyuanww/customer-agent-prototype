import { expect, it } from 'vitest';
import { asyncFailure, type AsyncResource } from '../../src/shared/async-resource';

const LOGGED_OUT = '请先登录。';
const FAILED = '没读到。';

function label<T>(resource: AsyncResource<T>): string {
  switch (resource.status) {
    case 'idle':
      return 'idle';
    case 'loading':
      return 'loading';
    case 'ready':
      return `ready:${JSON.stringify(resource.value)}`;
    case 'error':
      return `error:${resource.message}`;
    case 'forbidden':
      return `forbidden:${resource.message}`;
  }
}

it('keeps idle, loading, ready, error, and forbidden', () => {
  const reads: readonly AsyncResource<number>[] = [
    { status: 'idle' },
    { status: 'loading' },
    { status: 'ready', value: 3 },
    { status: 'error', message: FAILED },
    { status: 'forbidden', message: LOGGED_OUT },
  ];
  expect(reads.map(label)).toEqual([
    'idle',
    'loading',
    'ready:3',
    `error:${FAILED}`,
    `forbidden:${LOGGED_OUT}`,
  ]);
});

it('uses forbidden only for an explicit unauthorized code', () => {
  const messages = { forbidden: LOGGED_OUT, error: FAILED };
  expect(asyncFailure('UNAUTHORIZED', messages)).toEqual({
    status: 'forbidden',
    message: LOGGED_OUT,
  });
  expect(asyncFailure('FORBIDDEN', messages)).toEqual({ status: 'error', message: FAILED });
  expect(asyncFailure('FAILED', messages)).toEqual({ status: 'error', message: FAILED });
  expect(asyncFailure('UNAVAILABLE', messages)).toEqual({ status: 'error', message: FAILED });
});

it('stores a missing API as forbidden with the logged-out sentence', () => {
  const missing: AsyncResource<readonly string[]> = { status: 'forbidden', message: LOGGED_OUT };
  expect(missing).toEqual({ status: 'forbidden', message: '请先登录。' });
  expect(label(missing)).toBe('forbidden:请先登录。');
});
