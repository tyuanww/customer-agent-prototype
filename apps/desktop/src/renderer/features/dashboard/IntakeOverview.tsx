import { useEffect, useState } from 'react';
import {
  ITERATION_COPY,
  type DashboardIterationTask,
} from '@shared/dashboard-iteration';
import { inaccuracyScriptIdFromTask } from '@shared/inaccuracy-todo';

const CAUSE_LABELS = {
  content_gap: '内容缺口',
  ranking: '排序问题',
  stale: '过期仍召回',
  mixed: '待判',
} as const;

function statusLabel(status: DashboardIterationTask['status']): string {
  if (status === 'open') return '待处理';
  if (status === 'in_progress') return '处理中';
  if (status === 'resolved') return '已处理';
  return '暂不处理';
}

/** faq-v2 overview lists open iteration tasks only. It does not invent rates. */
export function IntakeOverview({
  canOpenPermissions,
  onOpen,
}: {
  canOpenPermissions: boolean;
  onOpen: (target: 'content' | 'wording' | 'permissions') => void;
}) {
  const [tasks, setTasks] = useState<readonly DashboardIterationTask[] | null>(null);
  const [message, setMessage] = useState('加载中…');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const api = window.dashboardIteration;
    if (!api) {
      setTasks(null);
      setMessage('未接入');
      return undefined;
    }
    let live = true;
    void api.list().then((result) => {
      if (!live) return;
      if (!result.ok) {
        setTasks(null);
        setMessage(result.message);
        return;
      }
      setTasks(result.items);
      setMessage(result.items.length === 0 ? ITERATION_COPY.empty : '');
    }).catch(() => {
      if (!live) return;
      setTasks(null);
      setMessage('未接入');
    });
    return () => { live = false; };
  }, []);

  const openTasks = (tasks ?? []).filter((task) => task.status === 'open' || task.status === 'in_progress');
  return <section className="dash-module" data-testid="module-overview">
    <h1 className="desk-sr">管理概览</h1>
    <div className="intake-toolbar desk-entry-row">
      <button className="dash-action-primary" type="button" onClick={() => onOpen('content')}>知识库</button>
      <button className="dash-reset" type="button" onClick={() => onOpen('wording')}>话术库</button>
      {canOpenPermissions ? <button className="dash-reset" type="button" onClick={() => onOpen('permissions')}>权限</button> : null}
    </div>
    <table className="desk-table" aria-label="话术迭代">
      <thead><tr><th>状态</th><th>事项</th><th>原因</th><th>操作</th></tr></thead>
      <tbody>
        {tasks === null ? <tr><td colSpan={4}>{message}</td></tr> : openTasks.length === 0 ? <tr><td colSpan={4}>{ITERATION_COPY.empty}</td></tr> : openTasks.map((task) => {
          const scriptId = inaccuracyScriptIdFromTask(task);
          const title = scriptId ? `话术不准 · ${scriptId}` : task.clusterKey;
          return <tr key={task.taskId}>
            <td>{statusLabel(task.status)}</td>
            <td>{title}</td>
            <td>{CAUSE_LABELS[task.suspectedCause]}</td>
            <td><div className="desk-row-actions">
              {task.status === 'open' ? <button type="button" disabled={busyId === task.taskId} onClick={() => {
                const api = window.dashboardIteration;
                if (!api) return;
                setBusyId(task.taskId);
                void api.start({ taskId: task.taskId, expectedVersion: task.version }).then((result) => {
                  setBusyId(null);
                  if (!result.ok) { setMessage(result.message); return; }
                  setTasks((current) => (current ?? []).map((row) => row.taskId === result.task.taskId ? result.task : row));
                }).catch(() => { setBusyId(null); setMessage('未接入'); });
              }}>开始处理</button> : null}
              <button type="button" onClick={() => onOpen('content')}>去知识库</button>
            </div></td>
          </tr>;
        })}
      </tbody>
    </table>
    {message && tasks !== null ? <p role="status">{message}</p> : null}
  </section>;
}
