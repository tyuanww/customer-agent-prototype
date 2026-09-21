import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SopLibraryModule } from '../../src/renderer/features/dashboard/SopLibraryModule';

describe('SopLibraryModule', () => {
  beforeEach(() => {
    delete window.dashboardContent;
    delete window.dashboardOps;
  });

  afterEach(() => {
    delete window.dashboardContent;
    delete window.dashboardOps;
  });

  it('renders fail-closed SOP writes without a synthetic catalog', () => {
    render(<SopLibraryModule />);
    const module = screen.getByTestId('module-sop');
    expect(screen.getByRole('heading', { level: 1, name: 'SOP' })).toBeInTheDocument();
    expect(module).toHaveTextContent('没有 SOP 写库通道');
    expect(screen.getByTestId('sop-library-empty')).toHaveTextContent('未接入 SOP 库');
    expect(screen.queryByTestId('sop-library-list')).not.toBeInTheDocument();
    expect(screen.queryByText('过敏凭证')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布' })).not.toBeInTheDocument();
  });

  it('refuses upload, update, delete, export, and custom steps', async () => {
    const user = userEvent.setup();
    render(<SopLibraryModule />);
    expect(screen.getByRole('button', { name: '上传' })).toBeInTheDocument();
    const file = new File(['scene,script\n过敏,先停用\n'], 'sop.csv', { type: 'text/csv' });
    await user.upload(screen.getByTestId('sop-upload-input'), file);
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('未接入');
    await user.click(screen.getByTestId('sop-update'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('未接入');
    await user.click(screen.getByTestId('sop-delete'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('没有 SOP 写库通道');
    await user.click(screen.getByTestId('sop-export'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('没有 SOP 写库通道');
    await user.click(screen.getByTestId('sop-custom-step'));
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('未接入');
  });

  it('updates and deletes the selected live SOP node', async () => {
    const sopPatch = vi.fn(async () => ({
      nodeId: 'n2',
      parentNodeId: 'n1',
      title: '核对',
      body: '再核对',
      sortKey: 1,
      version: 5,
      lifecycle: 'active' as const,
    }));
    const sopDelete = vi.fn(async () => ({
      nodeId: 'n2',
      parentNodeId: 'n1',
      title: '核对',
      body: '再核对',
      sortKey: 1,
      version: 6,
      lifecycle: 'deleted' as const,
    }));
    const sopCatalog = vi.fn(async () => ({
      ok: true as const,
      productSessionId: 'default',
      items: [
        {
          nodeId: 'n1', parentNodeId: null, title: '停手', body: '先停手',
          sortKey: 0, version: 1, lifecycle: 'active' as const,
        },
        {
          nodeId: 'n2', parentNodeId: 'n1', title: '核对', body: '再核对',
          sortKey: 1, version: 4, lifecycle: 'active' as const,
        },
      ],
    }));
    window.dashboardOps = {
      retrieval: vi.fn(),
      sopCatalog,
      sopImport: vi.fn(),
      sopPatch,
      sopDelete,
      scriptPatch: vi.fn(),
      scriptDelete: vi.fn(),
      softwareCatalog: vi.fn(),
    };
    const user = userEvent.setup();
    render(<SopLibraryModule />);
    await waitFor(() => expect(screen.getByTestId('sop-library-list')).toHaveTextContent('核对'));
    await user.click(screen.getByTestId('sop-node-n2'));
    await user.click(screen.getByTestId('sop-update'));
    await waitFor(() => expect(sopPatch).toHaveBeenCalledWith({
      nodeId: 'n2', expectedVersion: 4, title: '核对', body: '再核对', sortKey: 1,
    }));
    await waitFor(() => expect(sopCatalog).toHaveBeenCalledTimes(2));

    await user.click(screen.getByTestId('sop-node-n2'));
    await user.click(screen.getByTestId('sop-delete'));
    await waitFor(() => expect(sopDelete).toHaveBeenCalledWith({
      nodeId: 'n2', expectedVersion: 4,
    }));
    await waitFor(() => expect(sopCatalog).toHaveBeenCalledTimes(3));
  });

  it('blocks oversized SOP files and imports a custom step as replace-all', async () => {
    const sopImport = vi.fn(async (_csvText: string) => ({
      ok: true as const, productSessionId: 'default', nodeCount: 2,
    }));
    const sopCatalog = vi.fn(async () => ({
      ok: true as const,
      productSessionId: 'default',
      items: [
        {
          nodeId: 'n1', parentNodeId: null, title: '停手', body: '先停手',
          sortKey: 0, version: 1, lifecycle: 'active' as const,
        },
        {
          nodeId: 'gone', parentNodeId: null, title: '已删', body: '不展示',
          sortKey: 9, version: 1, lifecycle: 'deleted' as const,
        },
      ],
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
    await waitFor(() => expect(screen.getByTestId('sop-library-list')).toHaveTextContent('停手'));
    expect(screen.queryByText('已删')).not.toBeInTheDocument();

    const oversized = new File([new Uint8Array(256 * 1024 + 1)], 'sop.csv', { type: 'text/csv' });
    await user.upload(screen.getByTestId('sop-upload-input'), oversized);
    expect(screen.getByTestId('sop-write-status')).toHaveTextContent('SOP 文件超过 256KB');
    expect(sopImport).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('sop-custom-step'));
    await waitFor(() => expect(sopImport).toHaveBeenCalled());
    expect(sopImport.mock.calls[0]?.[0]).toContain('自定义步骤');
    expect(sopImport.mock.calls[0]?.[0]).toContain('node_id,parent_node_id,title,body,sort_key');
    await waitFor(() => expect(sopCatalog).toHaveBeenCalledTimes(2));
  });

  it('surfaces catalog failures and an empty product session without a synthetic tree', async () => {
    window.dashboardOps = {
      retrieval: vi.fn(),
      sopCatalog: vi.fn(async () => ({
        ok: false as const, code: 'FORBIDDEN' as const, message: '当前角色不能执行这个操作。',
      })),
      sopImport: vi.fn(),
      sopPatch: vi.fn(),
      sopDelete: vi.fn(),
      scriptPatch: vi.fn(),
      scriptDelete: vi.fn(),
      softwareCatalog: vi.fn(),
    };
    const { unmount } = render(<SopLibraryModule />);
    await waitFor(() => {
      expect(screen.getByTestId('sop-write-status')).toHaveTextContent('当前角色不能执行这个操作');
    });
    expect(screen.getByTestId('sop-library-empty')).toHaveTextContent('未接入 SOP 库');
    unmount();

    window.dashboardOps = {
      retrieval: vi.fn(),
      sopCatalog: vi.fn(async () => ({
        ok: true as const, productSessionId: 'default', items: [],
      })),
      sopImport: vi.fn(),
      sopPatch: vi.fn(),
      sopDelete: vi.fn(),
      scriptPatch: vi.fn(),
      scriptDelete: vi.fn(),
      softwareCatalog: vi.fn(),
    };
    render(<SopLibraryModule />);
    await waitFor(() => {
      expect(screen.getByTestId('sop-library-empty')).toHaveTextContent('当前产品会话没有 SOP 节点');
    });
  });
});
