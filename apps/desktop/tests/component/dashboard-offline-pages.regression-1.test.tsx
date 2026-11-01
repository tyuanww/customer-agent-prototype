import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderIntakeDestinations, type IntakeDestinationContext } from '../../src/renderer/features/dashboard/intake-destinations';

// Regression: ISSUE-002 — offline pages must not read unavailable business services.
// Found by /qa on 2026-11-01.
const failure = { ok: false as const, code: 'UNAVAILABLE' as const, message: '资料目录暂不可用，请稍后刷新。', view: null };

function context(overrides: Partial<IntakeDestinationContext> = {}): IntakeDestinationContext {
  return {
    active: 'overview', canOpenPermissions: false, canGrant: false, canUploadSop: false,
    seatLibraryOnly: false, jobKnown: true, jobPending: false, sessionKey: 'signed-out', workbenchMode: 'synthetic-offline',
    snapshot: { phase: 'signed-out' }, onOpen: () => undefined, onTodoCount: () => undefined,
    onSupplyScript: () => undefined, scriptDraft: null, onDraftConsumed: () => undefined,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  delete window.dashboardIntakeCatalog;
  delete window.dashboardDesk;
  delete window.dashboardIntake;
});

it('shows offline explanations on each page without mounting business readers', async () => {
  const catalog = { current: vi.fn(async () => failure), command: vi.fn(async () => failure), onInvalidated: vi.fn(() => () => undefined) };
  const desk = { current: vi.fn(async () => failure), command: vi.fn(async () => failure) };
  const intake = { mode: vi.fn(async () => ({ ok: true, enabled: false })), current: vi.fn(async () => failure), command: vi.fn(async () => failure), onInvalidated: vi.fn(() => () => undefined) };
  window.dashboardIntakeCatalog = catalog;
  window.dashboardDesk = desk;
  window.dashboardIntake = intake;
  const view = render(renderIntakeDestinations(context()));
  for (const [active, label] of [['wording', '话术库'], ['content', '知识库'], ['materials', '资料']] as const) {
    view.rerender(renderIntakeDestinations(context({ active })));
    expect(await screen.findByText(`当前为离线预览，${label}需在业务环境登录后查看`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重试|重新读取|刷新/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  }
  for (const read of [catalog.current, catalog.command, catalog.onInvalidated, desk.current, desk.command, intake.mode, intake.current, intake.command, intake.onInvalidated]) {
    expect(read).not.toHaveBeenCalled();
  }
});

it('discards an earlier business response after switching to offline mode', async () => {
  let release: (result: typeof failure) => void = () => undefined;
  const pending = new Promise<typeof failure>(resolve => { release = resolve; });
  const command = vi.fn(() => pending);
  window.dashboardIntakeCatalog = { current: vi.fn(async () => failure), command, onInvalidated: vi.fn(() => () => undefined) };
  const view = render(renderIntakeDestinations(context({ active: 'wording', workbenchMode: 'faq-v2' })));
  await waitFor(() => expect(command).toHaveBeenCalled());
  view.rerender(renderIntakeDestinations(context({ active: 'wording' })));
  await act(async () => { release(failure); await pending; });
  expect(await screen.findByText('当前为离线预览，话术库需在业务环境登录后查看')).toBeInTheDocument();
  expect(screen.queryByText(failure.message)).not.toBeInTheDocument();
});

it('waits for the workbench mode before mounting signed-out business readers', async () => {
  const catalog = { current: vi.fn(async () => failure), command: vi.fn(async () => failure), onInvalidated: vi.fn(() => () => undefined) };
  window.dashboardIntakeCatalog = catalog;
  render(renderIntakeDestinations(context({ active: 'wording', workbenchMode: null, jobKnown: false, jobPending: true })));
  await act(async () => undefined);
  expect(catalog.current).not.toHaveBeenCalled();
  expect(catalog.command).not.toHaveBeenCalled();
  expect(catalog.onInvalidated).not.toHaveBeenCalled();
});
