import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { Button, Empty, Input, type ButtonProps } from 'antd';
import {
  isDashboardOpsFailure,
  OPS_LOOP_COPY,
  SOP_UPLOAD_MAX_BYTES,
  sopAllergyStepNeedsStopCopy,
  sopCsvAllergyStopMissing,
  type DashboardSopNode,
} from '@shared/dashboard-ops-loop';
import { StatusBadge } from './StatusBadge';

const NO_CHANNEL_EMPTY = '请先登录后再管理 SOP。';
const NO_STEPS = '当前没有 SOP 步骤。点上传，把 CSV 加进来。';

function stepNotice(action: '已更新' | '已删除', title: string): string {
  return `${action}「${title}」。`;
}

function SopButton(props: ButtonProps) {
  return <Button type="default" {...props} autoInsertSpace={false} />;
}

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
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef(true);

  const load = (notice?: string) => {
    const api = window.dashboardOps;
    if (!api) {
      setItems(null);
      setMessage(NO_CHANNEL_EMPTY);
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
      setMessage(notice ?? (active.length === 0 ? NO_STEPS : ''));
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
  useEffect(() => {
    setDraftTitle(selected?.title ?? '');
    setDraftBody(selected?.body ?? '');
  }, [selected?.nodeId, selected?.version, selected?.title, selected?.body]);

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
              setMessage(file ? NO_CHANNEL_EMPTY : message);
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
        <SopButton
          data-testid="sop-upload"
          disabled={!canUploadSop}
          onClick={() => uploadRef.current?.click()}
        >
          上传
        </SopButton>
        <SopButton
          type={selected ? 'primary' : 'default'}
          data-testid="sop-update"
          onClick={() => {
            const api = window.dashboardOps;
            if (!api) {
              setMessage(NO_CHANNEL_EMPTY);
              return;
            }
            if (!selected) {
              setMessage(OPS_LOOP_COPY.selectSop);
              return;
            }
            if (!draftTitle.trim()) {
              setMessage('请先填写步骤名称。');
              return;
            }
            if (sopAllergyStepNeedsStopCopy(draftTitle, draftBody)) {
              setMessage(OPS_LOOP_COPY.allergyStop);
              return;
            }
            const title = draftTitle.trim();
            void api.sopPatch({
              nodeId: selected.nodeId,
              expectedVersion: selected.version,
              title,
              body: draftBody,
              sortKey: selected.sortKey,
            }).then((result) => {
              if (isDashboardOpsFailure(result)) {
                setMessage(result.message);
                return;
              }
              const notice = stepNotice('已更新', title);
              setMessage(notice);
              load(notice);
            });
          }}
        >
          更新
        </SopButton>
        <SopButton
          danger
          data-testid="sop-delete"
          onClick={() => {
            const api = window.dashboardOps;
            if (!api) {
              setMessage(NO_CHANNEL_EMPTY);
              return;
            }
            if (!selected) {
              setMessage(OPS_LOOP_COPY.selectSop);
              return;
            }
            const title = selected.title;
            void api.sopDelete({
              nodeId: selected.nodeId,
              expectedVersion: selected.version,
            }).then((result) => {
              if (isDashboardOpsFailure(result)) {
                setMessage(result.message);
                return;
              }
              const notice = stepNotice('已删除', title);
              setMessage(notice);
              load(notice);
            });
          }}
        >
          删除
        </SopButton>
        <SopButton
          data-testid="sop-export"
          onClick={() => {
            if (!window.dashboardOps) {
              setMessage(NO_CHANNEL_EMPTY);
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
        </SopButton>
        <Input
          aria-label="新步骤名称"
          placeholder="新步骤的名称"
          style={{ width: 220 }}
          value={customTitle}
          onChange={(event) => setCustomTitle(event.target.value)}
        />
        <SopButton
          data-testid="sop-custom-step"
          disabled={!canUploadSop}
          onClick={() => {
            const api = window.dashboardOps;
            if (!api) {
              setMessage(NO_CHANNEL_EMPTY);
              return;
            }
            const title = customTitle.trim();
            if (!title) {
              setMessage('请先填写新步骤的名称。');
              return;
            }
            const nodeId = `sop_${crypto.randomUUID()}`;
            const current = items ?? [];
            const csv = toCsv([
              ...current,
              {
                nodeId,
                parentNodeId: selected?.nodeId ?? null,
                title,
                body: '待填写',
                sortKey: current.length,
                version: 1,
                lifecycle: 'active',
              },
            ]);
            void api.sopImport(csv).then((result) => {
              if (!result.ok) {
                setMessage(result.message);
                return;
              }
              setCustomTitle('');
              const notice = `已整树导入「${title}」。`;
              setMessage(notice);
              load(notice);
            });
          }}
        >
          自定义步骤
        </SopButton>
      </div>
      {selected ? <div className="fields" style={{ display: 'grid', gap: 8, maxWidth: 480, marginBottom: 16 }}>
        <Input aria-label="步骤名称" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
        <Input.TextArea aria-label="步骤内容" rows={3} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} />
      </div> : null}
      {message ? <p className="dash-scope" data-testid="sop-write-status">{message}</p> : null}
      {items === null ? (
        <Empty
          data-testid="sop-library-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={window.dashboardOps ? message : NO_CHANNEL_EMPTY}
        />
      ) : items.length === 0 ? (
        <Empty
          data-testid="sop-library-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={NO_STEPS}
        />
      ) : (
        <ul className="dash-list" data-testid="sop-library-list">
          {items.map((item) => (
            <li key={item.nodeId}>
              <SopButton
                type="text"
                className={item.nodeId === selectedId ? 'is-active' : undefined}
                data-testid={`sop-node-${item.nodeId}`}
                onClick={() => setSelectedId(item.nodeId)}
              >
                <strong>{item.title}</strong>
                <StatusBadge label={`v${item.version}`} tone="ok" />
                <span>{item.body}</span>
              </SopButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
