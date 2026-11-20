import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  emptyIntakeQueryContext,
  intakeQueryFailure,
  type IntakeQueryApi,
} from '../../src/shared/content-intake-query';
import { IntakeQueryFilters } from '../../src/renderer/features/search/IntakeQueryFilters';
import { useIntakeShops } from '../../src/renderer/features/search/use-intake-shops';

const reset = () => undefined;

function Filters({ signedIn = true, initialOpen = false }: { signedIn?: boolean; initialOpen?: boolean }) {
  const state = useIntakeShops(true, signedIn, 0, reset);
  const [open, setOpen] = useState(initialOpen);
  return (
    <IntakeQueryFilters
      state={state}
      signedIn={signedIn}
      open={open}
      onToggle={() => setOpen(current => !current)}
      onLayoutChange={reset}
    />
  );
}

function installApi(access: IntakeQueryApi['access']) {
  const api: IntakeQueryApi = {
    mode: vi.fn<IntakeQueryApi['mode']>().mockResolvedValue({ ok: true, enabled: true }),
    access,
    selectShop: vi.fn(async () => intakeQueryFailure('UNAVAILABLE')),
    selectConditions: vi.fn(async () => intakeQueryFailure('UNAVAILABLE')),
    search: vi.fn(async () => intakeQueryFailure('UNAVAILABLE')),
    copy: vi.fn(async () => intakeQueryFailure('UNAVAILABLE')),
    cancel: vi.fn<IntakeQueryApi['cancel']>().mockResolvedValue({ ok: true, cancelled: true }),
    onInvalidated: vi.fn(() => reset),
  };
  vi.stubGlobal('customerAgent', { intakeQuery: api });
}

afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('shows NO_GRANT recovery guidance with filters open=%s and clears it after refresh', async open => {
  const denial = intakeQueryFailure('NO_GRANT');
  const message = `${denial.message}请联系管理员确认可查询店铺和使用期限。`;
  const access = vi.fn<IntakeQueryApi['access']>()
    .mockResolvedValueOnce(denial)
    .mockResolvedValue({
      ok: true,
      ...emptyIntakeQueryContext(),
      shops: ['shop-synthetic'],
      shopId: 'shop-synthetic',
    });
  installApi(access);
  render(<Filters initialOpen={open} />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(denial.message).toBe('没有权限，请找人开通。');

  if (!open) fireEvent.click(screen.getByRole('button', { name: '查询范围' }));
  fireEvent.click(screen.getByRole('button', { name: '刷新店铺' }));
  expect(await screen.findByRole('option', { name: 'shop-synthetic' })).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新店铺' })).toBeEnabled());
  expect(access).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查询范围' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['UNAVAILABLE', 'FACTS_EXPIRED', 'NO_PRINCIPAL', 'ROLE_UNKNOWN'] as const)(
  'preserves the original %s failure through expansion and collapse',
  async code => {
    const failure = intakeQueryFailure(code);
    installApi(vi.fn<IntakeQueryApi['access']>().mockResolvedValue(failure));
    render(<Filters />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(failure.message);
    fireEvent.click(screen.getByRole('button', { name: '查询范围' }));
    expect(screen.getByRole('alert').textContent).toBe(failure.message);
    fireEvent.click(screen.getByRole('button', { name: '查询范围' }));
    expect(screen.getByRole('alert').textContent).toBe(failure.message);
  },
);

it('does not read shops or show a recovery error before login', () => {
  const access = vi.fn<IntakeQueryApi['access']>().mockResolvedValue(intakeQueryFailure('NO_GRANT'));
  installApi(access);
  render(<Filters signedIn={false} />);
  expect(access).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查询范围' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: '刷新店铺' })).toBeDisabled();
});
