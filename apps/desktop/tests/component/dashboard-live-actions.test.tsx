import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardApp } from '../../src/renderer/DashboardApp';
import { SopLibraryModule } from '../../src/renderer/features/dashboard/SopLibraryModule';
import type { SopUse } from '../../src/shared/page-use';

describe('dashboard live actions', () => {
  afterEach(() => {
    delete window.dashboardOps;
  });

  it('does not render the frozen-snapshot caption on overview', () => {
    render(<DashboardApp />);
    expect(screen.getByTestId('module-overview')).not.toHaveTextContent('固定周期合成演示数据');
    expect(screen.queryByText('演示数据')).not.toBeInTheDocument();
  });

  it('fail-closes SOP writes instead of mock success', async () => {
    const user = userEvent.setup();

    render(<SopLibraryModule />);
    expect(screen.getByTestId('sop-upload')).toBeDisabled();
    expect(screen.getByTestId('sop-update')).toBeDisabled();
    expect(screen.getByTestId('sop-delete')).toBeDisabled();
    await user.click(screen.getByTestId('sop-export'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('请先登录后再管理 SOP。');
    expect(screen.getByTestId('sop-library-empty')).toHaveTextContent('请先登录后再管理 SOP。');
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
      scriptDelete: vi.fn(),
      softwareCatalog: vi.fn(),
      softwareOpenDownload: vi.fn(),
    };
    const user = userEvent.setup();
    const sop: SopUse = {
      state: 'open',
      nodes: [{
        nodeId: 'n1', parentNodeId: null, title: '停手', body: '先停手',
        sortKey: 0, version: 1, lifecycle: 'active',
      }],
    };
    render(<SopLibraryModule sop={sop} />);
    expect(sopCatalog).not.toHaveBeenCalled();
    expect(screen.getByTestId('sop-library-list')).toHaveTextContent('停手');
    const csvText = 'node_id,parent_node_id,title,body,sort_key\nn1,,停手,先停手,0\n';
    const csv = new File([csvText], 'sop.csv', { type: 'text/csv' });
    Object.defineProperty(csv, 'text', { value: async () => csvText });
    await user.upload(screen.getByTestId('sop-upload-input'), csv);
    await waitFor(() => expect(sopImport).toHaveBeenCalled());
    expect(sopImport.mock.calls[0]?.[0]).toContain('node_id,parent_node_id,title,body,sort_key');
    expect(sopCatalog).not.toHaveBeenCalled();
    expect(screen.getByTestId('sop-library-list')).toHaveTextContent('停手');
  });
});
