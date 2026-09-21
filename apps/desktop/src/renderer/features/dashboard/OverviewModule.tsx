import { useEffect, useState } from 'react';
import {
  ITERATION_COPY,
  type DashboardIterationTask,
} from '@shared/dashboard-iteration';
import type { DashboardWordingView } from '@shared/dashboard-wording';
import type { DashboardRetrievalMetrics } from '@shared/dashboard-ops-loop';
import {
  INACCURACY_TODO_COPY,
  aggregateInaccuracyTodoCounts,
  inaccuracyScriptIdFromTask,
} from '@shared/inaccuracy-todo';
import type { DashboardModuleId } from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

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
  const [retrieval, setRetrieval] = useState<DashboardRetrievalMetrics | null>(null);

  useEffect(() => {
    let live = true;
    const wordingApi = window.dashboardWording;
    const iterationApi = window.dashboardIteration;
    const opsApi = window.dashboardOps;
    if (opsApi) {
      void opsApi.retrieval('current_release').then((result) => {
        if (!live) return;
        setRetrieval(result.ok ? result : null);
      }).catch(() => {
        if (!live) return;
        setRetrieval(null);
      });
    }
    if (wordingApi) {
      void wordingApi.list().then((result) => {
        if (!live) return;
        setWordingReady(true);
        setWording(result.ok ? result : null);
      }).catch(() => {
        if (!live) return;
        setWordingReady(true);
        setWording(null);
      });
    } else {
      setWordingReady(false);
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
    }).catch(() => {
      if (!live) return;
      setTasks(null);
      setTaskMessage('未接入');
    });
    return () => {
      live = false;
    };
  }, []);

  const wordingConnected = Boolean(window.dashboardWording);
  const iterationConnected = Boolean(window.dashboardIteration);
  const openTasks = (tasks ?? []).filter((task) => task.status === 'open' || task.status === 'in_progress');
  const inaccuracyCounts = tasks === null ? [] : aggregateInaccuracyTodoCounts(tasks);
  const wordingTitleById = new Map((wording?.entries ?? []).map((entry) => [entry.scriptId, entry.title]));
  const catalogCount = wording?.total ?? 0;
  const catalogDisplay = !wordingConnected
    ? '未接入'
    : !wordingReady
      ? '—'
      : wording
        ? String(catalogCount)
        : '未接入';
  const connected = wordingConnected && iterationConnected;

  return (
    <div className="dash-module" data-testid="module-overview">
      <header className="dash-module-head overview-hero">
        <div>
          <h1>管理概览</h1>
          <p className="dash-kicker">哪里在恶化、为什么、让谁处理</p>
        </div>
      </header>

      <dl className="overview-scope-summary" data-testid="overview-scope">
        <div>
          <dt>统计范围</dt>
          <dd>{connected ? '当前产品会话' : '未接入产品会话'}</dd>
        </div>
        <div>
          <dt>待办</dt>
          <dd>{iterationConnected ? '话术优化待办' : '未接入'}</dd>
        </div>
        <div>
          <dt>话术条数</dt>
          <dd>{wordingConnected ? '当前发布' : '未接入'}</dd>
        </div>
        <div>
          <dt>检索账</dt>
          <dd>{retrieval ? (retrieval.window === 'last_7d' ? '近 7 天' : '当前发布') : '未接入'}</dd>
        </div>
      </dl>

      <section className="overview-kpi-grid" aria-labelledby="overview-kpi-title">
        <div className="dash-section-title">
          <div><h2 id="overview-kpi-title">核心指标</h2></div>
          <p data-testid="overview-kpi-source">{connected ? '待办与话术条数来自产品会话' : '未接入产品会话'}</p>
        </div>
        <dl className="health-strip" role="list" aria-label="核心运营指标">
          <div className="health-kpi" role="listitem" data-testid="overview-alert-nohit">
            <dt>无命中率</dt>
            <dd>{retrieval ? percent(retrieval.noHitRate) : '未接入'}</dd>
            <p>{retrieval ? '当前发布检索账' : '没有检索账'}</p>
          </div>
          <div className="health-kpi" role="listitem">
            <dt>复制完成率</dt>
            <dd>{retrieval ? percent(retrieval.copyCompleteRate) : '未接入'}</dd>
            <p>{retrieval ? '当前发布检索账' : '没有检索账'}</p>
          </div>
          <div className="health-kpi" role="listitem" data-testid="overview-alert-todos">
            <dt>开放待办</dt>
            <dd>{tasks ? String(openTasks.length) : '未接入'}</dd>
            <p>话术优化待办</p>
          </div>
          <div className="health-kpi" role="listitem" data-testid="overview-alert-catalog">
            <dt>当前发布条数</dt>
            <dd>{catalogDisplay}</dd>
            <p>{wording?.releaseId ? wording.releaseId : '与查询胶囊同一份目录'}</p>
          </div>
        </dl>
      </section>

      {tasks !== null ? (
        <section className="overview-action-list" aria-labelledby="overview-inaccuracy-title" data-testid="overview-inaccuracy-counts">
          <div className="dash-section-title">
            <div><h2 id="overview-inaccuracy-title">{INACCURACY_TODO_COPY.heading}</h2></div>
            <p>来自话术不准待办</p>
          </div>
          {inaccuracyCounts.length === 0 ? (
            <div className="dash-empty-state" data-testid="overview-inaccuracy-empty">
              <strong>{INACCURACY_TODO_COPY.empty}</strong>
            </div>
          ) : (
            <div className="manager-decision-table" role="table" aria-label={INACCURACY_TODO_COPY.heading}>
              <div role="rowgroup" className="manager-decision-table-head">
                <div role="row" className="manager-decision-row">
                  <div role="columnheader">稿</div>
                  <div role="columnheader">标题</div>
                  <div role="columnheader">样本次数</div>
                  <div role="columnheader">开放待办</div>
                </div>
              </div>
              <div role="rowgroup" className="manager-decision-list">
                {inaccuracyCounts.map((row) => (
                  <div
                    key={row.scriptId}
                    role="row"
                    className="manager-decision-row manager-decision"
                    data-testid={`overview-inaccuracy-${row.scriptId}`}
                  >
                    <div role="cell">{row.scriptId}</div>
                    <div role="cell">{wordingTitleById.get(row.scriptId) ?? '当前发布未收录该稿标题'}</div>
                    <div role="cell">{row.sampleCount}</div>
                    <div role="cell">{row.openTaskCount}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="dash-footnote">{INACCURACY_TODO_COPY.footnoteLive}</p>
        </section>
      ) : null}

      <section className="overview-action-list" aria-labelledby="overview-decisions-title">
        <div className="dash-section-title">
          <div><h2 id="overview-decisions-title">{tasks === null ? '待处理事项（未接入）' : `待处理事项（${openTasks.length}）`}</h2></div>
          <p>来自话术优化待办</p>
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
            <div role="rowgroup" className="manager-decision-table-head">
              <div role="row" className="manager-decision-row">
                <div role="columnheader">状态</div>
                <div role="columnheader">事项</div>
                <div role="columnheader">Owner</div>
                <div role="columnheader">下一步</div>
              </div>
            </div>
            <div role="rowgroup" className="manager-decision-list">
              {openTasks.map((item) => {
                const inaccuracyScriptId = inaccuracyScriptIdFromTask(item);
                const sampleCount = new Set(item.sampleQueryIds.filter((queryId) => queryId.length > 0)).size;
                const title = inaccuracyScriptId
                  ? (wordingTitleById.get(inaccuracyScriptId) ?? `话术不准 · ${inaccuracyScriptId}`)
                  : item.clusterKey;
                const detail = inaccuracyScriptId
                  ? `话术不准 · 稿 ${inaccuracyScriptId} · 样本 ${sampleCount} 次`
                  : `${CAUSE_LABELS[item.suspectedCause]} · ${item.signalId}`;
                return (
                <div key={item.taskId} role="row" className="manager-decision-row manager-decision" data-testid={`decision-${item.taskId}`}>
                  <div role="cell" className="manager-decision-priority">
                    <StatusBadge label={statusLabel(item.status)} tone={item.status === 'open' ? 'danger' : 'warn'} />
                  </div>
                  <div role="cell" className="manager-decision-main">
                    <h3>{title}</h3>
                    <p>{detail}</p>
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
                        }).catch(() => {
                          setBusyId(null);
                          setTaskMessage('未接入');
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
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
