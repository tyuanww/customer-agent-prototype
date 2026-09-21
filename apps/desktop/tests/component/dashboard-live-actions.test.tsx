import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { OverviewModule } from '../../src/renderer/features/dashboard/OverviewModule';
import { WordingLibraryModule } from '../../src/renderer/features/dashboard/WordingLibraryModule';
import { SopLibraryModule } from '../../src/renderer/features/dashboard/SopLibraryModule';
import { AnnounceModule } from '../../src/renderer/features/dashboard/AnnounceModule';
import { OPS_LOOP_COPY } from '../../src/shared/dashboard-ops-loop';

describe('dashboard live actions', () => {
  afterEach(() => {
    delete window.dashboardWording;
    delete window.dashboardContent;
    delete window.dashboardIteration;
    delete window.dashboardOps;
  });

  it('does not render the frozen-snapshot caption on overview', () => {
    render(<DashboardApp />);
    expect(screen.getByTestId('module-overview')).not.toHaveTextContent('固定周期合成演示数据');
    expect(screen.queryByText('演示数据')).not.toBeInTheDocument();
  });

  it('falls back to 未接入 when overview list rejects', async () => {
    window.dashboardIteration = {
      list: vi.fn(async () => {
        throw new Error('ipc down');
      }),
      start: vi.fn(),
      close: vi.fn(),
    };
    window.dashboardWording = {
      list: vi.fn(async () => {
        throw new Error('ipc down');
      }),
    };
    render(<OverviewModule />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '待处理事项（未接入）' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('overview-alert-catalog')).toHaveTextContent('未接入');
    expect(screen.getByTestId('overview-scope')).toHaveTextContent('检索账');
    expect(screen.queryByTestId('overview-inaccuracy-counts')).not.toBeInTheDocument();
  });

  it('loads overview todos through dashboardIteration.list', async () => {
    const list = vi.fn(async () => ({
      ok: true as const,
      items: [{
        taskId: 'it-live-1',
        signalId: 'sig-1',
        clusterKey: '面膜紫适用人群',
        sampleQueryIds: ['q1'],
        suspectedCause: 'content_gap' as const,
        suggestedScriptIds: [],
        status: 'open' as const,
        assigneeRole: 'coach',
        resolution: null,
        resolutionNote: null,
        version: 1,
        createdAt: '2026-09-20T00:00:00Z',
        updatedAt: '2026-09-20T00:00:00Z',
        resolvedAt: null,
      }],
      nextCursor: null,
    }));
    window.dashboardIteration = {
      list,
      start: vi.fn(),
      close: vi.fn(),
    };
    window.dashboardWording = {
      list: vi.fn(async () => ({ ok: true as const, releaseId: 'rel_20', total: 0, entries: [], catalogRefreshedAt: null })),
    };
    render(<OverviewModule />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.getByTestId('decision-it-live-1')).toHaveTextContent('面膜紫适用人群');
    expect(screen.getByTestId('overview-kpi-source')).toHaveTextContent('产品会话');
    expect(screen.getByTestId('overview-inaccuracy-empty')).toHaveTextContent('当前没有达到开单阈值的不准稿');
    expect(screen.queryByTestId('decision-close-hint-it-live-1')).not.toBeInTheDocument();
  });

  it('shows 已有新发布 / 可关单 when the catalog is newer than an open inaccuracy task', async () => {
    const list = vi.fn(async () => ({
      ok: true as const,
      items: [{
        taskId: 'it-hint-1',
        signalId: 'inaccuracy:script-1',
        clusterKey: 'script-1',
        sampleQueryIds: ['q-a'],
        suspectedCause: 'mixed' as const,
        suggestedScriptIds: ['script-1'],
        status: 'open' as const,
        assigneeRole: 'coach',
        resolution: null,
        resolutionNote: null,
        version: 1,
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
        resolvedAt: null,
      }],
      nextCursor: null,
    }));
    window.dashboardIteration = { list, start: vi.fn(), close: vi.fn() };
    window.dashboardWording = {
      list: vi.fn(async () => ({
        ok: true as const,
        releaseId: 'rel_21',
        catalogRefreshedAt: '2026-09-21T12:00:00.000Z',
        total: 1,
        entries: [{
          scriptId: 'script-1',
          domain: 'product' as const,
          title: '用量',
          scene: '怎么用',
          answerPreview: '先打湿',
          platform: '千牛',
          version: 'rel_21',
          scriptVersion: 2,
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveTo: null,
          effectiveWindow: '当前发布',
          risk: 'low' as const,
          lifecycle: 'published' as const,
          lifecycleLabel: '已发布' as const,
          ownerRole: '当前发布',
          dataClass: 'local-catalog' as const,
        }],
      })),
    };
    render(<OverviewModule />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.getByTestId('decision-close-hint-it-hint-1')).toHaveTextContent('已有新发布 / 可关单');
  });

  it('projects inaccuracy todos by script_id with sample query counts', async () => {
    const list = vi.fn(async () => ({
      ok: true as const,
      items: [{
        taskId: 'it-inacc-1',
        signalId: 'inaccuracy:script-1',
        clusterKey: 'script-1',
        sampleQueryIds: ['q-a', 'q-a', 'q-b'],
        suspectedCause: 'mixed' as const,
        suggestedScriptIds: ['script-1'],
        status: 'open' as const,
        assigneeRole: 'coach',
        resolution: null,
        resolutionNote: null,
        version: 1,
        createdAt: '2026-09-20T00:00:00Z',
        updatedAt: '2026-09-20T00:00:00Z',
        resolvedAt: null,
      }],
      nextCursor: null,
    }));
    window.dashboardIteration = {
      list,
      start: vi.fn(),
      close: vi.fn(),
    };
    window.dashboardWording = {
      list: vi.fn(async () => ({
        ok: true as const,
        releaseId: 'rel_20',
        catalogRefreshedAt: null,
        total: 1,
        entries: [{
          scriptId: 'script-1',
          domain: 'product' as const,
          title: '用量',
          scene: '怎么用',
          answerPreview: '先打湿',
          platform: '千牛',
          version: 'rel_20',
          scriptVersion: 1,
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveTo: null,
          effectiveWindow: '当前发布',
          risk: 'low' as const,
          lifecycle: 'published' as const,
          lifecycleLabel: '已发布' as const,
          ownerRole: '当前发布',
          dataClass: 'local-catalog' as const,
        }],
      })),
    };
    render(<OverviewModule />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.getByTestId('overview-inaccuracy-script-1')).toHaveTextContent('script-1');
    expect(screen.getByTestId('overview-inaccuracy-script-1')).toHaveTextContent('用量');
    expect(screen.getByTestId('overview-inaccuracy-script-1')).toHaveTextContent('2');
    expect(screen.getByTestId('decision-it-inacc-1')).toHaveTextContent('用量');
    expect(screen.getByTestId('decision-it-inacc-1')).toHaveTextContent('话术不准 · 稿 script-1 · 样本 2 次');
    expect(screen.queryByTestId('overview-inaccuracy-empty')).not.toBeInTheDocument();
  });

  it('uploads wording drafts through dashboardContent.importDraft', async () => {
    const importDraft = vi.fn(async () => ({
      ok: true as const,
      importBatchId: 'imp_live',
      status: 'validating' as const,
    }));
    window.dashboardContent = {
      session: vi.fn(async () => ({ ok: true as const, enabled: true, signedIn: true, role: 'coach' as const })),
      parseUpload: vi.fn(),
      importDraft,
      publishDraft: vi.fn(),
    };
    window.dashboardWording = {
      list: vi.fn(async () => ({ ok: true as const, releaseId: 'rel_20', total: 0, entries: [], catalogRefreshedAt: null })),
    };
    const user = userEvent.setup();
    render(<WordingLibraryModule />);
    const csv = new File(['scene,script,domain\n用量,说明,product\n'], 'live.csv', { type: 'text/csv' });
    await user.upload(screen.getByTestId('wording-upload-input'), csv);
    await waitFor(() => expect(importDraft).toHaveBeenCalled());
    expect(screen.getByTestId('wording-write-status')).toHaveTextContent('imp_live');
  });

  it('fail-closes wording update/delete and SOP writes instead of mock success', async () => {
    const user = userEvent.setup();
    window.dashboardWording = {
      list: vi.fn(async () => ({ ok: true as const, releaseId: null, total: 0, entries: [], catalogRefreshedAt: null })),
    };
    render(<WordingLibraryModule />);
    await user.click(screen.getByTestId('wording-update'));
    expect(screen.getByTestId('wording-write-status')).toHaveTextContent('请先选中话术');
    await user.click(screen.getByTestId('wording-delete'));
    expect(screen.getByTestId('wording-write-status')).toHaveTextContent('请先选中话术');

    render(<SopLibraryModule />);
    await user.click(screen.getByTestId('sop-update'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('未接入');
    await user.click(screen.getByTestId('sop-export'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('没有 SOP 写库通道');
    expect(screen.getByTestId('sop-library-empty')).toHaveTextContent('未接入 SOP 库');
  });

  it('does not render fixture content releases when there is no live publish', async () => {
    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(screen.getByTestId('nav-content'));
    expect(screen.queryByTestId('release-rel-demo-2026-08-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('release-rel-demo-2026-08-blocked')).not.toBeInTheDocument();
    expect(screen.queryByText('结构演示')).not.toBeInTheDocument();
    expect(screen.queryByText('ACK/Lease')).not.toBeInTheDocument();
    expect(screen.getByTestId('publish-disabled-reason')).toHaveTextContent('当前没有产品会话');
  });

  it('fail-closes software update checks without mock version lists', async () => {
    const user = userEvent.setup();
    render(<AnnounceModule />);
    await user.click(screen.getByTestId('system-sync-tab-software'));
    await user.click(screen.getByTestId('software-check-update'));
    expect(screen.getByTestId('software-update-status')).toHaveTextContent('未接入');
    expect(screen.queryByText('v0.3.14')).not.toBeInTheDocument();
  });

  it('loads SOP catalog through dashboardOps and imports a CSV tree', async () => {
    const sopCatalog = vi.fn(async () => ({
      ok: true as const,
      productSessionId: 'default',
      items: [{
        nodeId: 'n1',
        parentNodeId: null,
        title: '停手',
        body: '先停手',
        sortKey: 0,
        version: 1,
        lifecycle: 'active' as const,
      }],
    }));
    const sopImport = vi.fn(async (_csvText: string) => ({
      ok: true as const, productSessionId: 'default', nodeCount: 1,
    }));
    window.dashboardOps = {
      retrieval: vi.fn(),
      sopCatalog,
      sopImport,
      sopPatch: vi.fn(),
      sopDelete: vi.fn(),
      scriptPatch: vi.fn(),
      scriptDelete: vi.fn(),
      softwareCatalog: vi.fn(),
    };
    const user = userEvent.setup();
    render(<SopLibraryModule />);
    await waitFor(() => expect(sopCatalog).toHaveBeenCalled());
    expect(screen.getByTestId('sop-library-list')).toHaveTextContent('停手');
    const csvText = 'node_id,parent_node_id,title,body,sort_key\nn1,,停手,先停手,0\n';
    const csv = new File([csvText], 'sop.csv', { type: 'text/csv' });
    Object.defineProperty(csv, 'text', { value: async () => csvText });
    await user.upload(screen.getByTestId('sop-upload-input'), csv);
    await waitFor(() => expect(sopImport).toHaveBeenCalled());
    expect(sopImport.mock.calls[0]?.[0]).toContain('node_id,parent_node_id,title,body,sort_key');
    await waitFor(() => expect(sopCatalog).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('sop-library-list')).toHaveTextContent('停手');
  });

  it('patches wording into pending_review and shows retrieval plus GONE software current', async () => {
    const scriptPatch = vi.fn(async (_request: {
      scriptId: string;
      expectedVersion: number;
      title: string;
      answerText: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
    }) => ({
      ok: true as const,
      scriptId: 'script-1',
      mutationId: 'smut_1',
      reviewStatus: 'pending_review' as const,
    }));
    const retrieval = vi.fn(async () => ({
      ok: true as const,
      noHitRate: 0.125,
      copyCompleteRate: 0.5,
      openTaskCount: 2,
      currentReleaseScriptCount: 10,
      window: 'current_release' as const,
      releaseId: 'rel_20',
    }));
    const softwareCatalog = vi.fn(async () => ({
      ok: true as const,
      items: [{
        version: '0.3.17',
        platform: 'mac-universal' as const,
        sha256: 'a'.repeat(64),
        downloadUrl: 'https://example.com/app.dmg',
        createdAt: '2026-09-21T00:00:00.000Z',
        signed: false,
      }],
      current: null,
    }));
    window.dashboardOps = {
      retrieval,
      sopCatalog: vi.fn(),
      sopImport: vi.fn(),
      sopPatch: vi.fn(),
      sopDelete: vi.fn(),
      scriptPatch,
      scriptDelete: vi.fn(),
      softwareCatalog,
    };
    window.dashboardWording = {
      list: async () => ({
        ok: true as const,
        releaseId: 'rel_20',
        catalogRefreshedAt: null,
        total: 1,
        entries: [{
          scriptId: 'script-1',
          domain: 'product',
          title: '用量',
          scene: '怎么用',
          answerPreview: '先打湿',
          platform: '千牛',
          version: 'rel_20',
          scriptVersion: 1,
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveTo: null,
          effectiveWindow: '当前发布',
          risk: 'low',
          lifecycle: 'published',
          lifecycleLabel: '已发布',
          ownerRole: '当前发布',
          dataClass: 'local-catalog',
        }],
      }),
    };
    window.dashboardIteration = {
      list: vi.fn(async () => ({ ok: true as const, items: [], nextCursor: null })),
      start: vi.fn(),
      close: vi.fn(),
    };
    const user = userEvent.setup();
    const { unmount } = render(<WordingLibraryModule />);
    await waitFor(() => expect(screen.getByTestId('wording-list')).toHaveTextContent('用量'));
    await user.click(screen.getByTestId('wording-update'));
    await waitFor(() => expect(scriptPatch).toHaveBeenCalled());
    expect(scriptPatch.mock.calls[0]?.[0]).toMatchObject({
      scriptId: 'script-1', expectedVersion: 1, title: '用量',
    });
    expect(screen.getByTestId('wording-write-status')).toHaveTextContent(`${OPS_LOOP_COPY.pendingReview} smut_1`);
    unmount();

    render(<OverviewModule />);
    await waitFor(() => expect(retrieval).toHaveBeenCalledWith('current_release'));
    expect(screen.getByTestId('overview-alert-nohit')).toHaveTextContent('12.5%');
    expect(screen.getByTestId('overview-scope')).toHaveTextContent('当前发布');

    render(<AnnounceModule />);
    await user.click(screen.getByTestId('system-sync-tab-software'));
    await user.click(screen.getByTestId('software-check-update'));
    await waitFor(() => expect(softwareCatalog).toHaveBeenCalled());
    expect(screen.getByTestId('software-update-status')).toHaveTextContent('目录为空');
    expect(screen.getByTestId('software-update-status')).not.toHaveTextContent('latest.yml');
  });

  it('deletes wording through live scriptDelete into pending_review', async () => {
    const scriptDelete = vi.fn(async (_request: {
      scriptId: string;
      expectedVersion: number;
    }) => ({
      ok: true as const,
      scriptId: 'script-1',
      mutationId: 'smut_del',
      reviewStatus: 'pending_review' as const,
    }));
    window.dashboardOps = {
      retrieval: vi.fn(),
      sopCatalog: vi.fn(),
      sopImport: vi.fn(),
      sopPatch: vi.fn(),
      sopDelete: vi.fn(),
      scriptPatch: vi.fn(),
      scriptDelete,
      softwareCatalog: vi.fn(),
    };
    window.dashboardWording = {
      list: async () => ({
        ok: true as const,
        releaseId: 'rel_20',
        catalogRefreshedAt: null,
        total: 1,
        entries: [{
          scriptId: 'script-1',
          domain: 'product',
          title: '用量',
          scene: '怎么用',
          answerPreview: '先打湿',
          platform: '千牛',
          version: 'rel_20',
          scriptVersion: 2,
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveTo: null,
          effectiveWindow: '当前发布',
          risk: 'low',
          lifecycle: 'published',
          lifecycleLabel: '已发布',
          ownerRole: '当前发布',
          dataClass: 'local-catalog',
        }],
      }),
    };
    const user = userEvent.setup();
    render(<WordingLibraryModule />);
    await waitFor(() => expect(screen.getByTestId('wording-list')).toHaveTextContent('用量'));
    await user.click(screen.getByTestId('wording-delete'));
    await waitFor(() => expect(scriptDelete).toHaveBeenCalled());
    expect(scriptDelete.mock.calls[0]?.[0]).toEqual({
      scriptId: 'script-1', expectedVersion: 2,
    });
    expect(screen.getByTestId('wording-write-status')).toHaveTextContent(`${OPS_LOOP_COPY.pendingReview} smut_del`);
  });

  it('labels last_7d retrieval as 近 7 天', async () => {
    const retrieval = vi.fn(async () => ({
      ok: true as const,
      noHitRate: 0.2,
      copyCompleteRate: 0.4,
      openTaskCount: 1,
      currentReleaseScriptCount: 8,
      window: 'last_7d' as const,
      releaseId: null,
    }));
    window.dashboardOps = {
      retrieval,
      sopCatalog: vi.fn(),
      sopImport: vi.fn(),
      sopPatch: vi.fn(),
      sopDelete: vi.fn(),
      scriptPatch: vi.fn(),
      scriptDelete: vi.fn(),
      softwareCatalog: vi.fn(),
    };
    window.dashboardWording = {
      list: vi.fn(async () => ({ ok: true as const, releaseId: 'rel_20', total: 0, entries: [], catalogRefreshedAt: null })),
    };
    window.dashboardIteration = {
      list: vi.fn(async () => ({ ok: true as const, items: [], nextCursor: null })),
      start: vi.fn(),
      close: vi.fn(),
    };
    render(<OverviewModule />);
    await waitFor(() => expect(retrieval).toHaveBeenCalledWith('current_release'));
    expect(screen.getByTestId('overview-scope')).toHaveTextContent('近 7 天');
    expect(screen.getByTestId('overview-alert-nohit')).toHaveTextContent('20.0%');
  });

  it('falls back to 未接入 when wording list rejects', async () => {
    window.dashboardWording = {
      list: vi.fn(async () => {
        throw new Error('ipc down');
      }),
    };
    render(<WordingLibraryModule />);
    await waitFor(() => {
      expect(screen.getByTestId('wording-empty')).toHaveTextContent('本机话术库未挂载');
    });
  });

  it('refuses wording writes without a scriptVersion and shows UNSIGNED software current', async () => {
    const scriptPatch = vi.fn();
    const scriptDelete = vi.fn();
    window.dashboardOps = {
      retrieval: vi.fn(async () => ({
        ok: false as const, code: 'FORBIDDEN' as const, message: '当前角色不能执行这个操作。',
      })),
      sopCatalog: vi.fn(),
      sopImport: vi.fn(),
      sopPatch: vi.fn(),
      sopDelete: vi.fn(),
      scriptPatch,
      scriptDelete,
      softwareCatalog: vi.fn(async () => ({
        ok: true as const,
        items: [],
        current: {
          version: '0.3.18',
          platform: 'mac-universal' as const,
          sha256: 'a'.repeat(64),
          downloadUrl: 'https://example.com/app.dmg',
          createdAt: '2026-09-21T00:00:00.000Z',
          signed: false,
        },
      })),
    };
    window.dashboardWording = {
      list: async () => ({
        ok: true as const,
        releaseId: 'rel_20',
        catalogRefreshedAt: null,
        total: 1,
        entries: [{
          scriptId: 'script-1',
          domain: 'product',
          title: '用量',
          scene: '怎么用',
          answerPreview: '先打湿',
          platform: '千牛',
          version: 'rel_20',
          scriptVersion: null,
          effectiveFrom: null,
          effectiveTo: null,
          effectiveWindow: '当前发布',
          risk: 'low',
          lifecycle: 'published',
          lifecycleLabel: '已发布',
          ownerRole: '当前发布',
          dataClass: 'local-catalog',
        }],
      }),
    };
    window.dashboardIteration = {
      list: vi.fn(async () => ({ ok: true as const, items: [], nextCursor: null })),
      start: vi.fn(),
      close: vi.fn(),
    };
    const user = userEvent.setup();
    const { unmount } = render(<WordingLibraryModule />);
    await waitFor(() => expect(screen.getByTestId('wording-list')).toHaveTextContent('用量'));
    await user.click(screen.getByTestId('wording-update'));
    expect(screen.getByTestId('wording-write-status')).toHaveTextContent(OPS_LOOP_COPY.noVersion);
    await user.click(screen.getByTestId('wording-delete'));
    expect(screen.getByTestId('wording-write-status')).toHaveTextContent(OPS_LOOP_COPY.noVersion);
    expect(scriptPatch).not.toHaveBeenCalled();
    expect(scriptDelete).not.toHaveBeenCalled();
    unmount();

    render(<OverviewModule />);
    await waitFor(() => expect(screen.getByTestId('overview-alert-nohit')).toHaveTextContent('未接入'));
    expect(screen.getByTestId('overview-scope')).toHaveTextContent('未接入');

    render(<AnnounceModule />);
    await user.click(screen.getByTestId('system-sync-tab-software'));
    await user.click(screen.getByTestId('software-check-update'));
    await waitFor(() => {
      expect(screen.getByTestId('software-update-status')).toHaveTextContent('0.3.18');
    });
    expect(screen.getByTestId('software-update-status')).toHaveTextContent('UNSIGNED');
    expect(screen.getByTestId('software-update-status')).toHaveTextContent('不跑 latest.yml');
  });
});
