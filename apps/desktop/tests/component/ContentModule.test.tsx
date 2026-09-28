import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentModule } from '../../src/renderer/features/dashboard/ContentModule';
import { CONTENT_IMPORT_FAILURE_COPY, CONTENT_PUBLISH_COPY } from '../../src/shared/dashboard-content';
import type {
  DashboardContentApi,
  DashboardContentFailure,
  DashboardContentPublishResult,
  DashboardContentSessionResult,
} from '../../src/shared/dashboard-content';

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

/** jsdom keeps the children of a closed `<details>` in the DOM, so `open` is the real check. */
function pendingDevOpen(): boolean {
  return (screen.getByTestId('content-pending-dev') as HTMLDetailsElement).open;
}

function toggleSummary(): void {
  const summary = screen.getByTestId('content-pending-dev').querySelector('summary');
  if (!summary) throw new Error('summary missing');
  fireEvent.click(summary);
}

function uploadFile(name: string, body: string): File {
  return new File([body], name, { type: 'text/csv' });
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
    // No API at all settles immediately as 未接入 — never as "still checking".
    expect(screen.getByTestId('content-session-badge')).toHaveTextContent('未接入');
  });

  it('does not call publishDraft when there is no session', async () => {
    const user = userEvent.setup();
    render(<ContentModule />);
    await user.click(screen.getByTestId('publish-action'));
    expect(screen.getByTestId('publish-action')).toBeDisabled();
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
    // The badge reports the product session, not the publish permission.
    expect(screen.getByTestId('content-session-badge')).toHaveTextContent('已接入');
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
    expect(screen.getByTestId('content-session-badge')).toHaveTextContent('已接入');
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
    expect(pendingDevOpen()).toBe(true);
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
    // Feedback owns the slot: the idle "请先导入草稿" reason gives way to it.
    expect(screen.queryByTestId('publish-disabled-reason')).not.toBeInTheDocument();
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
      summary: '产品已更新（1 条）· 活动沿用 · 售前沿用 · 售后沿用',
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

  it('draws the two-line receipt with the four-library delta only after an ok publish', async () => {
    const api = mockSession('owner');
    api.parseUpload = vi.fn(async () => ({
      ok: true as const,
      sourceName: 'presale.xlsx',
      rows: [{ scene: '发货时效', script: '亲亲这是话术', domain: 'presale' as const }],
      csvText: 'scene,script,domain\n发货时效,亲亲这是话术,presale\n',
    }));
    api.publishDraft = vi.fn(async () => ({
      ok: true as const,
      releaseId: 'rel_25',
      releaseSeq: 25,
      publisherDisplayName: '合成管理员',
      summary: '产品沿用 · 活动沿用 · 售前已更新（75 条）· 售后沿用',
    }));
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    const xlsx = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'presale.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await user.upload(screen.getByTestId('content-upload-input'), xlsx);
    await waitFor(() => expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'ready'));
    await user.click(screen.getByTestId('publish-action'));
    await waitFor(() => expect(screen.getByTestId('publish-feedback-delta')).toBeInTheDocument());
    expect(screen.getByTestId('publish-feedback-headline')).toHaveTextContent('已发布 rel_25 · 合成管理员');
    expect(screen.getByTestId('publish-feedback-delta')).toHaveTextContent('售前已更新（75 条）');
    // 发布请求带上同一句 delta 作为 summary。
    const request = vi.mocked(api.publishDraft).mock.calls[0]?.[0];
    expect(request?.summary).toBe('产品沿用 · 活动沿用 · 售前已更新 · 售后沿用');
  });

  it('does not draw a delta line when the publish fails', async () => {
    const api = mockSession('owner');
    api.parseUpload = vi.fn(async () => ({
      ok: true as const,
      sourceName: 'presale.xlsx',
      rows: [{ scene: '发货时效', script: '亲亲这是话术', domain: 'presale' as const }],
      csvText: 'scene,script,domain\n发货时效,亲亲这是话术,presale\n',
    }));
    api.publishDraft = vi.fn(async () => ({
      ok: false as const,
      code: 'UNAVAILABLE' as const,
      message: '服务暂不可用，请重试',
    }));
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    const xlsx = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'presale.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await user.upload(screen.getByTestId('content-upload-input'), xlsx);
    await waitFor(() => expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'ready'));
    await user.click(screen.getByTestId('publish-action'));
    await waitFor(() => expect(screen.getByTestId('publish-feedback')).toHaveTextContent('服务暂不可用'));
    expect(screen.queryByTestId('publish-feedback-delta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('publish-feedback-headline')).not.toBeInTheDocument();
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

describe('ContentModule session badge', () => {
  afterEach(() => {
    delete window.dashboardContent;
  });

  it('says 正在确认会话 while the first session() is still in flight', async () => {
    const api = mockSession('owner');
    api.session = vi.fn((): Promise<DashboardContentSessionResult> => new Promise(() => undefined));
    window.dashboardContent = api;
    render(<ContentModule />);
    const badge = screen.getByTestId('content-session-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('正在确认会话');
    expect(badge).not.toHaveTextContent('未接入');
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(screen.getByTestId('cancel-in-flight')).toBeDisabled();
  });

  it('settles to 已接入 for a signed-in owner', async () => {
    const api = mockSession('owner');
    window.dashboardContent = api;
    render(<ContentModule />);
    await waitFor(() => {
      expect(screen.getByTestId('content-session-badge')).toHaveTextContent('已接入');
    });
  });

  it('settles to 未接入 when the session says not enabled', async () => {
    const api = mockSession('owner');
    api.session = vi.fn(async () => ({
      ok: true as const,
      enabled: false,
      signedIn: true,
      role: 'owner' as const,
      displayName: '合成管理员',
    }));
    window.dashboardContent = api;
    render(<ContentModule />);
    await waitFor(() => {
      expect(screen.getByTestId('content-session-badge')).toHaveTextContent('未接入');
    });
    expect(screen.getByTestId('publish-action')).toBeDisabled();
  });

  it('settles to 未接入 on a failed session payload', async () => {
    const api = mockSession('owner');
    api.session = vi.fn(async () => ({
      ok: false as const,
      code: 'UNAVAILABLE' as const,
      message: '服务暂不可用，请重试',
    }));
    window.dashboardContent = api;
    render(<ContentModule />);
    await waitFor(() => {
      expect(screen.getByTestId('content-session-badge')).toHaveTextContent('未接入');
    });
  });
});

describe('ContentModule header layout', () => {
  afterEach(() => {
    delete window.dashboardContent;
  });

  it('keeps 将替换 outside 待开发 so the operator names the library before opening the fold', () => {
    render(<ContentModule />);
    const replace = screen.getByTestId('content-replace-row');
    expect(replace).toHaveTextContent('将替换');
    expect(replace.querySelector('label')).toHaveAttribute('for', 'content-domain-override');
    expect(screen.getByTestId('content-domain-override')).toBeInTheDocument();
    expect(replace.closest('[data-testid="content-pending-dev"]')).toBeNull();
    expect(screen.queryByTestId('content-domain-detected')).not.toBeInTheDocument();
    expect(screen.getByTestId('content-session-badge')).toHaveAttribute(
      'title',
      expect.stringContaining('不会写入假发布'),
    );
    expect(screen.queryByTestId('formal-source-warning')).not.toBeInTheDocument();
  });

  it('puts cancel and publish in one nowrap action row', () => {
    render(<ContentModule />);
    const row = document.querySelector('.content-action-row');
    expect(row).not.toBeNull();
    expect(row).toContainElement(screen.getByTestId('publish-action'));
    expect(row).toContainElement(screen.getByTestId('cancel-in-flight'));
  });

  it('names the cancel action so it is not confused with clearing the local preview', () => {
    render(<ContentModule />);
    expect(screen.getByTestId('cancel-in-flight')).toHaveAccessibleName(
      '取消服务器上未完成的导入，不影响本页预览',
    );
  });
});

describe('ContentModule pending dev disclosure', () => {
  afterEach(() => {
    delete window.dashboardContent;
  });

  it('starts collapsed and still shows the idle help sentence', () => {
    render(<ContentModule />);
    expect(pendingDevOpen()).toBe(false);
    expect(screen.getByTestId('content-pending-dev').querySelector('summary'))
      .toHaveTextContent('待开发 · 内容导入');
    expect(screen.getByTestId('content-upload-status')).toHaveTextContent('选择 CSV 或 xlsx');
  });

  it('opens on summary click so the file picker is reachable', async () => {
    render(<ContentModule />);
    toggleSummary();
    await waitFor(() => expect(pendingDevOpen()).toBe(true));
    expect(screen.getByLabelText('选择 CSV 或 xlsx')).toBeVisible();
  });

  it('auto-opens on upload and lets the operator collapse a ready preview for good', async () => {
    const api = mockSession('owner');
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await user.upload(screen.getByTestId('content-upload-input'), uploadFile(
      'coach-draft.csv',
      'scene,script\n洁面用量确认,先确认产品版本\n满赠规则说明,不承诺库存\n',
    ));
    await waitFor(() => expect(pendingDevOpen()).toBe(true));
    const summary = screen.getByTestId('content-pending-dev').querySelector('summary');
    expect(summary).toHaveTextContent('待开发 · coach-draft.csv · 待发布 2 行');

    toggleSummary();
    await waitFor(() => expect(pendingDevOpen()).toBe(false));
    // A later re-render (focus refresh) must not spring it open again.
    fireEvent.focus(window);
    await waitFor(() => expect(api.session).toHaveBeenCalledTimes(2));
    expect(pendingDevOpen()).toBe(false);
    expect(screen.getByTestId('content-pending-dev').querySelector('summary'))
      .toHaveTextContent('待开发 · coach-draft.csv · 待发布 2 行');
  });

  it('auto-opens on a parse error and shows the parser message in the body', async () => {
    const api = mockSession('owner');
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await user.upload(screen.getByTestId('content-upload-input'), uploadFile('bad.csv', 'title,body\nA,B\n'));
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'error');
    });
    expect(pendingDevOpen()).toBe(true);
    const summary = screen.getByTestId('content-pending-dev').querySelector('summary');
    expect(summary).toHaveTextContent('待开发 · 未进入待发布');
    expect(summary).toHaveTextContent('bad.csv');
    expect(screen.getByTestId('content-upload-status')).toHaveTextContent('表头必须能映射');
  });

  it('reports an unreadable file with the local copy and keeps the file name', async () => {
    const api = mockSession('owner');
    api.parseUpload = vi.fn(async () => { throw new Error('reader blew up'); });
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    const xlsx = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])],
      'broken.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );
    await user.upload(screen.getByTestId('content-upload-input'), xlsx);
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'error');
    });
    expect(screen.getByTestId('content-upload-status'))
      .toHaveTextContent('无法读取该文件。请确认文件未打开且仍是 CSV/xlsx 后重试。');
    expect(screen.getByTestId('content-upload-status')).not.toHaveTextContent('飞书');
    expect(pendingDevOpen()).toBe(true);
    expect(screen.getByTestId('content-pending-dev').querySelector('summary'))
      .toHaveTextContent('broken.xlsx');
  });

  it('closes and resets the summary after clearing the preview', async () => {
    const api = mockSession('owner');
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await user.upload(screen.getByTestId('content-upload-input'), uploadFile(
      'coach-draft.csv',
      'scene,script\n洁面用量确认,先确认产品版本\n',
    ));
    await waitFor(() => expect(pendingDevOpen()).toBe(true));
    await user.click(screen.getByTestId('content-upload-clear'));
    await waitFor(() => expect(pendingDevOpen()).toBe(false));
    expect(screen.getByTestId('content-pending-dev').querySelector('summary'))
      .toHaveTextContent('待开发 · 内容导入');
  });

  it('keeps the picker disabled and the file name in the summary while publishing', async () => {
    const api = mockSession('owner');
    api.publishDraft = vi.fn((): Promise<DashboardContentPublishResult> => new Promise(() => undefined));
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await user.upload(screen.getByTestId('content-upload-input'), uploadFile(
      'coach-draft.csv',
      'scene,script,domain\n洁面用量确认,先确认产品版本,product\n',
    ));
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'ready');
    });
    await user.click(screen.getByTestId('publish-action'));
    await waitFor(() => expect(screen.getByTestId('content-upload-pick')).toBeDisabled());
    expect(screen.getByTestId('content-upload-clear')).toBeDisabled();
    expect(screen.getByTestId('content-domain-override')).toBeDisabled();
    expect(screen.getByTestId('content-pending-dev').querySelector('summary'))
      .toHaveTextContent('待开发 · coach-draft.csv · 待发布 1 行');
    // Cancel is the in-flight escape hatch and must stay live.
    expect(screen.getByTestId('cancel-in-flight')).toBeEnabled();
  });

  it('disables publish after a successful release without touching the staged preview', async () => {
    const api = mockSession('owner');
    api.publishDraft = vi.fn(async () => ({
      ok: true as const,
      releaseId: 'rel_menokin_2026',
      releaseSeq: 7,
      publisherDisplayName: '合成管理员',
      summary: null,
    }));
    window.dashboardContent = api;
    const user = userEvent.setup();
    render(<ContentModule />);
    await user.upload(screen.getByTestId('content-upload-input'), uploadFile(
      'coach-draft.csv',
      'scene,script,domain\n洁面用量确认,先确认产品版本,product\n',
    ));
    await waitFor(() => {
      expect(screen.getByTestId('content-upload-status')).toHaveAttribute('data-state', 'ready');
    });
    await user.click(screen.getByTestId('publish-action'));
    await waitFor(() => {
      expect(screen.getByTestId('publish-feedback')).toHaveTextContent('rel_menokin_2026');
    });
    expect(screen.getByTestId('publish-action')).toBeDisabled();
    expect(screen.getByTestId('content-pending-dev').querySelector('summary'))
      .toHaveTextContent('待开发 · coach-draft.csv · 待发布 1 行');
    expect(screen.getByTestId('content-staged-preview')).toHaveTextContent('洁面用量确认');
    expect(screen.getByTestId('content-upload-status')).toHaveTextContent('不是已发布');
    // Correcting the domain must not re-enable publish for the same round.
    await user.selectOptions(screen.getByTestId('content-domain-override'), 'campaign');
    expect(screen.getByTestId('publish-action')).toBeDisabled();
  });
});
