import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  isDashboardOpsFailure,
  OPS_LOOP_COPY,
  SOP_UPLOAD_MAX_BYTES,
  type DashboardSopNode,
} from '@shared/dashboard-ops-loop';
import { StatusBadge } from './StatusBadge';

function toCsv(items: readonly DashboardSopNode[]): string {
  const header = 'node_id,parent_node_id,title,body,sort_key';
  const rows = items.map((item) => [
    item.nodeId,
    item.parentNodeId ?? '',
    `"${item.title.replaceAll('"', '""')}"`,
    `"${item.body.replaceAll('"', '""')}"`,
    String(item.sortKey),
  ].join(','));
  return [header, ...rows].join('\n');
}

export function SopLibraryModule() {
  const [items, setItems] = useState<readonly DashboardSopNode[] | null>(null);
  const [message, setMessage] = useState('加载中…');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = () => {
    const api = window.dashboardOps;
    if (!api) {
      setItems(null);
      setMessage('未接入：没有 SOP 写库通道。');
      return;
    }
    void api.sopCatalog().then((result) => {
      if (!result.ok) {
        setItems(null);
        setMessage(result.message);
        return;
      }
      const active = result.items.filter((item) => item.lifecycle === 'active');
      setItems(active);
      setSelectedId((current) => current && active.some((item) => item.nodeId === current)
        ? current
        : active[0]?.nodeId ?? null);
      setMessage(active.length === 0 ? '当前产品会话没有 SOP 节点。' : '');
    }).catch(() => {
      setItems(null);
      setMessage(OPS_LOOP_COPY.unavailable);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const selected = (items ?? []).find((item) => item.nodeId === selectedId) ?? null;

  return (
    <div className="dash-module" data-testid="module-sop">
      <header className="dash-module-head">
        <div>
          <h1>SOP</h1>
          <p className="dash-kicker">读当前产品会话 · 导入覆盖整树 · 删除仅 owner</p>
        </div>
      </header>
      <p className="dash-scope dash-scope-important">
        上传 CSV 会覆盖当前产品会话 SOP 树。更新/删除针对选中节点。坐席 overlay 仍是只读预览。
      </p>
      <div className="dash-filter-toolbar" aria-label="SOP 写操作">
        <input
          ref={uploadRef}
          data-testid="sop-upload-input"
          type="file"
          accept=".csv"
          hidden
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            const api = window.dashboardOps;
            if (!file || !api) {
              setMessage(file ? OPS_LOOP_COPY.noProduct : message);
              return;
            }
            if (file.size > SOP_UPLOAD_MAX_BYTES) {
              setMessage(OPS_LOOP_COPY.sopTooLarge);
              return;
            }
            void file.text().then(async (csvText) => {
              const result = await api.sopImport(csvText);
              setMessage(result.ok ? `已导入 ${result.nodeCount} 个节点` : result.message);
              if (result.ok) load();
            });
          }}
        />
        <button
          type="button"
          className="dash-reset"
          data-testid="sop-upload"
          onClick={() => uploadRef.current?.click()}
        >
          上传
        </button>
        <button
          type="button"
          className="dash-reset"
          data-testid="sop-update"
          onClick={() => {
            const api = window.dashboardOps;
            if (!api) {
              setMessage('未接入：没有 SOP 写库通道。');
              return;
            }
            if (!selected) {
              setMessage('请先选中节点。');
              return;
            }
            void api.sopPatch({
              nodeId: selected.nodeId,
              expectedVersion: selected.version,
              title: selected.title,
              body: selected.body,
              sortKey: selected.sortKey,
            }).then((result) => {
              if (isDashboardOpsFailure(result)) {
                setMessage(result.message);
                return;
              }
              setMessage(`已更新 ${result.nodeId}`);
              load();
            });
          }}
        >
          更新
        </button>
        <button
          type="button"
          className="dash-reset"
          data-testid="sop-delete"
          onClick={() => {
            const api = window.dashboardOps;
            if (!api) {
              setMessage('未接入：没有 SOP 写库通道。');
              return;
            }
            if (!selected) {
              setMessage('请先选中节点。');
              return;
            }
            void api.sopDelete({
              nodeId: selected.nodeId,
              expectedVersion: selected.version,
            }).then((result) => {
              if (isDashboardOpsFailure(result)) {
                setMessage(result.message);
                return;
              }
              setMessage(`已删除 ${result.nodeId}`);
              load();
            });
          }}
        >
          删除
        </button>
        <button
          type="button"
          className="dash-reset"
          data-testid="sop-export"
          onClick={() => {
            if (!window.dashboardOps) {
              setMessage(OPS_LOOP_COPY.sopChannel);
              return;
            }
            if (!items || items.length === 0) {
              setMessage('没有可导出的节点。');
              return;
            }
            const blob = new Blob([toCsv(items)], { type: 'text/csv;charset=utf-8' });
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            link.download = 'sop-catalog.csv';
            link.click();
            URL.revokeObjectURL(href);
          }}
        >
          导出
        </button>
        <button
          type="button"
          className="dash-reset"
          data-testid="sop-custom-step"
          onClick={() => {
            const api = window.dashboardOps;
            if (!api) {
              setMessage(OPS_LOOP_COPY.noProduct);
              return;
            }
            const nodeId = `sop_${crypto.randomUUID()}`;
            const current = items ?? [];
            const csv = toCsv([
              ...current,
              {
                nodeId,
                parentNodeId: selected?.nodeId ?? null,
                title: '自定义步骤',
                body: '待填写',
                sortKey: current.length,
                version: 1,
                lifecycle: 'active',
              },
            ]);
            void api.sopImport(csv).then((result) => {
              setMessage(result.ok ? `已整树导入（覆盖当前会话 SOP） ${nodeId}` : result.message);
              if (result.ok) load();
            });
          }}
        >
          自定义步骤
        </button>
      </div>
      {message ? <p className="dash-scope" data-testid="sop-write-status">{message}</p> : null}
      {items === null ? (
        <div className="dash-empty-state" data-testid="sop-library-empty">
          <strong>未接入 SOP 库</strong>
          <span>坐席过敏窗仍可用预览树；工作台不把合成树当作可运营目录。</span>
        </div>
      ) : items.length === 0 ? (
        <div className="dash-empty-state" data-testid="sop-library-empty">
          <strong>当前产品会话没有 SOP 节点</strong>
        </div>
      ) : (
        <ul className="dash-list" data-testid="sop-library-list">
          {items.map((item) => (
            <li key={item.nodeId}>
              <button
                type="button"
                className={item.nodeId === selectedId ? 'is-active' : ''}
                data-testid={`sop-node-${item.nodeId}`}
                onClick={() => setSelectedId(item.nodeId)}
              >
                <strong>{item.title}</strong>
                <StatusBadge label={`v${item.version}`} tone="ok" />
                <span>{item.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
