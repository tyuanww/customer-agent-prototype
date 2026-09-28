import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentModule } from '../../src/renderer/features/dashboard/ContentModule';
import { CONTENT_IMPORT_FAILURE_COPY, CONTENT_PUBLISH_COPY } from '../../src/shared/dashboard-content';
import type { DashboardContentApi, DashboardContentFailure } from '../../src/shared/dashboard-content';

function mockSession(role: 'agent' | 'coach' | 'owner', signedIn = true): DashboardContentApi {
  return {
    session: vi.fn(async () => ({
      ok: true as const,
      enabled: true,
      signedIn,
      role: signedIn ? role : null,
      displayName: signedIn ? '合成管理员' : null,
    })),
    parseUpload: vi.fn(async () => ({
      ok: false as const,
      code: 'UNAVAILABLE' as const,
      message: '服务暂不可用，请重试',
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
    cancelInFlight: vi.fn(async () => ({ ok: true as const })),
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
    expect(screen.getByTestId('cancel-in-flight')).toBeDisabled();
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
    expect(screen.getByTestId('publish-disabled-reason')).toHaveTextContent(CONTENT_PUBLISH_COPY.ownerPublish);
    expect(api.publishDraft).not.toHaveBeenCalled();
  });

  it('keeps Publish off for coach product drafts while the API is owner-only', async () => {
    const api = mockSession('coach');
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
    expect(screen.getByTestId('publish-disabled-reason')).toHaveTextContent(CONTENT_PUBLISH_COPY.ownerPublish);
    expect(api.publishDraft).not.toHaveBeenCalled();
  });

  it('stages a zip xlsx through parseUpload without treating the preview as published', async () => {
    const api = mockSession('coach');
    api.parseUpload = vi.fn(async () => ({
      ok: true as const,
      sourceName: '【FAQ】MENOKIN话术.xlsx',
      rows: [{ scene: '30秒泡泡面膜 · 面膜紫适用人群', script: '亲亲这是话术', domain: 'product' as const }],
      csvText: 'scene,script,domain\n30秒泡泡面膜 · 面膜紫适用人群,亲亲这是话术,product\n',
    }));
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    const xlsx = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])],
      '【FAQ】MENOKIN话术.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), xlsx);
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'ready');
    });
    expect(api.parseUpload).toHaveBeenCalledWith(expect.objectContaining({
      sourceName: '【FAQ】MENOKIN话术.xlsx',
    }));
    expect(screen.getByTestId('content-staged-preview')).toHaveTextContent('面膜紫适用人群');
    expect(screen.getByTestId('content-staged-preview')).toHaveTextContent('产品');
    expect(screen.getByTestId('content-upload-status')).toHaveTextContent('不是已发布');
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(api.publishDraft).not.toHaveBeenCalled();
  });

  it('shows the no-in-flight copy when the cancel sweep finds nothing and the cancelled copy when it stops one', async () => {
    const api = mockSession('owner');
    let result: DashboardContentFailure | { ok: true } = {
      ok: false,
      code: 'GONE',
      message: CONTENT_IMPORT_FAILURE_COPY.NO_IN_FLIGHT,
    };
    const cancelInFlight = vi.fn(async () => result);
    api.cancelInFlight = cancelInFlight;
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await waitFor(() => expect(screen.getByTestId('cancel-in-flight')).toBeEnabled());
    await user.click(screen.getByTestId('cancel-in-flight'));
    await waitFor(() => {
      expect(screen.getByTestId('publish-feedback')).toHaveTextContent(CONTENT_IMPORT_FAILURE_COPY.NO_IN_FLIGHT);
    });
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    result = { ok: true };
    await user.click(screen.getByTestId('cancel-in-flight'));
    await waitFor(() => {
      expect(screen.getByTestId('publish-feedback')).toHaveTextContent('已取消未完成的导入，可以重新导入');
    });
    expect(cancelInFlight).toHaveBeenCalledTimes(2);
  });

  it('lets the operator correct the detected domain before publish', async () => {
    const api = mockSession('owner');
    api.parseUpload = vi.fn(async () => ({
      ok: true as const,
      sourceName: '【FAQ】MENOKIN话术.xlsx',
      rows: [{ scene: '面膜紫适用人群', script: '亲亲这是话术', domain: 'product' as const }],
      csvText: 'scene,script,domain\n面膜紫适用人群,亲亲这是话术,product\n',
    }));
    api.publishDraft = vi.fn(async () => ({
      ok: true as const,
      releaseId: 'rel_override',
      releaseSeq: 5,
      publisherDisplayName: '合成管理员',
    }));
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    const xlsx = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])],
      '【FAQ】MENOKIN话术.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), xlsx);
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'ready');
    });
    expect(screen.getByTestId('content-domain-detected')).toHaveTextContent('产品');
    await user.selectOptions(screen.getByTestId('content-domain-override'), 'campaign');
    await waitFor(() => {
      expect(screen.getByTestId('content-domain-detected')).toHaveTextContent('活动');
    });
    expect(screen.getByTestId('content-staged-preview')).toHaveTextContent('活动');
    await user.click(screen.getByTestId('publish-action'));
    await waitFor(() => expect(api.publishDraft).toHaveBeenCalled());
    const request = vi.mocked(api.publishDraft).mock.calls[0]?.[0];
    // The override must reach the publish payload; the frozen CSV is built from these rows.
    expect(request?.rows).toEqual([{ scene: '面膜紫适用人群', script: '亲亲这是话术', domain: 'campaign' }]);
    expect(request?.sourceBindings).toEqual([{ domain: 'campaign', source_version_id: 'srcv_stack_campaign_v1' }]);
  });

  it('fail-closes the cancel button when the preload has no cancel channel', async () => {
    const api = mockSession('owner');
    window.dashboardContent = {
      ...api,
      cancelInFlight: undefined,
    } as unknown as DashboardContentApi;
    const user = userEvent.setup();
    render(<ContentModule />);
    await waitFor(() => expect(screen.getByTestId('cancel-in-flight')).toBeEnabled());
    await user.click(screen.getByTestId('cancel-in-flight'));
    await waitFor(() => {
      expect(screen.getByTestId('publish-feedback')).toHaveTextContent('当前没有产品会话，无法取消导入');
    });
    expect(api.cancelInFlight).not.toHaveBeenCalled();
  });
});
