import { useEffect, useState } from 'react';
import {
  ITERATION_COPY,
  type DashboardIterationTask,
} from '@shared/dashboard-iteration';
import type { DashboardWordingView } from '@shared/dashboard-wording';
import type { DashboardModuleId } from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

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

export function OverviewModule({ onNavigate }: { onNavigate?: (target: DashboardModuleId) => void }) {
  const [wording, setWording] = useState<DashboardWordingView | null>(null);
  const [wordingReady, setWordingReady] = useState(false);
  const [tasks, setTasks] = useState<readonly DashboardIterationTask[] | null>(null);
  const [taskMessage, setTaskMessage] = useState('加载中…');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const wordingApi = window.dashboardWording;
    const iterationApi = window.dashboardIteration;
    if (wordingApi) {
      void wordingApi.list().then((result) => {
        if (!live) return;
        setWordingReady(true);
        setWording(result.ok ? result : null);
      });
    } else {
      setWordingReady(true);
    }
    if (!iterationApi) {
      setTaskMessage('未接入');
      return () => {
        live = false;
      };
    }
    void iterationApi.list().then((result) => {
      if (!live) return;
      if (!result.ok) {
        setTasks(null);
        setTaskMessage(result.message);
        return;
      }
      setTasks(result.items);
      setTaskMessage(result.items.length === 0 ? ITERATION_COPY.empty : '');
    });
    return () => {
      live = false;
    };
  }, []);

  const openTasks = (tasks ?? []).filter((task) => task.status === 'open' || task.status === 'in_progress');
  const catalogCount = wording?.total ?? 0;
  const connected = Boolean(window.dashboardWording) && Boolean(window.dashboardIteration);

  return (
    <div className="dash-module" data-testid="module-overview">
      <header className="dash-module-head overview-hero">
        <div>
          <h1>管理概览</h1>
          <p className="dash-kicker">哪里在恶化、为什么、让谁处理</p>
        </div>
      </header>

      <section className="overview-action-strip" aria-label="今日状态">
        <article className="overview-action-card" data-tone={openTasks.length > 0 ? 'danger' : 'ok'} data-testid="overview-alert-todos">
          <strong className="overview-action-value">{tasks ? String(openTasks.length) : '—'}</strong>
          <span className="overview-action-label">待处理待办</span>
          <p className="overview-action-note">{tasks ? `${openTasks.filter((item) => item.status === 'open').length} 项未开始` : taskMessage}</p>
        </article>
        <article className="overview-action-card" data-tone="ok" data-testid="overview-alert-nohit">
          <strong className="overview-action-value">未接入</strong>
          <span className="overview-action-label">无命中率</span>
          <p className="overview-action-note">冻结指标接口未提供检索账</p>
        </article>
        <article className="overview-action-card" data-tone={wordingReady && catalogCount === 0 ? 'warn' : 'ok'} data-testid="overview-alert-catalog">
          <strong className="overview-action-value">{wordingReady ? String(catalogCount) : '—'}</strong>
          <span className="overview-action-label">当前发布话术</span>
          <p className="overview-action-note">{wording?.releaseId ? wording.releaseId : wordingReady ? '未挂载当前发布' : '加载中'}</p>
        </article>
      </section>

      <section className="overview-kpi-grid" aria-labelledby="overview-kpi-title">
        <div className="dash-section-title">
          <div><h2 id="overview-kpi-title">核心指标</h2></div>
          <p data-testid="overview-kpi-source">{connected ? '待办与话术条数来自产品会话' : '未接入产品会话'}</p>
        </div>
        <dl className="health-strip" role="list" aria-label="核心运营指标">
          <div className="health-kpi" role="listitem">
            <dt>无命中率</dt>
            <dd>未接入</dd>
            <p>没有冻结检索账接口</p>
          </div>
          <div className="health-kpi" role="listitem">
            <dt>复制完成率</dt>
            <dd>未接入</dd>
            <p>没有冻结检索账接口</p>
          </div>
          <div className="health-kpi" role="listitem">
            <dt>开放待办</dt>
            <dd>{tasks ? String(openTasks.length) : '未接入'}</dd>
            <p>GET /v1/metrics/iteration-tasks</p>
          </div>
          <div className="health-kpi" role="listitem">
            <dt>当前发布条数</dt>
            <dd>{wordingReady ? String(catalogCount) : '未接入'}</dd>
            <p>话术库当前发布</p>
          </div>
        </dl>
      </section>

      <section className="overview-action-list" aria-labelledby="overview-decisions-title">
        <div className="dash-section-title">
          <div><h2 id="overview-decisions-title">待处理事项（{openTasks.length}）</h2></div>
          <p>来自话术优化待办，不使用 8 月快照</p>
        </div>
        {tasks === null ? (
          <div className="dash-empty-state" data-testid="overview-todos-empty">
            <strong>{taskMessage}</strong>
            <span>没有产品会话时不展示待办数字。</span>
          </div>
        ) : openTasks.length === 0 ? (
          <div className="dash-empty-state" data-testid="overview-todos-empty">
            <strong>{ITERATION_COPY.empty}</strong>
          </div>
        ) : (
          <div className="manager-decision-table" role="table" aria-label="待处理事项">
            <div role="rowgroup" className="manager-decision-list">
              {openTasks.map((item) => (
                <div key={item.taskId} role="row" className="manager-decision-row manager-decision" data-testid={`decision-${item.taskId}`}>
                  <div role="cell" className="manager-decision-priority">
                    <StatusBadge label={statusLabel(item.status)} tone={item.status === 'open' ? 'danger' : 'warn'} />
                  </div>
                  <div role="cell" className="manager-decision-main">
                    <h3>{item.clusterKey}</h3>
                    <p>{CAUSE_LABELS[item.suspectedCause]} · {item.signalId}</p>
                  </div>
                  <div role="cell" className="manager-decision-owner">
                    <dl>
                      <div><dt>指派</dt><dd>{item.assigneeRole && item.assigneeRole.length > 0 ? item.assigneeRole : '未指派'}</dd></div>
                    </dl>
                  </div>
                  <div role="cell" className="manager-decision-action">
                    <button
                      type="button"
                      disabled={busyId === item.taskId}
                      onClick={() => {
                        const api = window.dashboardIteration;
                        if (!api) return;
                        setBusyId(item.taskId);
                        const request = item.status === 'open'
                          ? api.start({ taskId: item.taskId, expectedVersion: item.version })
                          : api.close({
                            taskId: item.taskId,
                            expectedVersion: item.version,
                            status: 'resolved',
                            resolutionNote: '概览关闭',
                          });
                        void request.then((result) => {
                          setBusyId(null);
                          if (!result.ok) {
                            setTaskMessage(result.message);
                            return;
                          }
                          setTasks((current) => (current ?? []).map((row) => (row.taskId === result.task.taskId ? result.task : row)));
                        });
                      }}
                    >
                      {item.status === 'open' ? '开始' : '关闭'}
                    </button>
                    <button type="button" className="dash-linkish" onClick={() => onNavigate?.('content')}>
                      去内容管理
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
