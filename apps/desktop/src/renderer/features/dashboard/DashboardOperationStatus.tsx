import { Button } from 'antd';
import { useEffect, useState } from 'react';
import type {
  OperationCommand,
  OperationState,
} from '../../../../../../packages/unified-contracts/src/index.ts';

type DashboardOperationDomain =
  | 'release'
  | 'permissions'
  | 'accounts'
  | 'materials'
  | 'rollback'
  | 'ops-loop';

type DashboardOperationView = Readonly<{
  domain: DashboardOperationDomain;
  operationId: string;
  command: OperationCommand;
  state: OperationState;
  updatedAt: string;
  recoveryDeadline: string;
  canCancel: boolean;
  canRecover: boolean;
  releaseInvalidationPending: boolean;
}>;

type DashboardOperationsReply =
  | Readonly<{ ok: true; view: DashboardOperationView | null; views: readonly DashboardOperationView[] }>
  | Readonly<{ ok: false; code: string; message: string; views: readonly DashboardOperationView[] }>;

type DashboardOperationsApi = Readonly<{
  current(): Promise<DashboardOperationsReply>;
  command(command: Readonly<{ action: 'cancel' | 'recover'; domain: DashboardOperationDomain }>): Promise<DashboardOperationsReply>;
  onChanged(listener: () => void): () => void;
}>;

declare global {
  interface Window {
    dashboardOperations?: DashboardOperationsApi;
  }
}

const DOMAIN_LABEL: Readonly<Record<DashboardOperationDomain, string>> = {
  release: '内容发布',
  permissions: '权限修改',
  accounts: '账号修改',
  materials: '资料审核',
  rollback: '版本回退',
  'ops-loop': '运营操作',
};

function activeOperation(views: readonly DashboardOperationView[]): DashboardOperationView | null {
  return views.find((view) => view.state === 'unknown')
    ?? views.find((view) => view.state === 'running' || view.state === 'accepted')
    ?? views.find((view) => view.state === 'committed' && view.releaseInvalidationPending)
    ?? null;
}

export function DashboardOperationStatus() {
  const [views, setViews] = useState<readonly DashboardOperationView[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const api = window.dashboardOperations;
    if (!api) return undefined;
    let live = true;
    const refresh = () => {
      void api.current().then((reply) => {
        if (!live) return;
        setViews(reply.views);
        setNotice(reply.ok ? null : reply.message);
      }).catch(() => {
        if (live) setNotice('操作记录暂不可用。');
      });
    };
    refresh();
    const stop = api.onChanged(refresh);
    return () => {
      live = false;
      stop();
    };
  }, []);

  const operation = activeOperation(views);
  if (!operation && !notice) return null;
  const domain = operation ? DOMAIN_LABEL[operation.domain] : '操作';
  const message = notice ?? (
    operation?.state === 'unknown'
      ? `${domain}结果还未确认。请按原请求确认结果。`
      : operation?.state === 'committed'
        ? `${domain}已保存，正在更新当前内容。`
        : `${domain}正在处理，可以停止等待。`
  );
  const action = operation?.state === 'unknown' ? 'recover'
    : operation?.canCancel ? 'cancel'
      : operation?.state === 'committed' ? 'recover'
        : null;
  const actionLabel = operation?.state === 'unknown' ? '确认结果'
    : operation?.canCancel ? '停止等待'
      : '刷新查看';

  return <div className="wb-state wb-state-uncertain" role="status" aria-live="polite" data-testid="dashboard-operation-status">
    <span>{message}</span>
    {operation && action ? <Button
      size="small"
      autoInsertSpace={false}
      disabled={busy}
      onClick={() => {
        if (!window.dashboardOperations) return;
        setBusy(true);
        setNotice(null);
        void window.dashboardOperations.command({ action, domain: operation.domain })
          .then((reply) => {
            setViews(reply.views);
            if (!reply.ok) setNotice(reply.message);
          })
          .catch(() => setNotice('操作记录暂不可用。'))
          .finally(() => setBusy(false));
      }}
    >{actionLabel}</Button> : null}
  </div>;
}
