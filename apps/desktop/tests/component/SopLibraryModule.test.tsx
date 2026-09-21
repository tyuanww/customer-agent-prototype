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
});
