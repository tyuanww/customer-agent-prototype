import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SopLibraryModule } from '../../src/renderer/features/dashboard/SopLibraryModule';
import type { DashboardContentApi } from '../../src/shared/dashboard-content';
import { allergySopTree } from '../../src/shared/synthetic-sops';

const KIND_LABEL = {
  copyable: '可复制话术',
  decision: '分支',
  internal: '内部停手',
} as const;

const sourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/renderer/features/dashboard/SopLibraryModule.tsx',
);

function mockSession(role: 'agent' | 'coach' | 'owner' | null, signedIn = true): DashboardContentApi {
  return {
    session: vi.fn(async () => ({
      ok: true as const,
      enabled: true,
      signedIn,
      role: signedIn ? role : null,
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
  };
}

describe('SopLibraryModule', () => {
  beforeEach(() => {
    delete window.dashboardContent;
  });

  afterEach(() => {
    delete window.dashboardContent;
  });

  it('renders the shared allergy tree as a read-only 话术运营 library', () => {
    const tree = allergySopTree();
    render(<SopLibraryModule />);
    const module = screen.getByTestId('module-sop');

    expect(screen.getByRole('heading', { level: 1, name: 'SOP' })).toBeInTheDocument();
    expect(module).toHaveTextContent('合成过敏树只读');
    expect(module).toHaveTextContent('不编辑、不发布');
    expect(module).toHaveTextContent('合同 intake');
    expect(module).toHaveTextContent('不承诺赔付');
    expect(module).toHaveTextContent('合成演示');
    expect(module).toHaveTextContent('合成树已挂载');
    expect(module).toHaveTextContent(`${tree.nodes.length} 个节点 · 起点 ${tree.startNodeId}`);
    expect(screen.getByRole('region', { name: tree.sceneTitle })).toBeInTheDocument();
    expect(module.textContent).not.toMatch(/打款|现金红包|退款到账/);
    expect(within(module).queryAllByRole('button')).toHaveLength(0);
    expect(within(module).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(module).queryByRole('button', { name: '发布' })).not.toBeInTheDocument();
  });

  it('labels copyable, decision, and internal nodes with risk, stop copy, and edges', () => {
    const tree = allergySopTree();
    render(<SopLibraryModule />);
    const list = screen.getByTestId('sop-library-list');
    expect(list.querySelectorAll('[data-testid^="sop-node-"]')).toHaveLength(tree.nodes.length);

    for (const node of tree.nodes) {
      const item = screen.getByTestId(`sop-node-${node.id}`);
      expect(item).toHaveTextContent(KIND_LABEL[node.kind]);
      if (node.kind === 'internal') {
        expect(item.querySelector('.dash-badge.is-danger')).toHaveTextContent('内部停手');
      } else {
        expect(within(item).queryByText('内部停手')).not.toBeInTheDocument();
        expect(item.querySelector('.dash-badge.is-danger')?.textContent ?? '').not.toContain('内部停手');
      }
      if (node.riskLevel === 'high') {
        expect(within(item).getByText('高风险')).toBeInTheDocument();
      } else {
        expect(within(item).queryByText('高风险')).not.toBeInTheDocument();
      }
      expect(item.querySelector('strong')).toHaveTextContent(node.scopeLabel ?? node.prompt ?? node.id);
      expect(item).toHaveTextContent(node.answerText ?? node.prompt ?? node.internalNote ?? '');
      expect(item.querySelector('.sop-library-stop')).toBeNull();
      expect(item.querySelector('.sop-library-note')).toBeNull();
      const edges = item.querySelector('.sop-library-edges');
      if (node.edges.length > 0) {
        expect(edges).toHaveTextContent(`分支：${node.edges.map((edge) => edge.label).join(' / ')}`);
      } else {
        expect(edges).toBeNull();
      }
    }

    expect(screen.getByTestId('sop-node-voucher-ask')).toHaveTextContent('过敏凭证');
    expect(screen.getByTestId('sop-node-mild-copyable')).not.toHaveTextContent('高风险');
    expect(screen.getByTestId('sop-node-severe-internal')).not.toHaveTextContent('通知话术师复核');
    expect(screen.getByTestId('sop-node-severe-done').querySelector('.sop-library-stop')).toBeNull();
  });

  it('shows internal stop copy only for coach or owner sessions', async () => {
    const api = mockSession('coach');
    window.dashboardContent = api;
    render(<SopLibraryModule />);
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByTestId('sop-node-severe-internal')).toHaveTextContent('通知话术师复核');
    });
    expect(screen.getByTestId('sop-node-severe-internal')).toHaveTextContent('不要把内部口径发给客户');
    expect(api.publishDraft).not.toHaveBeenCalled();
  });

  it('hides internal stop copy for agent sessions', async () => {
    const api = mockSession('agent');
    window.dashboardContent = api;
    render(<SopLibraryModule />);
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    expect(screen.getByTestId('sop-node-severe-internal')).not.toHaveTextContent('通知话术师复核');
    expect(screen.getByTestId('sop-node-severe-internal')).not.toHaveTextContent('不要把内部口径发给客户');
  });

  it('drops internal stop copy when a later session call fails', async () => {
    const api = mockSession('coach');
    window.dashboardContent = api;
    render(<SopLibraryModule />);
    await waitFor(() => {
      expect(screen.getByTestId('sop-node-severe-internal')).toHaveTextContent('通知话术师复核');
    });
    api.session = vi.fn(async () => {
      throw new Error('ipc down');
    });
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => {
      expect(screen.getByTestId('sop-node-severe-internal')).not.toHaveTextContent('通知话术师复核');
    });
  });

  it('reads allergySopTree() and does not persist, publish, or open HTTP', () => {
    const source = readFileSync(sourcePath, 'utf8');
    expect(source).toContain('allergySopTree()');
    expect(source).toContain('dashboardContent');
    expect(source).toContain('api.session()');
    expect(source).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/);
    expect(source).not.toContain('publishDraft');
    expect(source).not.toContain('contentEditable');
  });
});
