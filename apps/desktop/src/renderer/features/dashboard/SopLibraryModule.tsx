import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, type ButtonProps } from 'antd';
import {
  isDashboardOpsFailure,
  OPS_LOOP_COPY,
  SOP_UPLOAD_MAX_BYTES,
  sopAllergyStepNeedsStopCopy,
  sopCsvAllergyStopMissing,
  type DashboardSopNode,
} from '@shared/dashboard-ops-loop';
import type { SopUse } from '@shared/page-use';
import { StatusBadge } from './StatusBadge';
import { WorkbenchLoading } from './WorkbenchState';

const NO_CHANNEL_EMPTY = '请先登录后再管理 SOP。';
const NO_STEPS = '还没有 SOP 步骤。上传 CSV 后会出现在这里。';

function sopStatusText(state: SopUse['state'] | undefined, fallback: string): string {
  if (state === 'closed') return '没有权限，请找人开通。';
  if (state === 'unavailable') return OPS_LOOP_COPY.unavailable;
  if (state === 'pending' || state === 'open') return '';
  return fallback;
}

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
  sop,
  canUploadSop: uploadProp = true,
  canUpdateSop: updateProp = true,
  canDeleteSop: deleteProp = true,
  uploadBlock: uploadBlockProp = '',
}: {
  sop?: SopUse;
  canUploadSop?: boolean;
  canUpdateSop?: boolean;
  canDeleteSop?: boolean;
  uploadBlock?: string;
} = {}) {
  const usingSnapshot = sop !== undefined;
  const open = sop?.state === 'open';
  const canUploadSop = usingSnapshot ? open === true : uploadProp;
  const canUpdateSop = usingSnapshot ? open === true : updateProp;
  const canDeleteSop = usingSnapshot ? false : deleteProp;
  const uploadBlock = sopStatusText(sop?.state, uploadBlockProp);
  const items = useMemo(() => (
    sop?.state === 'open' ? sop.nodes.filter((item) => item.lifecycle === 'active') : null
  ), [sop]);
  const loading = sop?.state === 'pending';
  const emptyText = sopStatusText(sop?.state, NO_CHANNEL_EMPTY);
  const pendingNotice = useRef<string | undefined>(undefined);
  const noticePending = useRef(false);
  const [message, setMessage] = useState('');
  const [acted, setActed] = useState(false);
  const report = (text: string) => { setActed(true); setMessage(text); };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef(true);

  const load = (notice?: string) => {
    if (notice === undefined) return;
    pendingNotice.current = notice;
    noticePending.current = true;
    report(notice);
  };

  useEffect(() => {
    liveRef.current = true;
    return () => { liveRef.current = false; };
  }, []);

  useEffect(() => {
    if (!items) return;
    setSelectedId((current) => current && items.some((item) => item.nodeId === current)
      ? current
      : items[0]?.nodeId ?? null);
    if (noticePending.current) {
      noticePending.current = false;
      setMessage(pendingNotice.current ?? (items.length === 0 ? NO_STEPS : ''));
      return;
    }
    if (items.length === 0) setMessage((current) => current || NO_STEPS);
  }, [items]);

  const selected = (items ?? []).find((item) => item.nodeId === selectedId) ?? null;
  const emptyStateOwnsMessage = items === null && !acted;
  useEffect(() => {
    setDraftTitle(selected?.title ?? '');
    setDraftBody(selected?.body ?? '');
  }, [selected?.nodeId, selected?.version, selected?.title, selected?.body]);

  return (
    <div className="dash-module" data-testid="module-sop">
      <h1 className="desk-sr">SOP</h1>
      <div className="sop-toolbar" aria-label="SOP 写操作">
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
            if (sop && sop.state !== 'open') {
              if (uploadBlock) report(uploadBlock);
              return;
            }
            if (!canUploadSop) {
              if (uploadBlock) report(uploadBlock);
              return;
            }
            const api = window.dashboardOps;
            if (!file || !api) {
              report(file ? NO_CHANNEL_EMPTY : message);
              return;
            }
            if (file.size > SOP_UPLOAD_MAX_BYTES) {
              report(OPS_LOOP_COPY.sopTooLarge);
              return;
            }
            void file.text().then(async (csvText) => {
              if (sopCsvAllergyStopMissing(csvText)) {
                report(OPS_LOOP_COPY.allergyStop);
                return;
              }
              const result = await api.sopImport(csvText);
              report(result.ok ? `已导入 ${result.nodeCount} 个节点` : result.message);
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
        {!canUploadSop && uploadBlock
          ? <span className="wb-inline-block" data-testid="sop-upload-block">{uploadBlock}</span>
          : <span className="wb-inline-block">上传 CSV 会替换现在的 SOP。</span>}
        <SopButton
          type={selected ? 'primary' : 'default'}
          data-testid="sop-update"
          disabled={!canUpdateSop}
          onClick={() => {
            if (sop && sop.state !== 'open') return;
            if (!canUpdateSop) return;
            const api = window.dashboardOps;
            if (!api) {
              report(NO_CHANNEL_EMPTY);
              return;
            }
            if (!selected) {
              report(OPS_LOOP_COPY.selectSop);
              return;
            }
            if (!draftTitle.trim()) {
              report('请先填写步骤名称。');
              return;
            }
            if (sopAllergyStepNeedsStopCopy(draftTitle, draftBody)) {
              report(OPS_LOOP_COPY.allergyStop);
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
                report(result.message);
                return;
              }
              const notice = stepNotice('已更新', title);
              report(notice);
              load(notice);
            });
          }}
        >
          更新
        </SopButton>
        <SopButton
          danger
          data-testid="sop-delete"
          disabled={!canDeleteSop}
          onClick={() => {
            if (!canDeleteSop) return;
            const api = window.dashboardOps;
            if (!api) {
              report(NO_CHANNEL_EMPTY);
              return;
            }
            if (!selected) {
              report(OPS_LOOP_COPY.selectSop);
              return;
            }
            const title = selected.title;
            void api.sopDelete({
              nodeId: selected.nodeId,
              expectedVersion: selected.version,
            }).then((result) => {
              if (isDashboardOpsFailure(result)) {
                report(result.message);
                return;
              }
              const notice = stepNotice('已删除', title);
              report(notice);
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
              report(NO_CHANNEL_EMPTY);
              return;
            }
            if (!items || items.length === 0) {
              report('没有可导出的节点。');
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
            if (sop && sop.state !== 'open') return;
            const api = window.dashboardOps;
            if (!api) {
              report(NO_CHANNEL_EMPTY);
              return;
            }
            const title = customTitle.trim();
            if (!title) {
              report('请先填写新步骤的名称。');
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
                report(result.message);
                return;
              }
              setCustomTitle('');
              const notice = `已整树导入「${title}」。`;
              report(notice);
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
      {message && !emptyStateOwnsMessage ? <p className="sop-status" data-testid="sop-write-status" role="status">{message}</p> : null}
      {items === null && loading ? <WorkbenchLoading rows={5} label="正在读取 SOP" /> : items === null ? (
        <p className="wb-state wb-state-empty" data-testid="sop-library-empty">{emptyText}</p>
      ) : items.length === 0 ? (
        <p className="wb-state wb-state-empty" data-testid="sop-library-empty">{NO_STEPS}</p>
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
