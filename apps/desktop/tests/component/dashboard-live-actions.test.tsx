import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { OverviewModule } from '../../src/renderer/features/dashboard/OverviewModule';
import { WordingLibraryModule } from '../../src/renderer/features/dashboard/WordingLibraryModule';
import { SopLibraryModule } from '../../src/renderer/features/dashboard/SopLibraryModule';
import { AnnounceModule } from '../../src/renderer/features/dashboard/AnnounceModule';

describe('dashboard live actions', () => {
  afterEach(() => {
    delete window.dashboardWording;
    delete window.dashboardContent;
    delete window.dashboardIteration;
  });

  it('does not render the frozen-snapshot caption on overview', () => {
    render(<DashboardApp />);
    expect(screen.getByTestId('module-overview')).not.toHaveTextContent('固定周期合成演示数据');
    expect(screen.queryByText('演示数据')).not.toBeInTheDocument();
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
      list: vi.fn(async () => ({ ok: true as const, releaseId: 'rel_20', total: 0, entries: [] })),
    };
    render(<OverviewModule />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.getByTestId('decision-it-live-1')).toHaveTextContent('面膜紫适用人群');
    expect(screen.getByTestId('overview-kpi-source')).toHaveTextContent('产品会话');
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
      list: vi.fn(async () => ({ ok: true as const, releaseId: 'rel_20', total: 0, entries: [] })),
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
      list: vi.fn(async () => ({ ok: true as const, releaseId: null, total: 0, entries: [] })),
    };
    render(<WordingLibraryModule />);
    await user.click(screen.getByTestId('wording-update'));
    expect(screen.getByTestId('wording-write-status')).toHaveTextContent('未接入');
    await user.click(screen.getByTestId('wording-delete'));
    expect(screen.getByTestId('wording-write-status')).toHaveTextContent('未接入');

    render(<SopLibraryModule />);
    await user.click(screen.getByTestId('sop-update'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('未接入');
    await user.click(screen.getByTestId('sop-export'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('contracts:intake');
  });

  it('fail-closes software update checks without mock version lists', async () => {
    const user = userEvent.setup();
    render(<AnnounceModule />);
    await user.click(screen.getByTestId('system-sync-tab-software'));
    await user.click(screen.getByTestId('software-check-update'));
    expect(screen.getByTestId('software-update-status')).toHaveTextContent('未接入');
    expect(screen.queryByText('v0.3.14')).not.toBeInTheDocument();
  });
});
