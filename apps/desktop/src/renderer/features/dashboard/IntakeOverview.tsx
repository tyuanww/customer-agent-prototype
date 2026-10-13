import { useEffect, useState } from 'react';
import {
  ITERATION_COPY,
  type DashboardIterationCause,
  type DashboardIterationTask,
} from '@shared/dashboard-iteration';
import type { DashboardWordingResult } from '@shared/dashboard-wording';
import { inaccuracyScriptIdFromTask } from '@shared/inaccuracy-todo';
import {
  decideIterationClose,
  type CloseHintCatalog,
  type CloseHintTask,
} from '@shared/iteration-close-hint';
import {
  QUERY_ACTION_LEDGER_SURFACE,
  knowledgeValidityReminders,
  type KnowledgeValidityReminder,
} from '@shared/query-action-ledger';

const CAUSE_LABELS = {
  content_gap: '内容缺口',
  ranking: '排序问题',
  stale: '过期仍召回',
  mixed: '待判',
} as const;

const CAUSE_OPTIONS = [
  ['content_gap', CAUSE_LABELS.content_gap],
  ['ranking', CAUSE_LABELS.ranking],
  ['stale', CAUSE_LABELS.stale],
  ['mixed', CAUSE_LABELS.mixed],
] as const;

function statusLabel(status: DashboardIterationTask['status']): string {
  if (status === 'open') return '待处理';
  if (status === 'in_progress') return '处理中';
  if (status === 'resolved') return '已处理';
  return '暂不处理';
}

function isCause(value: string): value is DashboardIterationCause {
  return value === 'content_gap' || value === 'ranking' || value === 'stale' || value === 'mixed';
}

function catalogFromWording(result: DashboardWordingResult): CloseHintCatalog | null {
  if (!result.ok || result.catalogRefreshedAt === null) return null;
  return {
    catalogRefreshedAt: result.catalogRefreshedAt,
    entries: result.entries.map((entry) => ({ scriptId: entry.scriptId })),
  };
}

function judgedTask(task: DashboardIterationTask, cause: DashboardIterationCause): CloseHintTask {
  return {
    signalId: task.signalId,
    clusterKey: task.clusterKey,
    suggestedScriptIds: task.suggestedScriptIds,
    sampleQueryIds: task.sampleQueryIds,
    status: task.status === 'in_progress' ? 'in_progress' : 'open',
    suspectedCause: cause,
    createdAt: task.createdAt,
  };
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
  const [catalog, setCatalog] = useState<CloseHintCatalog | null>(null);
  const [reminders, setReminders] = useState<readonly KnowledgeValidityReminder[]>([]);
  const [causeById, setCauseById] = useState<Record<string, DashboardIterationCause>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});

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
      setMessage('');
    }).catch(() => {
      if (!live) return;
      setTasks(null);
      setMessage('未接入');
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const api = window.dashboardWording;
    if (!api) return undefined;
    let live = true;
    void api.list().then((result) => {
      if (!live) return;
      setCatalog(catalogFromWording(result));
    }).catch(() => {
      if (live) setCatalog(null);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const api = window.dashboardDesk;
    if (!api) return undefined;
    let live = true;
    void api.current().then((result) => {
      if (!live || !result.ok) return;
      setReminders(knowledgeValidityReminders(result.view.items.map((item) => ({
        id: item.id,
        question: item.name,
        statusLabel: item.statusLabel,
      }))));
    }).catch(() => {
      if (live) setReminders([]);
    });
    return () => { live = false; };
  }, []);

  function closeTask(task: DashboardIterationTask, status: 'resolved' | 'wont_fix') {
    const api = window.dashboardIteration;
    if (!api || busyId !== null) return;
    const cause = causeById[task.taskId] ?? task.suspectedCause;
    const note = noteById[task.taskId] ?? '';
    const decision = decideIterationClose({
      task: judgedTask(task, cause),
      catalog,
      status,
      resolutionNote: note,
    });
    if (!decision.ok) {
      setMessage(decision.reason === 'needs_newer_release'
        ? '内容缺口要等这条话术有更新的已发布版本后才能标已处理。'
        : '暂不处理需要填写原因。');
      return;
    }
    const resolutionNote = decision.resolutionNote.length > 0
      ? `${CAUSE_LABELS[cause]}：${decision.resolutionNote}`
      : CAUSE_LABELS[cause];
    setBusyId(task.taskId);
    void api.close({
      taskId: task.taskId,
      expectedVersion: task.version,
      status: decision.status,
      resolutionNote,
    }).then((result) => {
      setBusyId(null);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setTasks((current) => (current ?? []).map((row) => row.taskId === result.task.taskId ? result.task : row));
      setMessage('');
    }).catch(() => {
      setBusyId(null);
      setMessage('未接入');
    });
  }

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
          const cause = causeById[task.taskId] ?? task.suspectedCause;
          return <tr key={task.taskId}>
            <td>{statusLabel(task.status)}</td>
            <td>{title}</td>
            <td>
              <select aria-label={`原因 ${title}`} value={cause} onChange={(event) => {
                const value = event.target.value;
                if (!isCause(value)) return;
                setCauseById((current) => ({ ...current, [task.taskId]: value }));
              }}>
                {CAUSE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </td>
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
              <input aria-label={`处理说明 ${title}`} value={noteById[task.taskId] ?? ''} onChange={(event) => {
                const value = event.target.value;
                setNoteById((current) => ({ ...current, [task.taskId]: value }));
              }} />
              <button type="button" disabled={busyId === task.taskId} onClick={() => closeTask(task, 'resolved')}>已处理</button>
              <button type="button" disabled={busyId === task.taskId} onClick={() => closeTask(task, 'wont_fix')}>暂不处理</button>
              <button type="button" onClick={() => onOpen('content')}>去知识库</button>
            </div></td>
          </tr>;
        })}
      </tbody>
    </table>
    <section aria-label="无命中">
      <h2 className="desk-sr">无命中</h2>
      <p>{QUERY_ACTION_LEDGER_SURFACE}</p>
    </section>
    {reminders.length > 0 ? <section aria-label="知识有效期">
      <h2 className="desk-sr">知识有效期</h2>
      <table className="desk-table" aria-label="知识有效期提醒">
        <thead><tr><th>话术</th><th>状态</th></tr></thead>
        <tbody>
          {reminders.map((item) => <tr key={item.id}><td>{item.question}</td><td>{item.label}</td></tr>)}
        </tbody>
      </table>
    </section> : null}
    {message && tasks !== null ? <p role="status">{message}</p> : null}
  </section>;
}
