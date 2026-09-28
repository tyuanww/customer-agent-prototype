import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnounceModule } from '../../src/renderer/features/dashboard/AnnounceModule';
import type { DashboardAnnounceApi, DashboardAnnounceResult } from '../../src/shared/dashboard-announce';

function announceApi(result: DashboardAnnounceResult): DashboardAnnounceApi & { markRead: ReturnType<typeof vi.fn> } {
  const markRead = vi.fn(async () => {});
  return {
    current: vi.fn(async () => result),
    markRead,
  };
}

function view(overrides: Partial<Extract<DashboardAnnounceResult, { ok: true }>> = {}): Extract<DashboardAnnounceResult, { ok: true }> {
  return {
    ok: true,
    signedIn: true,
    releaseId: 'rel_25',
    announcement: { title: '九月活动上新', summary: '售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用', createdAt: '2026-09-28T00:00:00.000Z' },
    counts: { product: 106, campaign: 4, presale: 75, aftersale: 223 },
    unread: false,
    unreadDomains: [],
    ...overrides,
  };
}

describe('AnnounceModule four library cards', () => {
  beforeEach(() => { delete window.dashboardAnnounce; delete window.dashboardOps; });
  afterEach(() => { delete window.dashboardAnnounce; delete window.dashboardOps; });

  it('marks only the bound domain as 本版已更新 and the rest as 本版沿用 with neutral, non-warn badges', async () => {
    const api = announceApi(view());
    window.dashboardAnnounce = api;
    render(<AnnounceModule />);
    await screen.findByTestId('announce-library-grid');
    expect(screen.getByTestId('announce-library-presale')).toHaveAttribute('data-library-status', 'updated');
    for (const domain of ['product', 'campaign', 'aftersale'] as const) {
      expect(screen.getByTestId(`announce-library-${domain}`)).toHaveAttribute('data-library-status', 'carried');
    }
    // 沿用卡不得 warn/danger，且不得复制已更新卡的发布标题。
    const carried = screen.getByTestId('announce-library-product');
    expect(carried.querySelector('.dash-badge.is-warn')).toBeNull();
    expect(carried.querySelector('.dash-badge.is-danger')).toBeNull();
    expect(screen.queryByTestId('announce-library-title-product')).not.toBeInTheDocument();
    // 已更新卡可显示一次标题。
    expect(screen.getByTestId('announce-library-title-presale')).toHaveTextContent('九月活动上新');
    expect(screen.getByTestId('announce-library-count-presale')).toHaveTextContent('75 条');
    expect(screen.getByTestId('announce-library-count-presale')).not.toHaveTextContent('本版已更新');
    expect(screen.getByTestId('announce-library-count-product')).toHaveTextContent('106 条');
    expect(screen.getByTestId('announce-library-count-product')).not.toHaveTextContent('本版沿用');
    expect(screen.getByTestId('announce-release-footnote')).toHaveTextContent('当前发布 rel_25');
    expect(screen.getByTestId('announce-release-footnote')).not.toHaveTextContent('检索租约');
    expect(screen.queryByText('不是合成演练')).not.toBeInTheDocument();
  });

  it('shows 无法标出本版更新了哪一库 when the summary is missing or garbled, keeping cards and counts', async () => {
    const api = announceApi(view({ announcement: { title: '无标题', summary: '只读', createdAt: '2026-09-28T00:00:00.000Z' } }));
    window.dashboardAnnounce = api;
    render(<AnnounceModule />);
    await screen.findByTestId('announce-library-grid');
    expect(screen.getByTestId('announce-delta-unknown')).toHaveTextContent('无法标出本版更新了哪一库');
    // 四卡仍在，条数仍在；卡面不得冒充已更新/沿用。
    for (const domain of ['product', 'campaign', 'presale', 'aftersale'] as const) {
      expect(screen.getByTestId(`announce-library-${domain}`)).toHaveAttribute('data-library-status', 'unknown');
    }
    expect(screen.getByTestId('announce-library-count-presale')).toHaveTextContent('75 条');
    expect(screen.getByTestId('announce-library-count-presale')).not.toHaveTextContent('本版沿用');
    expect(screen.getByTestId('announce-library-count-presale')).not.toHaveTextContent('本版已更新');
  });

  it('downgrades counts to — when the snapshot counts are unavailable but keeps the cards', async () => {
    const api = announceApi(view({ counts: null }));
    window.dashboardAnnounce = api;
    render(<AnnounceModule />);
    await screen.findByTestId('announce-library-grid');
    expect(screen.getByTestId('announce-library-count-presale')).toHaveTextContent('—');
    expect(screen.getByTestId('announce-library-product')).toBeInTheDocument();
  });

  it('shows the whole page as 未接入当前发布 without a current release', async () => {
    const api = announceApi({ ok: false, code: 'NO_CURRENT', signedIn: true });
    window.dashboardAnnounce = api;
    render(<AnnounceModule />);
    expect(await screen.findByTestId('announce-wording-empty')).toHaveTextContent('未接入当前发布');
    expect(screen.queryByTestId('announce-library-grid')).not.toBeInTheDocument();
  });

  it('clears the current userId unread only while the wording tab is visible', async () => {
    const api = announceApi(view({ unread: true, unreadDomains: ['presale'] }));
    window.dashboardAnnounce = api;
    render(<AnnounceModule />);
    await screen.findByTestId('announce-library-grid');
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith(['presale']));
  });

  it('does not clear unread while the dashboard window is hidden', async () => {
    const api = announceApi(view({ unread: true, unreadDomains: ['presale'] }));
    window.dashboardAnnounce = api;
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    try {
      render(<AnnounceModule />);
      await screen.findByTestId('announce-library-grid');
      // 给 microtask 一个落点再断言未清。
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(api.markRead).not.toHaveBeenCalled();
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(api.markRead).toHaveBeenCalledWith(['presale']));
    } finally {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    }
  });

  it('lifts the wording domain when a card is clicked', async () => {
    const api = announceApi(view());
    window.dashboardAnnounce = api;
    const onOpenDomain = vi.fn();
    window.dashboardOps = { softwareCatalog: vi.fn() } as unknown as typeof window.dashboardOps;
    const user = userEvent.setup();
    render(<AnnounceModule onOpenDomain={onOpenDomain} />);
    await screen.findByTestId('announce-library-grid');
    await user.click(screen.getByTestId('announce-library-campaign'));
    expect(onOpenDomain).toHaveBeenCalledWith('campaign');
  });

  it('drops a late software catalog result after leaving the tab', async () => {
    let finish: ((value: { ok: true; items: []; current: { version: string; platform: 'mac-universal'; sha256: string; downloadUrl: string; createdAt: string; signed: boolean } }) => void) | undefined;
    const softwareCatalog = vi.fn(() => new Promise<{
      ok: true;
      items: [];
      current: { version: string; platform: 'mac-universal'; sha256: string; downloadUrl: string; createdAt: string; signed: boolean };
    }>((resolve) => {
      finish = resolve;
    }));
    window.dashboardAnnounce = announceApi(view());
    window.dashboardOps = { softwareCatalog } as unknown as typeof window.dashboardOps;
    const user = userEvent.setup();
    render(<AnnounceModule />);
    await user.click(screen.getByTestId('system-sync-tab-software'));
    await waitFor(() => expect(softwareCatalog).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId('system-sync-tab-wording'));
    finish?.({
      ok: true,
      items: [],
      current: {
        version: '9.9.9',
        platform: 'mac-universal',
        sha256: 'abc',
        downloadUrl: 'https://example.invalid/app',
        createdAt: '2026-09-28T00:00:00.000Z',
        signed: false,
      },
    });
    await waitFor(() => expect(screen.getByTestId('announce-library-grid')).toBeInTheDocument());
    expect(screen.queryByText('9.9.9')).not.toBeInTheDocument();
  });

  it('keeps the software tab unchanged and free of library cards', async () => {
    window.dashboardAnnounce = announceApi(view());
    window.dashboardOps = {
      softwareCatalog: vi.fn(async () => ({ ok: true as const, current: null })),
    } as unknown as typeof window.dashboardOps;
    const user = userEvent.setup();
    render(<AnnounceModule />);
    await user.click(screen.getByTestId('system-sync-tab-software'));
    expect(screen.getByTestId('software-version-card')).toBeInTheDocument();
    expect(screen.queryByTestId('announce-library-grid')).not.toBeInTheDocument();
  });
});
