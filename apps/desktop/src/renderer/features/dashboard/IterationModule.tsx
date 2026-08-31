import { useMemo, useState } from 'react';
import {
  DASHBOARD_MANIFEST,
  type IterationCause,
  type IterationStatus,
} from '../../data/dashboard-manifest';
import { StatusBadge } from './StatusBadge';

const data = DASHBOARD_MANIFEST.iteration;

function toneFor(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (status === 'resolved') return 'ok';
  if (status === 'in_progress') return 'warn';
  if (status === 'open') return 'danger';
  return 'neutral';
}

export function IterationModule() {
  const [status, setStatus] = useState<IterationStatus | 'all'>('all');
  const [cause, setCause] = useState<IterationCause | 'all'>('all');
  const [selectedId, setSelectedId] = useState(data.tasks[0]?.taskId ?? '');
  const visible = useMemo(
    () => data.tasks.filter((task) =>
      (status === 'all' || task.status === status) && (cause === 'all' || task.cause === cause)),
    [cause, status],
  );
  const selected = visible.find((task) => task.taskId === selectedId) ?? visible[0];

  return (
    <div className="dash-module" data-testid="module-iteration">
      <header className="dash-module-head">
        <div>
          <h1>{data.title}</h1>
          <p className="dash-kicker">{data.kicker}</p>
        </div>
        <StatusBadge label="只读队列 · 不自动改稿" tone="mock" />
      </header>
      <p className="dash-scope">{data.domainNote}</p>

      <div className="dash-filter-toolbar compact" aria-label="优化待办筛选">
        <label>
          <span>根因</span>
          <select
            value={cause}
            data-testid="iteration-cause-filter"
            onChange={(event) => {
              setCause(event.target.value as IterationCause | 'all');
              setSelectedId('');
            }}
          >
            <option value="all">全部根因</option>
            <option value="content_gap">内容缺口</option>
            <option value="ranking">排序问题</option>
            <option value="policy">策略边界</option>
          </select>
        </label>
        <label>
          <span>状态</span>
          <select
            value={status}
            data-testid="iteration-status-filter"
            onChange={(event) => {
              setStatus(event.target.value as IterationStatus | 'all');
              setSelectedId('');
            }}
          >
            <option value="all">全部状态</option>
            <option value="open">open</option>
            <option value="in_progress">in_progress</option>
            <option value="resolved">resolved</option>
            <option value="wont_fix">wont_fix</option>
          </select>
        </label>
        <button
          type="button"
          className="dash-reset"
          onClick={() => {
            setStatus('all');
            setCause('all');
            setSelectedId(data.tasks[0]?.taskId ?? '');
          }}
        >
          重置
        </button>
      </div>
      <div className="dash-selection-status" aria-live="polite" data-testid="iteration-filter-status">
        <span>当前队列</span><strong>{visible.length} 项合成待办</strong><em>内容缺口、排序问题与策略边界分开处理</em>
      </div>

      <div className="iteration-layout">
        <div className="iteration-list" data-testid="iteration-list">
          {visible.map((task) => (
            <button
              key={task.taskId}
              type="button"
              className={selected?.taskId === task.taskId ? 'is-selected' : ''}
              aria-pressed={selected?.taskId === task.taskId}
              data-testid={`iteration-${task.taskId}`}
              onClick={() => setSelectedId(task.taskId)}
            >
              <span className="iteration-item-top">
                <StatusBadge label={task.priority} tone={task.priority === 'P0' ? 'danger' : task.priority === 'P1' ? 'warn' : 'neutral'} />
                <StatusBadge label={task.causeLabel} />
                <StatusBadge label={task.statusLabel} tone={toneFor(task.status)} />
              </span>
              <strong>{task.title}</strong>
              <small>{task.evidenceCount} 条合成证据 · {task.owner}</small>
            </button>
          ))}
          {!visible.length ? (
            <div className="dash-empty-state"><strong>当前筛选没有合成待办</strong><span>重置筛选查看完整只读队列。</span></div>
          ) : null}
        </div>

        <aside className="dash-card iteration-detail" aria-live="polite" data-testid="iteration-detail">
          {selected ? (
            <>
              <div className="dash-card-row">
                <span className="dash-card-label">{selected.taskId}</span>
                <StatusBadge label={selected.statusLabel} tone={toneFor(selected.status)} />
              </div>
              <h2>{selected.title}</h2>
              <p>{selected.detail}</p>
              <dl className="dash-dl dash-dl-grid">
                <div><dt>根因</dt><dd>{selected.causeLabel}</dd></div>
                <div><dt>优先级</dt><dd>{selected.priority}</dd></div>
                <div><dt>Owner</dt><dd>{selected.owner}</dd></div>
                <div><dt>证据量</dt><dd>{selected.evidenceCount} 条合成事实</dd></div>
              </dl>
              <p className="dash-next-step"><span>建议下一步</span>{selected.nextStep}</p>
              <p className="dash-footnote">状态仅展示，不在 Demo 中修改；不生成、不改写 Answer。</p>
            </>
          ) : <p className="dash-empty">选择一项待办查看经理处理口径</p>}
        </aside>
      </div>
    </div>
  );
}
