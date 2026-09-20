import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentModule } from '../../src/renderer/features/dashboard/ContentModule';
import { CONTENT_PUBLISH_COPY } from '../../src/shared/dashboard-content';
import type { DashboardContentApi } from '../../src/shared/dashboard-content';

function mockSession(role: 'agent' | 'coach' | 'owner', signedIn = true): DashboardContentApi {
  return {
    session: vi.fn(async () => ({
      ok: true as const,
      enabled: true,
      signedIn,
      role: signedIn ? role : null,
    })),
    importDraft: vi.fn(async () => ({
      ok: false as const,
      code: 'UNAVAILABLE' as const,
      message: '服务暂不可用，请重试',
    })),
    publishDraft: vi.fn(async () => ({
      ok: false as const,
      code: 'UNAVAILABLE' as const,
      message: '服务暂不可用，请重试',
    })),
  };
}

describe('ContentModule publish gate', () => {
  beforeEach(() => {
    delete window.dashboardContent;
  });

  afterEach(() => {
    delete window.dashboardContent;
  });

  it('keeps Publish off without a product session and states the Chinese reason', async () => {
    render(<ContentModule />);
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(screen.getByTestId('publish-disabled-reason')).toHaveTextContent(CONTENT_PUBLISH_COPY.noProduct);
  });

  it('keeps Publish off for agent even with labeled product drafts', async () => {
    const api = mockSession('agent');
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    const csv = new File(
      ['scene,script,domain\n洁面用量确认,先确认产品版本,product\n'],
      'product.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), csv);
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'ready');
    });
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(screen.getByTestId('publish-disabled-reason')).toHaveTextContent(CONTENT_PUBLISH_COPY.agent);
    expect(api.publishDraft).not.toHaveBeenCalled();
  });

  it('keeps Publish off for coach when any row is aftersale', async () => {
    const api = mockSession('coach');
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    const csv = new File(
      ['scene,script,domain\n过敏安抚,先停用并观察,aftersale\n'],
      'aftersale.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), csv);
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'ready');
    });
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(screen.getByTestId('publish-disabled-reason')).toHaveTextContent(CONTENT_PUBLISH_COPY.sensitive);
    expect(api.publishDraft).not.toHaveBeenCalled();
  });
});
