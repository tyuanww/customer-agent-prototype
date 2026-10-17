import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  isDashboardOpsFailure,
  OPS_LOOP_COPY,
  SOP_UPLOAD_MAX_BYTES,
  sopAllergyStepNeedsStopCopy,
  sopCsvAllergyStopMissing,
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

export function SopLibraryModule({
  canUploadSop = true,
  uploadBlock = '',
}: {
  canUploadSop?: boolean;
  uploadBlock?: string;
} = {}) {
  const [items, setItems] = useState<readonly DashboardSopNode[] | null>(null);
  const [message, setMessage] = useState('加载中…');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef(true);

  const load = () => {
    const api = window.dashboardOps;
    if (!api) {
      setItems(null);
      setMessage(OPS_LOOP_COPY.sopChannel);
      return;
    }
    void api.sopCatalog().then((result) => {
      if (!liveRef.current) return;
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
      setMessage(active.length === 0 ? '还没有 SOP。' : '');
    }).catch(() => {
      if (!liveRef.current) return;
      setItems(null);
      setMessage(OPS_LOOP_COPY.unavailable);
    });
  };

  useEffect(() => {
    liveRef.current = true;
    load();
    return () => {
      liveRef.current = false;
    };
  }, []);

  const selected = (items ?? []).find((item) => item.nodeId === selectedId) ?? null;

  return (
    <div className="dash-module" data-testid="module-sop">
      <header className="dash-module-head">
        <div>
          <h1>SOP</h1>
          <p className="dash-kicker">上传会替换现有 SOP。删除请让客服经理操作。</p>
        </div>
      </header>
      <p className="dash-scope dash-scope-important">
        上传 CSV 会替换现在的 SOP。改一条或删一条，先点中那一步。
      </p>
      <div className="dash-filter-toolbar" aria-label="SOP 写操作">
        <input
          ref={uploadRef}
          data-testid="sop-upload-input"
          type="file"
          accept=".csv"
          hidden
          disabled={!canUploadSop}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!canUploadSop) {
              if (uploadBlock) setMessage(uploadBlock);
              return;
            }
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
              if (sopCsvAllergyStopMissing(csvText)) {
                setMessage(OPS_LOOP_COPY.allergyStop);
                return;
              }
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
          disabled={!canUploadSop}
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
              setMessage(OPS_LOOP_COPY.sopChannel);
              return;
            }
            if (!selected) {
              setMessage(OPS_LOOP_COPY.selectSop);
              return;
            }
            if (sopAllergyStepNeedsStopCopy(selected.title, selected.body)) {
              setMessage(OPS_LOOP_COPY.allergyStop);
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
              setMessage(OPS_LOOP_COPY.sopChannel);
              return;
            }
            if (!selected) {
              setMessage(OPS_LOOP_COPY.selectSop);
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
          disabled={!canUploadSop}
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
              setMessage(result.ok ? 'SOP 已更新。' : result.message);
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
          <strong>还没有 SOP。</strong>
        </div>
      ) : items.length === 0 ? (
        <div className="dash-empty-state" data-testid="sop-library-empty">
          <strong>还没有 SOP。</strong>
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
