import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LONG_WAIT_MS, WorkbenchLoading } from '../../src/renderer/features/dashboard/WorkbenchState';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('says the read is still going only after LONG_WAIT_MS', () => {
  render(<WorkbenchLoading />);
  expect(screen.queryByText('还在读取…')).not.toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(LONG_WAIT_MS - 1);
  });
  expect(screen.queryByText('还在读取…')).not.toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByText('还在读取…')).toBeInTheDocument();
});
